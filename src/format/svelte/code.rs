//! The code in a component: the plugin's `embed.ts`, from `textToDoc` on.

use super::doc::{self, Brace, Code, Js, JsKind, Parser};
use super::print::preformatted_body;
use crate::html::js::{self, Hug, Parse, Piece, SourceType, Syntax};
use crate::html::writer::Writer;
use crate::js::format::{ExprOptions, write_expression};
use crate::js::parentheses::expression::needs_parentheses;
use crate::js::print::function::{FormatFunctionOptions, write_function};
use crate::options::{Flavor, HtmlRoot, InHtml};
use crate::prelude::*;
use crate::stack::Stack;
use crate::syntax_error::{Message, SyntaxError};
use crate::{FormatError, write};
use bun_core::strings;
use bun_lint::linter::{TypesInJavaScript, refusal_of_prettier};
use std::cell::RefCell;

pub(crate) struct How<'o> {
    pub(crate) options: &'o FormatOptions,
    /// `_svelte_ts`
    pub(crate) is_typescript: bool,
    /// `svelteIndentScriptAndStyle`
    pub(crate) indents_script_and_style: bool,
    /// Whose output the scripts are.
    pub(crate) script_flavor: Flavor,
    pub(crate) stack: &'o Stack,
    /// Parses a program.
    pub(crate) parse: Parse<'o>,
    /// What has stayed as it is because it cannot be parsed: what is wrong with it, and where in the component.
    pub(crate) unformatted: &'o RefCell<Vec<(Vec<u8>, u32)>>,
}

/// Whether what `e` is printed as starts with what is something else to Svelte behind `brace`: `{/a/.test(b)}` ends a block,
/// `{#a in b}` starts one, `{@a class {}}` is a tag, `{let[0]}` a declaration. The plugin prints these.
fn starts_like_a_tag<'a>(mut e: Expr<'a>, brace: Brace, f: &Formatter<'a>) -> bool {
    loop {
        if needs_parentheses(e, f) {
            return false;
        }
        e = match e.kind() {
            ExprKind::Regex(_) => return brace == Brace::InMarkup,
            ExprKind::Ident(name) => {
                return brace == Brace::InMarkup && name.is_any(&["let", "interface"]);
            }
            ExprKind::PrivateIdentifier(_) => return true,
            ExprKind::Class(class) => return class.decorators().next().is_some(),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
            ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => call.callee(),
            ExprKind::Binary { left, .. } => left,
            ExprKind::Assign { target, .. } => target,
            ExprKind::Cond { test, .. } => test,
            ExprKind::Unary {
                op: UnOp::PostInc | UnOp::PostDec,
                operand,
            } => operand,
            ExprKind::As { expr, .. } | ExprKind::AsConst(expr)
                if !e.is_angle_bracket_assertion() =>
            {
                expr
            }
            ExprKind::Satisfies { expr, .. }
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => expr,
            _ => return false,
        };
    }
}

/// `textToDoc(forceIntoExpression(text), ..)`, and what is done to the document. Returns whether a `//` comment is the last
/// thing that is written. `None`: nothing is written.
fn write_js_expression(
    f: &mut Formatter<'_>,
    js: &Js<'_>,
    in_html: InHtml,
    is_typescript: bool,
) -> Option<bool> {
    if !js.is_on_one_line && js::write_path(f, &js.text, Hug::Bare) {
        return Some(false);
    }
    let mut ends_with_line_comment = false;
    let wrapped = [b"(", &js.text[..], b"\n)"].concat();
    let paths: &[&[u8]] = match is_typescript {
        true => &[js::EXPRESSION_TSX, js::EXPRESSION_TS],
        false => &[js::EXPRESSION_JSX],
    };
    let (source_type, piece) = (SourceType::Unknown, Piece::Other);
    let is_written = js::with_file(
        f,
        &wrapped,
        paths,
        source_type,
        in_html,
        piece,
        &mut |file, f| {
            let Some(e) = js::expression_of(file) else {
                return false;
            };
            let comments = f.comments().unprinted_comments();
            ends_with_line_comment =
                (comments.last()).is_some_and(|it| it.is_line() && it.span.start >= e.span().end);
            let is_in_parentheses =
                (js.follows).is_some_and(|brace| starts_like_a_tag(e, brace, f));
            let content = format_with(|f| {
                if is_in_parentheses {
                    write!(f, ["(", e, ")"]);
                    let rest = f.comments().unprinted_comments();
                    return write!(f, FormatTrailingComments::Comments(rest));
                }
                match js.is_without_parentheses {
                    // `removeParentheses` takes a block comment at the start for one that never ends, and leaves the
                    // parentheses, which Svelte refuses around the two functions of a `bind:`.
                    true => {
                        write!(f, FormatLeadingComments::Node(e.span()));
                        write_expression(e, ExprOptions::None, f);
                    }
                    false => write!(f, e),
                }
                let rest = f.comments().unprinted_comments();
                write!(f, FormatTrailingComments::Comments(rest));
            });
            // Without its line breaks, the plugin has what follows a `//` before it: `{#if a && b} // c`.
            match js.is_on_one_line && !comments.iter().any(|it| it.is_line()) {
                true => f.write_with_lines_removed(&content),
                false => write!(f, content),
            }
            true
        },
    );
    is_written.then_some(ends_with_line_comment)
}

