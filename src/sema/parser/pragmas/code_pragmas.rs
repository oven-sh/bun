use super::line_end_pos;
use bun_core::{lexer, strings};
use bun_sema::atom::Atom;
use bun_sema::check::spans::skip_trivia;
use bun_sema::hir::{Comment, ExprKind, FileBuilder, JsxPragmas, PropKind};

#[cfg(test)]
mod tests;

const CODE_PRAGMA_NAMES: [&[u8]; 4] = [b"jsx", b"jsxFrag", b"jsxRuntime", b"jsxImportSource"];

pub(super) fn code_jsx_pragmas(
    text: &[u8],
    file: &FileBuilder,
    intern: &mut dyn FnMut(&[u8]) -> Atom,
) -> JsxPragmas {
    let mut arguments: [&[u8]; 4] = [b""; 4];
    for comment in &file.comments {
        let written = &text[comment.pos as usize..comment.end as usize];
        let mut rest = match comment.is_block {
            true => written.strip_suffix(b"*/").unwrap_or(written),
            false => written,
        };
        let mut is_in_tag = None;
        while let Some(marker) = strings::index_of_any(rest, b"@#") {
            rest = &rest[marker + 1..];
            let pragma = (CODE_PRAGMA_NAMES.into_iter())
                .position(|name| strings::has_prefix_with_word_boundary(rest, name));
            let Some(pragma) = pragma else {
                continue;
            };
            let name_len = CODE_PRAGMA_NAMES[pragma].len();
            let Some(argument) = code_pragma_argument(&rest[name_len..]) else {
                continue;
            };
            if *is_in_tag.get_or_insert_with(|| stands_in_tag(text, file, comment)) {
                break;
            }
            arguments[pragma] = argument;
            rest = &rest[name_len + argument.len()..];
        }
    }
    let [factory, fragment_factory, runtime, import_source] = arguments;
    let mut atom_of = |argument: &[u8]| match argument.is_empty() {
        true => Atom::NONE,
        false => intern(argument),
    };
    JsxPragmas {
        classic: match runtime {
            b"classic" | b"react" => Some(true),
            b"automatic" | b"react-jsx" | b"react-jsxdev" => Some(false),
            _ => None,
        },
        factory: atom_of(code_factory(factory)),
        fragment_factory: atom_of(code_factory(fragment_factory)),
        import_source: atom_of(import_source),
    }
}

/// Whether `bun run` passes over the comment while it scans a tag: there it reads no pragma. Between the braces of an attribute and in type arguments it scans code.
fn stands_in_tag(text: &[u8], file: &FileBuilder, comment: &Comment) -> bool {
    if comment.prev_token_end == 0 {
        return false;
    }
    // Each range runs from the token that opens it to the token that closes it. The innermost one around the comment decides.
    let mut innermost = (0, false);
    let mut look_at = |open: u32, close: u32, is_tag: bool| {
        if innermost.0 <= open && open < comment.pos && comment.end <= close {
            innermost = (open, is_tag);
        }
    };
    for expr in &file.exprs {
        let ExprKind::Jsx(element) = expr.kind else {
            continue;
        };
        let jsx = &file[element];
        look_at(expr.pos, jsx.opening_end.saturating_sub(1), true);
        if jsx.close_pos != u32::MAX {
            look_at(jsx.close_pos, jsx.end.saturating_sub(1), true);
        }
        if let Some(last) = file.ids(jsx.type_args).last() {
            let open = skip_trivia(text, file[jsx.tag].end as usize);
            let mut close = skip_trivia(text, file[last].end as usize);
            while let Some(b')' | b',') = text.get(close) {
                close = skip_trivia(text, close + 1);
            }
            look_at(open as u32, close as u32, false);
        }
        for attribute in jsx.attrs.iter().map(|it| &file[it]) {
            if attribute.kind == PropKind::Spread {
                look_at(attribute.start, attribute.end.saturating_sub(1), false);
            }
        }
    }
    for &(_, open, end) in &file.jsx_expressions {
        look_at(open, end.saturating_sub(1), false);
    }
    innermost.1
}

fn code_pragma_argument(rest: &[u8]) -> Option<&[u8]> {
    let start = lexer::end_of_run(rest, 0, lexer::is_whitespace);
    if start == 0 {
        return None;
    }
    let end = lexer::end_of_run(rest, start, |c| !lexer::is_whitespace(c));
    Some(&rest[start..end])
}

fn code_factory(argument: &[u8]) -> &[u8] {
    let name = &argument[..line_end_pos(argument, 0)];
    match name.iter().all(|&c| c == b'.') {
        true => b"",
        false => name,
    }
}
