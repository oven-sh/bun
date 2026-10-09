//! `transformSvelte` of `prettier-plugin-tailwindcss`, which oxfmt calls too: the classes in `class` and in the other
//! attributes for classes are sorted before anything is printed.

use super::ast::{Id, Kind, Span, Tree};
use crate::html::js::{EXPRESSION_JSX, EXPRESSION_TS, Parse};
use crate::tailwind::{Ends, Tailwind, Tidies, plugin};
use crate::text::starts_with_white_space;
use std::borrow::Cow;

/// The values of the attributes for classes: the parts of each.
fn values(tree: &Tree<'_>, tailwind: &Tailwind) -> Vec<Vec<Id>> {
    let mut values = Vec::new();
    for (id, node) in tree.nodes.iter().enumerate() {
        let Kind::Element(element) = &node.kind else {
            continue;
        };
        // It is not in the fragment any more.
        if tree.options == Some(id as Id) {
            continue;
        }
        for &attribute in &element.attributes {
            if let Kind::Attribute { name, value } = &tree[attribute].kind
                && (*name == b"class" || tailwind.attributes.has(name))
            {
                values.push(value.parts().to_vec());
            }
        }
    }
    values
}

/// Sorts the texts in `tree`. Returns `text` with what is in strings and templates sorted, if that changes it: nothing
/// moves, because there white space and duplicates stay.
pub(crate) fn sort(
    tree: &mut Tree<'_>,
    text: &[u8],
    tailwind: &Tailwind,
    (parse, is_typescript): (Option<Parse<'_>>, bool),
) -> Option<Vec<u8>> {
    let mut changes: Vec<(Span, Vec<u8>)> = Vec::new();
    for parts in values(tree, tailwind) {
        for (index, &part) in parts.iter().enumerate() {
            match &tree[part].kind {
                Kind::Text { raw } => {
                    let ends = Ends {
                        ignores_first: index > 0 && !starts_with_white_space(raw),
                        ignores_last: index + 1 < parts.len()
                            && bun_core::strings::trim_js_whitespace_end(raw).len() == raw.len(),
                        collapses_start: false,
                        collapses_end: false,
                    };
                    let tidies = Tidies {
                        collapses_white_space: false,
                        ..tailwind.tidies()
                    };
                    let sorted = tailwind.sorted_with(raw, ends, tidies).into_owned();
                    tree[part].kind = Kind::Text {
                        raw: Cow::Owned(sorted),
                    };
                }
                Kind::ExpressionTag(expression) => {
                    let (span, path) = match is_typescript {
                        true => (expression.span, EXPRESSION_TS),
                        false => (expression.span, EXPRESSION_JSX),
                    };
                    let Some(parse) = parse else {
                        continue;
                    };
                    parse.call(path, span.of(text), false, &mut |file| {
                        for (at, sorted) in plugin::sorted_in_svelte(file, tailwind) {
                            let at = Span {
                                start: span.start + at.start,
                                end: span.start + at.end,
                            };
                            changes.push((at, sorted));
                        }
                    });
                }
                _ => {}
            }
        }
    }
    if changes.is_empty() {
        return None;
    }
    let mut sorted = text.to_vec();
    for (at, classes) in &changes {
        if let Some(place) = sorted.get_mut(at.start as usize..at.end as usize)
            && place.len() == classes.len()
        {
            place.copy_from_slice(classes);
        }
    }
    Some(sorted)
}
