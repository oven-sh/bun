//! Formats the code embedded in a component. This is the plugin's `embed.ts`, from `textToDoc` on.

use super::doc::{self, Brace, Code, Js, JsKind, Parser};
use super::print::preformatted_body;
use crate::html::js::{self, Hug, Parse, Piece, SourceType, Syntax};
use crate::html::writer::Writer;
use crate::js::comments::Comment;
use crate::js::format::{ExprOptions, write_expression};
use crate::js::parentheses::expression::needs_parentheses;
use crate::js::print::function::{FormatFunctionOptions, write_function};
use crate::js::print::parameters::should_hug_function_parameters;
use crate::options::{Flavor, HtmlRoot, InHtml};
use crate::prelude::*;
use crate::stack::Stack;
use crate::syntax_error::{Message, SyntaxError};
use crate::{FormatError, write};
use bun_core::strings;
use bun_lint::linter::{TypesInJavaScript, prettier_rejection};
use std::cell::{OnceCell, RefCell};
use std::cmp::Reverse;

pub(crate) struct CodeSettings<'o> {
    pub(crate) options: &'o FormatOptions,
    /// `_svelte_ts`
    pub(crate) is_typescript: bool,
    /// `svelteIndentScriptAndStyle`
    pub(crate) indents_script_and_style: bool,
    /// Which formatter's output the scripts must match.
    pub(crate) script_flavor: Flavor,
    pub(crate) stack: &'o Stack,
    /// Parses a program.
    pub(crate) parse: Parse<'o>,
    /// Code that was left unformatted because it doesn't parse. Each entry is the error message and its offset in the
    /// component.
    pub(crate) unformatted: &'o RefCell<Vec<(Vec<u8>, u32)>>,
}

/// True if `e`'s printed form starts with something that Svelte reads differently right after `brace`:
/// `{/a/.test(b)}` closes a block, `{#a in b}` opens one, `{@a class {}}` is a tag and `{let[0]}` is a declaration.
/// The plugin prints these verbatim.
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

/// True if one of the `comments` in `text` could be printed last. A comment at the start or end of its line is
/// deferred to the end of a line: `a[0\n/* b */\n]` prints as `a[0]\n/* b */`. Any other comment stays before the
/// token after it, unless that token is dropped, like parentheses and a statement's `;`, or is printed before the
/// comment: `a as B[/* c */]` prints as `a as B[] /* c */`. So it can end up last only if nothing but closing tokens
/// follows it.
fn can_end_with_comment(text: &[u8], comments: CommentList<'_>) -> bool {
    // The list is in print order, not source order.
    let Some(end) = comments.iter().map(|it| it.span().end).max() else {
        return false;
    };
    let mut after = text.get(end as usize..).unwrap_or_default();
    loop {
        after = strings::trim_js_whitespace_end(after);
        match after {
            [before @ .., b')' | b']' | b'}' | b'>' | b';'] => after = before,
            _ => break,
        }
    }
    after.is_empty()
        || (comments.iter())
            .any(|it| it.is_line() || it.has_newline_before() || it.has_newline_after())
}

/// True if `e`'s printed form can end with `as B`. `() => (a as B)` loses its parentheses, for example.
fn can_end_with_assertion(mut e: Expr<'_>) -> bool {
    loop {
        e = match e.kind() {
            ExprKind::As { expr, .. } | ExprKind::AsConst(expr)
                if e.is_angle_bracket_assertion() =>
            {
                expr
            }
            ExprKind::As { .. } | ExprKind::AsConst(_) => return true,
            ExprKind::Fn(function) => match function.body() {
                FnBody::Expr(body) => body,
                _ => return false,
            },
            ExprKind::Unary {
                op: UnOp::PostInc | UnOp::PostDec,
                ..
            } => return false,
            ExprKind::Assign { value: it, .. }
            | ExprKind::Binary { right: it, .. }
            | ExprKind::Cond { no: it, .. }
            | ExprKind::Unary { operand: it, .. }
            | ExprKind::Await(it)
            | ExprKind::Spread(it)
            | ExprKind::Yield {
                value: Some(it), ..
            } => it,
            _ => return false,
        };
    }
}

