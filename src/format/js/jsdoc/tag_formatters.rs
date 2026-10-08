//! The kinds of tags.

use super::embedded::{
    embedded_options, format_embedded_js, format_type_via_formatter, is_js_ts_lang,
    update_template_depth,
};
use super::normalize::{
    append_trailing_dot, capitalize_first, normalize_markdown_emphasis, normalize_type,
    normalize_type_preserve_quotes, normalize_type_return, strip_jsdoc_stars_preserve_newlines,
    strip_optional_type_suffix,
};
use super::parser::Tag;
use super::serialize::{
    JsdocFormatter, format_default_value, is_known_tag, is_named_generic_tag,
    should_preserve_description_verbatim, should_skip_description_formatting,
    strip_default_is_suffix,
};
use super::text::{
    find_ascii_whitespace, is_blank, lines, split_lines, split_whitespace, str_width, trim,
    trim_start, trim_start_matches,
};
use bun_core::strings;
use std::borrow::Cow;

type Bytes<'a> = Cow<'a, [u8]>;

/// `text` without the indentation that all its lines have, but at most `base_indent` of it.
fn dedent_lines(text: &[u8], base_indent: usize) -> Vec<u8> {
    let min_indent = lines(text)
        .filter(|line| !is_blank(line))
        .map(|line| line.len() - trim_start(line).len())
        .chain(std::iter::once(base_indent))
        .min()
        .unwrap_or(0);
    let mut result = Vec::with_capacity(text.len());
    for (index, line) in lines(text).enumerate() {
        if index > 0 {
            result.push(b'\n');
        }
        if !is_blank(line) {
            result.extend_from_slice(line.get(min_indent..).unwrap_or_else(|| trim_start(line)));
        }
    }
    result
}

/// Whether an empty line is between a tag and `raw`, what follows it.
fn starts_with_blank_line(raw: &[u8]) -> bool {
    let rest = trim_start_matches(raw, |c| c == ' ');
    rest.starts_with(b"\n\n") || rest.starts_with(b"\n \n")
}

/// `- text` is `(true, text)`.
fn split_dash(text: &[u8]) -> (bool, &[u8]) {
    match text.strip_prefix(b"- ") {
        Some(rest) => (true, rest),
        None if text == b"-" => (true, b""),
        None => (false, text),
    }
}

/// Appends `. Default is `value``.
fn push_default(out: &mut Vec<u8>, value: &[u8]) {
    if !out.is_empty() {
        out.extend_from_slice(if matches!(out.last(), Some(b'.' | b'!' | b'?')) {
            b" "
        } else {
            b". "
        });
    }
    out.extend_from_slice(b"Default is `");
    out.extend_from_slice(value);
    out.push(b'`');
}

