use crate::jsx::{Child, children};
use crate::nextjs::elements_named;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent usage of `next/script` in `next/head` component.
pub struct NoScriptComponentInHead;

const NO_SCRIPT_COMPONENT_IN_HEAD: Message = Message::new("", "Prevent usage of `next/script` in `next/head` component.");

impl Rule for NoScriptComponentInHead {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-script-component-in-head", Kind::Problem);
    const ON: On = On::new().stmts(&[StmtTag::Import]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoScriptComponentInHead
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("next/head") || !file.mentions("Script") {
            return None;
        }
        Some(())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
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
    }
}
