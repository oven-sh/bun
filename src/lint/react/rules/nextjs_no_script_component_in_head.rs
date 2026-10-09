use crate::jsx::{Child, children};
use crate::nextjs::elements_named;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent usage of `next/script` in `next/head` component.
pub struct NoScriptComponentInHead;

const NO_SCRIPT_COMPONENT_IN_HEAD: Message = Message::new("", "Prevent usage of `next/script` in `next/head` component.");

impl Rule for NoScriptComponentInHead {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-script-component-in-head", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoScriptComponentInHead
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("next/head") || !file.mentions("Script") {
            return;
        }
        on.stmts([StmtTag::Import], |_, stmt, cx| {
            let StmtKind::Import(import) = stmt.kind() else {
                return;
            };
            let Some(local) = import.default().filter(|_| import.spec().is("next/head")) else {
                return;
            };
            for (name, head) in elements_named(import, local) {
                for child in children(cx.file(), head) {
                    if matches!(child, Child::Element(element) if element.tag().is_some_and(|it| it.is_ident("Script"))) {
                        cx.report(name, NO_SCRIPT_COMPONENT_IN_HEAD);
                    }
                }
            }
        });
    }
}
