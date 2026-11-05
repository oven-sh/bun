//! Prettier's `language-html/embed.js` and `embed/*.js`: code in other languages.

use super::ast::{Attribute, Flags, Id, Kind};
use super::canonical::{self, Spelling};
use super::js::{self, Hug, SourceType, Syntax};
use super::printer::Printer;
use super::utilities::{
    dedent_string, html_split, html_trim_preserve_indentation, is_pre_like, is_script_like_tag,
    should_unquote_attribute_value, unescape_quote_entities,
};
use super::writer::Attempt;
use super::{Parser, data};
use crate::markdown::infer_parser;
use crate::options::{HtmlRoot, InHtml, LineEnding, LineWidth};
use crate::{FormatError, FormatOptions};
use bun_core::strings;

/// `inferParserByTypeAttribute`
pub(crate) fn infer_parser_by_type_attribute(kind: &[u8]) -> Option<&'static [u8]> {
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

/// Returns the classes in `value`, separated by single spaces. HTML splits them at ASCII whitespace. Prettier splits at
/// JavaScript whitespace, so a class name that contains a no-break space becomes two classes.
fn class_names(value: &[u8]) -> Vec<u8> {
    let names = strings::split_any(value, b" \t\n\x0C\r").filter(|name| !name.is_empty());
    names.collect::<Vec<_>>().join(&b' ')
}

/// `String(value)` for a non-negative number. Returns `None` if JavaScript would use an exponent.
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

/// A `srcset` candidate: the URL and its descriptors.
struct Candidate<'v> {
    url: &'v [u8],
    width: Option<f64>,
    density: Option<f64>,
    height: Option<f64>,
}

/// `@prettier/parse-srcset`. Returns `None` where it throws.
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
            // The descriptor tokenizer. Each descriptor is a slice of the input.
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
        // A density of 0 counts as no density.
        candidate.density = candidate.density.filter(|&density| density != 0.0);
        candidates.push(candidate);
    }
}

/// Returns the options for a formatter whose output gets the indentation of the place where it is printed, which is
/// `indentation` columns wide, in a text with the options `format`.
pub(crate) fn options_for_printed_text(
    format: &FormatOptions,
    indentation: usize,
) -> FormatOptions {
    let width = (format.line_width.value() as usize).saturating_sub(indentation);
    FormatOptions {
        line_width: LineWidth(width.clamp(1, u32::MAX as usize) as u32),
        line_ending: LineEnding::Lf,
        is_in_markdown: true,
        // For code blocks in Markdown.
        sort_imports: format.sort_imports.clone(),
        jsdoc: format.jsdoc,
        ..js::options_in_html(format, InHtml::default())
    }
}

