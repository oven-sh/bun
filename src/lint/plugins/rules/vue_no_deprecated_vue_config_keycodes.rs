use bun_lint_oxlint::ast_util::{get_member_expr, is_specific_id, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow using deprecated `Vue.config.keyCodes` (in Vue.js 3.0.0+).
pub struct NoDeprecatedVueConfigKeycodes;

const NO_DEPRECATED_VUE_CONFIG_KEYCODES: Message = Message::new("", "`Vue.config.keyCodes` are deprecated.");

impl Rule for NoDeprecatedVueConfigKeycodes {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-deprecated-vue-config-keycodes", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Dot]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDeprecatedVueConfigKeycodes
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("keyCodes") || !file.mentions("Vue") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, outer: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Dot { obj, name, .. } = outer.kind()
            && name.name().is("keyCodes")
            && let Some(middle) = get_member_expr(obj)
            && static_property_name(middle).is_some_and(|it| it.is("config"))
            && middle.object().is_some_and(|it| is_specific_id(it, "Vue"))
            && !outer.is_jsx_tag_name()
            && !outer.is_in_type_query()
        {
            cx.report(outer, NO_DEPRECATED_VUE_CONFIG_KEYCODES);
        }
    }
}
