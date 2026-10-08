//! HTML in the templates of JavaScript: Prettier's `language-js/embed/html.js`.
//!
//! The text that is formatted has a placeholder in the place of every substitution. Its document is captured, and
//! written once more with the substitutions in the place of the placeholders.

use super::Parser;
use super::js::write_string;
use super::map_strings::{MapString, write_mapped};
use crate::css::text;
use crate::ir::element::{Group, Interned, LineMode};
use crate::js::print::template::write_embedded_template_expression;
use crate::options::{HtmlRoot, HtmlWhitespaceSensitivity};
use crate::prelude::*;
use bun_core::strings;
use smallvec::SmallVec;

const PLACEHOLDER_START: &[u8] = b"PRETTIER_HTML_PLACEHOLDER_";
const PLACEHOLDER_END: &[u8] = b"_IN_JS";

/// `isAngularComponentTemplate`: `` @Component({ template: `..` }) ``. `e`: a template.
pub(crate) fn is_angular_component_template(e: Expr<'_>) -> bool {
    crate::css::embed::is_angular_component_property(e.ast_parent(), b"template")
}

/// The parser for the text of the template `e`, if `embed` takes it for HTML.
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
    let has_tag = matches!(parent, AstNodes::TaggedTemplateExpression(tagged)
        if matches!(tagged.kind(), ExprKind::TaggedTemplate(call)
            if call.callee() != e && matches!(call.callee().kind(), ExprKind::Ident(_)) && call.callee().text() == b"html"));
    let parser = if has_tag || crate::graphql::embed::has_language_comment(e, parent, b" HTML ", f)
    {
        Parser::Html
    } else if is_angular_component_template(e) {
        Parser::Angular
    } else {
        return None;
    };
    // These come first.
    let is_in_another_language =
        crate::css::embed::is_embed_css(e) || crate::graphql::embed::is_embed_graphql(e, f);
    (!is_in_another_language
        && (0..template.quasi_count()).all(|index| template.cooked(index).is_some()))
    .then_some(parser)
}

fn is_blank(template: Template<'_>) -> bool {
    template.quasi_count() == 1 && text::trim(template.raw(0)).is_empty()
}

/// The text of `template`, with placeholders. `counter`: what tells them from those of a template that this one is in
/// the text of.
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
    match strings::contains_char(&text, b'\r') {
        true => crate::css::normalize_end_of_line(&text).into_owned(),
        false => text,
    }
}

/// The line break between the backticks and the text. `None`: there is none.
fn line_around(text: &[u8], options: &FormatOptions) -> Option<LineMode> {
    if options.html_whitespace_sensitivity == HtmlWhitespaceSensitivity::Ignore {
        return Some(LineMode::Hard);
    }
    (text::starts_with_white_space(text) && text::trim_end(text).len() < text.len())
        .then_some(LineMode::SoftOrSpace)
}

/// What the label of the document of a template says.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Label {
    /// `{ embed: true }`
    Embed,
    /// `{ embed: true, hug: false }`
    EmbedWithoutHug,
}

/// The label of the document of `e`, if that is a template, with or without a tag, that is written as HTML and is more
/// than ` `` `.
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
    super::can_be_parsed(&text, parser).then(|| match line_around(&text, f.options()) {
        Some(_) => Label::Embed,
        None => Label::EmbedWithoutHug,
    })
}

/// The callback of the `mapDoc` in `printEmbedHtmlLike`.
struct Substitutions<'e> {
    /// The documents of the substitutions.
    expressions: &'e [Interned],
    /// `_`, the counter and the end of a placeholder.
    placeholder_end: Vec<u8>,
    /// `__embeddedInHtml`: the end tag of a script would end the script that the template is in.
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
            .is_some_and(|&byte| text::is_word_character(byte))
}

impl Substitutions<'_> {
    /// Where the first placeholder in `text` starts and ends, and its number.
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
        strings::index_of_any(text, b"\\`").is_some()
            || strings::contains(text, b"${")
            || (self.is_in_html && strings::contains(text, b"</"))
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
        self.needs_escapes(text) || self.find_placeholder(text).is_some()
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

/// Writes the template `e` as HTML, if that is what Prettier takes it for: `printEmbedHtmlLike`. Returns whether it
/// has. If the text cannot be parsed, it has not.
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
    let options = FormatOptions {
        html_template_depth: counter.saturating_add(1),
        parser: None,
        filepath: None,
        range_start: None,
        range_end: None,
        cursor_offset: None,
        ..f.options().clone()
    };
    let slot = f.start_capture();
    let written = super::write_document(&text, parser, None, &options, true, None, f);
    let document = f.end_capture(slot);
    let Ok(top_level_count) = written else {
        return false;
    };
    // In the order of the source, whatever the order of the placeholders: that of the comments.
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
    let line = line_around(&text, &options);
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
        None if text::trim_end(&text).len() < text.len() => f.write_token(" "),
        None => {}
    }
    f.write_token("`");
    tag(Tag::EndGroup, f);
    true
}
