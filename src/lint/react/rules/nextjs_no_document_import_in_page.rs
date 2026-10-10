use crate::nextjs::is_document_page;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent importing `next/document` outside of `pages/_document.js`.
pub struct NoDocumentImportInPage;

const NO_DOCUMENT_IMPORT_IN_PAGE: Message = Message::new(
    "",
    "`<Document />` from `next/document` should not be imported outside of `pages/_document.js`. See: https://nextjs.org/docs/messages/no-document-import-in-page",
);

impl Rule for NoDocumentImportInPage {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-document-import-in-page", Kind::Problem);
    const ON: On = On::new().stmts(&[StmtTag::Import]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDocumentImportInPage
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("next/document") || is_document_page(file.path()) {
            return None;
        }
        Some(())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if matches!(stmt.kind(), StmtKind::Import(import) if import.spec().is("next/document")) {
            cx.report(stmt, NO_DOCUMENT_IMPORT_IN_PAGE);
        }
    }
}
