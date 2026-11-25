//! The comments that are attached by their position alone: between the items of a list.

use super::*;
use crate::js::comments::{is_indentable_text, is_type_cast_text};

fn content<'a>(comment: &Comment, src: &'a [u8]) -> &'a [u8] {
    let end = comment.end - if comment.is_line { 0 } else { 2 };
    (src.get(comment.start as usize + 2..end as usize)).unwrap_or_default()
}

/// False if it affects how the code around it is printed.
pub(in crate::js::settled) fn is_inert(comment: &Comment, src: &[u8], flavor: Flavor) -> bool {
    let content = content(comment, src);
    !(matches!(
        strings::trim_js_whitespace_start(content).first(),
        Some(b'p' | b'o')
    ) && flavor.is_ignore_comment(strings::trim_js_whitespace(content)))
}

/// True if `comment` is printed as it is on a line that starts with `indentation`.
pub(in crate::js::settled) fn is_comment_settled(
    comment: &Comment,
    src: &[u8],
    indentation: &[u8],
    flavor: Flavor,
) -> bool {
    let text = (src.get(comment.start as usize..comment.end as usize)).unwrap_or_default();
    if !is_inert(comment, src, flavor) {
        return false;
    }
    if comment.is_line {
        return strings::trim_js_whitespace_end(text).len() == text.len();
    }
    if !is_indentable_text(content(comment, src)) {
        return true;
    }
    let mut lines = strings::split(text, b"\n");
    let first = lines.next().unwrap_or_default();
    strings::trim_js_whitespace_end(first).len() == first.len()
        && lines.all(|line| {
            (line
                .strip_prefix(indentation)
                .and_then(|it| it.strip_prefix(b" *")))
            .is_some_and(|rest| strings::trim_js_whitespace_end(rest).len() == rest.len())
        })
}

