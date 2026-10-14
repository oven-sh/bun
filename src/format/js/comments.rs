//! The comments of a file, and which of them have been printed.
//!
//! Prettier attaches every comment to a node before it prints anything. This does what oxc does
//! instead: nothing is attached. The comments are kept in source order with a cursor,
//! `printed_count`. Whoever prints a node asks for the comments that are not printed yet and are
//! before, after or inside it, by position. Printing a comment moves the cursor.
//!
//! This only works if comments are printed in source order, and every comment is printed. Most
//! nodes have no comment near them, and find that out by one comparison: [`Comments::next_start`].
//!
//! Where Prettier attaches a comment to a node that it is not next to, so that it is printed
//! somewhere else, the comment is moved before anything is printed: see [`Comment::start`].

use super::ast_nodes::AstNodes;
use super::attach::{self, Attachment, Marker, Owner, Placement};
use super::owners::{OwnedComments, Owners};
use super::source_text::SourceText;
use crate::options::{Flavor, FormatOptions};
use bun_lint::ast::{Expr, ExprKind, File};
use bun_lint::span::{Span, Spanned};
use std::cell::Cell;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum CommentKind {
    /// `// ..`
    Line,
    /// `/* .. */` on one line
    SingleLineBlock,
    /// `/* .. */` over several lines
    MultiLineBlock,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct Comment {
    /// Where its text is.
    pub(crate) span: Span,
    /// See [`Comment::start`].
    moved_to: u32,
    /// Where the member access ends that it leads, if it has been moved to the start of that. Otherwise 0.
    leads_until: u32,
    pub(crate) kind: CommentKind,
    flags: u16,
    /// Where the token before it ends, and where the token after it starts.
    pub(crate) prev_token_end: u32,
    pub(crate) next_token_start: u32,
    /// Which of the dangling comments of its owner it is.
    pub(crate) marker: Marker,
    pub(crate) placement: Placement,
    /// The [`AstKind`](super::ast_nodes::AstKind) of its owner, for error messages.
    owner_kind: u8,
    /// Which of the comments of the file it is, in the order of the source.
    index: u32,
}

const NOT_MOVED: u32 = u32::MAX;

const PRECEDED_BY_NEWLINE: u16 = 1 << 0;
const FOLLOWED_BY_NEWLINE: u16 = 1 << 1;
const INDENTABLE: u16 = 1 << 2;
const TYPE_CAST: u16 = 1 << 3;
/// Prettier's `isTypeCastComment`, which is asked of the comment alone.
const LOOKS_LIKE_TYPE_CAST: u16 = 1 << 4;
/// See [`Flavor::is_ignore_comment`].
const SUPPRESSION: u16 = 1 << 5;
/// It is between the two sides of a declarator or an assignment and trails the left one.
const TRAILS_LEFT_SIDE: u16 = 1 << 6;
/// It trails the object of a member access, what is called or what a `!` follows, and has been moved to the end of
/// that.
const TRAILS_LINK: u16 = 1 << 7;
/// It leads a link of a member chain: it is written before the `.b`, `[b]`, `(..)` or `!`, and has been moved to the
/// end of what that follows.
const LEADS_LINK: u16 = 1 << 8;
/// Prettier's `comment.unignore`.
const UNIGNORED: u16 = 1 << 9;
/// Prettier's `mergeNestledJsdocComments` has made it part of the comment before it. Nothing owns it or prints it.
const MERGED_INTO_PREVIOUS: u16 = 1 << 10;

impl Comment {
    /// Without the delimiters.
    pub(crate) fn content_span(&self) -> Span {
        match self.kind {
            CommentKind::Line => self.span.shrink(2, 0),
            CommentKind::SingleLineBlock | CommentKind::MultiLineBlock => self.span.shrink(2, 2),
        }
    }

    /// Where it counts as being: what [`Comments`] goes by to tell what it is before, after and
    /// in, and what the comments are sorted by. That is where it is, unless it has been moved: then
    /// it is a position between two tokens, which is its [`Comment::end`] as well.
    #[inline]
    pub(crate) fn start(self) -> u32 {
        if self.moved_to == NOT_MOVED {
            self.span.start
        } else {
            self.moved_to
        }
    }

    #[inline]
    pub(crate) fn end(self) -> u32 {
        if self.moved_to == NOT_MOVED {
            self.span.end
        } else {
            self.moved_to
        }
    }

    #[inline]
    pub(crate) fn is_moved(self) -> bool {
        self.moved_to != NOT_MOVED
    }

    #[inline]
    pub(crate) fn is_line(self) -> bool {
        self.kind == CommentKind::Line
    }

    #[inline]
    pub(crate) fn is_block(self) -> bool {
        self.kind != CommentKind::Line
    }

    #[inline]
    pub(crate) fn is_multiline_block(self) -> bool {
        self.kind == CommentKind::MultiLineBlock
    }

    /// There is a line break between the previous token or comment and it, or it is the first
    /// thing in the file.
    #[inline]
    pub(crate) fn preceded_by_newline(self) -> bool {
        self.flags & PRECEDED_BY_NEWLINE != 0
    }

    /// There is a line break between it and the next token or comment. Always for a line comment.
    #[inline]
    pub(crate) fn followed_by_newline(self) -> bool {
        self.flags & FOLLOWED_BY_NEWLINE != 0
    }

    /// `a⏎// comment⏎.b.c`: whether it, which is before the node at `span`, leads a member access that the node starts
    /// with, here `a.b`, and not the node.
    #[inline]
    pub(crate) fn leads_left_edge_of(self, span: Span) -> bool {
        self.leads_until != 0 && self.leads_until < span.end
    }

    /// Prettier's `isTypeCastComment`.
    #[inline]
    pub(crate) fn looks_like_type_cast(self) -> bool {
        self.flags & LOOKS_LIKE_TYPE_CAST != 0
    }

    #[inline]
    pub(crate) fn is_merged_into_previous(self) -> bool {
        self.flags & MERGED_INTO_PREVIOUS != 0
    }

    /// The same, in a file where the parentheses after it are kept.
    #[inline]
    pub(crate) fn is_type_cast(self) -> bool {
        self.flags & TYPE_CAST != 0
    }

    /// See [`Flavor::is_ignore_comment`].
    #[inline]
    pub(crate) fn is_ignore_comment(self) -> bool {
        self.flags & SUPPRESSION != 0
    }

    /// Prettier's `isPrettierIgnoreComment`.
    #[inline]
    pub(crate) fn is_active_ignore_comment(self) -> bool {
        self.flags & (SUPPRESSION | UNIGNORED) == SUPPRESSION
    }

    /// The same comment, with what is known once it is attached.
    pub(crate) fn with_attachment(self, attachment: &Attachment<'_>) -> Comment {
        Comment {
            marker: attachment.marker,
            placement: attachment.placement,
            owner_kind: match attachment.owner {
                Owner::Node(node) => node.kind() as u8,
                Owner::Name(_) | Owner::CastParens(..) => u8::MAX,
            },
            flags: self.flags
                | if attachment.is_unignored {
                    UNIGNORED
                } else {
                    0
                },
            ..self
        }
    }

    pub(crate) fn owner_kind(self) -> u8 {
        self.owner_kind
    }

    /// Prettier's `isIndentableBlockComment`: it has several lines, and every line but the first
    /// starts with a `*`, so the stars can be lined up.
    #[inline]
    pub(crate) fn is_indentable_block(self) -> bool {
        self.flags & INDENTABLE != 0
    }
}

impl Spanned for Comment {
    #[inline]
    fn span(&self) -> Span {
        self.span
    }
}

/// Whose tree Prettier has.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum ParsedBy {
    WhatItsNameSays,
    /// Also if it is TypeScript: `babel-ts`.
    Babel,
}

