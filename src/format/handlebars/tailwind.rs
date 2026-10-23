//! oxfmt's `sortTailwindcss` for Handlebars: `transformGlimmer` from `prettier-plugin-tailwindcss`, which rewrites the
//! tree.

use super::ast::{Call, Kind, NodeId, Text, Tree};
use crate::tailwind::{Ends, Tailwind};
use crate::text;

/// A node's surroundings within an attribute value.
#[derive(Copy, Clone)]
struct Context {
    /// It's a part of a `ConcatStatement` and has a part before it, or after it.
    has_previous: bool,
    has_next: bool,
    /// It's inside a `(concat ..)`.
    is_in_concat: bool,
    /// `[start, end]`: true if a string's rendered value comes directly after, or directly before, something that
    /// isn't, or might not be, whitespace. The plugin doesn't check this: it turns `class="a{{if b "p-4 flex"}}"` into
    /// `"flex p-4"`, and `{{concat "p-4 " c}}` into `"p-4"`.
    touches: [bool; 2],
}

/// True if `id` is a text or a string that starts, or with `is_start: false` ends, with whitespace.
fn has_whitespace_at(tree: &Tree, source: &[u8], id: NodeId, is_start: bool) -> bool {
    let (Kind::Text { chars: text } | Kind::String { value: text }) = tree.kind(id) else {
        return false;
    };
    let text = tree.text(source, text);
    let end = if is_start { text.first() } else { text.last() };
    end.is_some_and(u8::is_ascii_whitespace)
}

/// Returns `touches` for `nodes[index]`. `nodes` are the consecutive parts of a container whose own `touches` is
/// `outer`.
fn touches_of(
    tree: &Tree,
    source: &[u8],
    nodes: &[NodeId],
    index: usize,
    outer: [bool; 2],
) -> [bool; 2] {
    let before = index.checked_sub(1).and_then(|it| nodes.get(it));
    [
        before.map_or(outer[0], |it| !has_whitespace_at(tree, source, *it, false)),
        (nodes.get(index + 1)).map_or(outer[1], |it| !has_whitespace_at(tree, source, *it, true)),
    ]
}

fn is_concat(tree: &Tree, source: &[u8], call: Call) -> bool {
    matches!(tree.kind(call.path), Kind::Path { name, tail, .. }
        if tail.is_empty() && tree.text(source, name) == b"concat")
}

/// Sorts the classes in the attributes of `tree`, which was built from `source`.
pub(super) fn sort_classes(tree: &mut Tree, source: &[u8], tailwind: &Tailwind) {
    let mut stack: Vec<(NodeId, Context)> = Vec::new();
    for id in 0..tree.nodes.len() as NodeId {
        if let Kind::Attr { name, value } = tree.kind(id) {
            let name = tree.text(source, name);
            if name == b"class" || tailwind.attributes.has(name) {
                let context = Context {
                    has_previous: false,
                    has_next: false,
                    is_in_concat: false,
                    touches: [false; 2],
                };
                stack.push((value, context));
            }
        }
    }
    while let Some((id, context)) = stack.pop() {
        let call = |call: Call, context: Context, stack: &mut Vec<(NodeId, Context)>| {
            let nodes = [call.path].into_iter();
            let nodes = nodes.chain(tree.list(call.pairs).iter().copied());
            stack.extend(nodes.map(|it| (it, context)));
            let (params, is_concat) = (tree.list(call.params), is_concat(tree, source, call));
            stack.extend(params.iter().enumerate().map(|(index, &param)| {
                let touches = match is_concat {
                    true => touches_of(tree, source, params, index, context.touches),
                    false => context.touches,
                };
                (param, Context { touches, ..context })
            }));
        };
        let (old, ends) = match tree.kind(id) {
            Kind::Concat { parts } => {
                let parts = tree.list(parts);
                stack.extend(parts.iter().enumerate().map(|(index, &part)| {
                    let context = Context {
                        has_previous: index > 0,
                        has_next: index + 1 < parts.len(),
                        touches: touches_of(tree, source, parts, index, context.touches),
                        ..context
                    };
                    (part, context)
                }));
                continue;
            }
            Kind::Mustache { call: it, .. } => {
                call(it, context, &mut stack);
                continue;
            }
            Kind::SubExpression { call: it } => {
                let context = Context {
                    is_in_concat: context.is_in_concat || is_concat(tree, source, it),
                    ..context
                };
                call(it, context, &mut stack);
                continue;
            }
            Kind::HashPair { value, .. } => {
                stack.push((value, context));
                continue;
            }
            Kind::Text { chars } => {
                let old = tree.text(source, chars);
                let ends = Ends {
                    ignores_first: context.has_previous && !text::starts_with_white_space(old),
                    ignores_last: context.has_next
                        && bun_core::strings::trim_js_whitespace_end(old).len() == old.len(),
                    collapses_start: !context.has_previous,
                    collapses_end: !context.has_next,
                };
                (old, ends)
            }
            Kind::String { value } => {
                let old = tree.text(source, value);
                // `/[^\S\r\n]$/`
                let ends_with_horizontal_whitespace =
                    matches!(old, [.., b' ' | b'\t' | 0x0B | 0x0C]);
                let [touches_start, touches_end] = context.touches;
                let ends = Ends {
                    ignores_first: touches_start
                        && !old.first().is_some_and(u8::is_ascii_whitespace),
                    ignores_last: (context.is_in_concat || touches_end)
                        && !ends_with_horizontal_whitespace,
                    collapses_start: false,
                    collapses_end: !context.is_in_concat && !touches_end,
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
