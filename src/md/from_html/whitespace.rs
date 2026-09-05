//! The whitespace-collapsing pre-pass turndown runs over the DOM before
//! converting (its `collapse-whitespace` module): runs of ASCII whitespace in
//! text become single spaces, spaces that would double up across inline
//! element boundaries are dropped, and text is trimmed against block
//! boundaries and `<br>`. `<pre>` subtrees are left untouched.
//!
//! This is a direct transcription of that state machine (including the way
//! it re-visits an element when the walk ascends back through it) so the
//! resulting text nodes match what turndown's rules later see.

use core::ptr;

use bun_core::strings;
use html5ever::tendril::StrTendril;

use super::dom::{NodeData, Ref, Tag};

/// Elements whose children the walk never enters: `<pre>` (whitespace is
/// significant) and the subtrees the converter drops wholesale, so their
/// text cannot perturb spacing of the surrounding prose.
#[inline]
fn is_opaque(node: Ref<'_>) -> bool {
    let tag = node.tag();
    tag == Tag::Pre || tag.is_skipped()
}

pub(crate) fn collapse_whitespace(root: Ref<'_>) {
    if root.first_child.get().is_none() || is_opaque(root) {
        return;
    }

    let mut prev_text: Option<Ref<'_>> = None;
    let mut keep_leading_ws = false;
    let mut prev: Option<Ref<'_>> = None;
    let mut node = next(prev, root);

    while !ptr::eq(node, root) {
        match &node.data {
            NodeData::Text(cell) => {
                let mut data = cell.borrow_mut();
                let strip_leading = !keep_leading_ws
                    && prev_text.is_none_or(|p| p.as_text().unwrap().borrow().ends_with(' '));
                collapse_text(&mut data, strip_leading);
                if data.is_empty() {
                    drop(data);
                    node = remove(node);
                    continue;
                }
                drop(data);
                prev_text = Some(node);
            }
            NodeData::Element { tag, .. } => {
                let tag = *tag;
                if tag.is_skipped() {
                    // Dropped subtrees behave as if absent.
                } else if tag.is_block() || tag == Tag::Br {
                    if let Some(p) = prev_text {
                        trim_trailing_space(p);
                    }
                    prev_text = None;
                    keep_leading_ws = false;
                } else if tag.is_void() || tag == Tag::Pre {
                    // Keep the space around inline voids (`<img>`) and inline `<pre>`.
                    prev_text = None;
                    keep_leading_ws = true;
                } else if prev_text.is_some() {
                    keep_leading_ws = false;
                }
            }
            NodeData::Document | NodeData::Ignored => {
                node = remove(node);
                continue;
            }
        }
        let next_node = next(prev, node);
        prev = Some(node);
        node = next_node;
    }

    if let Some(p) = prev_text {
        trim_trailing_space(p);
        if p.as_text().unwrap().borrow().is_empty() {
            p.detach();
        }
    }
}

/// turndown's `next(prev, current)`: pre-order, except that arriving back at
/// a node from its child (or sitting on an opaque node) moves on to the next
/// sibling / parent instead of descending.
fn next<'a>(prev: Option<Ref<'a>>, current: Ref<'a>) -> Ref<'a> {
    let came_from_child =
        prev.is_some_and(|p| p.parent.get().is_some_and(|pp| ptr::eq(pp, current)));
    if came_from_child || is_opaque(current) {
        return current
            .next_sibling
            .get()
            .or_else(|| current.parent.get())
            .expect("walk is bounded by root");
    }
    current
        .first_child
        .get()
        .or_else(|| current.next_sibling.get())
        .or_else(|| current.parent.get())
        .expect("walk is bounded by root")
}

fn remove<'a>(node: Ref<'a>) -> Ref<'a> {
    let next = node
        .next_sibling
        .get()
        .or_else(|| node.parent.get())
        .expect("removed node has a parent");
    node.detach();
    next
}

fn trim_trailing_space(text_node: Ref<'_>) {
    let cell = text_node.as_text().unwrap();
    let mut t = cell.borrow_mut();
    if t.ends_with(' ') {
        let n = t.len32() - 1;
        *t = t.subtendril(0, n);
    }
}

/// `text.replace(/[ \r\n\t]+/g, ' ')`, then drop one leading space if
/// `strip_leading`.
fn collapse_text(t: &mut StrTendril, strip_leading: bool) {
    let text: &str = t;
    let bytes = text.as_bytes();
    // Most text nodes in real markup are either clean already or are the
    // indentation between tags; both are settled by two SIMD scans.
    let needs_rewrite =
        strings::index_of_any(bytes, b"\t\n\r").is_some() || strings::contains(bytes, b"  ");

    if needs_rewrite {
        let mut out = String::with_capacity(bytes.len());
        let mut rest = text;
        while !rest.is_empty() {
            match strings::index_of_any(rest.as_bytes(), b" \t\n\r") {
                Some(i) => {
                    out.push_str(&rest[..i]);
                    out.push(' ');
                    let run = rest.as_bytes()[i..]
                        .iter()
                        .take_while(|&&b| matches!(b, b' ' | b'\t' | b'\n' | b'\r'))
                        .count();
                    rest = &rest[i + run..];
                }
                None => {
                    out.push_str(rest);
                    break;
                }
            }
        }
        *t = StrTendril::from(out);
    }

    if strip_leading && t.starts_with(' ') {
        let n = t.len32();
        *t = t.subtendril(1, n - 1);
    }
}
