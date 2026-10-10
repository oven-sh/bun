use bun_lint_oxlint::ast_util::{get_inner_expression, is_specific_id, static_name, static_string};
use crate::oxlint::vue::{
    NamedTypeBudget, casing, first_type_argument, for_each_define_props_type_signature, is_specific_static_name,
    is_vue_component_options_object, is_vue_file, is_vue_setup, key_name, key_span, object_of, object_properties,
    signature_key, span_of_key,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow reserved attribute names (e.g. `key`, `ref`) from being used as prop names.
pub struct NoReservedProps {
    is_vue2: bool,
}

const NO_RESERVED_PROPS: Message = Message::new("", "'{{prop_name}}' is a reserved attribute and cannot be used as props.");

impl Rule for NoReservedProps {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-reserved-props", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Call]).props();
    type State<'a> = NamedTypeBudget;

    fn new(options: &Options) -> Self {
        NoReservedProps { is_vue2: options.object(0).number("vueVersion") == Some(2.0) }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if file.mentions("props") {
            on = on.props();
        }
        if is_vue_setup(file) && file.mentions("defineProps") {
            on = on.exprs(&[ExprTag::Call]);
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<NamedTypeBudget> {
        is_vue_file(file).then(NamedTypeBudget::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call().filter(|it| is_specific_id(it.callee(), "defineProps")) else {
            return;
        };
        match call.args().first().filter(|it| it.tag() != ExprTag::Spread) {
            Some(arg) => self.check_props(Some(arg), cx),
            None => {
                if let Some(first) = first_type_argument(call) {
                    for_each_define_props_type_signature(first, &cx.state, &mut |signature| {
                        if let Some(key) = signature_key(signature)
                            && let Some(name) = static_name(key)
                        {
                            self.report(name, span_of_key(key, cx.file()), cx);
                        }
                    });
                }
            }
        }
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if prop.kind() != PropKind::Spread
            && is_specific_static_name(prop, "props")
            && object_of(prop).is_some_and(is_vue_component_options_object)
        {
            self.check_props(prop.value(), cx);
        }
    }
}

impl NoReservedProps {
    fn report<'a>(&self, name: Name<'a>, span: Span, cx: &Cx<'a, Self>) {
        if name.is_any(&["key", "ref"]) || self.is_vue2 && name.is_any(&["is", "slot", "slot-scope", "slotScope", "class", "style"]) {
            cx.report(span, NO_RESERVED_PROPS).data("prop_name", casing::kebab_case(name.bytes()));
        }
    }

    /// `["a", "b"]`, `{ a: .., b: .. }`
    fn check_props<'a>(&self, props: Option<Expr<'a>>, cx: &Cx<'a, Self>) {
        match props.map(|it| get_inner_expression(it).kind()) {
            Some(ExprKind::Array(elements)) => {
                for element in elements.iter().map(get_inner_expression) {
                    if let Some(name) = static_string(element) {
                        self.report(name, element.span(), cx);
                    }
                }
            }
            Some(ExprKind::Object(properties)) => {
                for prop in object_properties(properties) {
                    if let Some(name) = key_name(prop) {
                        self.report(name, key_span(prop), cx);
                    }
                }
            }
            _ => {}
        }
    }
}
