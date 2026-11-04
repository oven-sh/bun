//! Built-in objects that a file of a test run lets go where it does not follow them: what evaluates text, and the objects that take no other name.
//! Not what leads to the test runner, `Bun` and the global object: whoever gets the runner where the build does not see it is refused by what it calls, aloud. An object OF the runner that goes
//! somewhere is followed where the file's built-ins are resolved.
//! By binding: the file's built-ins say what an expression stands for, and where the expression stands says where the object goes.

use bun_sema::bind::{Decl, Parent};
use bun_sema::fold::FoldedValue;
use bun_sema::hir::{BinOp, ExprId, ExprKind, PatKind, PropKey, StmtId, StmtKind, VarDeclId};
use bun_sema::resolve::FinishedFile;
use bun_sema::util::SharedSort;

use crate::builtins::table::{self, BuiltinFlags};
use crate::builtins::{BuiltinId, Resolved, ResolvedBuiltins};

// The entry that lists the members of what the place holds. Every name of the global object stands for the one entry.
fn object_held_at(place: BuiltinId) -> BuiltinId {
    match table::has_flag(place, BuiltinFlags::IS_GLOBAL_OBJECT) {
        true => BuiltinId::GlobalThis,
        false => table::canonical_id(place),
    }
}

fn takes_no_names(holder: BuiltinId) -> bool {
    table::has_flag(holder, BuiltinFlags::IS_LOCKED_OBJECT)
        || table::has_flag(holder, BuiltinFlags::IS_CLOSED_TO_OTHER_NAMES)
}

fn evaluates_text(id: BuiltinId) -> bool {
    table::has_flag(id, BuiltinFlags::EVALUATES_TEXT)
        || table::has_flag(table::canonical_id(id), BuiltinFlags::EVALUATES_TEXT)
}

pub(super) fn find_outermost_assertion(
    request: &FinishedFile<'_, '_>,
    mut value: ExprId,
) -> ExprId {
    let &FinishedFile { hir, bound, .. } = request;
    while let Parent::Expr(parent) = bound.parent_of_expr(value)
        && hir.type_assertion_operand(parent) == Some(value)
    {
        value = parent;
    }
    value
}

// `(0, eval)`, `eval as Run`
fn find_where_value_stands(request: &FinishedFile<'_, '_>, mut value: ExprId) -> ExprId {
    let &FinishedFile { hir, bound, .. } = request;
    while let Parent::Expr(parent) = bound.parent_of_expr(value)
        && (hir.type_assertion_operand(parent) == Some(value)
            || matches!(hir[parent].kind, ExprKind::Binary { op: BinOp::Comma, right, .. } if right == value))
    {
        value = parent;
    }
    value
}

pub(super) fn is_known_constant(request: &FinishedFile<'_, '_>, value: ExprId) -> bool {
    let &FinishedFile { hir, analysis, .. } = request;
    let value = hir.skip_type_assertions(value);
    match analysis.decisions.constant(hir, value) {
        FoldedValue::Constant(_) | FoldedValue::ConstantOutsideDeadZone(_) => true,
        FoldedValue::Unknown => false,
    }
}

// `object;`, `if (object)`, `while (object)`
fn is_tested_or_dropped(request: &FinishedFile<'_, '_>, statement: StmtId, value: ExprId) -> bool {
    match request.hir[statement].kind {
        StmtKind::Expr(_) => true,
        StmtKind::If { test, .. }
        | StmtKind::While { test, .. }
        | StmtKind::DoWhile { test, .. }
        | StmtKind::For { test, .. } => test == value,
        _ => false,
    }
}

/// `const B = Bun`, where the file's built-ins know what `B` holds from then on, and `const { version, jest } = Bun`: the names say what is taken.
fn is_followed_from_declaration(
    request: &FinishedFile<'_, '_>,
    builtins: &ResolvedBuiltins,
    declaration: VarDeclId,
    is_whole_initializer: bool,
) -> bool {
    let &FinishedFile { hir, bound, .. } = request;
    let pattern = hir[declaration].pat;
    is_whole_initializer
        && match hir[pattern].kind {
            PatKind::Ident(_) => {
                let holder = bound.declared_symbol(Decl::Var(pattern));
                holder.is_some() && builtins.of_symbol(holder).is_some()
            }
            PatKind::Object(properties) => properties.iter().all(|property| {
                !hir[property].is_rest && matches!(hir[property].key, PropKey::Name(_))
            }),
            PatKind::Array(_) | PatKind::Missing => false,
        }
}

