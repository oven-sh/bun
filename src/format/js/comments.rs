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
use crate::options::Flavor;
use bun_lint::ast::{
    BinOp, Expr, ExprKind, File, FnBody, Func, Node, PropKind, StmtKind, TypeKind,
};
use bun_lint::span::{Span, Spanned};
use bun_lint::tokens::TokenKind;
use smallvec::SmallVec;

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
/// Prettier's `isTypeCastComment`, which is asked of the comment alone.
const LOOKS_LIKE_TYPE_CAST: u8 = 1 << 4;
/// See [`Flavor::is_ignore_comment`].
const SUPPRESSION: u8 = 1 << 5;
/// It is between the two sides of a declarator or an assignment and trails the left one.
const TRAILS_LEFT_SIDE: u8 = 1 << 6;

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

/// Appends the comments of `file` to `comments`.
pub(crate) fn collect<'a>(
    file: &'a File<'a>,
    flavor: Flavor,
    parsed_by: ParsedBy,
    comments: &mut Vec<Comment>,
) {
    let text = file.text();
    let source = SourceText::new(text);
    let first = comments.len();
    let has_type_casts = parsed_by == ParsedBy::Babel
        || file.is_javascript()
        || type_casts_are_kept_in_typescript(flavor);
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
        if flags & INDENTABLE != 0
            && comments.len() > first
            && let Some(previous) = comments.last_mut()
            && previous.span.end == span.start
            && previous.flags & INDENTABLE != 0
        {
            previous.span.end = span.end;
            previous.flags =
                (previous.flags & !FOLLOWED_BY_NEWLINE) | (flags & !PRECEDED_BY_NEWLINE);
            continue;
        }
        comments.push(Comment {
            span,
            moved_to: NOT_MOVED,
            kind,
            flags,
        });
    }
    move_comments(file, flavor, comments.get_mut(first..).unwrap_or_default());
}

/// Only Babel, which Prettier parses JavaScript with, tells it about the parentheses after
/// `/** @type {T} */`. In TypeScript they are parentheses like any other. oxfmt keeps them there too.
fn type_casts_are_kept_in_typescript(flavor: Flavor) -> bool {
    flavor.is_oxfmt()
}

/// Finds nodes by position.
struct NodeFinder<'a> {
    file: &'a File<'a>,
    flavor: Flavor,
    /// The nodes that the last position was in, from the statement of the file inwards. The next one
    /// is likely to be in most of them too, and a chain of operators can be deep.
    path: Vec<Node<'a>>,
    /// Where the `(` are that follow a type cast comment.
    cast_parentheses: Vec<u32>,
}

impl<'a> NodeFinder<'a> {
    fn child_at(node: Node<'a>, offset: u32) -> Option<Node<'a>> {
        let mut found = None;
        node.for_each_child_near(offset, |child| {
            if found.is_none() && child.span().contains_offset(offset) {
                found = Some(child);
            }
        });
        found
    }

    /// Whether `comment` is in parentheses around `e` that follow a type cast comment. For Prettier
    /// they are a node, which the comment is in.
    fn is_in_cast_parentheses_of(&self, e: Expr<'a>, comment: Comment) -> bool {
        !self.cast_parentheses.is_empty()
            && e.is_parenthesized()
            && e.parens().any(|it| {
                it.end >= comment.span.end && self.cast_parentheses.binary_search(&it.start).is_ok()
            })
    }

    /// Where `e` starts, with the parentheses around it that follow a type cast comment.
    fn start_with_cast_parentheses(&self, e: Expr<'a>) -> u32 {
        let parentheses = (!self.cast_parentheses.is_empty() && e.is_parenthesized()).then(|| {
            e.parens()
                .rev()
                .find(|it| self.cast_parentheses.binary_search(&it.start).is_ok())
        });
        parentheses
            .flatten()
            .map_or_else(|| e.span().start, |it| it.start)
    }

    /// The innermost node that `offset` is in.
    fn innermost_node_at(&mut self, offset: u32) -> Node<'a> {
        while let Some(last) = self.path.last()
            && !last.span().contains_offset(offset)
        {
            self.path.pop();
        }
        let mut node = self.path.last().copied().unwrap_or(Node::File(self.file));
        while let Some(child) = Self::child_at(node, offset) {
            self.path.push(child);
            node = child;
        }
        node
    }
}

