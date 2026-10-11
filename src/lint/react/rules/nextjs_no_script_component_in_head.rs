use crate::jsx::{Child, children};
use crate::nextjs::elements_named;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent usage of `next/script` in `next/head` component. `TITLE`: of `<title>` with `Head` component from `next/document`.
pub struct NoElementInHead<const TITLE: bool = false>;

/// The rule, the message, the module, the element.
const TEXTS: [[&str; 4]; 2] = [
    ["no-script-component-in-head", "Prevent usage of `next/script` in `next/head` component.", "next/head", "Script"],
    [
        "no-title-in-document-head",
        "Prevent usage of `<title>` with `Head` component from `next/document`.",
        "next/document",
        "title",
    ],
];

impl<const TITLE: bool> Rule for NoElementInHead<TITLE> {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, TEXTS[TITLE as usize][0], Kind::Problem);
    const ON: On = On::new().stmts(&[StmtTag::Import]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Self
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        let [_, _, module, element] = TEXTS[TITLE as usize];
        (file.mentions(module) && file.mentions(element)).then_some(())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let [_, message, module, element_name] = TEXTS[TITLE as usize];
        let StmtKind::Import(import) = stmt.kind() else {
            return;
        };
        let local = match TITLE {
            // The first name in the braces, whatever it is.
            true => import.named().first().map(|it| it.local()),
            false => import.default(),
        };
        let Some(local) = local.filter(|_| import.spec().is(module)) else {
            return;
        };
        for (name, head) in elements_named(import, local) {
            for child in children(cx.file(), head) {
                if matches!(child, Child::Element(element) if element.tag().is_some_and(|it| it.is_ident(element_name))) {
                    cx.report(name, Message::new("", message));
                }
            }
        }
    }
}
