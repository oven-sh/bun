//! oxfmt's `sortTailwindcss` in Handlebars: `transformGlimmer` of `prettier-plugin-tailwindcss`, which changes the tree.

use super::ast::{Call, Kind, NodeId, Text, Tree};
use crate::tailwind::{Ends, Tailwind};
use crate::text;

/// What is around a node in the value of an attribute.
#[derive(Copy, Clone)]
struct Around {
    /// It is a part of a `ConcatStatement`, with a part before it, and with one behind it.
    has_previous: bool,
    has_next: bool,
    /// It is in a `(concat ..)`.
    is_in_concat: bool,
}

/// Sorts the classes in the attributes of `tree`, which is made of `source`.
pub(super) fn sort_classes(tree: &mut Tree, source: &[u8], tailwind: &Tailwind) {
    let mut stack: Vec<(NodeId, Around)> = Vec::new();
    for id in 0..tree.nodes.len() as NodeId {
        if let Kind::Attr { name, value } = tree.kind(id) {
            let name = tree.text(source, name);
            if name == b"class" || tailwind.attributes.iter().any(|it| it == name) {
                let around = Around {
                    has_previous: false,
                    has_next: false,
                    is_in_concat: false,
                };
                stack.push((value, around));
            }
        }
    }
    while let Some((id, around)) = stack.pop() {
        let call = |call: Call, around: Around, stack: &mut Vec<(NodeId, Around)>| {
            let nodes = [call.path].into_iter();
            let nodes = nodes.chain(tree.list(call.params).iter().copied());
            let nodes = nodes.chain(tree.list(call.pairs).iter().copied());
            stack.extend(nodes.map(|it| (it, around)));
        };
        let (old, ends) = match tree.kind(id) {
            Kind::Concat { parts } => {
                let parts = tree.list(parts);
                stack.extend(parts.iter().enumerate().map(|(index, &part)| {
                    let around = Around {
                        has_previous: index > 0,
                        has_next: index + 1 < parts.len(),
                        ..around
                    };
                    (part, around)
                }));
                continue;
            }
            Kind::Mustache { call: it, .. } => {
                call(it, around, &mut stack);
                continue;
            }
            Kind::SubExpression { call: it } => {
                let is_concat = matches!(tree.kind(it.path), Kind::Path { name, tail, .. }
                    if tail.is_empty() && tree.text(source, name) == b"concat");
                let around = Around {
                    is_in_concat: around.is_in_concat || is_concat,
                    ..around
                };
                call(it, around, &mut stack);
                continue;
            }
            Kind::HashPair { value, .. } => {
                stack.push((value, around));
                continue;
            }
            Kind::Text { chars } => {
                let old = tree.text(source, chars);
                let ends = Ends {
                    ignores_first: around.has_previous && !text::starts_with_white_space(old),
                    ignores_last: around.has_next && text::trim_end(old).len() == old.len(),
                    collapses_start: !around.has_previous,
                    collapses_end: !around.has_next,
                };
                (old, ends)
            }
            Kind::String { value } => {
                let old = tree.text(source, value);
                // `/[^\S\r\n]$/`
                let ends_with_blank = matches!(old, [.., b' ' | b'\t' | 0x0B | 0x0C]);
                let ends = Ends {
                    ignores_first: false,
                    ignores_last: around.is_in_concat && !ends_with_blank,
                    collapses_start: false,
                    collapses_end: !around.is_in_concat,
                };
                (old, ends)
            }
            _ => continue,
        };
        let sorted = tailwind.sorted_between(old, ends);
        if *sorted == *old {
            continue;
        }
        let sorted = sorted.into_owned();
        let start = tree.start_text();
        tree.write(&sorted);
        let new: Text = tree.end_text(start);
        match tree.kind_mut(id) {
            Some(Kind::Text { chars }) => *chars = new,
            Some(Kind::String { value }) => *value = new,
            _ => {}
        }
    }
}
