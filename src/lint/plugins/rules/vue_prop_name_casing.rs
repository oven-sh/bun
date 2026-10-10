use bun_lint_oxlint::ast_util::{get_inner_expression, is_specific_id, static_name};
use bun_lint_oxlint::regex_flags::rust_regex;
use crate::oxlint::vue::{
    NamedTypeBudget, casing, find_property, first_type_argument, for_each_define_props_type_signature,
    is_vue_component_options_object_excluding_instance, is_vue_setup, key_span, object_properties, signature_key,
    span_of_key,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce a specific casing (camelCase or snake_case) for Vue component prop names.
pub struct PropNameCasing {
    is_snake_case: bool,
    ignore_props: Vec<Regex>,
}

const PROP_NAME_CASING: Message = Message::new("", "Prop '{{name}}' is not in {{case_type}}.");

impl Rule for PropNameCasing {
    const META: Meta = Meta::oxlint(Plugin::Vue, "prop-name-casing", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Object, ExprTag::Call]);
    type State<'a> = NamedTypeBudget;

    fn new(options: &Options) -> Self {
        let regex = |pattern: &&str| rust_regex(pattern, false);
        PropNameCasing {
            is_snake_case: options.str(0) == Some("snake_case"),
            ignore_props: options.object(1).strings("ignoreProps").iter().filter_map(regex).collect(),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if file.mentions("props") {
            on = on.exprs(&[ExprTag::Object]);
        }
        if is_vue_setup(file) && file.mentions("defineProps") {
            on = on.exprs(&[ExprTag::Call]);
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<NamedTypeBudget> {
        Some(NamedTypeBudget::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Object => {
                if let ExprKind::Object(properties) = e.kind()
                    && is_vue_component_options_object_excluding_instance(e)
                {
                    self.check_props_value(find_property(properties, "props").and_then(Prop::value), cx);
                }
            }
            ExprTag::Call => self.call(e, cx),
            _ => {}
        }
    }
}

/// The name of a key that is an identifier, a string or a regular expression, and where it is written.
fn property_key_static_name(prop: Prop<'_>) -> Option<(&[u8], Span)> {
    match prop.key()?.kind() {
        KeyKind::Ident(name) | KeyKind::String(name) | KeyKind::ComputedString(name) => Some((name.bytes(), key_span(prop))),
        KeyKind::Computed(e) => {
            let e = get_inner_expression(e);
            match e.kind() {
                ExprKind::String(value) => Some((value.bytes(), e.span())),
                ExprKind::Template(template) => Some((template.as_static()?.bytes(), e.span())),
                ExprKind::Regex(_) => Some((e.text(), e.span())),
                _ => None,
            }
        }
        _ => None,
    }
}

impl PropNameCasing {
    fn call<'a>(&self, e: Expr<'a>, cx: &Cx<'a, Self>) {
        let Some(call) = e.as_call().filter(|it| is_specific_id(it.callee(), "defineProps")) else {
            return;
        };
        if let Some(arg) = call.args().first().filter(|it| it.tag() != ExprTag::Spread) {
            self.check_props_value(Some(arg), cx);
        } else if let Some(first_type) = first_type_argument(call) {
            for_each_define_props_type_signature(first_type, &cx.state, &mut |signature| {
                if let Some(key) = signature_key(signature)
                    && let Some(name) = static_name(key)
                {
                    self.report_if_invalid(name.bytes(), span_of_key(key, cx.file()), cx);
                }
            });
        }
    }

    fn check_props_value<'a>(&self, expr: Option<Expr<'a>>, cx: &Cx<'a, Self>) {
        match expr.map(|it| get_inner_expression(it).kind()) {
            Some(ExprKind::Array(elements)) => {
                for element in elements.iter().filter(|it| !it.is_parenthesized()) {
                    if let ExprKind::String(value) = element.kind() {
                        self.report_if_invalid(value.bytes(), element.span(), cx);
                    }
                }
            }
            Some(ExprKind::Object(properties)) => {
                for (name, span) in object_properties(properties).filter_map(property_key_static_name) {
                    self.report_if_invalid(name, span, cx);
                }
            }
            _ => {}
        }
    }

    fn report_if_invalid<'a>(&self, name: &'a [u8], span: Span, cx: &Cx<'a, Self>) {
        let is_valid = if self.is_snake_case { casing::is_snake_case(name) } else { casing::is_camel_case(name) };
        if !is_valid && !self.ignore_props.iter().any(|it| it.test(name)) {
            let case_type = if self.is_snake_case { "snake_case" } else { "camelCase" };
            cx.report(span, PROP_NAME_CASING).data("name", name).data("case_type", case_type);
        }
    }
}
