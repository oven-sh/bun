//! The whitespace-collapsing pre-pass turndown runs over the DOM before
//! converting (its `collapse-whitespace` module): runs of ASCII whitespace in
//! text become single spaces, spaces that would double up across inline
//! element boundaries are dropped, and text is trimmed against block
//! boundaries and `<br>`. `<pre>` subtrees are left untouched.
//!
//! This is a transcription of that state machine (including the way it
//! re-visits an element when the walk ascends back through it) so the
//! resulting text nodes match what turndown's rules later see. The same walk
//! also accumulates the per-subtree flags the emitter's blankness checks use.

use core::ptr;

use bun_core::strings;
use html5ever::tendril::StrTendril;

use super::dom::{self, FLAG_WS_ONLY, NodeData, Ref, Tag};
use super::text::is_js_whitespace;

/// Elements whose children the walk never enters: `<pre>` (whitespace is
/// significant) and the subtrees the converter drops wholesale, so their
/// text cannot perturb spacing of the surrounding prose.
#[inline]
fn is_opaque(node: Ref<'_>) -> bool {
    let tag = node.tag();
    tag == Tag::Pre || tag.is_skipped()
}

/// Runs the whitespace pass over everything under `root` and, in the same
/// walk, fills in each node's subtree flags (see [`dom::contribute_flags`]):
/// a node's flags are final when the walk leaves it, at which point they are
/// folded into the parent's.
pub(crate) fn collapse_whitespace(root: Ref<'_>) {
    if is_opaque(root) {
        dom::compute_subtree_flags(root);
        return;
    }
    let Some(mut node) = root.first_child.get() else {
        return;
    };

    let mut state = State {
        scratch: String::new(),
        prev_text: None,
        prev_text_ends_with_space: false,
        keep_leading_ws: false,
    };

    'walk: loop {
        // Where the walk continues if `node` is unlinked below.
        let next_sibling = node.next_sibling.get();
        let parent = node.parent.get().expect("walk stays under root");

        // Enter `node` (turndown's per-node step). `true` = descend next.
        let descend = match &node.data {
            NodeData::Text(cell) => {
                let mut data = cell.borrow_mut();
                let strip_leading = !state.keep_leading_ws
                    && (state.prev_text.is_none() || state.prev_text_ends_with_space);
                collapse_text(&mut data, strip_leading, &mut state.scratch);
                if data.is_empty() {
                    drop(data);
                    node.detach();
                } else {
                    state.prev_text_ends_with_space = data.ends_with(' ');
                    let ws_only = data.chars().all(is_js_whitespace);
                    drop(data);
                    state.prev_text = Some(node);
                    node.set_flags(if ws_only { FLAG_WS_ONLY } else { 0 });
                    dom::contribute_flags(parent, node);
                }
                false
            }
            NodeData::Element { .. } => {
                state.visit_element(node.tag());
                if is_opaque(node) {
                    // Not entered, but its flags still have to cover its text.
                    dom::compute_subtree_flags(node);
                    dom::contribute_flags(parent, node);
                    false
                } else if node.first_child.get().is_some() {
                    true
                } else {
                    dom::contribute_flags(parent, node);
                    false
                }
            }
            NodeData::Document | NodeData::Ignored => {
                node.detach();
                false
            }
        };

        if descend {
            node = node.first_child.get().expect("checked above");
            continue;
        }

        // Advance: next sibling if any, otherwise climb — and, exactly like
        // turndown's walk, re-run the element step on each ancestor passed on
        // the way up (that is what trims text before a closing block tag).
        let mut sibling = next_sibling;
        let mut ancestor = parent;
        loop {
            if let Some(s) = sibling {
                node = s;
                continue 'walk;
            }
            if ptr::eq(ancestor, root) {
                break 'walk;
            }
            state.visit_element(ancestor.tag());
            let up = ancestor.parent.get().expect("walk stays under root");
            dom::contribute_flags(up, ancestor);
            sibling = ancestor.next_sibling.get();
            ancestor = up;
        }
    }

    if let Some(p) = state.prev_text {
        trim_trailing_space(p);
        if p.as_text().unwrap().borrow().is_empty() {
            p.detach();
        }
    }
}

