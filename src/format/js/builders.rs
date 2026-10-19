//! Builders that know about source positions: lists of nodes that keep the empty lines between
//! them, and lists with separators.

use crate::ir::element::LineMode;
use crate::options::TrailingSeparator;
use crate::prelude::*;
use crate::write;

/// oxfmt doesn't see an empty line in `a: 1\n\n, b: 2`.
fn line_break_search_stops_at_comma(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

impl<'a> Formatter<'a> {
    /// Returns the number of line breaks before the node at `span`, or before its leading comments.
    #[inline]
    pub(crate) fn lines_before(&self, span: Span) -> usize {
        let looks_past_comma = !line_break_search_stops_at_comma(self);
        if self.is_quiet() {
            return (self.source_text()).get_lines_before(span, None, looks_past_comma);
        }
        self.lines_before_node_or_its_comments(span, looks_past_comma)
    }

    fn lines_before_node_or_its_comments(&self, span: Span, looks_past_comma: bool) -> usize {
        let directly_before = self.comments().first_leading_comment_before(span.start);
        // `a\n\n// comment\n, b`: the comment leads `b` too.
        let end_of_token_before = match directly_before {
            Some(comment) => comment.prev_token_end() as usize,
            None => {
                let before = self.source_text().as_bytes().get(..span.start as usize);
                before.unwrap_or_default().trim_ascii_end().len()
            }
        };
        let before_comma = (self.source_text().as_bytes().get(..end_of_token_before))
            .and_then(|before| before.strip_suffix(b","))
            .and_then(|before| {
                self.comments()
                    .first_leading_comment_before(before.len() as u32)
            });
        let first_leading_comment = before_comma.or(directly_before);
        self.source_text().get_lines_before(
            span,
            first_leading_comment.map(|comment| comment.span()),
            looks_past_comma,
        )
    }

    /// True if nothing has been written since the start of a group except the indent and soft line break that a broken
    /// group starts with.
    ///
    /// The only effect of a group that contains nothing but text is that the printer measures again from there, as it
    /// does at the start of any group. So adding such a group here makes no difference.
    pub(crate) fn is_at_start_of_group(&self) -> bool {
        let is_indentation = |it: &&FormatElement| {
            matches!(
                it,
                FormatElement::Tag(Tag::StartIndent) | FormatElement::Line(LineMode::Soft)
            )
        };
        matches!(
            self.elements()
                .iter()
                .rev()
                .take(3)
                .find(|it| !is_indentation(it)),
            Some(FormatElement::Tag(Tag::StartGroup(_)))
        )
    }

    pub(crate) fn join_nodes_with_soft_line<'fmt>(
        &'fmt mut self,
    ) -> JoinNodesBuilder<'fmt, 'a, Line> {
        JoinNodesBuilder::new(soft_line_break_or_space(), self)
    }

    pub(crate) fn join_nodes_with_hardline<'fmt>(
        &'fmt mut self,
    ) -> JoinNodesBuilder<'fmt, 'a, Line> {
        JoinNodesBuilder::new(hard_line_break(), self)
    }

    pub(crate) fn join_nodes_with_space<'fmt>(&'fmt mut self) -> JoinNodesBuilder<'fmt, 'a, Space> {
        JoinNodesBuilder::new(space(), self)
    }

    /// Formats `content` only to see whether it breaks. The comments in it aren't marked as printed.
    pub(crate) fn speculate_will_break(&mut self, content: &(impl Format<'a> + Spanned)) -> bool {
        let snapshot = self.comments().snapshot();
        let will_break = match self.intern(content) {
            Some(element) => element.will_break(self),
            None => false,
        };
        self.comments_mut().restore(snapshot);
        will_break
    }
}

impl<'a, Separator: Format<'a>> JoinBuilder<'_, 'a, Separator> {
    /// Writes `separator` after each entry. `trailing_separator` decides whether it's written after the last one.
    pub(crate) fn entries_with_trailing_separator<F: Format<'a> + Spanned>(
        &mut self,
        entries: impl IntoIterator<Item = F>,
        separator: &'static str,
        trailing_separator: TrailingSeparator,
    ) -> &mut Self {
        let entries = FormatSeparatedIter::new(entries.into_iter(), separator)
            .with_trailing_separator(trailing_separator);
        for entry in entries {
            self.entry(&entry);
        }
        self
    }
}

/// Writes nodes with a separator between them, or an empty line where the source has one.
#[must_use = "must eventually call `finish()` on Format builders"]
pub(crate) struct JoinNodesBuilder<'fmt, 'a, Separator> {
    separator: Separator,
    fmt: &'fmt mut Formatter<'a>,
    has_elements: bool,
}

