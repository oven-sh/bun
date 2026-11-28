//! The names that derive_plain! in plain.rs checks.
use super::*;

pub fn derive(name: &str, words: &[&str], item: TokenStream) -> TokenStream {
    run(name, TokenStream::new(), item, |_, item| words.iter().flat_map(|word| one(word, item)).collect())
}
fn one(word: &str, item: &[T]) -> V {
    let call = |mut names: V| {
        names.iter_mut().for_each(|t| t.set_span(root()));
        q("CRATE::derive_plain! { __0 }", &[&names])
    };
    if let Some(at) = item.windows(3).position(|it| word == "struct" && is(&it[0], "enum") && g(&it[2], D::Brace)) {
        let first = inside(&item[at + 2]).iter().find(|t| matches!(t, T::Ident(_)));
        return call(item[at..at + 2].iter().chain(first).cloned().collect());
    }
    let start = item.iter().position(|t| is(t, "struct")).map_or(item.len(), |it| it + 1);
    let fields = match &item[start..] {
        [_, body] if g(body, D::Brace) => {
            split(inside(body)).into_iter().filter_map(|it| Some(it[colon(it)?.checked_sub(1)?].clone())).collect()
        }
        [_, body, _] if g(body, D::Parenthesis) => {
            (0..split(inside(body)).len()).flat_map(|i| q(&i.to_string(), &[])).collect()
        }
        [_, end] if p(end, ';') => vec![],
        _ => return error("this takes a struct without parameters, and AsBytes also an enum without fields"),
    };
    call([&q(word, &[]), &item[start..=start], &fields].concat())
}
