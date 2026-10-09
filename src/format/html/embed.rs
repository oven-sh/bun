//! Prettier's `language-html/embed.js` and `embed/*.js`: what is in another language.

use super::ast::{Attribute, Flags, Id, Kind};
use super::js::{self, Hug, SourceType, Syntax};
use super::parse::collapse_white_space;
use super::printer::Printer;
use super::utilities::{
    dedent_string, html_split, html_trim, html_trim_preserve_indentation, is_script_like_tag,
    should_unquote_attribute_value, unescape_quote_entities,
};
use super::writer::Attempt;
use super::{Parser, data};
use crate::markdown::infer_parser;
use crate::options::{HtmlRoot, InHtml, LineEnding, LineWidth};
use crate::text;
use crate::{FormatError, FormatOptions};
use bun_core::strings;

/// `inferParserByTypeAttribute`
fn infer_parser_by_type_attribute(kind: &[u8]) -> Option<&'static [u8]> {
    Some(match kind {
        b"module"
        | b"text/javascript"
        | b"text/babel"
        | b"text/jsx"
        | b"application/javascript" => b"babel",
        b"application/x-typescript" => b"typescript",
        b"text/markdown" => b"markdown",
        b"text/html" => b"html",
        b"text/x-handlebars-template" => b"glimmer",
        _ if kind.ends_with(b"json")
            || kind.ends_with(b"importmap")
            || kind == b"speculationrules" =>
        {
            b"json"
        }
        _ => return None,
    })
}

/// `String(value)`, for a number that is not negative. `None`: it is written with an exponent.
fn number_to_string(value: f64) -> Option<Vec<u8>> {
    (value == 0.0 || (1e-6..1e21).contains(&value)).then(|| value.to_string().into_bytes())
}

/// `/^\d+$/.test(text)`
fn is_non_negative_integer(text: &[u8]) -> bool {
    !text.is_empty() && text.iter().all(u8::is_ascii_digit)
}

/// `/^-?(?:[0-9]+|[0-9]*\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(text)`
fn is_floating_point(text: &[u8]) -> bool {
    let digits = |text: &[u8]| text.iter().take_while(|byte| byte.is_ascii_digit()).count();
    let rest = text.strip_prefix(b"-").unwrap_or(text);
    let whole = digits(rest);
    let mut rest = match rest[whole..].strip_prefix(b".") {
        Some(fraction) if digits(fraction) > 0 => &fraction[digits(fraction)..],
        Some(_) => return false,
        None if whole == 0 => return false,
        None => &rest[whole..],
    };
    if let [b'e' | b'E', exponent @ ..] = rest {
        let exponent = exponent
            .strip_prefix(b"+")
            .or_else(|| exponent.strip_prefix(b"-"))
            .unwrap_or(exponent);
        if digits(exponent) == 0 {
            return false;
        }
        rest = &exponent[digits(exponent)..];
    }
    rest.is_empty()
}

/// A `srcset` whose candidates would take more bytes than this once they are lined up stays as it is.
const MAX_SRCSET_SIZE: usize = 1 << 20;

/// A candidate of a `srcset`: the address, and the descriptor with its unit.
struct Candidate<'v> {
    url: &'v [u8],
    width: Option<f64>,
    density: Option<f64>,
    height: Option<f64>,
}

