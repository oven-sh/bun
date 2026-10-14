//! What is left of the old comment API, which found comments by offset while printing.
//!
//! Comments are now attached to nodes up front, so none of these functions finds anything any more. Each one stays only until
//! its last caller is converted to [`Comments::of_node`], and is deleted then. Do not add callers.

use super::comments::{CommentIter, CommentList, Comments};
use bun_lint::span::Span;

impl<'a> Comments<'a> {
    pub(crate) fn next_start(&self) -> u32 {
        u32::MAX
    }

    pub(crate) fn unprinted_comments(&self) -> CommentList<'a> {
        CommentList::empty()
    }

    pub(crate) fn first_unprinted_span(&self) -> Option<Span> {
        None
    }

    pub(crate) fn printed_comments(&self) -> CommentList<'a> {
        CommentList::empty()
    }

    pub(crate) fn comments_before_iter(&self, _pos: u32) -> CommentIter<'a> {
        CommentList::empty().iter()
    }

    pub(crate) fn comments_before(&self, _pos: u32) -> CommentList<'a> {
        CommentList::empty()
    }

    pub(crate) fn comments_leading_node(&self, _span: Span) -> CommentList<'a> {
        CommentList::empty()
    }

    pub(crate) fn comments_before_end_of(&self, _span: Span) -> CommentList<'a> {
        CommentList::empty()
    }

    pub(crate) fn own_line_comments_before(&self, _pos: u32) -> CommentList<'a> {
        CommentList::empty()
    }

    pub(crate) fn end_of_line_comments_after(&self, _pos: u32) -> CommentList<'a> {
        CommentList::empty()
    }

    pub(crate) fn comments_trailing_left_side(&self, _right_start: u32) -> CommentList<'a> {
        CommentList::empty()
    }

    pub(crate) fn comments_trailing_link(&self, _end: u32) -> CommentList<'a> {
        CommentList::empty()
    }

    pub(crate) fn comments_leading_link(&self, _inner_end: u32) -> CommentList<'a> {
        CommentList::empty()
    }

    pub(crate) fn has_comment_trailing_link(&self, _end: u32) -> bool {
        false
    }

    pub(crate) fn has_comment_leading_link(&self, _inner_end: u32) -> bool {
        false
    }

    pub(crate) fn comments_leading_property(
        &self,
        _key_end: u32,
        _value_start: u32,
    ) -> CommentList<'a> {
        CommentList::empty()
    }

    pub(crate) fn comments_after(&self, _pos: u32) -> CommentList<'a> {
        CommentList::empty()
    }

    pub(crate) fn comments_in(&self, _span: Span) -> CommentList<'a> {
        CommentList::empty()
    }

    pub(crate) fn comments_before_character(&self, _start: u32, _character: u8) -> CommentList<'a> {
        CommentList::empty()
    }

    pub(crate) fn get_trailing_comments(
        &self,
        _enclosing_span: Span,
        _preceding_span: Span,
        _following_span_start: u32,
    ) -> CommentList<'a> {
        CommentList::empty()
    }

    pub(crate) fn is_suppressed(&self, _start: u32) -> bool {
        false
    }

    pub(crate) fn mark_suppressed_after_operator(&mut self, _start: u32) {}

    pub(crate) fn has_trailing_suppression_comment(&self, _pos: u32) -> bool {
        false
    }

    pub(crate) fn get_type_cast_comment_index(&self, _span: Span) -> Option<usize> {
        None
    }

    pub(crate) fn hide_comments_from(&mut self, _position: u32) -> usize {
        0
    }

    pub(crate) fn restore_hidden_comments(&mut self, _hidden_from: usize) {}

    pub(crate) fn limit_comments_up_to(&mut self, _end_pos: u32) -> Option<usize> {
        None
    }

    pub(crate) fn restore_view_limit(&mut self, _limit: Option<usize>) {}

    pub(crate) fn skip_comments_before(&mut self, _pos: u32) {}
}
