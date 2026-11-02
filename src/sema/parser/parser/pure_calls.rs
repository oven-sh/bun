use bun_core::strings;
use bun_sema::hir::*;

#[cfg(test)]
mod tests;

fn has_annotation(comment: &Comment, text: &[u8]) -> bool {
    let closing = if comment.is_block { 2 } else { 0 };
    let (from, to) = (comment.pos as usize + 2, comment.end as usize);
    let mut rest = text
        .get(from..to.saturating_sub(closing))
        .unwrap_or_default();
    while let Some(sign) = strings::index_of_any(rest, b"@#") {
        let (before, after) = (&rest[..sign], &rest[sign + 1..]);
        if strings::has_prefix_with_word_boundary(after, b"__PURE__") {
            return comment.is_block || strings::is_all_whitespace(before);
        }
        if !comment.is_block {
            return false;
        }
        rest = after;
    }
    false
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

fn skip_opening_parentheses(text: &[u8], mut at: usize) -> usize {
    loop {
        let rest = text.get(at..).unwrap_or_default();
        at += match rest {
            [b'(' | b' ' | b'\t' | b'\n' | b'\r', ..] => 1,
            [b'/', b'*', ..] => match bun_core::strings::index_of(rest, b"*/") {
                Some(end) => end + 2,
                None => return at,
            },
            [b'/', b'/', ..] => match bun_core::strings::index_of_char_usize(rest, b'\n') {
                Some(end) => end,
                None => return at,
            },
            _ => return at,
        };
    }
}

fn find_chains_in_parentheses(
    file: &FileBuilder,
    text: &[u8],
    starts: &[u32],
    chain_ends: &mut [ExprId],
) {
    let mut inner_starts = Vec::new();
    for (at, &start) in starts.iter().enumerate() {
        if chain_ends[at].is_none() && text.get(start as usize) == Some(&b'(') {
            inner_starts.push((skip_opening_parentheses(text, start as usize) as u32, at));
        }
    }
    if inner_starts.is_empty() {
        return;
    }
    for (index, expr) in file.exprs.iter().enumerate() {
        let chain_end = ExprId(index as u32);
        if is_chain_link(&expr.kind)
            && file
                .expr_flags(chain_end)
                .contains(ExprFlags::PARENTHESIZED)
            && let Ok(found) = inner_starts.binary_search_by_key(&expr.pos, |it| it.0)
        {
            chain_ends[inner_starts[found].1] = chain_end;
        }
    }
}

pub(super) fn mark_pure_calls(file: &mut FileBuilder, text: &[u8]) {
    let starts = annotated_token_starts(&file.comments, text);
    if starts.is_empty() {
        return;
    }
    let mut chain_ends = vec![ExprId::NONE; starts.len()];
    for (index, expr) in file.exprs.iter().enumerate() {
        if is_chain_link(&expr.kind)
            && let Ok(at) = starts.binary_search(&expr.pos)
        {
            chain_ends[at] = ExprId(index as u32);
        }
    }
    find_chains_in_parentheses(file, text, &starts, &mut chain_ends);
    for chain_end in chain_ends {
        mark_chain(file, chain_end);
    }
}
