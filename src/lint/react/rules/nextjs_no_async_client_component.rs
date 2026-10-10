use bun_core::strings;
use bun_lint_oxlint::ast_util::get_declaration_of_variable;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent client components from being async functions.
pub struct NoAsyncClientComponent;

const NO_ASYNC_CLIENT_COMPONENT: Message = Message::new("", "Prevent client components from being async functions.");

impl Rule for NoAsyncClientComponent {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-async-client-component", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoAsyncClientComponent
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("use client") && file.body().iter().map_while(Stmt::directive).any(|it| it == b"use client")).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        for stmt in cx.file().body() {
            check(stmt, cx);
        }
    }
}

fn starts_with_uppercase(name: &[u8]) -> bool {
    strings::wtf8_first_codepoint(name).and_then(char::from_u32).is_some_and(char::is_uppercase)
}

/// The name of an `async function Name`.
fn name_of_async_component(func: Func<'_>) -> Option<Ident<'_>> {
    func.name().filter(|name| func.is_async() && starts_with_uppercase(name.bytes()))
}

fn check<'a>(stmt: Stmt<'a>, cx: &Cx<'a, NoAsyncClientComponent>) {
    match stmt.kind() {
        StmtKind::Fn(func) if stmt.is_default_export() => {
            if let Some(name) = name_of_async_component(func) {
                cx.report(name, NO_ASYNC_CLIENT_COMPONENT);
            }
        }
        StmtKind::ExportDefault(id) if !id.is_parenthesized() => match get_declaration_of_variable(id) {
            Some(Declaration::Fn(func)) => {
                if let Some(name) = name_of_async_component(func) {
                    cx.report(name, NO_ASYNC_CLIENT_COMPONENT);
                }
            }
            Some(Declaration::Var(binding)) => {
                if let Node::VarDecl(declarator) = binding.parent()
                    && binding.as_ident().is_some_and(|name| starts_with_uppercase(name.bytes()))
                    && let Some(init) = declarator.init().filter(|it| !it.is_parenthesized())
                    && init.as_fn().is_some_and(|func| func.is_arrow() && func.is_async())
                {
                    cx.report(binding, NO_ASYNC_CLIENT_COMPONENT);
                }
            }
            _ => {}
        },
        _ => {}
    }
}
