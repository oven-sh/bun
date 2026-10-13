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
    /// What a string in it becomes is right behind, or right before, something that is no white space, or may be none. The
    /// plugin does not ask: of `class="a{{if b "p-4 flex"}}"` it makes `"flex p-4"`, and of `{{concat "p-4 " c}}` `"p-4"`.
    touches: [bool; 2],
}

/// Whether `id` is a text or a string with white space at its start, or at its end.
fn has_blank_at(tree: &Tree, source: &[u8], id: NodeId, is_start: bool) -> bool {
    let (Kind::Text { chars: text } | Kind::String { value: text }) = tree.kind(id) else {
        return false;
    };
    let text = tree.text(source, text);
    let end = if is_start { text.first() } else { text.last() };
    end.is_some_and(u8::is_ascii_whitespace)
}

/// `touches` of each of `nodes`, which follow each other in something whose own is `outer`.
fn touches_of(
    tree: &Tree,
    source: &[u8],
    nodes: &[NodeId],
    index: usize,
    outer: [bool; 2],
) -> [bool; 2] {
    let before = index.checked_sub(1).and_then(|it| nodes.get(it));
    [
        before.map_or(outer[0], |it| !has_blank_at(tree, source, *it, false)),
        (nodes.get(index + 1)).map_or(outer[1], |it| !has_blank_at(tree, source, *it, true)),
    ]
}

fn is_concat(tree: &Tree, source: &[u8], call: Call) -> bool {
    matches!(tree.kind(call.path), Kind::Path { name, tail, .. }
        if tail.is_empty() && tree.text(source, name) == b"concat")
}

/// Sorts the classes in the attributes of `tree`, which is made of `source`.
pub(super) fn sort_classes(tree: &mut Tree, source: &[u8], tailwind: &Tailwind) {
    let mut stack: Vec<(NodeId, Around)> = Vec::new();
    for id in 0..tree.nodes.len() as NodeId {
        if let Kind::Attr { name, value } = tree.kind(id) {
            let name = tree.text(source, name);
            if name == b"class" || tailwind.attributes.has(name) {
                let around = Around {
                    has_previous: false,
                    has_next: false,
                    is_in_concat: false,
                    touches: [false; 2],
                };
                stack.push((value, around));
            }
        }
    }
    while let Some((id, around)) = stack.pop() {
        let call = |call: Call, around: Around, stack: &mut Vec<(NodeId, Around)>| {
            let nodes = [call.path].into_iter();
            let nodes = nodes.chain(tree.list(call.pairs).iter().copied());
            stack.extend(nodes.map(|it| (it, around)));
            let (params, is_concat) = (tree.list(call.params), is_concat(tree, source, call));
            stack.extend(params.iter().enumerate().map(|(index, &param)| {
                let touches = match is_concat {
                    true => touches_of(tree, source, params, index, around.touches),
                    false => around.touches,
                };
                (param, Around { touches, ..around })
            }));
        };
        let (old, ends) = match tree.kind(id) {
            Kind::Concat { parts } => {
                let parts = tree.list(parts);
                stack.extend(parts.iter().enumerate().map(|(index, &part)| {
                    let around = Around {
                        has_previous: index > 0,
                        has_next: index + 1 < parts.len(),
                        touches: touches_of(tree, source, parts, index, around.touches),
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
                let around = Around {
                    is_in_concat: around.is_in_concat || is_concat(tree, source, it),
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
                    ignores_last: around.has_next
                        && bun_core::strings::trim_js_whitespace_end(old).len() == old.len(),
                    collapses_start: !around.has_previous,
                    collapses_end: !around.has_next,
                };
                (old, ends)
            }
            Kind::String { value } => {
                let old = tree.text(source, value);
                // `/[^\S\r\n]$/`
                let ends_with_blank = matches!(old, [.., b' ' | b'\t' | 0x0B | 0x0C]);
                let [touches_start, touches_end] = around.touches;
                let ends = Ends {
                    ignores_first: touches_start
                        && !old.first().is_some_and(u8::is_ascii_whitespace),
                    ignores_last: (around.is_in_concat || touches_end) && !ends_with_blank,
                    collapses_start: false,
                    collapses_end: !around.is_in_concat && !touches_end,
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
