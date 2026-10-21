//! HTML in JavaScript templates: Prettier's `language-js/embed/html.js`.
//!
//! The formatted text has a placeholder instead of each substitution. Its document is captured and then written again
//! with the substitutions in place of the placeholders.

use super::Parser;
use super::ast::{Flags, Kind, Tree};
use super::js::write_string;
use super::map_strings::{MapString, write_mapped};
pub(crate) use super::utilities::is_placeholder_in_js;
use crate::css::embed::is_blank;
use crate::ir::element::{Group, Interned, LineMode};
use crate::ir::printer::PrinterOptions;
use crate::js::context::JsFormatContext;
use crate::js::print::template::write_embedded_template_expression;
use crate::options::{HtmlRoot, HtmlWhitespaceSensitivity, LineEnding};
use crate::prelude::*;
use crate::text;
use bun_core::strings;
use smallvec::SmallVec;

pub(crate) const PLACEHOLDER_START: &[u8] = b"PRETTIER_HTML_PLACEHOLDER_";
const PLACEHOLDER_END: &[u8] = b"_IN_JS";

/// `isAngularComponentTemplate`: `` @Component({ template: `..` }) ``. `parent` is the template's parent.
fn is_angular_component_template(parent: AstNodes<'_>) -> bool {
    crate::css::embed::is_angular_component_property(parent, b"template")
}

/// `` html`..` ``. `e` is a template and `parent` is its parent.
fn has_html_tag<'a>(e: Expr<'a>, parent: AstNodes<'a>) -> bool {
    matches!(parent, AstNodes::TaggedTemplateExpression(tagged)
        if matches!(tagged.kind(), ExprKind::TaggedTemplate(call)
            if call.callee() != e && matches!(call.callee().kind(), ExprKind::Ident(_)) && call.callee().text() == b"html"))
}

/// True if the template `e` might be formatted as HTML. Of the comments that mark a template as HTML, this only
/// recognizes one right before the template.
pub(crate) fn can_be_html(e: Expr<'_>) -> bool {
    let mut before = e
        .file()
        .text()
        .get(..e.span().start as usize)
        .unwrap_or_default()
        .trim_ascii_end();
    while let Some(outside) = before.strip_suffix(b"(") {
        before = outside.trim_ascii_end();
    }
    let parent = e.ast_parent();
    has_html_tag(e, parent)
        || is_angular_component_template(parent)
        || before.ends_with(b"/* HTML */")
}

/// Returns the parser for the text of the template `e`, if `embed` treats it as HTML.
fn parser_of<'a>(e: Expr<'a>, template: Template<'a>, f: &Formatter<'a>) -> Option<Parser> {
    if !f.options().embedded_html
        || !matches!(
            f.options().embedded_language_formatting,
            EmbeddedLanguageFormatting::Auto
        )
    {
        return None;
    }
    let parent = e.ast_parent();
    let parser = if has_html_tag(e, parent)
        || crate::graphql::embed::has_language_comment(e, parent, b" HTML ", f)
    {
        Parser::Html
    } else if is_angular_component_template(parent) {
        Parser::Angular
    } else {
        return None;
    };
    // CSS and GraphQL take precedence.
    let is_in_another_language =
        crate::css::embed::is_embed_css(e) || crate::graphql::embed::is_embed_graphql(e, f);
    (!is_in_another_language
        && (0..template.quasi_count()).all(|index| template.cooked(index).is_some()))
    .then_some(parser)
}

