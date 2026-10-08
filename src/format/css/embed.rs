//! Style sheets in the templates of JavaScript: Prettier's `language-js/embed/index.js` and `css.js`.

use super::doc::{self, Doc, Line};
use super::text;
use crate::ir::element::{Condition, Group, GroupMode, LineMode, PrintMode, TextWidth};
use crate::js::print::template::write_embedded_template_expression;
use crate::prelude::*;

const PLACEHOLDER: &[u8] = b"@prettier-placeholder-";

/// `/@prettier-placeholder-(\d+)-id/`: where the first match in `text` starts and ends, and the
/// number.
fn find_placeholder(text: &[u8]) -> Option<(usize, usize, usize)> {
    let mut from = 0;
    while let Some(start) = text::index_of_from(text, PLACEHOLDER, from) {
        let digits_start = start + PLACEHOLDER.len();
        let digits = text[digits_start..].iter().take_while(|b| b.is_ascii_digit()).count();
        let end = digits_start + digits;
        if digits > 0 && text[end..].starts_with(b"-id") {
            let number = text[digits_start..end].iter().fold(0usize, |number, digit| {
                number.saturating_mul(10).saturating_add(usize::from(digit - b'0'))
            });
            return Some((start, end + 3, number));
        }
        from = digits_start;
    }
    None
}

/// How many placeholders are in the strings of `doc`, or `None` if one of them has a number that is
/// not below `count`.
fn count_placeholders(doc: &Doc<'_>, count: usize) -> Option<usize> {
    match doc {
        Doc::Text(text) => {
            let (mut found, mut rest) = (0, &text[..]);
            while let Some((_, end, number)) = find_placeholder(rest) {
                if number >= count {
                    return None;
                }
                found += 1;
                rest = &rest[end..];
            }
            Some(found)
        }
        Doc::Array(parts) | Doc::Fill(parts) => parts.iter().try_fold(0, |all, part| Some(all + count_placeholders(part, count)?)),
        Doc::Indent(contents) | Doc::Dedent(contents) | Doc::LineSuffix(contents) | Doc::Group { contents, .. } => {
            count_placeholders(contents, count)
        }
        Doc::IfBreak {
            break_contents,
            flat_contents,
        } => Some(count_placeholders(break_contents, count)? + count_placeholders(flat_contents, count)?),
        Doc::LineSuffixBoundary | Doc::BreakParent | Doc::Line(_) => Some(0),
    }
}

struct Writer<'a> {
    has_placeholders: bool,
    template: Template<'a>,
}

impl<'a> Writer<'a> {
    /// A string in which a line break is nothing but a character without a width, as it is for
    /// Prettier.
    fn write_string(&mut self, text: &[u8], f: &mut Formatter<'a>) {
        if text.is_empty() {
            return;
        }
        let width = match TextWidth::from_text(text, 0) {
            width if !width.is_multiline() => width,
            _ => TextWidth::multiline(
                bun_core::strings::split(text, b"\n").map(|line| TextWidth::from_text(line, 0).value()).sum(),
            ),
        };
        f.write_text(text, Some(width));
    }

    /// `replaceEndOfLine(text)`
    fn write_with_literal_lines(&mut self, text: &[u8], f: &mut Formatter<'a>) {
        if text.is_empty() {
            return;
        }
        f.write_text(text, None);
        if bun_core::strings::contains_char(text, b'\n') {
            f.write_element(FormatElement::ExpandParent);
        }
    }

    fn write_between(&mut self, start: Tag, contents: &Doc<'_>, end: Tag, f: &mut Formatter<'a>) {
        f.write_element(FormatElement::Tag(start));
        self.write(contents, f);
        f.write_element(FormatElement::Tag(end));
    }

