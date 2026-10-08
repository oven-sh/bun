//! Prettier's `language-html/print/tag.js`, as far as it makes strings, and `get-node-content.js`.
//!
//! Where white space counts, a line can only be broken inside of a tag. So a node may have to write the end of the
//! tag before it, or the start of the one behind it: it borrows them.

use super::Options;
use super::ast::{Flags, Id, Kind, Tree};
use super::utilities::{is_pre_like, is_text_like};

const HTML5_DOCTYPE_START_MARKER: &[u8] = b"<!doctype";

/// What the strings are made for.
#[derive(Copy, Clone)]
pub(crate) struct Tags<'t, 'a, 'o> {
    pub(crate) tree: &'t Tree<'a>,
    pub(crate) options: &'o Options<'o>,
}

fn push_raw_name((namespace, name): (&[u8], &[u8]), out: &mut Vec<u8>) {
    if !namespace.is_empty() {
        out.extend_from_slice(namespace);
        out.push(b':');
    }
    out.extend_from_slice(name);
}

impl<'o> Tags<'_, '_, 'o> {
    pub(crate) fn closing_tag(self, id: Id, out: &mut Vec<u8>) {
        if !self.tree[id].has(Flags::IS_SELF_CLOSING) {
            self.closing_tag_start(id, out);
        }
        self.closing_tag_end(id, out);
    }

    pub(crate) fn closing_tag_start(self, id: Id, out: &mut Vec<u8>) {
        if self
            .tree
            .last_child(id)
            .is_some_and(|last| self.needs_to_borrow_parent_closing_tag_start_marker(last))
        {
            return;
        }
        self.closing_tag_prefix(id, out);
        self.closing_tag_start_marker(id, out);
    }

    /// Whether what follows the node writes the end of its closing tag.
    fn lends_closing_tag_end_marker(self, id: Id) -> bool {
        match (self.tree.next(id), self.tree.parent(id)) {
            (Some(next), _) => self.needs_to_borrow_prev_closing_tag_end_marker(next),
            (None, Some(parent)) => self.needs_to_borrow_last_child_closing_tag_end_marker(parent),
            (None, None) => false,
        }
    }

    pub(crate) fn closing_tag_end(self, id: Id, out: &mut Vec<u8>) {
        if self.lends_closing_tag_end_marker(id) {
            return;
        }
        self.closing_tag_end_marker(id, out);
        self.closing_tag_suffix(id, out);
    }

    fn closing_tag_prefix(self, id: Id, out: &mut Vec<u8>) {
        if self.needs_to_borrow_last_child_closing_tag_end_marker(id)
            && let Some(last) = self.tree.last_child(id)
        {
            self.closing_tag_end_marker(last, out);
        }
    }

    pub(crate) fn closing_tag_suffix(self, id: Id, out: &mut Vec<u8>) {
        if self.needs_to_borrow_parent_closing_tag_start_marker(id) {
            if let Some(parent) = self.tree.parent(id) {
                self.closing_tag_start_marker(parent, out);
            }
        } else if self.needs_to_borrow_next_opening_tag_start_marker(id)
            && let Some(next) = self.tree.next(id)
        {
            self.opening_tag_start_marker(next, out);
        }
    }

    pub(crate) fn closing_tag_start_marker(self, id: Id, out: &mut Vec<u8>) {
        if self.should_not_print_closing_tag(id) {
            return;
        }
        let node = &self.tree[id];
        match node.kind {
            Kind::IeConditionalComment => out.extend_from_slice(b"<!"),
            Kind::Element if node.has(Flags::HAS_HTM_COMPONENT_CLOSING_TAG) => {
                out.extend_from_slice(b"<//")
            }
            _ => {
                out.extend_from_slice(b"</");
                push_raw_name(node.raw_name(), out);
            }
        }
    }