/// Returns the text of `template` with placeholders. `counter` distinguishes them from the placeholders of an outer
/// template whose text contains this one.
fn text_with_placeholders(template: Template<'_>, counter: u32) -> Vec<u8> {
    let mut text = Vec::new();
    for index in 0..template.quasi_count() {
        if index > 0 {
            text.extend_from_slice(PLACEHOLDER_START);
            text.extend_from_slice((index - 1).to_string().as_bytes());
            text.push(b'_');
            text.extend_from_slice(counter.to_string().as_bytes());
            text.extend_from_slice(PLACEHOLDER_END);
        }
        text.extend_from_slice(
            template
                .cooked(index)
                .map_or(&[][..], |cooked| cooked.bytes()),
        );
    }
    // An escape can produce a lone surrogate, which becomes U+FFFD once Prettier's output is written as UTF-8.
    let mut from = 0;
    while let Some(at) = strings::index_of_char_pos(&text, 0xED, from) {
        if text.get(at + 1).is_some_and(|&byte| byte >= 0xA0)
            && let Some(half) = text.get_mut(at..at + 3)
        {
            half.copy_from_slice("\u{FFFD}".as_bytes());
        }
        from = at + 1;
    }
    match strings::contains_char(&text, b'\r') {
        true => bun_core::strings::crlf_as_lf(&text).into_owned(),
        false => text,
    }
}

/// Returns the line break between the backticks and the text, or `None` if there's none.
fn surrounding_line(text: &[u8], options: &FormatOptions) -> Option<LineMode> {
    if options.html_whitespace_sensitivity == HtmlWhitespaceSensitivity::Ignore {
        return Some(LineMode::Hard);
    }
    (text::starts_with_white_space(text)
        && strings::trim_js_whitespace_end(text).len() < text.len())
    .then_some(LineMode::SoftOrSpace)
}

/// Returns the number of `indent`s around the line that `e` starts on, assuming the file is already indented the way
/// it's going to be.
fn indent_level_in_source<'a>(e: Expr<'a>, options: &FormatOptions, f: &Formatter<'a>) -> u32 {
    let start = e.span().start;
    // A file that's one long line has its templates visited in order, so resume from the last search instead of
    // rescanning the line.
    let (known_at, known) = f.context().line_start.get();
    let from = if known_at <= start { known_at } else { 0 };
    let text = e.file().text();
    let searched = text.get(from as usize..start as usize).unwrap_or_default();
    let line_start = match strings::last_index_of_any(searched, b"\n\r") {
        Some(at) => from + at as u32 + 1,
        None if from == 0 => 0,
        None => known,
    };
    f.context().line_start.set((start, line_start));
    let indent_width = options.indent_width.value().max(1);
    let mut columns = 0;
    for byte in text
        .get(line_start as usize..start as usize)
        .unwrap_or_default()
    {
        match byte {
            b' ' => columns += 1,
            b'\t' => columns += indent_width,
            _ => break,
        }
    }
    columns / indent_width
}

/// The label on a template's document.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Label {
    /// `{ embed: true }`
    Embed,
    /// `{ embed: true, hug: false }`
    EmbedWithoutHug,
}

/// Returns the label on `e`'s document if `e` is a template, tagged or not, that's formatted as HTML and isn't just
/// ` `` `.
pub(crate) fn label<'a>(e: Expr<'a>, f: &Formatter<'a>) -> Option<Label> {
    let quasi = match e.kind() {
        ExprKind::TaggedTemplate(call) => call.template(),
        _ => Some(e),
    };
    let (quasi, ExprKind::Template(template)) = quasi.map(|quasi| (quasi, quasi.kind()))? else {
        return None;
    };
    let parser = parser_of(quasi, template, f).filter(|_| !is_blank(template))?;
    let text = text_with_placeholders(template, f.options().html_template_depth);
    super::can_be_parsed(&text, parser).then(|| match surrounding_line(&text, f.options()) {
        Some(_) => Label::Embed,
        None => Label::EmbedWithoutHug,
    })
}

/// The callback of the `mapDoc` in `printEmbedHtmlLike`.
struct Substitutions<'e> {
    /// The substitutions' documents.
    expressions: &'e [Interned],
    /// `_`, the counter and the end of a placeholder.
    placeholder_end: Vec<u8>,
    /// `__embeddedInHtml`: a script's end tag would end the script that contains the template.
    is_in_html: bool,
}

/// `/^<\/(?=script\b)/i.test(text)`
fn starts_with_end_of_script(text: &[u8]) -> bool {
    text.starts_with(b"</")
        && text
            .get(2..8)
            .is_some_and(|name| name.eq_ignore_ascii_case(b"script"))
        && !text
            .get(8)
            .is_some_and(|&byte| strings::is_regexp_word_byte(byte))
}