impl<'t, 'a> Printer<'t, 'a, '_, '_, '_> {
    // ───────────────────────────── `textToDoc` ─────────────────────────────

    /// Returns the options for a formatter whose output is written with `Writer::printed_text`, or `None` if the
    /// current indentation isn't known.
    fn options_for_printed_text(&self) -> Option<FormatOptions> {
        Some(options_for_printed_text(
            self.options.format,
            self.out.indentation_width()?,
        ))
    }

    /// Writes the output that `format` appends to its vector, without trailing line breaks.
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
        // A line break inside a text, printed as `\r\n` here, doesn't always lead to the same column in Markdown's
        // output. It's column 0 in code but the current indentation in HTML, and the printed text doesn't tell which.
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

    /// `textToDoc(code, { parser, __embeddedInHtml: true })`. Returns true if it wrote something. Otherwise Prettier
    /// would throw, or the document is empty.
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
            if printer.write_script_quickly(code, syntax, source_type) {
                return true;
            }
            let flavor = printer.options.script_flavor;
            let level = printer.out.indent_level();
            printer.out.foreign(|f| {
                f.context_mut().short_cuts.start_script_at(level);
                let is_written = js::write_program(f, code, syntax, source_type, in_html, flavor);
                f.context_mut().short_cuts.end_script();
                is_written
            })
        };
        if let Some(parser) = crate::css::Parser::from_name(parser)
            && self.out.indent_level().is_some()
            && !self.options.has_parent_parser
        {
            // A style sheet's output only depends on its surroundings through the remaining width, which is known in an
            // HTML file.
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
                    self.out.style_sheet(&document);
                    true
                }
                _ => false,
            };
        }
        if let Some(parser) = crate::json::Parser::from_name(parser) {
            // These parsers treat an empty text as a syntax error.
            return !strings::trim_js_whitespace(code).is_empty()
                && self.write_printed_text(false, |options, out| {
                    crate::json::format(code, parser, options, &mut Default::default(), out)
                });
        }
        if let Some(parser) = Parser::from_name(parser) {
            return self.print_embedded_html(code, parser);
        }
        match parser {
            b"babel" => program(Syntax::Babel, self),
            // oxfmt parses every script of a file with the same syntax.
            b"typescript" if self.options.script_flavor.is_oxfmt() => match self.has_tsx_script() {
                true => program(Syntax::Tsx, self),
                false => program(Syntax::Ts, self),
            },
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
            b"glimmer" => self.write_printed_text(false, |options, out| {
                crate::handlebars::format(code, options, &mut Default::default(), out)
            }),
            _ => false,
        }
    }

    /// Writes a script as the quick way for JavaScript formats it, which is a text. What is printed for a script depends
    /// on nothing around it but the indentation if it starts a line and ends one. Returns false, with nothing written, if
    /// it has to go the long way.
    fn write_script_quickly(
        &mut self,
        code: &[u8],
        syntax: Syntax,
        source_type: SourceType,
    ) -> bool {
        let is_typescript = match syntax {
            Syntax::Babel => false,
            Syntax::TypeScript => true,
            Syntax::BabelTs | Syntax::Ts | Syntax::Tsx => return false,
        };
        let Some(indentation) = self.out.indent_level() else {
            return false;
        };
        if self.out.f.context().short_cuts.mode == crate::js::flat::Mode::Off
            || self.options.has_parent_parser
            || self.options.script_flavor.is_oxfmt()
            // What only a script can have is an error there.
            || source_type == SourceType::Module
            || !self.out.is_at_start_of_line()
        {
            return false;
        }
        let script = crate::js::quick::Script {
            text: code,
            name: (self.options.format.filepath.as_deref()).unwrap_or_default(),
            is_typescript,
            is_no_module: source_type == SourceType::Script,
            indentation,
        };
        let mut formatted = std::mem::take(&mut self.scripts.formatted);
        let quick = &mut self.scripts.quick;
        let is_formatted =
            crate::js::quick::format_script(script, self.options.format, quick, &mut formatted)
                .is_ok();
        let lines = formatted.strip_suffix(b"\n").unwrap_or(&formatted);
        let is_written = is_formatted && !lines.is_empty();
        if is_written {
            self.out.lines(lines);
        }
        self.scripts.formatted = formatted;
        is_written
    }

    /// Writes an attribute of Vue whose value is an expression as the quick way for JavaScript formats it. The start tag
    /// is either on one line, with all that is in it, or the attribute is on a line of its own at the current
    /// indentation: so what fits there on one line is printed like that, and what doesn't is printed as it is there.
    /// Returns false, with nothing written, if it has to go the long way.
    ///
    /// `left`: the names on the left side of `v-for` and its operator. `value` is the right side then.
    pub(crate) fn write_attribute_quickly(
        &mut self,
        element: Id,
        attr: &Attribute<'_>,
        left: Option<(&[&[u8]], &[u8])>,
        value: &[u8],
        is_typescript: bool,
        has_filters: bool,
    ) -> bool {
        let Some(indentation) = self.out.indent_level() else {
            return false;
        };
        if self.out.f.context().short_cuts.mode == crate::js::flat::Mode::Off
            || self.options.has_parent_parser
            || self.options.script_flavor.is_oxfmt()
            || self.tree.is_vue_sfc_block(element, self.options)
            || !self.has_room_on_line_of_its_own(element, 0)
        {
            return false;
        }
        let mut formatted = std::mem::take(&mut self.scripts.formatted);
        let mut name = std::mem::take(&mut self.scripts.name);
        name.clear();
        let (namespace, local) = attr.raw_name();
        if !namespace.is_empty() {
            name.extend_from_slice(namespace);
            name.push(b':');
        }
        name.extend_from_slice(local);
        name.extend_from_slice(b"=\"");
        if let Some((names, operator)) = left {
            let in_parentheses = names.len() > 1;
            name.extend_from_slice(if in_parentheses { b"(" } else { b"" });
            for (index, it) in names.iter().enumerate() {
                name.extend_from_slice(if index > 0 { b", " } else { b"" });
                name.extend_from_slice(it);
            }
            name.extend_from_slice(if in_parentheses { b") " } else { b" " });
            name.extend_from_slice(operator);
            name.push(b' ');
        }
        let expression = crate::js::quick::Expression {
            text: value,
            is_typescript,
            has_filters,
            attribute: Some(&name),
            hugs: left.is_some(),
            indentation,
        };
        let quick = &mut self.scripts.quick;
        let format = self.options.format;
        let mut is_written =
            crate::js::quick::format_expression(expression, format, quick, &mut formatted).is_ok();
        // The parentheses around the names are broken if there is no room for what follows them up to the first place where
        // the right side can be broken.
        if left.is_some_and(|(names, _)| names.len() > 1) {
            let first_line = strings::index_of_char_usize(&formatted, b'\n');
            let width = first_line.unwrap_or(formatted.len());
            is_written = is_written && self.has_room_on_line_of_its_own(element, width);
        }
        if is_written && strings::contains_char(&formatted, b'\n') {
            // What has no room on a line of its own has none behind `<`, the name of the element and a blank either, if
            // that is at least as wide as a level of indentation. So the start tag is broken.
            is_written = format.indent_width.value() as usize <= self.tree[element].name.len() + 2;
            if is_written {
                self.out.break_parent();
                self.out.lines(&formatted);
            }
        } else if is_written {
            self.out.text(&formatted);
        }
        (self.scripts.formatted, self.scripts.name) = (formatted, name);
        is_written
    }

    /// The same for an expression between `{{` and `}}`, which is written only if it is on one line: it is either on one
    /// line with its braces, or on a line of its own at the current indentation, given that a `line` follows it.
    fn write_interpolation_quickly(&mut self, code: &[u8], is_typescript: bool) -> bool {
        let Some(indentation) = self.out.indent_level() else {
            return false;
        };
        if self.out.f.context().short_cuts.mode == crate::js::flat::Mode::Off
            || self.options.has_parent_parser
            || self.options.script_flavor.is_oxfmt()
        {
            return false;
        }
        let mut formatted = std::mem::take(&mut self.scripts.formatted);
        let expression = crate::js::quick::Expression {
            text: code,
            is_typescript,
            has_filters: true,
            attribute: None,
            hugs: false,
            indentation,
        };
        let quick = &mut self.scripts.quick;
        let format = self.options.format;
        let is_written =
            crate::js::quick::format_expression(expression, format, quick, &mut formatted).is_ok()
                && !formatted.is_empty()
                && !strings::contains_char(&formatted, b'\n');
        if is_written {
            self.out.text(&formatted);
        }
        self.scripts.formatted = formatted;
        is_written
    }

    /// HTML in HTML.
    fn print_embedded_html(&mut self, code: &[u8], parser: Parser) -> bool {
        if strings::trim_js_whitespace(code).is_empty() || self.out.gives_up_quick_way() {
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

    /// Prettier's `embed`. Returns true if it wrote the node.
    pub(crate) fn embed(&mut self, id: Id) -> bool {
        match self.tree[id].kind {
            Kind::FrontMatter => {
                self.embed_front_matter(self.tree[id].span.of(self.options.original_text))
            }
            Kind::Element => self.embed_element(id),
            Kind::Text => self.embed_text(id),
            _ => false,
        }
    }

    /// `printEmbedFrontMatter`
    pub(super) fn embed_front_matter(&mut self, raw: &[u8]) -> bool {
        let (Some(first_line_end), Some(last_line_start)) = (
            strings::index_of_char_usize(raw, b'\n'),
            strings::last_index_of_char(raw, b'\n').map(|at| at + 1),
        ) else {
            return false;
        };
        let language = strings::trim_js_whitespace(&raw[3..first_line_end]);
        let is_toml = language == b"toml" || (language.is_empty() && raw.starts_with(b"+++"));
        let is_yaml = language == b"yaml" || (language.is_empty() && !is_toml);
        let value = crate::front_matter::trim_end_to_last_line(strings::trim_js_whitespace_start(
            raw.get(first_line_end..last_line_start).unwrap_or_default(),
        ));
        // There's no TOML formatter.
        if !(is_yaml || (is_toml && value.is_empty()))
            || crate::front_matter::has_indented_delimiter(raw)
        {
            return false;
        }
        let attempt = self.out.start_attempt();
        self.out.text(&raw[..3]);
        self.out.text(language);
        self.out.hardline();
        let is_written = value.is_empty() || {
            let is_written = self.text_to_doc(value, b"yaml", SourceType::Unknown);
            self.out.hardline_after(value);
            is_written
        };
        self.out.text(&raw[last_line_start..]);
        self.out.end_attempt(attempt, is_written)
    }

    /// A non-HTML block of a Vue file.
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
        self.out.start_group();
        self.print_opening_tag(id);
        self.out.end_group();
        let mut is_written = true;
        if !strings::trim_js_whitespace(content).is_empty() {
            self.out.hardline();
            is_written = self.text_to_doc(
                html_trim_preserve_indentation(content),
                parser,
                SourceType::Unknown,
            );
            self.out.hardline();
        }
        self.out.built_text(|out| tags.closing_tag(id, out));
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
                    let whitespace_len =
                        value.len() - strings::trim_js_whitespace_start(value).len();
                    let first_line_end =
                        strings::index_of_char_usize(&value[..whitespace_len], b'\n')
                            .map_or(0, |at| at + 1);
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
            // `printLineAfterChildren` prints nothing then, so `</script` is on the last line of the code, which a short
            // cut takes to end with the code.
            let lends_end_of_closing_tag = match (tree.next(parent), tree.parent(parent)) {
                (Some(next), _) => tags.needs_to_borrow_prev_closing_tag_end_marker(next),
                (None, Some(outer)) => {
                    tags.needs_to_borrow_last_child_closing_tag_end_marker(outer)
                }
                (None, None) => false,
            };
            let attempt = self.out.start_attempt();
            self.out.break_parent();
            self.out.built_text(|out| tags.opening_tag_prefix(id, out));
            let short_cuts = self.out.f.context_mut().short_cuts.mode;
            if lends_end_of_closing_tag {
                self.out.f.context_mut().short_cuts.mode = Default::default();
            }
            let is_written = self.text_to_doc(value, parser, source_type);
            self.out.f.context_mut().short_cuts.mode = short_cuts;
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
        let lends_closing_braces = tree
            .next(parent)
            .is_some_and(|next| tags.needs_to_borrow_prev_closing_tag_end_marker(next));
        let attempt = self.out.start_attempt();
        self.out.start_indent();
        self.out.line();
        let is_written = match self.options.parser {
            Parser::Angular => self.write_angular_expression(value, in_html, Hug::Bare),
            Parser::Vue
                if !lends_closing_braces && self.is_printed_as_written_between_braces(value) =>
            {
                self.out.text(value.trim_ascii());
                true
            }
            Parser::Vue
                if !lends_closing_braces
                    && let Some(quote) = self.quote_printed_between_braces(value) =>
            {
                self.out.built_text(|out| {
                    out.extend(value.trim_ascii().iter().map(|&byte| match byte {
                        b'"' | b'\'' => quote,
                        _ => byte,
                    }));
                });
                true
            }
            _ => {
                let is_typescript =
                    self.options.parser == Parser::Vue && self.is_vue_sfc_with_typescript_script();
                (self.options.parser == Parser::Vue
                    && !lends_closing_braces
                    && self.write_interpolation_quickly(value, is_typescript))
                    || self.out.foreign(|f| {
                        js::write_expression(f, value, is_typescript, in_html, Hug::Bare)
                    })
            }
        };
        self.out.end_indent();
        match lends_closing_braces {
            true => self.out.token(" "),
            false => self.out.line(),
        }
        self.out.end_attempt(attempt, is_written)
    }

    /// True if short cuts can be taken, and an attribute of `element` that is `width` columns wide on one line is printed
    /// on one line: the start tag is either on one line, with all that is in it, or the attribute is on a line of its own
    /// at the current indentation, which has room for it.
    pub(crate) fn has_room_on_line_of_its_own(&self, element: Id, width: usize) -> bool {
        let format = self.options.format;
        // The end of the tag can be on the line of the last attribute, and so can what is in a `<pre>`.
        let ends_on_line_of_its_own = !format.bracket_same_line.value()
            && !is_pre_like(&self.tree[element])
            && !(self.tree[element].has(Flags::IS_SELF_CLOSING)
                && self.tree.parent(element).is_some_and(|parent| {
                    self.tags()
                        .needs_to_borrow_last_child_closing_tag_end_marker(parent)
                }));
        !format.no_short_cuts
            && ends_on_line_of_its_own
            && (self.out.indentation_width()).is_some_and(|indentation| {
                indentation + width <= format.line_width.value() as usize
            })
    }

    /// True if the expression `code` is printed as it is written, so that nobody has to parse it. It is either on one
    /// line with its braces, or on a line of its own at the current indentation, given that a `line` follows it.
    fn is_printed_as_written_between_braces(&self, code: &[u8]) -> bool {
        let (format, code) = (self.options.format, code.trim_ascii());
        self.has_room_between_braces(code)
            && canonical::expression_end(code, 0, Spelling::new(format)) == Some(code.len())
    }

    fn has_room_between_braces(&self, code: &[u8]) -> bool {
        let format = self.options.format;
        !format.no_short_cuts
            && self.out.indentation_width().is_some_and(|indentation| {
                indentation + code.len() <= format.line_width.value() as usize
            })
    }

    /// The same for an expression that is printed as it is written but for its quotes: returns the quote that is printed.
    fn quote_printed_between_braces(&self, code: &[u8]) -> Option<u8> {
        let code = code.trim_ascii();
        let spelling = Spelling::new(self.options.format);
        let (end, quote) = canonical::expression_end_in_other_quotes(code, 0, spelling)?;
        (end == code.len() && self.has_room_between_braces(code)).then_some(quote)
    }

    // ───────────────────────────── `embed/attribute.js` ─────────────────────────────

    /// `createAttributePrinter`: writes the attribute with the value that `write_value` writes, unless `write_value`
    /// returns `false` or writes nothing.
    pub(crate) fn print_attribute_with(
        &mut self,
        attr: &Attribute<'_>,
        write_value: impl FnOnce(&mut Self) -> bool,
    ) -> bool {
        let attempt = self.out.start_attribute_value();
        // The quotes in the value are written as entities afterwards, so nothing in it is as wide as it's written.
        let short_cuts = std::mem::take(&mut self.out.f.context_mut().short_cuts.mode);
        let is_written = write_value(self);
        self.out.f.context_mut().short_cuts.mode = short_cuts;
        self.print_attribute_with_attempt(attr, attempt, is_written)
    }

    /// `attempt` is the attempt that the value was written in, and `is_written` tells whether that succeeded.
    fn print_attribute_with_attempt(
        &mut self,
        attr: &Attribute<'_>,
        attempt: Attempt,
        is_written: bool,
    ) -> bool {
        let Some(value) = self.out.end_attribute_value(attempt, is_written) else {
            return false;
        };
        // The comment would be printed after the closing quote, as Prettier does with `v-for="a in b // c"`. Leave the
        // value as is.
        if self.out.ends_with_line_suffix(value) {
            return false;
        }
        self.write_raw_name(attr.raw_name());
        self.out.token("=\"");
        self.out.start_group();
        self.out.attribute_value(value);
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

    /// `printAttribute`. Returns true if it wrote the attribute.
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
                // What is printed as it is written needs no parser, as in `is_printed_as_written` for Vue.
                b"style"
                    if is_plain
                        && value.len() == raw_value.len()
                        && self.has_room_on_line_of_its_own(element, 5 + 3 + value.len())
                        && canonical::is_style(value) =>
                {
                    return false;
                }
                b"style" if is_plain => {
                    return self.print_attribute_with(attr, |printer| printer.print_style(value));
                }
                // In a Vue file oxfmt replaces the `babel` parser no matter what it's called for, so the handler is
                // formatted like any script. Prettier, which can't see what's inside, hugs the result.
                name if is_plain
                    && data::is_event_attribute(name)
                    && self.options.script_flavor.is_oxfmt() =>
                {
                    return self.print_attribute_with(attr, |printer| {
                        printer.text_to_doc(value, b"babel", SourceType::Unknown)
                    });
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
                        printer.out.text(&class_names(value));
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
            // Under `v-pre`, Vue treats it as a plain attribute, not code. Prettier formats it anyway.
            Parser::Vue if self.tree[element].has(Flags::IS_IN_V_PRE) => false,
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
            .map(|candidate| strings::wtf8_len_utf16(candidate.url) as usize)
            .max()
            .unwrap_or(0);
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
                let alignment = max_url_len - strings::wtf8_len_utf16(candidate.url) as usize
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
            printer.out.style_sheet(&document);
            true
        })
    }

    /// `printPermissionsPolicy`
    fn print_permissions_policy(&mut self, value: &[u8]) -> bool {
        let directives = || {
            strings::split(value, b";")
                .map(<[u8]>::trim_ascii)
                .filter(|token| !token.is_empty())
        };
        let count = directives().count();
        if count == 0 {
            // Prints the attribute with empty quotes.
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