    pub(crate) fn closing_tag_end_marker(self, id: Id, out: &mut Vec<u8>) {
        if self.should_not_print_closing_tag(id) {
            return;
        }
        let node = &self.tree[id];
        out.extend_from_slice(match node.kind {
            Kind::IeConditionalComment | Kind::IeConditionalEndComment => b"[endif]-->",
            Kind::IeConditionalStartComment => b"]><!-->",
            Kind::Interpolation => b"}}",
            Kind::AngularIcuExpression => b"}",
            Kind::Element if node.has(Flags::IS_SELF_CLOSING) => b"/>",
            _ => b">",
        });
    }

    fn should_not_print_closing_tag(self, id: Id) -> bool {
        !self.tree[id]
            .flags
            .intersects(Flags::IS_SELF_CLOSING | Flags::HAS_END_SPAN)
            && (self.tree.has_prettier_ignore(id)
                || self
                    .tree
                    .parent(id)
                    .is_some_and(|parent| self.tree.should_preserve_content(parent, self.options)))
    }

    /// ```html
    /// <p></p
    /// >123
    /// ```
    pub(crate) fn needs_to_borrow_prev_closing_tag_end_marker(self, id: Id) -> bool {
        let node = &self.tree[id];
        node.flags & (Flags::IS_LEADING_SPACE_SENSITIVE | Flags::HAS_LEADING_SPACES)
            == Flags::IS_LEADING_SPACE_SENSITIVE
            && node.kind != Kind::AngularControlFlowBlock
            && self
                .tree
                .prev_of(id)
                .is_some_and(|prev| prev.kind != Kind::DocType && !is_text_like(prev))
    }

    /// ```html
    /// <p
    ///   ><a></a
    ///   ></p
    /// >
    /// ```
    pub(crate) fn needs_to_borrow_last_child_closing_tag_end_marker(self, id: Id) -> bool {
        self.tree.last_child(id).is_some_and(|last| {
            self.tree[last].flags
                & (Flags::IS_TRAILING_SPACE_SENSITIVE | Flags::HAS_TRAILING_SPACES)
                == Flags::IS_TRAILING_SPACE_SENSITIVE
                && !is_text_like(&self.tree[self.tree.last_descendant(last)])
                && !is_pre_like(&self.tree[id])
        })
    }

    /// ```html
    /// <p>
    ///   123</p
    /// >
    /// ```
    pub(crate) fn needs_to_borrow_parent_closing_tag_start_marker(self, id: Id) -> bool {
        self.tree.next(id).is_none()
            && self.tree[id].flags
                & (Flags::IS_TRAILING_SPACE_SENSITIVE | Flags::HAS_TRAILING_SPACES)
                == Flags::IS_TRAILING_SPACE_SENSITIVE
            && is_text_like(&self.tree[self.tree.last_descendant(id)])
    }

    /// ```html
    /// 123<p
    /// >
    /// ```
    pub(crate) fn needs_to_borrow_next_opening_tag_start_marker(self, id: Id) -> bool {
        let node = &self.tree[id];
        is_text_like(node)
            && node.flags & (Flags::IS_TRAILING_SPACE_SENSITIVE | Flags::HAS_TRAILING_SPACES)
                == Flags::IS_TRAILING_SPACE_SENSITIVE
            && self
                .tree
                .next_of(id)
                .is_some_and(|next| !is_text_like(next))
    }

    /// ```html
    /// <p
    ///   >123
    /// ```
    pub(crate) fn needs_to_borrow_parent_opening_tag_end_marker(self, id: Id) -> bool {
        self.tree.prev(id).is_none()
            && self.tree[id].flags & (Flags::IS_LEADING_SPACE_SENSITIVE | Flags::HAS_LEADING_SPACES)
                == Flags::IS_LEADING_SPACE_SENSITIVE
    }

    pub(crate) fn opening_tag_end(self, id: Id, out: &mut Vec<u8>) {
        if !self
            .tree
            .first_child(id)
            .is_some_and(|first| self.needs_to_borrow_parent_opening_tag_end_marker(first))
        {
            self.opening_tag_end_marker(id, out);
        }
    }

    pub(crate) fn opening_tag_start(self, id: Id, out: &mut Vec<u8>) {
        if self
            .tree
            .prev(id)
            .is_some_and(|prev| self.needs_to_borrow_next_opening_tag_start_marker(prev))
        {
            return;
        }
        self.opening_tag_prefix(id, out);
        self.opening_tag_start_marker(id, out);
    }

