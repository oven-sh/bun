//! oxfmt's `sortTailwindcss` in HTML and Vue.
//!
//! oxfmt leaves it to `prettier-plugin-tailwindcss`, which rewrites the values of attributes in the tree that Prettier has
//! parsed: `transformHtml`. A value is a piece of the text, so here the text is rewritten before it is parsed.

use super::ast::{Attribute, Id, Kind, Tree};
use super::{Parser, js, parse, without_front_matter};
use crate::tailwind::Tailwind;
use crate::text::trim;
use bun_core::strings;

/// The plugin's `nameFromDynamicAttr`
fn name_of_binding(name: &[u8], parser: Parser) -> Option<&[u8]> {
    if parser != Parser::Vue {
        return None;
    }
    (name.strip_prefix(b":"))
        .or_else(|| name.strip_prefix(b"v-bind:"))
        .or_else(|| name.starts_with(b"v-").then_some(name))
}

/// What the value of an attribute is to the plugin.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Value {
    Classes,
    /// An expression that has classes in its strings.
    Expression,
    Other,
}

/// The attribute without a binding that `option`, one of `attributes`, is about. `None`: it is a directive.
fn plain_name(option: &[u8], parser: Parser) -> Option<&[u8]> {
    match name_of_binding(option, parser) {
        Some(bound) => (bound != option).then_some(bound),
        None => Some(option),
    }
}

/// The plugin's `createMatcher`, asked about the attribute called `name`.
fn value_of(name: &[u8], parser: Parser, tailwind: &Tailwind) -> Value {
    let options = &tailwind.attributes;
    let is_plain = |name: &[u8]| {
        name == b"class"
            || options
                .iter()
                .any(|it| plain_name(it, parser) == Some(name))
    };
    match name_of_binding(name, parser) {
        None if is_plain(name) => Value::Classes,
        Some(bound) if is_plain(bound) || options.iter().any(|it| it == name) => Value::Expression,
        _ => Value::Other,
    }
}

/// What the plugin makes of the value of `attr`, and where that is in `text`. `None`: the same.
fn sorted_value(
    attr: &Attribute<'_>,
    text: &[u8],
    parser: Parser,
    tailwind: &Tailwind,
    parse: Option<js::Parse<'_>>,
) -> Option<(usize, usize, Vec<u8>)> {
    let span = attr.value_span?;
    let (mut start, mut end) = (span.start as usize, span.end as usize);
    if let [b'"' | b'\'', _, ..] = text.get(start..end)? {
        (start, end) = (start + 1, end - 1);
    }
    let value = text.get(start..end)?;
    let sorted = match value_of(attr.name_span.of(text), parser, tailwind) {
        Value::Classes => tailwind.sorted(value).into_owned(),
        Value::Expression if strings::index_of_any(value, b"`'\"").is_some() => {
            js::with_sorted_classes(parse?, value, tailwind)?
        }
        _ => return None,
    };
    (sorted != value).then_some((start, end, sorted))
}

/// `text`, in which every line break is `\n`, with the classes in it sorted. `None`: it is the same, or cannot be parsed.
pub(super) fn with_sorted_classes(
    text: &[u8],
    parser: Parser,
    tailwind: &Tailwind,
    parse: Option<js::Parse<'_>>,
) -> Option<Vec<u8>> {
    let (content, front_matter_len) = without_front_matter(text);
    let mut tree = Tree::default();
    parse::parse(&content, front_matter_len, parser, &mut tree).ok()?;
    let mut changes = Vec::new();
    let mut nodes: Vec<Id> = vec![tree.root];
    while let Some(id) = nodes.pop() {
        if tree[id].kind == Kind::Element {
            let sorted = |attr| sorted_value(attr, text, parser, tailwind, parse);
            changes.extend(tree.attrs(id).iter().filter_map(sorted));
        }
        // What is behind `<!-- prettier-ignore -->` is printed as it is in the text.
        let mut is_ignored = false;
        for child in tree.children(id) {
            let node = &tree[child];
            match node.kind {
                Kind::Comment => is_ignored = trim(&node.value).starts_with(b"prettier-ignore"),
                Kind::Text if trim(&node.value).is_empty() => {}
                _ if std::mem::take(&mut is_ignored) => {}
                _ => nodes.push(child),
            }
        }
    }
    if changes.is_empty() {
        return None;
    }
    crate::sort::sort_by_key(&mut changes, |it| it.0);
    let (mut sorted_text, mut from) = (Vec::with_capacity(text.len()), 0);
    for (start, end, sorted) in changes {
        sorted_text.extend_from_slice(text.get(from..start)?);
        sorted_text.extend_from_slice(&sorted);
        from = end;
    }
    sorted_text.extend_from_slice(text.get(from..)?);
    Some(sorted_text)
}