struct State<'a> {
    scratch: String,
    /// The last text node seen with no block boundary since, and whether it
    /// currently ends in a space.
    prev_text: Option<Ref<'a>>,
    prev_text_ends_with_space: bool,
    keep_leading_ws: bool,
}

impl State<'_> {
    /// turndown's element step. Runs when the walk enters an element and
    /// again when it climbs back out through it.
    #[inline]
    fn visit_element(&mut self, tag: Tag) {
        if tag.is_skipped() {
            // Dropped subtrees behave as if absent.
        } else if tag.is_block() || tag == Tag::Br {
            if let Some(p) = self.prev_text
                && self.prev_text_ends_with_space
            {
                trim_trailing_space(p);
            }
            self.prev_text = None;
            self.keep_leading_ws = false;
        } else if tag.is_void() || tag == Tag::Pre {
            // Keep the space around inline voids (`<img>`) and inline `<pre>`.
            self.prev_text = None;
            self.keep_leading_ws = true;
        } else if self.prev_text.is_some() {
            self.keep_leading_ws = false;
        }
    }
}

fn trim_trailing_space(text_node: Ref<'_>) {
    let cell = text_node.as_text().unwrap();
    let mut t = cell.borrow_mut();
    if t.ends_with(' ') {
        t.pop_back(1);
    }
}

#[inline]
fn is_ascii_ws(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r')
}

/// `text.replace(/[ \r\n\t]+/g, ' ')`, then drop one leading space if
/// `strip_leading`. `scratch` is a reusable buffer for the rewrite.
fn collapse_text(t: &mut StrTendril, strip_leading: bool, scratch: &mut String) {
    let text: &str = t;
    let bytes = text.as_bytes();

    // The indentation between tags is the most common text node by count;
    // settle it without allocating.
    if bytes.iter().all(|&b| is_ascii_ws(b)) {
        if strip_leading {
            t.clear();
        } else if bytes != b" " {
            *t = StrTendril::from_slice(" ");
        }
        return;
    }

    // First place that needs rewriting: a tab/CR/LF, or the second space
    // of a run. Everything before it is copied verbatim.
    let first_bad = match strings::index_of_any(bytes, b"\t\n\r") {
        Some(i) => Some(strings::index_of(&bytes[..i], b"  ").map_or(i, |j| j + 1)),
        None => strings::index_of(bytes, b"  ").map(|j| j + 1),
    };
    let Some(first_bad) = first_bad else {
        if strip_leading && bytes[0] == b' ' {
            t.pop_front(1);
        }
        return;
    };

    scratch.clear();
    scratch.reserve(bytes.len());
    // A leading run collapses to one space, which `strip_leading` then drops.
    let body_start = if strip_leading {
        bytes.iter().take_while(|&&b| is_ascii_ws(b)).count()
    } else {
        0
    };
    // `first_bad` sits inside a whitespace run; back up to the start of it
    // so the run is emitted as one space.
    let mut run_start = first_bad;
    while run_start > 0 && is_ascii_ws(bytes[run_start - 1]) {
        run_start -= 1;
    }
    let mut i = run_start.max(body_start);
    scratch.push_str(&text[body_start..i]);
    // One scalar pass over the rest: copy non-whitespace stretches, emit a
    // single space per whitespace run.
    while i < bytes.len() {
        if is_ascii_ws(bytes[i]) {
            scratch.push(' ');
            while i < bytes.len() && is_ascii_ws(bytes[i]) {
                i += 1;
            }
        } else {
            let start = i;
            while i < bytes.len() && !is_ascii_ws(bytes[i]) {
                i += 1;
            }
            scratch.push_str(&text[start..i]);
        }
    }
    *t = StrTendril::from_slice(scratch);
}
