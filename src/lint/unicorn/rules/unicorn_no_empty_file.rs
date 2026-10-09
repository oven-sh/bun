use crate::unicorn::is_empty_stmt;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow empty files.
pub struct NoEmptyFile;

const NO_EMPTY_FILE: Message = Message::new("", "Empty files are not allowed.");

/// Not a file without an extension, and not one of which only a part is JavaScript.
fn should_run(path: &[u8]) -> bool {
    let name = strings::last_index_of_any(path, b"/\\").map_or(path, |at| path.get(at + 1..).unwrap_or_default());
    match strings::last_index_of_char(name, b'.') {
        None | Some(0) => false,
        Some(at) => !matches!(name.get(at + 1..), Some(b"vue" | b"astro" | b"svelte")),
    }
}

impl Rule for NoEmptyFile {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-empty-file", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoEmptyFile
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.body().iter().all(|it| it.directive().is_some() || is_empty_stmt(it)) || !should_run(file.path()) {
            return;
        }
        on.finish(|_, cx| {
            let is_triple_slash = |it: Token| it.kind() == TokenKind::Line && it.text().starts_with(b"///");
            if !cx.file().comments().any(is_triple_slash) {
                // No more than the first 100 bytes.
                cx.report(Span::new(0, cx.file().span().end.min(100)), NO_EMPTY_FILE);
            }
        });
    }
}
