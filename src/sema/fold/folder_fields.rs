use super::folder::{Effects, Folder};
use crate::atom::{Atom, known};
use crate::bind::{
    Binding, BindingInitializer, CodeUnit, CommonJsVariable, Decl, FnOwner, Parent, SymbolId,
};
use crate::hir::{
    BinOp, ExprId, ExprKind, Flags, FnBody, FnId, MemberKey, PatKind, PropKey, PropKind, StmtId,
    StmtKind, UnOp,
};
use crate::util::FxHashMap;
use smallvec::SmallVec;
use std::cell::{OnceCell, RefCell};

#[derive(Default)]
pub(super) struct OwnObjects {
    names_by_variable: OnceCell<Vec<(SymbolId, ExprId)>>,
    literals: RefCell<FxHashMap<SymbolId, Option<OwnLiteral>>>,
    types_of_reads: FxHashMap<ExprId, Atom>,
}

#[derive(Clone)]
struct OwnLiteral {
    literal: ExprId,
    stores: SmallVec<[(Atom, ExprId); 2]>,
}

#[derive(Copy, Clone)]
enum Node {
    Expression(ExprId),
    Statement(StmtId),
}

#[derive(Copy, Clone)]
struct CallInPlace {
    call: ExprId,
    callee: ExprId,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Repeats {
    Never,
    Maybe,
}

impl Folder<'_, '_> {
    fn is_tested_for_type_or_truthiness(&self, mut e: ExprId) -> bool {
        loop {
            match self.bound.parent_of_expr(e) {
                Parent::Expr(parent) if parent.is_some() => match self.hir[parent].kind {
                    ExprKind::Unary { op, .. } => return matches!(op, UnOp::Typeof | UnOp::Not),
                    ExprKind::Binary { op, .. } => return matches!(op, BinOp::And | BinOp::Or),
                    ExprKind::Cond { .. } => return true,
                    ExprKind::As { expr, .. }
                    | ExprKind::Satisfies { expr, .. }
                    | ExprKind::AsConst(expr)
                    | ExprKind::NonNull(expr)
                    | ExprKind::Instantiation { expr, .. }
                        if expr == e =>
                    {
                        e = parent;
                    }
                    _ => return false,
                },
                Parent::Stmt(user) => return matches!(self.hir[user].kind, StmtKind::If { .. }),
                _ => return false,
            }
        }
    }

    fn outermost_assertion(&self, e: ExprId) -> ExprId {
        self.bound.outermost_type_assertion(self.hir, e)
    }

    pub(super) fn note_read_of_own_object(&mut self, e: ExprId) {
        if !self.is_tested_for_type_or_truthiness(e) {
            return;
        }
        let Some(type_name) = self.find_type_of_own_object(e) else {
            return;
        };
        self.own_objects.types_of_reads.insert(e, type_name);
        self.conditions.insert(e, true);
        self.effects[e.idx()] = Effects::MemberRead;
        self.mark_folded_by_build_alone(e);
    }

    pub(super) fn type_of_own_object(&self, operand: ExprId) -> Option<Atom> {
        let operand = self.hir.skip_type_assertions(operand);
        self.own_objects.types_of_reads.get(&operand).copied()
    }

    fn find_type_of_own_object(&self, e: ExprId) -> Option<Atom> {
        let hir = self.hir;
        if let ExprKind::Ident(_) = hir[e].kind {
            let Some(Binding::Symbol(variable)) = self.bound.static_binding(e) else {
                return None;
            };
            let literal = self.find_literal_of(variable)?;
            let unit = self.find_declaration_unit(variable)?;
            let is_behind =
                hir[e].pos > hir[literal].end && self.climb(e, unit, Repeats::Maybe).is_some();
            return is_behind.then_some(known::object);
        }
        let ExprKind::Dot { .. } = hir[e].kind else {
            return None;
        };
        let (object, MemberKey::Name(name)) = hir.member_key(e)? else {
            return None;
        };
        if self.is_assignment_target(e) || self.is_delete_operand(e) {
            return None;
        }
        let object = hir.skip_type_assertions(object);
        match self.bound.static_binding(object)? {
            _ if !matches!(hir[object].kind, ExprKind::Ident(_)) => None,
            Binding::Symbol(variable) => self.find_type_of_own_field(e, variable, name),
            Binding::CommonJs(CommonJsVariable::Module) => {
                let is_fresh = name == known::exports
                    && self.find_loader_name(object) == Some(CommonJsVariable::Module)
                    && self.is_first_in_file(e);
                is_fresh.then_some(known::object)
            }
            Binding::CommonJs(_) | Binding::Arguments(_) | Binding::Free => None,
        }
    }

