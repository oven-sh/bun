use crate::unicorn::is_empty_stmt;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow empty files.
pub struct NoEmptyFile;

const NO_EMPTY_FILE: Message = Message::new("", "Empty files are not allowed.");

/// Not a file without an extension, and not one of which only a part is JavaScript.
fn should_run(path: &[u8]) -> bool {
    let name = bun_lint::paths::file_name(path);
    match strings::last_index_of_char(name, b'.') {
        None | Some(0) => false,
        Some(at) => !matches!(name.get(at + 1..), Some(b"vue" | b"astro" | b"svelte")),
    }
}

impl Rule for NoEmptyFile {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-empty-file", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoEmptyFile
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.body().iter().all(|it| it.directive().is_some() || is_empty_stmt(it)) || !should_run(file.path()) {
            return None;
        }
        Some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let is_triple_slash = |it: Token| it.kind() == TokenKind::Line && it.text().starts_with(b"///");
        if !cx.file().comments().any(is_triple_slash) {
            // No more than the first 100 bytes.
            cx.report(Span::new(0, cx.file().span().end.min(100)), NO_EMPTY_FILE);
        }
    }
}