    fn write(&mut self, doc: &Doc<'_>, f: &mut Formatter<'a>) {
        match doc {
            Doc::Text(text) if !self.has_placeholders => self.write_string(text, f),
            Doc::Text(text) => {
                let mut rest = &text[..];
                while let Some((start, end, number)) = find_placeholder(rest) {
                    self.write_with_literal_lines(&rest[..start], f);
                    write_embedded_template_expression(self.template, number, f);
                    rest = &rest[end..];
                }
                self.write_with_literal_lines(rest, f);
            }
            Doc::Array(parts) => {
                let mut index = 0;
                while let Some(part) = parts.get(index) {
                    // Two line breaks in a row are an empty line.
                    if let [Doc::Line(Line::Hard), Doc::BreakParent, Doc::Line(Line::Hard), Doc::BreakParent, ..] = parts[index..] {
                        f.write_element(FormatElement::Line(LineMode::Empty));
                        index += 4;
                        continue;
                    }
                    self.write(part, f);
                    index += 1;
                }
            }
            Doc::Indent(contents) => self.write_between(Tag::StartIndent, contents, Tag::EndIndent, f),
            Doc::Dedent(contents) => {
                use crate::ir::element::DedentMode::Level;
                self.write_between(Tag::StartDedent(Level), contents, Tag::EndDedent(Level), f);
            }
            Doc::Group {
                contents,
                should_break,
            } => {
                let mode = if *should_break { GroupMode::Expand } else { GroupMode::Flat };
                self.write_between(Tag::StartGroup(Group::new().with_mode(mode)), contents, Tag::EndGroup, f);
            }
            Doc::Fill(parts) => {
                f.write_element(FormatElement::Tag(Tag::StartFill));
                for part in parts {
                    self.write_between(Tag::StartEntry, part, Tag::EndEntry, f);
                }
                f.write_element(FormatElement::Tag(Tag::EndFill));
            }
            Doc::IfBreak {
                break_contents,
                flat_contents,
            } => {
                for (mode, contents) in [(PrintMode::Expanded, break_contents), (PrintMode::Flat, flat_contents)] {
                    if !contents.is_empty_text() {
                        let start = Tag::StartConditionalContent(Condition::new(mode));
                        self.write_between(start, contents, Tag::EndConditionalContent, f);
                    }
                }
            }
            Doc::LineSuffix(contents) => self.write_between(Tag::StartLineSuffix, contents, Tag::EndLineSuffix, f),
            Doc::LineSuffixBoundary => f.write_element(FormatElement::LineSuffixBoundary),
            Doc::BreakParent => f.write_element(FormatElement::ExpandParent),
            Doc::Line(Line::Space) => f.write_element(FormatElement::Line(LineMode::SoftOrSpace)),
            Doc::Line(Line::Soft) => f.write_element(FormatElement::Line(LineMode::Soft)),
            Doc::Line(Line::Hard) => f.write_element(FormatElement::Line(LineMode::Hard)),
            Doc::Line(Line::Literal) => f.write_text(b"\n", None),
        }
    }
}

/// What is done with the document of a template.
enum Action<'w, 'a> {
    /// Only whether there is one is asked.
    Check,
    Write(&'w mut Formatter<'a>),
}

/// Prettier's `printEmbedCss`. Nothing is written and `false` is returned if the text cannot be parsed
/// as SCSS, or if not every substitution is in the document exactly once.
fn print_embed_css<'a>(template: Template<'a>, options: &FormatOptions, action: Action<'_, 'a>) -> bool {
    let count = template.quasi_count().saturating_sub(1);
    let mut text = Vec::new();
    for index in 0..template.quasi_count() {
        if index > 0 {
            text.extend_from_slice(PLACEHOLDER);
            text.extend_from_slice((index - 1).to_string().as_bytes());
            text.extend_from_slice(b"-id");
        }
        text.extend_from_slice(template.raw(index));
    }
    let text = super::normalize_end_of_line(&text);
    let result = super::parse_and_print(&text, super::Parser::Scss, options, |document| {
        let document = doc::strip_trailing_hardline(doc::clean(document));
        if count > 0 && count_placeholders(&document, count) != Some(count) {
            return false;
        }
        if let Action::Write(f) = action {
            f.write_token("`");
            f.write_element(FormatElement::Tag(Tag::StartIndent));
            f.write_element(FormatElement::Line(LineMode::Hard));
            let mut writer = Writer {
                has_placeholders: count > 0,
                template,
            };
            writer.write(&document, f);
            f.write_element(FormatElement::Tag(Tag::EndIndent));
            f.write_element(FormatElement::Line(LineMode::Soft));
            f.write_token("`");
        }
        true
    });
    result == Ok(true)
}

fn is_identifier(e: Expr<'_>, name: &[u8]) -> bool {
    matches!(e.kind(), ExprKind::Ident(_)) && e.text() == name
}

