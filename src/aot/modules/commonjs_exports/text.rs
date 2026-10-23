use super::{Access, AccessKind, StoredValue};
use crate::builtins::id::BuiltinId;
use crate::builtins::{BuiltinNames, ResolvedBuiltins, table};
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{
    AssignmentTarget, Binding, BindingInitializer, Bound, CodeUnit, CommonJsVariable, FnOwner,
    FunctionFlags, Parent, PatParent, has_mapped_arguments,
};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::fold::{Constant, Decisions, FoldedValue};
use bun_sema::hir::{
    self, BinOp, Chain, ExprId, ExprKind, Flags, FnId, FnKind, MemberKey, PatId, StmtId, StmtKind,
    UnOp,
};
use bun_sema::program::{FileId, Files};
use bun_sema::util::{FxHashMap, FxHashSet};
use std::cell::{OnceCell, RefCell};

pub(super) struct Text<'a, 's> {
    pub file: FileId,
    pub atoms: &'a Interner<'s>,
    pub hir: &'a hir::File<'s>,
    pub bound: &'a Bound<'s>,
    pub analysis: &'a FileAnalysis<'s>,
    pub decisions: &'a Decisions<'s>,
    pub builtins: &'a ResolvedBuiltins,
    pub builtin_names: &'a BuiltinNames,
    functions_with_this: OnceCell<Option<FxHashSet<FnId>>>,
    first_returns: OnceCell<FxHashMap<CodeUnit, u32>>,
    called_only_where_written: RefCell<FxHashMap<FnId, bool>>,
}

#[derive(Copy, Clone)]
enum Node {
    Expression(ExprId),
    Statement(StmtId),
}

