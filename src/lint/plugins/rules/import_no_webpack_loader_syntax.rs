use crate::module_visitor::{Systems, Visitor};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::import::is_in_root_scope;

/// Forbid webpack loader syntax in imports.
pub struct NoWebpackLoaderSyntax(Visitor);

const UNEXPECTED: Message =
    Message::new("", "Unexpected '!' in '{{name}}'. Do not use import syntax to configure webpack loaders.");
const OXLINT: Message = Message::new("", "Unexpected `!` in `{{name}}`.");

/// What oxlint looks at: an `import` of the top level, and a `require(..)` without parentheses that no scope is around.
fn is_seen_by_oxlint<'a>(importer: Node<'a>, memo: &mut AncestorMemo<'a, ()>) -> bool {
    match importer {
        Node::Stmt(stmt) => stmt.tag() == StmtTag::Import && matches!(stmt.parent(), Node::File(_)),
        Node::Expr(e) => {
            let is_plain = |call: Call<'a>| {
                !call.callee().is_parenthesized() && !call.args().iter().any(Expr::is_parenthesized)
            };
            e.as_call().is_some_and(is_plain) && is_in_root_scope(importer, memo)
        }
        _ => false,
    }
}

impl Rule for NoWebpackLoaderSyntax {
    const META: Meta = Meta::plugin(Plugin::Import, "no-webpack-loader-syntax", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoWebpackLoaderSyntax(Visitor::of(Systems { esmodule: true, commonjs: true, amd: false }))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        self.0.may_visit(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let is_oxlint = file.language().is_oxlint;
        let mut memo = AncestorMemo::default();
        for visited in self.0.visit(file) {
            if !strings::contains_char(visited.specifier, b'!') {
                continue;
            }
            if !is_oxlint {
                cx.report(visited.importer, UNEXPECTED).data("name", visited.specifier);
                continue;
            }
            // oxlint points at the name.
            if is_seen_by_oxlint(visited.importer, &mut memo) {
                cx.report(visited.source, OXLINT).data("name", visited.specifier);
            }
        }
    }
}
