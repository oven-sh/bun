//! Bodies.
use super::*;

/// Where the parameters of a closure end, if one starts here.
fn closure(v: &[T], i: usize) -> Option<usize> {
    let binder = v[..i].iter().rposition(|t| p(t, '<')).is_some_and(|k| k > 0 && is(&v[k - 1], "for"));
    let after = |t: &T| match t {
        T::Punct(it) => !"?|>.".contains(it.as_char()) || p(t, '>') && (i > 1 && joint(&v[i - 2], '=') || binder),
        T::Group(_) => i > 1 && p(&v[i - 2], '#'),
        t => is(t, "move mut return break in else"),
    };
    // A block ends the value of if let.
    let back = v[..i].iter().rposition(|t| is(t, "let") || p(t, ';') || g(t, D::Brace));
    let tested = back.is_some_and(|k| k > 0 && is(&v[k], "let") && (is(&v[k - 1], "if while") || p(&v[k - 1], '&')));
    let starts = p(&v[i], '|')
        && !tested
        && !at(v, i + 1, |t| matches!(t, T::Literal(_)))
        && (i == 0 || after(&v[i - 1]))
        && !(i > 1 && is(&v[i - 2], "async static const"));
    (i + 1..v.len()).find(|&k| p(&v[k], '|')).filter(|_| starts)
}
/// Where the expression that starts here ends.
pub(super) fn expression(v: &[T], mut i: usize) -> Option<usize> {
    let (mut depth, mut from, mut cast, mut closed) = (0, i, false, false);
    while i < v.len() && !(depth == 0 && (p(&v[i], ',') || p(&v[i], ';'))) {
        let after_value = !matches!(v[i - 1], T::Punct(_)) && !is(&v[i - 1], "as if match while return break in mut")
            || p(&v[i - 1], '?')
            || closed
            || cast && p(&v[i - 1], '>') && !joint(&v[i - 2], '-');
        let arrow = joint(&v[i], '-') && at(v, i + 1, |t| p(t, '>'));
        let operator = matches!(&v[i], T::Punct(it) if !":<'".contains(it.as_char())) && after_value && !arrow;
        cast = depth == 0 && is(&v[i], "as") || cast && (depth > 0 || !operator);
        let opens = cast || !after_value && !joint(&v[i - 1], '<');
        closed = depth == 1 && angle(v, i) < 0;
        if depth > 0 || opens {
            depth = (depth + angle(v, i)).max(0)
        }
        if joint(&v[i], '=') && at(v, i + 1, |t| p(t, '>')) {
            return None;
        }
        match closure(&v[from..], i - from) {
            Some(bar) => (i, from) = (from + bar + 1, from + bar + 1),
            None => i += 1,
        }
    }
    Some(i)
}
/// Where the block ends that follows the type of the result.
fn after_result(v: &[T], bar: usize) -> Option<usize> {
    let block = deep(v, |k, depth| depth == 0 && g(&v[k], D::Brace) && !called(&v[..k]));
    (bar..v.len()).find(block).map(|k| k + 1)
}
pub(super) const COROUTINE: &str = r#"CRATE::__core::compile_error! { "this can't have the instructions of the target: write it in a function without the attribute simd, and call a kernel" }"#;
/// A body, in which closures enter the target, and items are those of a module.
pub(super) fn body(v: &[T], list: &[T]) -> V {
    walked(v, list, Place::Other).unwrap_or(v.to_vec())
}
#[derive(Clone, Copy, PartialEq)]
enum Place {
    /// The arguments of a function.
    Call,
    /// Those of a macro, which can take apart what looks like a closure or an item.
    Macro,
    /// An array or its type, whose length is a constant.
    Array,
    Other,
}
pub(super) const OF_EXPRESSIONS: &str =
    "assert assert_eq assert_ne debug_assert debug_assert_eq debug_assert_ne dbg format format_args print println
    eprint eprintln write writeln panic vec pick";
