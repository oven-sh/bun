use crate::import_resolve::Resolvers;
use crate::module_visitor::Visitor;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Ensure imports point to a file/module that can be resolved.
pub struct NoUnresolved {
    visitor: Visitor,
}

const UNRESOLVED: Message = Message::new("", "Unable to resolve path to module '{{source}}'.");

/// `node.importKind === 'type' || node.exportKind === 'type'`
fn is_type_only(node: Node) -> bool {
    let Node::Stmt(declaration) = node else {
        return false;
    };
    match declaration.kind() {
        StmtKind::Import(import) => import.is_type_only(),
        StmtKind::ExportNamed(export) => export.is_type_only(),
        StmtKind::ExportStar { type_only, .. } => type_only,
        _ => false,
    }
}

impl Rule for NoUnresolved {
    const META: Meta = Meta::plugin(Plugin::Import, "no-unresolved", Kind::Problem).needs_modules();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoUnresolved { visitor: Visitor::new(options.object(0)) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.modules().is_some() && self.visitor.may_visit(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let Some(resolvers) = Resolvers::of(file.settings()) else {
            return;
        };
        for visited in self.visitor.visit(file) {
            if !is_type_only(visited.importer)
                && !resolvers.resolve(file, visited.specifier, visited.is_require).is_found()
            {
                cx.report(visited.source, UNRESOLVED).data("source", visited.specifier);
            }
        }
    }
}
