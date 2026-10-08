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

use super::source_text::SourceText;
use bun_lint::ast::{Expr, ExprKind, File, FnBody, Func, Node, PropKind, StmtKind, TypeKind};
use bun_lint::span::{Span, Spanned};
use bun_lint::tokens::TokenKind;

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
    pub(crate) kind: CommentKind,
    flags: u8,
}

const NOT_MOVED: u32 = u32::MAX;

const PRECEDED_BY_NEWLINE: u8 = 1 << 0;
const FOLLOWED_BY_NEWLINE: u8 = 1 << 1;
const INDENTABLE: u8 = 1 << 2;
const TYPE_CAST: u8 = 1 << 3;

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
        if self.moved_to == NOT_MOVED { self.span.start } else { self.moved_to }
    }

    #[inline]
    pub(crate) fn end(self) -> u32 {
        if self.moved_to == NOT_MOVED { self.span.end } else { self.moved_to }
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

/// Appends the comments of `file` to `comments`.
pub(crate) fn collect<'a>(file: &'a File<'a>, comments: &mut Vec<Comment>) {
    let text = file.text();
    let source = SourceText::new(text);
    let first = comments.len();
    for token in file.comments() {
        let span = token.span();
        let content = token.comment_value();
        let kind = match token.kind() {
            TokenKind::Line => CommentKind::Line,
            TokenKind::Block if source.contains_newline(span) => CommentKind::MultiLineBlock,
            TokenKind::Block => CommentKind::SingleLineBlock,
            _ => continue,
        };
        let mut flags = 0;
        let is_first = text.get(..span.start as usize).unwrap_or_default().trim_ascii().is_empty();
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
            flags |= TYPE_CAST;
        }
        comments.push(Comment {
            span,
            moved_to: NOT_MOVED,
            kind,
            flags,
        });
    }
    move_comments(file, comments.get_mut(first..).unwrap_or_default());
}

/// Finds nodes by position.
struct NodeFinder<'a> {
    file: &'a File<'a>,
    /// The statement of the file that the last position was in. The next one is likely to be in it
    /// too, and a file can have many statements.
    statement: Option<Node<'a>>,
}

impl<'a> NodeFinder<'a> {
    fn child_at(node: Node<'a>, offset: u32) -> Option<Node<'a>> {
        let mut found = None;
        node.for_each_child(|child| {
            if found.is_none() && child.span().contains_offset(offset) {
                found = Some(child);
            }
        });
        found
    }

    /// The innermost node that `offset` is in.
    fn innermost_node_at(&mut self, offset: u32) -> Node<'a> {
        if !self.statement.is_some_and(|it| it.span().contains_offset(offset)) {
            self.statement = Self::child_at(Node::File(self.file), offset);
        }
        let Some(mut node) = self.statement else {
            return Node::File(self.file);
        };
        while let Some(child) = Self::child_at(node, offset) {
            node = child;
        }
        node
    }
}

/// Prettier's `handleMemberExpressionComments`: a comment on a line of its own before the property
/// of a member expression, if that is a name, leads the member expression.
///
/// In a chain of calls Prettier prints the comments of a member expression before its `.b`, which is
/// where they are.
fn moved_out_of_member_expression<'a>(nodes: &mut NodeFinder<'a>, comment: Comment) -> Option<u32> {
    let Node::Expr(member) = nodes.innermost_node_at(comment.span.start) else {
        return None;
    };
    let (object, property_start) = match member.kind() {
        ExprKind::Dot { obj, name, .. } if !name.bytes().starts_with(b"#") => (obj, name.span().start),
        ExprKind::Index { obj, index, .. } if matches!(index.kind(), ExprKind::Ident(_)) => (obj, index.span().start),
        _ => return None,
    };
    if comment.span.start < object.span().end || property_start < comment.span.end {
        return None;
    }
    let mut top: Expr<'a> = member;
    while let Node::Expr(parent) = top.parent() {
        match parent.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == top => top = parent,
            ExprKind::NonNull(inner) if inner == top => top = parent,
            ExprKind::Call(call) if call.callee() == top => return None,
            ExprKind::Jsx(_) => return None,
            _ => break,
        }
    }
    Some(member.span().start)
}

