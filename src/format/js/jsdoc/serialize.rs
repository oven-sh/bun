//! Formats a whole JSDoc comment.

use super::imports::process_import_tags;
use super::line_buffer::LineBuffer;
use super::markdown::format_description;
use super::normalize::normalize_tag_kind;
use super::param_order::reorder_param_tags;
use super::text::trim_end_matches;
use crate::options::{CommentLineStrategy, FormatOptions, IndentStyle, JsdocOptions, QuoteStyle};
use crate::stack::Stack;
use bun_core::strings;
use bun_lint::ast::File;
use bun_lint::ast::jsdoc::{JSDoc, JSDocTag};
use std::borrow::Cow;

pub(crate) enum FormattedJsdoc {
    /// The comment ends up empty.
    Empty,
    /// The text between `/** ` and ` */`.
    SingleLine(Vec<u8>),
    /// The lines, without the ` * ` before each.
    MultiLine(Vec<u8>),
}

/// ` * `
const LINE_PREFIX_LEN: usize = 3;

/// The settings for formatting a comment, plus the lines produced so far.
pub(super) struct JsdocFormatter<'o> {
    pub(super) options: &'o JsdocOptions,
    pub(super) format_options: &'o FormatOptions,
    pub(super) wrap_width: usize,
    pub(super) content_lines: LineBuffer,
    pub(super) stack: &'o Stack,
}

