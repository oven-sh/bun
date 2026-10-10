use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Removed in eslint-plugin-react-hooks 7.1.0, which still has the name: it reports nothing.
pub struct ComponentHookFactories;

impl Rule for ComponentHookFactories {
    const META: Meta = Meta::plugin(
        Plugin::ReactHooks,
        "component-hook-factories",
        Kind::Suggestion,
    )
    .deprecated();
    const ON: On = On::new();
    no_state!();

    fn new(_: &Options) -> Self {
        ComponentHookFactories
    }
}