impl<'fmt, 'a, Separator: Format<'a>> JoinNodesBuilder<'fmt, 'a, Separator> {
    fn new(separator: Separator, fmt: &'fmt mut Formatter<'a>) -> Self {
        Self {
            separator,
            fmt,
            has_elements: false,
        }
    }

    /// `span` is the span of the node that `content` writes.
    pub(crate) fn entry(&mut self, span: Span, content: &(impl Format<'a> + ?Sized)) {
        self.separator_no_entry(span);
        self.has_elements = true;
        content.fmt(self.fmt);
    }

    /// [`JoinNodesBuilder::entry`], with an empty line before it.
    pub(crate) fn entry_after_empty_line(&mut self, content: &(impl Format<'a> + ?Sized)) {
        if self.has_elements {
            write!(self.fmt, empty_line());
        }
        self.has_elements = true;
        content.fmt(self.fmt);
    }

    /// [`JoinNodesBuilder::entry`], but without keeping an empty line before it.
    pub(crate) fn entry_without_empty_line(&mut self, content: &(impl Format<'a> + ?Sized)) {
        if self.has_elements {
            self.separator.fmt(self.fmt);
        }
        self.has_elements = true;
        content.fmt(self.fmt);
    }

    pub(crate) fn separator_no_entry(&mut self, span: Span) {
        if self.has_elements {
            if self.has_lines_before(span) {
                write!(self.fmt, empty_line());
            } else {
                self.separator.fmt(self.fmt);
            }
        }
    }

    pub(crate) fn entries<F: Format<'a> + Spanned>(
        &mut self,
        entries: impl IntoIterator<Item = F>,
    ) -> &mut Self {
        for content in entries {
            self.entry(content.span(), &content);
        }
        self
    }

    pub(crate) fn entries_with_trailing_separator<F: Format<'a> + Spanned>(
        &mut self,
        entries: impl IntoIterator<Item = F>,
        separator: &'static str,
        trailing_separator: TrailingSeparator,
    ) -> &mut Self {
        let entries = FormatSeparatedIter::new(entries.into_iter(), separator)
            .with_trailing_separator(trailing_separator);
        for content in entries {
            self.entry(content.span(), &content);
        }
        self
    }

    /// True if there's an empty line before the node at `span`.
    pub(crate) fn has_lines_before(&self, span: Span) -> bool {
        self.fmt.lines_before(span) > 1
    }
}

/// An element of a list and the separator after it.
#[derive(Clone)]
pub(crate) struct FormatSeparatedElement<E> {
    element: E,
    is_last: bool,
    separator: &'static str,
    options: FormatSeparatedOptions,
}

impl<E> std::ops::Deref for FormatSeparatedElement<E> {
    type Target = E;

    fn deref(&self) -> &E {
        &self.element
    }
}

impl<E: Spanned> Spanned for FormatSeparatedElement<E> {
    fn span(&self) -> Span {
        self.element.span()
    }
}

impl<'a, E: Format<'a>> Format<'a> for FormatSeparatedElement<E> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        self.element.fmt(f);
        if !self.is_last {
            return self.separator.fmt(f);
        }
        match self.options.trailing_separator {
            TrailingSeparator::Allowed => {
                if_group_breaks(&self.separator)
                    .with_group_id(self.options.group_id)
                    .fmt(f);
            }
            TrailingSeparator::Mandatory => self.separator.fmt(f),
            TrailingSeparator::Disallowed | TrailingSeparator::Omit => {}
        }
    }
}

pub(crate) struct FormatSeparatedIter<I, E> {
    next: Option<E>,
    inner: I,
    separator: &'static str,
    options: FormatSeparatedOptions,
}

impl<I: Iterator<Item = E>, E> FormatSeparatedIter<I, E> {
    pub(crate) fn new(inner: I, separator: &'static str) -> Self {
        Self {
            inner,
            separator,
            next: None,
            options: FormatSeparatedOptions::default(),
        }
    }

    #[must_use]
    pub(crate) fn with_trailing_separator(mut self, separator: TrailingSeparator) -> Self {
        self.options.trailing_separator = separator;
        self
    }

    /// Sets the group that decides whether an allowed trailing separator is written. Defaults to the enclosing group.
    #[must_use]
    pub(crate) fn with_group_id(mut self, group_id: Option<GroupId>) -> Self {
        self.options.group_id = group_id;
        self
    }
}

impl<I: Iterator<Item = E>, E> Iterator for FormatSeparatedIter<I, E> {
    type Item = FormatSeparatedElement<E>;

    fn next(&mut self) -> Option<Self::Item> {
        let element = self.next.take().or_else(|| self.inner.next())?;
        self.next = self.inner.next();
        Some(FormatSeparatedElement {
            element,
            is_last: self.next.is_none(),
            separator: self.separator,
            options: self.options,
        })
    }
}

#[derive(Debug, Default, Copy, Clone, Eq, PartialEq)]
struct FormatSeparatedOptions {
    trailing_separator: TrailingSeparator,
    group_id: Option<GroupId>,
}
