//! Builders that know about source positions: lists of nodes that keep the empty lines between
//! them, and lists with separators.

use crate::ir::element::LineMode;
use crate::options::TrailingSeparator;
use crate::prelude::*;
use crate::write;

impl<'a> Formatter<'a> {
    /// The number of line breaks before the node at `span`, or before the comments that lead up
    /// to it.
    #[inline]
    pub(crate) fn lines_before(&self, span: Span) -> usize {
        self.source_text().get_lines_before(span, self.comments().first_unprinted_span())
    }

    /// Whether nothing has been written since the start of a group but what the group starts a
    /// line with if it breaks.
    ///
    /// All that a group with nothing but text in it does is that the printer measures again from
    /// there on, as it does from the start of any group. So here such a group makes no difference.
    pub(crate) fn is_at_start_of_group(&self) -> bool {
        let is_indentation =
            |it: &&FormatElement| matches!(it, FormatElement::Tag(Tag::StartIndent) | FormatElement::Line(LineMode::Soft));
        matches!(
            self.elements().iter().rev().take(3).find(|it| !is_indentation(it)),
            Some(FormatElement::Tag(Tag::StartGroup(_)))
        )
    }

    pub(crate) fn join_nodes_with_soft_line<'fmt>(&'fmt mut self) -> JoinNodesBuilder<'fmt, 'a, Line> {
        JoinNodesBuilder::new(soft_line_break_or_space(), self)
    }

    pub(crate) fn join_nodes_with_hardline<'fmt>(&'fmt mut self) -> JoinNodesBuilder<'fmt, 'a, Line> {
        JoinNodesBuilder::new(hard_line_break(), self)
    }

    pub(crate) fn join_nodes_with_space<'fmt>(&'fmt mut self) -> JoinNodesBuilder<'fmt, 'a, Space> {
        JoinNodesBuilder::new(space(), self)
    }

    /// Formats `content` only to see whether it breaks. The comments in it are not marked as
    /// printed.
    pub(crate) fn speculate_will_break(&mut self, content: &(impl Format<'a> + Spanned)) -> bool {
        let snapshot = self.comments().snapshot();
        self.comments_mut().skip_comments_before(content.span().start);
        let will_break = match self.intern(content) {
            Some(element) => element.will_break(self),
            None => false,
        };
        self.comments_mut().restore(snapshot);
        will_break
    }
}

impl<'a, Separator: Format<'a>> JoinBuilder<'_, 'a, Separator> {
    /// Writes `separator` after each entry. Whether it is written after the last depends on
    /// `trailing_separator`.
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

    /// `span`: of the node that `content` writes.
    pub(crate) fn entry(&mut self, span: Span, content: &(impl Format<'a> + ?Sized)) {
        self.separator_no_entry(span);
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

    /// Whether there is an empty line before the node at `span`.
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
                if_group_breaks(&self.separator).with_group_id(self.options.group_id).fmt(f);
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

    /// The group that decides whether an allowed trailing separator is written. By default, the
    /// enclosing one.
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
