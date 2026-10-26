//! The comments of the file being formatted.
//!
//! A comment is a [`Comment`] handle to the record that the lexer and the parser filled in. The formatter adds only
//! what it decides itself, keyed by comment id:
//! - which node owns each comment ([`attach`](super::attach), [`Owners`]),
//! - which comments have been printed ([`Comments::mark_printed`]).
//!
//! Printers get a node's comments with [`Comments::of_node`]. Every comment has to be printed exactly once. If one is
//! left over at the end, the file isn't written.

use super::ast_nodes::AstNodes;
use super::attach::{self, Marker, Owner, Placement};
use super::owners::Owners;
use crate::options::{Flavor, FormatOptions};
pub(crate) use bun_lint::ast::comments::Comment;
use bun_lint::ast::{File, Node};
use bun_lint::span::Span;
use std::cell::Cell;

/// Checks on a comment's text that only the formatter needs.
pub(crate) trait CommentExt {
    /// Prettier's `isIndentableBlockComment`: a block comment in which every line after the first starts with `*`. Its
    /// lines are re-indented.
    fn is_indentable_block(self) -> bool;
    /// Prettier's `isTypeCastComment`: a JSDoc comment with `@type` or `@satisfies`.
    fn looks_like_type_cast(self) -> bool;
    /// `prettier-ignore`, or `oxfmt-ignore` in that flavor.
    fn is_ignore_comment(self, flavor: Flavor) -> bool;
}

impl CommentExt for Comment<'_> {
    fn is_indentable_block(self) -> bool {
        self.is_multiline_block() && is_indentable_text(self.content())
    }

    fn looks_like_type_cast(self) -> bool {
        self.is_block() && self.content().starts_with(b"*") && is_type_cast_text(self.content())
    }

    fn is_ignore_comment(self, flavor: Flavor) -> bool {
        // Like JavaScript's `trim()`, this also strips no-break spaces.
        let content = bun_core::strings::trim_js_whitespace_start(self.content());
        // Few comments get past this.
        matches!(content.first(), Some(b'p' | b'o'))
            && flavor.is_ignore_comment(bun_core::strings::trim_js_whitespace(content))
    }
}

/// `content` is the text between `/*` and `*/`.
fn is_indentable_text(content: &[u8]) -> bool {
    let mut lines = bun_core::strings::split_crlf_lines(content)
        .skip(1)
        .peekable();
    if lines.peek().is_none() {
        return false;
    }
    while let Some(line) = lines.next() {
        let line = bun_core::strings::trim_js_whitespace_start(line);
        // The last line continues with the `*` of `*/`.
        if !line.starts_with(b"*") && !(line.is_empty() && lines.peek().is_none()) {
            return false;
        }
    }
    true
}

/// True if `content` has an `@type` or `@satisfies` tag.
pub(crate) fn is_type_cast_text(content: &[u8]) -> bool {
    let mut rest = content;
    while let Some(at) = bun_core::strings::index_of_char_usize(rest, b'@') {
        rest = &rest[at + 1..];
        for tag in [&b"type"[..], b"satisfies"] {
            if let Some(after) = rest.strip_prefix(tag)
                && !after
                    .first()
                    .is_some_and(|&b| b.is_ascii_alphanumeric() || b == b'_')
            {
                return true;
            }
        }
    }
    false
}

#[derive(Copy, Clone)]
enum Ids<'a> {
    Listed(&'a [u32]),
    Consecutive { first: u32, len: u32 },
}

/// A list of comments, stored as ids.
#[derive(Copy, Clone)]
pub(crate) struct CommentList<'a> {
    /// `None` only for an empty list.
    file: Option<&'a File<'a>>,
    ids: Ids<'a>,
}

