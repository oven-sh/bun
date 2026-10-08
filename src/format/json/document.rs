//! Tree to document, for a text with comments.
//!
//! With comments, where a line ends depends on more than widths, so this writes the document that
//! Prettier's printer for JavaScript writes (`print/object.js`, `print/array.js`,
//! `print/assignment.js`, `main/comments/print.js`), and leaves the rest to the document printer.
//! There is no recursion: a container that is being written is a [`Frame`].

use super::Config;
use super::comments::{
    Attached, Placement, comments_of, has_newline, has_newline_backwards, is_followed_by_empty_line,
    is_previous_line_empty,
};
use super::parser::{
    BLANK_AFTER, BREAK_AFTER_OPEN, CONCISE, Comment, Kind, MATRIX, Node, Owner, QUOTED, REWRITTEN, Tree, UNQUOTED,
    make_string,
};
use crate::ir::element::{
    Condition, FormatElement, Group, GroupId, GroupMode, Interned, LineMode, PrintMode, Tag, Text, TextWidth, Token,
};
use crate::ir::formatter::Storage;
use crate::ir::width::string_width;
use crate::js::utils::number::format_trimmed_number;
use crate::options::QuoteStyle;
use std::num::NonZeroU32;

/// What a value is in, which says what is written after it.
#[derive(Copy, Clone)]
enum Parent {
    Root,
    /// `breaks_after_colon`: the value is on the line after the name.
    Property { name: u32, breaks_after_colon: bool },
    Element,
}

/// A container that is being written.
struct Frame {
    node: u32,
    parent: Parent,
    is_first: bool,
    /// The last element or the value of the last property, unless it is a hole.
    previous: Option<u32>,
}

#[derive(Default)]
pub(super) struct Frames(Vec<Frame>);

struct Builder<'a> {
    text: &'a [u8],
    nodes: &'a [Node],
    comments: &'a [Comment],
    attached: &'a [Attached],
    config: &'a Config,
    storage: &'a mut Storage,
    group_count: u32,
}

/// Writes the document of `tree` to `storage`.
pub(super) fn build(
    text: &[u8],
    tree: &Tree,
    attached: &[Attached],
    config: &Config,
    frames: &mut Frames,
    storage: &mut Storage,
) -> Interned {
    storage.clear();
    let start = storage.pool.len() as u32;
    let mut builder = Builder {
        text,
        nodes: &tree.nodes,
        comments: &tree.comments,
        attached,
        config,
        storage,
        group_count: 0,
    };
    builder.dangling(Owner::NONE);
    builder.values(&mut frames.0);
    builder.line(LineMode::Hard);
    Interned {
        start,
        len: builder.storage.pool.len() as u32 - start,
    }
}

