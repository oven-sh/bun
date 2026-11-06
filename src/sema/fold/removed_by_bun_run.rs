use super::children::TreeNode;
use super::dead_code::DeadRoots;
use super::evaluate::Value;
use super::folder::Folder;
use crate::atom::known;
use crate::bind::{Binding, BindingKind, CommonJsVariable};
use crate::hir::{
    BinOp, ExprId, ExprKind, File, Flags, NameKind, PatId, PatKind, PropKey, PropKind, StmtId,
    StmtKind, UnOp, VarKind,
};

#[derive(Copy, Clone)]
enum Rule {
    /// `simplify_unused_expr`
    UnusedValue,
    /// `expr_can_be_removed_if_unused`
    UndecidedTest,
}

#[derive(Default)]
struct Removal {
    parts: Vec<(TreeNode, Rule)>,
    reads_module_or_exports: bool,
}

/// `bun run` removes code that does nothing, and forgets the names in a statement of the file that it removes whole.
/// The rules are those of `s_if`, `simplify_unused_expr` and `should_keep_stmt_in_dead_control_flow` in `js_parser`.
impl Folder<'_, '_> {
    pub(super) fn push_statements_removed_by_bun_run(&self, roots: &mut DeadRoots) {
        let mut removal = Removal::default();
        for statement in self.hir.ids(self.hir.body) {
            let kind = self.hir[statement].kind;
            if !matches!(
                kind,
                StmtKind::Expr(_) | StmtKind::Block(_) | StmtKind::If { .. }
            ) {
                continue;
            }
            removal.parts.clear();
            (removal.parts).push((TreeNode::Stmt(statement), Rule::UnusedValue));
            removal.reads_module_or_exports = false;
            if !self.removes_all(&mut removal) {
                continue;
            }
            roots.in_bun_run.push(TreeNode::Stmt(statement));
            // Without this statement the file may be an ES module, which has neither name.
            if removal.reads_module_or_exports {
                roots.all.push(TreeNode::Stmt(statement));
            }
        }
    }

    fn removes_all(&self, removal: &mut Removal) -> bool {
        while let Some((part, rule)) = removal.parts.pop() {
            let can_be_removed = match part {
                TreeNode::Stmt(statement) => {
                    self.push_parts_of_statement(statement, &mut removal.parts)
                }
                TreeNode::Expr(e) => self.push_parts_of_unused_value(e, rule, removal),
                TreeNode::Function(_) | TreeNode::Class(_) | TreeNode::Pattern(_) => false,
            };
            if !can_be_removed {
                return false;
            }
        }
        true
    }

    /// The statement is removed if this is true and everything it pushes is removed.
    fn push_parts_of_statement(
        &self,
        statement: StmtId,
        parts: &mut Vec<(TreeNode, Rule)>,
    ) -> bool {
        let unused = Rule::UnusedValue;
        match self.hir[statement].kind {
            StmtKind::Empty | StmtKind::Interface(_) | StmtKind::TypeAlias(_) => true,
            StmtKind::Expr(e) => {
                parts.push((TreeNode::Expr(e), unused));
                true
            }
            StmtKind::Block(list) => {
                parts.extend((self.hir.ids(list)).map(|inner| (TreeNode::Stmt(inner), unused)));
                true
            }
            StmtKind::If { test, yes, no } => {
                let condition = self.is_truthy_in_bun_run(test);
                let rule = condition.map_or(Rule::UndecidedTest, |_| unused);
                parts.push((TreeNode::Expr(test), rule));
                let branches = [(yes, true), (no, false)];
                let mut present = branches.into_iter().filter(|branch| branch.0.is_some());
                present.all(|(branch, runs_when)| {
                    if condition == Some(!runs_when) {
                        return is_removed_where_never_run(self.hir, branch);
                    }
                    parts.push((TreeNode::Stmt(branch), unused));
                    true
                })
            }
            _ => false,
        }
    }

