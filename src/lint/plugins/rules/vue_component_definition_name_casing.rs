use bun_lint_oxlint::ast_util::{as_object_expression, get_inner_expression, is_specific_id, static_property_name};
use crate::oxlint::vue::{casing, find_property, is_vue_component_options_object, is_vue_setup};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce specific casing for component definition names.
pub struct ComponentDefinitionNameCasing {
    is_kebab_case: bool,
}

const COMPONENT_DEFINITION_NAME_CASING: Message = Message::new("", "Property name \"{{value}}\" is not {{case_type}}.");

impl Rule for ComponentDefinitionNameCasing {
    const META: Meta = Meta::oxlint(Plugin::Vue, "component-definition-name-casing", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ComponentDefinitionNameCasing { is_kebab_case: options.str(0) == Some("kebab-case") }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.mentions("component") || is_vue_setup(file) && file.mentions("defineOptions") {
            on.exprs([ExprTag::Call], |rule, e, cx| {
                let Some(call) = e.as_call() else {
                    return;
                };
                let first = call.args().first().filter(|it| it.tag() != ExprTag::Spread);
                // `defineOptions({ name: ".." })`
                if is_vue_setup(cx.file())
                    && is_specific_id(call.callee(), "defineOptions")
                    && let Some(properties) = first.and_then(as_object_expression)
                {
                    return rule.check_name_property(properties, cx);
                }
                // `Vue.component("Name", ..)`, `app.component("Name", ..)`
                let callee = get_inner_expression(call.callee());
                let is_component = !callee.is_chain_root() && static_property_name(callee).is_some_and(|it| it.is("component"));
                if is_component && call.args().len() == 2 {
                    rule.check_name_node(first, cx);
                }
            });
        }
        if file.mentions("name") {
            on.exprs([ExprTag::Object], |rule, e, cx| {
                if let ExprKind::Object(properties) = e.kind()
                    && is_vue_component_options_object(e)
                {
                    rule.check_name_property(properties, cx);
                }
            });
        }
    }
}

impl ComponentDefinitionNameCasing {
    fn check_name_property<'a>(&self, properties: List<'a, Prop<'a>>, cx: &Cx<'a, Self>) {
        self.check_name_node(find_property(properties, "name").and_then(Prop::value), cx);
    }

    fn check_case(&self, s: &[u8]) -> bool {
        if self.is_kebab_case { casing::is_kebab_case(s) } else { casing::is_pascal_case(s) }
    }

    fn check_name_node<'a>(&self, expr: Option<Expr<'a>>, cx: &Cx<'a, Self>) {
        let Some(inner) = expr.map(get_inner_expression) else {
            return;
        };
        let value = match inner.kind() {
            ExprKind::String(value) => Some(value),
            ExprKind::Template(template) => template.as_static(),
            _ => None,
        };
        let Some(value) = value.filter(|it| !self.check_case(it.bytes())) else {
            return;
        };
        let case_type = if self.is_kebab_case { "kebab-case" } else { "PascalCase" };
        cx.report(inner, COMPONENT_DEFINITION_NAME_CASING).data("value", value).data("case_type", case_type).fix(|fixer| {
            let converted = if self.is_kebab_case { casing::kebab_case(value.bytes()) } else { casing::pascal_case(value.bytes()) };
            self.check_case(&converted).then(|| fixer.replace(inner.span().shrink(1, 1), converted))
        });
    }
}