impl Builder<'_> {
    // ───────────────────────────── elements ─────────────────────────────

    #[inline]
    fn push(&mut self, element: FormatElement) {
        self.storage.pool.push(element);
    }

    fn token(&mut self, text: &'static str) {
        if let Some(token) = Token::new(text) {
            self.push(FormatElement::Token(token));
        }
    }

    fn line(&mut self, mode: LineMode) {
        self.push(FormatElement::Line(mode));
    }

    fn tag(&mut self, tag: Tag) {
        self.push(FormatElement::Tag(tag));
    }

    fn start_group(&mut self, should_break: bool, id: Option<GroupId>) {
        let mode = if should_break { GroupMode::Expand } else { GroupMode::Flat };
        self.tag(Tag::StartGroup(Group::new().with_mode(mode).with_id(id)));
    }

    /// `,` if the group breaks. `None`: the enclosing one.
    fn comma_if_group_breaks(&mut self, id: Option<GroupId>) {
        self.tag(Tag::StartConditionalContent(Condition::new(PrintMode::Expanded).with_group_id(id)));
        self.token(",");
        self.tag(Tag::EndConditionalContent);
    }

    fn slice(&self, start: u32, end: u32) -> &[u8] {
        self.text.get(start as usize..end as usize).unwrap_or_default()
    }

    /// A part of the source. Its line breaks are written as they are, without indentation.
    fn source(&mut self, start: u32, end: u32) {
        let width = TextWidth::from_text(self.slice(start, end), self.config.indent_width as u8);
        self.push(FormatElement::SourceText(Text {
            start,
            len: end.saturating_sub(start),
            width,
        }));
    }

    /// What `write` appends, which is on one line.
    fn built(&mut self, write: impl FnOnce(&mut Vec<u8>)) {
        let start = self.storage.text.len();
        write(&mut self.storage.text);
        let text = self.storage.text.get(start..).unwrap_or_default();
        let (len, width) = (text.len() as u32, TextWidth::single(string_width(text)));
        self.push(FormatElement::OwnedText(Text {
            start: start as u32,
            len,
            width,
        }));
    }

    /// What has a `prettier-ignore` comment, as it is in the source. For Prettier that is a string
    /// like any other: its line breaks do not break the groups around it, and all of it counts as
    /// being on the line.
    fn ignored(&mut self, start: u32, end: u32) {
        let (text, line_ending) = (self.text, self.config.line_ending);
        let source = text.get(start as usize..end as usize).unwrap_or_default();
        self.built(|out| {
            for (index, line) in bun_core::strings::split(source, b"\n").enumerate() {
                if index > 0 {
                    out.extend_from_slice(line_ending);
                }
                out.extend_from_slice(line);
            }
        });
    }

    // ───────────────────────────── comments ─────────────────────────────

    fn comment(&self, attached: &Attached) -> Comment {
        self.comments.get(attached.comment as usize).copied().unwrap_or(Comment {
            start: 0,
            end: 0,
            is_block: true,
            enclosing: Owner::NONE,
            preceding: Owner::NONE,
            following: Owner::NONE,
        })
    }

    /// Whether every line of a block comment over several lines starts with a `*`. Its lines are
    /// indented like the code then.
    fn is_indentable(&self, comment: Comment) -> bool {
        let source = self.slice(comment.start, comment.end);
        comment.is_block
            && bun_core::strings::contains_char(source, b'\n')
            && bun_core::strings::split(source, b"\n").skip(1).all(|line| line.trim_ascii_start().starts_with(b"*"))
    }

    /// Prettier's `printComment`
    fn write_comment(&mut self, comment: Comment) {
        let Comment { start, end, .. } = comment;
        if !comment.is_block {
            let len = self.slice(start, end).trim_ascii_end().len() as u32;
            return self.source(start, start + len);
        }
        if !self.is_indentable(comment) {
            return self.source(start, end);
        }
        let text = self.text;
        let source = text.get(start as usize..end as usize).unwrap_or_default();
        let is_jsdoc = source.starts_with(b"/**") && source.get(3) != Some(&b'*');
        let mut at = start;
        let mut lines = bun_core::strings::split(source, b"\n").peekable();
        let mut is_first = true;
        while let Some(line) = lines.next() {
            let line_start = at;
            at += line.len() as u32 + 1;
            let blanks = (line.len() - line.trim_ascii_start().len()) as u32;
            let trimmed = line.trim_ascii();
            if std::mem::take(&mut is_first) {
                self.source(line_start, line_start + line.trim_ascii_end().len() as u32);
                continue;
            }
            self.line(LineMode::Hard);
            self.token(" ");
            self.source(line_start + blanks, line_start + blanks + trimmed.len() as u32);
            // In Markdown, two spaces at the end of a line are a line break. A line break in a text
            // keeps the spaces before it, and the one that follows only indents.
            if is_jsdoc && trimmed != b"*" && line.ends_with(b"  ") && lines.peek().is_some() {
                let start = self.storage.text.len() as u32;
                self.storage.text.extend_from_slice(b"  \n");
                self.push(FormatElement::OwnedText(Text {
                    start,
                    len: 3,
                    width: TextWidth::multiline(2),
                }));
            }
        }
    }

    fn has_comment(&self, owner: Owner, test: impl Fn(&Self, Placement, Comment) -> bool) -> bool {
        comments_of(self.attached, owner).iter().any(|it| test(self, it.placement, self.comment(it)))
    }

    /// Prettier's `hasNodeIgnoreComment`
    fn is_ignored(&self, owner: Owner) -> bool {
        self.has_comment(owner, |this, _, comment| {
            let end = if comment.is_block { comment.end.saturating_sub(2) } else { comment.end };
            bun_lint::utils::text::trim(this.slice(comment.start + 2, end)) == b"prettier-ignore"
        })
    }

    /// Prettier's `printLeadingComments`. `ignored`: the span of the owner if it is written as it is
    /// in the source. The comments in it are in that text.
    fn leading(&mut self, owner: Owner, ignored: Option<(u32, u32)>) {
        let attached = self.attached;
        for it in comments_of(attached, owner).iter().filter(|it| it.placement == Placement::Leading) {
            let comment = self.comment(it);
            if ignored.is_some_and(|(start, end)| comment.start >= start && comment.end <= end) {
                continue;
            }
            self.write_comment(comment);
            let (start, end) = (comment.start as usize, comment.end as usize);
            if is_followed_by_empty_line(self.text, end) {
                self.line(LineMode::Empty);
            } else if !comment.is_block {
                self.line(LineMode::Hard);
            } else if !has_newline(self.text, end) {
                self.push(FormatElement::Space);
            } else if has_newline_backwards(self.text, start) {
                self.line(LineMode::Hard);
            } else {
                self.line(LineMode::SoftOrSpace);
            }
        }
    }

    /// Prettier's `printTrailingComments`
    fn trailing(&mut self, owner: Owner, ignored: Option<(u32, u32)>) {
        let attached = self.attached;
        // Of the previous one: whether it is at the end of the line, and whether it is a block.
        let mut previous: Option<(bool, bool)> = None;
        for it in comments_of(attached, owner).iter().filter(|it| it.placement == Placement::Trailing) {
            let comment = self.comment(it);
            let is_printed = ignored.is_some_and(|(start, end)| comment.start >= start && comment.end <= end);
            let start = comment.start as usize;
            let is_after_line_suffix = previous.is_some_and(|(has_line_suffix, _)| has_line_suffix);
            let is_after_line_comment = previous == Some((true, false));

            if is_after_line_comment || has_newline_backwards(self.text, start) {
                // On a line of its own, after what it belongs to.
                previous = Some((true, comment.is_block));
                if !is_printed {
                    self.tag(Tag::StartLineSuffix);
                    self.line(if is_previous_line_empty(self.text, start) { LineMode::Empty } else { LineMode::Hard });
                    self.write_comment(comment);
                    self.tag(Tag::EndLineSuffix);
                }
            } else if !comment.is_block || is_after_line_suffix {
                previous = Some((true, comment.is_block));
                if !is_printed {
                    self.tag(Tag::StartLineSuffix);
                    self.push(FormatElement::Space);
                    self.write_comment(comment);
                    self.tag(Tag::EndLineSuffix);
                    self.push(FormatElement::ExpandParent);
                }
            } else {
                previous = Some((false, true));
                if !is_printed {
                    self.push(FormatElement::Space);
                    self.write_comment(comment);
                }
            }
        }
    }

    /// Prettier's `printDanglingComments`
    fn dangling(&mut self, owner: Owner) {
        let attached = self.attached;
        let mut is_first = true;
        for it in comments_of(attached, owner).iter().filter(|it| it.placement == Placement::Dangling) {
            if !std::mem::take(&mut is_first) {
                self.line(LineMode::Hard);
            }
            self.write_comment(self.comment(it));
        }
    }

    /// Prettier's `printDanglingCommentsInList`
    fn dangling_in_list(&mut self, owner: Owner) {
        if !self.has_comment(owner, |_, placement, _| placement == Placement::Dangling) {
            return;
        }
        self.tag(Tag::StartIndent);
        self.line(LineMode::Soft);
        self.dangling(owner);
        self.tag(Tag::EndIndent);
        let has_line_comment = self.has_dangling_line_comment(owner);
        self.line(if has_line_comment { LineMode::Hard } else { LineMode::Soft });
    }

    fn has_dangling_line_comment(&self, owner: Owner) -> bool {
        self.has_comment(owner, |_, placement, comment| placement == Placement::Dangling && !comment.is_block)
    }

    // ───────────────────────────── nodes ─────────────────────────────

    /// Anything but an object, an array and a sign, without its comments.
    fn scalar(&mut self, node: &Node) {
        let text = self.text;
        let source = text.get(node.start as usize..node.end as usize).unwrap_or_default();
        match node.kind {
            Kind::String if node.has(REWRITTEN) => {
                let quote = if source.first() == Some(&b'"') { QuoteStyle::Single } else { QuoteStyle::Double };
                let content = source.get(1..source.len().saturating_sub(1)).unwrap_or_default();
                let start = self.storage.text.len();
                make_string(content, quote, &mut self.storage.text);
                let written = self.storage.text.get(start..).unwrap_or_default();
                let (len, width) = (written.len() as u32, TextWidth::from_text(written, self.config.indent_width as u8));
                self.push(FormatElement::OwnedText(Text {
                    start: start as u32,
                    len,
                    width,
                }));
            }
            Kind::Number if node.has(REWRITTEN) => self.built(|out| out.extend_from_slice(&format_trimmed_number(source))),
            Kind::Template => {
                self.push(FormatElement::LineSuffixBoundary);
                self.source(node.start, node.end);
            }
            _ => self.source(node.start, node.end),
        }
    }

    /// Prettier's `printKey`
    fn name(&mut self, index: u32) {
        let Some(node) = self.nodes.get(index as usize) else {
            return;
        };
        let owner = Owner::node(index);
        if node.has(UNQUOTED) {
            self.leading(owner, None);
            self.source(node.start + 1, node.end.saturating_sub(1));
            self.trailing(owner, None);
        } else if node.has(QUOTED) {
            self.leading(owner, None);
            let quote = self.config.name_quote.as_str();
            self.token(quote);
            self.scalar(node);
            self.token(quote);
            self.trailing(owner, None);
        } else {
            self.scalar_with_comments(index);
        }
    }

    fn scalar_with_comments(&mut self, index: u32) {
        let Some(node) = self.nodes.get(index as usize) else {
            return;
        };
        let owner = Owner::node(index);
        let ignored = self.is_ignored(owner).then_some((node.start, node.end));
        self.leading(owner, ignored);
        match ignored {
            Some((start, end)) => self.ignored(start, end),
            None => self.scalar(node),
        }
        self.trailing(owner, ignored);
    }

    /// What is written after the value at `index`, and after what is around it.
    fn finish_value(&mut self, index: u32, parent: Parent, ignored: Option<(u32, u32)>) {
        self.trailing(Owner::node(index), ignored);
        self.finish_parent(parent);
    }

    /// Prettier's `isConciselyPrintedArray`, for an array of numbers.
    fn is_concise(&self, array: &Node, first: u32) -> bool {
        let mut index = first;
        while index < array.next {
            let Some(element) = self.nodes.get(index as usize) else {
                break;
            };
            let has_comment_on_operand = element.kind == Kind::Unary && self.has_comment(Owner::node(index + 1), |_, _, _| true);
            let has_line_comment_behind = self.has_comment(Owner::node(index), |this, placement, comment| {
                placement == Placement::Trailing
                    && !comment.is_block
                    && !has_newline_backwards(this.text, comment.start as usize)
            });
            if has_comment_on_operand || has_line_comment_behind {
                return false;
            }
            index = element.next;
        }
        true
    }

    /// An array of numbers: as many on each line as fit. `index`: of the array.
    fn concise_array(&mut self, index: u32, array: &Node, id: GroupId) {
        self.tag(Tag::StartFill);
        let mut element_index = index + 1;
        while let Some(element) = self.nodes.get(element_index as usize).filter(|_| element_index < array.next) {
            let is_last = element.next == array.next;
            self.tag(Tag::StartEntry);
            self.sign_or_scalar(element_index);
            if !is_last {
                self.token(",");
            } else if self.config.trailing_comma {
                self.comma_if_group_breaks(Some(id));
            }
            self.tag(Tag::EndEntry);
            if !is_last {
                let has_leading_line_comment = self.has_comment(Owner::node(element.next), |_, placement, comment| {
                    placement == Placement::Leading && !comment.is_block
                });
                self.tag(Tag::StartEntry);
                self.line(match (element.has(BLANK_AFTER), has_leading_line_comment) {
                    (true, _) => LineMode::Empty,
                    (false, true) => LineMode::Hard,
                    (false, false) => LineMode::SoftOrSpace,
                });
                self.tag(Tag::EndEntry);
            }
            element_index = element.next;
        }
        self.tag(Tag::EndFill);
    }

    /// Anything but an object and an array, with its comments.
    fn sign_or_scalar(&mut self, index: u32) {
        let Some(node) = self.nodes.get(index as usize).filter(|node| node.kind == Kind::Unary) else {
            return self.scalar_with_comments(index);
        };
        let owner = Owner::node(index);
        let ignored = self.is_ignored(owner).then_some((node.start, node.end));
        self.leading(owner, ignored);
        if let Some((start, end)) = ignored {
            self.ignored(start, end);
        } else {
            self.source(node.start, node.start + 1);
            // Prettier puts an operand with a comment in parentheses.
            let has_comment = self.has_comment(Owner::node(index + 1), |_, _, _| true);
            if has_comment {
                self.start_group(false, None);
                self.token("(");
                self.tag(Tag::StartIndent);
                self.line(LineMode::Soft);
            }
            self.scalar_with_comments(index + 1);
            if has_comment {
                self.tag(Tag::EndIndent);
                self.line(LineMode::Soft);
                self.token(")");
                self.tag(Tag::EndGroup);
            }
        }
        self.trailing(owner, ignored);
    }

    fn close(&mut self, frame: &Frame) {
        let Some(node) = self.nodes.get(frame.node as usize) else {
            return;
        };
        if node.kind == Kind::Object {
            self.tag(Tag::EndIndent);
            if self.config.trailing_comma {
                self.comma_if_group_breaks(None);
            }
            self.line(if self.config.bracket_spacing { LineMode::SoftOrSpace } else { LineMode::Soft });
            self.token("}");
        } else {
            if frame.previous.is_none() {
                // The comma after a hole is what makes it an element.
                self.token(",");
            } else if self.config.trailing_comma {
                self.comma_if_group_breaks(None);
            }
            self.dangling(Owner::node(frame.node));
            self.tag(Tag::EndIndent);
            self.line(LineMode::Soft);
            self.token("]");
        }
        self.tag(Tag::EndGroup);
        self.finish_value(frame.node, frame.parent, None);
    }

    /// All the nodes.
    fn values(&mut self, frames: &mut Vec<Frame>) {
        frames.clear();
        let nodes = self.nodes;
        let mut index = 0u32;
        loop {
            while let Some(frame) = frames.last()
                && nodes.get(frame.node as usize).is_none_or(|node| node.next == index)
            {
                self.close(frame);
                frames.pop();
            }
            if nodes.get(index as usize).is_none() {
                return;
            }

            // What is before the value.
            let mut parent = Parent::Root;
            if let Some(frame) = frames.last_mut() {
                let is_object = nodes.get(frame.node as usize).is_some_and(|node| node.kind == Kind::Object);
                let is_after_blank =
                    frame.previous.and_then(|it| nodes.get(it as usize)).is_some_and(|it| it.has(BLANK_AFTER));
                if !std::mem::take(&mut frame.is_first) {
                    self.token(",");
                    self.line(match (is_after_blank, is_object) {
                        (false, _) => LineMode::SoftOrSpace,
                        (true, true) => LineMode::Empty,
                        (true, false) => LineMode::SoftOrSpaceEmpty,
                    });
                }
                if !is_object {
                    let is_hole = nodes.get(index as usize).is_some_and(|node| node.kind == Kind::Hole);
                    frame.previous = (!is_hole).then_some(index);
                    if is_hole {
                        index += 1;
                        continue;
                    }
                    parent = Parent::Element;
                    self.start_group(false, None);
                } else {
                    let name = index;
                    index += 1;
                    frame.previous = Some(index);
                    let (Some(name_node), Some(value)) = (nodes.get(name as usize), nodes.get(index as usize)) else {
                        return;
                    };
                    let property = Owner::property(name);
                    if self.is_ignored(property) {
                        let span = (name_node.start, value.end);
                        self.leading(property, Some(span));
                        self.ignored(span.0, span.1);
                        self.trailing(property, Some(span));
                        index = value.next;
                        continue;
                    }
                    self.leading(property, None);
                    self.start_group(false, None);
                    self.start_group(false, None);
                    self.name(name);
                    self.tag(Tag::EndGroup);
                    self.token(":");
                    // Prettier's `hasLeadingOwnLineComment`, and a comment whose lines are indented
                    let breaks_after_colon = self.has_comment(Owner::node(index), |this, placement, comment| {
                        placement == Placement::Leading
                            && (has_newline(this.text, comment.end as usize) || this.is_indentable(comment))
                    });
                    if breaks_after_colon {
                        self.start_group(false, None);
                        self.tag(Tag::StartIndent);
                        self.line(LineMode::SoftOrSpace);
                    } else {
                        self.push(FormatElement::Space);
                    }
                    parent = Parent::Property {
                        name,
                        breaks_after_colon,
                    };
                }
            }

            let Some(node) = nodes.get(index as usize) else {
                return;
            };
            let owner = Owner::node(index);
            if !node.is_container() {
                // Its own comments are written with it.
                self.sign_or_scalar(index);
                self.finish_parent(parent);
                index = node.next;
                continue;
            }
            if self.is_ignored(owner) {
                let span = (node.start, node.end);
                self.leading(owner, Some(span));
                self.ignored(span.0, span.1);
                self.finish_value(index, parent, Some(span));
                index = node.next;
                continue;
            }
            self.leading(owner, None);
            let is_object = node.kind == Kind::Object;
            if node.count == 0 {
                self.start_group(false, None);
                self.token(if is_object { "{" } else { "[" });
                self.dangling_in_list(owner);
                self.token(if is_object { "}" } else { "]" });
                self.tag(Tag::EndGroup);
                self.finish_value(index, parent, None);
                index += 1;
                continue;
            }
            if is_object {
                self.start_group(self.config.preserves_wrap && node.has(BREAK_AFTER_OPEN), None);
                self.token("{");
                self.tag(Tag::StartIndent);
                self.line(if self.config.bracket_spacing { LineMode::SoftOrSpace } else { LineMode::Soft });
            } else {
                self.group_count += 1;
                let id = NonZeroU32::new(self.group_count).map(GroupId::new);
                self.start_group(node.has(MATRIX) || self.has_dangling_line_comment(owner), id);
                self.token("[");
                self.tag(Tag::StartIndent);
                self.line(LineMode::Soft);
                if let Some(id) = id
                    && node.has(CONCISE)
                    && self.is_concise(node, index + 1)
                {
                    self.concise_array(index, node, id);
                    self.dangling(owner);
                    self.tag(Tag::EndIndent);
                    self.line(LineMode::Soft);
                    self.token("]");
                    self.tag(Tag::EndGroup);
                    self.finish_value(index, parent, None);
                    index = node.next;
                    continue;
                }
            }
            frames.push(Frame {
                node: index,
                parent,
                is_first: true,
                previous: None,
            });
            index += 1;
        }
    }

    /// The end of what is around a value.
    fn finish_parent(&mut self, parent: Parent) {
        match parent {
            Parent::Root => {}
            Parent::Element => self.tag(Tag::EndGroup),
            Parent::Property {
                name,
                breaks_after_colon,
            } => {
                if breaks_after_colon {
                    self.tag(Tag::EndIndent);
                    self.tag(Tag::EndGroup);
                }
                self.tag(Tag::EndGroup);
                self.trailing(Owner::property(name), None);
            }
        }
    }
}
