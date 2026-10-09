use bun_lint_oxlint::ast_util::get_inner_expression;
use crate::oxlint::vue::{EnclosingFunctions, is_in_vue_component_instance_method, is_this_object};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow using deprecated Events API (`$on`, `$off`, `$once`) in Vue.js 3.0.0+.
pub struct NoDeprecatedEventsApi;

const NO_DEPRECATED_EVENTS_API: Message = Message::new("", "The Events api `$on`, `$off`, `$once` is deprecated.");

impl Rule for NoDeprecatedEventsApi {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-deprecated-events-api", Kind::Problem);
    type State<'a> = EnclosingFunctions<'a>;

    fn new(_: &Options) -> Self {
        NoDeprecatedEventsApi
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if file.mentions_any(&["$on", "$off", "$once"]) {
            on.exprs([ExprTag::Call], |_, e, cx| {
                // `this.$on?.()` asks whether it is there.
                if !e.is_optional()
                    && let Some(callee) = e.callee().map(get_inner_expression)
                    && let ExprKind::Dot { obj, name, .. } = callee.kind()
                    && name.name().is_any(&["$on", "$off", "$once"])
                    && is_this_object(obj)
                    && is_in_vue_component_instance_method(e, &mut cx.state)
                {
                    cx.report(name, NO_DEPRECATED_EVENTS_API);
                }
            });
        }
        EnclosingFunctions::default()
    }
}