impl JsdocFormatter<'_> {
    /// `doc` is a comment in `file`. Returns `None` if the comment should stay as it is.
    fn format<'a>(mut self, doc: JSDoc<'a>, file: &'a File<'a>) -> Option<FormattedJsdoc> {
        let content = file.slice(doc.comment_span());
        let description = doc.comment().parsed_preserving_whitespace();
        if strings::is_all_unicode_whitespace(&description) && doc.tags().next().is_none() {
            return Some(FormattedJsdoc::Empty);
        }
        let sorted_tags = sort_tags_by_groups(doc.tags());

        // Merge the description and the `@description` tags.
        let mut merged_description = strings::trim_unicode_whitespace(&description).to_vec();
        let mut effective_tags: Vec<(JSDocTag<'a>, &'a [u8])> =
            Vec::with_capacity(sorted_tags.len());
        for &(tag, normalized_kind) in &sorted_tags {
            if should_remove_empty_tag(normalized_kind)
                && strings::is_all_unicode_whitespace(&tag.comment().parsed())
            {
                continue;
            }
            if normalized_kind != b"description" {
                effective_tags.push((tag, normalized_kind));
                continue;
            }
            let parsed = tag.comment().parsed();
            let parsed = strings::trim_unicode_whitespace(&parsed);
            if !parsed.is_empty() {
                if !merged_description.is_empty() {
                    merged_description.extend_from_slice(b"\n\n");
                }
                merged_description.extend_from_slice(parsed);
            }
        }
        let is_single_line = !strings::contains_char(content, b'\n');

        // `/** @type */`
        if merged_description.is_empty()
            && is_single_line
            && matches!(effective_tags[..], [(tag, b"type")] if strings::is_all_unicode_whitespace(&tag.comment().parsed()))
        {
            return None;
        }

        if !merged_description.is_empty() {
            let description = format_description(
                &merged_description,
                self.wrap_width,
                0,
                self.options.capitalize_descriptions,
                self.format_options,
                self.stack,
            );
            let out = self.content_lines.begin_line();
            if self.options.description_tag {
                out.extend_from_slice(b"@description ");
            }
            out.extend_from_slice(&description);
        }

        reorder_param_tags(&mut effective_tags, file, doc.comment_span().end);
        let (import_lines, parsed_import_indices) =
            process_import_tags(&effective_tags, self.quote_style());
        let mut import_lines = Some(import_lines).filter(|lines| !lines.is_empty());
        let mut imports_emitted = false;
        let mut prev_normalized_kind: Option<&[u8]> = None;
        let mut prev_tag_had_trailing_blank = false;
        let mut first_non_import_tag_emitted = false;

        for (tag_index, &(tag, normalized_kind)) in effective_tags.iter().enumerate() {
            if parsed_import_indices.contains(&tag_index) {
                // All imports are emitted where the first one was.
                if let Some(import_lines) = import_lines.take() {
                    if !self.content_lines.is_empty() && !self.content_lines.last_is_empty() {
                        self.content_lines.push_empty();
                    }
                    self.content_lines.push(import_lines.into_bytes());
                    imports_emitted = true;
                    prev_normalized_kind = Some(b"import");
                }
                continue;
            }
            let is_first_tag = !first_non_import_tag_emitted && !imports_emitted;
            let should_capitalize = self.options.capitalize_descriptions
                && !should_skip_capitalize(normalized_kind)
                && is_known_tag(normalized_kind);
            if is_first_tag {
                if !self.content_lines.is_empty() && !self.content_lines.last_is_empty() {
                    self.content_lines.push_empty();
                }
            } else {
                let prev = prev_normalized_kind.unwrap_or_default();
                let has_prev = prev_normalized_kind.is_some();
                let is_group_head = |kind: &[u8]| matches!(kind, b"typedef" | b"callback");
                let should_separate = if has_prev
                    && prev == normalized_kind
                    && (prev == b"example" || is_group_head(prev))
                {
                    true
                } else if self.options.separate_tag_groups {
                    has_prev && prev != normalized_kind
                } else if self.options.separate_returns_from_param {
                    let is_return = |kind: &[u8]| matches!(kind, b"returns" | b"yields");
                    is_return(normalized_kind) && has_prev && !is_return(prev)
                } else {
                    is_group_head(normalized_kind)
                        && has_prev
                        && !is_group_head(prev)
                        && !matches!(prev, b"import" | b"template")
                };
                // Whatever follows an unknown tag is kept, including an empty line.
                let should_separate = should_separate
                    || (prev_tag_had_trailing_blank && has_prev && !is_known_tag(prev));
                if should_separate && !self.content_lines.last_is_empty() {
                    self.content_lines.push_empty();
                }
            }
            first_non_import_tag_emitted = true;
            prev_normalized_kind = Some(normalized_kind);
            let source_has_trailing_blank = tag
                .comment()
                .parsed_preserving_whitespace()
                .ends_with(b"\n\n");
            prev_tag_had_trailing_blank = source_has_trailing_blank;
            let lines_before = self.content_lines.byte_len();
            let has_no_space_before_type = tag.has_no_space_before_type();

            if normalized_kind == b"example" {
                self.format_example_tag(normalized_kind, tag);
            } else if is_type_name_comment_tag(normalized_kind) {
                self.format_type_name_comment_tag(
                    normalized_kind,
                    tag,
                    should_capitalize,
                    has_no_space_before_type,
                );
            } else if is_type_comment_tag(normalized_kind) {
                self.format_type_comment_tag(
                    normalized_kind,
                    tag,
                    should_capitalize,
                    has_no_space_before_type,
                );
            } else {
                self.format_generic_tag(normalized_kind, tag, should_capitalize);
            }

            let next_kind = effective_tags.get(tag_index + 1).map(|&(_, kind)| kind);
            let needs_trailing_blank = if normalized_kind == b"example"
                && self.content_lines.line_count_since(lines_before) > 1
            {
                next_kind.is_some_and(|next| next != normalized_kind)
            } else {
                next_kind.is_some()
                    && source_has_trailing_blank
                    && self.content_lines.last_line_is_block_end()
            };
            if needs_trailing_blank && !self.content_lines.last_is_empty() {
                self.content_lines.push_empty();
            }
        }

        let all = self.content_lines.into_bytes();
        let all = trim_end_matches(&all, |c| c == '\n');
        let mut lines = strings::split(all, b"\n").skip_while(|line| line.is_empty());
        let Some(first) = lines.next() else {
            return Some(FormattedJsdoc::Empty);
        };
        let has_one_line = lines.clone().next().is_none();
        let use_single_line = match self.options.comment_line_strategy {
            CommentLineStrategy::SingleLine => has_one_line,
            CommentLineStrategy::Multiline => false,
            CommentLineStrategy::Keep => has_one_line && is_single_line,
        };
        if use_single_line {
            let is_unchanged = content
                .strip_prefix(b"/** ")
                .and_then(|rest| rest.strip_suffix(b" */"))
                == Some(first);
            return (!is_unchanged).then(|| FormattedJsdoc::SingleLine(first.to_vec()));
        }
        let mut full_comment = b"/**".to_vec();
        for line in std::iter::once(first).chain(lines) {
            full_comment.extend_from_slice(if line.is_empty() { b"\n *" } else { b"\n * " });
            full_comment.extend_from_slice(line);
        }
        full_comment.extend_from_slice(b"\n */");
        (full_comment != content).then(|| FormattedJsdoc::MultiLine(all.to_vec()))
    }

    /// Pushes a description with `indent` before each non-empty line.
    pub(super) fn push_indented_desc(&mut self, indent: &[u8], description: &[u8]) {
        if description.is_empty() {
            return;
        }
        let out = self.content_lines.begin_line();
        for (index, line) in strings::split(description, b"\n").enumerate() {
            if index > 0 {
                out.push(b'\n');
            }
            if !line.is_empty() {
                out.extend_from_slice(indent);
                out.extend_from_slice(line);
            }
        }
    }

    /// The indentation of a description's lines after the first. It doesn't depend on `useTabs`.
    pub(super) const CONTINUATION_INDENT: &'static [u8] = b"  ";

    /// Returns the maximum width of a description that's indented by [`Self::CONTINUATION_INDENT`].
    pub(super) fn indented_width(&self) -> usize {
        self.wrap_width
            .saturating_sub(Self::CONTINUATION_INDENT.len())
    }

    /// Returns the indentation for code.
    pub(super) fn code_indent(&self) -> &'static [u8] {
        if matches!(self.format_options.indent_style, IndentStyle::Tab) {
            return b"\t";
        }
        match self.format_options.indent_width.value() {
            width @ (0..=1 | 3..=8) => &b"        "[..width as usize],
            _ => b"  ",
        }
    }

    pub(super) fn code_indent_width(&self) -> usize {
        self.format_options.indent_width.value() as usize
    }

    pub(super) fn quote_style(&self) -> QuoteStyle {
        self.format_options.quote_style
    }

    /// `wrap_text`: wraps a description into lines of at most `max_width` columns. The first line gets
    /// `tag_string_length` fewer.
    pub(super) fn wrap_text(
        &self,
        text: &[u8],
        max_width: usize,
        tag_string_length: usize,
    ) -> Vec<u8> {
        format_description(
            text,
            max_width,
            tag_string_length,
            false,
            self.format_options,
            self.stack,
        )
    }
}