impl<'a, 's> Text<'a, 's> {
    pub(super) fn new(
        files: &'a Files<'s>,
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
            functions_with_this: OnceCell::new(),
            first_returns: OnceCell::new(),
            called_only_where_written: RefCell::default(),
        }
    }

    pub(super) fn expressions(&self) -> impl Iterator<Item = ExprId> + use<> {
        (0..self.hir.exprs.len() as u32).map(ExprId)
    }

    pub(super) fn outermost_type_assertion(&self, operand: ExprId) -> ExprId {
        let mut outermost = operand;
        while let Parent::Expr(parent) = self.bound.parent_of_expr(outermost)
            && self.hir.type_assertion_operand(parent) == Some(outermost)
        {
            outermost = parent;
        }
        outermost
    }

    /// The parent of an expression, past the type assertions around it.
    pub(super) fn parent(&self, expression: ExprId) -> (ExprId, Parent) {
        let outermost = self.outermost_type_assertion(expression);
        (outermost, self.bound.parent_of_expr(outermost))
    }

    pub(super) fn is_statement(&self, expression: ExprId) -> bool {
        match self.parent(expression).1 {
            Parent::Stmt(statement) => matches!(self.hir[statement].kind, StmtKind::Expr(_)),
            _ => false,
        }
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
            Constant::Undefined
            | Constant::Null
            | Constant::Boolean(_)
            | Constant::Number(_)
            | Constant::BigInt(_) => None,
        }
    }

    pub(super) fn name_of_key(&self, key: MemberKey) -> Option<Atom> {
        match key {
            MemberKey::Name(name) => Some(name),
            MemberKey::Computed(computed) => self.constant_name(computed),
            MemberKey::PrivateName(_) => None,
        }
    }

    /// An object finds these names without having them, or keeps what is stored under them elsewhere.
    pub(super) fn can_name_variable(&self, name: Atom) -> bool {
        let is_number = self
            .atoms
            .bytes(name)
            .first()
            .is_some_and(u8::is_ascii_digit);
        let is_inherited = self
            .builtin_names
            .get(name)
            .is_some_and(|name| table::own_member(BuiltinId::ObjectPrototype, name).is_some());
        !is_number && !is_inherited && name != known::__proto__
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
        let has_eval = self
            .bound
            .function_flags(function)
            .contains(FunctionFlags::HAS_DIRECT_EVAL);
        let functions_with_this = self
            .functions_with_this
            .get_or_init(|| self.find_functions_with_this());
        let ignores_this = self.hir[function].kind == FnKind::Arrow
            || (!has_eval
                && functions_with_this
                    .as_ref()
                    .is_some_and(|functions| !functions.contains(&function)));
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
        loop {
            let statement = match parent {
                Parent::Expr(outer) => {
                    parent = bound.parent_of_expr(outer);
                    continue;
                }
                Parent::Prop(property)
                | Parent::PropKey(property)
                | Parent::MethodKey(property) => {
                    parent = bound.parent_of_expr(bound.prop_owner[property.idx()]);
                    continue;
                }
                Parent::PatPropDefault(property) | Parent::PatKey(property) => {
                    parent = self.parent_of_pattern(hir[property].value);
                    continue;
                }
                Parent::PatElemDefault(element) => {
                    parent = self.parent_of_pattern(hir[element].pat);
                    continue;
                }
                // What a class extends, its decorators and the computed names of its members are evaluated where the class is.
                Parent::ClassExtends(class) | Parent::ClassDecorator(class) => {
                    parent = bound.class_owner[class.idx()].to_parent();
                    continue;
                }
                Parent::MemberKey(member) | Parent::MemberDecorator(member) => {
                    parent = bound.class_owner[bound.member_class(member)?.idx()].to_parent();
                    continue;
                }
                Parent::Stmt(statement) => statement,
                Parent::VarInit(declaration) => bound.var_stmt[declaration.idx()],
                Parent::Case(case) => bound.case_stmt[case.idx()],
                Parent::File => return Some(CodeUnit::File),
                Parent::FnBody(function) => return Some(CodeUnit::Function(function)),
                Parent::ParamDefault(parameter) => {
                    return Some(CodeUnit::Function(bound.param_fn[parameter.idx()]));
                }
                Parent::MemberInit(member) => return Some(CodeUnit::FieldInitializer(member)),
                Parent::None
                | Parent::EnumInit(_)
                | Parent::ParamDecorator(_)
                | Parent::Module(_) => return None,
            };
            let scope = bound.scope_of_stmt(statement);
            return scope.is_some().then(|| bound.code_unit(scope));
        }
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

    fn is_called_where_written(&self, function: FnId) -> bool {
        let hir = self.hir;
        let mut known = self.called_only_where_written.borrow_mut();
        !hir[function]
            .flags
            .intersects(Flags::ASYNC | Flags::GENERATOR)
            && *known
                .entry(function)
                .or_insert_with(|| self.bound.is_called_only_where_written(hir, function))
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

    // Whether `user` evaluates its operand whenever it is evaluated itself.
    fn always_evaluates(&self, user: ExprId, operand: ExprId) -> bool {
        let hir = self.hir;
        let is_choice = |op: BinOp| matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish);
        match hir[user].kind {
            ExprKind::Binary { op, left, .. } => !is_choice(op) || operand == left,
            ExprKind::Assign {
                op: Some(op),
                target,
                ..
            } => !is_choice(op) || operand == target,
            // In a pattern `target = value` is a default, which is evaluated only where nothing comes for the target.
            ExprKind::Assign {
                op: None, value, ..
            } => operand != value || self.bound.get_assignment_target(hir, user).is_none(),
            ExprKind::Cond { test, .. } => operand == test,
            ExprKind::Index { obj, chain, .. } => chain == Chain::No || operand == obj,
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                hir[call].chain == Chain::No || operand == hir[call].callee
            }
            ExprKind::Yield { .. } | ExprKind::Await(_) | ExprKind::Jsx(_) => false,
            _ => true,
        }
    }

    // Whether a statement runs its part whenever it runs itself.
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
                        FnOwner::Expr(written) if self.is_called_where_written(function) => {
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
            if !self.is_called_where_written(function) {
                return false;
            }
            unit = self.enclosing_unit_of(function);
        }
        true
    }

    /// Whether the expression is a statement that every run of `body` passes.
    pub(super) fn is_statement_in_order(&self, expression: ExprId, body: CodeUnit) -> bool {
        self.is_statement(expression) && self.is_in_order(expression, body)
    }

    /// Whoever replaces `require` decides what a call of it answers.
    pub(super) fn may_replace_require(&self) -> bool {
        let (bound, decisions) = (self.bound, self.decisions);
        let require = Binding::CommonJs(CommonJsVariable::Require);
        let mut stores = bound.runtime.unbound_name_stores().iter();
        let mut evals = bound.runtime.eval_scopes().iter();
        let mut idents = bound.ident_bindings().iter();
        stores
            .any(|&(target, _)| bound.binding(target) == require && !decisions.is_dead_expr(target))
            || evals.any(|&(call, _)| !decisions.is_dead_expr(call))
            || (has_mapped_arguments(self.hir, CodeUnit::File)
                && idents.any(|&(ident, binding)| {
                    binding == Binding::Arguments(CodeUnit::File) && !decisions.is_dead_expr(ident)
                }))
    }

    /// Only a plain call of the name `require` answers with the module for sure, and only in a file that cannot put something else under the name.
    pub(super) fn is_call_of_free_require(&self, call: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let ExprKind::Call(id) = hir[call].kind else {
            return false;
        };
        let callee = hir.skip_type_assertions(hir[id].callee);
        hir[id].chain == Chain::No
            && matches!(hir[callee].kind, ExprKind::Ident(_))
            && bound.binding(callee) == Binding::CommonJs(CommonJsVariable::Require)
    }
}