/// Appends the comments of `file` to `comments`, in the order of the source.
pub(crate) fn collect_in_source_order<'a>(
    file: &'a File<'a>,
    flavor: Flavor,
    comments: &mut Vec<Comment>,
) {
    scan_comments(file, flavor, file.is_javascript(), comments);
}

fn scan_comments<'a>(
    file: &'a File<'a>,
    flavor: Flavor,
    has_tree_of_babel: bool,
    comments: &mut Vec<Comment>,
) {
    let text = file.text();
    let source = SourceText::new(text);
    let first = comments.len();
    let has_type_casts = has_tree_of_babel || type_casts_are_kept_in_typescript(flavor);
    for parsed_comment in file.comments_by_id() {
        let span = parsed_comment.span();
        let written = source.text_for(&span);
        let (content, kind) = match written {
            [b'/', b'/', content @ ..] => (content, CommentKind::Line),
            [b'/', b'*', content @ .., b'*', b'/'] if source.contains_newline(span) => {
                (content, CommentKind::MultiLineBlock)
            }
            [b'/', b'*', content @ .., b'*', b'/'] => (content, CommentKind::SingleLineBlock),
            _ => (&b""[..], CommentKind::SingleLineBlock),
        };
        let mut flags = 0;
        let before = text.get(..span.start as usize).unwrap_or_default();
        let is_first = before
            .strip_prefix(b"\xEF\xBB\xBF")
            .unwrap_or(before)
            .trim_ascii()
            .is_empty();
        if is_first || source.has_line_terminator_before(span.start) {
            flags |= PRECEDED_BY_NEWLINE;
        }
        if kind == CommentKind::Line || source.has_line_terminator_after(span.end) {
            flags |= FOLLOWED_BY_NEWLINE;
        }
        if kind == CommentKind::MultiLineBlock && is_indentable_text(content) {
            flags |= INDENTABLE;
        }
        if kind != CommentKind::Line && content.starts_with(b"*") && is_type_cast_text(content) {
            flags |= if has_type_casts {
                LOOKS_LIKE_TYPE_CAST | TYPE_CAST
            } else {
                LOOKS_LIKE_TYPE_CAST
            };
        }
        if flavor.is_ignore_comment(content.trim_ascii()) {
            flags |= SUPPRESSION;
        }
        // Prettier's `mergeNestledJsdocComments`. JSDoc has a form in which several `/** .. */` directly
        // follow each other, for the overloads of a function. They are one comment.
        let previous = (comments.get_mut(first..).unwrap_or_default().iter_mut())
            .rfind(|it| !it.is_merged_into_previous());
        if flags & INDENTABLE != 0
            && let Some(previous) = previous
            && previous.span.end == span.start
            && previous.flags & INDENTABLE != 0
        {
            previous.span.end = span.end;
            previous.flags =
                (previous.flags & !FOLLOWED_BY_NEWLINE) | (flags & !PRECEDED_BY_NEWLINE);
            // It keeps its place in the list, so that the index of a comment is its id.
            flags = MERGED_INTO_PREVIOUS;
        }
        comments.push(Comment {
            span,
            moved_to: NOT_MOVED,
            leads_until: 0,
            kind,
            flags,
            marker: Marker::None,
            placement: Placement::Dangling,
            owner_kind: u8::MAX,
            index: (comments.len() - first) as u32,
            prev_token_end: parsed_comment.prev_token_end(),
            next_token_start: parsed_comment.next_token_start(),
        });
    }
}

