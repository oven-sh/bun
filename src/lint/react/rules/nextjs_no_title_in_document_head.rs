use crate::jsx::{Child, children};
use crate::nextjs::elements_named;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent usage of `<title>` with `Head` component from `next/document`.
pub struct NoTitleInDocumentHead;

const NO_TITLE_IN_DOCUMENT_HEAD: Message =
    Message::new("", "Prevent usage of `<title>` with `Head` component from `next/document`.");

impl Rule for NoTitleInDocumentHead {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-title-in-document-head", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoTitleInDocumentHead
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("next/document") || !file.mentions("title") {
            return;
        }
        on.stmts([StmtTag::Import], |_, stmt, cx| {
            let StmtKind::Import(import) = stmt.kind() else {
                return;
            };
            // The first name in the braces, whatever it is.
            let Some(specifier) = import.named().first().filter(|_| import.spec().is("next/document")) else {
                return;
            };
            for (name, head) in elements_named(import, specifier.local()) {
                for child in children(cx.file(), head) {
                    if matches!(child, Child::Element(element) if element.tag().is_some_and(|it| it.is_ident("title"))) {
                        cx.report(name, NO_TITLE_IN_DOCUMENT_HEAD);
                    }
                }
            }
        });
    }
}