/// The same for `forceIntoFunction(text)`: the name and the parameters.
fn write_js_function(
    f: &mut Formatter<'_>,
    js: &Js<'_>,
    in_html: InHtml,
    is_typescript: bool,
) -> bool {
    let program = [b"function ", &js.text[..], b" {}"].concat();
    let paths = js::paths_of(syntax_of(is_typescript), &program);
    let (source_type, piece) = (SourceType::Unknown, Piece::Other);
    js::with_file(
        f,
        &program,
        paths,
        source_type,
        in_html,
        piece,
        &mut |file, f| {
            let Some(StmtKind::Fn(function)) = file.body().iter().next().map(|it| it.kind()) else {
                return false;
            };
            write_function(function, FormatFunctionOptions::default(), f);
            true
        },
    )
}

/// The same for a statement, which loses its `;`.
fn write_js_statement(
    f: &mut Formatter<'_>,
    js: &Js<'_>,
    in_html: InHtml,
    is_typescript: bool,
) -> bool {
    let paths = js::paths_of(syntax_of(is_typescript), &js.text);
    let (source_type, piece) = (SourceType::Unknown, Piece::Other);
    js::with_file(
        f,
        &js.text,
        paths,
        source_type,
        in_html,
        piece,
        &mut |file, f| {
            let Some(statement) = file.body().iter().next() else {
                return false;
            };
            write!(f, statement);
            true
        },
    )
}

/// `babel` or `babel-ts`
fn syntax_of(is_typescript: bool) -> Syntax {
    match is_typescript {
        true => Syntax::BabelTs,
        false => Syntax::Babel,
    }
}

fn write_js(js: &Js<'_>, out: &mut Writer<'_, '_>, how: &How<'_>) {
    let in_html = InHtml {
        root: match js.kind {
            JsKind::Statement => HtmlRoot::SvelteStatement,
            JsKind::Expression | JsKind::Function => HtmlRoot::SvelteExpression,
        },
        has_single_quotes: js.has_single_quotes,
        has_tree_of_babel: true,
        ..InHtml::default()
    };
    let ends_with_line_comment = out.foreign(|f| match js.kind {
        JsKind::Expression => write_js_expression(f, js, in_html, how.is_typescript),
        JsKind::Function => write_js_function(f, js, in_html, how.is_typescript).then_some(false),
        JsKind::Statement => write_js_statement(f, js, in_html, how.is_typescript).then_some(false),
    });
    match ends_with_line_comment {
        // The plugin has what follows the code before the comment: `{@const a = b} // c`.
        Some(true) => out.hardline(),
        Some(false) => {}
        // `catch (e) { return getText(node, options, true); }`
        None => {
            out.string(&js.text);
            let last_line = strings::last_index_of_char(&js.text, b'\n').map_or(0, |it| it + 1);
            if strings::contains(&js.text[last_line..], b"//") {
                out.hardline();
            }
        }
    }
}

