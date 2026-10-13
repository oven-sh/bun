use crate::module_visitor::Visitor;
use bun_core::printer::json_stringify_alloc;
use bun_lint::paths::{self, Style};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbid import of modules using absolute paths.
pub struct NoAbsolutePath {
    visitor: Visitor,
}

const NO_ABSOLUTE_PATH: Message = Message::new("", "Do not import modules using an absolute path");

impl Rule for NoAbsolutePath {
    const META: Meta = Meta::plugin(Plugin::Import, "no-absolute-path", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let mut visitor = Visitor::new(options);
        visitor.systems.commonjs = options.bool_or("commonjs", true);
        NoAbsolutePath { visitor }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        self.visitor.may_visit(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let (file, is_oxlint) = (cx.file(), cx.language().is_oxlint);
        for visited in self.visitor.visit(file) {
            if !paths::is_absolute(visited.specifier) || is_oxlint && !is_seen_by_oxlint(visited.importer) {
                continue;
            }
            let report = cx.report(visited.source, NO_ABSOLUTE_PATH);
            // oxlint has no fix.
            if !is_oxlint {
                report.fix(|fixer| fixer.replace(visited.source, relative_path(file.path(), visited.specifier)));
            }
        }
    }
}

/// oxlint looks at `import` declarations and at calls, and takes parentheses for nodes.
fn is_seen_by_oxlint(importer: Node) -> bool {
    let is_plain = |e: Expr| !e.is_parenthesized();
    match importer {
        Node::Stmt(declaration) => declaration.tag() == StmtTag::Import,
        Node::Expr(e) => match (e.kind(), e.parent()) {
            (ExprKind::Call(call), _) => is_plain(call.callee()) && call.args().iter().all(is_plain),
            // An element of the array of `define([..], f)`.
            (ExprKind::String(_), Node::Expr(modules)) => {
                let callee = modules.parent().as_expr().and_then(Expr::callee);
                is_plain(e) && is_plain(modules) && callee.is_some_and(is_plain)
            }
            _ => false,
        },
        _ => false,
    }
}

/// The way from the directory of the file at `filename` to `specifier`, in quotes.
#[cold]
#[inline(never)]
fn relative_path(filename: &[u8], specifier: &[u8]) -> Vec<u8> {
    let resolved = paths::resolve_as(Style::Posix, b"/", specifier);
    let relative = paths::relative_as(Style::Posix, paths::dirname(filename), &resolved);
    let prefix: &[u8] = if relative.starts_with(b".") { b"" } else { b"./" };
    json_stringify_alloc(&[prefix, &relative[..]].concat())
}