/// Whether what `mention` stands for goes where the file does not follow it: it is handed to a call, stored, returned, laid into a list, or asked for a member under a
/// key that folding does not know. `object.name`, `object()`, `typeof object` and `object === other` leave it where it is.
pub(super) fn goes_out_of_sight(
    request: &FinishedFile<'_, '_>,
    builtins: &ResolvedBuiltins,
    mention: ExprId,
) -> bool {
    let &FinishedFile { hir, bound, .. } = request;
    let (mut value, mut is_whole) = (mention, true);
    loop {
        let user = match bound.parent_of_expr(value) {
            Parent::Expr(user) => user,
            Parent::Stmt(statement) => return !is_tested_or_dropped(request, statement, value),
            Parent::VarInit(declaration) => {
                return !is_followed_from_declaration(request, builtins, declaration, is_whole);
            }
            _ => return true,
        };
        match hir[user].kind {
            _ if hir.type_assertion_operand(user) == Some(value) => {}
            // `a && b` answers `a` only where `a` is no object.
            ExprKind::Binary {
                op: BinOp::And,
                left,
                ..
            } if left == value => return false,
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                ..
            } => is_whole = false,
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } if right == value => is_whole = false,
            ExprKind::Cond { test, .. } if test != value => is_whole = false,
            ExprKind::Index { obj, index, .. } if obj == value => {
                return !is_known_constant(request, index);
            }
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call)
                if hir[call].callee == value =>
            {
                return false;
            }
            ExprKind::Assign { target, .. } if target == value => return false,
            ExprKind::Unary { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Template { .. } => return false,
            _ => return true,
        }
        value = user;
    }
}

/// What the one loop over a file finds of the built-in objects that the file names.
pub(super) struct ObjectsOutOfSight<'a, 's> {
    request: &'a FinishedFile<'a, 's>,
    builtins: &'a ResolvedBuiltins,
    pub(super) evaluates_unknown_text: bool,
    pub(super) evaluates_unknown_text_among_its_names: bool,
    closed_holders: Vec<BuiltinId>,
}

impl<'a, 's> ObjectsOutOfSight<'a, 's> {
    pub(super) fn new(
        request: &'a FinishedFile<'a, 's>,
        builtins: &'a ResolvedBuiltins,
    ) -> ObjectsOutOfSight<'a, 's> {
        ObjectsOutOfSight {
            request,
            builtins,
            evaluates_unknown_text: false,
            evaluates_unknown_text_among_its_names: false,
            closed_holders: Vec::new(),
        }
    }

    /// `expect.any`, `expect(made).toBeInstanceOf`, `expect(held).not.toBe`: `expect`, a member of it, a member of what it answers. They compare what they are handed, and call none of it.
    fn is_of_expect(&self, callee: ExprId) -> bool {
        let hir = self.request.hir;
        let mut part = callee;
        loop {
            part = hir.skip_type_assertions(part);
            if let Some(known) = self.builtins.builtin_of_expression(part) {
                return table::is_of_expect(known);
            }
            part = match hir[part].kind {
                ExprKind::Dot { obj, .. } => obj,
                ExprKind::Call(call) => hir[call].callee,
                _ => return false,
            };
        }
    }

    /// `eval(text)`: the text sees every name that the place of the call sees.
    fn is_called_as_direct_eval(&self, mention: ExprId) -> bool {
        let bound = self.request.bound;
        match bound.parent_of_expr(find_outermost_assertion(self.request, mention)) {
            Parent::Expr(user) => bound.eval_scope(user).is_some(),
            _ => false,
        }
    }

    /// `mention` stands for a function that evaluates text. `eval("1 + 1")` and `new Function("a", "return a")` are read like any text that the file holds.
    fn may_evaluate_unknown_text(&self, mention: ExprId, evaluator: BuiltinId) -> bool {
        let (request, hir) = (self.request, self.request.hir);
        let callee = find_where_value_stands(request, mention);
        let Parent::Expr(user) = request.bound.parent_of_expr(callee) else {
            return goes_out_of_sight(request, self.builtins, mention);
        };
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[user].kind else {
            return goes_out_of_sight(request, self.builtins, mention);
        };
        if hir[call].callee != callee {
            return !self.is_of_expect(hir[call].callee);
        }
        // Each operand of `Function` is a part of the text.
        let mut operands = hir.ids(hir[call].args);
        match table::canonical_id(evaluator) == table::canonical_id(BuiltinId::Function) {
            true => !operands.all(|operand| is_known_constant(request, operand)),
            false => !operands
                .next()
                .is_none_or(|text| is_known_constant(request, text)),
        }
    }

    /// `expression`: in code that runs.
    pub(super) fn look_at(&mut self, expression: ExprId, kind: ExprKind) {
        if !matches!(
            kind,
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. }
        ) {
            return;
        }
        let id = match self.builtins.of_expr(expression) {
            Some(Resolved::DynamicGlobal(path)) => Some(path.id),
            _ => self.builtins.builtin_of_expression(expression),
        };
        let Some(id) = id else {
            return;
        };
        if evaluates_text(id) {
            let may_evaluate = self.may_evaluate_unknown_text(expression, id);
            self.evaluates_unknown_text |= may_evaluate;
            self.evaluates_unknown_text_among_its_names |=
                may_evaluate && self.is_called_as_direct_eval(expression);
        }
        let object = object_held_at(id);
        if takes_no_names(object) && goes_out_of_sight(self.request, self.builtins, expression) {
            self.closed_holders.push(object);
        }
    }

    /// Ascending, each once.
    pub(super) fn take_closed_holders(&mut self) -> Vec<BuiltinId> {
        let mut holders = std::mem::take(&mut self.closed_holders);
        holders.shared_sort_unstable();
        holders.dedup();
        holders
    }
}