impl JsdocFormatter<'_> {
    pub(super) fn format_example_tag(&mut self, normalized_kind: &[u8], tag: &Tag<'_>) {
        let raw_text = tag.comment().parsed_preserving_whitespace();
        let mut code = trim(&raw_text);
        let out = self.content_lines.begin_line();
        out.push(b'@');
        out.extend_from_slice(normalized_kind);
        // A caption stays on the line of the tag.
        const END: &[u8] = b"</caption>";
        if let Some(rest) = code.strip_prefix(b"<caption>")
            && let Some(end) = strings::index_of(rest, END)
        {
            out.extend_from_slice(b" <caption>");
            out.extend_from_slice(&rest[..end + END.len()]);
            code = trim(&rest[end + END.len()..]);
        }
        self.format_example_code(code);
    }

    /// Pushes the lines of formatted code. What is in a template literal is not indented.
    fn push_formatted_code_lines(&mut self, code: &[u8], indent: &[u8]) {
        let mut template_depth = 0;
        for line in lines(code) {
            let out = self.content_lines.begin_line();
            if !line.is_empty() && template_depth == 0 {
                out.extend_from_slice(indent);
            }
            out.extend_from_slice(line);
            template_depth = update_template_depth(line, template_depth);
        }
    }

    fn push_raw_code_lines(&mut self, code: &[u8], indent: &[u8]) {
        for line in lines(code) {
            let content = if self.options.keep_unparsable_example_indent {
                line
            } else {
                trim(line)
            };
            let out = self.content_lines.begin_line();
            if !content.is_empty() {
                out.extend_from_slice(indent);
                out.extend_from_slice(content);
            }
        }
    }

    fn format_example_code(&mut self, code: &[u8]) {
        if code.is_empty() {
            return;
        }
        // Three backticks are JavaScript too, so fences are looked for first.
        if let Some((first_line, rest)) = strings::split_once_char(code, b'\n')
            && first_line.starts_with(b"```")
        {
            if let Some(closing) = strings::last_index_of(rest, b"\n```") {
                return self.format_example_fenced_block(
                    first_line,
                    &rest[..closing],
                    trim(&rest[closing + 1..]),
                );
            }
            if trim(rest) == b"```" {
                return self.format_example_fenced_block(first_line, b"", trim(rest));
            }
        }
        let indent = self.code_indent();
        let effective_width = self.wrap_width.saturating_sub(self.code_indent_width());
        // Something that is not code can be parsed as code all the same. Then it has many more lines afterwards.
        match format_embedded_js(code, effective_width, self.format_options)
            .filter(|formatted| lines(formatted).count() <= lines(code).count() * 2 + 1)
        {
            Some(formatted) => self.push_formatted_code_lines(&formatted, indent),
            None => self.push_raw_code_lines(code, indent),
        }
    }

    fn format_example_fenced_block(
        &mut self,
        lang_line: &[u8],
        inner_code: &[u8],
        closing_fence: &[u8],
    ) {
        let indent = self.code_indent();
        let effective_width = self.wrap_width.saturating_sub(self.code_indent_width());
        self.content_lines.push([indent, lang_line].concat());
        if !inner_code.is_empty() {
            let formatted = match is_js_ts_lang(trim(&lang_line[3..])) {
                true => format_embedded_js(inner_code, effective_width, self.format_options),
                false => None,
            };
            match formatted {
                Some(formatted) => self.push_formatted_code_lines(&formatted, indent),
                None => self.push_raw_code_lines(inner_code, indent),
            }
        }
        self.content_lines.push([indent, closing_fence].concat());
    }

    /// Appends ` {type}` to `tag_line`.
    fn push_type(&self, tag_line: &mut Vec<u8>, type_str: &[u8], has_no_space_before_type: bool) {
        // `@type{{` gets its space.
        if !has_no_space_before_type || type_str.starts_with(b"{") {
            tag_line.push(b' ');
        }
        tag_line.extend_from_slice(if self.options.bracket_spacing {
            b"{ "
        } else {
            b"{"
        });
        tag_line.extend_from_slice(type_str);
        tag_line.extend_from_slice(if self.options.bracket_spacing {
            b" }"
        } else {
            b"}"
        });
    }

    /// Pushes `description`, broken into lines and indented.
    fn push_wrapped_desc(&mut self, description: &[u8]) {
        let wrapped = self.wrap_text(description, self.indented_width(), 0);
        self.push_indented_desc(Self::CONTINUATION_INDENT, &wrapped);
    }

    /// The same without an empty line at the start, for where there is one already.
    fn push_wrapped_desc_after_blank_line(
        &mut self,
        description: &[u8],
        indent: &[u8],
        width: usize,
    ) {
        let wrapped = self.wrap_text(description, width, 0);
        self.push_indented_desc(indent, wrapped.strip_prefix(b"\n").unwrap_or(&wrapped));
    }

    /// Pushes `prefix` and `description` behind it, broken into lines of which all but the first are indented.
    fn push_desc_behind(&mut self, prefix: &[u8], description: &[u8]) {
        let tag_string_length = str_width(prefix).saturating_sub(Self::CONTINUATION_INDENT.len());
        let wrapped = self.wrap_text(description, self.indented_width(), tag_string_length);
        let out = self.content_lines.begin_line();
        out.extend_from_slice(prefix);
        for (index, line) in split_lines(&wrapped).enumerate() {
            if index > 0 {
                out.push(b'\n');
                if !line.is_empty() {
                    out.extend_from_slice(Self::CONTINUATION_INDENT);
                }
            }
            out.extend_from_slice(line);
        }
    }

    pub(super) fn format_type_name_comment_tag(
        &mut self,
        normalized_kind: &[u8],
        tag: &Tag<'_>,
        should_capitalize: bool,
        has_no_space_before_type: bool,
    ) {
        let (type_part, name_part, comment_part) = tag.type_name_comment();
        let tag_prefix_len = 1 + normalized_kind.len();
        let mut tag_line = [b"@", normalized_kind].concat();
        let mut is_type_optional = false;
        let mut normalized_type: Bytes<'_> = Cow::Borrowed(b"");
        // `@typedef{import(...)}`: the type is taken as it is.
        let preserve_quotes = has_no_space_before_type;

        if let Some(type_part) = &type_part
            && !type_part.parsed().is_empty()
        {
            let raw = type_part.raw();
            let raw_inner = &raw[1..raw.len() - 1];
            let raw_was_multiline = strings::contains_char(raw_inner, b'\n');
            let (type_to_normalize, type_optional) = strip_optional_type_suffix(type_part.parsed());
            is_type_optional = type_optional;
            normalized_type = match preserve_quotes {
                true => normalize_type_preserve_quotes(type_to_normalize),
                false => normalize_type(type_to_normalize, self.quote_style()),
            };
            if !preserve_quotes {
                let is_multiline = strings::contains_char(type_to_normalize, b'\n');
                let was_multiline = raw_was_multiline || is_multiline;
                // The formatter gets a type over several lines with its line breaks, so that it keeps them.
                let formatter_input: Vec<u8> = match was_multiline {
                    true => {
                        let stripped = strip_jsdoc_stars_preserve_newlines(if is_multiline {
                            type_to_normalize
                        } else {
                            raw_inner
                        });
                        strings::replace_owned(&stripped, b"*", b" any ")
                    }
                    false => normalized_type.to_vec(),
                };
                let input_has_line_break = strings::contains_char(&formatter_input, b'\n');
                let type_options = embedded_options(self.format_options, self.wrap_width);
                match format_type_via_formatter(&formatter_input, &type_options) {
                    // It is on one line now, which is too long.
                    Some(formatted)
                        if was_multiline
                            && input_has_line_break
                            && !strings::contains_char(&formatted, b'\n')
                            && tag_prefix_len + 3 + formatted.len() > self.wrap_width =>
                    {
                        normalized_type = Cow::Owned(formatter_input);
                    }
                    Some(formatted) => normalized_type = Cow::Owned(formatted),
                    None if was_multiline && input_has_line_break => {
                        normalized_type = Cow::Owned(formatter_input)
                    }
                    None => {}
                }
            }
        }

        // The name and the default value.
        let mut name: Bytes<'_> = Cow::Borrowed(b"");
        let mut default_value: Option<&[u8]> = None;
        if let Some(name_part) = &name_part {
            let raw = name_part.raw();
            name = Cow::Borrowed(raw);
            if is_type_optional && !raw.starts_with(b"[") {
                name = Cow::Owned([b"[", raw, b"]"].concat());
            } else if raw.starts_with(b"[")
                && raw.ends_with(b"]")
                && let Some(equals) = strings::index_of_char_usize(raw, b'=')
            {
                let value = trim(&raw[equals + 1..raw.len() - 1]);
                name = Cow::Owned(match value {
                    b"" => [b"[", &raw[1..equals], b"]"].concat(),
                    _ => [b"[", &raw[1..equals], b"=", value, b"]"].concat(),
                });
                default_value = Some(value).filter(|value| !value.is_empty());
            }
        }

        if !normalized_type.is_empty() {
            self.push_type(&mut tag_line, &normalized_type, has_no_space_before_type);
        }
        if !name.is_empty() {
            tag_line.push(b' ');
            tag_line.extend_from_slice(&name);
        }

        let desc_with_whitespace = comment_part.parsed_preserving_whitespace();
        let desc_normalized = normalize_markdown_emphasis(trim(&desc_with_whitespace));
        let desc_raw = trim(&desc_normalized);

        // A type over several lines: the description comes after it.
        if strings::contains_char(&tag_line, b'\n') {
            self.content_lines.push(tag_line);
            if !desc_raw.is_empty() {
                self.push_wrapped_desc(desc_raw);
            }
            return;
        }

        // The default of `@template [T=Value]` is syntax.
        let default_value_for_desc = default_value
            .filter(|_| self.options.add_default_to_description && normalized_kind != b"template");
        let desc_raw = match default_value_for_desc {
            Some(_) => trim(strip_default_is_suffix(desc_raw)),
            None => desc_raw,
        };
        if desc_raw.is_empty() && default_value.is_none() {
            self.content_lines.push(tag_line);
            return;
        }
        if starts_with_blank_line(&desc_with_whitespace) && !desc_raw.is_empty() {
            self.content_lines.push(tag_line);
            self.content_lines.push_empty();
            self.push_wrapped_desc(desc_raw);
            return;
        }
        let (first_line, rest_of_desc) = match strings::split_once_char(desc_raw, b'\n') {
            Some((first, rest)) => (first, Some(rest)),
            None => (desc_raw, None),
        };
        let first_text_line = trim(first_line);
        // Two spaces at the end of a line are a line break in Markdown.
        let first_hard_break = rest_of_desc.is_some() && first_line.ends_with(b"  ");
        if first_text_line.starts_with(b"```") {
            self.content_lines.push(tag_line);
            self.content_lines.push_empty();
            self.push_wrapped_desc_after_blank_line(
                desc_raw,
                Self::CONTINUATION_INDENT,
                self.indented_width(),
            );
            return;
        }
        let (has_dash, first_text) = split_dash(first_text_line);
        let first_text = if should_capitalize {
            capitalize_first(first_text)
        } else {
            Cow::Borrowed(first_text)
        };
        if first_text.is_empty() && default_value_for_desc.is_none() && rest_of_desc.is_none() {
            self.content_lines.push(tag_line);
            return;
        }
        let separator: &[u8] = if has_dash { b" - " } else { b" " };
        let remaining_desc = match rest_of_desc {
            Some(rest) => dedent_lines(
                rest,
                if first_text_line.is_empty() {
                    usize::MAX
                } else {
                    0
                },
            ),
            None => Vec::new(),
        };
        let has_remaining = !is_blank(&remaining_desc);
        let prefix = [&tag_line[..], separator].concat();
        let prefix_len = str_width(&prefix);
        let one_liner_len = prefix_len
            + str_width(&first_text)
            + match default_value_for_desc.filter(|_| !has_remaining) {
                // "Default is `" and "`", and ". " before them.
                Some(value) => 13 + value.len() + if first_text.is_empty() { 0 } else { 2 },
                None => 0,
            };

        if !has_remaining && one_liner_len <= self.wrap_width {
            let mut description = first_text.into_owned();
            match default_value_for_desc {
                Some(value) => push_default(&mut description, value),
                None if self.options.description_with_dot => {
                    description = append_trailing_dot(&description).into_owned()
                }
                None => {}
            }
            self.content_lines.push([prefix, description].concat());
            return;
        }
        // `@param {Type} name -` and the description on the next line.
        if has_dash && first_text.is_empty() && has_remaining {
            self.content_lines.push([&tag_line[..], b" -"].concat());
            self.push_wrapped_desc(&remaining_desc);
            return;
        }
        let mut full_desc = first_text.into_owned();
        if has_remaining {
            if first_hard_break {
                full_desc.extend_from_slice(b"  ");
            }
            full_desc.push(b'\n');
            full_desc.extend_from_slice(&remaining_desc);
        }
        if let Some(value) = default_value_for_desc {
            // Even where there is nothing before it.
            full_desc.extend_from_slice(if matches!(full_desc.last(), Some(b'.' | b'!' | b'?')) {
                b" "
            } else {
                b". "
            });
            full_desc.extend_from_slice(b"Default is `");
            full_desc.extend_from_slice(value);
            full_desc.push(b'`');
        }
        let first_word_width = split_whitespace(&full_desc).next().map_or(0, str_width);
        if prefix_len + first_word_width > self.wrap_width {
            if has_dash {
                tag_line.extend_from_slice(b" -");
            }
            self.content_lines.push(tag_line);
            self.push_wrapped_desc(&full_desc);
        } else {
            self.push_desc_behind(&prefix, &full_desc);
        }
    }

    pub(super) fn format_type_comment_tag(
        &mut self,
        normalized_kind: &[u8],
        tag: &Tag<'_>,
        should_capitalize: bool,
        has_no_space_before_type: bool,
    ) {
        let (type_part, comment_part) = tag.type_comment();
        let mut tag_line = [b"@", normalized_kind].concat();
        let preserve_quotes = matches!(normalized_kind, b"type" | b"satisfies");

        if let Some(raw_type) = type_part.map(|it| it.parsed()).filter(|it| !it.is_empty()) {
            let mut normalized_type = match preserve_quotes {
                true => normalize_type_preserve_quotes(raw_type),
                false => normalize_type_return(raw_type, self.quote_style()),
            };
            // `@type{import('...')}` stays as it is.
            if !(preserve_quotes && has_no_space_before_type && !normalized_type.starts_with(b"{"))
            {
                let star_stripped = strings::contains_char(raw_type, b'\n')
                    .then(|| strip_jsdoc_stars_preserve_newlines(raw_type));
                let type_options = embedded_options(self.format_options, self.wrap_width);
                let formatted = format_type_via_formatter(
                    star_stripped.as_deref().unwrap_or(&normalized_type),
                    &type_options,
                );
                match (formatted, star_stripped) {
                    (Some(formatted), Some(stripped))
                        if !strings::contains_char(&formatted, b'\n') =>
                    {
                        normalized_type = Cow::Owned(stripped);
                    }
                    (Some(formatted), _) => normalized_type = Cow::Owned(formatted),
                    (None, Some(stripped)) => normalized_type = Cow::Owned(stripped),
                    (None, None) => {}
                }
            }
            self.push_type(&mut tag_line, &normalized_type, has_no_space_before_type);
        }

        let parsed = comment_part.parsed();
        let desc_normalized = normalize_markdown_emphasis(trim(&parsed));
        let desc_text = trim(&desc_normalized);
        if desc_text.is_empty() {
            self.content_lines.push(tag_line);
            return;
        }
        let desc_text = if should_capitalize {
            capitalize_first(desc_text)
        } else {
            Cow::Borrowed(desc_text)
        };

        // A type over several lines: one word stays on its last line, more go on a line of their own.
        if let Some(last_line_break) = strings::last_index_of_char(&tag_line, b'\n') {
            let last_line_width = str_width(&tag_line[last_line_break + 1..]);
            if !strings::contains_char(&desc_text, b' ')
                && last_line_width + 1 + str_width(&desc_text) <= self.wrap_width
            {
                tag_line.push(b' ');
                tag_line.extend_from_slice(&desc_text);
                self.content_lines.push(tag_line);
            } else {
                self.content_lines.push(tag_line);
                self.push_wrapped_desc(&desc_text);
            }
            return;
        }

        // The dash is not the marker of a list.
        let (has_dash, desc_text) = split_dash(&desc_text);
        let prefix = [&tag_line[..], if has_dash { b" - " } else { b" " }].concat();
        let prefix_len = str_width(&prefix);
        if prefix_len + str_width(desc_text) <= self.wrap_width || desc_text.is_empty() {
            self.content_lines.push([&prefix[..], desc_text].concat());
            return;
        }
        let first_word_width = split_whitespace(desc_text).next().map_or(0, str_width);
        if prefix_len + first_word_width > self.wrap_width {
            self.content_lines.push(tag_line);
            self.push_wrapped_desc(desc_text);
        } else {
            self.push_desc_behind(&prefix, desc_text);
        }
    }

    /// Pushes lines as they are. One with nothing but white space is empty.
    fn push_raw_lines(&mut self, text: &[u8]) {
        for line in split_lines(text) {
            self.content_lines
                .push(if is_blank(line) { b"" } else { line });
        }
    }

    pub(super) fn format_generic_tag(
        &mut self,
        normalized_kind: &[u8],
        tag: &Tag<'_>,
        should_capitalize: bool,
    ) {
        let tag_line = [b"@", normalized_kind].concat();
        let raw_with_whitespace = tag.comment().parsed_preserving_whitespace();
        let has_leading_blank_line = starts_with_blank_line(&raw_with_whitespace);
        let desc_starts_on_new_line =
            trim_start_matches(&raw_with_whitespace, |c| c == ' ').starts_with(b"\n");

        let parsed = tag.comment().parsed();
        let desc_normalized = normalize_markdown_emphasis(trim(&parsed));
        let desc_text = trim(&desc_normalized);
        // With the empty lines and the indentation in it.
        let raw_normalized = normalize_markdown_emphasis(trim(&raw_with_whitespace));
        let raw_desc = trim(&raw_normalized);
        let is_raw_multiline = strings::contains_char(raw_desc, b'\n');
        if desc_text.is_empty() {
            self.content_lines.push(tag_line);
            return;
        }

        let is_named = is_named_generic_tag(normalized_kind);
        let desc_text: Bytes<'_> = if matches!(normalized_kind, b"default" | b"defaultValue") {
            match is_raw_multiline {
                true => Cow::Borrowed(desc_text),
                false => format_default_value(desc_text, self.quote_style()),
            }
        } else if should_capitalize && is_named && !has_leading_blank_line {
            // The first word is a name. A type in braces, with the white space in it, counts as a word.
            let name_end = match desc_text.starts_with(b"{") {
                true => find_balanced_brace_end(desc_text),
                false => find_ascii_whitespace(desc_text),
            };
            match name_end.map(|end| (&desc_text[..end], trim_start(&desc_text[end..]))) {
                Some((name, description)) if !description.is_empty() => {
                    Cow::Owned([name, b" ", &capitalize_first(description)].concat())
                }
                _ => Cow::Borrowed(desc_text),
            }
        } else if should_capitalize {
            capitalize_first_skip_type(desc_text)
        } else {
            Cow::Borrowed(desc_text)
        };
        let skip_formatting = should_skip_description_formatting(normalized_kind);

        if has_leading_blank_line {
            self.content_lines.push(tag_line);
            self.content_lines.push_empty();
            if skip_formatting && is_raw_multiline {
                self.push_raw_lines(raw_desc);
            } else if skip_formatting {
                self.push_wrapped_desc_after_blank_line(raw_desc, b"", self.wrap_width);
            } else {
                self.push_wrapped_desc_after_blank_line(
                    &desc_text,
                    Self::CONTINUATION_INDENT,
                    self.indented_width(),
                );
            }
            return;
        }
        if matches!(normalized_kind, b"remarks" | b"privateRemarks") {
            self.content_lines.push(tag_line);
            self.push_wrapped_desc(&desc_text);
            return;
        }
        let prefix = [&tag_line[..], b" "].concat();

        // `@categoryDescription Component` and the description on the next line.
        if is_named && desc_starts_on_new_line && !skip_formatting {
            let space = find_ascii_whitespace(&desc_text).unwrap_or(desc_text.len());
            let description = trim_start(&desc_text[space..]);
            if description.is_empty() {
                self.content_lines.push([&prefix[..], &desc_text].concat());
            } else {
                self.content_lines
                    .push([&prefix[..], &desc_text[..space]].concat());
                self.push_wrapped_desc(description);
            }
            return;
        }

        let prefix_len = str_width(&prefix);
        let is_unknown = !is_known_tag(normalized_kind);
        let skip_wrapping = skip_formatting || is_unknown;
        if skip_wrapping && desc_starts_on_new_line {
            self.content_lines.push(tag_line);
            self.push_raw_lines(raw_desc);
            return;
        }
        let fits_on_one_line = prefix_len + str_width(&desc_text) <= self.wrap_width;
        // Anything else is broken into lines, which makes one space of line breaks and of several spaces.
        let is_plain_one_liner = fits_on_one_line
            && !strings::contains_char(&desc_text, b'\n')
            && !strings::contains(&desc_text, b"  ");
        if skip_wrapping && is_raw_multiline {
            self.content_lines.push([&prefix[..], raw_desc].concat());
        } else if is_plain_one_liner || (skip_wrapping && fits_on_one_line) {
            self.content_lines.push([&prefix[..], &desc_text].concat());
        } else if should_preserve_description_verbatim(normalized_kind) || is_unknown {
            self.content_lines.push([&prefix[..], raw_desc].concat());
        } else if skip_wrapping {
            // `@deprecated` gets no capital letter, but it is broken into lines.
            self.push_desc_behind(&prefix, raw_desc);
        } else if prefix_len + split_whitespace(&desc_text).next().map_or(0, str_width)
            > self.wrap_width
        {
            self.content_lines.push(tag_line);
            self.push_wrapped_desc(&desc_text);
        } else {
            self.push_desc_behind(&prefix, &desc_text);
        }
    }
}

/// The index behind the `}` that closes the `{` that `text` starts with.
fn find_balanced_brace_end(text: &[u8]) -> Option<usize> {
    let mut depth = 0u32;
    for (index, &byte) in text.iter().enumerate() {
        match byte {
            b'{' => depth += 1,
            b'}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(index + 1);
                }
            }
            _ => {}
        }
    }
    None
}

/// [`capitalize_first`] for what follows the `{type}` that `text` starts with, if it does.
fn capitalize_first_skip_type(text: &[u8]) -> Bytes<'_> {
    let Some(end) = find_balanced_brace_end(text).filter(|_| text.starts_with(b"{")) else {
        return capitalize_first(text);
    };
    match capitalize_first(trim_start(&text[end..])) {
        Cow::Borrowed(_) => Cow::Borrowed(text),
        Cow::Owned(capitalized) => Cow::Owned([&text[..end], b" ", &capitalized].concat()),
    }
}