/// The comments of a file.
pub(crate) struct FileComments {
    /// By their ids, which is the order of the text.
    all: Vec<Comment>,
    owners: Owners,
    cast_parens: Vec<u32>,
}

impl FileComments {
    pub(crate) const EMPTY: FileComments = FileComments {
        all: Vec::new(),
        owners: Owners::EMPTY,
        cast_parens: Vec::new(),
    };

    pub(crate) fn iter(&self) -> impl Iterator<Item = &Comment> {
        self.all.iter().filter(|it| !it.is_merged_into_previous())
    }
}

pub(crate) static NO_COMMENTS: FileComments = FileComments::EMPTY;

/// Where the `(` are that directly follow a type cast comment. Sorted. If one is around an expression, Prettier keeps the
/// `ParenthesizedExpression`.
pub(crate) fn cast_parens(file: &File<'_>, comments: &[Comment]) -> Vec<u32> {
    let text = file.text();
    (comments.iter().enumerate())
        .filter(|(id, comment)| {
            comment.is_type_cast()
                && text.get(comment.next_token_start as usize) == Some(&b'(')
                && (comments.get(id + 1))
                    .is_none_or(|next| next.span.start > comment.next_token_start)
        })
        .map(|(_, comment)| comment.next_token_start)
        .collect()
}

/// The comments of `file`, which keeps them, so that they live as long as the handles.
pub(crate) fn of_file<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    parsed_by: ParsedBy,
) -> &'a FileComments {
    let comments = file.extension(|| {
        let has_tree_of_babel = parsed_by == ParsedBy::Babel || file.is_javascript();
        let mut comments = Vec::new();
        scan_comments(file, options.flavor, has_tree_of_babel, &mut comments);
        let how = attach::Options {
            has_tree_of_babel,
            experimental_ternaries: options.experimental_ternaries,
        };
        let cast_parens = cast_parens(file, &comments);
        let attached = attach::attach(file, &comments, &cast_parens, how);
        for (comment, attachment) in comments.iter_mut().zip(&attached.attachments) {
            *comment = comment.with_attachment(attachment);
        }
        let owners = Owners::new(file, &comments, attached);
        FileComments {
            all: comments,
            owners,
            cast_parens,
        }
    });
    comments.unwrap_or(&NO_COMMENTS)
}

/// `\s` for one byte. `u8::is_ascii_whitespace` does not know the vertical tab.
fn is_white_space(b: u8) -> bool {
    b.is_ascii_whitespace() || b == 0x0B
}

/// Only Babel, which Prettier parses JavaScript with, tells it about the parentheses after
/// `/** @type {T} */`. In TypeScript they are parentheses like any other. oxfmt keeps them there too.
fn type_casts_are_kept_in_typescript(flavor: Flavor) -> bool {
    flavor.is_oxfmt()
}

/// The object of a member access, what a call or a `new` calls, what a `!` follows. `None` if `link` is none of these.
pub(crate) fn inner_of_link(link: Expr<'_>) -> Option<Expr<'_>> {
    match link.kind() {
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => Some(obj),
        ExprKind::Call(call) | ExprKind::New(call) => Some(call.callee()),
        ExprKind::NonNull(operand) => Some(operand),
        _ => None,
    }
}

/// `content`: what is between `/*` and `*/`.
fn is_indentable_text(content: &[u8]) -> bool {
    let mut lines = bun_core::strings::split_crlf_lines(content)
        .skip(1)
        .peekable();
    if lines.peek().is_none() {
        return false;
    }
    while let Some(line) = lines.next() {
        let line = bun_core::strings::trim_js_whitespace_start(line);
        // The last line goes on with the `*` of `*/`.
        if !line.starts_with(b"*") && !(line.is_empty() && lines.peek().is_none()) {
            return false;
        }
    }
    true
}

/// Prettier's `/@(?:type|satisfies)\b/`.
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

/// The state of a [`Comments`], to go back to after formatting something only to see what comes
/// out.
#[derive(Clone, Copy)]
pub(crate) struct CommentSnapshot {
    printed_count: usize,
    view_limit: Option<usize>,
    printed_log_len: usize,
}

pub(crate) struct Comments<'a> {
    source_text: SourceText<'a>,
    inner: &'a [Comment],
    /// Every comment of the file, in source order.
    all: &'a [Comment],
    owners: &'a Owners,
    cast_parens: &'a [u32],
    /// The result of the last search in `all`. Nodes are mostly printed in source order, so the next search starts here.
    search_hint: Cell<usize>,
    /// A bit for each comment, by its index: it is printed.
    printed_bitset: Vec<u64>,
    /// The indices of those that are printed, in the order in which they were.
    printed_log: Vec<u32>,
    /// `inner[..printed_count]` are printed, and the next one is not.
    printed_count: usize,
    /// `printed_count` when the last type cast was printed.
    /// The comments from this index on are hidden.
    view_limit: Option<usize>,
    /// Some comment is a type cast: `/** @type {T} */ (e)`.
    has_type_cast_comments: bool,
    has_suppression_comments: bool,
    /// See [`Comments::mark_suppressed_after_operator`].
    suppressed_after_operator: u32,
    /// See [`Comments::hide_comments_from`].
    hidden_from: usize,
}

