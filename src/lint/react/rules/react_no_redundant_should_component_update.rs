use bun_lint_oxlint::ast_util::static_name;
use crate::react::is_pragma_member_or_identifier;
use crate::util_ast::{get_property_name, name_of_key};
use crate::util_component_util::{Pragmas, is_pure_component};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::estree_compat::estree_parent;

/// Disallow usage of shouldComponentUpdate when extending React.PureComponent
pub struct NoRedundantShouldComponentUpdate;

const NO_SHOULD_COMP_UPDATE: Message = Message::new(
    "noShouldCompUpdate",
    "{{component}} does not need shouldComponentUpdate when extending React.PureComponent.",
);
const OXLINT: Message =
    Message::new("", "{{component_name}} does not need `shouldComponentUpdate` when extending `React.PureComponent`.");

pub struct State<'a> {
    /// `None` for oxlint, which knows `React` alone.
    pragmas: Option<Pragmas<'a>>,
}

impl Rule for NoRedundantShouldComponentUpdate {
    const META: Meta = Meta::plugin(Plugin::React, "no-redundant-should-component-update", Kind::Suggestion);
    const ON: On = On::new().classes();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoRedundantShouldComponentUpdate
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        let is_oxlint = file.language().is_oxlint;
        // upstream takes a private name for its text.
        let has_method =
            file.mentions("shouldComponentUpdate") || (!is_oxlint && file.mentions("#shouldComponentUpdate"));
        if !has_method || !file.mentions("PureComponent") {
            return None;
        }
        Some(State { pragmas: (!is_oxlint).then(|| Pragmas::new(file)) })
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        let is_pure = match &cx.state.pragmas {
            Some(pragmas) => is_pure_component(class, pragmas),
            None => class.extends().is_some_and(|it| is_pragma_member_or_identifier(it, &["PureComponent"])),
        };
        if !is_pure {
            return;
        }
        let is_oxlint = cx.state.pragmas.is_none();
        // oxlint knows a key by what it stands for, upstream by its `name`.
        let is_it = |member: &Member<'a>| {
            if is_oxlint {
                member.key().and_then(static_name).is_some_and(|name| name.is("shouldComponentUpdate"))
            } else {
                get_property_name(Node::Member(*member)).is_some_and(|name| name == b"shouldComponentUpdate")
            }
        };
        let Some(member) = class.members().iter().find(is_it) else {
            return;
        };
        let name = class.name().map(Ident::bytes).or_else(|| name_of_parent(class, is_oxlint)).unwrap_or_default();
        // oxlint points at the key.
        match member.key().filter(|_| is_oxlint) {
            Some(key) => cx.report(key.inner_span(cx.file()), OXLINT).data("component_name", name),
            None => cx.report(class.estree_span(), NO_SHOULD_COMP_UPDATE).data("component", name),
        };
    }
}

/// `node.parent.id.name`, which is `undefined` for what is no identifier. `None`: the parent has no `id`.
fn name_of_parent(class: Class<'_>, is_oxlint: bool) -> Option<&[u8]> {
    let e = class.owner().as_expr()?;
    let name = match estree_parent(Node::Class(class)) {
        // `var Foo = class extends PureComponent {}`
        Node::VarDecl(declarator) if declarator.init() == Some(e) => declarator.pat().as_ident().map(Name::bytes),
        _ if is_oxlint => return None,
        Node::Class(parent) if parent.extends() == Some(e) => return parent.name().map(Ident::bytes),
        Node::EnumMember(member) => member.key().and_then(name_of_key),
        _ => return None,
    };
    // oxlint has a node for parentheses, and no name for a pattern.
    if is_oxlint { name.filter(|_| !e.is_parenthesized()) } else { Some(name.unwrap_or(b"undefined")) }
}