impl<'a> CommentList<'a> {
    pub(crate) const fn empty() -> CommentList<'a> {
        CommentList {
            file: None,
            ids: Ids::Listed(&[]),
        }
    }

    pub(crate) fn len(self) -> usize {
        match self.ids {
            Ids::Listed(ids) => ids.len(),
            Ids::Consecutive { len, .. } => len as usize,
        }
    }

    pub(crate) fn is_empty(self) -> bool {
        self.len() == 0
    }

    pub(crate) fn get(self, index: usize) -> Option<Comment<'a>> {
        let id = match self.ids {
            Ids::Listed(ids) => *ids.get(index)?,
            Ids::Consecutive { first, len } if index < len as usize => first + index as u32,
            Ids::Consecutive { .. } => return None,
        };
        Some(self.file?.comment(id))
    }

    pub(crate) fn first(self) -> Option<Comment<'a>> {
        self.get(0)
    }

    pub(crate) fn last(self) -> Option<Comment<'a>> {
        self.get(self.len().checked_sub(1)?)
    }

    pub(crate) fn iter(self) -> CommentIter<'a> {
        CommentIter {
            list: self,
            front: 0,
            back: self.len(),
        }
    }

    /// The comments from index `from` up to, but not including, index `to`.
    pub(crate) fn slice(self, from: usize, to: usize) -> CommentList<'a> {
        let to = to.min(self.len());
        let from = from.min(to);
        let ids = match self.ids {
            Ids::Listed(ids) => Ids::Listed(ids.get(from..to).unwrap_or_default()),
            Ids::Consecutive { first, .. } => Ids::Consecutive {
                first: first + from as u32,
                len: (to - from) as u32,
            },
        };
        CommentList { ids, ..self }
    }

    pub(crate) fn split_last(self) -> Option<(Comment<'a>, CommentList<'a>)> {
        Some((self.last()?, self.slice(0, self.len() - 1)))
    }

    pub(crate) fn split_at(self, index: usize) -> (CommentList<'a>, CommentList<'a>) {
        (self.slice(0, index), self.slice(index, self.len()))
    }

    /// Splits off the leading run of comments that are on the same line as the token before them, if that line ends
    /// after one of them. Otherwise splits off nothing.
    pub(crate) fn split_at_end_of_line(self) -> (CommentList<'a>, CommentList<'a>) {
        let count = (self.iter())
            .take_while(|comment| !comment.has_newline_before())
            .position(|comment| comment.has_newline_after())
            .map_or(0, |last| last + 1);
        self.split_at(count)
    }
}

impl Default for CommentList<'_> {
    fn default() -> Self {
        CommentList::empty()
    }
}

#[derive(Clone)]
pub(crate) struct CommentIter<'a> {
    list: CommentList<'a>,
    front: usize,
    back: usize,
}

impl<'a> Iterator for CommentIter<'a> {
    type Item = Comment<'a>;

    fn next(&mut self) -> Option<Comment<'a>> {
        if self.front >= self.back {
            return None;
        }
        self.front += 1;
        self.list.get(self.front - 1)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let len = self.back - self.front;
        (len, Some(len))
    }
}

impl DoubleEndedIterator for CommentIter<'_> {
    fn next_back(&mut self) -> Option<Self::Item> {
        if self.front >= self.back {
            return None;
        }
        self.back -= 1;
        self.list.get(self.back)
    }
}

impl ExactSizeIterator for CommentIter<'_> {}

impl<'a> IntoIterator for CommentList<'a> {
    type Item = Comment<'a>;
    type IntoIter = CommentIter<'a>;

    fn into_iter(self) -> CommentIter<'a> {
        self.iter()
    }
}

/// The comments attached to one node.
#[derive(Copy, Clone)]
pub(crate) struct OwnedComments<'a> {
    pub(crate) leading: CommentList<'a>,
    pub(crate) trailing: CommentList<'a>,
    pub(crate) dangling: CommentList<'a>,
    /// Prettier's `hasNodeIgnoreComment`: the node isn't formatted, and its source text is copied.
    pub(crate) is_ignored: bool,
}

