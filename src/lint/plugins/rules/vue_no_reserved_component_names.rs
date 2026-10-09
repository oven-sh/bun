use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr, is_specific_id, static_property_name};
use bun_lint_oxlint::text::contains_name;
use crate::oxlint::vue::{
    VUE2_BUILTIN_COMPONENT_NAMES, VUE3_BUILTIN_COMPONENT_NAMES_EXTRA, VUE_RESERVED_DEPRECATED_HTML_ELEMENTS,
    VUE_RESERVED_HTML_ELEMENTS, VUE_RESERVED_KEBAB_CASE_ELEMENTS, VUE_RESERVED_SVG_ELEMENTS, as_inner_object_expression,
    find_property, is_vue_component_options_object_excluding_instance, is_vue_file, key_name, key_span,
    object_properties,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow Vue component names that collide with HTML / SVG element names (and optionally Vue built-in component names).
pub struct NoReservedComponentNames {
    disallow_vue_built_in_components: bool,
    disallow_vue3_built_in_components: bool,
    html_element_case_sensitive: bool,
}

const RESERVED: Message = Message::new("", "Name \"{{name}}\" is reserved.");
const RESERVED_IN_HTML: Message = Message::new("", "Name \"{{name}}\" is reserved in HTML.");
const RESERVED_IN_VUE: Message = Message::new("", "Name \"{{name}}\" is reserved in Vue.js.");
const RESERVED_IN_VUE3: Message = Message::new("", "Name \"{{name}}\" is reserved in Vue.js 3.x.");

impl Rule for NoReservedComponentNames {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-reserved-component-names", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoReservedComponentNames {
            disallow_vue_built_in_components: options.bool_or("disallowVueBuiltInComponents", false),
            disallow_vue3_built_in_components: options.bool_or("disallowVue3BuiltInComponents", false),
            html_element_case_sensitive: options.bool_or("htmlElementCaseSensitive", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !is_vue_file(file) {
            return;
        }
        if file.mentions_any(&["name", "components"]) {
            on.exprs([ExprTag::Object], |rule, e, cx| {
                if let ExprKind::Object(properties) = e.kind()
                    && is_vue_component_options_object_excluding_instance(e)
                {
                    rule.check_options_object(properties, cx);
                }
            });
        }
        if file.mentions_any(&["component", "defineOptions"]) {
            on.exprs([ExprTag::Call], |rule, e, cx| {
                let Some(call) = e.as_call() else {
                    return;
                };
                let first = call.args().first().filter(|it| it.tag() != ExprTag::Spread);
                let is_component = get_member_expr(call.callee()).and_then(static_property_name).is_some_and(|it| it.is("component"));
                if is_component && call.args().len() == 2 {
                    // Not `get_inner_expression`.
                    rule.check_name_expression(first.filter(|it| !it.is_parenthesized()), cx);
                } else if is_specific_id(call.callee(), "defineOptions") {
                    let name_prop = first.and_then(as_inner_object_expression).and_then(|it| find_property(it, "name"));
                    rule.check_name_expression(name_prop.and_then(Prop::value).map(get_inner_expression), cx);
                }
            });
        }
    }
}

fn lower_first_char(name: &[u8]) -> Option<Vec<u8>> {
    let (first, rest) = name.split_first().filter(|it| it.0.is_ascii_uppercase())?;
    Some([&[first.to_ascii_lowercase()][..], rest].concat())
}

/// `FontFace` -> `font-face`
fn pascal_to_kebab(name: &[u8]) -> Option<Vec<u8>> {
    let mut out = lower_first_char(name)?;
    let rest = out.split_off(1);
    for c in &rest {
        if c.is_ascii_uppercase() {
            out.push(b'-');
        }
        out.push(c.to_ascii_lowercase());
    }
    (out.len() > name.len()).then_some(out)
}

impl NoReservedComponentNames {
    fn check_options_object<'a>(&self, properties: List<'a, Prop<'a>>, cx: &Cx<'a, Self>) {
        self.check_name_expression(find_property(properties, "name").and_then(Prop::value).map(get_inner_expression), cx);
        let components = find_property(properties, "components").and_then(Prop::value).and_then(as_inner_object_expression);
        for prop in components.into_iter().flat_map(object_properties) {
            if let Some(name) = key_name(prop) {
                self.report_if_reserved(name, key_span(prop), cx);
            }
        }
    }

    fn check_name_expression<'a>(&self, expr: Option<Expr<'a>>, cx: &Cx<'a, Self>) {
        let name = expr.and_then(|it| match it.kind() {
            ExprKind::String(value) => Some(value),
            ExprKind::Template(template) => template.as_static(),
            _ => None,
        });
        if let (Some(expr), Some(name)) = (expr, name) {
            self.report_if_reserved(name, expr.span(), cx);
        }
    }

    fn report_if_reserved<'a>(&self, name: Name<'a>, span: Span, cx: &Cx<'a, Self>) {
        let bytes = name.bytes();
        let disallows_built_in = self.disallow_vue_built_in_components || self.disallow_vue3_built_in_components;
        let message = if self.is_reserved_html(bytes) {
            RESERVED_IN_HTML
        } else if disallows_built_in && contains_name(&VUE2_BUILTIN_COMPONENT_NAMES, bytes) {
            RESERVED_IN_VUE
        } else if self.disallow_vue3_built_in_components && contains_name(&VUE3_BUILTIN_COMPONENT_NAMES_EXTRA, bytes) {
            RESERVED_IN_VUE3
        } else if self.is_reserved_other(bytes) {
            RESERVED
        } else {
            return;
        };
        cx.report(span, message).data("name", name);
    }

    fn is_reserved_html(&self, name: &[u8]) -> bool {
        contains_name(&VUE_RESERVED_HTML_ELEMENTS, name)
            || !self.html_element_case_sensitive
                && lower_first_char(name).is_some_and(|lowered| contains_name(&VUE_RESERVED_HTML_ELEMENTS, &lowered))
    }

    fn is_reserved_other(&self, name: &[u8]) -> bool {
        contains_name(&VUE_RESERVED_DEPRECATED_HTML_ELEMENTS, name)
            || contains_name(&VUE_RESERVED_KEBAB_CASE_ELEMENTS, name)
            || contains_name(&VUE_RESERVED_SVG_ELEMENTS, name)
            || !self.html_element_case_sensitive
                && (lower_first_char(name).is_some_and(|lowered| {
                    contains_name(&VUE_RESERVED_DEPRECATED_HTML_ELEMENTS, &lowered)
                        || contains_name(&VUE_RESERVED_SVG_ELEMENTS, &lowered) && lowered.iter().all(u8::is_ascii_lowercase)
                }) || pascal_to_kebab(name).is_some_and(|kebab| contains_name(&VUE_RESERVED_KEBAB_CASE_ELEMENTS, &kebab)))
    }
}
