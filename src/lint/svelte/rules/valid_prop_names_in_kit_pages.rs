use crate::conditions::should_run;
use crate::kit::{IN_ROUTES, attributes, is_top_level, says_module};
use bun_lint::ast::svelte::{KitFileType, Role};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// disallow invalid props in SvelteKit route components.
pub struct ValidPropNamesInKitPages;

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "disallow invalid props in SvelteKit route components.",
);

const PAGE_PROP_NAMES: &[&str] = &["data", "form", "params", "snapshot"];
const LEGACY_PAGE_PROP_NAMES: &[&str] = &["data", "form", "params", "snapshot", "errors"];
const LAYOUT_PROP_NAMES: &[&str] = &["data", "form", "params", "snapshot", "children"];
const ERROR_PROP_NAMES: &[&str] = &["error"];

/// The listeners' selectors, on the same declarator: for Svelte 5, and for 3 and 4.
const OF_PROPS: &str = "VariableDeclaration > VariableDeclarator";
const OF_EXPORTS: &str = "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator";

impl Rule for ValidPropNamesInKitPages {
    const META: Meta = Meta::plugin(Plugin::Svelte, "valid-prop-names-in-kit-pages", Kind::Problem).recommended();
    const ON: On = On::new().var_decls();
    /// The names of the props the route takes with `$props()`.
    type State<'a> = &'static [&'static str];

    fn new(_: &Options) -> Self {
        ValidPropNamesInKitPages
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<&'static [&'static str]> {
        if !should_run(file, IN_ROUTES) {
            return None;
        }
        let context = file.svelte_context()?;
        let is_svelte_5 = context.svelte_version.as_deref() == Some("5");
        Some(match context.kit_file_type {
            Some(KitFileType::Layout) if is_svelte_5 => LAYOUT_PROP_NAMES,
            Some(KitFileType::Error) if is_svelte_5 => ERROR_PROP_NAMES,
            _ => PAGE_PROP_NAMES,
        })
    }

    fn var_decl<'a>(&self, declarator: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        // In a top-level script that isn't `<script context="module">` or `<script module>`.
        let Some((script, _)) = file.svelte_owner(Node::VarDecl(declarator)) else {
            return;
        };
        let is_module = attributes(script, b"context").any(says_module)
            || attributes(script, b"module").any(|it| it.nodes(Role::Value).next().is_none());
        if !is_top_level(script) || is_module {
            return;
        }
        if let Some(init) = declarator.init()
            && let Some(call) = init.as_call()
            && call.callee().as_ident().is_some_and(|it| it.is("$props"))
        {
            let names = cx.state;
            check(declarator, names, OF_PROPS, cx);
        }
        let Node::Stmt(statement) = declarator.parent() else {
            return;
        };
        if !statement.is_exported() || statement.is_default_export() {
            return;
        }
        match declarator.pat().as_ident() {
            Some(name) => {
                if !LEGACY_PAGE_PROP_NAMES.iter().any(|it| name.is(it)) {
                    cx.report(declarator, UNEXPECTED).by_selector(OF_EXPORTS);
                }
            }
            None => check(declarator, LEGACY_PAGE_PROP_NAMES, OF_EXPORTS, cx),
        }
    }
}

/// `checkProp`: each key of the object pattern `declarator` declares that's a name but none of `names`.
fn check<'a>(
    declarator: VarDecl<'a>,
    names: &[&str],
    selector: &'static str,
    cx: &mut Cx<'a, ValidPropNamesInKitPages>,
) {
    let PatKind::Object(props) = declarator.pat().kind() else {
        return;
    };
    let file = cx.file();
    for prop in props.iter() {
        let Some(key) = prop.key() else {
            continue;
        };
        let (name, at) = match key.kind() {
            KeyKind::Ident(name) => (name, key.span(file)),
            KeyKind::Computed(e) => match e.as_ident() {
                Some(name) => (name, e.span()),
                None => continue,
            },
            _ => continue,
        };
        if !names.iter().any(|it| name.is(it)) {
            cx.report(at, UNEXPECTED).by_selector(selector);
        }
    }
}
