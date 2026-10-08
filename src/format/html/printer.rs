//! Prettier's `language-html/printer-html.js` and `print/*.js`.

use super::ast::{Attribute, Flags, Id, Kind, StartTagComment, Tree};
use super::cursor::{Cursor, Target};
use super::tag::Tags;
use super::utilities::{
    html_split, html_trim, html_trim_end, html_trim_preserve_indentation, is_pre_like,
    is_script_like_tag, is_text_like, min_indentation, should_unquote_attribute_value,
    unescape_quote_entities,
};
use super::writer::Writer;
use super::{Options, Parser};
use crate::css::text;
use crate::ir::element::CursorMark;
use crate::options::{AttributePosition, EmbeddedLanguageFormatting};
use bun_core::strings;

pub(crate) struct Printer<'t, 'a, 'o, 'w, 'f> {
    pub(crate) tree: &'t Tree<'a>,
    pub(crate) options: &'o Options<'o>,
    pub(crate) out: Writer<'w, 'f>,
    /// How many nodes are around the one that is being printed.
    pub(crate) ancestors: usize,
    pub(crate) stack_check: bun_core::StackCheck,
    pub(crate) is_nested_too_deeply: bool,
    /// `isVueSfcWithTypescriptScript`, once it has been asked.
    pub(crate) has_typescript_script: Option<bool>,
    pub(crate) cursor: Cursor,
}

/// What `printBetweenLine` returns.
#[derive(Copy, Clone, PartialEq, Eq)]
enum BetweenLine {
    Nothing,
    Line,
    Softline,
    Hardline,
}

/// `getPrettierIgnoreAttributeCommentData`
enum IgnoredAttributes<'c> {
    None,
    All,
    /// The names, with white space between them.
    Named(&'c [u8]),
}

impl<'c> IgnoredAttributes<'c> {
    fn from_comment(value: &'c [u8]) -> Self {
        // `/^prettier-ignore-attribute(?:\s+(.+))?$/s`
        let Some(rest) = text::trim(value).strip_prefix(b"prettier-ignore-attribute") else {
            return IgnoredAttributes::None;
        };
        match rest {
            b"" => IgnoredAttributes::All,
            _ if text::starts_with_white_space(rest) => {
                IgnoredAttributes::Named(text::trim_start(rest))
            }
            _ => IgnoredAttributes::None,
        }
    }

    fn has(&self, attr: &Attribute<'_>) -> bool {
        match *self {
            IgnoredAttributes::None => false,
            IgnoredAttributes::All => true,
            IgnoredAttributes::Named(mut names) => {
                let (namespace, name) = attr.raw_name();
                while !names.is_empty() {
                    let len = (0..names.len())
                        .find(|&at| text::starts_with_white_space(&names[at..]))
                        .unwrap_or(names.len());
                    let is_same = match namespace {
                        b"" => &names[..len] == name,
                        _ => {
                            names[..len]
                                .strip_prefix(namespace)
                                .and_then(|rest| rest.strip_prefix(b":"))
                                == Some(name)
                        }
                    };
                    if is_same {
                        return true;
                    }
                    names = text::trim_start(&names[len..]);
                }
                false
            }
        }
    }
}

/// An attribute or a comment in a start tag.
#[derive(Copy, Clone)]
enum InStartTag<'t, 'a> {
    Attribute(&'t Attribute<'a>),
    Comment(&'t StartTagComment<'a>),
}