/// How many of `comments`, from the first one on, end before `pos`.
///
/// The ends ascend as the starts do: a moved comment has no width, and comes before a comment that
/// starts where it is. Mostly the answer is 0 or 1, but all comments in a node are before its end.
fn count_that_end_before(comments: &[Comment], pos: u32) -> usize {
    const NEAR: usize = 4;
    let near = comments
        .iter()
        .take(NEAR)
        .take_while(|comment| comment.end() < pos)
        .count();
    match comments.get(NEAR..) {
        Some(rest) if near == NEAR => NEAR + rest.partition_point(|comment| comment.end() < pos),
        _ => near,
    }
}

impl<'a> Comments<'a> {
    pub(crate) fn new(source_text: SourceText<'a>, comments: &'a FileComments) -> Self {
        let owners = &comments.owners;
        let cast_parens = &comments.cast_parens[..];
        let comments = &comments.all[..];
        let flags = comments
            .iter()
            .fold(0, |flags, comment| flags | comment.flags);
        Comments {
            source_text,
            inner: &[],
            all: comments,
            owners,
            cast_parens,
            search_hint: Cell::new(0),
            printed_bitset: vec![0; comments.len().div_ceil(64)],
            printed_log: Vec::new(),
            printed_count: 0,
            view_limit: None,
            has_type_cast_comments: flags & TYPE_CAST != 0,
            has_suppression_comments: flags & SUPPRESSION != 0,
            suppressed_after_operator: u32::MAX,
            hidden_from: usize::MAX,
        }
    }

    /// Where the first comment that is not printed starts. `u32::MAX` if there is none.
    ///
    /// Nothing before this position has to think about comments.
    #[inline]
    pub(crate) fn next_start(&self) -> u32 {
        self.unprinted_comments()
            .first()
            .map_or(u32::MAX, |c| c.start())
    }

    /// Prettier's `__contentEnd`: `span`, which is that of a statement, without the `;` at its end
    /// and the comments before that. They are not in the statement but behind it:
    /// `a() /* comment */;` is `a(); /* comment */`.
    pub(crate) fn without_semicolon(&self, span: Span) -> Span {
        if span.is_empty() || self.source_text.byte_at(span.end - 1) != Some(b';') {
            return span;
        }
        let mut end = span.end - 1;
        loop {
            while end > span.start
                && self
                    .source_text
                    .byte_at(end - 1)
                    .is_some_and(is_white_space)
            {
                end -= 1;
            }
            let at = self.inner.partition_point(|comment| comment.end() < end);
            match self.inner.get(at) {
                Some(comment)
                    if comment.end() == end && (span.start..end).contains(&comment.start()) =>
                {
                    end = comment.start()
                }
                _ => return Span::new(span.start, end),
            }
        }
    }

    /// Prettier's `handleMethodNameComments` for the comments at the end of a member of a class, which
    /// is at `span`: those with code behind them on their line, a `)` or the `;`, trail the member,
    /// unless they start the line. Where they start. The others are in the member.
    ///
    /// `value_end`: where the value of the member ends, without parentheses.
    pub(crate) fn start_of_comments_before_semicolon(
        &self,
        value_end: Option<u32>,
        span: Span,
    ) -> u32 {
        let content_end = self.without_semicolon(span).end;
        let comments = self.comments_in(Span::new(value_end.unwrap_or(content_end), span.end));
        let is_on_same_line = |from: u32, to: u32| {
            self.source_text.all_bytes(Span::new(from, to), |b| {
                matches!(b, b' ' | b'\t' | b')' | b';')
            })
        };
        let mut first = comments.len();
        while first > 0
            && is_on_same_line(
                comments[first - 1].end(),
                comments.get(first).map_or(span.end, |next| next.start()),
            )
        {
            first -= 1;
        }
        match comments.get(first) {
            // At the very end it has no code behind it.
            Some(comment)
                if !comment.preceded_by_newline()
                    && comments.last().is_some_and(|last| last.end() < span.end) =>
            {
                comment.start()
            }
            _ => span.end,
        }
    }

    /// Whether any comment of the file is a type cast.
    #[inline]
    pub(crate) fn has_type_cast_comments(&self) -> bool {
        self.has_type_cast_comments
    }

