use crate::nextjs::elements_named;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent duplicate usage of `<Head>` in `pages/_document.js`.
pub struct NoDuplicateHead;

const NO_DUPLICATE_HEAD: Message = Message::new("", "Do not include multiple instances of `<Head/>`");

impl Rule for NoDuplicateHead {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-duplicate-head", Kind::Problem);
    const ON: On = On::new().stmts(&[StmtTag::Import]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDuplicateHead
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("Head") || !file.has_exprs([ExprTag::Jsx]) {
            return None;
        }
        Some(())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Import(import) = stmt.kind() else {
            return;
        };
        let named = import.named().iter().map(ImportSpec::local);
        let mut locals = import.default().into_iter().chain(import.namespace()).chain(named);
        let Some(head) = locals.find(|it| it.name().is("Head")) else {
            return;
        };
        if !matches!(stmt.parent(), Node::File(_)) {
            return;
        }
        let mut elements = elements_named(import, head);
        if let (Some((first, _)), Some((second, _))) = (elements.next(), elements.next()) {
            let report = cx.report(first, NO_DUPLICATE_HEAD).label(second, "");
            elements.fold(report, |report, (further, _)| report.label(further, ""));
        }
    }
}