/// Prettier's `handlePropertyComments`: a comment at the end of a line that is in a property of an
/// object and in nothing in it leads the property. This is for one after the value, which is in
/// parentheses then.
fn moved_out_of_property(nodes: &mut NodeFinder<'_>, comment: Comment) -> Option<u32> {
    let Node::Prop(property) = nodes.innermost_node_at(comment.span.start) else {
        return None;
    };
    let is_in_object = matches!(property.parent(), Node::Expr(object) if matches!(object.kind(), ExprKind::Object(_)));
    let value = property.value()?;
    (is_in_object && property.kind() == PropKind::Init && value.span().end <= comment.span.start)
        .then(|| property.span().start)
}

/// A comment before the `(` of the parameters at `open_paren`.
///
/// For a function with a body Prettier has `handleFunctionNameComments`: it trails the name. For
/// anything else there is no rule, and no node for the parentheses. So the comment is between what
/// is before the parameters and the first parameter, which it leads, the `(` counting for nothing.
/// Without parameters it leads the return type, if nothing is before it that it can trail.
fn moved_over_parenthesis<'a>(nodes: &mut NodeFinder<'a>, comment: Comment, open_paren: u32) -> Option<u32> {
    let (func, has_name): (Func<'a>, bool) = match nodes.innermost_node_at(comment.span.start) {
        Node::Member(member) if member.is_signature() => (member.func()?, member.key().is_some()),
        Node::Type(ty) => match ty.kind() {
            TypeKind::Fn(func) => (func, false),
            _ => return None,
        },
        Node::Func(func) if matches!(func.body(), FnBody::None) => match func.owner() {
            Node::Member(member) if member.is_signature() => (func, member.key().is_some()),
            Node::Type(_) => (func, false),
            Node::Stmt(statement) if matches!(statement.kind(), StmtKind::Fn(_)) => (func, true),
            _ => return None,
        },
        _ => return None,
    };
    if func.open_paren() != Some(open_paren) {
        return None;
    }
    let follows_something = has_name || !func.type_params().is_empty();
    if func.params_with_this().next().is_some() {
        // At the end of a line it trails what is before it.
        return (!follows_something || !comment.followed_by_newline()).then_some(open_paren + 1);
    }
    if follows_something || func.return_type().is_none() {
        return None;
    }
    func.close_paren().map(|close| close + 1)
}

/// Sets [`Comment::start`] for the comments that Prettier prints somewhere else than where they are.
///
/// What is around a comment tells that this is not one, for nearly all of them. The tree is only
/// looked at for the rest. Apart from that it is linear in the number of comments.
fn move_comments<'a>(file: &'a File<'a>, comments: &mut [Comment]) {
    let text = file.text();
    let is_typescript = !file.is_javascript();
    let mut nodes = NodeFinder {
        file,
        statement: None,
    };
    let is_blank = |start: u32, end: u32| text.get(start as usize..end as usize).is_some_and(|it| it.trim_ascii().is_empty());
    let mut has_moved = false;
    // The comment before is on a line of its own, or follows one that is on the same line.
    let mut is_after_own_line_comment = false;
    // Where the comments start that lead up to this one with nothing in between.
    let mut run_start = 0;
    // The index of the last comment that follows this one with nothing in between.
    let mut run_last = 0;

    for index in 0..comments.len() {
        let comment = comments[index];
        let previous = index.checked_sub(1).and_then(|previous| comments.get(previous));
        if !previous.is_some_and(|previous| is_blank(previous.span.end, comment.span.start)) {
            run_start = comment.span.start;
        }
        let is_own_line = comment.preceded_by_newline()
            || (is_after_own_line_comment
                && previous.is_some_and(|previous| {
                    let between = text.get(previous.span.end as usize..comment.span.start as usize);
                    between.unwrap_or_default().iter().all(|b| matches!(b, b' ' | b'\t'))
                }));
        is_after_own_line_comment = is_own_line;
        if !is_own_line && !is_typescript && !comment.followed_by_newline() {
            continue;
        }

        if run_last < index {
            run_last = index;
        }
        while let (Some(last), Some(next)) = (comments.get(run_last), comments.get(run_last + 1))
            && is_blank(last.span.end, next.span.start)
        {
            run_last += 1;
        }
        let after = text.get(comments.get(run_last).map_or(0, |last| last.span.end as usize)..).unwrap_or_default();
        let after = after.trim_ascii_start();

        let moved_to = match after {
            [b'(', ..] if is_typescript => moved_over_parenthesis(&mut nodes, comment, (text.len() - after.len()) as u32),
            // `a: (b // comment ⏎ ),`
            [b')', ..] if !is_own_line => {
                let after_parentheses = after.iter().find(|b| **b != b')' && !b.is_ascii_whitespace());
                match (comment.followed_by_newline(), after_parentheses) {
                    (true, Some(b',' | b'}')) => moved_out_of_property(&mut nodes, comment),
                    _ => None,
                }
            }
            _ if !is_own_line => None,
            [b'.', b'.', ..] => None,
            [b'.', ..] | [b'?', b'.', ..] => moved_out_of_member_expression(&mut nodes, comment),
            // `(a + b // comment ⏎ ).c`
            [b')', ..] => {
                let after_parentheses = after.iter().position(|b| *b != b')' && !b.is_ascii_whitespace());
                match after_parentheses.and_then(|at| after.get(at..)) {
                    Some([b'.', b'.', ..]) => None,
                    Some([b'.', ..] | [b'?', b'.', ..]) => moved_out_of_member_expression(&mut nodes, comment),
                    _ => None,
                }
            }
            _ => match text.get(..run_start as usize).unwrap_or_default().trim_ascii_end() {
                [.., b'.', b'.'] => None,
                [.., b'.' | b'['] => moved_out_of_member_expression(&mut nodes, comment),
                _ => None,
            },
        };
        if let Some(moved_to) = moved_to {
            comments[index].moved_to = moved_to;
            has_moved = true;
        }
    }
    if has_moved {
        comments.sort_by_key(|comment| comment.start());
    }
}