/// `@prettier/parse-srcset`. `None`: it throws.
fn parse_srcset(input: &[u8]) -> Option<Vec<Candidate<'_>>> {
    let is_space = |byte: u8| matches!(byte, b'\t' | b'\n' | 0x0C | b'\r' | b' ');
    let mut candidates = Vec::new();
    let mut position = 0;
    loop {
        position += input[position..]
            .iter()
            .take_while(|&&byte| byte == b',' || is_space(byte))
            .count();
        if position >= input.len() {
            return Some(candidates).filter(|candidates| !candidates.is_empty());
        }
        let len = input[position..]
            .iter()
            .take_while(|&&byte| !is_space(byte))
            .count();
        let mut url = &input[position..position + len];
        position += len;
        let mut descriptors: Vec<&[u8]> = Vec::new();
        if url.ends_with(b",") {
            while let Some(shorter) = url.strip_suffix(b",") {
                url = shorter;
            }
        } else {
            // The descriptor tokenizer. A descriptor is a part of the input.
            position += input[position..]
                .iter()
                .take_while(|&&byte| is_space(byte))
                .count();
            let mut start = position;
            let mut is_in_parens = false;
            loop {
                let c = input.get(position).copied();
                match c {
                    Some(b')') if is_in_parens => is_in_parens = false,
                    Some(_) if is_in_parens => {}
                    Some(b'(') => is_in_parens = true,
                    Some(byte) if byte != b',' && !is_space(byte) => {}
                    // The end of a descriptor.
                    _ => {
                        if position > start {
                            descriptors.push(&input[start..position]);
                        }
                        if !c.is_some_and(is_space) {
                            position += usize::from(c.is_some());
                            break;
                        }
                        position += input[position..]
                            .iter()
                            .take_while(|&&byte| is_space(byte))
                            .count();
                        start = position;
                        continue;
                    }
                }
                position += 1;
            }
        }
        let mut candidate = Candidate {
            url,
            width: None,
            density: None,
            height: None,
        };
        for descriptor in descriptors {
            let (&unit, value) = descriptor.split_last()?;
            let number = std::str::from_utf8(value)
                .ok()
                .and_then(|value| value.parse::<f64>().ok());
            let has = |value: Option<f64>| value.is_some_and(|value| value != 0.0);
            match unit {
                b'w' if is_non_negative_integer(value) => {
                    if has(candidate.width) || has(candidate.density) {
                        return None;
                    }
                    candidate.width = Some(number.filter(|&number| number != 0.0)?);
                }
                b'x' if is_floating_point(value) => {
                    if has(candidate.width) || has(candidate.density) || has(candidate.height) {
                        return None;
                    }
                    candidate.density = Some(number.filter(|&number| number >= 0.0)?);
                }
                b'h' if is_non_negative_integer(value) => {
                    if has(candidate.height) || has(candidate.density) {
                        return None;
                    }
                    candidate.height = Some(number.filter(|&number| number != 0.0)?);
                }
                _ => return None,
            }
        }
        // A density of 0 is as good as none.
        candidate.density = candidate.density.filter(|&density| density != 0.0);
        candidates.push(candidate);
    }
}