    pub(crate) fn opening_tag_prefix(self, id: Id, out: &mut Vec<u8>) {
        if self.needs_to_borrow_parent_opening_tag_end_marker(id) {
            if let Some(parent) = self.tree.parent(id) {
                self.opening_tag_end_marker(parent, out);
            }
        } else if self.needs_to_borrow_prev_closing_tag_end_marker(id)
            && let Some(prev) = self.tree.prev(id)
        {
            self.closing_tag_end_marker(prev, out);
        }
    }

    pub(crate) fn opening_tag_start_marker(self, id: Id, out: &mut Vec<u8>) {
        let node = &self.tree[id];
        match node.kind {
            Kind::IeConditionalComment | Kind::IeConditionalStartComment => {
                out.extend_from_slice(b"<!--[if ");
                out.extend_from_slice(&node.value);
            }
            Kind::IeConditionalEndComment => out.extend_from_slice(b"<!--<!"),
            Kind::Interpolation => out.extend_from_slice(b"{{"),
            Kind::DocType => {
                // Only in `.html` and `.htm` files is the one of HTML5 written in lower case.
                let is_html_file = self
                    .options
                    .filepath
                    .is_some_and(|path| path.ends_with(b".html") || path.ends_with(b".htm"));
                if &node.value[..] == b"html" && is_html_file {
                    return out.extend_from_slice(HTML5_DOCTYPE_START_MARKER);
                }
                let rest = self
                    .options
                    .original_text
                    .get(node.span.start as usize..)
                    .unwrap_or_default();
                out.extend_from_slice(&rest[..rest.len().min(HTML5_DOCTYPE_START_MARKER.len())]);
            }
            Kind::AngularIcuExpression => out.push(b'{'),
            // It has no `rawName`.
            Kind::AngularLetDeclaration => out.extend_from_slice(b"<undefined"),
            _ => {
                if node.has(Flags::HAS_CONDITION) {
                    out.extend_from_slice(b"<!--[if ");
                    out.extend_from_slice(&node.value);
                    out.extend_from_slice(b"]><!-->");
                }
                out.push(b'<');
                push_raw_name(node.raw_name(), out);
            }
        }
    }

    pub(crate) fn opening_tag_end_marker(self, id: Id, out: &mut Vec<u8>) {
        let node = &self.tree[id];
        out.extend_from_slice(match node.kind {
            Kind::IeConditionalComment => b"]>",
            Kind::Element if node.has(Flags::HAS_CONDITION) => b"><!--<![endif]-->",
            _ => b">",
        });
    }

    /// The length of what `write` writes.
    pub(crate) fn len_of(self, write: impl FnOnce(Self, &mut Vec<u8>)) -> usize {
        let mut out = Vec::new();
        write(self, &mut out);
        out.len()
    }

    /// `getNodeContent`
    pub(crate) fn node_content(self, id: Id) -> &'o [u8] {
        let node = &self.tree[id];
        let Some(end_span) = node.end_span() else {
            return b"";
        };
        let mut start = node.start_span.end as usize;
        if self
            .tree
            .first_child(id)
            .is_some_and(|first| self.needs_to_borrow_parent_opening_tag_end_marker(first))
        {
            start =
                start.saturating_sub(self.len_of(|tags, out| tags.opening_tag_end_marker(id, out)));
        }
        let mut end = end_span.start as usize;
        if self
            .tree
            .last_child(id)
            .is_some_and(|last| self.needs_to_borrow_parent_closing_tag_start_marker(last))
        {
            end += self.len_of(|tags, out| tags.closing_tag_start_marker(id, out));
        } else if self.needs_to_borrow_last_child_closing_tag_end_marker(id)
            && let Some(last) = self.tree.last_child(id)
        {
            end =
                end.saturating_sub(self.len_of(|tags, out| tags.closing_tag_end_marker(last, out)));
        }
        self.options
            .original_text
            .get(start..end)
            .unwrap_or_default()
    }
}