/// Tags whose descriptions aren't capitalized.
fn should_skip_capitalize(kind: &[u8]) -> bool {
    matches!(
        kind,
        b"borrows"
            | b"default"
            | b"defaultValue"
            | b"deprecated"
            | b"import"
            | b"memberof"
            | b"module"
            | b"satisfies"
            | b"see"
            | b"type"
    )
}

/// Tags whose descriptions aren't formatted.
pub(super) fn should_skip_description_formatting(kind: &[u8]) -> bool {
    should_preserve_description_verbatim(kind) || matches!(kind, b"deprecated" | b"internal")
}

/// `TAGS_PEV_FORMATE_DESCRIPTION`: tags whose descriptions stay as they are.
pub(super) fn should_preserve_description_verbatim(kind: &[u8]) -> bool {
    matches!(
        kind,
        b"borrows" | b"default" | b"defaultValue" | b"import" | b"memberof" | b"module" | b"see"
    )
}

/// `@tag {type} name description`
fn is_type_name_comment_tag(kind: &[u8]) -> bool {
    matches!(
        kind,
        b"param" | b"property" | b"typedef" | b"template" | b"fires"
    )
}

/// `@tag {type} description`
fn is_type_comment_tag(kind: &[u8]) -> bool {
    matches!(
        kind,
        b"returns" | b"yields" | b"throws" | b"type" | b"satisfies" | b"this" | b"extends"
    )
}

const UNKNOWN_TAG_PRIORITY: u32 = 88;