impl<'t, 'a, 'o> Printer<'t, 'a, 'o, '_, '_> {
    #[inline]
    pub(crate) fn tags(&self) -> Tags<'t, 'a, 'o> {
        Tags {
            tree: self.tree,
            options: self.options,
        }
    }

    pub(crate) fn formats_embedded(&self) -> bool {
        matches!(
            self.options.format.embedded_language_formatting,
            EmbeddedLanguageFormatting::Auto
        )
    }

    /// `ends_with_line_break`: `stripTrailingHardline` is not called for the document.
    pub(crate) fn print_root(&mut self, ends_with_line_break: bool) {
        let root = self.tree.root;
        self.out.start_group();
        self.print_children(root);
        self.out.end_group();
        if ends_with_line_break {
            self.out.hardline();
        }
    }

    /// Calls `print`, which prints `target`, and notes where the part of the text that the cursor is in starts and ends.
    pub(crate) fn with_cursor_marks(&mut self, target: Target, print: impl FnOnce(&mut Self)) {
        let (starts_before, starts_after, ends_before, ends_after) = match self.cursor {
            Cursor::Nowhere => return print(self),
            Cursor::In(node) => (node == target, false, false, node == target),
            Cursor::Between { before, after } => {
                (false, before == Some(target), after == Some(target), false)
            }
        };
        if starts_before {
            self.out.cursor_mark(CursorMark::RegionStart);
        }
        if ends_before {
            self.out.cursor_mark(CursorMark::RegionEnd);
        }
        print(self);
        if starts_after {
            self.out.cursor_mark(CursorMark::RegionStart);
        }
        if ends_after {
            self.out.cursor_mark(CursorMark::RegionEnd);
        }
    }

    /// What Prettier's `mainPrint` comes to: what `embed` has made of the node, or else what `genericPrint` makes.
    pub(crate) fn print_node(&mut self, id: Id) {
        self.with_cursor_marks(Target::Node(id), |printer| {
            printer.print_node_without_marks(id)
        });
    }

    fn print_node_without_marks(&mut self, id: Id) {
        if !self.stack_check.is_safe_to_recurse() {
            self.is_nested_too_deeply = true;
            return;
        }
        if self.formats_embedded() && self.embed(id) {
            return;
        }
        self.generic_print(id);
    }

    fn generic_print(&mut self, id: Id) {
        let (tags, node) = (self.tags(), &self.tree[id]);
        match node.kind {
            Kind::Root => self.print_root(true),
            Kind::FrontMatter => self.out.text(node.span.of(self.options.original_text)),
            Kind::Element | Kind::IeConditionalComment => self.print_element(id),
            Kind::AngularControlFlowBlock => self.print_angular_control_flow_block(id),
            Kind::AngularControlFlowBlockParameters => {
                self.print_angular_control_flow_block_parameters(id)
            }
            Kind::AngularControlFlowBlockParameter => self.out.text(html_trim(&node.value)),
            Kind::AngularLetDeclaration => self.print_angular_let_declaration(id),
            Kind::AngularIcuExpression => self.print_angular_icu_expression(id),
            Kind::AngularIcuCase => self.print_angular_icu_case(id),
            Kind::IeConditionalStartComment | Kind::IeConditionalEndComment => {
                self.out.built_text(|out| tags.opening_tag_start(id, out));
                self.out.built_text(|out| tags.closing_tag_end(id, out));
            }
            Kind::Interpolation => {
                self.out.built_text(|out| tags.opening_tag_start(id, out));
                self.with_ancestor(|printer| {
                    for child in printer.tree.children(id) {
                        printer.print_node(child);
                    }
                });
                self.out.built_text(|out| tags.closing_tag_end(id, out));
            }
            Kind::Text => self.print_text(id),
            Kind::DocType => {
                self.out.start_group();
                self.out.built_text(|out| tags.opening_tag_start(id, out));
                self.out.token(" ");
                // `.replace(/^html\b/i, "html").replaceAll(/\s+/g, " ")`
                let mut value = &node.value[..];
                if value.len() >= 4
                    && value[..4].eq_ignore_ascii_case(b"html")
                    && !value
                        .get(4)
                        .is_some_and(|&byte| text::is_word_character(byte))
                {
                    self.out.token("html");
                    value = &value[4..];
                }
                while !value.is_empty() {
                    let len = (0..value.len())
                        .find(|&at| text::starts_with_white_space(&value[at..]))
                        .unwrap_or(value.len());
                    self.out.text(&value[..len]);
                    let rest = text::trim_start(&value[len..]);
                    if rest.len() < value.len() - len {
                        self.out.token(" ");
                    }
                    value = rest;
                }
                self.out.end_group();
                self.out.built_text(|out| tags.closing_tag_end(id, out));
            }
            Kind::Comment => {
                self.out.built_text(|out| tags.opening_tag_prefix(id, out));
                self.out.text(node.span.of(self.options.original_text));
                self.out.built_text(|out| tags.closing_tag_suffix(id, out));
            }
            // It has become a text.
            Kind::Cdata => {}
        }
    }

    pub(crate) fn with_ancestor<R>(&mut self, print: impl FnOnce(&mut Self) -> R) -> R {
        self.ancestors += 1;
        let result = print(self);
        self.ancestors -= 1;
        result
    }

    fn print_text(&mut self, id: Id) {
        let (tags, node) = (self.tags(), &self.tree[id]);
        let value = &node.value[..];
        let Some(parent) = self.tree.parent_of(id) else {
            return;
        };
        if parent.kind == Kind::Interpolation {
            // The line break at the end is not a literal one: `/\n[^\S\n]*$/`
            let text_len = text::trim_end(value).len();
            return match strings::last_index_of_char(&value[text_len..], b'\n') {
                Some(at) => {
                    self.out.text(&value[..text_len + at]);
                    self.out.hardline();
                }
                None => self.out.text(value),
            };
        }
        if parent.has(Flags::IS_WHITESPACE_SENSITIVE) {
            // All that is between the parts of the `fill` is forced line breaks, so it is as good as an array.
            self.out.built_text(|out| tags.opening_tag_prefix(id, out));
            match parent.has(Flags::IS_INDENTATION_SENSITIVE) {
                true => self.out.text(value),
                false => {
                    let value = html_trim_preserve_indentation(value);
                    let dedent = min_indentation(value);
                    for (index, line) in strings::split(value, b"\n").enumerate() {
                        if index > 0 {
                            self.out.hardline();
                        }
                        self.out.text(line.get(dedent..).unwrap_or_default());
                    }
                }
            }
            return self.out.built_text(|out| tags.closing_tag_suffix(id, out));
        }
        // The first and the last part of the `fill` have what is borrowed.
        self.out.start_fill();
        self.out.start_item();
        self.out.built_text(|out| tags.opening_tag_prefix(id, out));
        for (index, word) in html_split(value).enumerate() {
            if index > 0 {
                self.out.end_item();
                self.out.start_item();
                self.out.line();
                self.out.end_item();
                self.out.start_item();
            }
            self.out.text(word);
        }
        self.out.built_text(|out| tags.closing_tag_suffix(id, out));
        self.out.end_item();
        self.out.end_fill();
    }

    // ───────────────────────────── `print/children.js` ─────────────────────────────

    /// `getEndLocation`
    fn end_location(&self, mut id: Id) -> u32 {
        let mut end = self.tree[id].span.end;
        // An element can be unclosed.
        while self.tree[id].kind == Kind::Element
            && !self.tree[id].has(Flags::HAS_END_SPAN)
            && let Some(last) = self.tree.last_child(id)
        {
            id = last;
            end = end.max(self.tree[id].span.end);
        }
        end
    }

    fn print_child(&mut self, child: Id) {
        if !self.tree.has_prettier_ignore(child) {
            return self.print_node(child);
        }
        let tags = self.tags();
        let mut start = self.tree[child].span.start as usize;
        if self
            .tree
            .prev(child)
            .is_some_and(|prev| tags.needs_to_borrow_next_opening_tag_start_marker(prev))
        {
            start += tags.len_of(|tags, out| tags.opening_tag_start_marker(child, out));
        }
        let mut end = self.end_location(child) as usize;
        if self
            .tree
            .next(child)
            .is_some_and(|next| tags.needs_to_borrow_prev_closing_tag_end_marker(next))
        {
            end = end
                .saturating_sub(tags.len_of(|tags, out| tags.closing_tag_end_marker(child, out)));
        }
        self.out
            .built_text(|out| tags.opening_tag_prefix(child, out));
        self.out.text(html_trim_end(
            self.options
                .original_text
                .get(start..end)
                .unwrap_or_default(),
        ));
        self.out
            .built_text(|out| tags.closing_tag_suffix(child, out));
    }

    fn between_line(&self, prev: Id, next: Id) -> BetweenLine {
        let (tags, tree, options) = (self.tags(), self.tree, self.options);
        let (prev_node, next_node) = (&tree[prev], &tree[next]);
        if is_text_like(prev_node) && is_text_like(next_node) {
            if prev_node.has(Flags::IS_TRAILING_SPACE_SENSITIVE) {
                if !prev_node.has(Flags::HAS_TRAILING_SPACES) {
                    return BetweenLine::Nothing;
                }
                return match tree.prefer_hardline_as_leading_spaces(next, options) {
                    true => BetweenLine::Hardline,
                    false => BetweenLine::Line,
                };
            }
            return match tree.prefer_hardline_as_leading_spaces(next, options) {
                true => BetweenLine::Hardline,
                false => BetweenLine::Softline,
            };
        }
        if (tags.needs_to_borrow_next_opening_tag_start_marker(prev)
            && (tree.has_prettier_ignore(next)
                || tree.has_children(next)
                || next_node.has(Flags::IS_SELF_CLOSING)
                || (next_node.kind == Kind::Element && next_node.has_attrs())))
            || (prev_node.kind == Kind::Element
                && prev_node.has(Flags::IS_SELF_CLOSING)
                && tags.needs_to_borrow_prev_closing_tag_end_marker(next))
        {
            return BetweenLine::Nothing;
        }
        if next_node.kind == Kind::Comment
            && next_node.has(Flags::IS_LEADING_SPACE_SENSITIVE)
            && !next_node.has(Flags::HAS_LEADING_SPACES)
        {
            return BetweenLine::Softline;
        }
        if !next_node.has(Flags::IS_LEADING_SPACE_SENSITIVE)
            || tree.prefer_hardline_as_leading_spaces(next, options)
            || (tags.needs_to_borrow_prev_closing_tag_end_marker(next)
                && tree.last_child(prev).is_some_and(|last| {
                    tags.needs_to_borrow_parent_closing_tag_start_marker(last)
                        && tree.last_child(last).is_some_and(|last| {
                            tags.needs_to_borrow_parent_closing_tag_start_marker(last)
                        })
                }))
        {
            return BetweenLine::Hardline;
        }
        match next_node.has(Flags::HAS_LEADING_SPACES) {
            true => BetweenLine::Line,
            false => BetweenLine::Softline,
        }
    }

    fn write_between_line(&mut self, line: BetweenLine) {
        match line {
            BetweenLine::Nothing => {}
            BetweenLine::Line => self.out.line(),
            BetweenLine::Softline => self.out.softline(),
            BetweenLine::Hardline => self.out.hardline(),
        }
    }

    pub(crate) fn print_children(&mut self, parent: Id) {
        self.with_ancestor(|printer| printer.print_children_of(parent));
    }

    fn print_children_of(&mut self, parent: Id) {
        let (tree, options) = (self.tree, self.options);
        if tree.force_break_children(parent) {
            self.out.break_parent();
            for child in tree.children(parent) {
                if let Some(prev) = tree.prev(child) {
                    let line = self.between_line(prev, child);
                    self.write_between_line(line);
                    if line != BetweenLine::Nothing && tree.force_next_empty_line(prev, options) {
                        self.out.hardline();
                    }
                }
                self.print_child(child);
            }
            return;
        }
        // What is between a child and the one before it, if the one before it has asked.
        let mut known_line = None;
        // The id of the group of the child before, if this one asks about it.
        let mut prev_group_id = None;
        for child in tree.children(parent) {
            let prev = tree.prev(child);
            let prev_line = known_line.take();
            if is_text_like(&tree[child]) {
                if let Some(prev) = prev.filter(|&prev| is_text_like(&tree[prev])) {
                    let line = self.between_line(prev, child);
                    if line != BetweenLine::Nothing {
                        if tree.force_next_empty_line(prev, options) {
                            self.out.hardline();
                            self.out.hardline();
                        } else {
                            self.write_between_line(line);
                        }
                    }
                }
                self.print_child(child);
                continue;
            }
            let next = tree.next(child);
            let prev_line = match prev {
                Some(prev) => prev_line.unwrap_or_else(|| self.between_line(prev, child)),
                None => BetweenLine::Nothing,
            };
            let next_line =
                next.map_or(BetweenLine::Nothing, |next| self.between_line(child, next));
            known_line = Some(next_line);

            // What comes before the groups, and what is at the start of the outer one.
            let mut leading_line = None;
            if let Some(prev) = prev.filter(|_| prev_line != BetweenLine::Nothing) {
                if tree.force_next_empty_line(prev, options) {
                    self.out.hardline();
                    self.out.hardline();
                } else if prev_line == BetweenLine::Hardline {
                    self.out.hardline();
                } else {
                    leading_line = Some(is_text_like(&tree[prev]));
                }
            }
            self.out.start_group();
            match leading_line {
                Some(true) => self.write_between_line(prev_line),
                Some(false) => {
                    self.out.start_if(false, prev_group_id);
                    self.out.softline();
                    self.out.end_if();
                }
                None => {}
            }
            let forces_next_empty_line =
                next_line != BetweenLine::Nothing && tree.force_next_empty_line(child, options);
            let is_trailing_line = next_line != BetweenLine::Nothing
                && !forces_next_empty_line
                && next_line != BetweenLine::Hardline;
            // Only an element behind it asks whether the group is broken.
            prev_group_id = match next {
                Some(next) if is_trailing_line && !is_text_like(&tree[next]) => {
                    Some(self.out.new_group_id())
                }
                _ => None,
            };
            self.out.start_group_with(false, prev_group_id);
            self.print_child(child);
            if is_trailing_line {
                self.write_between_line(next_line);
            }
            self.out.end_group();
            self.out.end_group();
            if next.is_some_and(|next| is_text_like(&tree[next])) {
                if forces_next_empty_line {
                    self.out.hardline();
                    self.out.hardline();
                } else if next_line == BetweenLine::Hardline {
                    self.out.hardline();
                }
            }
        }
    }

    // ───────────────────────────── `print/element.js` ─────────────────────────────

    fn print_element(&mut self, id: Id) {
        let (tags, tree, options) = (self.tags(), self.tree, self.options);
        let node = &tree[id];
        if tree.should_preserve_content(id, options) {
            self.out.built_text(|out| tags.opening_tag_prefix(id, out));
            self.out.start_group();
            self.print_opening_tag(id);
            self.out.end_group();
            self.out.text(tags.node_content(id));
            self.out.built_text(|out| tags.closing_tag(id, out));
            self.out.built_text(|out| tags.closing_tag_suffix(id, out));
            return;
        }
        let (Some(first), Some(last)) = (tree.first_child(id), tree.last_child(id)) else {
            self.out.start_group();
            self.out.start_group();
            self.print_opening_tag(id);
            self.out.end_group();
            if node.has(Flags::HAS_DANGLING_SPACES | Flags::IS_DANGLING_SPACE_SENSITIVE) {
                self.out.line();
            }
            self.out.built_text(|out| tags.closing_tag(id, out));
            self.out.end_group();
            return;
        };
        let (first_node, last_node) = (&tree[first], &tree[last]);
        let has_sensitive_leading_spaces =
            first_node.has(Flags::HAS_LEADING_SPACES | Flags::IS_LEADING_SPACE_SENSITIVE);
        let has_sensitive_trailing_spaces =
            last_node.has(Flags::HAS_TRAILING_SPACES | Flags::IS_TRAILING_SPACE_SENSITIVE);
        let should_hug_content = first == last
            && matches!(
                first_node.kind,
                Kind::Interpolation | Kind::AngularIcuExpression
            )
            && first_node.has(Flags::IS_LEADING_SPACE_SENSITIVE)
            && !first_node.has(Flags::HAS_LEADING_SPACES)
            && last_node.has(Flags::IS_TRAILING_SPACE_SENSITIVE)
            && !last_node.has(Flags::HAS_TRAILING_SPACES);
        let attr_group_id = should_hug_content.then(|| self.out.new_group_id());
        let is_sensitive_text = |kind: Kind| {
            kind == Kind::Text
                && node.has(Flags::IS_WHITESPACE_SENSITIVE | Flags::IS_INDENTATION_SENSITIVE)
        };

        self.out.start_group();
        self.out.start_group_with(false, attr_group_id);
        self.print_opening_tag(id);
        self.out.end_group();
        if tree.force_break_content(id, options) {
            self.out.break_parent();
        }

        // `printChildrenDoc`
        let is_indented = attr_group_id.is_none()
            && !((is_script_like_tag(node, options) || tree.is_vue_custom_block(id, options))
                && tree
                    .parent_of(id)
                    .is_some_and(|parent| parent.kind == Kind::Root)
                && options.parser == Parser::Vue
                && !options.format.vue_indent_script_and_style);
        let outer_indent_level = attr_group_id.map(|id| self.out.start_indent_if_break(id));
        if is_indented {
            self.out.start_indent();
        }
        // `printLineBeforeChildren`
        if let Some(id) = attr_group_id {
            self.out.softline_if_break(id);
        } else if has_sensitive_leading_spaces {
            self.out.line();
        } else if is_sensitive_text(first_node.kind) {
            self.out.softline_dedented_to_root();
        } else {
            self.out.softline();
        }
        self.print_children(id);
        if let (Some(id), Some(level)) = (attr_group_id, outer_indent_level) {
            self.out.end_indent_if_break(id, level);
        }
        if is_indented {
            self.out.end_indent();
        }

        // `printLineAfterChildren`
        let needs_to_borrow = match (tree.next(id), tree.parent(id)) {
            (Some(next), _) => tags.needs_to_borrow_prev_closing_tag_end_marker(next),
            (None, Some(parent)) => tags.needs_to_borrow_last_child_closing_tag_end_marker(parent),
            (None, None) => false,
        };
        if needs_to_borrow {
            if has_sensitive_trailing_spaces {
                self.out.token(" ");
            }
        } else if is_pre_like(node) && tags.needs_to_borrow_parent_closing_tag_start_marker(last) {
        } else if let Some(id) = attr_group_id {
            self.out.softline_if_break(id);
        } else if has_sensitive_trailing_spaces {
            self.out.line();
        } else if (last_node.kind == Kind::Comment || is_sensitive_text(last_node.kind)) && {
            // `\n[\t ]{n}$`, where `n` is the indentation of the element.
            let width =
                usize::from(options.format.indent_width.value()) * self.ancestors.saturating_sub(1);
            let value = &last_node.value[..];
            value.len() > width
                && value[value.len() - width..]
                    .iter()
                    .all(|byte| matches!(byte, b'\t' | b' '))
                && value[value.len() - width - 1] == b'\n'
        } {
        } else {
            self.out.softline();
        }
        self.out.built_text(|out| tags.closing_tag(id, out));
        self.out.end_group();
    }

    // ───────────────────────────── `print/tag.js` ─────────────────────────────

    pub(crate) fn print_opening_tag(&mut self, id: Id) {
        let tags = self.tags();
        self.out.built_text(|out| tags.opening_tag_start(id, out));
        self.print_attributes(id);
        if !self.tree[id].has(Flags::IS_SELF_CLOSING) {
            self.out.built_text(|out| tags.opening_tag_end(id, out));
        }
    }

    fn print_attributes(&mut self, id: Id) {
        let (tags, tree, options) = (self.tags(), self.tree, self.options);
        let node = &tree[id];
        let is_self_closing = node.has(Flags::IS_SELF_CLOSING);
        let (attributes, comments) = (tree.attrs(id), tree.start_tag_comments(id));
        if attributes.is_empty() && comments.is_empty() {
            if is_self_closing {
                self.out.token(" ");
            }
            return;
        }
        let ignored = match tree.prev_of(id) {
            Some(prev) if prev.kind == Kind::Comment => {
                IgnoredAttributes::from_comment(&prev.value)
            }
            _ => IgnoredAttributes::None,
        };
        let force_not_to_break_attr_content = node.kind == Kind::Element
            && node.is_full_name(b"script")
            && matches!(attributes, [only] if only.is_full_name(b"src"))
            && !tree.has_children(id)
            && comments.is_empty();
        let should_force_break = comments.iter().any(|comment| comment.is_single_line);
        let should_print_attribute_per_line = should_force_break
            || (matches!(
                options.format.attribute_position,
                AttributePosition::Multiline
            ) && attributes.len() > 1
                && !tree.is_vue_sfc_block(id, options));

        self.out.start_indent();
        if force_not_to_break_attr_content {
            self.out.token(" ");
        } else if should_force_break {
            self.out.hardline();
        } else {
            self.out.line();
        }
        // In the order they are written in.
        let (mut attributes, mut comments) =
            (attributes.iter().peekable(), comments.iter().peekable());
        let mut is_first = true;
        loop {
            let next = match (attributes.peek(), comments.peek()) {
                (Some(attr), Some(comment)) if comment.span.start < attr.span.start => {
                    comments.next().map(InStartTag::Comment)
                }
                (Some(_), _) => attributes.next().map(InStartTag::Attribute),
                (None, _) => comments.next().map(InStartTag::Comment),
            };
            let Some(next) = next else {
                break;
            };
            if !std::mem::take(&mut is_first) {
                match should_print_attribute_per_line {
                    true => self.out.hardline(),
                    false => self.out.line(),
                }
            }
            match next {
                InStartTag::Attribute(attr) if ignored.has(attr) => {
                    self.out.text(attr.span.of(options.original_text))
                }
                InStartTag::Attribute(attr) => {
                    self.with_cursor_marks(Target::InStartTag(attr.span), |printer| {
                        printer.print_attribute(id, attr)
                    });
                }
                // `printStartTagComment`
                InStartTag::Comment(comment) => {
                    self.with_cursor_marks(Target::InStartTag(comment.span), |printer| {
                        if comment.is_single_line {
                            printer.out.token("//");
                            printer.out.text(text::trim_end(comment.value));
                        } else {
                            printer.out.token("/*");
                            printer.out.text(comment.value);
                            printer.out.token("*/");
                        }
                    })
                }
            }
        }
        self.out.end_indent();

        if tree
            .first_child(id)
            .is_some_and(|first| tags.needs_to_borrow_parent_opening_tag_end_marker(first))
            || (is_self_closing
                && tree.parent(id).is_some_and(|parent| {
                    tags.needs_to_borrow_last_child_closing_tag_end_marker(parent)
                }))
            || force_not_to_break_attr_content
            || options.format.bracket_same_line.value()
        {
            if is_self_closing {
                self.out.token(" ");
            }
        } else if is_self_closing {
            self.out.line();
        } else {
            self.out.softline();
        }
    }

    pub(crate) fn write_raw_name(&mut self, (namespace, name): (&[u8], &[u8])) {
        if !namespace.is_empty() {
            self.out.text(namespace);
            self.out.token(":");
        }
        self.out.text(name);
    }

    fn print_attribute(&mut self, element: Id, attr: &'t Attribute<'a>) {
        if self.formats_embedded() && self.embed_attribute(element, attr) {
            return;
        }
        self.write_raw_name(attr.raw_name());
        let Some(value) = attr.value else {
            return;
        };
        let value = unescape_quote_entities(value);
        self.out.token("=");
        if should_unquote_attribute_value(attr, self.options) {
            return self.out.text_replacing(&value, b'\'', b"&apos;");
        }
        // `getPreferredQuote(value, '"')`
        match strings::count_char(&value, b'"') > strings::count_char(&value, b'\'') {
            true => {
                self.out.token("'");
                self.out.text_replacing(&value, b'\'', b"&apos;");
                self.out.token("'");
            }
            false => {
                self.out.token("\"");
                self.out.text_replacing(&value, b'"', b"&quot;");
                self.out.token("\"");
            }
        }
    }
}