    /// The value is removed if this is true and everything it pushes is removed.
    fn push_parts_of_unused_value(&self, e: ExprId, rule: Rule, removal: &mut Removal) -> bool {
        let hir = self.hir;
        let e = hir.skip_type_assertions(e);
        let parts = &mut removal.parts;
        let mut push = |operands: &[ExprId]| {
            let present = operands.iter().filter_map(|operand| operand.some());
            parts.extend(present.map(|operand| (TreeNode::Expr(operand), rule)));
        };
        match hir[e].kind {
            ExprKind::Missing
            | ExprKind::This
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex { .. }
            | ExprKind::Fn(_)
            | ExprKind::ImportMeta => true,
            ExprKind::Ident(_) => match self.bound.binding(e) {
                Binding::Symbol(symbol) => self.bound.binding_kind(symbol) != BindingKind::Import,
                Binding::Free => {
                    matches!(self.folded(e).value, Value::Known(_)) && self.is_folded_by_bun_run(e)
                }
                // `bun run` declares these two in every file. The other names of CommonJS are free names to it.
                Binding::CommonJs(CommonJsVariable::Module | CommonJsVariable::Exports) => {
                    removal.reads_module_or_exports = true;
                    true
                }
                Binding::Arguments(_) | Binding::CommonJs(_) => false,
            },
            ExprKind::Unary { op, operand } => {
                let is_type_of_name =
                    op == UnOp::Typeof && matches!(hir[operand].kind, ExprKind::Ident(_));
                if !is_type_of_name {
                    push(&[operand]);
                }
                matches!(op, UnOp::Void | UnOp::Not | UnOp::Typeof)
            }
            ExprKind::Binary { op, left, right } => {
                let is_decided_by_left = match op {
                    BinOp::And => self.is_truthy_in_bun_run(left) == Some(false),
                    BinOp::Or => self.is_truthy_in_bun_run(left) == Some(true),
                    BinOp::Nullish => {
                        self.is_nullish(left) == Some(false) && self.is_folded_by_bun_run(left)
                    }
                    _ => false,
                };
                push(&[left]);
                if !is_decided_by_left {
                    push(&[right]);
                }
                match op {
                    BinOp::EqEqEq
                    | BinOp::NotEqEq
                    | BinOp::Comma
                    | BinOp::And
                    | BinOp::Or
                    | BinOp::Nullish => true,
                    BinOp::EqEq | BinOp::NotEq | BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                        match rule {
                            Rule::UnusedValue => {
                                self.is_always_primitive(left) && self.is_always_primitive(right)
                            }
                            Rule::UndecidedTest => {
                                self.is_always_string(left) && self.is_always_string(right)
                            }
                        }
                    }
                    // A string joined with "" is that string.
                    BinOp::Add => [(left, right), (right, left)].iter().any(|&(text, empty)| {
                        self.is_always_string(text)
                            && matches!(hir[empty].kind, ExprKind::String(it) if it == known::empty)
                    }),
                    _ => false,
                }
            }
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                match self.is_truthy_in_bun_run(test) {
                    Some(true) => push(&[test, branches.yes]),
                    Some(false) => push(&[test, branches.no]),
                    None => push(&[test, branches.yes, branches.no]),
                }
                true
            }
            ExprKind::Array(items) => {
                let spread_array = |item: ExprId| match hir[item].kind {
                    ExprKind::Spread(inner) if matches!(hir[inner].kind, ExprKind::Array(_)) => {
                        Some(inner)
                    }
                    _ => None,
                };
                let has_items = |array: ExprId| matches!(hir[array].kind, ExprKind::Array(items) if !items.is_empty());
                // `[...[a], ...[]]` is `[a]`, and `[...[]]` stays as it is.
                let inlines_arrays = hir.ids(items).filter_map(spread_array).any(has_items);
                parts.extend(hir.ids(items).map(|item| {
                    let part = spread_array(item).filter(|_| inlines_arrays);
                    (TreeNode::Expr(part.unwrap_or(item)), rule)
                }));
                true
            }
            ExprKind::Call(call) | ExprKind::New(call) if hir[call].is_pure => {
                let arguments = hir.ids(hir[call].args);
                parts.extend(arguments.map(|argument| (TreeNode::Expr(argument), rule)));
                true
            }
            ExprKind::Object(props) => props.iter().all(|prop| {
                let prop = hir[prop];
                push(&[prop.value]);
                let is_key_computed = matches!(prop.key, PropKey::Computed(_))
                    || matches!(
                        prop.name_kind,
                        NameKind::ComputedString | NameKind::ComputedNumber
                    );
                prop.kind != PropKind::Spread && !is_key_computed
            }),
            _ => false,
        }
    }

    fn is_always_string(&self, e: ExprId) -> bool {
        matches!(
            self.hir[e].kind,
            ExprKind::String(_)
                | ExprKind::Unary {
                    op: UnOp::Typeof,
                    ..
                }
        )
    }

    /// `is_primitive_with_side_effects`
    fn is_always_primitive(&self, e: ExprId) -> bool {
        let hir = self.hir;
        let mut pending = vec![e];
        while let Some(e) = pending.pop() {
            match hir[hir.skip_type_assertions(e)].kind {
                ExprKind::Null
                | ExprKind::True
                | ExprKind::False
                | ExprKind::Number(_)
                | ExprKind::String(_)
                | ExprKind::BigInt(_)
                | ExprKind::Unary { .. } => {}
                ExprKind::Binary { op, left, right } => match op {
                    BinOp::And | BinOp::Or | BinOp::Nullish => pending.extend([left, right]),
                    BinOp::Comma => pending.push(right),
                    _ => {}
                },
                ExprKind::Cond { branches, .. } => {
                    let branches = hir.branches(branches);
                    pending.extend([branches.yes, branches.no]);
                }
                _ => return false,
            }
        }
        true
    }
}

