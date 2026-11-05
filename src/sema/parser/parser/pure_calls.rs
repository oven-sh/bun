use crate::pragmas::{CommentMark, comment_marks};
use bun_sema::hir::*;

#[cfg(test)]
mod tests;

fn has_annotation(comment: &Comment, text: &[u8]) -> bool {
    comment_marks(text, comment).any(|mark| mark == CommentMark::Pure)
}

fn annotated_token_starts(comments: &[Comment], text: &[u8]) -> Vec<u32> {
    let mut starts = Vec::new();
    for comment in comments {
        let token = comment.next_token_start;
        if starts.last() != Some(&token) && has_annotation(comment, text) {
            starts.push(token);
        }
    }
    starts
}

fn is_chain_link(kind: &ExprKind) -> bool {
    matches!(
        kind,
        ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Call(_)
            | ExprKind::New(_)
            | ExprKind::TaggedTemplate(_)
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
    )
}

fn previous_link(file: &FileBuilder, link: ExprId) -> Option<ExprId> {
    let previous = match file.exprs.get(link.idx())?.kind {
        ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
            file.calls.get(call.idx())?.callee
        }
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
        ExprKind::NonNull(inner) | ExprKind::Instantiation { expr: inner, .. } => inner,
        _ => return None,
    };
    let is_in_parentheses = file.expr_flags(previous).contains(ExprFlags::PARENTHESIZED);
    (previous.is_some() && !is_in_parentheses).then_some(previous)
}

fn mark_chain(file: &mut FileBuilder, chain_end: ExprId) {
    let kind_of = |file: &FileBuilder, e: ExprId| file.exprs.get(e.idx()).map(|it| it.kind);
    let mut link = chain_end;
    while let Some(ExprKind::NonNull(inner) | ExprKind::Instantiation { expr: inner, .. }) =
        kind_of(file, link)
    {
        link = inner;
    }
    if !matches!(
        kind_of(file, link),
        Some(ExprKind::Call(_) | ExprKind::New(_))
    ) {
        return;
    }
    loop {
        if let Some(ExprKind::Call(call) | ExprKind::New(call)) = kind_of(file, link)
            && let Some(call) = file.calls.get_mut(call.idx())
        {
            call.is_pure = true;
        }
        match previous_link(file, link) {
            Some(previous) => link = previous,
            None => return,
        }
    }
}

fn start_with_parentheses(file: &FileBuilder, e: ExprId) -> u32 {
    match parentheses_around(file, e).last() {
        Some(outermost) => outermost.1,
        None => file.exprs.get(e.idx()).map_or(0, |it| it.pos),
    }
}

fn operand_of_leading_cast(file: &FileBuilder, text: &[u8], cast: &Expr) -> Option<ExprId> {
    let (ExprKind::As { expr: operand, .. } | ExprKind::AsConst(operand)) = cast.kind else {
        return None;
    };
    let is_leading = text.get(cast.pos as usize) == Some(&b'<')
        && cast.pos < start_with_parentheses(file, operand);
    is_leading.then_some(operand)
}

pub(super) fn mark_pure_calls(file: &mut FileBuilder, text: &[u8]) {
    let starts = annotated_token_starts(&file.comments, text);
    if starts.is_empty() {
        return;
    }
    let mut chain_ends = vec![ExprId::NONE; starts.len()];
    let mut starts_behind_casts = Vec::new();
    for (index, expr) in file.exprs.iter().enumerate() {
        if is_chain_link(&expr.kind) {
            if let Ok(at) = starts.binary_search(&expr.pos) {
                chain_ends[at] = ExprId(index as u32);
            }
        } else if let Some(operand) = operand_of_leading_cast(file, text, expr) {
            starts_behind_casts.push(start_with_parentheses(file, operand));
            if let Ok(at) = starts.binary_search(&expr.pos) {
                chain_ends[at] = file.skip_type_assertions(operand);
            }
        }
    }
    for &(inner, open, _) in &file.parens {
        if let Ok(at) = starts.binary_search(&open)
            && chain_ends[at].is_none()
        {
            chain_ends[at] = file.skip_type_assertions(inner);
        }
    }
    for start in starts_behind_casts {
        if let Ok(at) = starts.binary_search(&start) {
            chain_ends[at] = ExprId::NONE;
        }
    }
    for chain_end in chain_ends {
        mark_chain(file, chain_end);
    }
}
