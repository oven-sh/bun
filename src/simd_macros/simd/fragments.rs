//! rustc ignores the invisible groups of macro_rules once they have been here. So they go, or become visible where they keep tokens together.
use super::*;

const JUMPS: &str = "if match while loop return break continue move async yield become do";
/// The tokens outside of generic arguments.
fn outermost(v: &[T]) -> Vec<usize> {
    let (mut all, mut i) = (vec![], 0);
    while i < v.len() {
        let path = |k: usize| at(v, k, |t| joint(t, ':')) && at(v, k + 1, |t| p(t, ':'));
        let close = |from: usize| (from..v.len()).find(deep(v, |_, depth| depth == 0));
        let value = |k: usize| match &v[k] {
            t if p(t, '&') || p(t, '*') => {
                !matches!(v[k - 1], T::Punct(_)) && !is(&v[k - 1], "mut const") && !p(&v[k - 2], '\'')
                    || p(&v[k - 1], '?')
                    || p(&v[k - 1], '>') && !joint(&v[k - 2], '-')
            }
            T::Punct(it) => ".|%/^".contains(it.as_char()),
            t => is(t, JUMPS),
        };
        // In a type, the second < starts a path.
        let shift = || p(&v[i + 1], '<') && !close(i + 1).is_some_and(|k| path(k + 1));
        let turbofish = i > 1 && path(i - 2) || i > 0 && is(&v[i - 1], "for");
        let generic = |&end: &usize| {
            let last = end + 1 == v.len() || path(end + 1) || p(&v[end + 1], '+') || g(&v[end + 1], D::Brace);
            turbofish || last && !shift() && !(i + 1..end).any(value)
        };
        match close(i).filter(|_| p(&v[i], '<')).filter(generic) {
            Some(end) => i = end + 1,
            None => {
                all.push(i);
                i += 1
            }
        }
    }
    all
}
pub(super) fn simple(v: &[T]) -> bool {
    v.iter().all(|t| matches!(t, T::Ident(_)) || p(t, ':'))
}
/// An item, or a lifetime.
fn whole(v: &[T]) -> bool {
    matches!(v, [.., it] if p(it, ';')) || matches!(v, [it, _] if p(it, '\''))
}
/// What is added has the place of the variable, where rustc doesn't report parentheses as unused.
fn placed(text: &str, at: &T) -> V {
    let one = |mut t: T| {
        t.set_span(at.span());
        t
    };
    trees(text.parse().unwrap()).into_iter().map(one).collect()
}
/// Whether it needs parentheses between these tokens.
fn loose(v: &[T], before: &[T], after: &[T]) -> bool {
    let (first, last, left, right) = (&v[0], &v[v.len() - 1], before.last(), after.first());
    let word = |i: usize, words: &str| at(v, i, |t| is(t, words));
    let named = at(v, 1, |t| matches!(t, T::Ident(_))) && !word(1, "as move");
    let rules = word(0, "macro_rules") && at(v, 1, |t| p(t, '!')) && at(v, 2, |t| matches!(t, T::Ident(_)));
    if word(0, "pub let struct enum trait mod") || rules || whole(v) {
        return false;
    }
    if p(first, '#') {
        return loose(&v[2..], before, after);
    }
    if g(last, D::Brace)
        && (word(0, "impl extern") && !called(&v[..v.len() - 1])
            || named && word(0, "fn union const unsafe async auto macro"))
    {
        return false;
    }
    let binds = |t: &T| matches!(t, T::Punct(it) if !";,#'$".contains(it.as_char())) || is(t, "as");
    let postfix =
        right.is_some_and(|t| p(t, '.') && !joint(t, '.') || p(t, '?') || g(t, D::Parenthesis) || g(t, D::Bracket));
    let statement = left.is_none_or(|t| p(t, ';') || g(t, D::Brace) || g(t, D::Bracket));
    let block = g(first, D::Brace)
        || p(first, '\'')
        || word(0, "if match while for loop unsafe const") && !at(v, 1, |t| p(t, '<') && is(first, "for"));
    let call =
        matches!(v, [path @ .., bang, _] if p(bang, '!') && g(last, D::Brace) && !path.is_empty() && simple(path));
    let outer = outermost(v);
    if statement && call {
        return postfix || right.is_some_and(binds);
    }
    if statement && block {
        // One block ends a statement, as it does for rustc.
        let goes_on = |t: &T| binds(t) && !(p(t, '=') && !joint(t, '=')) || g(t, D::Parenthesis) || g(t, D::Bracket);
        let ends =
            |&i: &usize| g(&v[i], D::Brace) && at(v, i + 1, goes_on) && !(i > 0 && word(i - 1, "if while match in"));
        return !g(last, D::Brace) || outer.iter().any(ends);
    }
    if v.len() == 1 && g(first, D::Brace) {
        return left.is_some_and(|t| p(t, '=')) && right.is_some_and(|t| is(t, "else"))
            || left.is_some_and(|t| p(t, '.')) && right.is_some_and(|t| g(t, D::Brace));
    }
    let prefix = v.iter().take_while(|t| "&*-!".chars().any(|c| p(t, c)) || is(t, "mut ref const dyn impl")).count();
    let arrow =
        |i: usize| joint(&v[i], '-') && at(v, i + 1, |t| p(t, '>')) || i > 0 && joint(&v[i - 1], '-') && p(&v[i], '>');
    let operator = |&i: &usize| match &v[i] {
        T::Punct(it) => match it.as_char() {
            '.' => joint(&v[i], '.'),
            '!' => !at(v, i + 1, |t| matches!(t, T::Group(_))),
            c => !":?'$".contains(c) && !arrow(i),
        },
        t => is(t, JUMPS) || is(t, "as") || g(t, D::Brace),
    };
    if !outer.iter().filter(|&&i| i >= prefix).any(operator) {
        let unary = prefix > 0 || word(0, "fn for unsafe extern") || outer.iter().any(|&i| arrow(i));
        let shifts = (p(last, '>') || left.is_some_and(|t| is(t, "as"))) && right.is_some_and(|t| p(t, '<'));
        let binding = word(0, "mut ref") && left.is_some_and(|t| p(t, '&'));
        let field = matches!(v, [.., dot, _] if p(dot, '.')) && right.is_some_and(|t| g(t, D::Parenthesis));
        return unary && postfix || shifts || binding || field;
    }
    let alone = |v: &[T], c: char| matches!(v, [.., a, b] if p(b, c) && !matches!(a, T::Punct(it) if it.spacing() == Spacing::Joint));
    let arrow = matches!(before, [.., a, b] if (joint(a, '-') || joint(a, '=')) && p(b, '>'));
    let starts = statement || arrow || alone(before, '=') || alone(before, ':') || left.is_some_and(|t| p(t, ','));
    let ends = right.is_none_or(|t| p(t, ',') || p(t, ';'));
    let arm =
        (statement || left.is_some_and(|t| p(t, ','))) && matches!(after, [a, b, ..] if joint(a, '=') && p(b, '>'));
    let tested = matches!(before, [.., a, b] if (is(a, "if while") || p(a, '&')) && is(b, "let"));
    !(arm || tested || starts && ends)
}
/// The tokens of a body. At its end, rustc would report the braces of a fragment as unused.
pub(super) fn statements(body: &T) -> V {
    let T::Group(it) = body else { panic!() };
    let (mut v, raw) = (within(body), it.raw());
    if let [before @ .., t] = raw
        && g(t, D::None)
        && matches!(&within(t)[..], [it] if g(it, D::Brace))
        && before.last().is_none_or(|t| p(t, ';') || g(t, D::Brace))
    {
        v.splice(v.len() - 1..v.len() - 1, q("#[cfg(true)]", &[]));
    }
    v
}
pub(super) fn open(s: &[T]) -> V {
    opened(s, false)
}
/// For a macro, which can't look into a fragment.
pub(super) fn given_to_macro(t: &T) -> V {
    if let T::Group(it) = t { opened(it.raw(), true) } else { vec![] }
}
/// The tokens of group i, to write others among them.
pub(super) fn written_in(v: &[T], i: usize) -> V {
    if called(&v[..i]) { given_to_macro(&v[i]) } else { within(&v[i]) }
}
fn opened(all: &[T], closed: bool) -> V {
    let mut out = V::new();
    for (i, t) in all.iter().enumerate() {
        if !g(t, D::None) {
            // The macro can look into these.
            let T::Group(it) = t else {
                out.push(t.clone());
                continue;
            };
            let list = || it.delimiter() != D::Brace || it.raw().len() == 1;
            let attribute = matches!(&out[..], [.., a] | [.., a, T::Punct(_)] if p(a, '#'));
            let inner = called(&out) && !is(&out[out.len() - 2], OF_EXPRESSIONS);
            let deep = closed && list() && !attribute && !inner && first(it.raw(), &|t| g(t, D::None)).is_some();
            out.push(if deep { regroup(t, opened(it.raw(), true)) } else { t.clone() });
            continue;
        }
        let (mut v, after) = (within(t), &all[i + 1..]);
        // rustc takes the comma after an expression with an attribute along.
        v.pop_if(|t| p(t, ','));
        if let Some(T::Punct(it)) = out.last_mut() {
            let span = it.span();
            *it = Punct::new(it.as_char(), Spacing::Alone);
            it.set_span(span)
        }
        let outer = outermost(&v);
        let path = outer.iter().all(|&i| simple(&v[i..=i]) && !is(&v[i], "dyn impl for"));
        let simple = simple(&v);
        // A path that is called, or names a struct.
        for i in outer.into_iter().rev().filter(|_| path) {
            if !p(&v[i], ':') && !is(&v[i], "as") && !is(&v[i], JUMPS) && at(&v, i + 1, |t| p(t, '<')) {
                v.splice(i + 1..i + 1, placed("::", t));
            }
        }
        let attributes = v.chunks(2).take_while(|it| p(&it[0], '#')).count();
        let apart = !simple || v.iter().any(|t| is(t, "as") || is(t, JUMPS));
        let kept = whole(&v) || at(&v, 2 * attributes, |t| is(t, "let pub extern"));
        if !v.is_empty() && (loose(&v, &out, after) || closed && apart && item(&v).is_none() && v.len() > 1 && !kept) {
            out.push(regroup(&placed("()", t)[0], v))
        } else {
            out.extend(v)
        }
    }
    out
}
