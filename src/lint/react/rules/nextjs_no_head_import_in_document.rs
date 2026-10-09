use bun_lint_oxlint::text::file_name;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevents the usage of `next/head` inside a Next.js document.
pub struct NoHeadImportInDocument;

const NO_HEAD_IMPORT_IN_DOCUMENT: Message = Message::new("", "Prevent usage of `next/head` in `pages/_document.js`.");

/// `_document.*`, `_document*/index*`
fn is_document(file_path: &[u8]) -> bool {
    let name = file_name(file_path);
    name.starts_with(b"_document.")
        || name.starts_with(b"index")
            && strings::rsplit_once_char(file_path, b'/').is_some_and(|it| file_name(it.0).starts_with(b"_document"))
}

impl Rule for NoHeadImportInDocument {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-head-import-in-document", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoHeadImportInDocument
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("next/head") || !is_document(file.path()) {
            return;
        }
        on.stmts([StmtTag::Import], |_, stmt, cx| {
            if matches!(stmt.kind(), StmtKind::Import(import) if import.spec().is("next/head")) {
                cx.report(stmt, NO_HEAD_IMPORT_IN_DOCUMENT);
            }
        });
    }
}