impl<'t> Emitter<'_, 't> {
    pub(in crate::js::settled) fn comments_between(&self, from: u32, to: u32) -> &'t [Comment] {
        let first = self.comments.partition_point(|it| it.start < from);
        let rest = self.comments.get(first..).unwrap_or_default();
        let len = rest.iter().take_while(|it| it.start < to).count();
        rest.get(..len).unwrap_or_default()
    }

    fn comment(&mut self, comment: &Comment) {
        let text = self.slice(comment.start, comment.end);
        if !is_inert(comment, self.src, self.f.options().flavor) {
            self.give_up();
        } else if comment.is_line {
            self.text(strings::trim_js_whitespace_end(text));
        } else if is_indentable_text(content(comment, self.src)) {
            let mut lines = strings::split(text, b"\n");
            self.boundary();
            self.text(strings::trim_js_whitespace_end(
                lines.next().unwrap_or_default(),
            ));
            for line in lines {
                if line.ends_with(b"  ") {
                    self.give_up();
                }
                self.hard_line();
                self.token(" ");
                self.text(strings::trim_js_whitespace(line));
            }
        } else {
            self.text(text);
        }
    }

    fn looks_like_type_cast(&self, comment: &Comment) -> bool {
        let content = content(comment, self.src);
        !comment.is_line && content.starts_with(b"*") && is_type_cast_text(content)
    }

    fn ends_line(&self, comment: &Comment) -> bool {
        comment.is_line || self.source_text().lines_after(comment.end) > 0
    }

    /// True if one of `comments` is printed with a line break after it.
    pub(super) fn has_line_break_after(&self, comments: &[Comment]) -> bool {
        comments.iter().any(|it| self.ends_line(it))
    }

    pub(super) fn has_indentable_block(&self, comments: &[Comment]) -> bool {
        (comments.iter()).any(|it| {
            let content = content(it, self.src);
            !it.is_line && strings::contains_char(content, b'\n') && is_indentable_text(content)
        })
    }

    /// The comments that only whitespace separates from `at` and from each other.
    fn comments_before(&self, mut at: u32) -> &'t [Comment] {
        let end = self.comments.partition_point(|it| it.start < at);
        let before = self.comments.get(..end).unwrap_or_default();
        let is_adjacent = |it: &&Comment| {
            let gap = self.slice(it.end, std::mem::replace(&mut at, it.start));
            gap.trim_ascii_start().is_empty()
        };
        let len = before.iter().rev().take_while(is_adjacent).count();
        before.get(end - len..).unwrap_or_default()
    }

    fn outer_start(&self, node: &Node) -> u32 {
        let before = self.slice(node.start.saturating_sub(1), node.start);
        node.start - u32::from(node.has(flag::PARENS) && before == b"(")
    }

    /// The comments before `id`, which isn't the first thing in `parent`.
    #[inline]
    pub(super) fn comments_leading(&self, parent: &Node, id: Id) -> &'t [Comment] {
        match parent.has(flag::COMMENT) {
            true => self.comments_before(self.outer_start(self.node(id))),
            false => &[],
        }
    }

    /// The comments between the JSX element `id` and its `(`.
    pub(super) fn comments_in_parentheses(&mut self, parent: Id, id: Id) -> &'t [Comment] {
        let (parent, node) = (self.node(parent), self.node(id));
        if !parent.has(flag::COMMENT) || !node.has(flag::PARENS) {
            return &[];
        }
        let comments = self.comments_before(node.start);
        if self.has_indentable_block(comments) || !comments.iter().all(|it| it.is_first_on_line) {
            self.give_up();
        }
        comments
    }

    /// The line comment that only `gap` separates from `id`, which is in `parent`.
    #[inline]
    pub(super) fn line_comment_after(&self, parent: &Node, id: Id, gap: &[u8]) -> &'t [Comment] {
        if !parent.has(flag::COMMENT) {
            return &[];
        }
        let node = self.node(id);
        let end = node.end + u32::from(node.has(flag::PARENS));
        let start = end + gap.len() as u32 + 1;
        match self.slice(end, start + 2).strip_prefix(gap) {
            Some(b" //") => self.comments_between(start, start + 1),
            _ => &[],
        }
    }

    /// `comments` are known to lead `id` if they start their lines, or are on the line of `id`.
    #[inline]
    pub(super) fn leading_comments_of(&mut self, id: Id, comments: &[Comment]) {
        if !comments.is_empty() {
            self.check_owner_of_leading_comments(id, comments);
            self.leading_comments(comments);
        }
    }

    /// The same, but the first one can also end the line that it's on.
    pub(super) fn comments_after_operator(&mut self, id: Id, comments: &[Comment]) {
        match comments {
            [first, rest @ ..] if first.is_line => {
                self.check_owner_of_leading_comments(id, comments);
                self.leading_comment(first);
                self.leading_comments(rest);
            }
            _ => self.leading_comments_of(id, comments),
        }
    }

    fn check_owner_of_leading_comments(&mut self, id: Id, comments: &[Comment]) {
        let node = self.node(id);
        let has_rule = match self.src.get(self.outer_start(node) as usize) {
            Some(b'(') => comments.iter().any(|it| self.looks_like_type_cast(it)),
            Some(b'`') => comments.iter().any(|it| !it.is_line),
            _ => false,
        };
        if has_rule || self.is_chain_expression_without_comments(id) {
            self.give_up();
        }
    }

    fn is_chain_expression_without_comments(&self, id: Id) -> bool {
        !self.is_javascript && !self.is_oxfmt && self.is_chain_root(id)
    }

    fn leading_comments(&mut self, comments: &[Comment]) {
        for comment in comments {
            if !comment.is_first_on_line && self.ends_line(comment) {
                return self.give_up();
            }
            self.leading_comment(comment);
        }
    }

    fn leading_comment(&mut self, comment: &Comment) {
        self.comment(comment);
        match self.source_text().lines_after(comment.end) {
            0 => self.space(),
            1 => self.hard_line(),
            _ => self.line_of(LineMode::Empty),
        }
    }

    /// For comments that are printed at the end of the line. See [`Emitter::flush_trailing_comments`].
    pub(super) fn trailing_comments(&mut self, comments: &[Comment]) {
        for (i, comment) in comments.iter().enumerate() {
            if !comment.is_first_on_line && (i > 0 || !comment.is_line) {
                return self.give_up();
            }
            self.line_suffix(|e| e.trailing_comment(comment));
            self.expand_parent();
        }
    }

    /// Before the line break that follows [`Emitter::trailing_comments`].
    #[inline]
    pub(super) fn flush_trailing_comments(&mut self, comments: &[Comment]) {
        if self.flat.is_on && !comments.is_empty() {
            self.may_break();
            comments.iter().for_each(|it| self.trailing_comment(it));
        }
    }

    fn trailing_comment(&mut self, comment: &Comment) {
        if !comment.is_first_on_line {
            self.space();
        } else if crate::text::is_previous_line_empty(self.src, comment.start as usize) {
            self.line_of(LineMode::Empty);
        } else {
            self.hard_line();
        }
        self.comment(comment);
    }

    fn comments_on_their_own_lines(&mut self, comments: &[Comment]) {
        for (i, comment) in comments.iter().enumerate() {
            if i > 0 {
                if !comment.is_first_on_line {
                    return self.give_up();
                }
                self.hard_line();
            }
            self.comment(comment);
        }
    }

    /// In `{}` or `[]`
    pub(super) fn dangling_comments(&mut self, id: Id) {
        let node = self.node(id);
        if self.is_flat() || !node.has(flag::COMMENT) {
            return;
        }
        let comments = self.comments_between(node.start, node.end);
        let parent = self.node(node.parent);
        let affects_parent = match parent.kind {
            K::JsxContainer | K::JsxSpreadAttr | K::Unary | K::Await | K::Extends => true,
            K::Template | K::TemplateType => true,
            _ => parent.a == id && parent.has(flag::COMPUTED),
        };
        if (affects_parent && !self.is_oxfmt)
            || comments.iter().any(|it| self.looks_like_type_cast(it))
        {
            return self.give_up();
        }
        self.group(|e| {
            e.soft_block_indent(|e| {
                e.comments_on_their_own_lines(comments);
                if comments.last().is_some_and(|it| it.is_line) {
                    e.hard_line();
                }
            });
        });
    }

    pub(super) fn comments_in_jsx_braces(&mut self, id: Id) {
        let node = self.node(id);
        if self.is_flat() || !node.has(flag::COMMENT) {
            return;
        }
        let comments = self.comments_between(node.start, node.end);
        match comments.iter().any(|it| it.is_line) {
            true => self.block_indent(|e| e.comments_on_their_own_lines(comments)),
            false => self.comments_on_their_own_lines(comments),
        }
    }

    /// True if there's a comment before, between or after the items of `owner`, which starts with its list.
    #[inline]
    pub(super) fn has_comments_around_items(&self, owner: Id) -> bool {
        let node = self.node(owner);
        node.has(flag::COMMENT) && self.find_comments_around_items(node)
    }

    fn find_comments_around_items(&self, owner: &Node) -> bool {
        let mut from = owner.start;
        for &id in self.tree.list_of(owner) {
            let item = self.node(id);
            if strings::contains_char(self.slice(from, item.start), b'/') {
                return true;
            }
            from = item.end;
        }
        strings::contains_char(self.slice(from, owner.end), b'/')
    }

    /// The comments after the item `id` of `owner`.
    pub(super) fn comments_after_item(&self, owner: &Node, id: Id, next: Option<&Id>) -> After<'t> {
        let end = self.node(id).end;
        let mut rest =
            self.comments_between(end, next.map_or(owner.end, |&it| self.node(it).start));
        let mut before_separator: &[Comment] = &[];
        if let [first, ..] = rest
            && owner.kind == K::Args
            && !first.is_line
            && first.start == end + 1
            && !first.is_first_on_line
        {
            (before_separator, rest) = rest.split_at(1);
        }
        let len = match next {
            Some(_) if !matches!(owner.kind, K::Specifiers | K::Union) => (rest.iter())
                .take_while(|it| !it.is_first_on_line && self.ends_line(it))
                .count(),
            _ => rest.len(),
        };
        let (at_end_of_line, leading_next) = rest.split_at(len);
        After {
            before_separator,
            at_end_of_line,
            leading_next,
        }
    }

    pub(super) fn comments_after_union_member(&mut self, union: &Node, id: Id, next: Option<&Id>) {
        let comments = self.comments_after_item(union, id, next).at_end_of_line;
        if !comments.is_empty() {
            if self.node(id).has(flag::PARENS)
                || comments.iter().any(|it| self.looks_like_type_cast(it))
            {
                return self.give_up();
            }
            self.trailing_comments(comments);
            self.flush_trailing_comments(comments);
        }
    }

    /// Writes the list of `owner`, which is after the offset `open`, with the comments between the items. `between`
    /// is given two items and the first comment that leads the second one.
    #[inline]
    pub(super) fn items(
        &mut self,
        owner: Id,
        open: u32,
        between: impl Fn(&mut Self, Id, Id, Option<Span>),
        item: impl Fn(&mut Self, Id),
        after: impl Fn(&mut Self, Id, bool),
    ) {
        let node = self.node(owner);
        let list = self.tree.list_of(node);
        let has_comments = node.has(flag::COMMENT);
        let is_array = matches!(node.kind, K::Array | K::ArrayPattern);
        let mut leading = match (has_comments, list.first()) {
            (true, Some(&first)) => self.comments_between(open, self.node(first).start),
            _ => &[],
        };
        let mut previous = NONE;
        for (i, &id) in list.iter().enumerate() {
            if i > 0 {
                let first = leading.first().map(|it| Span::new(it.start, it.end));
                between(self, previous, id, first);
            }
            let next = list.get(i + 1);
            let is_grouped = match self.kind(id) {
                K::Hole => false,
                K::Spread if node.has(flag::TARGET) => false,
                _ => is_array || (has_comments && node.kind == K::Tuple),
            };
            if !has_comments {
                self.group_if(is_grouped, |e| item(e, id));
                after(self, id, next.is_none());
            } else {
                let following = self.comments_after_item(node, id, next);
                self.check_owner_of_comments(node, id, leading, &following);
                self.group_if(is_grouped, |e| {
                    e.leading_comments(leading);
                    item(e, id);
                    for comment in following.before_separator {
                        e.space();
                        e.comment(comment);
                    }
                    e.trailing_comments(following.at_end_of_line);
                });
                after(self, id, next.is_none());
                self.flush_trailing_comments(following.at_end_of_line);
                leading = following.leading_next;
            }
            previous = id;
        }
    }

    fn check_owner_of_comments(
        &mut self,
        list: &Node,
        item: Id,
        leading: &[Comment],
        after: &After,
    ) {
        let has_trailing = !(after.before_separator.is_empty() && after.at_end_of_line.is_empty());
        if leading.is_empty() && !has_trailing {
            return;
        }
        let node = self.node(item);
        let mut trailing = after.before_separator.iter().chain(after.at_end_of_line);
        let has_rule = match node.kind {
            K::Jsx => node.has(flag::PARENS) || !matches!(list.kind, K::Args | K::Array),
            K::Intersection | K::Hole => true,
            kind => kind == K::Union,
        } || (has_trailing && node.has(flag::PARENS))
            || !(after.before_separator.is_empty() || after.at_end_of_line.is_empty())
            || (!matches!(list.kind, K::Args | K::Params | K::Array)
                && !leading.iter().all(|it| it.is_first_on_line))
            || (list.kind == K::Specifiers && !trailing.clone().all(|it| self.ends_line(it)))
            || trailing.any(|it| self.looks_like_type_cast(it));
        if has_rule {
            return self.give_up();
        }
        self.check_owner_of_leading_comments(item, leading);
    }
}

pub(super) struct After<'t> {
    pub(super) before_separator: &'t [Comment],
    pub(super) at_end_of_line: &'t [Comment],
    pub(super) leading_next: &'t [Comment],
}