impl OwnedComments<'_> {
    pub(crate) const NONE: Self = OwnedComments {
        leading: CommentList::empty(),
        trailing: CommentList::empty(),
        dangling: CommentList::empty(),
        is_ignored: false,
    };

    pub(crate) fn is_empty(&self) -> bool {
        self.leading.is_empty() && self.trailing.is_empty() && self.dangling.is_empty()
    }
}

/// A comment's attachment, without the owner.
#[derive(Copy, Clone)]
pub(crate) struct AttachmentInfo {
    pub(crate) placement: Placement,
    pub(crate) marker: Marker,
    /// The [`AstKind`](super::ast_nodes::AstKind) of the owner, for error messages. `u8::MAX` if the owner isn't a
    /// node.
    pub(crate) owner_kind: u8,
}

/// Comment data that the formatter computes once per file.
pub(crate) struct FileComments {
    /// Indexed by comment id.
    attachments: Vec<AttachmentInfo>,
    owners: Owners,
    cast_parens: Vec<u32>,
    has_ignore_comments: bool,
}

impl FileComments {
    pub(crate) const EMPTY: FileComments = FileComments {
        attachments: Vec::new(),
        owners: Owners::EMPTY,
        cast_parens: Vec::new(),
        has_ignore_comments: false,
    };
}

pub(crate) static NO_COMMENTS: FileComments = FileComments::EMPTY;

/// Only Babel, which Prettier uses for JavaScript, keeps the parentheses after `/** @type {T} */` in its tree. In
/// TypeScript they're ordinary parentheses. oxfmt keeps them there too.
fn keeps_type_casts(file: &File<'_>, flavor: Flavor, has_babel_tree: bool) -> bool {
    has_babel_tree || file.is_javascript() || flavor.is_oxfmt()
}

/// Returns the sorted offsets of every `(` that directly follows a type cast comment. If such a `(` wraps an
/// expression, Prettier keeps the `ParenthesizedExpression`.
pub(crate) fn cast_parens<'a>(
    file: &'a File<'a>,
    flavor: Flavor,
    has_babel_tree: bool,
) -> Vec<u32> {
    if !keeps_type_casts(file, flavor, has_babel_tree) {
        return Vec::new();
    }
    let text = file.text();
    let mut comments = file.comments_by_id().peekable();
    let mut cast_parens = Vec::new();
    while let Some(comment) = comments.next() {
        let next_token_start = comment.next_token_start();
        if text.get(next_token_start as usize) == Some(&b'(')
            && comments
                .peek()
                .is_none_or(|next| next.span().start > next_token_start)
            && comment.looks_like_type_cast()
        {
            cast_parens.push(next_token_start);
        }
    }
    cast_parens
}

/// Attaches the comments of `file`. The result is cached in the file, so it lives as long as the handles.
pub(crate) fn for_file<'a>(file: &'a File<'a>, options: &FormatOptions) -> &'a FileComments {
    let comments = file.extension(|| {
        let has_babel_tree = super::context::has_babel_tree(file, options);
        let cast_parens = cast_parens(file, options.flavor, has_babel_tree);
        let attach_options = attach::Options {
            has_babel_tree,
            experimental_ternaries: options.experimental_ternaries,
            flavor: options.flavor,
        };
        let attached = attach::attach(file, &cast_parens, attach_options);
        let attachments = (attached.attachments.iter())
            .map(|attachment| AttachmentInfo {
                placement: attachment.placement,
                marker: attachment.marker,
                owner_kind: match attachment.owner {
                    Owner::Node(node) => node.kind() as u8,
                    Owner::Name(_) | Owner::CastParens(..) => u8::MAX,
                },
            })
            .collect();
        FileComments {
            attachments,
            has_ignore_comments: attached.has_ignore_comments,
            owners: Owners::new(file, attached),
            cast_parens,
        }
    });
    comments.unwrap_or(&NO_COMMENTS)
}

/// See [`Comments::snapshot`].
#[derive(Copy, Clone)]
pub(crate) struct CommentSnapshot {
    printed_log_len: usize,
}

