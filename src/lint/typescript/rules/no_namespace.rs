use bun_lint::prelude::*;

/// Disallow TypeScript namespaces.
pub struct NoNamespace {
    allow_declarations: bool,
    allow_definition_files: bool,
}

const MODULE_SYNTAX_IS_PREFERRED: Message = Message::new(
    "moduleSyntaxIsPreferred",
    "ES2015 module syntax is preferred over namespaces.",
);

/// It has the `declare` modifier, or is in a namespace, a module or a `global` that has.
fn is_declaration(stmt: Stmt) -> bool {
    let has_declare = |it: Stmt| it.tag() == StmtTag::Module && it.flags().contains(Flags::AMBIENT);
    has_declare(stmt) || Node::Stmt(stmt).ancestors().filter_map(Node::as_stmt).any(has_declare)
}

impl Rule for NoNamespace {
    const META: Meta = Meta::typescript("no-namespace", Kind::Suggestion).recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoNamespace {
            allow_declarations: options.bool_or("allowDeclarations", false),
            allow_definition_files: options.bool_or("allowDefinitionFiles", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if self.allow_definition_files && ts_utils::is_definition_file(file.path()) {
            return;
        }
        on.stmts([StmtTag::Module], |rule, stmt, cx| {
            let StmtKind::Module(module) = stmt.kind() else {
                return;
            };
            if !matches!(module.name(), ModuleName::Ident(_)) || rule.allow_declarations && is_declaration(stmt) {
                return;
            }
            cx.report(stmt.span_without_export(), MODULE_SYNTAX_IS_PREFERRED);
        });
    }
}
