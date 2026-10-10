use bun_lint_oxlint::import::is_in_root_scope;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Forbids using Webpack loader syntax directly in import or require statements.
pub struct NoWebpackLoaderSyntax;

const NO_WEBPACK_LOADER_SYNTAX: Message = Message::new("", "Unexpected `!` in `{{name}}`.");

impl Rule for NoWebpackLoaderSyntax {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-webpack-loader-syntax", Kind::Suggestion);
    const ON: On = On::new().stmts(&[StmtTag::Import]).exprs(&[ExprTag::Call]);
    type State<'a> = AncestorMemo<'a, ()>;

    fn new(_: &Options) -> Self {
        NoWebpackLoaderSyntax
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().stmts(&[StmtTag::Import]);
        if !file.mentions("require") {
            return on;
        }
        on.exprs(&[ExprTag::Call])
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(AncestorMemo::default())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Import(import) = stmt.kind()
            && strings::contains_char(import.spec().bytes(), b'!')
            && matches!(stmt.parent(), Node::File(_))
            && let Some(source) = import.spec_span()
        {
            cx.report(source, NO_WEBPACK_LOADER_SYNTAX).data("name", import.spec());
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(call) = e.as_call()
            && call.callee().is_ident("require")
            && !call.callee().is_parenthesized()
            && call.args().len() == 1
            && let Some(argument) = call.args().first().filter(|it| !it.is_parenthesized())
            && let Some(value) = argument.as_string()
            && strings::contains_char(value.bytes(), b'!')
            && is_in_root_scope(Node::Expr(e), &mut cx.state)
        {
            cx.report(argument, NO_WEBPACK_LOADER_SYNTAX).data("name", value);
        }
    }
}