pub(crate) struct Comments<'a> {
    /// `None` if the document isn't JavaScript, in which case there are no comments.
    file: Option<&'a File<'a>>,
    flavor: Flavor,
    file_comments: &'a FileComments,
    /// The result of the last search by offset. Nodes are mostly printed in source order, so the next search starts
    /// here.
    search_hint: Cell<u32>,
    /// The inclusive range of offsets for which the last search result still holds: from just after the start of the
    /// previous comment to the start of the comment that was found, or `u32::MAX` if none was.
    searched_offsets: Cell<(u32, u32)>,
    /// One bit per comment id.
    printed_bitset: Vec<u64>,
    /// The ids of the printed comments, in the order in which they were printed.
    printed_log: Vec<u32>,
}

impl<'a> Comments<'a> {
    pub(crate) fn new(
        file: Option<&'a File<'a>>,
        flavor: Flavor,
        file_comments: &'a FileComments,
    ) -> Self {
        Comments {
            file,
            flavor,
            file_comments,
            search_hint: Cell::new(0),
            searched_offsets: Cell::new((1, 0)),
            printed_bitset: vec![0; file_comments.attachments.len().div_ceil(64)],
            printed_log: Vec::new(),
        }
    }

    /// Returns the number of comments. All ids are below this.
    fn count(&self) -> u32 {
        self.file_comments.attachments.len() as u32
    }