    fn find_literal_of(&self, variable: SymbolId) -> Option<ExprId> {
        if !self.bound.is_stable_binding(variable) {
            return None;
        }
        let BindingInitializer::Expression(value) =
            self.bound.binding_initializer(self.hir, variable)
        else {
            return None;
        };
        let literal = self.hir.skip_type_assertions(value);
        matches!(self.hir[literal].kind, ExprKind::Object(_)).then_some(literal)
    }

    fn find_declaration_unit(&self, variable: SymbolId) -> Option<CodeUnit> {
        let (hir, bound) = (self.hir, self.bound);
        let mut declarations = bound.symbol(variable).decls.iter();
        let (Some(&Decl::Var(pattern)), None) = (declarations.next(), declarations.next()) else {
            return None;
        };
        if !matches!(hir[pattern].kind, PatKind::Ident(_)) {
            return None;
        }
        let literal = self.find_literal_of(variable)?;
        let Parent::VarInit(declaration) = bound.parent_of_expr(self.outermost_assertion(literal))
        else {
            return None;
        };
        if hir[declaration].pat != pattern {
            return None;
        }
        match bound.parent_of_stmt(bound.var_stmt[declaration.idx()]) {
            Parent::File => Some(CodeUnit::File),
            Parent::FnBody(function) => Some(CodeUnit::Function(function)),
            _ => None,
        }
    }

    fn find_type_of_own_field(&self, read: ExprId, variable: SymbolId, name: Atom) -> Option<Atom> {
        let hir = self.hir;
        let literal = self.find_literal_of(variable)?;
        let ExprKind::Object(properties) = hir[literal].kind else {
            return None;
        };
        let value = properties
            .iter()
            .find(|&it| matches!(hir.runtime_property_key(it), PropKey::Name(key) if key == name))
            .map(|it| hir.skip_type_assertions(hir[it].value))?;
        let type_name = match hir[value].kind {
            ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Regex { .. } => known::object,
            ExprKind::Fn(_) => known::function,
            _ => return None,
        };
        let own = self.find_own_literal(variable)?;
        let unit = self.find_declaration_unit(variable)?;
        if hir[read].pos <= hir[own.literal].end {
            return None;
        }
        let calls = self.climb(read, unit, Repeats::Never)?;
        let mut stores = own.stores.iter().filter(|store| store.0 == name);
        stores
            .all(|&(_, store)| self.is_evaluated_behind(store, read, &calls, unit))
            .then_some(type_name)
    }

    fn is_evaluated_behind(
        &self,
        later: ExprId,
        read: ExprId,
        calls: &[CallInPlace],
        unit: CodeUnit,
    ) -> bool {
        let hir = self.hir;
        let position = hir[later].pos;
        position >= hir[read].end
            && calls.iter().all(|it| {
                let is_in = |e: ExprId| (hir[e].pos..hir[e].end).contains(&position);
                !is_in(it.call) || is_in(it.callee)
            })
            && self.climb(later, unit, Repeats::Maybe).is_some()
    }

    fn names_of(&self, variable: SymbolId) -> &[(SymbolId, ExprId)] {
        let names = self.own_objects.names_by_variable.get_or_init(|| {
            let names = (0..self.hir.exprs.len() as u32).map(ExprId);
            let names = names.filter(|&it| matches!(self.hir[it].kind, ExprKind::Ident(_)));
            let mut names: Vec<(SymbolId, ExprId)> = names
                .filter_map(|name| match self.bound.binding(name) {
                    Binding::Symbol(symbol) => Some((symbol, name)),
                    Binding::CommonJs(_) | Binding::Arguments(_) | Binding::Free => None,
                })
                .collect();
            names.sort_unstable_by_key(|it| (it.0.0, it.1.0));
            names
        });
        let start = names.partition_point(|it| it.0.0 < variable.0);
        let count = names[start..].partition_point(|it| it.0.0 == variable.0);
        &names[start..start + count]
    }

    fn find_own_literal(&self, variable: SymbolId) -> Option<OwnLiteral> {
        if let Some(known) = self.own_objects.literals.borrow().get(&variable) {
            return known.clone();
        }
        let found = self.inspect_literal_uses(variable);
        let mut literals = self.own_objects.literals.borrow_mut();
        literals.insert(variable, found.clone());
        found
    }

