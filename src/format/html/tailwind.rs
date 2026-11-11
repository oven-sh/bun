//! oxfmt's `sortTailwindcss` for HTML, Vue and Angular.
//!
//! oxfmt delegates this to `prettier-plugin-tailwindcss`, which rewrites attribute values in the tree that Prettier
//! parsed (`transformHtml`). A value is a slice of the text, so here the text is rewritten before it's parsed.

use super::ast::{Attribute, Id, Kind, Tree};
use super::{Parser, js, parse, without_front_matter};
use crate::tailwind::Tailwind;
use bun_core::strings;

/// The plugin's `nameFromDynamicAttr`
fn name_of_binding(name: &[u8], parser: Parser) -> Option<&[u8]> {
    match parser {
        Parser::Vue => (name.strip_prefix(b":"))
            .or_else(|| name.strip_prefix(b"v-bind:"))
            .or_else(|| name.starts_with(b"v-").then_some(name)),
        Parser::Angular => name.strip_prefix(b"[")?.strip_suffix(b"]"),
        _ => None,
    }
}

/// How the plugin treats an attribute's value.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Value {
    Classes,
    /// An expression with classes in its strings.
    Expression,
    Other,
}

/// Returns the name of the plain attribute that `option`, an entry of `attributes`, refers to. Returns `None` if it's a
/// directive.
fn plain_name(option: &[u8], parser: Parser) -> Option<&[u8]> {
    match name_of_binding(option, parser) {
        Some(bound) => (bound != option).then_some(bound),
        None => Some(option),
    }
}

/// The plugin's `createMatcher`, applied to the attribute `name`.
fn value_of(name: &[u8], parser: Parser, tailwind: &Tailwind) -> Value {
    let options = tailwind.attributes.names();
    let is_plain = |name: &[u8]| {
        name == b"class"
            || options
                .iter()
                .any(|it| plain_name(it, parser) == Some(name))
            || tailwind.attributes.has_pattern_for(name)
    };
    match name_of_binding(name, parser) {
        None if is_plain(name) => Value::Classes,
        Some(b"ngClass") if parser == Parser::Angular => Value::Expression,
        Some(bound) if is_plain(bound) || options.iter().any(|it| it == name) => Value::Expression,
        _ => Value::Other,
    }
}

/// Returns the plugin's replacement for the value of `attr` and the value's range in `text`, or `None` if nothing
/// changes.
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
    // In HTML, Prettier lowercases the names of known attributes.
    let name = match attr.name_span.of(text) {
        name if parser == Parser::Html && name.eq_ignore_ascii_case(b"class") => b"class",
        name => name,
    };
    let sorted = match value_of(name, parser, tailwind) {
        Value::Classes => tailwind.sorted(value).into_owned(),
        Value::Expression if strings::index_of_any(value, b"`'\"").is_some() => {
            js::with_sorted_classes(parse?, value, tailwind, parser == Parser::Angular)?
        }
        _ => return None,
    };
    (sorted != value).then_some((start, end, sorted))
}

/// Returns `text`, where every line break is `\n`, with its classes sorted. Returns `None` if nothing changes or it
/// doesn't parse.
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
        // The node after `<!-- prettier-ignore -->` is printed verbatim.
        let mut is_ignored = false;
        for child in tree.children(id) {
            let node = &tree[child];
            match node.kind {
                Kind::Comment => {
                    is_ignored =
                        strings::trim_js_whitespace(&node.value).starts_with(b"prettier-ignore")
                }
                Kind::Text if strings::trim_js_whitespace(&node.value).is_empty() => {}
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