/// The object of `e`, if it is a `MemberExpression`.
fn member_object(e: Expr<'_>) -> Option<Expr<'_>> {
    match e.as_ast_nodes() {
        AstNodes::StaticMemberExpression(_) | AstNodes::ComputedMemberExpression(_) => e.object(),
        _ => None,
    }
}

/// The callee of `e`, if it is a `CallExpression`.
fn call_callee(e: Expr<'_>) -> Option<Expr<'_>> {
    match e.as_ast_nodes() {
        AstNodes::CallExpression(_) => e.callee(),
        _ => None,
    }
}

/// `Component.extend`
fn is_styled_extend(e: Expr<'_>) -> bool {
    matches!(e.kind(), ExprKind::Dot { obj, name, .. }
        if member_object(e).is_some()
            && name.bytes() == b"extend"
            && matches!(obj.kind(), ExprKind::Ident(_))
            && obj.text().first().is_some_and(u8::is_ascii_uppercase))
}

fn is_styled_object(e: Expr<'_>) -> bool {
    member_object(e).is_some_and(|object| is_identifier(object, b"styled")) || is_styled_extend(e)
}

/// `isStyledComponents`, and the first half of `isStyledJsx`. `tag`: of the template.
fn is_styled_tag(tag: Expr<'_>) -> bool {
    // css``, css.global``, css.resolve``
    if is_identifier(tag, b"css") {
        return true;
    }
    if let ExprKind::Dot { obj, name, .. } = tag.kind()
        && member_object(tag).is_some()
        && is_identifier(obj, b"css")
        && matches!(name.bytes(), b"global" | b"resolve")
    {
        return true;
    }
    // styled.foo``, Component.extend``
    if is_styled_object(tag) {
        return true;
    }
    let Some(callee) = call_callee(tag) else {
        return false;
    };
    // styled(Component)``
    is_identifier(callee, b"styled")
        || member_object(callee).is_some_and(|object| {
            // styled.foo.attrs({})``, Component.extend.attrs({})``, styled(Component).attrs({})``
            is_styled_object(object) || call_callee(object).is_some_and(|callee| is_identifier(callee, b"styled"))
        })
}

fn has_name(prop: Prop<'_>, name: &[u8]) -> bool {
    matches!(prop.key().map(|key| key.kind()), Some(KeyKind::Ident(key)) if key.bytes() == name)
}

/// `isAngularComponentStyles`: `@Component({ styles: [`..`] })`. `parent`: of the template.
fn is_angular_component_styles(parent: AstNodes<'_>) -> bool {
    let property = match parent {
        AstNodes::ArrayExpression(_) => parent.parent(),
        _ => parent,
    };
    let AstNodes::ObjectProperty(prop) = property else {
        return false;
    };
    if !has_name(prop, b"styles") || prop.kind() != PropKind::Init {
        return false;
    }
    let AstNodes::ObjectExpression(object) = property.parent() else {
        return false;
    };
    let call = property.parent().parent();
    matches!(call, AstNodes::CallExpression(call)
        if call.callee().is_some_and(|callee| callee != object && is_identifier(callee, b"Component")))
        && matches!(call.parent(), AstNodes::Decorator(_))
}

/// Prettier's `isEmbedCss`. `e`: a template.
pub(crate) fn is_embed_css(e: Expr<'_>) -> bool {
    let parent = e.ast_parent();
    match parent {
        AstNodes::TaggedTemplateExpression(tagged) => {
            matches!(tagged.kind(), ExprKind::TaggedTemplate(call) if call.callee() != e && is_styled_tag(call.callee()))
        }
        AstNodes::JSXExpressionContainer(_) => match parent.parent() {
            // <style jsx>{`div{color:red}`}</style>
            AstNodes::JSXElement(element) => matches!(element.kind(), ExprKind::Jsx(jsx)
                if jsx.tag().is_some_and(|tag| is_identifier(tag, b"style"))
                    && jsx.attrs().iter().any(|attribute| has_name(attribute, b"jsx"))),
            // <div css={`color: red`} />
            AstNodes::JSXAttribute(attribute) => has_name(attribute, b"css"),
            _ => false,
        },
        _ => is_angular_component_styles(parent),
    }
}

/// Whether Prettier's `embed` has something to say about the template `e`.
fn is_candidate<'a>(e: Expr<'a>, template: Template<'a>, options: &FormatOptions) -> bool {
    matches!(options.embedded_language_formatting, EmbeddedLanguageFormatting::Auto)
        && (0..template.quasi_count()).all(|index| template.cooked(index).is_some())
        && is_embed_css(e)
}

fn is_blank(template: Template<'_>) -> bool {
    template.quasi_count() == 1 && text::trim(template.raw(0)).is_empty()
}

/// Prettier's `embed`, for the languages that there is a formatter for. Returns whether it has written
/// the template `e`.
pub(crate) fn write_template<'a>(e: Expr<'a>, template: Template<'a>, f: &mut Formatter<'a>) -> bool {
    if !is_candidate(e, template, f.options()) {
        return false;
    }
    if is_blank(template) {
        f.write_token("``");
        return true;
    }
    let options = f.options().clone();
    print_embed_css(template, &options, Action::Write(f))
}

/// Whether the document of `e` has the label `embed`: it is a template that is written as the language
/// in it, with or without a tag.
pub(crate) fn has_embed_label<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let quasi = match e.kind() {
        ExprKind::TaggedTemplate(call) => call.template(),
        _ => Some(e),
    };
    let Some((quasi, ExprKind::Template(template))) = quasi.map(|quasi| (quasi, quasi.kind())) else {
        return false;
    };
    is_candidate(quasi, template, f.options()) && !is_blank(template) && print_embed_css(template, f.options(), Action::Check)
}
