//! Caps tree depth during parsing, the way browsers do.
//!
//! The HTML tree-construction algorithm answers "is there a `<p>` in button
//! scope?"-style questions by walking the stack of open elements, so input
//! that only ever opens elements (`<div>` × 200k) makes a spec-compliant
//! parser quadratic. Blink and WebKit bound this by refusing to grow the DOM
//! past 512 levels; this token filter does the same in front of html5ever's
//! tree builder: once the tree is [`MAX_TREE_DEPTH`] deep, further
//! nesting start tags are discarded (their text still lands in the deepest
//! open element, block boundaries reduced to spaces) along with the matching
//! end tags.
//!
//! What is actually bounded is the number of nodes the tree builder is
//! holding — its stack of open elements plus the list of active formatting
//! elements — since that is what its scans walk. Usually that is the tree
//! depth, and the sink's record of where the last node was inserted is a
//! free lower-bound check. But the adoption agency algorithm re-parents
//! nodes towards the root while leaving them on the stack, so mis-nested
//! formatting tags (`<a><b><div><a>…`) can grow the stack without the tree
//! getting deeper; for that an upper-bound estimate of the handle count is
//! kept as well and checked against a cap of its own. Whenever either
//! signal fires the real count is taken from the tree builder before
//! anything is dropped, so ordinary documents never lose a tag and pay two
//! integer compares per tag.

use core::cell::{Cell, RefCell};

use html5ever::LocalName;
use html5ever::interface::tree_builder::Tracer;
use html5ever::tokenizer::{TagKind, Token, TokenSink, TokenSinkResult};
use html5ever::tree_builder::TreeBuilder;

use super::dom::{Ref, Sink, Tag};

/// Matches Blink's `kMaximumHTMLParserDOMTreeDepth` / WebKit's
/// `defaultMaximumHTMLParserDOMTreeDepth`.
pub const MAX_TREE_DEPTH: u32 = 512;

/// Cap on the tree builder's handle count (open elements + active
/// formatting elements) for when the tree itself is not deep; see the module
/// docs. Twice the depth cap, so that plain nesting of formatting elements —
/// which count once in each list — is still governed by tree depth.
const MAX_HANDLES: u32 = 2 * MAX_TREE_DEPTH;

/// Distinct tag names tracked for end-tag suppression. Past this, a dropped
/// start tag's end tag is simply forwarded; the tree builder ignores end
/// tags with no matching open element, so the cost is a bounded stack scan.
const MAX_TRACKED_NAMES: usize = 32;

pub(crate) struct DepthLimiter<'a> {
    pub(crate) inner: TreeBuilder<Ref<'a>, Sink<'a>>,
    /// Start tags dropped so far whose end tags have not been seen:
    /// `(name, outstanding count)`, at most `MAX_TRACKED_NAMES` entries.
    dropped: RefCell<Vec<(LocalName, u32)>>,
    /// Upper estimate of the tree builder's handle count: the last exact
    /// count plus two per start tag since (a start tag pushes at most one
    /// open element and one formatting entry). The one thing that can outrun
    /// it is reconstruction of formatting elements that were already closed
    /// at the last count — at most that count again — so a recount is taken
    /// whenever the estimate reaches half of [`MAX_HANDLES`], which keeps the
    /// true figure under the cap in between.
    handles_at_most: Cell<u32>,
}

impl<'a> DepthLimiter<'a> {
    pub(crate) fn new(inner: TreeBuilder<Ref<'a>, Sink<'a>>) -> Self {
        DepthLimiter {
            inner,
            dropped: RefCell::new(Vec::new()),
            handles_at_most: Cell::new(0),
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

impl<'a> DepthLimiter<'a> {
    /// Whether a start tag must reach the tree builder even at the cap. The
    /// [`always_forward`] reasoning only holds in HTML content: inside
    /// `<svg>`/`<math>` those same names are ordinary foreign elements that
    /// nest and switch nothing, so there nothing is exempt.
    fn exempt(&self, name: &LocalName) -> bool {
        always_forward(name)
            && !self
                .inner
                .adjusted_current_node_present_but_not_in_html_namespace()
    }

    /// In place of a dropped tag: a space if the tag was block-level, so the
    /// words on either side of what would have been a block boundary do not
    /// run together in the flattened text. (Whitespace is insertable in every
    /// tree-builder mode and collapses like any other later on.)
    fn separator_for(&self, name: &LocalName, line_number: u64) -> TokenSinkResult<Ref<'a>> {
        if Tag::from_local_name(name).is_block() {
            self.inner.process_token(
                Token::CharacterTokens(html5ever::tendril::StrTendril::from_slice(" ")),
                line_number,
            )
        } else {
            TokenSinkResult::Continue
        }
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
/// tree builder merges into an existing element rather than nesting.
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
    )
}

impl super::tokenizer::AttrBuf for DepthLimiter<'_> {
    #[inline]
    fn take_attr_buf(&self) -> Vec<html5ever::Attribute> {
        self.inner.sink.take_attr_buf()
    }
}

impl<'a> TokenSink for DepthLimiter<'a> {
    type Handle = Ref<'a>;

    #[inline]
    fn process_token(&self, token: Token, line_number: u64) -> TokenSinkResult<Ref<'a>> {
        if let Token::TagToken(tag) = &token {
            match tag.kind {
                TagKind::StartTag => {
                    let tree_deep = self.inner.sink.depth_hint() >= MAX_TREE_DEPTH;
                    if (tree_deep || self.handles_at_most.get() >= MAX_HANDLES / 2)
                        && !self.exempt(&tag.name)
                    {
                        let handles = self.open_handle_count();
                        self.handles_at_most.set(handles);
                        let cap = if tree_deep {
                            MAX_TREE_DEPTH
                        } else {
                            MAX_HANDLES
                        };
                        if handles >= cap {
                            {
                                let mut dropped = self.dropped.borrow_mut();
                                if let Some((_, n)) =
                                    dropped.iter_mut().find(|(name, _)| *name == tag.name)
                                {
                                    *n += 1;
                                } else if dropped.len() < MAX_TRACKED_NAMES {
                                    dropped.push((tag.name.clone(), 1));
                                }
                            }
                            return self.separator_for(&tag.name, line_number);
                        }
                    }
                    self.handles_at_most.set(self.handles_at_most.get() + 2);
                }
                TagKind::EndTag => {
                    let mut dropped = self.dropped.borrow_mut();
                    if !dropped.is_empty() {
                        if let Some(i) = dropped.iter().position(|(name, _)| *name == tag.name) {
                            dropped[i].1 -= 1;
                            if dropped[i].1 == 0 {
                                dropped.swap_remove(i);
                            }
                            drop(dropped);
                            return self.separator_for(&tag.name, line_number);
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