/// Prettier's `handleMemberExpressionComments`: a comment on a line of its own before the property
/// of a member expression, if that is a name, leads the member expression.
///
/// In a chain of calls Prettier prints the comments of a member expression before its `.b`, which is
/// where they are, unless they are behind the `.`: `is_after_dot`.
fn moved_out_of_member_expression<'a>(
    nodes: &mut NodeFinder<'a>,
    comment: Comment,
    is_after_dot: bool,
) -> Option<u32> {
    if comments_stay_in_member_expressions(nodes.flavor) {
        return None;
    }
    let Node::Expr(member) = nodes.innermost_node_at(comment.span.start) else {
        return None;
    };
    let (object, property_start) = match member.kind() {
        ExprKind::Dot { obj, name, .. } if !name.bytes().starts_with(b"#") => {
            (obj, name.span().start)
        }
        ExprKind::Index { obj, index, .. } if matches!(index.kind(), ExprKind::Ident(_)) => {
            (obj, index.span().start)
        }
        _ => return None,
    };
    if comment.span.start < object.span().end
        || property_start < comment.span.end
        || nodes.is_in_cast_parentheses_of(object, comment)
    {
        return None;
    }
    let mut top: Expr<'a> = member;
    while let Node::Expr(parent) = top.parent() {
        match parent.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == top => top = parent,
            ExprKind::NonNull(inner) if inner == top => top = parent,
            ExprKind::Call(call) if call.callee() == top => {
                return is_after_dot.then(|| object.span().end);
            }
            ExprKind::Jsx(_) => return None,
            _ => break,
        }
    }
    Some(member.span().start)
}

/// Where the comments between the two sides of a declarator, an assignment or a binary expression
/// belong, if `comments[index]` is one of them. Returns the index of the first comment after them.
///
/// Prettier's `attachComments` with `handleAssignmentLikeComments`: a comment that starts its line
/// leads the right side. So does one that ends its line, if it is a block or the right side is an
/// object, an array or a template. Otherwise it trails the left side. One with code on both sides
/// leads the right side if only blanks and `(` are in between. Those that trail the left side are
/// written first: `a = /* b */ // c ⏎ d` is `a = // c ⏎ /* b */ d`.
///
/// In a binary expression any comment that ends its line trails the left side, and only those that
/// are written before a comment that they follow are dealt with here. `None` if there are none.
fn attach_between_sides_of_assignment<'a>(
    nodes: &mut NodeFinder<'a>,
    comments: &mut [Comment],
    mut index: usize,
) -> Option<usize> {
    if comments_keep_their_order(nodes.flavor) {
        return None;
    }
    let first = *comments.get(index)?;
    let (left_end, right, is_assignment) = match nodes.innermost_node_at(first.span.start) {
        Node::VarDecl(declarator) => (
            declarator
                .ty()
                .map_or_else(|| declarator.pat().span().end, |ty| ty.span().end),
            declarator.init()?,
            true,
        ),
        Node::Expr(e) => match e.kind() {
            ExprKind::Assign { target, value, .. } if !e.is_assignment_target() => {
                (target.span().end, value, true)
            }
            ExprKind::Binary { op, left, right } if op != BinOp::Comma => {
                (left.span().end, right, false)
            }
            _ => return None,
        },
        _ => return None,
    };
    while index > 0 && comments[index - 1].span.start >= left_end {
        index -= 1;
    }
    let right_start = nodes.start_with_cast_parentheses(right);
    if first.span.start < left_end || right_start < first.span.end {
        return None;
    }
    let source = SourceText::new(nodes.file.text());
    let is_on_same_line = |a: &Comment, b: &Comment| {
        source.all_bytes(a.span.between(b.span), |b| {
            matches!(b, b' ' | b'\t' | 0x0B | 0x0C)
        })
    };
    let count = comments[index..]
        .iter()
        .take_while(|comment| comment.span.end <= right_start)
        .count();
    let gap = comments.get_mut(index..index + count)?;
    if gap.iter().any(|comment| comment.is_moved()) {
        return None;
    }
    let is_right_complex = is_assignment
        && matches!(
            right.kind(),
            ExprKind::Object(_)
                | ExprKind::Array(_)
                | ExprKind::Template(_)
                | ExprKind::TaggedTemplate(_)
        )
        && right_start == right.span().start;

    // Whether it starts its line, or follows one that does on the same line.
    let mut starts_line: SmallVec<[bool; 8]> = SmallVec::with_capacity(gap.len());
    for (at, comment) in gap.iter().enumerate() {
        let follows_one_that_does = at.checked_sub(1).is_some_and(|previous| {
            starts_line.get(previous) == Some(&true)
                && gap
                    .get(previous)
                    .is_some_and(|it| is_on_same_line(it, comment))
        });
        starts_line.push(comment.preceded_by_newline() || follows_one_that_does);
    }

    // From the end: whether it ends its line, and how far what leads the right side reaches back.
    let (mut ends_line, mut leading_start, mut is_tie_broken) = (false, right_start, false);
    for at in (0..gap.len()).rev() {
        let comment = gap[at];
        ends_line = comment.followed_by_newline()
            || (ends_line
                && gap
                    .get(at + 1)
                    .is_some_and(|next| is_on_same_line(&comment, next)));
        let trails_left_side = if starts_line.get(at) == Some(&true) {
            false
        } else if ends_line {
            match is_assignment {
                true => comment.is_line() && !is_right_complex,
                false => comment.flags & LOOKS_LIKE_TYPE_CAST == 0,
            }
        } else {
            is_tie_broken = is_tie_broken
                || !source.all_bytes(Span::after(comment.span, leading_start), |b| {
                    b.is_ascii_whitespace() || b == b'('
                });
            if !is_tie_broken {
                leading_start = comment.span.start;
            }
            is_tie_broken
        };
        if trails_left_side {
            gap[at].flags |= TRAILS_LEFT_SIDE;
        }
    }
    if let Some(first_leading) = gap
        .iter()
        .find(|comment| comment.flags & TRAILS_LEFT_SIDE == 0)
        .map(|it| it.span.start)
    {
        for comment in gap
            .iter_mut()
            .filter(|it| it.flags & TRAILS_LEFT_SIDE != 0 && it.span.start > first_leading)
        {
            comment.moved_to = first_leading;
        }
    }
    if is_assignment {
        return Some(index + count);
    }
    for comment in gap.iter_mut().filter(|it| !it.is_moved()) {
        comment.flags &= !TRAILS_LEFT_SIDE;
    }
    gap.iter().any(|it| it.is_moved()).then_some(index + count)
}

