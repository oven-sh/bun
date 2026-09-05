//! Caps tree depth during parsing, the way browsers do.
//!
//! The HTML tree-construction algorithm answers "is there a `<p>` in button
//! scope?"-style questions by walking the stack of open elements, so input
//! that only ever opens elements (`<div>` × 200k) makes a spec-compliant
//! parser quadratic. Blink and WebKit bound this by refusing to grow the DOM
//! past 512 levels; this token filter does the same in front of html5ever's
//! tree builder: once the tree is [`MAX_TREE_DEPTH`] deep, further
//! nesting start tags are discarded (their text still lands in the deepest
//! open element) along with the matching end tags.
//!
//! Depth is read from the sink's record of where the last node was inserted,
//! which can only be stale on the high side (after end tags pop elements
//! nothing is inserted until the next token). A high reading is confirmed
//! against the tree builder's real stack before anything is dropped, so
//! ordinary documents never lose a tag and pay one integer compare per token.

use core::cell::{Cell, RefCell};

use html5ever::LocalName;
use html5ever::interface::tree_builder::Tracer;
use html5ever::tokenizer::{TagKind, Token, TokenSink, TokenSinkResult};
use html5ever::tree_builder::TreeBuilder;

use super::dom::{Ref, Sink};

/// Matches Blink's `kMaximumHTMLParserDOMTreeDepth` / WebKit's
/// `defaultMaximumHTMLParserDOMTreeDepth`.
pub const MAX_TREE_DEPTH: u32 = 512;

/// Distinct tag names tracked for end-tag suppression. Past this, a dropped
/// start tag's end tag is simply forwarded; the tree builder ignores end
/// tags with no matching open element, so the cost is a bounded stack scan.
const MAX_TRACKED_NAMES: usize = 32;

pub(crate) struct DepthLimiter<'a> {
    pub(crate) inner: TreeBuilder<Ref<'a>, Sink<'a>>,
    /// Start tags dropped so far whose end tags have not been seen:
    /// `(name, outstanding count)`, at most `MAX_TRACKED_NAMES` entries.
    dropped: RefCell<Vec<(LocalName, u32)>>,
}

impl<'a> DepthLimiter<'a> {
    pub(crate) fn new(inner: TreeBuilder<Ref<'a>, Sink<'a>>) -> Self {
        DepthLimiter {
            inner,
            dropped: RefCell::new(Vec::new()),
        }
    }

    /// Number of handles the tree builder is holding (open elements +
    /// active formatting elements + a few singletons). O(depth), so only
    /// consulted once the cheap hint says we are near the cap.
    fn open_handle_count(&self) -> u32 {
        let counter = HandleCounter(Cell::new(0), core::marker::PhantomData);
        self.inner.trace_handles(&counter);
        counter.0.get()
    }
}

struct HandleCounter<'a>(Cell<u32>, core::marker::PhantomData<Ref<'a>>);

impl<'a> Tracer for HandleCounter<'a> {
    type Handle = Ref<'a>;
    fn trace_handle(&self, _: &Ref<'a>) {
        self.0.set(self.0.get() + 1);
    }
}

/// Start tags that must reach the tree builder regardless of depth: void
/// elements (they never deepen the tree), the elements that switch the
/// tokenizer into a raw-text state (dropping `<script>` would spill its
/// source into the document as text), and the document-structure tags the
/// tree builder ignores or merges anyway.
fn always_forward(name: &LocalName) -> bool {
    matches!(
        &**name,
        "area"
            | "base"
            | "basefont"
            | "bgsound"
            | "br"
            | "col"
            | "embed"
            | "frame"
            | "hr"
            | "img"
            | "input"
            | "keygen"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
            | "script"
            | "style"
            | "textarea"
            | "title"
            | "xmp"
            | "iframe"
            | "noembed"
            | "noframes"
            | "noscript"
            | "plaintext"
            | "html"
            | "head"
            | "body"
            | "frameset"
    )
}

impl<'a> TokenSink for DepthLimiter<'a> {
    type Handle = Ref<'a>;

    #[inline]
    fn process_token(&self, token: Token, line_number: u64) -> TokenSinkResult<Ref<'a>> {
        if let Token::TagToken(tag) = &token {
            match tag.kind {
                TagKind::StartTag => {
                    if self.inner.sink.depth_hint() >= MAX_TREE_DEPTH
                        && !always_forward(&tag.name)
                        && self.open_handle_count() >= MAX_TREE_DEPTH
                    {
                        let mut dropped = self.dropped.borrow_mut();
                        if let Some((_, n)) = dropped.iter_mut().find(|(name, _)| *name == tag.name)
                        {
                            *n += 1;
                        } else if dropped.len() < MAX_TRACKED_NAMES {
                            dropped.push((tag.name.clone(), 1));
                        }
                        return TokenSinkResult::Continue;
                    }
                }
                TagKind::EndTag => {
                    let mut dropped = self.dropped.borrow_mut();
                    if !dropped.is_empty() {
                        if let Some(i) = dropped.iter().position(|(name, _)| *name == tag.name) {
                            dropped[i].1 -= 1;
                            if dropped[i].1 == 0 {
                                dropped.swap_remove(i);
                            }
                            return TokenSinkResult::Continue;
                        }
                    }
                }
            }
        }
        self.inner.process_token(token, line_number)
    }

    fn end(&self) {
        self.inner.end();
    }

    fn adjusted_current_node_present_but_not_in_html_namespace(&self) -> bool {
        self.inner
            .adjusted_current_node_present_but_not_in_html_namespace()
    }
}
