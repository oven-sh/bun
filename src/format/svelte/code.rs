//! The code in a component: the plugin's `embed.ts`, from `textToDoc` on.

use super::doc::{self, Code, Js, JsKind, Parser};
use super::print::preformatted_body;
use crate::html::js::{self, Hug, Piece, SourceType, Syntax};
use crate::html::writer::Writer;
use crate::js::format::{ExprOptions, write_expression};
use crate::js::print::function::{FormatFunctionOptions, write_function};
use crate::options::{Flavor, HtmlRoot, InHtml};
use crate::prelude::*;
use crate::{FormatError, write};

pub(crate) struct How<'o> {
    pub(crate) options: &'o FormatOptions,
    /// `_svelte_ts`
    pub(crate) is_typescript: bool,
    /// `svelteIndentScriptAndStyle`
    pub(crate) indents_script_and_style: bool,
    /// Whose output the scripts are.
    pub(crate) script_flavor: Flavor,
}

/// `textToDoc(forceIntoExpression(text), ..)`, and what is done to the document.
fn write_js_expression(
    f: &mut Formatter<'_>,
    js: &Js<'_>,
    in_html: InHtml,
    is_typescript: bool,
) -> bool {
    if !js.is_on_one_line && js::write_path(f, &js.text, Hug::Bare) {
        return true;
    }
    let wrapped = [b"(", &js.text[..], b"\n)"].concat();
    let paths: &[&[u8]] = match is_typescript {
        true => &[js::EXPRESSION_TSX, js::EXPRESSION_TS],
        false => &[js::EXPRESSION_JSX],
    };
    let (source_type, piece) = (SourceType::Unknown, Piece::Other);
    js::with_file(
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
            // `removeParentheses` takes a block comment at the start for one that never ends, and leaves all as it is.
            let is_bare =
                js.is_without_parentheses && !js.text.trim_ascii_start().starts_with(b"/*");
            let content = format_with(|f| {
                match is_bare {
                    true => write_expression(e, ExprOptions::None, f),
                    false => write!(f, e),
                }
                let rest = f.comments().unprinted_comments();
                write!(f, FormatTrailingComments::Comments(rest));
            });
            match js.is_on_one_line {
                true => f.write_with_lines_removed(&content),
                false => write!(f, content),
            }
            true
        },
    )
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
    let is_written = out.foreign(|f| match js.kind {
        JsKind::Expression => write_js_expression(f, js, in_html, how.is_typescript),
        JsKind::Function => write_js_function(f, js, in_html, how.is_typescript),
        JsKind::Statement => write_js_statement(f, js, in_html, how.is_typescript),
    });
    // `catch (e) { return getText(node, options, true); }`
    if !is_written {
        out.string(&js.text);
    }
}

/// Writes what `format` appends to the vector that it is given, without the line breaks at its end. It is given the options
/// for a text whose lines start where those of `out` do.
fn write_printed_text(
    out: &mut Writer<'_, '_>,
    options: &FormatOptions,
    format: impl FnOnce(&FormatOptions, &mut Vec<u8>) -> Result<(), FormatError>,
) -> bool {
    let Some(indentation) = out.indentation_width() else {
        return false;
    };
    let width = usize::from(options.line_width.value()).saturating_sub(indentation);
    let in_html = InHtml {
        root: HtmlRoot::Program,
        ..InHtml::default()
    };
    let options = FormatOptions {
        line_width: LineWidth(width.clamp(1, usize::from(u16::MAX)) as u16),
        line_ending: LineEnding::Lf,
        is_in_markdown: true,
        ..js::options_in_html(options, in_html)
    };
    let mut printed = Vec::new();
    if format(&options, &mut printed).is_err() || printed.is_empty() {
        return false;
    }
    let end = (printed
        .iter()
        .rposition(|byte| !matches!(byte, b'\n' | b'\r')))
    .map_or(0, |at| at + 1);
    out.printed_text(&printed[..end]);
    true
}

/// `formatBodyContent`
fn write_body(content: &[u8], parser: Parser, out: &mut Writer<'_, '_>, how: &How<'_>) {
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
        out.foreign(|f| js::write_program(f, content, syntax, source_type, in_html, flavor))
    };
    let style_sheet = |parser: crate::css::Parser, out: &mut Writer<'_, '_>| {
        write_printed_text(out, how.options, |options, printed| {
            crate::css::format(content, parser, options, &mut Default::default(), printed)
        })
    };
    let is_written = match parser {
        Parser::TypeScript => program(Syntax::TypeScript, out),
        Parser::BabelTs => program(Syntax::BabelTs, out),
        Parser::Json => write_printed_text(out, how.options, |options, printed| {
            let parser = crate::json::Parser::Json;
            crate::json::format(content, parser, options, &mut Default::default(), printed)
        }),
        Parser::Css => style_sheet(crate::css::Parser::Css, out),
        Parser::Scss => style_sheet(crate::css::Parser::Scss, out),
        Parser::Less => style_sheet(crate::css::Parser::Less, out),
    };
    if how.indents_script_and_style {
        out.end_indent();
    }
    out.hardline();
    // The plugin writes the error to stderr, and leaves what is in the tag as it is.
    if !out.end_attempt(attempt, is_written) {
        doc::write(preformatted_body(content), out, &mut |_, _| {});
    }
}

pub(crate) fn write_code(code: &Code<'_>, out: &mut Writer<'_, '_>, how: &How<'_>) {
    match code {
        Code::Js(js) => write_js(js, out, how),
        Code::Body { content, parser } => write_body(content, *parser, out, how),
    }
}