/// Writes what `format` appends to the vector that it is given, without the line breaks at its end. It is given the options
/// for a text whose lines start where those of `out` do. `Ok(false)`: there is nothing to write.
fn write_printed_text(
    out: &mut Writer<'_, '_>,
    options: &FormatOptions,
    format: impl FnOnce(&FormatOptions, &mut Vec<u8>) -> Result<(), FormatError>,
) -> Result<bool, SyntaxError> {
    let Some(indentation) = out.indentation_width() else {
        return Ok(false);
    };
    let width = (options.line_width.value() as usize).saturating_sub(indentation);
    let in_html = InHtml {
        root: HtmlRoot::Program,
        ..InHtml::default()
    };
    let options = FormatOptions {
        line_width: LineWidth(width.clamp(1, u32::MAX as usize) as u32),
        line_ending: LineEnding::Lf,
        is_in_markdown: true,
        ..js::options_in_html(options, in_html)
    };
    let mut printed = Vec::new();
    match format(&options, &mut printed) {
        Ok(()) if printed.is_empty() => return Ok(false),
        Ok(()) => {}
        Err(FormatError::SyntaxErrorAt(error)) => return Err(error),
        Err(_) => return Err(SyntaxError(Message::CannotBeFormatted, 0)),
    }
    let end = (printed
        .iter()
        .rposition(|byte| !matches!(byte, b'\n' | b'\r')))
    .map_or(0, |at| at + 1);
    out.printed_text(&printed[..end]);
    Ok(true)
}

/// What is wrong with `content`, which is in a `<script>` and cannot be formatted, and where.
#[cold]
fn error_in_script(content: &[u8], parse: Parse<'_>) -> (Vec<u8>, u32) {
    let mut error = None;
    parse.call(b"dummy.ts", content, false, &mut |file| {
        error = refusal_of_prettier(file, TypesInJavaScript::Refused);
    });
    error.map_or_else(
        || in_words(SyntaxError(Message::CannotBeFormatted, 0)),
        |it| (it.message, it.at),
    )
}

fn in_words(SyntaxError(message, at): SyntaxError) -> (Vec<u8>, u32) {
    (message.text().as_bytes().to_vec(), at)
}

/// `formatBodyContent`
fn write_body(
    (content, start): (&[u8], u32),
    parser: Parser,
    out: &mut Writer<'_, '_>,
    how: &How<'_>,
) {
    let attempt = out.start_attempt();
    if how.indents_script_and_style {
        out.start_indent();
    }
    out.hardline();
    let program = |syntax: Syntax, out: &mut Writer<'_, '_>| {
        let in_html = InHtml {
            root: HtmlRoot::Program,
            has_tree_of_babel: syntax == Syntax::BabelTs,
            ..InHtml::default()
        };
        let (source_type, flavor) = (SourceType::Unknown, how.script_flavor);
        match out.foreign(|f| js::write_program(f, content, syntax, source_type, in_html, flavor)) {
            true => Ok(true),
            false => Err(error_in_script(content, how.parse)),
        }
    };
    let style_sheet = |parser: crate::css::Parser, out: &mut Writer<'_, '_>| {
        write_printed_text(out, how.options, |options, printed| {
            crate::css::format(content, parser, options, &mut Default::default(), printed)
        })
        .map_err(in_words)
    };
    let written = match parser {
        Parser::TypeScript => program(Syntax::TypeScript, out),
        Parser::BabelTs => program(Syntax::BabelTs, out),
        Parser::Json => write_printed_text(out, how.options, |options, printed| {
            let parser = crate::json::Parser::Json;
            crate::json::format(content, parser, options, &mut Default::default(), printed)
        })
        .map_err(in_words),
        Parser::Css => style_sheet(crate::css::Parser::Css, out),
        Parser::Scss => style_sheet(crate::css::Parser::Scss, out),
        Parser::Less => style_sheet(crate::css::Parser::Less, out),
    };
    if how.indents_script_and_style {
        out.end_indent();
    }
    out.hardline();
    // The plugin writes the error to stderr, and leaves what is in the tag as it is.
    let is_written = written == Ok(true);
    if let Err((message, at)) = written {
        how.unformatted.borrow_mut().push((message, start + at));
    }
    if !out.end_attempt(attempt, is_written) {
        let mut write = doc::Write {
            code: &mut |_, _| {},
            stack: how.stack,
        };
        doc::write(preformatted_body(content), out, &mut write);
    }
}

pub(crate) fn write_code(code: &Code<'_>, out: &mut Writer<'_, '_>, how: &How<'_>) {
    match code {
        Code::Js(js) => write_js(js, out, how),
        Code::Body {
            content,
            parser,
            start,
        } => write_body((content, *start), *parser, out, how),
    }
}