    fn inspect_literal_uses(&self, variable: SymbolId) -> Option<OwnLiteral> {
        let (hir, bound) = (self.hir, self.bound);
        let literal = self.find_literal_of(variable)?;
        let ExprKind::Object(properties) = hir[literal].kind else {
            return None;
        };
        if self.is_exported_variable(variable)
            || bound.is_visible_to_eval(variable)
            || bound.runtime.is_named_implicitly(variable)
            || !bound.runtime.eval_scopes().is_empty()
        {
            return None;
        }
        let mut names: SmallVec<[Atom; 4]> = SmallVec::new();
        for property in properties.iter() {
            let PropKey::Name(name) = hir.runtime_property_key(property) else {
                return None;
            };
            let is_plain = matches!(hir[property].kind, PropKind::Init | PropKind::Shorthand)
                && name != known::__proto__
                && !names.contains(&name);
            if !is_plain {
                return None;
            }
            names.push(name);
        }
        let mut stores = SmallVec::new();
        for &(_, mention) in self.names_of(variable) {
            let mention = self.outermost_assertion(mention);
            let user = self.parent_expr(mention)?;
            match hir[user].kind {
                ExprKind::Unary {
                    op: UnOp::Typeof, ..
                } => continue,
                ExprKind::Dot { .. } => {}
                _ => return None,
            }
            let Some((object, MemberKey::Name(name))) = hir.member_key(user) else {
                return None;
            };
            if object != mention || !names.contains(&name) || self.is_called_or_deleted(user) {
                return None;
            }
            if self.is_assignment_target(user) {
                stores.push((name, user));
            }
        }
        Some(OwnLiteral { literal, stores })
    }

    fn is_called_or_deleted(&self, member: ExprId) -> bool {
        let Some(user) = self.parent_expr(self.outermost_assertion(member)) else {
            return false;
        };
        match self.hir[user].kind {
            ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => {
                self.hir.skip_type_assertions(self.hir[call].callee) == member
            }
            ExprKind::Unary {
                op: UnOp::Delete, ..
            } => true,
            _ => false,
        }
    }

    fn climb(
        &self,
        e: ExprId,
        unit: CodeUnit,
        repeats: Repeats,
    ) -> Option<SmallVec<[CallInPlace; 2]>> {
        let (hir, bound) = (self.hir, self.bound);
        let mut calls = SmallVec::new();
        let mut node = Node::Expression(e);
        loop {
            let parent = match node {
                Node::Expression(child) => bound.parent_of_expr(child),
                Node::Statement(child) => bound.parent_of_stmt(child),
            };
            node = match parent {
                Parent::Expr(user) if user.is_some() => {
                    if repeats == Repeats::Never && self.is_target_of_pattern(node, user) {
                        return None;
                    }
                    Node::Expression(user)
                }
                Parent::Prop(property) | Parent::PropKey(property) => {
                    let owner = bound.prop_owner[property.idx()].some()?;
                    // An element evaluates its key after its other attributes and its children.
                    if repeats == Repeats::Never && matches!(hir[owner].kind, ExprKind::Jsx(_)) {
                        return None;
                    }
                    Node::Expression(owner)
                }
                Parent::VarInit(declaration) => Node::Statement(bound.var_stmt[declaration.idx()]),
                Parent::Stmt(user) => {
                    let is_loop = matches!(
                        hir[user].kind,
                        StmtKind::For { .. }
                            | StmtKind::ForIn { .. }
                            | StmtKind::ForOf { .. }
                            | StmtKind::While { .. }
                            | StmtKind::DoWhile { .. }
                    );
                    if is_loop && repeats == Repeats::Never {
                        return None;
                    }
                    Node::Statement(user)
                }
                Parent::FnBody(function) if unit == CodeUnit::Function(function) => {
                    return Some(calls);
                }
                Parent::FnBody(function) => {
                    let call = self.find_call_in_place(function)?;
                    calls.push(call);
                    Node::Expression(call.call)
                }
                Parent::File if unit == CodeUnit::File => return Some(calls),
                _ => return None,
            };
        }
    }

    /// An assignment evaluates the keys and the defaults of a pattern after its value.
    fn is_target_of_pattern(&self, node: Node, assignment: ExprId) -> bool {
        let ExprKind::Assign { target, .. } = self.hir[assignment].kind else {
            return false;
        };
        matches!(node, Node::Expression(child) if child == target)
            && matches!(
                self.hir[target].kind,
                ExprKind::Array(_) | ExprKind::Object(_)
            )
    }

    fn find_call_in_place(&self, function: FnId) -> Option<CallInPlace> {
        let (hir, bound) = (self.hir, self.bound);
        let runs_later = hir[function]
            .flags
            .intersects(Flags::ASYNC | Flags::GENERATOR);
        if runs_later || !bound.is_called_only_where_written(hir, function) {
            return None;
        }
        let FnOwner::Expr(callee) = bound.fns[function.idx()].owner else {
            return None;
        };
        let call = self.parent_expr(callee)?;
        Some(CallInPlace { call, callee })
    }