impl Substitutions<'_> {
    /// Returns the start, the end and the number of the first placeholder in `text`.
    fn find_placeholder(&self, text: &[u8]) -> Option<(usize, usize, usize)> {
        let mut from = 0;
        while let Some(start) = text::index_of_from(text, PLACEHOLDER_START, from) {
            let digits_start = start + PLACEHOLDER_START.len();
            let digits = text[digits_start..]
                .iter()
                .take_while(|byte| byte.is_ascii_digit())
                .count();
            let end = digits_start + digits;
            if digits > 0 && text[end..].starts_with(&self.placeholder_end) {
                let number = text[digits_start..end]
                    .iter()
                    .fold(0usize, |number, digit| {
                        number
                            .saturating_mul(10)
                            .saturating_add(usize::from(digit - b'0'))
                    });
                return Some((start, end + self.placeholder_end.len(), number));
            }
            from = digits_start;
        }
        None
    }

    fn needs_escapes(&self, text: &[u8]) -> bool {
        strings::index_of_any(text, b"\\`$").is_some()
            || (self.is_in_html && strings::contains_char(text, b'<'))
    }

    /// Writes `text`, which is between placeholders: `uncookTemplateElementValue`.
    fn write_text(&self, text: &[u8], is_one_string: bool, f: &mut Formatter<'_>) {
        if text.is_empty() {
            return;
        }
        let escaped;
        let text = match self.needs_escapes(text) {
            false => text,
            true => {
                let mut with_escapes = Vec::with_capacity(text.len() + 8);
                for (index, &byte) in text.iter().enumerate() {
                    match byte {
                        b'\\' | b'`' => with_escapes.push(b'\\'),
                        b'$' if text.get(index + 1) == Some(&b'{') => with_escapes.push(b'\\'),
                        b'/' if self.is_in_html
                            && index > 0
                            && starts_with_end_of_script(&text[index - 1..]) =>
                        {
                            with_escapes.push(b'\\')
                        }
                        _ => {}
                    }
                    with_escapes.push(byte);
                }
                escaped = with_escapes;
                &escaped[..]
            }
        };
        match is_one_string {
            true => write_string(text, f),
            false => f.write_text(text, None),
        }
    }
}

impl MapString for Substitutions<'_> {
    fn changes(&self, text: &[u8]) -> bool {
        self.needs_escapes(text) || strings::contains(text, PLACEHOLDER_START)
    }

    fn write(&mut self, text: &[u8], is_one_string: bool, f: &mut Formatter<'_>) {
        let mut rest = text;
        while let Some((start, end, number)) = self.find_placeholder(rest) {
            self.write_text(&rest[..start], is_one_string, f);
            if let Some(&expression) = self.expressions.get(number) {
                f.write_element(FormatElement::Interned(expression));
            }
            rest = &rest[end..];
        }
        self.write_text(rest, is_one_string, f);
    }
}

/// True if an element of `tree` with a substitution in its name has no end tag. Prettier would add one: it turns
/// `<${a}>b` into `<${a}>b</${a}>`, which evaluates `a` twice. Such a template is left as it is.
pub(super) fn would_repeat_substitution(tree: &Tree<'_>) -> bool {
    tree.nodes.iter().any(|node| {
        node.kind == Kind::Element
            && !(node.flags).intersects(Flags::IS_SELF_CLOSING | Flags::HAS_END_SPAN)
            && node.name.len() > PLACEHOLDER_START.len()
            && strings::contains(&node.name.to_ascii_uppercase(), PLACEHOLDER_START)
    })
}

/// True if `document`, the result of formatting `text`, still has the same number of substitutions. If not, oxfmt
/// leaves the template as it is.
fn keeps_substitution_count(
    text: &[u8],
    document: Interned,
    options: &FormatOptions,
    f: &Formatter<'_>,
) -> bool {
    let printer_options = PrinterOptions {
        line_ending: LineEnding::Lf,
        marks_line_breaks_in_texts: false,
        ..PrinterOptions::new(options, text)
    };
    let (source, mut printed) = (f.source_text().as_bytes(), Vec::new());
    crate::ir::printer::print(
        document,
        &f.storage,
        source,
        printer_options,
        &mut Default::default(),
        &mut printed,
    )
    .is_ok()
        && strings::split(text, PLACEHOLDER_START).count()
            == strings::split(&printed, PLACEHOLDER_START).count()
}