/// oxfmt writes no comment before one that it follows in the source. Which side of an operator a
/// comment belongs to is decided where the operator is written.
fn comments_keep_their_order(flavor: Flavor) -> bool {
    flavor.is_oxfmt()
}

/// Prettier's `handleAssignmentPatternComments`: a comment on a line of its own between the two sides
/// of the `a = 1` of a pattern leads it.
fn moved_out_of_assignment_pattern(nodes: &mut NodeFinder<'_>, comment: Comment) -> Option<u32> {
    let (left, default) = match nodes.innermost_node_at(comment.span.start) {
        Node::PatProp(it) => (it.value().span(), it.default()?),
        Node::PatElem(it) => (it.pat()?.span(), it.default()?),
        Node::Param(it) => (it.pat().span(), it.default()?),
        Node::Expr(e) => match e.kind() {
            ExprKind::Assign { target, value, .. } if e.is_assignment_target() => {
                (target.span(), value)
            }
            _ => return None,
        },
        _ => return None,
    };
    (left.end <= comment.span.start && comment.span.end <= default.span().start)
        .then_some(left.start)
}

/// oxfmt has no `handleMemberExpressionComments`: `a ⏎ // comment ⏎ .b` stays as it is.
fn comments_stay_in_member_expressions(flavor: Flavor) -> bool {
    flavor.is_oxfmt()
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
    (is_in_object
        && property.kind() == PropKind::Init
        && value.span().end <= comment.span.start
        && !nodes.is_in_cast_parentheses_of(value, comment))
    .then(|| property.span().start)
}

