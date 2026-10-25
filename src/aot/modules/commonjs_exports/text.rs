use super::{Access, AccessKind, StoredValue};
use crate::builtins::{BuiltinNames, ResolvedBuiltins};
use crate::modules::namespace_members::{find_outermost_type_assertion, is_plain_name};
use crate::modules::order::FileText;
use crate::modules::wrapped::WrappedModules;
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{
    AssignmentTarget, Binding, BindingInitializer, Bound, CodeUnit, CommonJsVariable, FnOwner,
    FunctionFlags, Parent, PatParent,
};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::fold::{Constant, Decisions, FoldedValue};
use bun_sema::hir::{
    self, BinOp, Chain, ExprId, ExprKind, FnId, FnKind, MemberKey, PatId, StmtId, StmtKind, UnOp,
};
use bun_sema::program::{FileId, Files};
use bun_sema::util::{FxHashMap, FxHashSet};
use std::cell::OnceCell;

pub(super) struct Text<'a, 's> {
    pub file: FileId,
    pub atoms: &'a Interner<'s>,
    pub hir: &'a hir::File<'s>,
    pub bound: &'a Bound<'s>,
    pub analysis: &'a FileAnalysis<'s>,
    pub decisions: &'a Decisions<'s>,
    pub builtins: &'a ResolvedBuiltins,
    pub builtin_names: &'a BuiltinNames,
    pub places: FileText<'a, 's>,
    functions_with_this: OnceCell<Option<FxHashSet<FnId>>>,
    first_returns: OnceCell<FxHashMap<CodeUnit, u32>>,
}

#[derive(Copy, Clone)]
enum Node {
    Expression(ExprId),
    Statement(StmtId),
}

impl<'a, 's> Text<'a, 's> {
    pub(super) fn new(
        files: &'a Files<'s>,
        wrapped: &'a WrappedModules,
        builtin_names: &'a BuiltinNames,
        file: FileId,
        builtins: &'a ResolvedBuiltins,
    ) -> Text<'a, 's> {
        let analysis = files.analysis(file);
        Text {
            file,
            atoms: &files.atoms,
            hir: files.hir(file),
            bound: files.bound(file),
            analysis,
            decisions: &analysis.decisions,
            builtins,
            builtin_names,
            places: FileText::new(files, wrapped, file),
            functions_with_this: OnceCell::new(),
            first_returns: OnceCell::new(),
        }
    }

    pub(super) fn expressions(&self) -> impl Iterator<Item = ExprId> + use<> {
        (0..self.hir.exprs.len() as u32).map(ExprId)
    }

    /// The parent of an expression, past the type assertions around it.
    pub(super) fn parent(&self, expression: ExprId) -> (ExprId, Parent) {
        let outermost = find_outermost_type_assertion(self.hir, self.bound, expression);
        (outermost, self.bound.parent_of_expr(outermost))
    }

    pub(super) fn is_statement(&self, expression: ExprId) -> bool {
        self.statement_of(expression).is_some()
    }

    /// The statement that the expression is, and nothing else.
    pub(super) fn statement_of(&self, expression: ExprId) -> Option<StmtId> {
        match self.parent(expression).1 {
            Parent::Stmt(statement) if matches!(self.hir[statement].kind, StmtKind::Expr(_)) => {
                Some(statement)
            }
            _ => None,
        }
    }

    pub(super) fn constant(&self, expression: ExprId) -> Option<Constant> {
        let expression = self.hir.skip_type_assertions(expression);
        match self.decisions.constant(self.hir, expression) {
            FoldedValue::Constant(constant) => Some(constant),
            FoldedValue::ConstantOutsideDeadZone(_) | FoldedValue::Unknown => None,
        }
    }

    pub(super) fn constant_name(&self, key: ExprId) -> Option<Atom> {
        match self.constant(key)? {
            Constant::String(name) => Some(name),
            _ => None,
        }
    }

    pub(super) fn name_of_key(&self, key: MemberKey) -> Option<Atom> {
        match key {
            MemberKey::Name(name) => Some(name),
            MemberKey::Computed(computed) => self.constant_name(computed),
            MemberKey::PrivateName(_) => None,
        }
    }

    pub(super) fn can_name_variable(&self, name: Atom) -> bool {
        is_plain_name(self.atoms, self.builtin_names, name)
    }

