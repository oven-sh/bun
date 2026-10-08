//! A whole comment.

use super::imports::process_import_tags;
use super::line_buffer::LineBuffer;
use super::markdown::format_description;
use super::normalize::normalize_tag_kind;
use super::param_order::reorder_param_tags;
use super::parser::{self, Tag};
use super::text::{is_blank, split_lines, trim, trim_end, trim_end_matches};
use crate::options::{CommentLineStrategy, FormatOptions, IndentStyle, JsdocOptions, QuoteStyle};
use bun_core::strings;
use std::borrow::Cow;

pub(crate) enum FormattedJsdoc {
    /// Nothing is left of it.
    Empty,
    /// What is between `/** ` and ` */`.
    SingleLine(Vec<u8>),
    /// The lines, without the ` * ` before each.
    MultiLine(Vec<u8>),
}

/// ` * `
const LINE_PREFIX_LEN: usize = 3;

/// What formatting a comment goes by, and the lines so far.
pub(super) struct JsdocFormatter<'o> {
    pub(super) options: &'o JsdocOptions,
    pub(super) format_options: &'o FormatOptions,
    pub(super) wrap_width: usize,
    pub(super) content_lines: LineBuffer,
}

impl JsdocFormatter<'_> {
    /// `content`: the comment. `after`: the text behind it. `None`: the comment stays as it is.
    fn format(mut self, content: &[u8], after: &[u8]) -> Option<FormattedJsdoc> {
        let inner = content.get(3..content.len() - 2)?;
        let (comment_part, tags) = parser::parse(inner);
        let description = comment_part.parsed_preserving_whitespace();
        if is_blank(&description) && tags.is_empty() {
            return Some(FormattedJsdoc::Empty);
        }
        let sorted_tags = sort_tags_by_groups(&tags);

        // The description and the `@description` tags are one.
        let mut merged_description = trim(&description).to_vec();
        let mut effective_tags: Vec<(&Tag<'_>, &[u8])> = Vec::with_capacity(sorted_tags.len());
        for &(tag, normalized_kind) in &sorted_tags {
            if should_remove_empty_tag(normalized_kind) && is_blank(&tag.comment().parsed()) {
                continue;
            }
            if normalized_kind != b"description" {
                effective_tags.push((tag, normalized_kind));
                continue;
            }
            let parsed = tag.comment().parsed();
            let parsed = trim(&parsed);
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
            && matches!(effective_tags[..], [(tag, b"type")] if is_blank(&tag.comment().parsed()))
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
            );
            let out = self.content_lines.begin_line();
            if self.options.description_tag {
                out.extend_from_slice(b"@description ");
            }
            out.extend_from_slice(&description);
        }

        reorder_param_tags(&mut effective_tags, after);
        let (import_lines, parsed_import_indices) =
            process_import_tags(&effective_tags, self.quote_style());
        let mut import_lines = Some(import_lines).filter(|lines| !lines.is_empty());
        let mut imports_emitted = false;
        let mut prev_normalized_kind: Option<&[u8]> = None;
        let mut prev_tag_had_trailing_blank = false;
        let mut first_non_import_tag_emitted = false;

        for (tag_index, &(tag, normalized_kind)) in effective_tags.iter().enumerate() {
            if parsed_import_indices.contains(&tag_index) {
                // All of them are where the first is.
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
                // What is behind a tag that is not known stays, an empty line too.
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
        let mut lines = split_lines(all).skip_while(|line| line.is_empty());
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
        let mut whole = b"/**".to_vec();
        for line in std::iter::once(first).chain(lines) {
            whole.extend_from_slice(if line.is_empty() { b"\n *" } else { b"\n * " });
            whole.extend_from_slice(line);
        }
        whole.extend_from_slice(b"\n */");
        (whole != content).then(|| FormattedJsdoc::MultiLine(all.to_vec()))
    }

    /// Pushes a description with `indent` before each line that is not empty.
    pub(super) fn push_indented_desc(&mut self, indent: &[u8], description: &[u8]) {
        if description.is_empty() {
            return;
        }
        let out = self.content_lines.begin_line();
        for (index, line) in split_lines(description).enumerate() {
            if index > 0 {
                out.push(b'\n');
            }
            if !line.is_empty() {
                out.extend_from_slice(indent);
                out.extend_from_slice(line);
            }
        }
    }

    /// What the lines of a description are indented by after the first. It does not depend on `useTabs`.
    pub(super) const CONTINUATION_INDENT: &'static [u8] = b"  ";

    /// How wide a description can be that is indented by [`Self::CONTINUATION_INDENT`].
    pub(super) fn indented_width(&self) -> usize {
        self.wrap_width
            .saturating_sub(Self::CONTINUATION_INDENT.len())
    }

    /// What code is indented by.
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

    /// `wrap_text`: a description in lines of at most `max_width` columns, the first `tag_string_length` less.
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
        )
    }
}

