use bun_sema::hir::{self, ExprId, ExprKind, FnId};

#[inline]
pub(crate) fn skip_assertions(hir: &hir::File<'_>, mut e: ExprId) -> ExprId {
    loop {
        e = match hir[e].kind {
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::NonNull(expr) => expr,
            _ => return e,
        };
    }
}

#[inline]
pub(crate) fn access_pos(hir: &hir::File<'_>, e: ExprId) -> u32 {
    match hir[skip_assertions(hir, e)].kind {
        ExprKind::Dot { name_pos, .. } => name_pos,
        ExprKind::Index { index, .. } => hir[index].pos,
        _ => hir[e].pos,
    }
}

#[inline]
pub(crate) fn object_pos(hir: &hir::File<'_>, e: ExprId) -> u32 {
    match hir[skip_assertions(hir, e)].kind {
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }
            if !matches!(hir[obj].kind, ExprKind::Super) =>
        {
            last_pos(hir, obj)
        }
        _ => access_pos(hir, e),
    }
}

#[inline]
pub(crate) fn last_pos(hir: &hir::File<'_>, e: ExprId) -> u32 {
    let e = skip_assertions(hir, e);
    match hir[e].kind {
        ExprKind::Dot { name_pos, .. } => name_pos,
        ExprKind::Index { index, .. } => last_pos(hir, index),
        ExprKind::Binary { right, .. } => last_pos(hir, right),
        ExprKind::Assign { value, .. } => last_pos(hir, value),
        ExprKind::Cond { no, .. } => last_pos(hir, no),
        ExprKind::Unary {
            op: hir::UnOp::PostInc | hir::UnOp::PostDec,
            ..
        } => hir[e].end - 2,
        ExprKind::Unary { operand, .. } | ExprKind::Await(operand) | ExprKind::Spread(operand) => {
            last_pos(hir, operand)
        }
        ExprKind::New(call) if hir.text[hir[e].end as usize - 1] != b')' => {
            last_pos(hir, hir[call].callee)
        }
        ExprKind::Fn(func) => last_pos_in_function(hir, func).unwrap_or(hir[e].end - 1),
        ExprKind::Call(_)
        | ExprKind::New(_)
        | ExprKind::Array(_)
        | ExprKind::Object(_)
        | ExprKind::Class(_) => hir[e].end - 1,
        _ => hir[e].pos,
    }
}

#[inline]
pub(crate) fn last_pos_in_function(hir: &hir::File<'_>, func: FnId) -> Option<u32> {
    let last = match hir[func].body {
        hir::FnBody::Expr(body) => return Some(last_pos(hir, body)),
        hir::FnBody::Block(body) => hir.ids(body).last()?,
        hir::FnBody::None => return None,
    };
    match hir[last].kind {
        hir::StmtKind::Expr(value) | hir::StmtKind::Throw(value) => Some(last_pos(hir, value)),
        hir::StmtKind::Return(value) if value.is_some() => Some(last_pos(hir, value)),
        hir::StmtKind::Return(_) => Some(hir[last].start),
        _ => None,
    }
}