/// Writes the template `e` as HTML if Prettier treats it as HTML: `printEmbedHtmlLike`. Returns true if it did, and
/// false if the text can't be parsed.
pub(crate) fn write_template<'a>(
    e: Expr<'a>,
    template: Template<'a>,
    f: &mut Formatter<'a>,
) -> bool {
    let Some(parser) = parser_of(e, template, f) else {
        return false;
    };
    if is_blank(template) {
        f.write_token("``");
        return true;
    }
    let counter = f.options().html_template_depth;
    let text = text_with_placeholders(template, counter);
    let text = match f.options().tailwind.as_deref() {
        Some(how) => {
            let parse = super::js::Parse::new(f.context().parse_javascript, f.options());
            super::tailwind::with_sorted_classes(&text, parser, how, parse).unwrap_or(text)
        }
        None => text,
    };
    let options = FormatOptions {
        html_template_depth: counter.saturating_add(1),
        parser: None,
        filepath: Some(f.filepath().into()),
        range_start: None,
        range_end: None,
        cursor_offset: None,
        ..super::options_of_host(f.options(), parser)
    };
    let line = surrounding_line(&text, &options);
    // The printer decides where the lines start. But languages that are printed separately (JSON, YAML, ..) need to
    // know the available width up front, so assume the indentation the file would have if it had been formatted before.
    let indent_level = indent_level_in_source(e, &options, f) + u32::from(line.is_some());
    let slot = f.start_capture();
    // The code in the text is written with the formatter's options.
    let context = JsFormatContext::without_file(options.clone(), &crate::js::comments::NO_COMMENTS);
    // This is all that's ever checked about the file name.
    let path = options.is_in_html_file.then_some(&b".html"[..]);
    let write_result = f.write_embedded(context, &text, |f| {
        super::write_document(&text, parser, path, &options, true, Some(indent_level), f)
    });
    let document = f.end_capture(slot);
    let Ok(top_level_count) = write_result else {
        return false;
    };
    // Both tools format the HTML with Prettier's options.
    if f.options().flavor.is_oxfmt() && !keeps_substitution_count(&text, document, &options, f) {
        return false;
    }
    // Written in source order, whatever the order of the placeholders, because comments are consumed in that order.
    let expressions: SmallVec<[Interned; 8]> = (0..template.quasi_count().saturating_sub(1))
        .map(|index| {
            f.capture(&format_with(|f| {
                write_embedded_template_expression(template, index, f)
            }))
        })
        .collect();
    let mut substitutions = Substitutions {
        expressions: &expressions,
        placeholder_end: [b"_", counter.to_string().as_bytes(), PLACEHOLDER_END].concat(),
        is_in_html: f.options().in_html.root != HtmlRoot::None,
    };

    let tag = |tag: Tag, f: &mut Formatter<'a>| f.write_element(FormatElement::Tag(tag));
    let is_indented = line.is_some() || top_level_count > 1;
    tag(Tag::StartGroup(Group::new()), f);
    f.write_token("`");
    if line.is_none() && text::starts_with_white_space(&text) {
        f.write_token(" ");
    }
    if is_indented {
        tag(Tag::StartIndent, f);
    }
    if let Some(mode) = line {
        f.write_element(FormatElement::Line(mode));
    }
    tag(Tag::StartGroup(Group::new()), f);
    write_mapped(document, &mut substitutions, f);
    tag(Tag::EndGroup, f);
    if is_indented {
        tag(Tag::EndIndent, f);
    }
    match line {
        Some(mode) => f.write_element(FormatElement::Line(mode)),
        None if strings::trim_js_whitespace_end(&text).len() < text.len() => f.write_token(" "),
        None => {}
    }
    f.write_token("`");
    tag(Tag::EndGroup, f);
    true
}