    #[inline]
    pub(crate) fn unprinted_comments(&self) -> &'a [Comment] {
        let end = self
            .view_limit
            .unwrap_or(self.inner.len())
            .min(self.hidden_from);
        self.inner.get(self.printed_count..end).unwrap_or_default()
    }

    #[inline]
    pub(crate) fn first_unprinted_span(&self) -> Option<Span> {
        self.unprinted_comments().first().map(|c| c.span)
    }

    #[inline]
    pub(crate) fn printed_comments(&self) -> &'a [Comment] {
        self.inner.get(..self.printed_count).unwrap_or_default()
    }

    /// The comments that end at or before `pos`.
    pub(crate) fn comments_before_iter(
        &self,
        pos: u32,
    ) -> impl Iterator<Item = &'a Comment> + use<'a> {
        self.unprinted_comments()
            .iter()
            .take_while(move |c| c.end() <= pos)
    }

    /// The comments that end at or before `pos`.
    pub(crate) fn comments_before(&self, pos: u32) -> &'a [Comment] {
        let count = self.comments_before_iter(pos).count();
        &self.unprinted_comments()[..count]
    }

    /// The comments that lead the node at `span`: those before it, but for what leads something that it starts with.
    /// For Prettier that is part of what is written for the node, and breaks the groups in it.
    pub(crate) fn comments_leading_node(&self, span: Span) -> &'a [Comment] {
        let count = self
            .comments_before_iter(span.start)
            .take_while(|comment| !comment.leads_left_edge_of(span))
            .count();
        &self.unprinted_comments()[..count]
    }

    /// The comments up to the end of the node at `span`. One that has been moved to where the node
    /// ends is behind it.
    pub(crate) fn comments_before_end_of(&self, span: Span) -> &'a [Comment] {
        let count = self
            .comments_before_iter(span.end)
            .take_while(|c| !c.is_moved() || c.end() < span.end)
            .count();
        &self.unprinted_comments()[..count]
    }

    /// Of the comments that end at or before `pos`, the first ones that start their line.
    pub(crate) fn own_line_comments_before(&self, pos: u32) -> &'a [Comment] {
        let count = self
            .comments_before_iter(pos)
            .take_while(|c| c.preceded_by_newline())
            .count();
        &self.unprinted_comments()[..count]
    }

    /// The comments after `pos` up to one that ends its line, if nothing but blanks, `=`, `:` and
    /// `,` is in between.
    pub(crate) fn end_of_line_comments_after(&self, pos: u32) -> &'a [Comment] {
        self.end_of_line_comments_after_bytes(pos, |b| {
            matches!(b, b'\t' | b' ' | b'=' | b':' | b',')
        })
    }

    /// The comments that trail the left side of a declarator or an assignment whose right side starts
    /// at `right_start`. The left side is written.
    pub(crate) fn comments_trailing_left_side(&self, right_start: u32) -> &'a [Comment] {
        let comments = self.unprinted_comments();
        let count = (comments.iter())
            .take_while(|comment| {
                comment.flags & TRAILS_LEFT_SIDE != 0 && comment.start() < right_start
            })
            .count();
        &comments[..count]
    }

    /// The next comments, as far as they trail what ends at `end` and is written: the object of a member access, what
    /// is called or what a `!` follows. Those in it that nothing has written are among them.
    pub(crate) fn comments_trailing_link(&self, end: u32) -> &'a [Comment] {
        let comments = self.unprinted_comments();
        let count = (comments.iter())
            .take_while(|comment| {
                comment.end() < end || (comment.moved_to == end && comment.flags & TRAILS_LINK != 0)
            })
            .count();
        &comments[..count]
    }

    /// The next comments, as far as they lead the link of a member chain that follows what ends at `inner_end`.
    pub(crate) fn comments_leading_link(&self, inner_end: u32) -> &'a [Comment] {
        let comments = self.unprinted_comments();
        let count = (comments.iter())
            .take_while(|comment| comment.moved_to == inner_end && comment.flags & LEADS_LINK != 0)
            .count();
        &comments[..count]
    }

    /// Whether there are [`Comments::comments_trailing_link`], whatever is to be written before them.
    pub(crate) fn has_comment_trailing_link(&self, end: u32) -> bool {
        self.has_comment_moved_to(end, TRAILS_LINK)
    }

    /// Whether there are [`Comments::comments_leading_link`], whatever is to be written before them.
    pub(crate) fn has_comment_leading_link(&self, inner_end: u32) -> bool {
        self.has_comment_moved_to(inner_end, LEADS_LINK)
    }

    fn has_comment_moved_to(&self, position: u32, flag: u16) -> bool {
        (self.comments_after(position).iter())
            .take_while(|comment| comment.start() == position)
            .any(|comment| comment.flags & flag != 0)
    }

    /// Prettier's `handlePropertyComments`: the comments between the key of a property, which ends at
    /// `key_end`, and its value, which starts at `value_start`, that lead the property: those that end
    /// their line. None if one before them does not.
    pub(crate) fn comments_leading_property(
        &self,
        key_end: u32,
        value_start: u32,
    ) -> &'a [Comment] {
        let comments = self.comments_in(Span::new(key_end, value_start));
        // One that starts its line leads the value, and so does a type comment: Prettier's
        // `handleClosureTypeCastComments` comes first.
        let count = (comments.iter())
            .take_while(|comment| {
                !comment.preceded_by_newline() && !self.looks_like_type_cast_comment(comment)
            })
            .count();
        let comments = &comments[..count];
        let count = comments
            .iter()
            .rposition(|comment| comment.followed_by_newline())
            .map_or(0, |last| last + 1);
        let comments = &comments[..count];
        let ends_line = |(index, comment): (usize, &Comment)| {
            !comment.is_moved()
                && (comment.followed_by_newline()
                    || comments.get(index + 1).is_some_and(|next| {
                        self.source_text
                            .all_bytes(Span::new(comment.end(), next.start()), |b| {
                                matches!(b, b' ' | b'\t')
                            })
                    }))
        };
        match comments.iter().enumerate().all(ends_line) {
            true => comments,
            false => &[],
        }
    }

    fn end_of_line_comments_after_bytes(
        &self,
        mut pos: u32,
        can_be_between: impl Fn(u8) -> bool,
    ) -> &'a [Comment] {
        let comments = self.comments_after(pos);
        for (index, comment) in comments.iter().enumerate() {
            if !self
                .source_text
                .all_bytes(Span::new(pos, comment.start()), &can_be_between)
            {
                break;
            }
            if comment.is_line() || comment.followed_by_newline() {
                return &comments[..=index];
            }
            pos = comment.end();
        }
        &[]
    }

    /// The comments that end at or after `pos`.
    pub(crate) fn comments_after(&self, pos: u32) -> &'a [Comment] {
        let comments = self.unprinted_comments();
        &comments[count_that_end_before(comments, pos)..]
    }

    /// The comments in `span`.
    pub(crate) fn comments_in(&self, span: Span) -> &'a [Comment] {
        let comments = self.comments_after(span.start);
        &comments[..count_that_end_before(comments, span.end.saturating_add(1))]
    }

    /// The comments after `start` that are before the first `character` outside of a comment.
    pub(crate) fn comments_before_character(&self, mut start: u32, character: u8) -> &'a [Comment] {
        let comments = self.comments_after(start);
        // Nor in a comment that is printed.
        let printed = self.printed_comments();
        let first = printed.len()
            - printed
                .iter()
                .rev()
                .take_while(|it| it.span.start >= start)
                .count();
        // One that has been moved is printed ahead of its turn.
        for comment in printed[first..].iter().filter(|it| !it.is_moved()) {
            if self
                .source_text
                .contains_byte(Span::before(start, comment.span), character)
            {
                return &[];
            }
            start = comment.span.end;
        }
        for (index, comment) in comments.iter().enumerate() {
            if self
                .source_text
                .contains_byte(Span::new(start, comment.start()), character)
            {
                return &comments[..index];
            }
            start = comment.end();
        }
        comments
    }

    #[inline]
    pub(crate) fn has_comment_in_range(&self, start: u32, end: u32) -> bool {
        self.next_start() < end && self.comments_before_iter(end).any(|c| c.end() > start)
    }

    #[inline]
    pub(crate) fn has_comment_in_span(&self, span: Span) -> bool {
        self.has_comment_in_range(span.start, span.end)
    }

    #[inline]
    pub(crate) fn has_comment_before(&self, start: u32) -> bool {
        self.unprinted_comments()
            .first()
            .is_some_and(|c| c.end() <= start)
    }

    /// Whether a comment before `start` ends its line.
    pub(crate) fn has_leading_own_line_comment(&self, start: u32) -> bool {
        self.comments_before_iter(start)
            .any(|c| c.followed_by_newline())
    }

    /// Has to be called for each comment that is printed.
    #[inline]
    pub(crate) fn is_printed(&self, comment: &Comment) -> bool {
        (self.printed_bitset.get(comment.index as usize / 64))
            .is_some_and(|word| word & (1 << (comment.index % 64)) != 0)
    }

    /// Notes that `comment` is printed. Returns whether it was not before: whoever is told no does not print it again.
    pub(crate) fn mark_printed(&mut self, comment: &Comment) -> bool {
        let Some(word) = self.printed_bitset.get_mut(comment.index as usize / 64) else {
            return false;
        };
        let bit = 1 << (comment.index % 64);
        if *word & bit != 0 {
            return false;
        }
        *word |= bit;
        self.printed_log.push(comment.index);
        while let Some(next) = self.inner.get(self.printed_count)
            && self.is_printed(next)
        {
            self.printed_count += 1;
        }
        true
    }

    /// The comments that `node` owns.
    #[inline]
    pub(crate) fn of_node(&self, node: AstNodes<'_>) -> OwnedComments<'a> {
        self.owners.of_node(node)
    }

    /// The comments owned by the name or key that starts at `start`.
    #[inline]
    pub(crate) fn of_name(&self, start: u32) -> OwnedComments<'a> {
        self.owners.of_name(start)
    }

    /// The comments owned by the type-cast parentheses that open at `open_paren`.
    #[inline]
    pub(crate) fn of_cast_parens(&self, open_paren: u32) -> OwnedComments<'a> {
        self.owners.of_cast_parens(open_paren)
    }

    /// Whether `node` is printed verbatim because of a `prettier-ignore` comment.
    #[inline]
    pub(crate) fn is_ignored(&self, node: AstNodes<'_>) -> bool {
        self.has_suppression_comments && self.owners.of_node(node).is_ignored
    }

    /// The index in `all` of the first comment that starts at or after `pos`.
    fn index_at_or_after(&self, pos: u32) -> usize {
        const MAX_STEPS: usize = 4;
        let starts_before = |index: usize| self.all.get(index).is_some_and(|c| c.span.start < pos);
        let mut index = self.search_hint.get().min(self.all.len());
        let mut steps = 0;
        while index > 0 && !starts_before(index - 1) && steps < MAX_STEPS {
            index -= 1;
            steps += 1;
        }
        while starts_before(index) && steps < MAX_STEPS {
            index += 1;
            steps += 1;
        }
        if steps == MAX_STEPS {
            index = self.all.partition_point(|c| c.span.start < pos);
        }
        self.search_hint.set(index);
        index
    }

    /// The comments whose text starts inside `span`, in source order, printed or not.
    pub(crate) fn comments_in_span(&self, span: Span) -> &'a [Comment] {
        let first = self.index_at_or_after(span.start);
        let rest = self.all.get(first..).unwrap_or_default();
        let count = rest.iter().take_while(|c| c.span.start < span.end).count();
        rest.get(..count).unwrap_or_default()
    }

    /// Whether printing the node at `span` has to look at comments at all: a comment starts inside it, or something
    /// inside it owns a comment that is written elsewhere.
    pub(crate) fn has_comment_or_owner_in(&self, span: Span) -> bool {
        let first = self.index_at_or_after(span.start);
        self.all.get(first).is_some_and(|c| c.span.start < span.end)
            || self.owners.has_relocated_owner_in(span)
    }

    /// The comments that have not been printed. After a file is formatted there must be none.
    pub(crate) fn unprinted(&self) -> impl Iterator<Item = &'a Comment> + use<'a, '_> {
        (self.all.iter())
            .filter(|comment| !comment.is_merged_into_previous() && !self.is_printed(comment))
    }

    /// Marks every comment inside `span` as printed: the source text of `span` has been copied to the output.
    pub(crate) fn mark_printed_in(&mut self, span: Span) {
        for comment in self.comments_in_span(span) {
            self.mark_printed(comment);
        }
    }

    /// The comments to print after the node at `preceding_span`.
    ///
    /// `enclosing_span`: its parent. `following_span_start`: where the next sibling starts, or 0.
    pub(crate) fn get_trailing_comments(
        &self,
        enclosing_span: Span,
        preceding_span: Span,
        following_span_start: u32,
    ) -> &'a [Comment] {
        let comments = self.unprinted_comments();
        if comments.is_empty() {
            return &[];
        }
        let source_text = self.source_text;
        // It is attached to a link of a member chain that is not the node.
        let is_of_other_link = |comment: &Comment| {
            comment.flags & LEADS_LINK != 0
                || (comment.flags & TRAILS_LINK != 0 && comment.moved_to != preceding_span.end)
        };

        if following_span_start == 0 {
            // What is left at the end of the parent.
            let comments = self.comments_before(enclosing_span.end);
            let mut start = preceding_span.end;
            for (index, comment) in comments.iter().enumerate() {
                if is_of_other_link(comment) {
                    return &comments[..index];
                }
                // It is inside the node.
                if start > comment.start() {
                    continue;
                }
                let is_adjacent = source_text.all_bytes(Span::new(start, comment.start()), |b| {
                    b.is_ascii_whitespace() || matches!(b, b')' | b',' | b';')
                });
                if !is_adjacent {
                    return &comments[..index];
                }
                start = comment.end();
            }
            return comments;
        }

        let mut comment_index = 0;
        // So many trail the node whatever follows them: the last of them ends its line.
        let mut trailing_count = 0;
        let mut type_cast_comment = None;
        while let Some(comment) = comments.get(comment_index) {
            if comment.end() > following_span_start
                || comment.end() > enclosing_span.end
                || is_of_other_link(comment)
            {
                break;
            }
            if comment.is_moved() && comment.flags & (TRAILS_LEFT_SIDE | TRAILS_LINK) != 0 {
                // It has been moved to here because it does.
                trailing_count = comment_index + 1;
            } else if following_span_start > enclosing_span.end
                && comment.end() <= enclosing_span.end
            {
                // The next sibling is outside of the parent and the comment is inside.
            } else if comment.flags & LOOKS_LIKE_TYPE_CAST != 0 {
                // Prettier's `handleClosureTypeCastComments`. `a || /** @type {T} */ (b)`: it leads the
                // next sibling.
                type_cast_comment = Some(comment);
                break;
            } else if comment.preceded_by_newline() || comment.is_moved() {
                // On a line of its own, or moved to where it is: it leads the next sibling.
                break;
            } else if comment.followed_by_newline() {
                trailing_count = comment_index + 1;
            }
            comment_index += 1;
        }

        // From the end, those that have nothing but blanks and `(` between them and the next
        // sibling lead it.
        let mut gap_end = type_cast_comment.map_or(following_span_start, |c| c.start());
        for (index, comment) in comments[..comment_index]
            .iter()
            .enumerate()
            .skip(trailing_count)
            .rev()
        {
            let is_adjacent = source_text.all_bytes(Span::new(comment.end(), gap_end), |b| {
                b.is_ascii_whitespace() || b == b'('
            });
            if !is_adjacent {
                return &comments[..=index];
            }
            gap_end = comment.start();
        }
        &comments[..trailing_count]
    }

    /// Whether any comment of the file is `prettier-ignore`.
    #[inline]
    pub(crate) fn has_suppression_comments(&self) -> bool {
        self.has_suppression_comments
    }

    /// Whether a `prettier-ignore` comment leads the node that starts at `start`.
    #[inline]
    pub(crate) fn is_suppressed(&self, start: u32) -> bool {
        self.has_suppression_comments
            && (self.suppressed_after_operator == start
                || self
                    .comments_before_iter(start)
                    .any(|comment| self.is_suppression_comment(comment)))
    }

    /// `a = // prettier-ignore ⏎ b`, as oxfmt has it: the comment is written behind the operator, and
    /// is about what starts at `start` all the same.
    pub(crate) fn mark_suppressed_after_operator(&mut self, start: u32) {
        self.suppressed_after_operator = start;
    }

    /// Whether the comment that was written last is a line comment that starts after `pos`.
    pub(crate) fn has_printed_line_comment_after(&self, pos: u32) -> bool {
        self.printed_comments()
            .last()
            .is_some_and(|comment| comment.is_line() && comment.span.start > pos)
    }

    /// Whether there is a comment in `span`, written or not.
    pub(crate) fn has_any_comment_in(&self, span: Span) -> bool {
        let first = self
            .inner
            .partition_point(|comment| comment.end() < span.start);
        self.inner
            .get(first)
            .is_some_and(|comment| comment.end() <= span.end)
    }

    /// The position behind the first `character` after `start` that is not in a comment. `start` if
    /// there is none.
    pub(crate) fn position_after_character(&self, start: u32, character: u8) -> u32 {
        let first = self.inner.partition_point(|comment| comment.end() <= start);
        let mut from = start;
        let comments = self
            .inner
            .get(first..)
            .unwrap_or_default()
            .iter()
            .filter(|comment| !comment.is_moved());
        for to in comments
            .map(|comment| comment.span)
            .chain([Span::new(u32::MAX, u32::MAX)])
        {
            let gap_end = to.start.min(self.source_text.as_bytes().len() as u32);
            let gap = self.source_text.text_for(&Span::new(from, gap_end));
            if let Some(at) = bun_core::strings::index_of_char_usize(gap, character) {
                return from + at as u32 + 1;
            }
            from = from.max(to.end);
        }
        start
    }

    /// Whether a `prettier-ignore` comment trails the node that ends at `pos`: Prettier goes by any
    /// comment of a node. `statement(); // prettier-ignore`, and on a line of its own if nothing
    /// follows in what the node is in.
    #[inline]
    pub(crate) fn has_trailing_suppression_comment(&self, pos: u32) -> bool {
        self.has_suppression_comments && self.find_trailing_suppression_comment(pos)
    }

    fn find_trailing_suppression_comment(&self, pos: u32) -> bool {
        // One that leads the next link of a chain has been moved here too.
        let is_one = |it: &Comment| self.is_suppression_comment(it) && it.flags & LEADS_LINK == 0;
        if self.end_of_line_comments_after(pos).iter().any(is_one) {
            return true;
        }
        let (mut reached, mut is_suppressed) = (pos, false);
        for comment in self.comments_after(pos) {
            let gap = Span::new(reached, comment.start());
            let is_adjacent = self
                .source_text
                .all_bytes(gap, |b| b.is_ascii_whitespace() || matches!(b, b',' | b';'));
            if !is_adjacent {
                break;
            }
            is_suppressed |= is_one(comment);
            reached = comment.end();
        }
        is_suppressed
            && matches!(
                self.source_text
                    .as_bytes()
                    .get(reached as usize..)
                    .unwrap_or_default()
                    .trim_ascii_start()
                    .first(),
                None | Some(b'}' | b']' | b')')
            )
    }

    /// See [`Flavor::is_ignore_comment`].
    #[inline]
    pub(crate) fn is_suppression_comment(&self, comment: &Comment) -> bool {
        comment.flags & SUPPRESSION != 0
    }

    /// Prettier's `isTypeCastComment`: a JSDoc comment with `@type` or `@satisfies`, whatever follows it.
    #[inline]
    pub(crate) fn looks_like_type_cast_comment(&self, comment: &Comment) -> bool {
        comment.flags & LOOKS_LIKE_TYPE_CAST != 0
    }

    /// A JSDoc comment with `@type` or `@satisfies`, in a file where the parentheses after it stay.
    #[inline]
    pub(crate) fn is_type_cast_comment(&self, comment: &Comment) -> bool {
        comment.flags & TYPE_CAST != 0
    }

    /// Among the comments before `span`, the index of the first type cast comment that is
    /// followed by a `(`.
    pub(crate) fn get_type_cast_comment_index(&self, span: Span) -> Option<usize> {
        self.comments_before_iter(span.start).position(|comment| {
            self.is_type_cast_comment(comment)
                && self
                    .source_text
                    .next_non_whitespace_byte_is(comment.end(), b'(')
        })
    }

    /// Whether the `(` at `open` follows a type cast comment with nothing but white space in between.
    /// If it is around an expression, Prettier keeps the `ParenthesizedExpression`.
    pub(crate) fn is_cast_parenthesis(&self, open: u32) -> bool {
        self.cast_parens.binary_search(&open).is_ok()
    }

    /// Hides the comments that start at or after `position`, whatever is shown or hidden with the other
    /// functions in the meantime. Returns what to pass to [`Comments::restore_hidden_comments`].
    pub(crate) fn hide_comments_from(&mut self, position: u32) -> usize {
        let first = self
            .inner
            .partition_point(|comment| comment.start() < position);
        let previous = self.hidden_from;
        self.hidden_from = first.min(previous);
        previous
    }

    pub(crate) fn restore_hidden_comments(&mut self, hidden_from: usize) {
        self.hidden_from = hidden_from;
    }

    /// Hides the comments that start at or after `end_pos`. Returns what to pass to
    /// [`Comments::restore_view_limit`].
    pub(crate) fn limit_comments_up_to(&mut self, end_pos: u32) -> Option<usize> {
        let original = self.view_limit;
        let rest = self.inner.get(self.printed_count..).unwrap_or_default();
        let limit = self.printed_count + rest.partition_point(|c| c.start() < end_pos);
        if limit < self.inner.len() {
            self.view_limit = Some(limit);
        }
        original
    }

    #[inline]
    pub(crate) fn restore_view_limit(&mut self, limit: Option<usize>) {
        self.view_limit = limit;
    }

    pub(crate) fn snapshot(&self) -> CommentSnapshot {
        CommentSnapshot {
            printed_count: self.printed_count,
            view_limit: self.view_limit,
            printed_log_len: self.printed_log.len(),
        }
    }

    pub(crate) fn restore(&mut self, snapshot: CommentSnapshot) {
        for index in self.printed_log.drain(snapshot.printed_log_len..) {
            if let Some(word) = self.printed_bitset.get_mut(index as usize / 64) {
                *word &= !(1 << (index % 64));
            }
        }
        self.printed_count = snapshot.printed_count;
        self.view_limit = snapshot.view_limit;
    }

    /// Marks the comments that end at or before `pos` as printed.
    pub(crate) fn skip_comments_before(&mut self, pos: u32) {
        for comment in self.comments_before(pos) {
            self.mark_printed(comment);
        }
    }
}
