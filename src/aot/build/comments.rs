use bun_core::strings;
use bun_sema::bind::Bound;
use bun_sema::check::spans::skip_trivia;
use bun_sema::hir::{self, ExprId, ExprKind, FnBody, FnKind, PropKind, StmtKind};
use std::cmp::Reverse;

fn is_pure_annotation(comment: &[u8]) -> bool {
    let is_sign = |byte: &u8| matches!(byte, b'@' | b'#');
    if let Some(written) = comment.strip_prefix(b"//") {
        return written.iter().position(is_sign).is_some_and(|at| {
            strings::is_all_whitespace(&written[..at])
                && strings::has_prefix_with_word_boundary(&written[at + 1..], b"__PURE__")
        });
    }
    let Some(mut rest) = comment
        .strip_suffix(b"*/")
        .filter(|_| comment.starts_with(b"/*"))
    else {
        return false;
    };
    while let Some(at) = rest.iter().position(is_sign) {
        rest = &rest[at + 1..];
        if strings::has_prefix_with_word_boundary(rest, b"__PURE__") {
            return true;
        }
    }
    false
}

fn skip_type_assertions(hir: &hir::File<'_>, mut e: ExprId) -> ExprId {
    while let ExprKind::As { expr: operand, .. }
    | ExprKind::Satisfies { expr: operand, .. }
    | ExprKind::AsConst(operand)
    | ExprKind::NonNull(operand) = hir[e].kind
    {
        e = operand;
    }
    e
}

fn start_including_parens(hir: &hir::File<'_>, e: ExprId) -> u32 {
    hir::parentheses_around(hir, e)
        .last()
        .map_or(hir[e].pos, |outermost| outermost.1)
}

pub(crate) fn calls_marked_pure(hir: &hir::File<'_>) -> Vec<u32> {
    let text: &[u8] = &hir.text;
    if !strings::contains(text, b"__PURE__") {
        return Vec::new();
    }
    let next_token = |at: u32| skip_trivia(text, at as usize) as u32;
    let mut marked: Vec<u32> = hir
        .comments
        .iter()
        .filter(|comment| is_pure_annotation(&text[comment.pos as usize..comment.end as usize]))
        .map(|comment| next_token(comment.end))
        .collect();
    marked.sort_unstable();
    marked.dedup();
    let prefix_casts: Vec<(u32, ExprId, u32)> = (hir.exprs.iter())
        .filter_map(|e| match e.kind {
            ExprKind::As { expr: operand, .. } | ExprKind::AsConst(operand) => {
                Some((e.pos, operand, start_including_parens(hir, operand)))
            }
            _ => None,
        })
        .filter(|&(cast, _, operand)| cast < operand)
        .collect();
    marked.retain(|token| !prefix_casts.iter().any(|cast| cast.2 == *token));
    let mut for_head_starts: Vec<u32> = (hir.stmts.iter())
        .filter_map(|statement| match statement.kind {
            StmtKind::For { init, .. } => Some(init.0),
            _ => None,
        })
        .collect();
    for_head_starts.sort_unstable();
    for (i, statement) in hir.stmts.iter().enumerate() {
        let StmtKind::Expr(e) = statement.kind else {
            continue;
        };
        let Ok(at) = marked.binary_search(&start_including_parens(hir, e)) else {
            continue;
        };
        let is_word = |word: &'static [u8]| {
            strings::has_prefix_with_word_boundary(&text[marked[at] as usize..], word)
        };
        if is_word(b"using")
            || is_word(b"async") && for_head_starts.binary_search(&(i as u32)).is_err()
        {
            marked.remove(at);
        }
    }
    let mut chains = vec![ExprId::NONE; marked.len()];
    let mut whole_ranges = vec![ExprId::NONE; marked.len()];
    for (i, e) in hir.exprs.iter().enumerate() {
        let Ok(at) = marked.binary_search(&e.pos) else {
            continue;
        };
        match e.kind {
            ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Call(_)
            | ExprKind::New(_)
            | ExprKind::TaggedTemplate(_)
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. } => {
                if chains[at].is_none() || hir[chains[at]].end < e.end {
                    chains[at] = ExprId(i as u32);
                }
            }
            _ => {}
        }
    }
    for &(cast, operand, _) in &prefix_casts {
        if let Ok(at) = marked.binary_search(&cast) {
            whole_ranges[at] = operand;
        }
    }
    for &(inner, open, _) in hir.parens.iter() {
        if let Ok(at) = marked.binary_search(&open) {
            whole_ranges[at] = inner;
        }
    }
    let mut calls: Vec<u32> = (chains.into_iter().zip(whole_ranges))
        .map(|(chain, whole)| if chain.is_some() { chain } else { whole })
        .filter(|e| e.is_some())
        .map(|e| skip_type_assertions(hir, e))
        .filter(|&e| matches!(hir[e].kind, ExprKind::Call(_) | ExprKind::New(_)))
        .map(|e| e.0)
        .collect();
    calls.sort_unstable();
    calls.dedup();
    calls
}

