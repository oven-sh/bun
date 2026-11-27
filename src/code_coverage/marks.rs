//! What the printer does as it prints, for code that is not printed.

use bun_ast::coverage::Role;
use bun_sema::hir::{
    BinOp, CaseId, ExprId, ExprKind, File, FnBody, FnId, Node, NodeData, Part, StmtId, StmtKind,
    end_of_expr, start_of,
};

use crate::locs::{self, starts_with, token_after};

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Target {
    File,
    Statement(StmtId),
    Expression(ExprId),
    FirstOperandOf(ExprId),
    Case(CaseId),
    /// Its body.
    Function(FnId),
    /// The `?.` after it.
    Chain(ExprId),
}

impl Target {
    /// Where JavaScriptCore looks for its counters.
    pub(crate) fn offset(self, hir: &File<'_>) -> u32 {
        match self {
            Target::File => 0,
            Target::Statement(s) => match (hir[s].kind, hir.text.get(hir[s].start as usize)) {
                (StmtKind::Block(_), Some(b'f')) => locs::of_finally_block(hir, &hir.text, s),
                _ => hir[s].start,
            },
            Target::Expression(e) => start_of(hir, e),
            Target::FirstOperandOf(e) => hir[e].pos,
            Target::Case(case) => hir[case].pos,
            Target::Function(function) => match hir[function].body {
                FnBody::Expr(e) => start_of(hir, e),
                _ => locs::of_function_block(hir, function).unwrap_or(u32::MAX),
            },
            Target::Chain(base) => token_after(&hir.text, end_of_expr(hir, base)),
        }
    }
}

#[derive(Clone, Copy)]
enum Start {
    /// That of the expression around it, which has this `loc`.
    Shared(u32),
    CanCount,
    /// See `JSC::CoverageCounters::Event::Reached`.
    CannotCount,
}

/// `is_replaced`: nothing in the expression runs.
pub fn mark_nodes(
    hir: &File<'_>,
    is_replaced: &dyn Fn(ExprId) -> bool,
    mark: &mut dyn FnMut(Role, u32, Target),
) {
    mark(Role::File, 0, Target::File);
    let mut nodes = vec![(Node::FILE, Start::CanCount)];
    while let Some((node, start)) = nodes.pop() {
        let (mut first, mut others) = (None, Start::CanCount);
        match hir.data(node) {
            NodeData::Stmt(s) => mark_statement(hir, s, mark),
            NodeData::Case(case) => {
                mark(Role::Case, hir[case].pos, Target::Case(case));
                others = Start::CannotCount;
            }
            NodeData::Paren(_) => others = start,
            NodeData::Part(Part::Base, _) => others = Start::CannotCount,
            NodeData::Expr(e) => {
                let loc = match start {
                    Start::Shared(loc) => loc,
                    _ => locs::of_expression(hir, e),
                };
                if let Start::CanCount = start {
                    mark(Role::Expression, loc, Target::Expression(e));
                }
                if is_replaced(e) {
                    continue;
                }
                let operand = starts_with(hir, e);
                first = operand.map(|it| (hir.child(it), Start::Shared(loc)));
                if let Some((loc, base)) = locs::of_optional_link(hir, e).zip(operand) {
                    mark(Role::Chain, loc, Target::Chain(base));
                }
                match hir[e].kind {
                    ExprKind::Binary { op, .. } => match op {
                        BinOp::And | BinOp::Or | BinOp::Nullish => {
                            mark(Role::FirstOperand, loc, Target::FirstOperandOf(e));
                        }
                        BinOp::Comma => {}
                        _ => others = Start::CannotCount,
                    },
                    ExprKind::Unary { .. }
                    | ExprKind::Await(_)
                    | ExprKind::Array(_)
                    | ExprKind::Index { .. }
                    | ExprKind::Assign {
                        op: Some(BinOp::Add),
                        ..
                    } => others = Start::CannotCount,
                    // `f.apply(a, [b])`
                    ExprKind::Call(it)
                        if matches!(hir[hir[it].callee].kind, ExprKind::Dot { .. }) =>
                    {
                        others = Start::CannotCount;
                    }
                    ExprKind::New(call) => {
                        first = Some((hir.child(hir[call].callee), Start::CannotCount));
                    }
                    _ => {}
                }
            }
            _ => {}
        }
        if let Some(function) = hir.function_of(node).some() {
            mark_function(hir, function, mark);
        }
        let children = nodes.len();
        hir.for_each_child(node, &mut |child| {
            nodes.push(first.filter(|it| it.0 == child).unwrap_or((child, others)));
            false
        });
        nodes[children..].reverse();
    }
}

fn mark_statement(hir: &File<'_>, s: StmtId, mark: &mut dyn FnMut(Role, u32, Target)) {
    let loc = locs::of_statement(hir, &hir.text, s);
    let mut mark = |role, loc, statement| mark(role, loc, Target::Statement(statement));
    mark(Role::Statement, loc, s);
    match hir[s].kind {
        StmtKind::Expr(e) => mark(Role::Expression, locs::of_expression(hir, e), s),
        StmtKind::Var(all) => {
            // What was an assignment to `exports`.
            mark(Role::Expression, loc, s);
            if let Some(first) = all.iter().find_map(|it| hir[it].init.some()) {
                mark(Role::Expression, locs::of_expression(hir, first), s);
            }
        }
        StmtKind::If { yes: body, .. }
        | StmtKind::For { body, .. }
        | StmtKind::ForIn { body, .. }
        | StmtKind::ForOf { body, .. }
        | StmtKind::While { body, .. }
        | StmtKind::DoWhile { body, .. } => mark(Role::Guarded, loc, body),
        _ => {}
    }
}

fn mark_function(hir: &File<'_>, id: FnId, mark: &mut dyn FnMut(Role, u32, Target)) {
    let target = Target::Function(id);
    if let Some(brace) = locs::of_function_block(hir, id) {
        mark(Role::Body, brace, target);
    }
    mark(Role::Body, hir[id].anchor, target);
    mark(Role::Body, hir[id].text_start, target);
}
