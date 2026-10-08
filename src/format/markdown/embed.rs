//! Markdown in the templates of JavaScript: Prettier's `language-js/embed/markdown.js`.

use crate::css::doc::{self, Alignment, Doc, Line};
use crate::ir::element::{Align, Condition, DedentMode, Group, GroupMode, LineMode, PrintMode, TextWidth};
use crate::prelude::*;

/// Prettier's `isEmbedMarkdown`, and what `embed` asks of every template. `e`: a template.
fn is_candidate<'a>(e: Expr<'a>, template: Template<'a>, f: &Formatter<'a>) -> bool {
    matches!(f.options().embedded_language_formatting, EmbeddedLanguageFormatting::Auto)
        && template.quasi_count() == 1
        && matches!(e.ast_parent(), AstNodes::TaggedTemplateExpression(tagged)
            if matches!(tagged.kind(), ExprKind::TaggedTemplate(call)
                if matches!(call.callee().kind(), ExprKind::Ident(_)) && matches!(call.callee().text(), b"md" | b"markdown")))
        && template.cooked(0).is_some()
}

fn is_blank(template: Template<'_>) -> bool {
    crate::range::trim_start(template.raw(0)).is_empty()
}

/// Whether `e` is a template with the tag `md` or `markdown` that is more than ` `` `: for Prettier, its
/// document has the label `embed`.
pub(crate) fn has_embed_label<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let ExprKind::TaggedTemplate(call) = e.kind() else {
        return false;
    };
    let Some((quasi, ExprKind::Template(template))) = call.template().map(|quasi| (quasi, quasi.kind())) else {
        return false;
    };
    is_candidate(quasi, template, f) && !is_blank(template)
}

/// A part of a document, in the order it is written.
enum Op<'d> {
    Text(&'d [u8]),
    Line(Line),
    Element(FormatElement),
}

/// The parts of `doc`. Returns whether all of it can be written as a part of a document for JavaScript.
fn flatten<'d>(doc: &'d Doc<'_>, ops: &mut Vec<Op<'d>>) -> bool {
    let between = |start: Tag, contents: &'d Doc<'_>, end: Tag, ops: &mut Vec<Op<'d>>| {
        ops.push(Op::Element(FormatElement::Tag(start)));
        let is_done = flatten(contents, ops);
        ops.push(Op::Element(FormatElement::Tag(end)));
        is_done
    };
    match doc {
        Doc::Text(text) => {
            if !text.is_empty() {
                ops.push(Op::Text(text));
            }
            true
        }
        Doc::Array(parts) => parts.iter().all(|part| flatten(part, ops)),
        Doc::Indent(contents) => between(Tag::StartIndent, contents, Tag::EndIndent, ops),
        Doc::Align(Alignment::Spaces(0), contents) | Doc::MarkAsRoot(contents) => flatten(contents, ops),
        Doc::Align(Alignment::Spaces(width), contents) => match u8::try_from(*width) {
            Ok(width) => between(Tag::StartAlign(Align(width)), contents, Tag::EndAlign, ops),
            Err(_) => false,
        },
        Doc::Group {
            contents,
            should_break,
            ..
        } => {
            let mode = if *should_break { GroupMode::Expand } else { GroupMode::Flat };
            between(Tag::StartGroup(Group::new().with_mode(mode)), contents, Tag::EndGroup, ops)
        }
        Doc::Fill(parts) => {
            ops.push(Op::Element(FormatElement::Tag(Tag::StartFill)));
            let is_done = parts.iter().all(|part| between(Tag::StartEntry, part, Tag::EndEntry, ops));
            ops.push(Op::Element(FormatElement::Tag(Tag::EndFill)));
            is_done
        }
        Doc::IfBreak {
            break_contents,
            flat_contents,
            group_id: 0,
        } => {
            let start = |mode| Tag::StartConditionalContent(Condition::new(mode));
            between(start(PrintMode::Expanded), break_contents, Tag::EndConditionalContent, ops)
                && between(start(PrintMode::Flat), flat_contents, Tag::EndConditionalContent, ops)
        }
        Doc::Line(line) => {
            ops.push(Op::Line(*line));
            true
        }
        Doc::BreakParent => {
            ops.push(Op::Element(FormatElement::ExpandParent));
            true
        }
        // The lines of a block quote start with a text, which the other documents have no way to say.
        Doc::Align(Alignment::Text(_), _)
        | Doc::Dedent(_)
        | Doc::DedentToRoot(_)
        | Doc::IfBreak { .. }
        | Doc::LineSuffix(_)
        | Doc::LineSuffixBoundary => false,
    }
}

/// Line breaks that are written as they are, with nothing taken away before them and nothing put behind them.
fn write_line_breaks(count: usize, f: &mut Formatter<'_>) {
    f.write_text(&vec![b'\n'; count], Some(TextWidth::multiline(0)));
}

