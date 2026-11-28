//! Lengths and constant arguments that say S. rustc wants them without parameters, so there is a form for each level, in which a
//! portable target with its width and words stands for S.
use super::*;

/// The first word that the target has counts.
const LEVELS: [&str; 9] = ["narrow", "icelake", "avx512", "avx2", "sse4", "neon", "B64", "B32", "B16"];
/// Where it starts in this group.
fn length(v: &[T], i: usize) -> Option<usize> {
    any_length(v, i).filter(|&start| names(&within(&v[i])[start..], "S"))
}
fn any_length(v: &[T], i: usize) -> Option<usize> {
    let (inner, before) = (within(&v[i]), |f: &dyn Fn(&T) -> bool| i > 0 && f(&v[i - 1]));
    let start = if g(&v[i], D::Bracket) && !before(&|t| p(t, '!') || p(t, '#')) {
        inner.iter().rposition(|t| p(t, ';'))? + 1
    } else if g(&v[i], D::Brace) && at(v, i + 1, |t| p(t, '>') || p(t, ',')) && before(&|t| p(t, '<') || p(t, ',')) {
        let opens = deep(v, |k, depth| depth > 0 || p(&v[k], ';'));
        (0..i).rev().find(opens).filter(|&k| p(&v[k], '<'))?;
        0
    } else {
        return None;
    };
    Some(start)
}
/// The constant whose S this is: S::N.
fn named(v: &[T], i: usize) -> Option<&[T]> {
    (is(&v[i], "S") && at(v, i + 1, |t| joint(t, ':'))).then(|| &v[i..v.len().min(i + 4)])
}
/// All of it, or its constants if it has variables of a macro.
fn tested(v: &[T]) -> Vec<V> {
    fn has(v: &[T]) -> bool {
        v.iter().any(|t| p(t, '$') || has(inside(t)))
    }
    let one = |i: usize| match &v[i] {
        _ if let Some(it) = named(v, i) => vec![it.to_vec()],
        t if is(t, "S") => {
            ROOT.set(Some(root_at(t.span())));
            vec![error("next to a variable of a macro, a length has to be a constant S::NAME")]
        }
        t => tested(inside(t)).into_iter().filter(|it| names(it, "S")).collect(),
    };
    if has(v) { (0..v.len()).flat_map(one).collect() } else { vec![v.to_vec()] }
}
/// With the tests that the lengths are those of S, for the block around.
fn for_width(v: &[T], width: &str, known: &[String], tests: &mut V) -> V {
    let like = |v: &[T]| replaced(v, "S", &q(&format!("CRATE::native::like::{width}"), &[]));
    let test = |it: &[T]| q("const { CRATE::only::length((__0) == (__1)) };", &[it, &like(it)]);
    let (mut out, mut i) = (V::new(), 0);
    while i < v.len() {
        let (inner, mut own) = (within(&v[i]), V::new());
        if let Some((_, n)) = nested(v, i).filter(|it| !it.0.is("macro_rules")) {
            out.extend_from_slice(&v[i..i + n]);
            i += n;
            continue;
        } else if let Some(start) = length(v, i) {
            let new = like(&inner[start..]);
            tests.extend(tested(&inner[start..]).iter().flat_map(|it| test(it)));
            out.push(regroup(&v[i], [for_width(&inner[..start], width, known, tests), new].concat()))
        } else if let Some(it) = named(v, i).filter(|it| known.contains(&it[it.len() - 1].to_string())) {
            // Lints know then which branches are dead.
            tests.extend(test(it));
            out.extend(like(&v[i..=i]))
        } else if names(&inner, "S") {
            let new = for_width(&written_in(v, i), width, known, &mut own);
            // Its items can't be named further out.
            let block = g(&v[i], D::Brace) && (0..inner.len()).any(|k| item(&inner[k..]).is_some());
            out.push(regroup(&v[i], if block { [std::mem::take(&mut own), new].concat() } else { new }));
            tests.extend(own)
        } else {
            out.push(v[i].clone())
        }
        i += 1
    }
    out
}
/// Types of arrays outside of bodies, which are known where the width is.
pub(super) fn arrays(v: &[T]) -> V {
    let one = |i: usize| match &v[i] {
        t if g(t, D::Bracket) && length(v, i).is_some() => {
            let arm = |w| {
                q(
                    &format!("{} => __0", if w == "B16" { "_" } else { w }),
                    &[&for_width(&v[i..=i], w, &[], &mut vec![])],
                )
            };
            q("CRATE::pick_type![ByLevel S: __0]", &[&commas(LEVELS.map(arm))])
        }
        t @ T::Group(_) if names(inside(t), "S") => vec![regroup(t, arrays(&written_in(v, i)))],
        t => vec![t.clone()],
    };
    (0..v.len()).flat_map(one).collect()
}
pub(super) fn by_level(it: &Item, of: Option<&Item>) -> bool {
    let asked = |it: &Item| names(&it.attrs(|v| attribute(v, "simd")), "by_level");
    has_length(&it.rest[it.kind + 1..]) || asked(it) || of.is_some_and(asked)
}
fn has_length(v: &[T]) -> bool {
    names(&for_width(v, "__in_a_length", &[], &mut vec![]), "__in_a_length")
}
/// Only for the messages.
pub(super) fn refused(it: &Item) -> Option<V> {
    fn find(v: &[T], constants: &[String; 2]) -> Option<V> {
        (0..v.len()).find_map(|i| {
            let inner = within(&v[i]);
            let Some(start) = any_length(v, i) else { return find(&inner, constants) };
            let lanes = |w: &[T]| w[0].to_string().ends_with("xN") && joint(&w[1], ':') && is(&w[3], "LANES");
            let text = match () {
                _ if inner[start..].windows(4).any(lanes) => "a length has to say S: u8xN::<S>::LANES",
                _ if names(&inner[start..], "S") && names(&inner[start..], &constants[0]) => {
                    "a length can't depend on both the target and a parameter: take an array of arrays, or the length as a parameter"
                }
                _ if start > 0 && names(&inner[start..], &constants[1]) => {
                    "a length can't depend on a parameter for lanes or widths: take v.to_array() with as_ref() or as_mut(), or room for the widest, such as u8xN::<S>::LANES"
                }
                _ => return find(&inner, constants),
            };
            ROOT.set(Some(root_at(inner[start].span())));
            Some(error(text))
        })
    }
    let all = it.generics().1;
    let bounds = "Width Lane Int Unsigned Signed Float HasSign";
    let constants = all.iter().filter(|it| is(&it[0], "const")).map(|it| it[1].to_string() + " ").collect();
    find(&it.rest, &[constants, all.iter().filter(|it| names(it, bounds)).map(|it| it[0].to_string() + " ").collect()])
}
pub(super) fn is_level(assumed: &[String; 3]) -> bool {
    assumed[1].starts_with("GivenWidth") || LEVELS.iter().any(|w| assumed[1].contains(&format!("::{w}::")))
}
/// The function for each level.
pub(super) fn levels(it: &Item) -> impl Iterator<Item = Item> {
    fn constants(v: &[T], counts: bool, out: &mut Vec<String>) {
        for i in 0..v.len() {
            out.extend(named(v, i).filter(|_| counts).map(|it| it[it.len() - 1].to_string()));
            constants(inside(&v[i]), counts || length(v, i).is_some(), out)
        }
    }
    let mut known = vec![];
    constants(&it.rest, false, &mut known);
    known.retain(|it| !it.contains(char::is_lowercase));
    LEVELS.iter().enumerate().map(move |(k, w)| {
        let ((last, head), mut tests) = (it.rest.split_last().unwrap(), vec![]);
        for_width(&head[it.kind + 1..], w, &[], &mut tests);
        let body = for_width(inside(last), w, &known, &mut tests);
        let n = inner_attributes(&body);
        let rest = [arrays(head), vec![regroup(last, [&body[..n], &tests, &body[n..]].concat())]].concat();
        let others: String = LEVELS[..k].iter().map(|it| format!("#[except({it})]")).collect();
        let more = q(&format!("#[only({w})] {others}"), &[]);
        let attrs = it.attrs.iter().cloned().chain(more.chunks(2).map(|it| [it[0].clone(), it[1].clone()])).collect();
        Item { attrs, vis: it.vis.clone(), kind: it.kind, rest }
    })
}