    fn is_first_in_file(&self, e: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut node = Node::Expression(e);
        loop {
            node = match node {
                Node::Expression(child) => match bound.parent_of_expr(child) {
                    Parent::Expr(user) if user.is_some() => {
                        let is_first = match hir[user].kind {
                            ExprKind::Unary { .. } => true,
                            ExprKind::Binary { left, .. } => {
                                left == child || self.evaluates_constants_alone(left)
                            }
                            ExprKind::Cond { test, .. } => {
                                test == child || self.evaluates_constants_alone(test)
                            }
                            ExprKind::Call(call) => {
                                hir[call].callee == child
                                    && hir
                                        .ids(hir[call].args)
                                        .all(|it: ExprId| self.evaluates_constants_alone(it))
                            }
                            _ => hir.type_assertion_operand(user) == Some(child),
                        };
                        if !is_first {
                            return false;
                        }
                        Node::Expression(user)
                    }
                    Parent::Stmt(user) => match hir[user].kind {
                        StmtKind::Expr(_) | StmtKind::If { .. } => Node::Statement(user),
                        _ => return false,
                    },
                    _ => return false,
                },
                Node::Statement(child) => match bound.parent_of_stmt(child) {
                    Parent::File => return self.runs_nothing_before(child, hir.ids(hir.body)),
                    Parent::FnBody(function) => {
                        let FnBody::Block(statements) = hir[function].body else {
                            return false;
                        };
                        let Some(call) = self.find_call_in_place(function) else {
                            return false;
                        };
                        let has_defaults = hir[function].params.iter().any(|it| {
                            hir[it].default.is_some()
                                || !matches!(hir[hir[it].pat].kind, PatKind::Ident(_))
                        });
                        if has_defaults || !self.runs_nothing_before(child, hir.ids(statements)) {
                            return false;
                        }
                        Node::Expression(call.callee)
                    }
                    Parent::Stmt(user) => match hir[user].kind {
                        StmtKind::If { test, .. } if self.evaluates_constants_alone(test) => {
                            Node::Statement(user)
                        }
                        _ => return false,
                    },
                    _ => return false,
                },
            };
        }
    }

    fn runs_nothing_before(
        &self,
        statement: StmtId,
        mut statements: impl Iterator<Item = StmtId>,
    ) -> bool {
        let hir = self.hir;
        statements
            .by_ref()
            .take_while(|&it| it != statement)
            .all(|it| match hir[it].kind {
                StmtKind::Empty | StmtKind::Fn(_) | StmtKind::Directive { .. } => true,
                StmtKind::Var(declarations) => declarations.iter().all(|it| {
                    let declaration = &hir[it];
                    matches!(hir[declaration.pat].kind, PatKind::Ident(_))
                        && declaration
                            .init
                            .some()
                            .is_none_or(|init| self.evaluates_constants_alone(init))
                }),
                _ => false,
            })
    }

    fn evaluates_constants_alone(&self, e: ExprId) -> bool {
        let hir = self.hir;
        let e = hir.skip_type_assertions(e);
        match hir[e].kind {
            ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::Regex { .. }
            | ExprKind::This
            | ExprKind::Fn(_) => true,
            ExprKind::Ident(_) => matches!(
                self.bound.static_binding(e),
                Some(Binding::Symbol(_) | Binding::CommonJs(_))
            ),
            ExprKind::Unary {
                op: UnOp::Typeof | UnOp::Not | UnOp::Void,
                operand,
            } => self.evaluates_constants_alone(operand),
            ExprKind::Binary {
                op:
                    BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq | BinOp::And | BinOp::Or,
                left,
                right,
            } => {
                self.evaluates_type_test_or_constant(left)
                    && self.evaluates_type_test_or_constant(right)
            }
            ExprKind::Object(properties) => properties.len() == 0,
            ExprKind::Array(items) => items.is_empty(),
            _ => false,
        }
    }

    fn evaluates_type_test_or_constant(&self, e: ExprId) -> bool {
        let is_object = |e: ExprId| {
            matches!(
                self.hir[e].kind,
                ExprKind::Ident(_)
                    | ExprKind::This
                    | ExprKind::Fn(_)
                    | ExprKind::Regex { .. }
                    | ExprKind::Object(_)
                    | ExprKind::Array(_)
            )
        };
        let e = self.hir.skip_type_assertions(e);
        !is_object(e) && self.evaluates_constants_alone(e)
    }
}