/// Prettier's `escapeTemplateCharacters(doc, true)`, for one text.
fn write_escaped(text: &[u8], f: &mut Formatter<'_>) {
    if !bun_core::strings::contains_char(text, b'`') {
        return f.write_text(text, None);
    }
    let mut escaped = Vec::with_capacity(text.len() + 8);
    let mut backslashes = 0;
    for &byte in text {
        if byte == b'`' {
            // The backslashes before it are doubled.
            escaped.resize(escaped.len() + backslashes + 1, b'\\');
        }
        backslashes = if byte == b'\\' { backslashes + 1 } else { 0 };
        escaped.push(byte);
    }
    f.write_text(&escaped, None);
}

fn write_ops(ops: &[Op<'_>], f: &mut Formatter<'_>) {
    let mut index = 0;
    while let Some(op) = ops.get(index) {
        index += 1;
        match op {
            Op::Text(text) => write_escaped(text, f),
            Op::Element(element) => f.write_element(*element),
            Op::Line(Line::Space) => f.write_element(FormatElement::Line(LineMode::SoftOrSpace)),
            Op::Line(Line::Soft) => f.write_element(FormatElement::Line(LineMode::Soft)),
            // The line break is written as it is. The other only says how far the next line is indented.
            Op::Line(Line::Literal) => {
                write_line_breaks(1, f);
                f.write_element(FormatElement::Line(LineMode::Hard));
            }
            Op::Line(Line::Hard) => {
                // Several in a row, with nothing written between them, are empty lines. The last says how far the
                // next line is indented.
                let run = ops[index..].iter().take_while(|op| matches!(op, Op::Line(Line::Hard) | Op::Element(_))).count();
                let last = ops[index..index + run].iter().rposition(|op| matches!(op, Op::Line(Line::Hard)));
                let Some(last) = last else {
                    f.write_element(FormatElement::Line(LineMode::Hard));
                    continue;
                };
                let rest = &ops[index..index + last];
                let count = 2 + rest.iter().filter(|op| matches!(op, Op::Line(_))).count();
                // The printer writes no more than one empty line for line breaks.
                match count {
                    2 => f.write_element(FormatElement::Line(LineMode::Hard)),
                    _ => write_line_breaks(count, f),
                }
                for op in rest {
                    if let Op::Element(element) = op {
                        f.write_element(*element);
                    }
                }
                f.write_element(FormatElement::Line(if count == 2 { LineMode::Empty } else { LineMode::Hard }));
                index += last + 1;
            }
        }
    }
}

/// Writes the template `e` as Markdown, if that is what Prettier takes it for. Returns whether it has.
pub(crate) fn write_template<'a>(e: Expr<'a>, template: Template<'a>, f: &mut Formatter<'a>) -> bool {
    if !is_candidate(e, template, f) {
        return false;
    }
    if is_blank(template) {
        f.write_token("``");
        return true;
    }

    // `\`` is a backtick, and the backslashes before it are escaped.
    let raw = template.raw(0);
    let mut text = Vec::with_capacity(raw.len());
    let mut backslashes = 0usize;
    for &byte in raw {
        match byte {
            b'`' => text.truncate(text.len() - backslashes.div_ceil(2)),
            b'\r' => continue,
            _ => {}
        }
        backslashes = if byte == b'\\' { backslashes + 1 } else { 0 };
        text.push(byte);
    }

    // The indentation of the first line that has something on it is taken away from all lines.
    let is_blank_byte = |byte: &&u8| byte.is_ascii_whitespace() && **byte != b'\n';
    let indentation = bun_core::strings::split(&text, b"\n")
        .find(|line| !line.iter().all(u8::is_ascii_whitespace))
        .map(|line| line[..line.iter().take_while(is_blank_byte).count()].to_vec())
        .unwrap_or_default();
    if !indentation.is_empty() {
        let mut dedented = Vec::with_capacity(text.len());
        for (index, line) in bun_core::strings::split(&text, b"\n").enumerate() {
            if index > 0 {
                dedented.push(b'\n');
            }
            dedented.extend_from_slice(line.strip_prefix(&indentation[..]).unwrap_or(line));
        }
        text = dedented;
    }

    let options = f.options().clone();
    let mut tree = super::ast::Tree::default();
    let is_written = super::with_document(&text, &options, &mut tree, true, |document| {
        let document = doc::strip_trailing_hardline(doc::clean(document));
        let mut ops = Vec::new();
        if !flatten(&document, &mut ops) {
            return false;
        }
        f.write_token("`");
        if indentation.is_empty() {
            write_line_breaks(1, f);
            f.write_element(FormatElement::ExpandParent);
            f.write_element(FormatElement::Tag(Tag::StartDedent(DedentMode::Root)));
            write_ops(&ops, f);
            f.write_element(FormatElement::Tag(Tag::EndDedent(DedentMode::Root)));
        } else {
            f.write_element(FormatElement::Tag(Tag::StartIndent));
            f.write_element(FormatElement::Line(LineMode::Soft));
            write_ops(&ops, f);
            f.write_element(FormatElement::Tag(Tag::EndIndent));
        }
        f.write_element(FormatElement::Line(LineMode::Soft));
        f.write_token("`");
        true
    });
    is_written == Ok(true)
}