    /// The access to a member of `object` that `object` is written in.
    pub(super) fn find_access(&self, object: ExprId) -> Option<Access> {
        let (object, Parent::Expr(node)) = self.parent(object) else {
            return None;
        };
        let (accessed, key) = self.hir.member_key(node)?;
        let (ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. }) = self.hir[node].kind
        else {
            return None;
        };
        if accessed != object || chain != Chain::No {
            return None;
        }
        let name = self
            .name_of_key(key)
            .filter(|&name| self.can_name_variable(name))?;
        let (outermost, parent) = self.parent(node);
        if let Some(target) = self.bound.get_assignment_target(self.hir, outermost) {
            let kind = match (target, self.find_assignment(node)) {
                (AssignmentTarget::Assign(None), Some((_, value))) => {
                    AccessKind::Store(self.classify_value(value))
                }
                // A part of a pattern, or the head of a loop.
                (AssignmentTarget::Assign(None) | AssignmentTarget::ForInOrOf, _) => {
                    AccessKind::Store(StoredValue::Unknown)
                }
                (AssignmentTarget::Assign(Some(BinOp::And | BinOp::Or | BinOp::Nullish)), _) => {
                    let stored = self
                        .find_right_side(outermost)
                        .map(|value| self.classify_value(value));
                    AccessKind::Choice(stored.unwrap_or(StoredValue::Unknown))
                }
                (AssignmentTarget::Assign(Some(_)) | AssignmentTarget::Unary, _) => {
                    AccessKind::Update
                }
            };
            return Some(Access { node, name, kind });
        }
        let kind = match parent {
            Parent::Expr(user) => match self.hir[user].kind {
                ExprKind::Call(call) | ExprKind::TaggedTemplate(call)
                    if self.hir[call].callee == outermost =>
                {
                    AccessKind::Call
                }
                ExprKind::Unary {
                    op: UnOp::Delete, ..
                } => return None,
                _ => AccessKind::Read,
            },
            _ => AccessKind::Read,
        };
        Some(Access { node, name, kind })
    }

    // `target op= value`
    fn find_right_side(&self, target: ExprId) -> Option<ExprId> {
        let Parent::Expr(user) = self.bound.parent_of_expr(target) else {
            return None;
        };
        match self.hir[user].kind {
            ExprKind::Assign {
                target: assigned,
                value,
                ..
            } if assigned == target => Some(value),
            _ => None,
        }
    }

    /// `target = value`: the assignment and the value.
    pub(super) fn find_assignment(&self, target: ExprId) -> Option<(ExprId, ExprId)> {
        let (target, Parent::Expr(user)) = self.parent(target) else {
            return None;
        };
        match self.hir[user].kind {
            // In a pattern `target = value` is a default, and what is stored comes from elsewhere.
            ExprKind::Assign {
                op: None,
                target: assigned,
                value,
            } if assigned == target
                && self.bound.get_assignment_target(self.hir, user).is_none() =>
            {
                Some((user, value))
            }
            _ => None,
        }
    }

    // `None`: of some `this` the walk does not say whose it is.
    fn find_functions_with_this(&self) -> Option<FxHashSet<FnId>> {
        let mut functions = FxHashSet::default();
        for expression in self.expressions() {
            if matches!(self.hir[expression].kind, ExprKind::This | ExprKind::Super)
                && let CodeUnit::Function(function) = self.unit_with_this(expression)?
            {
                functions.insert(function);
            }
        }
        Some(functions)
    }

    fn classify_function(&self, function: FnId) -> StoredValue {
        let flags = self.bound.function_flags(function);
        let has_eval = flags.contains(FunctionFlags::HAS_DIRECT_EVAL);
        let with_this = &self.functions_with_this;
        let with_this = with_this.get_or_init(|| self.find_functions_with_this());
        let has_no_this = || matches!(with_this, Some(set) if !set.contains(&function));
        let ignores_this = self.hir[function].kind == FnKind::Arrow || (!has_eval && has_no_this());
        match ignores_this {
            true => StoredValue::IgnoresThis,
            false => StoredValue::Unknown,
        }
    }

    fn classify_name(&self, name: ExprId, names_followed: u32) -> StoredValue {
        // `var a = b; var b = a`: each stands for the other.
        const MAX_NAMES_FOLLOWED: u32 = 8;
        if names_followed == MAX_NAMES_FOLLOWED {
            return StoredValue::Unknown;
        }
        let Binding::Symbol(symbol) = self.bound.binding(name) else {
            return StoredValue::Unknown;
        };
        if !self.bound.is_stable_binding(symbol) {
            return StoredValue::Unknown;
        }
        match self.bound.binding_initializer(self.hir, symbol) {
            BindingInitializer::Function(function) => self.classify_function(function),
            BindingInitializer::Class(_) => StoredValue::IgnoresThis,
            BindingInitializer::Expression(value) => {
                self.classify_value_behind_names(value, names_followed + 1)
            }
            _ => StoredValue::Unknown,
        }
    }

    pub(super) fn classify_value(&self, value: ExprId) -> StoredValue {
        self.classify_value_behind_names(value, 0)
    }

    fn classify_value_behind_names(&self, value: ExprId, names_followed: u32) -> StoredValue {
        let value = self.hir.skip_type_assertions(value);
        match self.constant(value) {
            Some(Constant::Undefined) => return StoredValue::Undefined,
            Some(_) => return StoredValue::IgnoresThis,
            None => {}
        }
        match self.hir[value].kind {
            ExprKind::Assign {
                op: None, value, ..
            } => self.classify_value_behind_names(value, names_followed),
            ExprKind::Fn(function) => self.classify_function(function),
            ExprKind::Ident(_) => self.classify_name(value, names_followed),
            ExprKind::Class(_)
            | ExprKind::Object(_)
            | ExprKind::Array(_)
            | ExprKind::Regex { .. }
            | ExprKind::Template { .. } => StoredValue::IgnoresThis,
            _ => StoredValue::Unknown,
        }
    }

    // The declaration or the parameter that the pattern is a part of: its defaults and computed keys are evaluated there.
    fn parent_of_pattern(&self, mut pattern: PatId) -> Parent {
        loop {
            match self.bound.pat_parent[pattern.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pattern = outer,
                PatParent::Var(declaration) => return Parent::VarInit(declaration),
                PatParent::Param(parameter) => return Parent::ParamDefault(parameter),
                PatParent::None => return Parent::None,
            }
        }
    }

    pub(super) fn code_unit_of(&self, expression: ExprId) -> Option<CodeUnit> {
        let (hir, bound) = (self.hir, self.bound);
        let mut parent = bound.parent_of_expr(expression);
        let statement = loop {
            parent = match parent {
                Parent::Expr(outer) => bound.parent_of_expr(outer),
                Parent::Prop(property)
                | Parent::PropKey(property)
                | Parent::MethodKey(property) => {
                    bound.parent_of_expr(bound.prop_owner[property.idx()])
                }
                Parent::PatPropDefault(property) | Parent::PatKey(property) => {
                    self.parent_of_pattern(hir[property].value)
                }
                Parent::PatElemDefault(element) => self.parent_of_pattern(hir[element].pat),
                // What a class extends, its decorators and the computed names of its members are evaluated where the class is.
                Parent::ClassExtends(class) | Parent::ClassDecorator(class) => {
                    bound.class_owner[class.idx()].to_parent()
                }
                Parent::MemberKey(member) | Parent::MemberDecorator(member) => {
                    bound.class_owner[bound.member_class(member)?.idx()].to_parent()
                }
                Parent::Stmt(statement) => break statement,
                Parent::VarInit(declaration) => break bound.var_stmt[declaration.idx()],
                Parent::Case(case) => break bound.case_stmt[case.idx()],
                Parent::File => return Some(CodeUnit::File),
                Parent::FnBody(function) => return Some(CodeUnit::Function(function)),
                Parent::ParamDefault(parameter) => {
                    return Some(CodeUnit::Function(bound.param_fn[parameter.idx()]));
                }
                Parent::MemberInit(member) => return Some(CodeUnit::FieldInitializer(member)),
                _ => return None,
            };
        };
        let scope = bound.scope_of_stmt(statement);
        scope.is_some().then(|| bound.code_unit(scope))
    }

    pub(super) fn enclosing_unit_of(&self, function: FnId) -> CodeUnit {
        let bound = self.bound;
        let mut next = bound.fns[function.idx()].scope.some();
        while let Some(scope) = next {
            let unit = bound.code_unit(scope);
            if unit != CodeUnit::Function(function) {
                return unit;
            }
            next = bound.runtime_parent_scope(self.hir, scope).some();
        }
        CodeUnit::File
    }

    /// Whether the expression is written in a function declaration of `body`, which can be called from the first statement on.
    pub(super) fn is_in_function_declaration(&self, expression: ExprId, body: CodeUnit) -> bool {
        let Some(mut unit) = self.code_unit_of(expression) else {
            return true;
        };
        let mut outermost = None;
        while unit != body {
            let CodeUnit::Function(function) = unit else {
                return true;
            };
            outermost = Some(function);
            unit = self.enclosing_unit_of(function);
        }
        outermost.is_some_and(|function| self.hir[function].kind == FnKind::Decl)
    }

    /// The code whose `this` an expression sees: arrow functions have none of their own.
    pub(super) fn unit_with_this(&self, expression: ExprId) -> Option<CodeUnit> {
        let mut unit = self.code_unit_of(expression)?;
        while let CodeUnit::Function(function) = unit {
            if self.hir[function].kind != FnKind::Arrow {
                break;
            }
            unit = self.enclosing_unit_of(function);
        }
        Some(unit)
    }

    fn find_first_returns(&self) -> FxHashMap<CodeUnit, u32> {
        let mut first_returns = FxHashMap::default();
        for (index, statement) in self.hir.stmts.iter().enumerate() {
            if !matches!(statement.kind, StmtKind::Return(_)) {
                continue;
            }
            let scope = self.bound.scope_of_stmt(StmtId(index as u32));
            if scope.is_none() {
                continue;
            }
            let first = first_returns
                .entry(self.bound.code_unit(scope))
                .or_insert(u32::MAX);
            *first = (*first).min(statement.start);
        }
        first_returns
    }

    fn is_ahead_of_returns(&self, unit: CodeUnit, position: u32) -> bool {
        let first_returns = self.first_returns.get_or_init(|| self.find_first_returns());
        first_returns
            .get(&unit)
            .is_none_or(|&first| position < first)
    }

    // Whether `user` evaluates its operand whenever it is evaluated itself, and goes on at once.
    fn always_evaluates(&self, user: ExprId, operand: ExprId) -> bool {
        match self.hir[user].kind {
            ExprKind::Yield { .. } | ExprKind::Await(_) | ExprKind::Jsx(_) => false,
            _ => self.places.always_evaluates(user, operand),
        }
    }

    fn always_runs(&self, user: StmtId, part: Node) -> bool {
        matches!(
            (self.hir[user].kind, part),
            (StmtKind::Block(_), Node::Statement(_))
                | (
                    StmtKind::Expr(_)
                        | StmtKind::Var(_)
                        | StmtKind::Throw(_)
                        | StmtKind::ExportAssign(_)
                        | StmtKind::If { .. }
                        | StmtKind::Switch { .. },
                    Node::Expression(_),
                )
        )
    }

    /// Whether every run of `body` passes the expression: it is in no function but one that is called where it is written, in no branch, loop or `try`, and behind no `return`.
    pub(super) fn is_in_order(&self, expression: ExprId, body: CodeUnit) -> bool {
        let bound = self.bound;
        let position = self.hir[expression].pos;
        let mut node = Node::Expression(expression);
        loop {
            let parent = match node {
                Node::Expression(expression) => bound.parent_of_expr(expression),
                Node::Statement(statement) => bound.parent_of_stmt(statement),
            };
            node = match (parent, node) {
                (Parent::Expr(user), Node::Expression(operand)) => {
                    if !self.always_evaluates(user, operand) {
                        return false;
                    }
                    Node::Expression(user)
                }
                (Parent::Prop(property) | Parent::PropKey(property), _) => {
                    Node::Expression(bound.prop_owner[property.idx()])
                }
                (Parent::VarInit(declaration), _) => {
                    Node::Statement(bound.var_stmt[declaration.idx()])
                }
                (Parent::Stmt(user), part) => {
                    if !self.always_runs(user, part) {
                        return false;
                    }
                    Node::Statement(user)
                }
                (Parent::File, _) => {
                    return body == CodeUnit::File
                        && self.is_ahead_of_returns(CodeUnit::File, position);
                }
                (Parent::FnBody(function), _) => {
                    let unit = CodeUnit::Function(function);
                    if !self.is_ahead_of_returns(unit, position) {
                        return false;
                    }
                    if unit == body {
                        return true;
                    }
                    match bound.fns[function.idx()].owner {
                        FnOwner::Expr(written) if self.places.is_called_where_written(function) => {
                            Node::Expression(written)
                        }
                        _ => return false,
                    }
                }
                _ => return false,
            };
        }
    }

    /// Whether nothing but a run of `body` gets to the expression: it is in no function but one that is called where it is written.
    pub(super) fn is_run_by_body_alone(&self, expression: ExprId, body: CodeUnit) -> bool {
        let Some(mut unit) = self.code_unit_of(expression) else {
            return false;
        };
        while unit != body {
            let CodeUnit::Function(function) = unit else {
                return false;
            };
            if !self.places.is_called_where_written(function) {
                return false;
            }
            unit = self.enclosing_unit_of(function);
        }
        true
    }

    pub(super) fn is_statement_in_order(&self, expression: ExprId, body: CodeUnit) -> bool {
        self.is_statement(expression) && self.is_in_order(expression, body)
    }

    /// Only a plain call of the name `require` answers with the module for sure, and only in a file that cannot put something else under the name.
    pub(super) fn is_call_of_free_require(&self, call: ExprId) -> bool {
        let hir = self.hir;
        let ExprKind::Call(id) = hir[call].kind else {
            return false;
        };
        let callee = hir.skip_type_assertions(hir[id].callee);
        hir[id].chain == Chain::No && self.places.is_free(callee, CommonJsVariable::Require)
    }
}
