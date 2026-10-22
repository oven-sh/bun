use crate::conditions::should_run;
use crate::kit::{IN_ROUTES, attributes, is_top_level, says_module};
use bun_lint::ast::identifiers::identifiers_of;
use bun_lint::ast::svelte::{Role, Root, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// disallow exporting load functions in `*.svelte` module in SvelteKit page components.
pub struct NoExportLoadInSvelteModuleInKitPages;

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "disallow exporting load functions in `*.svelte` module in SvelteKit page components.",
);

const SELECTOR: &str = r#":matches(ExportNamedDeclaration > FunctionDeclaration, ExportNamedDeclaration > VariableDeclaration > VariableDeclarator) > Identifier.id[name="load"]"#;

impl Rule for NoExportLoadInSvelteModuleInKitPages {
    const META: Meta = Meta::plugin(
        Plugin::Svelte,
        "no-export-load-in-svelte-module-in-kit-pages",
        Kind::Problem,
    ).recommended();
    const ON: On = On::new().svelte_nodes(&[SvelteTag::ScriptElement]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoExportLoadInSvelteModuleInKitPages
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        should_run(file, IN_ROUTES).then_some(())
    }

    fn svelte_node<'a>(&self, script: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        // `<script context="module">`, not `<script module>`.
        if !is_top_level(script) || !attributes(script, b"context").any(says_module) {
            return;
        }
        let Some(body) = script.code(Role::Body) else {
            return;
        };
        for root in body.roots() {
            let Root::Node(Node::Stmt(statement)) = root else {
                continue;
            };
            if !statement.is_exported() || statement.is_default_export() {
                continue;
            }
            match statement.kind() {
                StmtKind::Fn(func) => {
                    if let Some(name) = func.name().filter(|it| func.has_body() && it.name().is("load")) {
                        report(Node::Func(func), name.span(), cx);
                    }
                }
                StmtKind::Var(declarators) => {
                    for declarator in declarators.iter() {
                        if declarator.pat().as_ident().is_some_and(|it| it.is("load")) {
                            report(Node::Pat(declarator.pat()), declarator.binding_span(), cx);
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

/// Reports the name at `span`, the `Identifier` upstream's listener is called with, which belongs to `owner`: the
/// function, or the declarator's pattern.
fn report<'a>(owner: Node<'a>, span: Span, cx: &mut Cx<'a, NoExportLoadInSvelteModuleInKitPages>) {
    let mut identifier = None;
    identifiers_of(owner, |it| {
        if identifier.is_none() && it.span == span {
            identifier = Some(it);
        }
    });
    let report = cx.report(span, UNEXPECTED).by_selector(SELECTOR);
    if let Some(identifier) = identifier {
        report.listened_as_identifier(identifier, SELECTOR.as_bytes());
    }
}