/// Whether the name is in a pattern that can fail. Elsewhere rustc refuses a constant.
fn rebinds(v: &[T], name: &str, of_macro: &str) -> bool {
    fn binds(v: &[T], name: &str) -> bool {
        let apart = |i: usize| !at(v, i, |t| p(t, '.') || p(t, ':') || p(t, '='));
        let after = |i: usize| i == 0 || apart(i - 1) || colon(&v[i.max(2) - 2..i]).is_some();
        (0..v.len()).any(|i| is(&v[i], name) && after(i) && apart(i + 1) || binds(inside(&v[i]), name))
    }
    let pattern = |v: &[T]| binds(v.split(|t| is(t, "if")).next().unwrap(), name);
    let (mut start, arrow) = (0, |i: usize| at(v, i, |t| joint(t, '=')) && at(v, i + 1, |t| p(t, '>')));
    of_macro == "matches" && split(v).get(1).is_some_and(|it| pattern(it))
        || (0..v.len()).any(|i| {
            let (arm, bound) =
                (arrow(i), p(&v[i], '=') && start > 0 && is(&v[start - 1], "let") && !joint(&v[i - 1], '.'));
            let end = if arm { i } else { start + colon(&v[start..i]).unwrap_or(i - start) };
            let found = (arm && of_macro.is_empty() || bound) && pattern(&v[start..end]);
            let goes_on = at(v, i + 1, |t| p(t, '|') || p(t, '=') || is(t, "if")) && !arrow(i.wrapping_sub(2));
            if arm || bound || p(&v[i], ',') || p(&v[i], ';') || is(&v[i], "let") || g(&v[i], D::Brace) && !goes_on {
                start = i + 1
            }
            let called = if i > 1 && p(&v[i - 1], '!') { v[i - 2].to_string() } else { String::new() };
            found || rebinds(inside(&v[i]), name, if called == "unroll" { "" } else { &called })
        })
}
/// What a macro of a marked module writes comes here again.
pub(super) fn entered(body: &T) -> bool {
    let first = |t: &&T| inside(t).is_empty() || at(inside(t), 1, |t| is(t, "_It"));
    inside(body).iter().take_while(first).any(|t| is(t, "Entering"))
}
/// Nothing, if all stays as it is.
fn walked(v: &[T], list: &[T], place: Place) -> Option<V> {
    let (mut out, mut i, mut changed) = (V::new(), 0, false);
    while i < v.len() {
        if place == Place::Array && p(&v[i], ';') {
            out.extend_from_slice(&v[i..]);
            break;
        } else if place == Place::Other
            && (i == 0
                || p(&v[i - 1], ';')
                || g(&v[i - 1], D::Brace)
                || i > 2 && p(&v[i - 2], '!') && p(&v[i - 3], '#'))
            && let Some((it, n)) = item(&v[i..])
            && (it.is("macro_rules fn")
                || it.find("simd kernel").is_some()
                || !it.rest[..it.rest.len() - 1].iter().any(|t| t.to_string().contains('$')))
        {
            out.extend(match () {
                _ if it.is("use") => without_s(&v[i..i + n], false),
                // The attribute gets it when the macro has written it.
                _ if it.find("simd kernel").is_some() && first(&it.rest, &|t| p(t, '$')).is_some() => {
                    v[i..i + n].to_vec()
                }
                _ => marked(&it, false, None, list),
            });
            (i, changed) = (i + n, true);
        } else if place != Place::Macro
            && let Some(bar) = closure(v, i)
            && let typed = matches!(&v[bar + 1..], [a, b, ..] if joint(a, '-') && p(b, '>'))
            && let Some(end) = if typed { after_result(v, bar) } else { expression(v, bar + 1) }
        {
            let block = if typed { end - 1 } else { bar + 1 };
            if at(v, block, entered) {
                out.extend_from_slice(&v[i..end]);
                i = end;
                continue;
            }
            let result = &v[bar + 1..block];
            let mut start = out.len() - out.last().is_some_and(|t| is(t, "move")) as usize;
            if start > 1 && p(&out[start - 1], '>') && !joint(&out[start - 2], '=') {
                start = out.iter().rposition(|t| is(t, "for")).unwrap_or(start)
            }
            let before = out.split_off(start);
            // Stable Rust refuses the attribute here. It is written again below.
            if matches!(&out[..], [.., a, b, c] if p(a, '=') && p(b, '#') && c.to_string() == "[inline(always)]") {
                start -= 2;
                out.truncate(start)
            }
            let attribute = start > 1 && p(&out[start - 2], '#');
            let all = if v[i..bar].iter().any(|t| p(t, '$') || p(t, '#')) { vec![] } else { split(&v[i + 1..bar]) };
            // It has the hygiene of the pattern.
            let name = |k: usize| vec![Ident::new(&format!("__c{k}"), all[k][0].span()).into()];
            let head = commas(
                all.iter().enumerate().map(|(k, it)| [&name(k)[..], &it[colon(it).unwrap_or(it.len())..]].concat()),
            );
            let patterns = all.iter().map(|it| (it[..colon(it).unwrap_or(it.len())].to_vec(), None)).collect();
            let head = if all.is_empty() { &v[i + 1..bar] } else { &head };
            // The lifetimes of a binder have no name inside.
            let again = if names(&before, "for") { &[] } else { result };
            let rest = [again, &body(&v[block..end], list)].concat();
            // It can be behind dyn.
            let kept = names(&before, "move") || out.last().is_some_and(|t| p(t, '&') || is(t, "mut"));
            let lent: Vec<_> =
                all.iter().map(|it| kept && colon(it).is_none_or(|k| holds_vectors(&it[k + 1..]))).collect();
            let new = placed(v.get(block).unwrap_or(&v[bar]).span(), || {
                let call = entering("closure", &commas((0..all.len()).map(name)), &[], patterns, &rest, &lent);
                let [from, to] = [i, bar].map(|k| placed(v[k].span(), || q("|", &[])));
                q("__0 __1 __2 __3 { __4 __5 }", &[&from, head, &to, result, &home(), &call])
            });
            // The attribute needs no feature on an argument. Behind a reference, a call would hide the type that is expected.
            let template = match out.last() {
                _ if attribute => "__0 __1",
                Some(t) if p(t, '&') || is(t, "mut") => "__0 __1",
                it if place == Place::Call && it.is_none_or(|t| p(t, ',')) && v.get(end).is_none_or(|t| p(t, ',')) => {
                    "#[inline(always)] __0 __1"
                }
                _ => "CRATE::native::itself(#[inline(always)] __0 __1)",
            };
            out.extend(q(template, &[&before, &new]));
            (i, changed) = (end, true);
        } else if is(&v[i], "async gen") && at(v, i + 1, |t| g(t, D::Brace) || p(t, '|') || is(t, "move")) {
            out.extend(q(COROUTINE, &[]));
            i += 1 + is(&v[i + 1], "move") as usize;
            let bar = closure(&v[i..], 0);
            (i, changed) = (bar.and_then(|bar| expression(v, i + bar + 1)).unwrap_or(i + 1), true);
        } else {
            if let [a, _, b, ..] = &v[i..]
                && is(a, "unroll")
                && let [word, name, .., block] = &within(b)[..]
                && is(word, "for")
                && !is(name, "_")
                && rebinds(inside(block), &name.to_string(), "")
            {
                out.extend(error(
                    "the index of unroll! is a constant, and binds nothing in a pattern: take another name",
                ));
                (i, changed) = (i + 3, true);
                continue;
            }
            if let [a, b, _, c, ..] = &v[i..]
                && is(a, "Native")
                && joint(b, ':')
                && is(c, "BYTES")
                && !out.last().is_some_and(|t| p(t, ':'))
            {
                out.extend(q("(__0)", &[&error_at(a.span(), "the width has to say S: Native::<S>::BYTES")]));
                (i, changed) = (i + 4, true);
                continue;
            }
            let after = |back: usize, f: &dyn Fn(&T) -> bool| i >= back && f(&v[i - back]);
            let attribute = |back: usize| g(&v[i], D::Bracket) && after(back, &|t| p(t, '#'));
            // How far back `macro_rules` is, if these are its rules.
            let near = |t: &&T| !p(t, ';') && !g(t, D::Brace);
            let rules = v[..i].iter().rev().take(8).take_while(near).position(|t| is(t, "macro_rules"));
            let kept = after(1, &|t| is(t, "const"))
                || rules.is_some_and(|k| place == Place::Macro || !starts(&v[..i - 1 - k]))
                || after(2, &|t| is(t, "stringify"))
                || attribute(1)
                || attribute(2) && p(&v[i - 1], '!');
            let turbofish = || {
                let opens = deep(v, |_, depth| depth == 0);
                (1..i).rev().find(opens).is_some_and(|k| p(&v[k - 1], ':'))
            };
            let callee = |t: &T| match t {
                T::Ident(_) => {
                    !is(t, "return break in if match while let mut as")
                        && !after(2, &|t| p(t, '\'') || p(t, '@') || p(t, '$'))
                }
                t => p(t, '>') && turbofish() || p(t, '?') || g(t, D::Parenthesis) || g(t, D::Bracket),
            };
            let value = |t: &T| !matches!(t, T::Punct(_)) && !g(t, D::Brace);
            let place = match () {
                _ if after(1, &|t| p(t, '!')) && after(2, &|t| is(t, OF_EXPRESSIONS)) => Place::Other,
                _ if called(&v[..i]) => Place::Macro,
                // It goes on with an operator.
                _ if after(1, &|t| p(t, '$')) && after(2, &value) && at(inside(&v[i]), 0, |t| p(t, '|')) => {
                    Place::Macro
                }
                _ if place == Place::Macro && !g(&v[i], D::Brace) && !after(2, &|t| p(t, '.')) => Place::Macro,
                _ if g(&v[i], D::Parenthesis) && after(1, &callee) => Place::Call,
                _ if g(&v[i], D::Bracket) => Place::Array,
                _ => Place::Other,
            };
            let inner = if place == Place::Macro { given_to_macro(&v[i]) } else { within(&v[i]) };
            let before = IN_MACRO.replace(IN_MACRO.get() || place == Place::Macro);
            let new = if kept { None } else { walked(&inner, list, place) };
            IN_MACRO.set(before);
            changed |= new.is_some();
            out.push(new.map_or(v[i].clone(), |it| regroup(&v[i], it)));
            i += 1;
        }
    }
    changed.then_some(out)
}