/// Tags whose descriptions do not get a capital letter.
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

/// Tags whose descriptions are not formatted.
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

/// Tags without a type whose first word is a name, which gets no capital letter.
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

/// The tags, each with the name that stands for its kind, sorted. `@typedef` and `@callback` start a group,
/// and the groups stay in their order.
fn sort_tags_by_groups<'t, 'a>(tags: &'t [Tag<'a>]) -> Vec<(&'t Tag<'a>, &'a [u8])> {
    let mut sorted: Vec<(&Tag<'a>, &[u8])> = Vec::with_capacity(tags.len());
    let mut group_start = 0;
    let mut can_group_next_tags = false;
    for tag in tags {
        let kind = normalize_tag_kind(tag.kind);
        if is_tags_group_head(kind) && can_group_next_tags && sorted.len() > group_start {
            sorted[group_start..].sort_by_key(|(_, kind)| tag_sort_priority(kind));
            group_start = sorted.len();
            can_group_next_tags = false;
        }
        can_group_next_tags |= is_tags_group_condition(kind);
        sorted.push((tag, kind));
    }
    sorted[group_start..].sort_by_key(|(_, kind)| tag_sort_priority(kind));
    sorted
}

/// `TAGS_DESCRIPTION_NEEDED`: tags that go away if nothing follows them.
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

/// Whether an odd number of backslashes is before `pos`.
fn is_escaped(bytes: &[u8], pos: usize) -> bool {
    bytes[..pos]
        .iter()
        .rev()
        .take_while(|&&byte| byte == b'\\')
        .count()
        % 2
        != 0
}

/// The value of `@default`: what looks like JSON gets its spaces and the quotes of `quote_style`.
pub(super) fn format_default_value(value: &[u8], quote_style: QuoteStyle) -> Cow<'_, [u8]> {
    let trimmed = trim(value);
    let (target_quote, other_quote) = match quote_style {
        QuoteStyle::Double => (b'"', b'\''),
        QuoteStyle::Single => (b'\'', b'"'),
    };
    let len = trimmed.len();
    match trimmed.first() {
        Some(b'{' | b'[') => {}
        // A string, and maybe a description behind it.
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
    // The quote that the string that this is in has been opened with.
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

/// `desc` without "Default is .." at its end, which is made anew from `[name=value]`.
pub(super) fn strip_default_is_suffix(desc: &[u8]) -> &[u8] {
    let before = |pos: usize| {
        let before = trim_end(&desc[..pos]);
        trim_end(before.strip_suffix(b".").unwrap_or(before))
    };
    if let Some(pos) = strings::index_of(desc, b"Default is ") {
        return before(pos);
    }
    let trimmed = trim_end(desc);
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

/// The comment `content`, formatted. `None`: it stays as it is. `after`: the text behind it. `available_width`:
/// the width of a line without the indentation of the comment.
pub(crate) fn format_jsdoc_comment(
    content: &[u8],
    after: &[u8],
    options: &JsdocOptions,
    format_options: &FormatOptions,
    available_width: usize,
) -> Option<FormattedJsdoc> {
    JsdocFormatter {
        options,
        format_options,
        wrap_width: available_width.saturating_sub(LINE_PREFIX_LEN),
        content_lines: LineBuffer::new(),
    }
    .format(content, after)
}