fn binds_a_name(hir: &File<'_>, pattern: PatId) -> bool {
    match hir[pattern].kind {
        PatKind::Missing => false,
        PatKind::Ident(_) => true,
        PatKind::Object(props) => (props.iter()).any(|prop| binds_a_name(hir, hir[prop].value)),
        PatKind::Array(elements) => {
            (elements.iter()).any(|element| binds_a_name(hir, hir[element].pat))
        }
    }
}

/// What declares a `var` stays, because the name is visible outside.
pub fn is_removed_where_never_run(hir: &File<'_>, statement: StmtId) -> bool {
    let is_removed = |part: StmtId| part.is_none() || is_removed_where_never_run(hir, part);
    match hir[statement].kind {
        StmtKind::Empty
        | StmtKind::Debugger
        | StmtKind::Expr(_)
        | StmtKind::Class(_)
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Enum(_)
        | StmtKind::Return(_)
        | StmtKind::Throw(_)
        | StmtKind::Break(_)
        | StmtKind::Continue(_) => true,
        StmtKind::Var(declarations) => declarations.iter().all(|declaration| {
            let declaration = hir[declaration];
            declaration.kind != VarKind::Var || !binds_a_name(hir, declaration.pat)
        }),
        StmtKind::Fn(function) => {
            !(hir[function].flags).intersects(Flags::ASYNC | Flags::GENERATOR)
        }
        StmtKind::Block(list) => hir.ids(list).all(is_removed),
        StmtKind::If { yes, no, .. } => is_removed(yes) && is_removed(no),
        StmtKind::While { body, .. }
        | StmtKind::DoWhile { body, .. }
        | StmtKind::Labeled { body, .. } => is_removed(body),
        StmtKind::For { init, body, .. } => is_removed(init) && is_removed(body),
        StmtKind::ForIn { left, body, .. } | StmtKind::ForOf { left, body, .. } => {
            is_removed(left) && is_removed(body)
        }
        StmtKind::Try {
            block,
            handler,
            finalizer,
            ..
        } => is_removed(block) && is_removed(handler) && is_removed(finalizer),
        _ => false,
    }
}
