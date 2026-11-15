use super::line_end_pos;
use bun_core::{lexer, strings};
use bun_sema::atom::Atom;
use bun_sema::check::spans::skip_trivia;
use bun_sema::hir::{Comment, ExprKind, FileBuilder, JsxPragmas, PropKind};

#[cfg(test)]
mod tests;

const CODE_PRAGMA_NAMES: [&[u8]; 4] = [b"jsx", b"jsxFrag", b"jsxRuntime", b"jsxImportSource"];

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum CommentMark<'t> {
    Pure,
    Pragma(usize, &'t [u8]),
}

pub(crate) fn comment_marks<'t>(
    text: &'t [u8],
    comment: &Comment,
) -> impl Iterator<Item = CommentMark<'t>> {
    let is_block = comment.is_block;
    let closing = if is_block { 2 } else { 0 };
    let (from, to) = (comment.pos as usize + 2, comment.end as usize);
    let mut rest = text
        .get(from..to.saturating_sub(closing))
        .unwrap_or_default();
    let mut is_first_sign = true;
    std::iter::from_fn(move || {
        while let Some(sign) = strings::index_of_any(rest, b"@#") {
            let may_be_pure =
                is_block || (is_first_sign && strings::is_all_whitespace(&rest[..sign]));
            is_first_sign = false;
            rest = &rest[sign + 1..];
            if may_be_pure && strings::has_prefix_with_word_boundary(rest, b"__PURE__") {
                return Some(CommentMark::Pure);
            }
            let pragma = (CODE_PRAGMA_NAMES.into_iter())
                .position(|name| strings::has_prefix_with_word_boundary(rest, name));
            if let Some(pragma) = pragma {
                let name_len = CODE_PRAGMA_NAMES[pragma].len();
                if let Some(argument) = code_pragma_argument(&rest[name_len..]) {
                    rest = &rest[name_len + argument.len()..];
                    return Some(CommentMark::Pragma(pragma, argument));
                }
            } else if let Some(url) = rest.strip_prefix(b" sourceMappingURL=") {
                let end = strings::index_of_space_or_newline_or_non_ascii(url, 0);
                rest = &url[end.map_or(url.len(), |end| end as usize)..];
            }
        }
        None
    })
}

pub(super) fn code_jsx_pragmas(
    text: &[u8],
    file: &FileBuilder,
    intern: &mut dyn FnMut(&[u8]) -> Atom,
) -> JsxPragmas {
    let mut arguments: [&[u8]; 4] = [b""; 4];
    for comment in &file.comments {
        let mut is_in_tag = None;
        for mark in comment_marks(text, comment) {
            let CommentMark::Pragma(pragma, argument) = mark else {
                continue;
            };
            if *is_in_tag.get_or_insert_with(|| stands_in_tag(text, file, comment)) {
                break;
            }
            arguments[pragma] = argument;
        }
    }
    let [factory, fragment_factory, runtime, import_source] = arguments;
    let mut atom_of = |argument: &[u8]| match argument.is_empty() {
        true => Atom::NONE,
        false => intern(argument),
    };
    let (classic, is_development) = match runtime {
        b"classic" | b"react" => (Some(true), None),
        b"automatic" => (Some(false), None),
        b"react-jsx" => (Some(false), Some(false)),
        b"react-jsxdev" => (Some(false), Some(true)),
        _ => (None, None),
    };
    JsxPragmas {
        classic,
        is_development,
        factory: atom_of(code_factory(factory)),
        fragment_factory: atom_of(code_factory(fragment_factory)),
        import_source: atom_of(import_source),
    }
}

fn stands_in_tag(text: &[u8], file: &FileBuilder, comment: &Comment) -> bool {
    if comment.prev_token_end == 0 {
        return false;
    }
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