impl<'t, 'a> Printer<'t, 'a, '_, '_, '_> {
    // ───────────────────────────── `textToDoc` ─────────────────────────────

    /// The options for a formatter whose text is written with `Writer::printed_text`. `None`: where the lines start is
    /// not known.
    fn options_for_printed_text(&self) -> Option<FormatOptions> {
        let width = usize::from(self.options.format.line_width.value())
            .saturating_sub(self.out.indentation_width()?);
        Some(FormatOptions {
            line_width: LineWidth(width.clamp(1, usize::from(u16::MAX)) as u16),
            line_ending: LineEnding::Lf,
            is_in_markdown: true,
            // For the blocks of code in Markdown.
            sort_imports: self.options.format.sort_imports.clone(),
            jsdoc: self.options.format.jsdoc,
            ..js::options_in_html(self.options.format, InHtml::default())
        })
    }

    /// Writes what `format` appends to the vector that it is given, without the line breaks at its end.
    fn write_printed_text(
        &mut self,
        is_markdown: bool,
        format: impl FnOnce(&FormatOptions, &mut Vec<u8>) -> Result<(), FormatError>,
    ) -> bool {
        let Some(options) = self.options_for_printed_text() else {
            return false;
        };
        let mut printed = Vec::new();
        if format(&options, &mut printed).is_err() {
            return false;
        }
        // Where a line break that is part of a text leads is not the same for all that Markdown prints: to the first
        // column in code, to where the lines start in HTML. Which it is, the text does not say.
        if is_markdown && self.out.indent_level() != Some(0) && strings::contains(&printed, b"\r\n")
        {
            return false;
        }
        let end = printed
            .iter()
            .rposition(|byte| !matches!(byte, b'\n' | b'\r'))
            .map_or(0, |at| at + 1);
        self.out.printed_text(&printed[..end]);
        true
    }

    /// `textToDoc(code, { parser, __embeddedInHtml: true })`. Returns whether it has written something: if not, Prettier
    /// throws, or the document is empty.
    pub(crate) fn text_to_doc(
        &mut self,
        code: &[u8],
        parser: &[u8],
        source_type: SourceType,
    ) -> bool {
        let in_html = InHtml {
            root: HtmlRoot::Program,
            ..InHtml::default()
        };
        let program = |syntax: Syntax, printer: &mut Self| {
            printer
                .out
                .foreign(|f| js::write_program(f, code, syntax, source_type, in_html))
        };
        if let Some(parser) = crate::css::Parser::from_name(parser)
            && self.out.indent_level().is_some()
            && !self.options.has_parent_parser
        {
            // Nothing in a style sheet depends on what is around it but the width that is left, which is known in a
            // file of HTML.
            let mut scratch = std::mem::take(&mut self.css_scratch);
            let is_written = self.write_printed_text(false, |options, out| {
                let options = FormatOptions {
                    in_html,
                    ..options.clone()
                };
                crate::css::format(code, parser, &options, &mut scratch, out)?;
                match out.is_empty() {
                    true => Err(FormatError::SyntaxError),
                    false => Ok(()),
                }
            });
            self.css_scratch = scratch;
            return is_written;
        }
        if let Some(parser) = crate::css::Parser::from_name(parser) {
            let options = js::options_in_html(self.options.format, in_html);
            return match crate::css::document(code, parser, &options) {
                Ok(document) if !document.is_empty_text() => {
                    self.out
                        .foreign(|f| crate::css::embed::write_document(&document, f));
                    true
                }
                _ => false,
            };
        }
        if let Some(parser) = crate::json::Parser::from_name(parser) {
            // To these parsers, a text with nothing in it is a syntax error.
            return !text::trim(code).is_empty()
                && self.write_printed_text(false, |options, out| {
                    crate::json::format(code, parser, options, &mut Default::default(), out)
                });
        }
        if let Some(parser) = Parser::from_name(parser) {
            return self.print_embedded_html(code, parser);
        }
        match parser {
            b"babel" => program(Syntax::Babel, self),
            b"typescript" => program(Syntax::TypeScript, self),
            b"yaml" => self.write_printed_text(false, |options, out| {
                crate::yaml::format(code, options, &mut Default::default(), out)
            }),
            b"markdown" => self.write_printed_text(true, |options, out| {
                crate::markdown::format(code, options, &mut Default::default(), out)
            }),
            b"graphql" => self.write_printed_text(false, |options, out| {
                crate::graphql::format(code, options, &mut Default::default(), out)
            }),
            // A template of which Prettier loses something stays as it is.
            b"glimmer" => self.write_printed_text(false, |options, out| {
                let mut scratch = crate::handlebars::Scratch::default();
                let result = crate::handlebars::format(code, options, &mut scratch, out);
                if scratch.is_damaged() {
                    Err(FormatError::SyntaxError)
                } else {
                    result
                }
            }),
            _ => false,
        }
    }

    /// HTML in HTML.
    fn print_embedded_html(&mut self, code: &[u8], parser: Parser) -> bool {
        if text::trim(code).is_empty() {
            return false;
        }
        let (format, filepath) = (self.options.format, self.options.filepath);
        let attempt = self.out.start_attempt();
        let indent_level = self.out.indent_level();
        let is_written = self.out.foreign(|f| {
            super::write_document(code, parser, filepath, format, true, indent_level, f).is_ok()
        });
        self.out.end_attempt(attempt, is_written)
    }

    // ───────────────────────────── `embed` ─────────────────────────────

    /// `inferElementParser`
    fn infer_element_parser(&self, id: Id) -> Option<&'static [u8]> {
        let (tree, node) = (self.tree, &self.tree[id]);
        let by_attributes = || {
            let language = tree.attribute_value(id, b"lang").and_then(infer_parser);
            language.or_else(|| {
                tree.attribute_value(id, b"type")
                    .and_then(infer_parser_by_type_attribute)
            })
        };
        // `inferScriptParser`
        if &node.name[..] == b"script" && tree.attribute(id, b"src").is_none() {
            if tree.attribute_value(id, b"lang").is_none()
                && tree.attribute_value(id, b"type").is_none()
            {
                return Some(b"babel");
            }
            if let Some(parser) = by_attributes() {
                return Some(parser);
            }
        }
        // `inferStyleParser`
        if &node.name[..] == b"style" {
            match tree.attribute_value(id, b"lang") {
                None => return Some(b"css"),
                Some(language) => {
                    if let Some(parser) = infer_parser(language) {
                        return Some(parser);
                    }
                }
            }
        }
        if &node.name[..] == b"mj-style" && self.options.parser == Parser::Mjml {
            return Some(b"css");
        }
        // `inferVueSfcBlockParser`
        if !tree.is_vue_non_html_block(id, self.options) || tree.attribute(id, b"src").is_some() {
            return None;
        }
        by_attributes()
    }

    /// Prettier's `embed`. Returns whether it has written the node.
    pub(crate) fn embed(&mut self, id: Id) -> bool {
        match self.tree[id].kind {
            Kind::FrontMatter => self.embed_front_matter(id),
            Kind::Element => self.embed_element(id),
            Kind::Text => self.embed_text(id),
            _ => false,
        }
    }

    /// `printEmbedFrontMatter`
    fn embed_front_matter(&mut self, id: Id) -> bool {
        let raw = self.tree[id].span.of(self.options.original_text);
        let (Some(first_line_end), Some(last_line_start)) = (
            strings::index_of_char_usize(raw, b'\n'),
            strings::last_index_of_char(raw, b'\n').map(|at| at + 1),
        ) else {
            return false;
        };
        let language = text::trim(&raw[3..first_line_end]);
        let is_toml = language == b"toml" || (language.is_empty() && raw.starts_with(b"+++"));
        let is_yaml = language == b"yaml" || (language.is_empty() && !is_toml);
        let value = text::trim(raw.get(first_line_end..last_line_start).unwrap_or_default());
        // There is no formatter for TOML.
        if !(is_yaml || (is_toml && value.is_empty())) {
            return false;
        }
        let attempt = self.out.start_attempt();
        self.out.text(&raw[..3]);
        self.out.text(language);
        self.out.hardline();
        let is_written = value.is_empty() || {
            let is_written = self.text_to_doc(value, b"yaml", SourceType::Unknown);
            self.out.hardline();
            is_written
        };
        self.out.text(&raw[last_line_start..]);
        self.out.end_attempt(attempt, is_written)
    }

    /// A block of a Vue file that is not HTML.
    fn embed_element(&mut self, id: Id) -> bool {
        let (tags, node) = (self.tags(), &self.tree[id]);
        if is_script_like_tag(node, self.options)
            || node.has(Flags::IS_SELF_CLOSING)
            || !self.tree.is_vue_non_html_block(id, self.options)
        {
            return false;
        }
        let Some(parser) = self.infer_element_parser(id) else {
            return false;
        };
        let content = tags.node_content(id);
        let attempt = self.out.start_attempt();
        self.out.built_text(|out| tags.opening_tag_prefix(id, out));
        self.out.start_group();
        self.print_opening_tag(id);
        self.out.end_group();
        let mut is_written = true;
        if !text::trim(content).is_empty() {
            self.out.hardline();
            is_written = self.text_to_doc(
                html_trim_preserve_indentation(content),
                parser,
                SourceType::Unknown,
            );
            self.out.hardline();
        }
        self.out.built_text(|out| {
            tags.closing_tag(id, out);
            tags.closing_tag_suffix(id, out);
        });
        self.out.end_attempt(attempt, is_written)
    }

    fn embed_text(&mut self, id: Id) -> bool {
        let (tags, tree) = (self.tags(), self.tree);
        let Some(parent) = tree.parent(id) else {
            return false;
        };
        let value = &tree[id].value[..];
        if is_script_like_tag(&tree[parent], self.options) {
            let Some(parser) = self.infer_element_parser(parent) else {
                return false;
            };
            let dedented;
            let value = match parser {
                b"markdown" => {
                    // `.replace(/^[^\S\n]*\n/, "")`
                    let blank = value.len() - text::trim_start(value).len();
                    let first_line_end =
                        strings::index_of_char_usize(&value[..blank], b'\n').map_or(0, |at| at + 1);
                    dedented = dedent_string(&value[first_line_end..]);
                    &dedented[..]
                }
                _ => value,
            };
            let source_type = match (self.options.parser, parser) {
                (Parser::Html, b"babel") => {
                    let kind = tree.attribute(parent, b"type").flatten();
                    let is_module = kind == Some(b"module")
                        || (matches!(kind, Some(b"text/babel" | b"text/jsx"))
                            && tree.attribute(parent, b"data-type").flatten() == Some(b"module"));
                    if is_module {
                        SourceType::Module
                    } else {
                        SourceType::Script
                    }
                }
                _ => SourceType::Unknown,
            };
            let attempt = self.out.start_attempt();
            self.out.break_parent();
            self.out.built_text(|out| tags.opening_tag_prefix(id, out));
            let is_written = self.text_to_doc(value, parser, source_type);
            self.out.built_text(|out| tags.closing_tag_suffix(id, out));
            return self.out.end_attempt(attempt, is_written);
        }
        if tree[parent].kind != Kind::Interpolation {
            return false;
        }
        let in_html = InHtml {
            root: match self.options.parser {
                Parser::Angular => HtmlRoot::NgInterpolation,
                Parser::Vue => HtmlRoot::VueExpression,
                _ => HtmlRoot::JsExpression,
            },
            is_in_interpolation: true,
            ..InHtml::default()
        };
        let attempt = self.out.start_attempt();
        self.out.start_indent();
        self.out.line();
        let is_written = match self.options.parser {
            Parser::Angular => self.write_angular_expression(value, in_html, Hug::Bare),
            _ => {
                let is_typescript =
                    self.options.parser == Parser::Vue && self.is_vue_sfc_with_typescript_script();
                self.out
                    .foreign(|f| js::write_expression(f, value, is_typescript, in_html, Hug::Bare))
            }
        };
        self.out.end_indent();
        match tree
            .next(parent)
            .is_some_and(|next| tags.needs_to_borrow_prev_closing_tag_end_marker(next))
        {
            true => self.out.token(" "),
            false => self.out.line(),
        }
        self.out.end_attempt(attempt, is_written)
    }

    // ───────────────────────────── `embed/attribute.js` ─────────────────────────────

    /// `createAttributePrinter`: writes the attribute with the value that `write_value` writes, unless that returns
    /// `false` or writes nothing.
    pub(crate) fn print_attribute_with(
        &mut self,
        attr: &Attribute<'_>,
        write_value: impl FnOnce(&mut Self) -> bool,
    ) -> bool {
        let attempt = self.out.start_attempt_behind_text();
        let is_written = write_value(self);
        self.print_attribute_with_attempt(attr, attempt, is_written)
    }

    /// `attempt`: what the value has been written in. `is_written`: it is one.
    fn print_attribute_with_attempt(
        &mut self,
        attr: &Attribute<'_>,
        attempt: Attempt,
        is_written: bool,
    ) -> bool {
        let Some(value) = self.out.end_attempt_as_content(attempt, is_written) else {
            return false;
        };
        self.write_raw_name(attr.raw_name());
        self.out.token("=\"");
        self.out.start_group();
        self.out
            .foreign(|f| js::write_with_quote_entities(value, f));
        self.out.end_group();
        self.out.token("\"");
        true
    }

    /// `printExpand(doc, canHaveTrailingWhitespace)`, where `write` writes `doc`.
    pub(crate) fn print_expand(
        &mut self,
        can_have_trailing_whitespace: bool,
        write: impl FnOnce(&mut Self) -> bool,
    ) -> bool {
        self.out.start_indent();
        self.out.softline();
        let is_written = write(self);
        self.out.end_indent();
        if can_have_trailing_whitespace {
            self.out.softline();
        }
        is_written
    }

    /// `printAttribute`. Returns whether it has written the attribute.
    pub(crate) fn embed_attribute(&mut self, element: Id, attr: &'t Attribute<'a>) -> bool {
        let Some(raw_value) = attr.value.filter(|value| !value.is_empty()) else {
            return false;
        };
        if should_unquote_attribute_value(attr, self.options) {
            self.write_raw_name(attr.raw_name());
            self.out.token("=");
            self.out.text(raw_value);
            return true;
        }
        let node = &self.tree[element];
        let is_plain = !self.options.has_parent_parser && !strings::contains(raw_value, b"{{");
        let value = unescape_quote_entities(raw_value);
        let value = &value[..];
        if attr.namespace.is_empty() {
            match &attr.name[..] {
                b"srcset" if node.is_full_name(b"img") || node.is_full_name(b"source") => {
                    return self.print_attribute_with(attr, |printer| printer.print_srcset(value));
                }
                b"style" if is_plain => {
                    return self.print_attribute_with(attr, |printer| printer.print_style(value));
                }
                name if is_plain && data::is_event_attribute(name) => {
                    let in_html = InHtml {
                        root: HtmlRoot::Program,
                        is_in_attribute: true,
                        is_inline_event_handler: true,
                        ..InHtml::default()
                    };
                    return self.print_attribute_with(attr, |printer| {
                        printer.out.foreign(|f| {
                            js::write_program_in_attribute(
                                f,
                                value,
                                Syntax::Babel,
                                in_html,
                                Hug::Never,
                            )
                        })
                    });
                }
                b"class" if is_plain => {
                    return self.print_attribute_with(attr, |printer| {
                        printer.out.text(&collapse_white_space(value));
                        true
                    });
                }
                b"allow" if is_plain && node.is_full_name(b"iframe") => {
                    return self.print_attribute_with(attr, |printer| {
                        printer.print_permissions_policy(value)
                    });
                }
                _ => {}
            }
        }
        match self.options.parser {
            Parser::Vue => self.embed_vue_attribute(element, attr, value),
            Parser::Angular => self.embed_angular_attribute(element, attr, raw_value, value),
            _ => false,
        }
    }

    /// `printSrcset`
    fn print_srcset(&mut self, value: &[u8]) -> bool {
        let Some(candidates) = parse_srcset(value) else {
            return false;
        };
        let has = |get: fn(&Candidate<'_>) -> Option<f64>| {
            candidates.iter().any(|candidate| get(candidate).is_some())
        };
        let kinds: [(fn(&Candidate<'_>) -> Option<f64>, &'static str); 3] = [
            (|it| it.width, "w"),
            (|it| it.height, "h"),
            (|it| it.density, "x"),
        ];
        let mut used = kinds.iter().filter(|(get, _)| has(*get));
        let (kind, None) = (used.next(), used.next()) else {
            return false;
        };
        let mut descriptors = Vec::with_capacity(candidates.len());
        for candidate in &candidates {
            descriptors.push(match kind.and_then(|(get, _)| get(candidate)) {
                Some(number) => match number_to_string(number) {
                    Some(descriptor) => descriptor,
                    None => return false,
                },
                None => Vec::new(),
            });
        }
        let left_len = |descriptor: &[u8]| {
            strings::index_of_char_usize(descriptor, b'.').unwrap_or(descriptor.len())
        };
        let max_url_len = candidates
            .iter()
            .map(|candidate| text::utf16_len(candidate.url) as usize)
            .max()
            .unwrap_or(0);
        // Every candidate is made as wide as the widest. Of 140 KB, half of them one address, Prettier makes 800 MB.
        if max_url_len.saturating_mul(candidates.len()) > MAX_SRCSET_SIZE {
            return false;
        }
        let max_descriptor_left_len = descriptors
            .iter()
            .map(|descriptor| left_len(descriptor))
            .max()
            .unwrap_or(0);
        self.print_expand(true, |printer| {
            for (index, (candidate, descriptor)) in candidates.iter().zip(&descriptors).enumerate()
            {
                if index > 0 {
                    printer.out.token(",");
                    printer.out.line();
                }
                printer.out.text(candidate.url);
                if descriptor.is_empty() {
                    continue;
                }
                let alignment = max_url_len - text::utf16_len(candidate.url) as usize
                    + 1
                    + max_descriptor_left_len
                    - left_len(descriptor);
                printer.out.start_if(true, None);
                printer.out.text(&b" ".repeat(alignment));
                printer.out.end_if();
                printer.out.start_if(false, None);
                printer.out.token(" ");
                printer.out.end_if();
                printer.out.text(descriptor);
                printer.out.token(kind.map_or("", |(_, unit)| *unit));
            }
            true
        })
    }

    /// `printStyle`
    fn print_style(&mut self, value: &[u8]) -> bool {
        let in_html = InHtml {
            root: HtmlRoot::Program,
            is_style_attribute: true,
            ..InHtml::default()
        };
        let options = js::options_in_html(self.options.format, in_html);
        let Ok(document) = crate::css::document(value, crate::css::Parser::Css, &options) else {
            return false;
        };
        self.print_expand(true, |printer| {
            printer
                .out
                .foreign(|f| crate::css::embed::write_document(&document, f));
            true
        })
    }

    /// `printPermissionsPolicy`
    fn print_permissions_policy(&mut self, value: &[u8]) -> bool {
        let directives = || {
            strings::split(value, b";")
                .map(html_trim)
                .filter(|token| !token.is_empty())
        };
        let count = directives().count();
        if count == 0 {
            // An attribute with nothing between its quotes.
            self.out.start_group();
            self.out.end_group();
            return true;
        }
        self.print_expand(true, |printer| {
            for (index, directive) in directives().enumerate() {
                for (index, word) in html_split(directive).enumerate() {
                    if index > 0 {
                        printer.out.token(" ");
                    }
                    printer.out.text(word);
                }
                match index + 1 == count {
                    true => printer.out.token_if_break(";"),
                    false => {
                        printer.out.token(";");
                        printer.out.line();
                    }
                }
            }
            true
        })
    }
}
