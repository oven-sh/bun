use bun_lint_oxlint::ast_util::static_name;
use crate::react::is_pragma_member_or_identifier;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow usage of `shouldComponentUpdate` when extending `React.PureComponent`.
pub struct NoRedundantShouldComponentUpdate;

const NO_REDUNDANT_SHOULD_COMPONENT_UPDATE: Message =
    Message::new("", "{{component_name}} does not need `shouldComponentUpdate` when extending `React.PureComponent`.");

impl Rule for NoRedundantShouldComponentUpdate {
    const META: Meta = Meta::oxlint(Plugin::React, "no-redundant-should-component-update", Kind::Suggestion);
    const ON: On = On::new().classes();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoRedundantShouldComponentUpdate
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("shouldComponentUpdate") || !file.mentions("PureComponent") {
            return None;
        }
        Some(())
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        if !class.extends().is_some_and(|it| is_pragma_member_or_identifier(it, &["PureComponent"])) {
            return;
        }
        let is_it = |key: &Key| static_name(*key).is_some_and(|name| name.is("shouldComponentUpdate"));
        let Some(key) = class.members().iter().filter_map(Member::key).find(is_it) else {
            return;
        };
        // `var Foo = class extends PureComponent {}`
        let name_of_variable = || match class.owner() {
            Node::Expr(e) if !e.is_parenthesized() => match e.parent() {
                Node::VarDecl(declarator) => declarator.pat().as_ident(),
                _ => None,
            },
            _ => None,
        };
        let component_name =
            class.name().map(Ident::name).or_else(name_of_variable).map(Name::bytes).unwrap_or_default();
        cx.report(key.inner_span(cx.file()), NO_REDUNDANT_SHOULD_COMPONENT_UPDATE)
            .data("component_name", component_name);
    }
}