/// `TAGS_ORDER`, times two.
fn tag_sort_priority(kind: &[u8]) -> u32 {
    match kind {
        b"import" => 0,
        b"remarks" => 2,
        b"privateRemarks" => 4,
        b"providesModule" => 6,
        b"module" => 8,
        b"license" => 10,
        b"flow" => 12,
        b"async" => 14,
        b"private" => 16,
        b"ignore" => 18,
        b"memberof" => 20,
        b"version" => 22,
        b"file" => 24,
        b"author" => 26,
        b"deprecated" => 28,
        b"since" => 30,
        b"category" => 32,
        b"description" => 34,
        b"example" => 36,
        b"abstract" => 38,
        b"augments" => 40,
        b"constant" => 42,
        b"default" => 44,
        b"defaultValue" => 46,
        b"external" => 48,
        b"overload" => 50,
        b"fires" => 52,
        b"template" => 54,
        b"typeParam" => 56,
        b"function" => 58,
        b"namespace" => 60,
        b"borrows" => 62,
        b"class" => 64,
        b"extends" => 66,
        b"member" => 68,
        b"typedef" => 70,
        b"type" => 72,
        b"satisfies" => 74,
        b"property" => 76,
        b"callback" => 78,
        b"this" => 79,
        b"param" => 80,
        b"yields" => 82,
        b"returns" => 84,
        b"throws" => 86,
        b"see" => 90,
        b"todo" => 92,
        _ => UNKNOWN_TAG_PRIORITY,
    }
}

pub(super) fn is_known_tag(kind: &[u8]) -> bool {
    tag_sort_priority(kind) != UNKNOWN_TAG_PRIORITY
}

/// `TAGS_GROUP_HEAD`
fn is_tags_group_head(kind: &[u8]) -> bool {
    matches!(kind, b"callback" | b"typedef")
}

/// `TAGS_GROUP_CONDITION`
fn is_tags_group_condition(kind: &[u8]) -> bool {
    matches!(
        kind,
        b"callback"
            | b"typedef"
            | b"type"
            | b"property"
            | b"param"
            | b"returns"
            | b"this"
            | b"yields"
            | b"throws"
    )
}

/// Tags without a type whose first word is a name, which isn't capitalized.
pub(super) fn is_named_generic_tag(kind: &[u8]) -> bool {
    matches!(
        kind,
        b"abstract"
            | b"async"
            | b"augments"
            | b"author"
            | b"callback"
            | b"categoryDescription"
            | b"class"
            | b"constant"
            | b"external"
            | b"flow"
            | b"function"
            | b"groupDescription"
            | b"ignore"
            | b"member"
            | b"memberof"
            | b"private"
            | b"see"
            | b"version"
            | b"typeParam"
    )
}

