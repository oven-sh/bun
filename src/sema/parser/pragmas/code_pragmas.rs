use super::line_end_pos;
use bun_core::{lexer, strings};
use bun_sema::atom::Atom;
use bun_sema::hir::{Comment, JsxPragmas};

#[cfg(test)]
mod tests;

const CODE_PRAGMA_NAMES: [&[u8]; 4] = [b"jsx", b"jsxFrag", b"jsxRuntime", b"jsxImportSource"];

pub(super) fn code_jsx_pragmas(
    text: &[u8],
    comments: &[Comment],
    intern: &mut dyn FnMut(&[u8]) -> Atom,
) -> JsxPragmas {
    let mut arguments: [&[u8]; 4] = [b""; 4];
    for comment in comments {
        let written = &text[comment.pos as usize..comment.end as usize];
        let mut rest = match comment.is_block {
            true => written.strip_suffix(b"*/").unwrap_or(written),
            false => written,
        };
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
