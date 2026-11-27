//! The `loc` that a node has in the tree of the transpiler.

use bun_sema::check::spans::skip_trivia;
use bun_sema::hir::{
    Chain, ExprId, ExprKind, FileIn, Flags, FnId, StmtId, StmtKind, Storage, UnOp,
};

pub(crate) fn token_after(text: &[u8], end: u32) -> u32 {
    skip_trivia(text, end as usize) as u32
}

/// The operand whose `loc` `e` has.
pub(crate) fn starts_with<S: Storage>(hir: &FileIn<S>, e: ExprId) -> Option<ExprId> {
    match hir[e].kind {
        ExprKind::Binary { left: it, .. }
        | ExprKind::Assign { target: it, .. }
        | ExprKind::Cond { test: it, .. }
        | ExprKind::Dot { obj: it, .. }
        | ExprKind::Index { obj: it, .. }
        | ExprKind::As { expr: it, .. }
        | ExprKind::Satisfies { expr: it, .. }
        | ExprKind::Instantiation { expr: it, .. }
        | ExprKind::AsConst(it)
        | ExprKind::NonNull(it)
        | ExprKind::Unary {
            op: UnOp::PostInc | UnOp::PostDec,
            operand: it,
        } => Some(it),
        ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => Some(hir[call].callee),
        _ => None,
    }
}

pub(crate) fn of_expression<S: Storage>(hir: &FileIn<S>, mut e: ExprId) -> u32 {
    while let Some(operand) = starts_with(hir, e) {
        e = operand;
    }
    hir[e].pos
}

pub(crate) fn of_statement<S: Storage>(hir: &FileIn<S>, text: &[u8], s: StmtId) -> u32 {
    let mut modifiers = hir.stmt_modifiers(s).iter().map(|it| hir[it]);
    let export = modifiers.clone().find(|it| it.kind.flag() == Flags::EXPORT);
    match (hir[s].kind, export) {
        (_, Some(export)) if modifiers.any(|it| it.kind.flag() == Flags::DEFAULT) => export.pos,
        (StmtKind::Class(class), _) => hir[class].text_start,
        (StmtKind::Enum(_) | StmtKind::Module(_), Some(export)) => {
            token_after(text, export.pos + "export".len() as u32)
        }
        _ => hir[s].start,
    }
}

pub(crate) fn of_function_block<S: Storage>(hir: &FileIn<S>, function: FnId) -> Option<u32> {
    let found = hir.body_starts.binary_search_by_key(&function, |it| it.0);
    Some(hir.body_starts[found.ok()?].1)
}

pub(crate) fn of_finally_block<S: Storage>(hir: &FileIn<S>, text: &[u8], finalizer: StmtId) -> u32 {
    token_after(text, hir[finalizer].start + "finally".len() as u32)
}

/// `None` if `link` does not start with `?.`.
pub(crate) fn of_optional_link<S: Storage>(hir: &FileIn<S>, link: ExprId) -> Option<u32> {
    match hir[link].kind {
        ExprKind::Dot {
            chain: Chain::Start,
            ..
        } => Some(hir.name_pos(link)),
        ExprKind::Index {
            index,
            chain: Chain::Start,
            ..
        } => Some(of_expression(hir, index)),
        ExprKind::Call(call) if hir[call].chain == Chain::Start => Some(hir[call].close_pos),
        _ => None,
    }
}