/// `textToDoc(forceIntoExpression(text), ..)`, plus the plugin's post-processing of the document. Returns
/// `Some(true)` if the output ends with a comment that runs to the end of its line, and `None` if nothing was
/// written.
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
            let comments = f.comments().all();
            // The source text doesn't end with a comment, but the printed text could: `{#each a[0 // b\n]}`. The
            // source also has no `as` that Svelte would read as the block's own, but `{#each () => (a as B)}` has one
            // once its parentheses are gone.
            if js.forbids_trailing_comment
                && (can_end_with_comment(&wrapped, comments) || can_end_with_assertion(e))
            {
                return false;
            }
            // A comment on its own line is also printed at the end of a line, and so is every comment after it.
            ends_with_line_comment = (comments.iter())
                .filter(|it| it.span().start >= e.span().end)
                .any(|it| it.is_line() || it.has_newline_before());
            let is_in_parentheses =
                (js.follows).is_some_and(|brace| starts_like_a_tag(e, brace, f));
            let content = format_with(|f| {
                if is_in_parentheses {
                    return write!(f, ["(", e, ")"]);
                }
                match js.remove_parentheses {
                    // `removeParentheses` mistakes a leading block comment for an unterminated one and keeps the
                    // parentheses, which Svelte rejects around the two functions of a `bind:`.
                    true => {
                        let node = e.as_chain_element();
                        write!(f, leading_comments(node));
                        write_expression(e, ExprOptions::None, f);
                        write!(f, trailing_comments(node));
                    }
                    false => write!(f, e),
                }
            });
            // After removing the line breaks, the plugin prints whatever follows a `//` comment before it:
            // `{#if a && b} // c`.
            match js.is_on_one_line && !comments.iter().any(|it| it.is_line()) {
                true => f.write_with_lines_removed(&content),
                false => write!(f, content),
            }
            true
        },
    );
    is_written.then_some(ends_with_line_comment)
}

