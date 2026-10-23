use crate::variables::find_variable;
use bun_lint::ast::svelte::{Role, SvelteKind, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::ast::svelte::variables::SvelteVariable;
use bun_lint::semantic::ScopeKind;
use bun_lint::utils::eslint_utils::get_property_name;

/// disallow DOM manipulating
pub struct NoDomManipulating;

const DISALLOW_MANIPULATE_DOM: Message = Message::new(
    "disallowManipulateDOM",
    "Don't manipulate the DOM directly. The Svelte runtime can get confused if there is a difference between the actual DOM and the DOM expected by the Svelte runtime.",
);

const DOM_MANIPULATING_METHODS: [&[u8]; 15] = [
    b"appendChild",
    b"insertBefore",
    b"normalize",
    b"removeChild",
    b"replaceChild",
    b"after",
    b"append",
    b"before",
    b"insertAdjacentElement",
    b"insertAdjacentHTML",
    b"insertAdjacentText",
    b"prepend",
    b"remove",
    b"replaceChildren",
    b"replaceWith",
];

const DOM_MANIPULATING_PROPERTIES: [&[u8]; 5] =
    [b"textContent", b"innerHTML", b"outerHTML", b"innerText", b"outerText"];

/// `verifyIdentifier`: the member access on `e` that calls a method or sets a property that changes the DOM.
fn manipulation<'a>(e: Expr<'a>) -> Option<Expr<'a>> {
    let Node::Expr(member) = e.parent() else {
        return None;
    };
    if member.object() != Some(e) {
        return None;
    }
    let name = get_property_name(member, None)?;
    let Node::Expr(parent) = member.parent() else {
        return None;
    };
    let is_manipulation = match parent.kind() {
        ExprKind::Call(call) => call.callee() == member && DOM_MANIPULATING_METHODS.contains(&&name[..]),
        ExprKind::Assign { target, .. } => target == member && DOM_MANIPULATING_PROPERTIES.contains(&&name[..]),
        _ => false,
    };
    is_manipulation.then_some(member)
}

impl Rule for NoDomManipulating {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-dom-manipulating", Kind::Problem).recommended().reports_at_the_end();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDomManipulating
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.svelte().is_some().then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        // The variables that an HTML element's `bind:this` sets, in directive order.
        let mut elements: Vec<SvelteVariable<'a>> = Vec::new();
        for directive in file.svelte_nodes_of(SvelteTag::Directive) {
            if directive.kind() != SvelteKind::Binding || directive.name() != b"this" {
                continue;
            }
            let Some(Node::Expr(e)) = directive.code(Role::Expression).and_then(|it| it.node()) else {
                continue;
            };
            if e.as_ident().is_none() {
                continue;
            }
            let Some(element) = directive.parent().and_then(|it| it.parent()) else {
                continue;
            };
            let is_html = element.tag() == SvelteTag::Element
                && (element.kind() == SvelteKind::Html || element.kind() == SvelteKind::Special && element.name() == b"svelte:element");
            if !is_html {
                continue;
            }
            let Some(variable) = find_variable(e) else {
                continue;
            };
            if matches!(variable.scope().kind(), ScopeKind::Module | ScopeKind::Global) && !elements.contains(&variable) {
                elements.push(variable);
            }
        }
        for variable in elements {
            for reference in variable.references() {
                if let Some(member) = reference.expr().and_then(manipulation) {
                    cx.report(member, DISALLOW_MANIPULATE_DOM);
                }
            }
        }
    }
}