/// The lines of `text`, which end with `\n`, `\r\n` or `\r`.
pub(crate) fn lines(text: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut rest = Some(text);
    std::iter::from_fn(move || {
        let text = rest?;
        let Some(at) = bun_core::strings::index_of_any(text, b"\n\r") else {
            rest = None;
            return Some(text);
        };
        let len = if text[at..].starts_with(b"\r\n") { 2 } else { 1 };
        rest = Some(&text[at + len..]);
        Some(&text[..at])
    })
}

/// `content`: what is between `/*` and `*/`.
fn is_indentable_text(content: &[u8]) -> bool {
    let mut lines = lines(content).skip(1).peekable();
    if lines.peek().is_none() {
        return false;
    }
    while let Some(line) = lines.next() {
        let line = line.trim_ascii_start();
        // The last line goes on with the `*` of `*/`.
        if !line.starts_with(b"*") && !(line.is_empty() && lines.peek().is_none()) {
            return false;
        }
    }
    true
}

/// Prettier's `/@(?:type|satisfies)\b/`.
fn is_type_cast_text(content: &[u8]) -> bool {
    let mut rest = content;
    while let Some(at) = bun_core::strings::index_of_char_usize(rest, b'@') {
        rest = &rest[at + 1..];
        for tag in [&b"type"[..], b"satisfies"] {
            if let Some(after) = rest.strip_prefix(tag)
                && !after.first().is_some_and(|&b| b.is_ascii_alphanumeric() || b == b'_')
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
    last_handled_type_cast_comment: usize,
    type_cast_node_span: Span,
    view_limit: Option<usize>,
}

pub(crate) struct Comments<'a> {
    source_text: SourceText<'a>,
    inner: &'a [Comment],
    /// `inner[..printed_count]` are printed.
    printed_count: usize,
    /// `printed_count` when the last type cast was printed.
    last_handled_type_cast_comment: usize,
    type_cast_node_span: Span,
    /// The comments from this index on are hidden.
    view_limit: Option<usize>,
    /// Some comment is a type cast: `/** @type {T} */ (e)`.
    has_type_cast_comments: bool,
}

impl<'a> Comments<'a> {
    pub(crate) fn new(source_text: SourceText<'a>, comments: &'a [Comment]) -> Self {
        Comments {
            source_text,
            inner: comments,
            printed_count: 0,
            last_handled_type_cast_comment: 0,
            type_cast_node_span: Span::default(),
            view_limit: None,
            has_type_cast_comments: comments.iter().any(|c| c.flags & TYPE_CAST != 0),
        }
    }

    /// Where the first comment that is not printed starts. `u32::MAX` if there is none.
    ///
    /// Nothing before this position has to think about comments.
    #[inline]
    pub(crate) fn next_start(&self) -> u32 {
        self.unprinted_comments().first().map_or(u32::MAX, |c| c.start())
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
            while end > span.start && self.source_text.byte_at(end - 1).is_some_and(|b| b.is_ascii_whitespace()) {
                end -= 1;
            }
            let at = self.inner.partition_point(|comment| comment.end() < end);
            match self.inner.get(at) {
                Some(comment) if comment.end() == end && comment.start() >= span.start => end = comment.start(),
                _ => return Span::new(span.start, end),
            }
        }
    }

    /// Whether any comment of the file is a type cast.
    #[inline]
    pub(crate) fn has_type_cast_comments(&self) -> bool {
        self.has_type_cast_comments
    }

    #[inline]
    pub(crate) fn unprinted_comments(&self) -> &'a [Comment] {
        let end = self.view_limit.unwrap_or(self.inner.len());
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
    pub(crate) fn comments_before_iter(&self, pos: u32) -> impl Iterator<Item = &'a Comment> + use<'a> {
        self.unprinted_comments().iter().take_while(move |c| c.end() <= pos)
    }

    /// The comments that end at or before `pos`.
    pub(crate) fn comments_before(&self, pos: u32) -> &'a [Comment] {
        let count = self.comments_before_iter(pos).count();
        &self.unprinted_comments()[..count]
    }

    /// The comments up to the end of the node at `span`. One that has been moved to where the node
    /// ends is behind it.
    pub(crate) fn comments_before_end_of(&self, span: Span) -> &'a [Comment] {
        let count = self.comments_before_iter(span.end).take_while(|c| !c.is_moved() || c.end() < span.end).count();
        &self.unprinted_comments()[..count]
    }

    /// Of the comments that end at or before `pos`, the first ones that are block comments.
    pub(crate) fn block_comments_before(&self, pos: u32) -> &'a [Comment] {
        let count = self.comments_before_iter(pos).take_while(|c| c.is_block()).count();
        &self.unprinted_comments()[..count]
    }

    /// Of the comments that end at or before `pos`, the first ones that start their line.
    pub(crate) fn own_line_comments_before(&self, pos: u32) -> &'a [Comment] {
        let count = self.comments_before_iter(pos).take_while(|c| c.preceded_by_newline()).count();
        &self.unprinted_comments()[..count]
    }

    /// The comments after `pos` up to one that ends its line, if nothing but blanks, `=`, `:` and
    /// `,` is in between.
    pub(crate) fn end_of_line_comments_after(&self, pos: u32) -> &'a [Comment] {
        self.end_of_line_comments_after_bytes(pos, |b| matches!(b, b'\t' | b' ' | b'=' | b':' | b','))
    }

    /// The same after the left side of an assignment or the key of a property, which ends at `pos`:
    /// an operator and `(` can be in between. `a ||= ( // comment`
    pub(crate) fn end_of_line_comments_after_left_side(&self, pos: u32) -> &'a [Comment] {
        self.end_of_line_comments_after_bytes(pos, |b| {
            matches!(
                b,
                b'\t' | b' ' | b'=' | b':' | b'(' | b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^' | b'<' | b'>' | b'?'
            )
        })
    }

    fn end_of_line_comments_after_bytes(&self, mut pos: u32, can_be_between: impl Fn(u8) -> bool) -> &'a [Comment] {
        let comments = self.comments_after(pos);
        for (index, comment) in comments.iter().enumerate() {
            if !self.source_text.all_bytes_match(pos, comment.start(), &can_be_between) {
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
        let start = comments.iter().take_while(|c| c.end() < pos).count();
        &comments[start..]
    }

    pub(crate) fn comments_in_range(&self, start: u32, end: u32) -> &'a [Comment] {
        let comments = self.comments_after(start);
        let count = comments.iter().take_while(|c| c.end() <= end).count();
        &comments[..count]
    }

    /// The comments after `start` that are before the first `character` outside of a comment.
    pub(crate) fn comments_before_character(&self, mut start: u32, character: u8) -> &'a [Comment] {
        let comments = self.comments_after(start);
        for (index, comment) in comments.iter().enumerate() {
            if self.source_text.bytes_contain(start, comment.start(), character) {
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
        self.unprinted_comments().first().is_some_and(|c| c.end() <= start)
    }

    /// Whether a comment before `start` ends its line.
    pub(crate) fn has_leading_own_line_comment(&self, start: u32) -> bool {
        self.comments_before_iter(start).any(|c| c.followed_by_newline())
    }

    pub(crate) fn has_end_of_line_comment_after(&self, pos: u32) -> bool {
        !self.end_of_line_comments_after(pos).is_empty()
    }

    /// Has to be called for each comment that is printed.
    #[inline]
    pub(crate) fn increment_printed_count(&mut self) {
        self.printed_count += 1;
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

        if following_span_start == 0 {
            // What is left at the end of the parent.
            let comments = self.comments_before(enclosing_span.end);
            let mut start = preceding_span.end;
            for (index, comment) in comments.iter().enumerate() {
                // It is inside the node.
                if start > comment.start() {
                    continue;
                }
                let is_adjacent = source_text.all_bytes_match(start, comment.start(), |b| {
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
        let mut type_cast_comment = None;
        while let Some(comment) = comments.get(comment_index) {
            if comment.end() > following_span_start || comment.end() > enclosing_span.end {
                break;
            }
            if following_span_start > enclosing_span.end && comment.end() <= enclosing_span.end {
                // The next sibling is outside of the parent and the comment is inside.
            } else if self.is_type_cast_comment(comment) {
                // `a || /** @type {T} */ (b)`: it leads the next sibling.
                type_cast_comment = Some(comment);
                break;
            } else if comment.preceded_by_newline() || comment.is_moved() {
                // On a line of its own, or moved to where it is: it leads the next sibling.
                break;
            } else if comment.followed_by_newline() {
                return &comments[..=comment_index];
            }
            comment_index += 1;
        }

        // From the end, those that have nothing but blanks and `(` between them and the next
        // sibling lead it.
        let mut gap_end = type_cast_comment.map_or(following_span_start, |c| c.start());
        for (index, comment) in comments[..comment_index].iter().enumerate().rev() {
            let is_adjacent = source_text
                .all_bytes_match(comment.end(), gap_end, |b| b.is_ascii_whitespace() || b == b'(');
            if !is_adjacent {
                return &comments[..=index];
            }
            gap_end = comment.start();
        }
        &[]
    }

    /// Whether a `prettier-ignore` comment leads the node that starts at `start`.
    pub(crate) fn is_suppressed(&self, start: u32) -> bool {
        self.comments_before_iter(start).any(|comment| self.is_suppression_comment(comment))
    }

    /// `statement(); // prettier-ignore`
    pub(crate) fn has_trailing_suppression_comment(&self, pos: u32) -> bool {
        self.end_of_line_comments_after(pos)
            .iter()
            .any(|comment| self.is_suppression_comment(comment))
    }

    pub(crate) fn is_suppression_comment(&self, comment: &Comment) -> bool {
        self.source_text.text_for(&comment.content_span()).trim_ascii() == b"prettier-ignore"
    }

    /// A JSDoc comment with `@type` or `@satisfies`.
    #[inline]
    pub(crate) fn is_type_cast_comment(&self, comment: &Comment) -> bool {
        comment.flags & TYPE_CAST != 0
    }

    /// Among the comments before `span`, the index of the first type cast comment that is
    /// followed by a `(`.
    pub(crate) fn get_type_cast_comment_index(&self, span: Span) -> Option<usize> {
        self.comments_before_iter(span.start).position(|comment| {
            self.is_type_cast_comment(comment)
                && self.source_text.next_non_whitespace_byte_is(comment.end(), b'(')
        })
    }

    /// The same question for a range, whether or not the comments are printed.
    pub(crate) fn has_type_cast_comment_in_range(&self, start: u32, end: u32) -> bool {
        if !self.has_type_cast_comments {
            return false;
        }
        let first = self.inner.partition_point(|c| c.end() < start);
        self.inner[first..].iter().take_while(|c| c.end() <= end).any(|comment| {
            self.is_type_cast_comment(comment)
                && self.source_text.next_non_whitespace_byte_is(comment.end(), b'(')
        })
    }

    pub(crate) fn mark_as_type_cast_node(&mut self, node: &impl Spanned) {
        self.type_cast_node_span = node.span();
        self.last_handled_type_cast_comment = self.printed_count;
    }

    /// Whether the comment that was printed last has been dealt with as a type cast.
    pub(crate) fn is_handled_type_cast_comment(&self) -> bool {
        self.printed_count == self.last_handled_type_cast_comment
    }

    #[inline]
    pub(crate) fn is_type_cast_node(&self, node: &impl Spanned) -> bool {
        self.has_type_cast_comments && self.type_cast_node_span == node.span()
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
            last_handled_type_cast_comment: self.last_handled_type_cast_comment,
            type_cast_node_span: self.type_cast_node_span,
            view_limit: self.view_limit,
        }
    }

    pub(crate) fn restore(&mut self, snapshot: CommentSnapshot) {
        self.printed_count = snapshot.printed_count;
        self.last_handled_type_cast_comment = snapshot.last_handled_type_cast_comment;
        self.type_cast_node_span = snapshot.type_cast_node_span;
        self.view_limit = snapshot.view_limit;
    }

    /// Marks the comments that end at or before `pos` as printed.
    pub(crate) fn skip_comments_before(&mut self, pos: u32) {
        self.printed_count += self.comments_before(pos).len();
    }
}