fn parse_react_hooks_suppression(comment: &[u8]) -> Option<bool> {
    let written = if comment.starts_with(b"/*") {
        comment.strip_suffix(b"*/").unwrap_or(comment)
    } else {
        comment
    };
    let after = &written[strings::index_of(written, b"eslint-disable")? + "eslint-disable".len()..];
    let is_word_end = |rest: &[u8]| rest.first().is_none_or(u8::is_ascii_whitespace);
    let (is_block, rules) = match after.strip_prefix(b"-next-line") {
        Some(rules) => (false, rules),
        None => (true, after),
    };
    let is_rule_name = strings::contains(rules, b"react-hooks/rules-of-hooks")
        || strings::contains(rules, b"react-hooks/exhaustive-deps");
    (is_word_end(rules) && is_rule_name).then_some(is_block)
}

fn is_inside_jsx_tag(hir: &hir::File<'_>, token: u32) -> bool {
    let mut innermost = (0, false);
    let mut look_at = |start: u32, end: u32, is_of_a_tag: bool| {
        if start < token && token < end && innermost.0 <= start {
            innermost = (start, is_of_a_tag);
        }
    };
    for e in hir.exprs.iter() {
        let ExprKind::Jsx(element) = e.kind else {
            continue;
        };
        let element = &hir[element];
        look_at(e.pos, element.opening_end, true);
        if element.close_pos != u32::MAX {
            look_at(element.close_pos, element.end, true);
        }
        let mut arguments = hir.ids(element.type_args);
        if let Some(first) = arguments.next() {
            let last = arguments.next_back().unwrap_or(first);
            look_at(
                hir[first].pos - 1,
                skip_trivia(&hir.text, hir[last].end as usize) as u32 + 1,
                false,
            );
        }
        for attribute in element
            .attrs
            .iter()
            .filter(|&attribute| hir[attribute].kind == PropKind::Spread)
        {
            look_at(hir[attribute].start, hir[attribute].end, false);
        }
    }
    for &(_, open, end) in hir.jsx_expressions.iter() {
        look_at(open, end, false);
    }
    innermost.1
}

fn is_nested_only_in_function_bodies(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    mut func: usize,
) -> bool {
    loop {
        let around = bound.fns[func].enclosing;
        if around.is_none() {
            return true;
        }
        let enclosing_body = hir
            .body_starts
            .binary_search_by_key(&around.0, |body| body.0.0)
            .ok()
            .map(|at| hir.body_starts[at].1);
        if hir.fns[around.idx()].kind == FnKind::Arrow
            || enclosing_body.is_none_or(|body| body <= hir.fns[func].start)
        {
            return false;
        }
        func = around.idx();
    }
}

pub(crate) fn functions_with_react_hooks_suppression(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
) -> Vec<u32> {
    let text: &[u8] = &hir.text;
    if !strings::contains(text, b"eslint-disable") {
        return Vec::new();
    }
    let suppressions: Vec<(u32, bool)> = (hir.comments.iter())
        .filter_map(|comment| {
            Some((
                comment,
                parse_react_hooks_suppression(&text[comment.pos as usize..comment.end as usize])?,
            ))
        })
        .filter(|(comment, _)| {
            !is_inside_jsx_tag(hir, skip_trivia(text, comment.end as usize) as u32)
        })
        .map(|(comment, is_block)| (comment.pos, is_block))
        .collect();
    if suppressions.is_empty() {
        return Vec::new();
    }
    let mut ends = vec![0u32; hir.fns.len()];
    for e in hir.exprs.iter() {
        if let ExprKind::Fn(func) = e.kind {
            ends[func.idx()] = e.end;
        }
    }
    for statement in hir.stmts.iter() {
        if let StmtKind::Fn(func) = statement.kind {
            ends[func.idx()] = statement.loc.end;
        }
    }
    for member in hir.members.iter().filter(|member| member.func.is_some()) {
        ends[member.func.idx()] = member.loc.end;
    }
    let has_closing_body =
        |func: &hir::Func| !matches!(func.body, FnBody::None) && func.kind != FnKind::StaticBlock;
    let mut closing: Vec<(u32, Reverse<u32>, u32)> = (hir.fns.iter().enumerate())
        .filter(|&(i, func)| ends[i] != 0 && has_closing_body(func))
        .map(|(i, func)| (ends[i], Reverse(func.start), i as u32))
        .collect();
    closing.sort_unstable();
    let (mut seen, mut is_pending, mut is_for_the_rest) = (0, false, false);
    let mut found = Vec::new();
    for (end, _, func) in closing {
        let next_token = skip_trivia(text, end as usize) as u32;
        while let Some(&(_, is_block)) = suppressions
            .get(seen)
            .filter(|suppression| suppression.0 < next_token)
        {
            is_pending = true;
            is_for_the_rest |= is_block;
            seen += 1;
        }
        if is_pending || is_for_the_rest {
            found.push(func);
            if is_nested_only_in_function_bodies(hir, bound, func as usize) {
                is_pending = false;
            }
        }
    }
    found.sort_unstable();
    found
}