/// Same as `write_js_expression`, for `forceIntoFunction(text)`, where `text` is a name and parameters.
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
            // This kind of comment is printed after the name, where Svelte requires the `(`:
            // `{#snippet a /* b */(c)}`.
            let first = function.params_with_this().next();
            let is_after_name = |it: Comment<'_>| {
                function
                    .open_paren()
                    .is_some_and(|open| it.span().start < open)
                    || (!it.is_line()
                        // A comment on its own line is printed before the parameter.
                        && !it.has_newline_before()
                        && (it.has_newline_after() || {
                            let after = file.text().get(it.span().end as usize..);
                            strings::trim_js_whitespace_start(after.unwrap_or_default())
                                .starts_with(b"//")
                        })
                        && first.is_some_and(|first| it.span().start < first.span().start))
            };
            // When the only parameter is hugged, no line ends before the `)`. A comment deferred to the end of a line
            // is then printed after the `)`, where Svelte requires the `}`: `{#snippet a({ b } = {}) // c\n}`. Inside
            // the brackets of the pattern or the default, and inside a type's braces, a line does end after the
            // comment.
            let hugged = first.filter(|_| should_hug_function_parameters(function, false, f));
            // Only the outermost ones, in source order.
            let types_with_braces = OnceCell::new();
            let types_with_braces = || {
                types_with_braces.get_or_init(|| {
                    let tags = [TypeTag::Object, TypeTag::Mapped];
                    let all = tags.iter().flat_map(|&tag| file.types_of_kind(tag));
                    let mut spans: Vec<Span> = all.map(|it| it.span()).collect();
                    crate::sort::sort_by_key(&mut spans, |it| (it.start, Reverse(it.end)));
                    spans.dedup_by(|it, outer| it.end <= outer.end);
                    spans
                })
            };
            let is_after_hugged = |it: Comment<'_>| {
                let is_in = |part: Span| part.start <= it.span().start && it.span().end <= part.end;
                (it.is_line() || it.has_newline_before())
                    && hugged.is_some_and(|hugged| {
                        !is_in(hugged.pat().span())
                            && !hugged.default().is_some_and(|it| is_in(it.span()))
                            && !{
                                let types = types_with_braces();
                                let after =
                                    types.partition_point(|part| part.start <= it.span().start);
                                after.checked_sub(1).is_some_and(|at| is_in(types[at]))
                            }
                    })
            };
            // Prettier moves a comment after a default's `=` into the parentheses that the default starts with, moves
            // it back out on the next run, and keeps alternating: `a = // b\n(c as D).e`.
            let starts = OnceCell::new();
            let starts = || {
                starts.get_or_init(|| {
                    let tags = [ExprTag::Dot, ExprTag::Index, ExprTag::Call];
                    let all = tags.iter().flat_map(|&tag| file.exprs_of_kind(tag));
                    let outermost = all.filter(|it| !matches!(it.parent(), Node::Expr(_)));
                    let mut starts: Vec<u32> = outermost.map(|it| it.span().start).collect();
                    crate::sort::sort(&mut starts[..]);
                    starts
                })
            };
            let is_before_parenthesis = |it: Comment<'_>| {
                let after = file
                    .text()
                    .get(it.span().end as usize..)
                    .unwrap_or_default();
                let code = strings::trim_js_whitespace_start(after);
                let at = it.span().end + (after.len() - code.len()) as u32;
                it.is_line()
                    && !it.has_newline_before()
                    && code.starts_with(b"(")
                    && starts().binary_search(&at).is_ok()
            };
            let comments = f.comments().all();
            if (comments.iter())
                .any(|it| is_after_name(it) || is_after_hugged(it) || is_before_parenthesis(it))
            {
                return false;
            }
            write_function(function, FormatFunctionOptions::default(), f);
            true
        },
    )
}

/// Same as `write_js_expression`, for a statement, which is printed without its `;`.
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
            // The source text doesn't end with a comment, but the printed text could: `{const a = (b /* c */)}`.
            let comments = f.comments().all();
            if js.forbids_trailing_comment && can_end_with_comment(&js.text, comments) {
                return false;
            }
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

fn write_js(js: &Js<'_>, out: &mut Writer<'_, '_>, settings: &CodeSettings<'_>) {
    let in_html = InHtml {
        root: match js.kind {
            JsKind::Statement => HtmlRoot::SvelteStatement,
            JsKind::Expression | JsKind::Function => HtmlRoot::SvelteExpression,
        },
        has_single_quotes: js.has_single_quotes,
        has_babel_tree: true,
        ..InHtml::default()
    };
    let ends_with_line_comment = out.foreign(|f| match js.kind {
        JsKind::Expression => write_js_expression(f, js, in_html, settings.is_typescript),
        JsKind::Function => {
            write_js_function(f, js, in_html, settings.is_typescript).then_some(false)
        }
        JsKind::Statement => {
            write_js_statement(f, js, in_html, settings.is_typescript).then_some(false)
        }
    });
    match ends_with_line_comment {
        // The plugin prints whatever follows the code before the comment: `{@const a = b} // c`.
        Some(true) => out.hardline(),
        Some(false) => {}
        // `catch (e) { return getText(node, options, true); }`
        None => {
            // The text may have lost its parentheses: `{(/a/b)}`.
            let is_in_parentheses = js.follows.is_some()
                && matches!(js.text.trim_ascii_start(), [b'/' | b'#' | b'@' | b':', ..])
                && !matches!(js.text.trim_ascii_start(), [b'/', b'/' | b'*', ..]);
            match is_in_parentheses {
                true => out.string(&[b"(", &js.text[..], b")"].concat()),
                false => out.string(&js.text),
            }
            let last_line = strings::last_index_of_char(&js.text, b'\n').map_or(0, |it| it + 1);
            if strings::contains(&js.text[last_line..], b"//") {
                out.hardline();
            }
        }
    }
}

