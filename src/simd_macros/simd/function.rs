//! Functions that enter their target.
use super::*;

/// The call of a closure with these patterns and types, which has the features of the target. More than 11 arguments are one.
/// See passing.rs for those that are lent.
pub(super) fn entering(how: &str, args: &[T], moves: &[T], all: Vec<(V, Option<V>)>, rest: &[T], lent: &[bool]) -> V {
    let n = all.len();
    if n > 11 {
        let types = commas(all.iter().map(|it| it.1.clone().unwrap_or(q("_", &[]))));
        let name = |i: usize| vec![Ident::new(&format!("__p{i}"), all[i].0[0].span()).into()];
        let one = (q("(__0)", &[&commas((0..n).map(name))]), Some(q("(__0)", &[&types])));
        // What a pattern leaves is dropped where a parameter is.
        let bound: V = (0..n).flat_map(|i| q("let __0 = __0; let __1 = __0;", &[&name(i), &all[i].0])).collect();
        let arrow = matches!(rest, [a, b, ..] if joint(a, '-') && p(b, '>'));
        let (result, body) = rest.split_at(if arrow { rest.len() - 1 } else { 0 });
        let body = if let [it] = body
            && g(it, D::Brace)
        {
            within(it)
        } else {
            body.to_vec()
        };
        let rest = q("__0 { __1 __2 }", &[result, &bound, &body]);
        return entering(how, &q("(__0),", &[args]), moves, vec![one], &rest, &[lent.contains(&true)]);
    }
    let given = |(it, &lent): (&[T], &bool)| {
        q(if lent { "#[inline(always)] || __0" } else { "#[inline(always)] move || __0" }, &[it])
    };
    let (by, args) = match lent.contains(&true) {
        true => ("lent_", &commas(split(args).into_iter().zip(lent).map(given))[..]),
        false => ("", args),
    };
    let typed = commas(all.into_iter().map(|(it, t)| t.map_or(it.clone(), |t| q("__0: __1", &[&it, &t]))));
    let (how, debug) = match how {
        "inside" => (how, ", { CRATE::__core::cfg!(debug_assertions) }"),
        "copied" => ("inlined", ", true"),
        "closure" => ("inlined", ", false, true"),
        _ => (how, ""),
    };
    q(
        &format!("CRATE::Entering::<S{debug}>::{by}{how}{n}(__0 #[inline(always)] __1 |__2| __3)"),
        &[args, moves, &typed, rest],
    )
}
/// Whether it looks like a struct or an array of floats, and not like numbers or vectors.
fn has_fields(v: &[T]) -> bool {
    let camel = |it: String| it.starts_with(char::is_uppercase) && it.contains(char::is_lowercase);
    first(v, &|t| matches!(t, T::Ident(_)) && camel(t.to_string())).is_some() && (p(&v[0], '&') || !names(v, "S"))
        || names(v, "f32 f64") && first(v, &|t| p(t, ';')).is_some() && !names(v, "S")
}
/// Whether it can have vectors, and not only point to them.
pub(super) fn holds_vectors(v: &[T]) -> bool {
    let parameter = matches!(v, [it] if it.to_string().starts_with(char::is_uppercase));
    (parameter || names(v, "S Self")) && !p(&v[0], '&') && !is(&v[0], "S") && !names(v, "impl dyn fn")
}
/// Whether the name is called.
fn calls(v: &[T], name: &str) -> bool {
    let next = |t: &T| g(t, D::Parenthesis) || joint(t, ':');
    (0..v.len()).any(|i| is(&v[i], name) && at(v, i + 1, next) || calls(inside(&v[i]), name))
}
/// Without attributes and visibility. The body of a kernel needn't enter.
pub(super) fn function(it: &Item, declare: bool, how: &str, list: &[T], of_trait: bool) -> V {
    let (s, last) = (signature(it), it.rest.last().unwrap());
    let result: &[T] = if names(&s.result, "impl") { &[] } else { &s.result };
    let mut inner = statements(last);
    let n = inner_attributes(&inner);
    let mut attrs: V = inner.drain(..n).collect();
    attrs.extend(home());
    attrs.extend(q(if how == "inside" { "" } else { "CRATE::native::real::<S>();" }, &[]));
    let inner = [regroup(last, if names(&inner, EXPORT) { error(EXPORTED) } else { body(&inner, list) })];
    // The entry of a kernel sees to that.
    let never = it.find("inline").is_some_and(|it| names(&it, "never")) && it.find("kernel").is_none();
    let maybe = it.attrs(maybe_never);
    if it.find("track_caller r#track_caller").is_some()
        || how.is_empty() && maybe.is_empty() && it.find("cold").is_none()
    {
        return it.with("Isa", declare, declare, vec![regroup(last, [attrs, within(&inner[0])].concat())]);
    }
    // All of self, and not only the fields that are named, which would be copies or be dropped before the others.
    let whole = s.this.iter().find(|t| is(t, "self")).filter(|_| !p(&s.this[0], '&'));
    let inner = whole
        .map_or(inner.to_vec(), |it| vec![regroup(last, q("let _ = &__0; __1", &[&[it.clone()], &within(&inner[0])]))]);
    // An editor needs the types.
    let typed = || s.patterns.iter().zip(&s.types).map(|(it, t)| (it.clone(), (!names(t, "impl")).then(|| t.clone())));
    let rest = [result, &inner].concat();
    // It can be behind dyn.
    let called = of_trait && s.this.len() > 1;
    let lent = |how| {
        s.types.iter().map(|it| (called || how == "apart" || how == "cold") && holds_vectors(it)).collect::<Vec<_>>()
    };
    let by = |how| entering(how, &s.args, &q("move", &[]), typed().collect(), &rest, &lent(how));
    let mut call = by(match it.find("cold") {
        Some(_) => "cold",
        None if never => "apart",
        None if !how.is_empty() && how != "inlined" => how,
        None if calls(inside(last), &it.rest[it.kind + 1].to_string()) => "inlined",
        None if !s.this.is_empty() || s.types.iter().any(|it| has_fields(it)) => "copied",
        None => "inlined",
    });
    if !maybe.is_empty() {
        let when = commas(maybe.chunks(2).map(|it| q("not(__0)", &[split(inside(&inside(&it[1])[1]))[0]])));
        call = q("#[cfg(not(all(__0)))] { __1 } #[cfg(all(__0))] { __2 }", &[&when, &by("apart"), &call])
    }
    s.renamed(it).with("Isa", declare, declare, vec![regroup(last, [attrs, call].concat())])
}