/// Returns the tags sorted, each paired with its canonical kind. `@typedef` and `@callback` start a group, and the
/// groups keep their order.
fn sort_tags_by_groups<'a>(
    tags: impl ExactSizeIterator<Item = JSDocTag<'a>>,
) -> Vec<(JSDocTag<'a>, &'a [u8])> {
    let mut sorted: Vec<(JSDocTag<'a>, &[u8])> = Vec::with_capacity(tags.len());
    let mut group_start = 0;
    let mut can_group_next_tags = false;
    for tag in tags {
        let kind = normalize_tag_kind(tag.kind.parsed());
        if is_tags_group_head(kind) && can_group_next_tags && sorted.len() > group_start {
            crate::sort::sort_by_key(&mut sorted[group_start..], |(_, kind)| {
                tag_sort_priority(kind)
            });
            group_start = sorted.len();
            can_group_next_tags = false;
        }
        can_group_next_tags |= is_tags_group_condition(kind);
        sorted.push((tag, kind));
    }
    crate::sort::sort_by_key(&mut sorted[group_start..], |(_, kind)| {
        tag_sort_priority(kind)
    });
    sorted
}

/// `TAGS_DESCRIPTION_NEEDED`: tags that are removed if nothing follows them.
fn should_remove_empty_tag(kind: &[u8]) -> bool {
    matches!(
        kind,
        b"borrows"
            | b"category"
            | b"description"
            | b"example"
            | b"import"
            | b"privateRemarks"
            | b"remarks"
            | b"since"
            | b"todo"
    )
}

/// True if an odd number of backslashes comes before `pos`.
fn is_escaped(bytes: &[u8], pos: usize) -> bool {
    bytes[..pos]
        .iter()
        .rev()
        .take_while(|&&byte| byte == b'\\')
        .count()
        % 2
        != 0
}

/// Formats the value of `@default`. A value that looks like JSON gets normalized spacing and `quote_style` quotes.
pub(super) fn format_default_value(value: &[u8], quote_style: QuoteStyle) -> Cow<'_, [u8]> {
    let trimmed = strings::trim_unicode_whitespace(value);
    let (target_quote, other_quote) = match quote_style {
        QuoteStyle::Double => (b'"', b'\''),
        QuoteStyle::Single => (b'\'', b'"'),
    };
    let len = trimmed.len();
    match trimmed.first() {
        Some(b'{' | b'[') => {}
        // A string, possibly followed by a description.
        Some(&quote @ (b'"' | b'\'')) => {
            let mut i = 1;
            while i < len && trimmed[i] != quote {
                i += if trimmed[i] == b'\\' { 2 } else { 1 };
            }
            if i >= len || quote == target_quote {
                return Cow::Borrowed(trimmed);
            }
            let mut result = Vec::with_capacity(len);
            result.push(target_quote);
            for &byte in &trimmed[1..i] {
                if byte == target_quote {
                    result.push(b'\\');
                }
                result.push(byte);
            }
            result.push(target_quote);
            result.extend_from_slice(&trimmed[i + 1..]);
            return Cow::Owned(result);
        }
        _ => return Cow::Borrowed(trimmed),
    }
    let mut result = Vec::with_capacity(len + 16);
    // The opening quote of the string we're inside, if any.
    let mut in_quote = None;
    for (i, &byte) in trimmed.iter().enumerate() {
        let next = trimmed.get(i + 1).copied();
        if let Some(quote) = in_quote {
            if byte == quote && !is_escaped(trimmed, i) {
                result.push(target_quote);
                in_quote = None;
            } else {
                result.push(byte);
            }
            continue;
        }
        match byte {
            _ if byte == target_quote || byte == other_quote => {
                result.push(target_quote);
                in_quote = Some(byte);
            }
            b':' | b',' => {
                result.push(byte);
                if next.is_some_and(|next| next != b' ') {
                    result.push(b' ');
                }
            }
            b'{' => {
                result.push(b'{');
                if next.is_some_and(|next| next != b'}' && next != b' ') {
                    result.push(b' ');
                }
            }
            b'}' => {
                if result
                    .last()
                    .is_some_and(|&last| last != b'{' && last != b' ')
                {
                    result.push(b' ');
                }
                result.push(b'}');
            }
            b'[' => {
                result.push(b'[');
                if next == Some(b']') {
                    result.push(b' ');
                }
            }
            _ => result.push(byte),
        }
    }
    Cow::Owned(result)
}

/// Returns `desc` without the "Default is .." at its end, which is regenerated from `[name=value]`.
pub(super) fn strip_default_is_suffix(desc: &[u8]) -> &[u8] {
    let before = |pos: usize| {
        let before = strings::trim_unicode_whitespace_end(&desc[..pos]);
        strings::trim_unicode_whitespace_end(before.strip_suffix(b".").unwrap_or(before))
    };
    if let Some(pos) = strings::index_of(desc, b"Default is ") {
        return before(pos);
    }
    let trimmed = strings::trim_unicode_whitespace_end(desc);
    if trimmed.ends_with(b"Default is") {
        return before(trimmed.len() - b"Default is".len());
    }
    // The two words can be on two lines.
    let is_space = |byte: u8| matches!(byte, b' ' | b'\n' | b'\r' | b'\t');
    let mut from = 0;
    while let Some(at) = strings::index_of(&desc[from..], b"Default") {
        let pos = from + at;
        let after = &desc[pos + 7..];
        let spaces = after.iter().take_while(|&&byte| is_space(byte)).count();
        if spaces > 0
            && after[spaces..]
                .strip_prefix(b"is")
                .is_some_and(|rest| rest.first().is_some_and(|&byte| is_space(byte)))
        {
            return before(pos);
        }
        from = pos + 7;
    }
    desc
}

/// Formats the comment `doc` of `file`. Returns `None` if it should stay as it is. `available_width` is the line width
/// minus the comment's indentation.
pub(crate) fn format_jsdoc_comment<'a>(
    doc: JSDoc<'a>,
    file: &'a File<'a>,
    options: &JsdocOptions,
    format_options: &FormatOptions,
    available_width: usize,
    stack: &Stack,
) -> Option<FormattedJsdoc> {
    JsdocFormatter {
        options,
        format_options,
        wrap_width: available_width.saturating_sub(LINE_PREFIX_LEN),
        content_lines: LineBuffer::new(),
        stack,
    }
    .format(doc, file)
}