/// Writes whatever `format` appends to its vector, minus trailing line breaks. `format` gets options whose line width
/// is reduced by `out`'s current indentation. Returns `Ok(false)` if there's nothing to write.
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

/// Returns the error message and offset for `content`, a `<script>` body that can't be formatted.
#[cold]
fn error_in_script(content: &[u8], parse: Parse<'_>) -> (Vec<u8>, u32) {
    let mut error = None;
    parse.call(b"dummy.ts", content, false, &mut |file| {
        error = prettier_rejection(file, TypesInJavaScript::Rejected);
    });
    error.map_or_else(
        || message_and_offset(SyntaxError(Message::CannotBeFormatted, 0)),
        |it| (it.message, it.at),
    )
}

fn message_and_offset(SyntaxError(message, at): SyntaxError) -> (Vec<u8>, u32) {
    (message.text().as_bytes().to_vec(), at)
}

/// `formatBodyContent`
fn write_body(
    (content, start): (&[u8], u32),
    parser: Parser,
    out: &mut Writer<'_, '_>,
    settings: &CodeSettings<'_>,
) {
    let attempt = out.start_attempt();
    if settings.indents_script_and_style {
        out.start_indent();
    }
    out.hardline();
    let program = |syntax: Syntax, out: &mut Writer<'_, '_>| {
        let in_html = InHtml {
            root: HtmlRoot::Program,
            has_babel_tree: syntax == Syntax::BabelTs,
            ..InHtml::default()
        };
        let (source_type, flavor) = (SourceType::Unknown, settings.script_flavor);
        match out.foreign(|f| js::write_program(f, content, syntax, source_type, in_html, flavor)) {
            true => Ok(true),
            false => Err(error_in_script(content, settings.parse)),
        }
    };
    let style_sheet = |parser: crate::css::Parser, out: &mut Writer<'_, '_>| {
        write_printed_text(out, settings.options, |options, printed| {
            crate::css::format(content, parser, options, &mut Default::default(), printed)
        })
        .map_err(message_and_offset)
    };
    let written = match parser {
        Parser::TypeScript => program(Syntax::TypeScript, out),
        Parser::BabelTs => program(Syntax::BabelTs, out),
        Parser::Json => write_printed_text(out, settings.options, |options, printed| {
            let parser = crate::json::Parser::Json;
            crate::json::format(content, parser, options, &mut Default::default(), printed)
        })
        .map_err(message_and_offset),
        Parser::Css => style_sheet(crate::css::Parser::Css, out),
        Parser::Scss => style_sheet(crate::css::Parser::Scss, out),
        Parser::Less => style_sheet(crate::css::Parser::Less, out),
    };
    if settings.indents_script_and_style {
        out.end_indent();
    }
    out.hardline();
    // The plugin writes the error to stderr and keeps the tag's content as is, except for the line breaks at both
    // ends.
    let is_written = written == Ok(true);
    if let Err((message, at)) = written {
        settings
            .unformatted
            .borrow_mut()
            .push((message, start + at));
    }
    if !out.end_attempt(attempt, is_written) {
        let mut write = doc::Write {
            code: &mut |_, _| {},
            stack: settings.stack,
        };
        doc::write(preformatted_body(content), out, &mut write);
    }
}

pub(crate) fn write_code(code: &Code<'_>, out: &mut Writer<'_, '_>, settings: &CodeSettings<'_>) {
    match code {
        Code::Js(js) => write_js(js, out, settings),
        Code::Body {
            content,
            parser,
            start,
        } => write_body((content, *start), *parser, out, settings),
    }
}
