use bun_lint::prelude::*;

/// Disallow invocation of `require()`.
pub struct NoRequireImports {
    allow: Vec<Regex>,
    allow_as_import: bool,
}

const NO_REQUIRE_IMPORTS: Message =
    Message::new("noRequireImports", "A `require()` style import is forbidden.");

impl NoRequireImports {
    fn is_import_path_allowed(&self, path: Option<Name>) -> bool {
        path.is_some_and(|path| self.allow.iter().any(|pattern| pattern.test(path.bytes())))
    }

    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        let callee = call.callee();
        if !callee.is_ident("require") || callee.symbol().is_some() {
            return;
        }
        let path = call.args().first().and_then(|argument| match argument.kind() {
            ExprKind::String(value) => Some(value),
            ExprKind::Template(template) => template.as_static(),
            _ => None,
        });
        // Upstream looks `require` up by its name alone, so a type of that name counts too.
        if self.is_import_path_allowed(path) || Node::Expr(e).scope().resolve("require").is_some() {
            return;
        }
        cx.report(e, NO_REQUIRE_IMPORTS);
    }

    fn check_import_equals<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::ImportEquals(import) = statement.kind()
            && let ImportEqualsTarget::Require(path) = import.target()
            && !self.is_import_path_allowed(path)
            && let Some(reference) = import.require_span()
        {
            cx.report(reference, NO_REQUIRE_IMPORTS);
        }
    }
}

impl Rule for NoRequireImports {
    const META: Meta = Meta::typescript("no-require-imports", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoRequireImports {
            allow: (object.strings("allow").into_iter())
                .filter_map(|pattern| Regex::new(pattern, "u").ok())
                .collect(),
            allow_as_import: object.bool_or("allowAsImport", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.has_expr_named("require") {
            on.exprs([ExprTag::Call], Self::check_call);
        }
        if !self.allow_as_import {
            on.stmts([StmtTag::ImportEquals], Self::check_import_equals);
        }
    }
}