/// A comment before the `(` of the parameters at `open_paren`.
///
/// For a function with a body Prettier has `handleFunctionNameComments`: it trails the name. For
/// anything else there is no rule, and no node for the parentheses. So the comment is between what
/// is before the parameters and the first parameter, which it leads, the `(` counting for nothing.
/// Without parameters it leads the return type, if nothing is before it that it can trail.
fn moved_over_parenthesis<'a>(
    nodes: &mut NodeFinder<'a>,
    comment: Comment,
    open_paren: u32,
) -> Option<u32> {
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
fn move_comments<'a>(file: &'a File<'a>, flavor: Flavor, comments: &mut [Comment]) {
    let text = file.text();
    let is_typescript = !file.is_javascript();
    let mut nodes = NodeFinder {
        file,
        flavor,
        path: Vec::new(),
        cast_parentheses: (comments.iter())
            .filter(|comment| comment.flags & TYPE_CAST != 0)
            .filter_map(|comment| {
                let after = text.get(comment.span.end as usize..)?.trim_ascii_start();
                after
                    .starts_with(b"(")
                    .then(|| (text.len() - after.len()) as u32)
            })
            .collect(),
    };
    let is_blank = |start: u32, end: u32| {
        text.get(start as usize..end as usize)
            .is_some_and(|it| bun_core::strings::trim_js_whitespace_start(it).is_empty())
    };
    let mut has_moved = false;
    // The comment before is on a line of its own, or follows one that is on the same line.
    let mut is_after_own_line_comment = false;
    // Where the comments start that lead up to this one with nothing in between.
    let mut run_start = 0;
    // The index of the last comment that follows this one with nothing in between.
    let mut run_last = 0;
    // The comments before this index are dealt with.
    let mut attached_until = 0;

    for index in 0..comments.len() {
        let comment = comments[index];
        let previous = index
            .checked_sub(1)
            .and_then(|previous| comments.get(previous));
        if !previous.is_some_and(|previous| is_blank(previous.span.end, comment.span.start)) {
            run_start = comment.span.start;
        }
        let is_own_line = comment.preceded_by_newline()
            || (is_after_own_line_comment
                && previous.is_some_and(|previous| {
                    let between = text.get(previous.span.end as usize..comment.span.start as usize);
                    between
                        .unwrap_or_default()
                        .iter()
                        .all(|b| matches!(b, b' ' | b'\t'))
                }));
        is_after_own_line_comment = is_own_line;
        if index < attached_until {
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
        let after = text
            .get(
                comments
                    .get(run_last)
                    .map_or(0, |last| last.span.end as usize)..,
            )
            .unwrap_or_default();
        let after = bun_core::strings::trim_js_whitespace_start(after);

        // The first of its run, after `=`, `= (` or before an assignment operator, or with nothing but
        // an operator between it and the comment before.
        let is_operator = |b: &u8| {
            matches!(
                b,
                b'+' | b'-'
                    | b'*'
                    | b'/'
                    | b'%'
                    | b'<'
                    | b'>'
                    | b'&'
                    | b'|'
                    | b'^'
                    | b'?'
                    | b'='
                    | b'!'
            )
        };
        let mut before = bun_core::strings::trim_js_whitespace_end(
            text.get(..run_start as usize).unwrap_or_default(),
        );
        while let [rest @ .., b'('] = before {
            before = bun_core::strings::trim_js_whitespace_end(rest);
        }
        let is_at_assignment_operator =
            starts_with_assignment_operator(after) || before.ends_with(b"=");
        if run_start == comment.span.start
            && (is_at_assignment_operator
                || (!is_own_line
                    && previous.is_some_and(|previous| {
                        let operator = before.get(previous.span.end as usize..).unwrap_or_default();
                        bun_core::strings::trim_js_whitespace_start(operator)
                            .iter()
                            .all(is_operator)
                    })))
            && let Some(end) = attach_between_sides_of_assignment(&mut nodes, comments, index)
        {
            has_moved = has_moved
                || comments[..end]
                    .iter()
                    .rev()
                    .take_while(|it| it.span.start >= run_start)
                    .any(|it| it.is_moved());
            attached_until = end;
            continue;
        }
        // A comment before the parentheses of a type cast stays there.
        let is_type_cast = comment.flags & TYPE_CAST != 0
            && bun_core::strings::trim_js_whitespace_start(
                text.get(comment.span.end as usize..).unwrap_or_default(),
            )
            .starts_with(b"(");
        if (!is_own_line && !is_typescript && !comment.followed_by_newline()) || is_type_cast {
            continue;
        }
        if is_own_line
            && is_at_assignment_operator
            && let Some(moved_to) = moved_out_of_assignment_pattern(&mut nodes, comment)
        {
            comments[index].moved_to = moved_to;
            has_moved = true;
            continue;
        }

        let moved_to = match after {
            [b'(', ..] if is_typescript => {
                moved_over_parenthesis(&mut nodes, comment, (text.len() - after.len()) as u32)
            }
            // `a: (b // comment ⏎ ),`
            [b')', ..] if !is_own_line => {
                let after_parentheses = after
                    .iter()
                    .find(|b| **b != b')' && !b.is_ascii_whitespace());
                match (comment.followed_by_newline(), after_parentheses) {
                    (true, Some(b',' | b'}')) => moved_out_of_property(&mut nodes, comment),
                    _ => None,
                }
            }
            _ if !is_own_line => None,
            [b'.', b'.', ..] => None,
            [b'.', ..] | [b'?', b'.', ..] | [b'[', ..] => {
                moved_out_of_member_expression(&mut nodes, comment, false)
            }
            // `(a + b // comment ⏎ ).c`
            [b')', ..] => {
                let after_parentheses = after
                    .iter()
                    .position(|b| *b != b')' && !b.is_ascii_whitespace());
                match after_parentheses.and_then(|at| after.get(at..)) {
                    Some([b'.', b'.', ..]) => None,
                    Some([b'.', ..] | [b'?', b'.', ..]) => {
                        moved_out_of_member_expression(&mut nodes, comment, false)
                    }
                    _ => None,
                }
            }
            _ => match text
                .get(..run_start as usize)
                .unwrap_or_default()
                .trim_ascii_end()
            {
                [.., b'.', b'.'] => None,
                [.., last @ (b'.' | b'[')] => {
                    moved_out_of_member_expression(&mut nodes, comment, *last == b'.')
                }
                _ => None,
            },
        };
        if let Some(moved_to) = moved_to {
            comments[index].moved_to = moved_to;
            has_moved = true;
        }
    }
    if has_moved {
        // A moved comment comes before one that starts where it is.
        crate::sort::sort_by_key(comments, |comment| (comment.start(), !comment.is_moved()));
    }
}

/// `=`, `+=`, `>>>=`, `??=`. Also `<=` and `>=`.
fn starts_with_assignment_operator(text: &[u8]) -> bool {
    let operator = text.iter().take_while(|b| {
        matches!(
            b,
            b'+' | b'-' | b'*' | b'/' | b'%' | b'<' | b'>' | b'&' | b'|' | b'^' | b'?'
        )
    });
    matches!(text.get(operator.take(4).count()..), Some([b'=', after, ..]) if !matches!(after, b'=' | b'>'))
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
fn is_type_cast_text(content: &[u8]) -> bool {
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
}

pub(crate) struct Comments<'a> {
    source_text: SourceText<'a>,
    inner: &'a [Comment],
    /// `inner[..printed_count]` are printed.
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
    pub(crate) fn new(source_text: SourceText<'a>, comments: &'a [Comment]) -> Self {
        let flags = comments
            .iter()
            .fold(0, |flags, comment| flags | comment.flags);
        Comments {
            source_text,
            inner: comments,
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
                    .is_some_and(|b| b.is_ascii_whitespace())
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
        for comment in &printed[first..] {
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
            if comment.end() > following_span_start || comment.end() > enclosing_span.end {
                break;
            }
            if comment.is_moved() && comment.flags & TRAILS_LEFT_SIDE != 0 {
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
        if self
            .end_of_line_comments_after(pos)
            .iter()
            .any(|comment| self.is_suppression_comment(comment))
        {
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
            is_suppressed |= self.is_suppression_comment(comment);
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
        let before = self.inner.partition_point(|comment| comment.start() < open);
        // The text of a moved comment is somewhere else.
        self.inner[..before]
            .iter()
            .rev()
            .find(|comment| !comment.is_moved())
            .is_some_and(|comment| {
                self.is_type_cast_comment(comment)
                    && self
                        .source_text
                        .all_bytes(Span::after(comment.span, open), |b| b.is_ascii_whitespace())
            })
    }

    /// Shows the comments that start before `end_pos`, hidden or not, and hides the others. Returns
    /// what to pass to [`Comments::restore_view_limit`].
    pub(crate) fn show_comments_up_to(&mut self, end_pos: u32) -> Option<usize> {
        let rest = self.inner.get(self.printed_count..).unwrap_or_default();
        let limit = self.printed_count + rest.partition_point(|c| c.start() < end_pos);
        self.view_limit.replace(limit)
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
        }
    }

    pub(crate) fn restore(&mut self, snapshot: CommentSnapshot) {
        self.printed_count = snapshot.printed_count;
        self.view_limit = snapshot.view_limit;
    }

    /// Marks the comments that end at or before `pos` as printed.
    pub(crate) fn skip_comments_before(&mut self, pos: u32) {
        self.printed_count += self.comments_before(pos).len();
    }
}
