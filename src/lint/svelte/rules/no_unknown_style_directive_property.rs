use crate::known_css_properties;
use bun_lint::ast::svelte::shared::{IgnoreWarning, IgnoreWarnings};
use bun_lint::ast::svelte::{Role, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// disallow unknown `style:property`
pub struct NoUnknownStyleDirectiveProperty {
    ignore_properties: Vec<Box<[u8]>>,
    ignore_prefixed: bool,
}

const UNKNOWN: Message = Message::new(
    "unknown",
    "Unexpected unknown style directive property '{{property}}'.",
);

impl NoUnknownStyleDirectiveProperty {
    fn ignore_properties<'o>(options: &Options<'o>) -> impl Iterator<Item = &'o [u8]> {
        let items = options.object(0).get("ignoreProperties").and_then(Json::as_array);
        items.unwrap_or_default().iter().filter_map(Json::as_str)
    }
}

impl Rule for NoUnknownStyleDirectiveProperty {
    const META: Meta =
        Meta::plugin(Plugin::Svelte, "no-unknown-style-directive-property", Kind::Problem).recommended();
    const ON: On = On::new().svelte_nodes(&[SvelteTag::StyleDirective]);
    /// `ignoreProperties`, with their patterns' state in this file.
    type State<'a> = IgnoreWarnings;

    fn new(options: &Options) -> Self {
        let ignore_prefixed = options.object(0).get("ignorePrefixed").and_then(Json::as_bool);
        NoUnknownStyleDirectiveProperty {
            ignore_properties: Self::ignore_properties(options).map(Into::into).collect(),
            ignore_prefixed: ignore_prefixed.unwrap_or(true),
        }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        Self::ignore_properties(options).try_for_each(|it| IgnoreWarning::of(it).map(drop))
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<IgnoreWarnings> {
        let ignored = self.ignore_properties.iter().filter_map(|it| IgnoreWarning::of(it).ok());
        Some(IgnoreWarnings(ignored.collect()))
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        let Some(key) = node.child(Role::Key) else {
            return;
        };
        let name = node.name();
        let is_valid = name.starts_with(b"--")
            || known_css_properties::ALL.binary_search_by(|it| it.as_bytes().cmp(name)).is_ok()
            || cx.state.test(name)
            || (self.ignore_prefixed && has_vendor_prefix(name));
        if is_valid {
            return;
        }
        let report = match (key.child(Role::Name), key.code(Role::Name)) {
            (Some(name), _) => cx.report(name, UNKNOWN),
            (None, Some(code)) => cx.report(code, UNKNOWN),
            (None, None) => return,
        };
        report.data("property", name);
    }
}

/// `/^-\w+-/u.test(name)`
fn has_vendor_prefix(name: &[u8]) -> bool {
    let Some(rest) = name.strip_prefix(b"-") else {
        return false;
    };
    let word = rest.iter().take_while(|it| it.is_ascii_alphanumeric() || **it == b'_').count();
    word > 0 && rest.get(word) == Some(&b'-')
}
