//! The code in a component: the plugin's `embed.ts`, from `textToDoc` on.

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
use bun_lint::linter::{TypesInJavaScript, refusal_of_prettier};
use std::cell::{OnceCell, RefCell};
use std::cmp::Reverse;

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

/// Whether one of the `comments` in `text` can be the last of it that is printed. One at the start or at the end of its line
/// waits for the end of a line: `a[0\n/* b */\n]` is `a[0]\n/* b */`. Any other stays before what follows it, unless that goes,
/// like parentheses and the `;` of a statement, or is written before it: `a as B[/* c */]` is `a as B[] /* c */`. So it can if
/// nothing follows it that does not close something.
fn can_end_with_comment(text: &[u8], comments: &[Comment]) -> bool {
    // They are in the order in which they are printed.
    let Some(end) = comments.iter().map(|it| it.span.end).max() else {
        return false;
    };
    let mut behind = text.get(end as usize..).unwrap_or_default();
    loop {
        behind = strings::trim_js_whitespace_end(behind);
        match behind {
            [before @ .., b')' | b']' | b'}' | b'>' | b';'] => behind = before,
            _ => break,
        }
    }
    behind.is_empty()
        || (comments.iter())
            .any(|it| it.is_line() || it.preceded_by_newline() || it.followed_by_newline())
}

/// Whether `e` can end with `as B` once it is printed: the parentheses go in `() => (a as B)`.
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

/// `textToDoc(forceIntoExpression(text), ..)`, and what is done to the document. Returns whether the last thing that is
/// written is a comment at the end of a line. `None`: nothing is written.
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
            // As it is written, there is none: `{#each a[0 // b\n]}`. Nor is there an `as` that Svelte takes for that of the
            // block, as there is in `{#each () => (a as B)}` without the parentheses.
            if js.is_without_comment_behind
                && (can_end_with_comment(&wrapped, comments) || can_end_with_assertion(e))
            {
                return false;
            }
            // One on a line of its own is printed at the end of a line too, and so is all that follows one that is.
            ends_with_line_comment = (comments.iter())
                .filter(|it| it.span.start >= e.span().end)
                .any(|it| it.is_line() || it.preceded_by_newline());
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
            // Such a comment is printed behind the name, where Svelte wants the `(`: `{#snippet a /* b */(c)}`.
            let first = function.params_with_this().next();
            let is_behind_name = |it: &Comment| {
                function
                    .open_paren()
                    .is_some_and(|open| it.span.start < open)
                    || (!it.is_line()
                        // One on a line of its own is printed before the parameter.
                        && !it.preceded_by_newline()
                        && (it.followed_by_newline() || {
                            let behind = file.text().get(it.span.end as usize..);
                            strings::trim_js_whitespace_start(behind.unwrap_or_default())
                                .starts_with(b"//")
                        })
                        && first.is_some_and(|first| it.span.start < first.span().start))
            };
            // Where the only parameter is hugged no line ends before the `)`, and a comment that waits for the end of one is
            // printed behind that, where Svelte wants the `}`: `{#snippet a({ b } = {}) // c\n}`. Between the brackets of the
            // pattern or of the default, and between the braces of a type, a line ends behind it.
            let hugged = first.filter(|_| should_hug_function_parameters(function, false, f));
            // Those that are in no other, in order.
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
            let is_behind_hugged = |it: &Comment| {
                let is_in = |part: Span| part.start <= it.span.start && it.span.end <= part.end;
                (it.is_line() || it.preceded_by_newline())
                    && hugged.is_some_and(|hugged| {
                        !is_in(hugged.pat().span())
                            && !hugged.default().is_some_and(|it| is_in(it.span()))
                            && !{
                                let types = types_with_braces();
                                let behind =
                                    types.partition_point(|part| part.start <= it.span.start);
                                behind.checked_sub(1).is_some_and(|at| is_in(types[at]))
                            }
                    })
            };
            // Prettier puts a comment behind the `=` of a default into the parentheses that the default starts with, and takes it
            // out of them the next time, and so on: `a = // b\n(c as D).e`.
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
            let is_before_parenthesis = |it: &Comment| {
                let behind = file.text().get(it.span.end as usize..).unwrap_or_default();
                let code = strings::trim_js_whitespace_start(behind);
                let at = it.span.end + (behind.len() - code.len()) as u32;
                it.is_line()
                    && !it.preceded_by_newline()
                    && code.starts_with(b"(")
                    && starts().binary_search(&at).is_ok()
            };
            let comments = f.comments().unprinted_comments();
            if (comments.iter())
                .any(|it| is_behind_name(it) || is_behind_hugged(it) || is_before_parenthesis(it))
            {
                return false;
            }
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
            // As it is written, there is none: `{const a = (b /* c */)}`.
            let comments = f.comments().unprinted_comments();
            if js.is_without_comment_behind && can_end_with_comment(&js.text, comments) {
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
            // It may have lost its parentheses: `{(/a/b)}`.
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
    // The plugin writes the error to stderr, and leaves what is in the tag as it is, but for the line breaks at its ends.
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