    fn comment(&self, id: u32) -> Option<Comment<'a>> {
        (id < self.count()).then(|| self.file.map(|file| file.comment(id)))?
    }

    fn list(&self, ids: &'a [u32]) -> CommentList<'a> {
        CommentList {
            file: self.file,
            ids: Ids::Listed(ids),
        }
    }

    // ───────────────────────────── by owner ─────────────────────────────

    fn owned(&self, ids: super::owners::OwnedIds<'a>) -> OwnedComments<'a> {
        OwnedComments {
            leading: self.list(ids.leading),
            trailing: self.list(ids.trailing),
            dangling: self.list(ids.dangling),
            is_ignored: ids.is_ignored,
        }
    }

    /// The comments attached to `node`.
    #[inline]
    pub(crate) fn of_node(&self, node: AstNodes<'_>) -> OwnedComments<'a> {
        self.owned(self.file_comments.owners.of_node(node))
    }

    /// Prettier's `hasComment(node)`. For an expression, see `utils::typecast::has_comments`.
    #[inline]
    pub(crate) fn has_comments(&self, node: AstNodes<'_>) -> bool {
        !self.of_node(node).is_empty()
    }

    /// True if one of the `AstNodes` backed by `raw` owns a comment or is ignored. Cheaper than building the `AstNodes`
    /// and calling [`Comments::of_node`].
    #[inline]
    pub(crate) fn is_owner(&self, raw: Node<'_>) -> bool {
        self.file_comments.owners.is_owner(raw)
    }

    /// The comments attached to the name or literal key that starts at `start`.
    #[inline]
    pub(crate) fn of_name(&self, start: u32) -> OwnedComments<'a> {
        self.owned(self.file_comments.owners.of_name(start))
    }

    /// The comments attached to the type cast parentheses that open at `open_paren`.
    #[inline]
    pub(crate) fn of_cast_parens(&self, open_paren: u32) -> OwnedComments<'a> {
        self.owned(self.file_comments.owners.of_cast_parens(open_paren))
    }

    /// True if `node` is copied from the source because of a `prettier-ignore` comment.
    #[inline]
    pub(crate) fn is_ignored(&self, node: AstNodes<'_>) -> bool {
        self.file_comments.has_ignore_comments && self.file_comments.owners.of_node(node).is_ignored
    }

    pub(crate) fn attachment(&self, comment: Comment<'_>) -> Option<AttachmentInfo> {
        self.file_comments
            .attachments
            .get(comment.id() as usize)
            .copied()
    }

    // ───────────────────────────── by offset ─────────────────────────────

    /// The id of the first comment that starts at or after `offset`.
    #[inline]
    fn first_id_at_or_after(&self, offset: u32) -> u32 {
        let (first, last) = self.searched_offsets.get();
        match first <= offset && offset <= last {
            true => self.search_hint.get(),
            false => self.search_first_id_at_or_after(offset),
        }
    }

    fn search_first_id_at_or_after(&self, offset: u32) -> u32 {
        const MAX_STEPS: u32 = 4;
        let starts_before = |id: u32| {
            self.comment(id)
                .is_some_and(|comment| comment.span().start < offset)
        };
        let mut id = self.search_hint.get().min(self.count());
        let mut steps = 0;
        while id > 0 && !starts_before(id - 1) && steps < MAX_STEPS {
            id -= 1;
            steps += 1;
        }
        while starts_before(id) && steps < MAX_STEPS {
            id += 1;
            steps += 1;
        }
        if steps == MAX_STEPS {
            let (mut low, mut high) = (0, self.count());
            while low < high {
                let middle = low + (high - low) / 2;
                match starts_before(middle) {
                    true => low = middle + 1,
                    false => high = middle,
                }
            }
            id = low;
        }
        self.search_hint.set(id);
        let start_of = |id: u32| self.comment(id).map(|comment| comment.span().start);
        self.searched_offsets.set((
            (id.checked_sub(1).and_then(start_of)).map_or(0, |start| start + 1),
            start_of(id).unwrap_or(u32::MAX),
        ));
        id
    }

    /// Every comment of the file.
    pub(crate) fn all(&self) -> CommentList<'a> {
        CommentList {
            file: self.file,
            ids: Ids::Consecutive {
                first: 0,
                len: self.count(),
            },
        }
    }

    /// The comments that start inside `span`, printed or not.
    pub(crate) fn comments_in_span(&self, span: Span) -> CommentList<'a> {
        let first = self.first_id_at_or_after(span.start);
        let len = (first..self.count())
            .take_while(|id| {
                self.comment(*id)
                    .is_some_and(|comment| comment.span().start < span.end)
            })
            .count() as u32;
        CommentList {
            file: self.file,
            ids: Ids::Consecutive { first, len },
        }
    }

    #[inline]
    pub(crate) fn has_comment_in_span(&self, span: Span) -> bool {
        self.first_id_at_or_after(span.start);
        self.searched_offsets.get().1 < span.end
    }

    /// The comments between the token that starts at `token_start` and the token before it.
    pub(crate) fn comments_directly_before(&self, token_start: u32) -> CommentList<'a> {
        let end = self.first_id_at_or_after(token_start);
        let len = (0..end)
            .rev()
            .take_while(|id| {
                (self.comment(*id)).is_some_and(|comment| comment.next_token_start() == token_start)
            })
            .count() as u32;
        CommentList {
            file: self.file,
            ids: Ids::Consecutive {
                first: end - len,
                len,
            },
        }
    }

    /// The first of the comments directly before the token at `token_start` that is a leading comment. The ones before
    /// it trail the previous node.
    pub(crate) fn first_leading_comment_before(&self, token_start: u32) -> Option<Comment<'a>> {
        (self.comments_directly_before(token_start).iter()).find(|comment| {
            (self.attachment(*comment))
                .is_some_and(|attachment| attachment.placement == Placement::Leading)
        })
    }

    /// True if there's a comment between the token that starts at `token_start` and the token before it.
    pub(crate) fn has_comment_before(&self, token_start: u32) -> bool {
        !self.comments_directly_before(token_start).is_empty()
    }

    /// True if one of the comments directly before the token at `token_start` ends its line.
    pub(crate) fn has_leading_own_line_comment(&self, token_start: u32) -> bool {
        (self.comments_directly_before(token_start).iter())
            .any(|comment| comment.has_newline_after())
    }

    /// True if printing the node at `span` has to deal with comments at all. That's the case if a comment starts inside
    /// it, a node inside it owns a comment located elsewhere, or it contains type cast parentheses.
    #[inline]
    pub(crate) fn has_comment_or_owner_in(&self, span: Span) -> bool {
        self.has_comment_in_span(span)
            || self.file_comments.owners.has_relocated_owner_in(span)
            || self.has_cast_parenthesis_in(span)
    }

    /// `/** @type {T} */ (a).b`: the comment is before the member access, but the parentheses it applies to are inside
    /// it.
    #[inline]
    fn has_cast_parenthesis_in(&self, span: Span) -> bool {
        let cast_parens = &self.file_comments.cast_parens;
        !cast_parens.is_empty() && {
            let first = cast_parens.partition_point(|open_paren| *open_paren < span.start);
            (cast_parens.get(first)).is_some_and(|open_paren| *open_paren < span.end)
        }
    }

    // ───────────────────────────── kinds of comments ─────────────────────────────

    #[inline]
    pub(crate) fn has_type_cast_comments(&self) -> bool {
        !self.file_comments.cast_parens.is_empty()
    }

    /// True if the `(` at `open_paren` directly follows a type cast comment.
    pub(crate) fn is_cast_parenthesis(&self, open_paren: u32) -> bool {
        self.file_comments
            .cast_parens
            .binary_search(&open_paren)
            .is_ok()
    }

    /// True if the file has a `prettier-ignore` comment.
    #[inline]
    pub(crate) fn has_suppression_comments(&self) -> bool {
        self.file_comments.has_ignore_comments
    }

    #[inline]
    pub(crate) fn is_suppression_comment(&self, comment: Comment<'_>) -> bool {
        self.file_comments.has_ignore_comments && comment.is_ignore_comment(self.flavor)
    }

    // ───────────────────────────── printed comments ─────────────────────────────

    #[inline]
    pub(crate) fn is_printed(&self, comment: Comment<'_>) -> bool {
        (self.printed_bitset.get(comment.id() as usize / 64))
            .is_some_and(|word| word & (1 << (comment.id() % 64)) != 0)
    }

    /// Call before printing `comment`. Returns false if it was already printed, in which case it must not be printed
    /// again.
    pub(crate) fn mark_printed(&mut self, comment: Comment<'_>) -> bool {
        let Some(word) = self.printed_bitset.get_mut(comment.id() as usize / 64) else {
            return false;
        };
        let bit = 1 << (comment.id() % 64);
        if *word & bit != 0 {
            return false;
        }
        *word |= bit;
        self.printed_log.push(comment.id());
        true
    }

    /// Marks every comment inside `span` as printed, because the source text of `span` was copied to the output.
    pub(crate) fn mark_printed_in(&mut self, span: Span) {
        for comment in self.comments_in_span(span) {
            self.mark_printed(comment);
        }
    }

    /// The comment that was printed last.
    pub(crate) fn last_printed(&self) -> Option<Comment<'a>> {
        self.comment(*self.printed_log.last()?)
    }

    /// True if the last printed comment is a line comment that starts after `offset`.
    pub(crate) fn has_printed_line_comment_after(&self, offset: u32) -> bool {
        (self.last_printed())
            .is_some_and(|comment| comment.is_line() && comment.span().start > offset)
    }

    /// The comments that haven't been printed. There must be none once the file is formatted.
    pub(crate) fn unprinted(&self) -> impl Iterator<Item = Comment<'a>> + use<'a, '_> {
        (0..self.count())
            .filter_map(|id| self.comment(id))
            .filter(|comment| !self.is_printed(*comment))
    }

    /// For speculative formatting. [`Comments::restore`] unmarks everything printed since the snapshot.
    pub(crate) fn snapshot(&self) -> CommentSnapshot {
        CommentSnapshot {
            printed_log_len: self.printed_log.len(),
        }
    }

    pub(crate) fn restore(&mut self, snapshot: CommentSnapshot) {
        for id in self.printed_log.drain(snapshot.printed_log_len..) {
            if let Some(word) = self.printed_bitset.get_mut(id as usize / 64) {
                *word &= !(1 << (id % 64));
            }
        }
    }
}
