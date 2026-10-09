use bun_lint_oxlint::ast_util::{get_inner_expression, is_specific_id, static_name};
use crate::oxlint::vue::{
    NamedTypeBudget, first_type_argument, for_each_define_props_type_signature, is_vue_component_options_object,
    is_vue_file, is_vue_setup, key_name, key_span, object_of, object_properties, signature_key, span_of_key,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow overwriting reserved Vue instance keys (e.g. `$data`, `$emit`) or using `_`-prefixed keys inside `data` / `asyncData`.
pub struct NoReservedKeys {
    reserved: Vec<Box<[u8]>>,
    groups: Vec<Box<[u8]>>,
}

const RESERVED_KEY: Message = Message::new("", "Key `{{name}}` is reserved.");
const STARTS_WITH_UNDERSCORE: Message = Message::new("", "Key `{{key}}` is reserved in `{{group}}` group.");

const RESERVED_KEYS: [&str; 24] = [
    "$data", "$props", "$el", "$options", "$parent", "$root", "$children", "$slots", "$scopedSlots", "$refs", "$isServer",
    "$attrs", "$listeners", "$watch", "$set", "$delete", "$on", "$once", "$off", "$emit", "$mount", "$forceUpdate", "$nextTick",
    "$destroy",
];

impl Rule for NoReservedKeys {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-reserved-keys", Kind::Problem);
    type State<'a> = NamedTypeBudget;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let owned = |key: &str| options.strings(key).iter().map(|it| it.as_bytes().into()).collect();
        NoReservedKeys { reserved: owned("reserved"), groups: owned("groups") }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> NamedTypeBudget {
        if !is_vue_file(file) {
            return NamedTypeBudget::default();
        }
        on.props(Self::check_group);
        if is_vue_setup(file) && file.mentions("defineProps") {
            on.exprs([ExprTag::Call], |rule, e, cx| {
                if let Some(call) = e.as_call().filter(|it| is_specific_id(it.callee(), "defineProps")) {
                    rule.check_define_props(call, cx);
                }
            });
        }
        NamedTypeBudget::default()
    }
}

impl NoReservedKeys {
    fn is_target_group(&self, group: Name) -> bool {
        group.is_any(&["props", "data", "asyncData", "computed", "methods", "setup"])
            || self.groups.iter().any(|it| **it == *group.bytes())
    }

    fn is_reserved(&self, name: Name) -> bool {
        name.is_any(&RESERVED_KEYS) || self.reserved.iter().any(|it| **it == *name.bytes())
    }

    fn report_if_reserved<'a>(&self, name: Name<'a>, span: Span, cx: &Cx<'a, Self>) -> bool {
        let is_reserved = self.is_reserved(name);
        if is_reserved {
            cx.report(span, RESERVED_KEY).data("name", name);
        }
        is_reserved
    }

    /// `["a", "b"]`
    fn check_elements<'a>(&self, elements: List<'a, Expr<'a>>, cx: &Cx<'a, Self>) {
        for element in elements.iter().filter(|it| !it.is_parenthesized()) {
            if let ExprKind::String(value) = element.kind() {
                self.report_if_reserved(value, element.span(), cx);
            }
        }
    }

    fn check_keys<'a>(&self, group: Name<'a>, object: Expr<'a>, cx: &Cx<'a, Self>) {
        let ExprKind::Object(properties) = get_inner_expression(object).kind() else {
            return;
        };
        for prop in object_properties(properties) {
            if let Some(name) = key_name(prop)
                && !self.report_if_reserved(name, key_span(prop), cx)
                && group.is_any(&["data", "asyncData"])
                && name.bytes().starts_with(b"_")
            {
                cx.report(key_span(prop), STARTS_WITH_UNDERSCORE).data("key", name).data("group", group);
            }
        }
    }

    fn check_group<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if prop.kind() == PropKind::Spread {
            return;
        }
        let Some(group) = key_name(prop).filter(|it| self.is_target_group(*it)) else {
            return;
        };
        let Some(value) = prop.value().filter(|_| object_of(prop).is_some_and(is_vue_component_options_object)) else {
            return;
        };
        let value = get_inner_expression(value);
        match value.kind() {
            ExprKind::Array(elements) => self.check_elements(elements, cx),
            ExprKind::Object(_) => self.check_keys(group, value, cx),
            ExprKind::Fn(func) => match func.body() {
                FnBody::Expr(e) => self.check_keys(group, e, cx),
                FnBody::Block(statements) => {
                    for stmt in statements {
                        if let StmtKind::Return(Some(returned)) = stmt.kind() {
                            self.check_keys(group, returned, cx);
                        }
                    }
                }
                FnBody::None => {}
            },
            _ => {}
        }
    }

    fn check_define_props<'a>(&self, call: Call<'a>, cx: &Cx<'a, Self>) {
        let Some(arg) = call.args().first().filter(|it| it.tag() != ExprTag::Spread) else {
            if let Some(first) = first_type_argument(call) {
                for_each_define_props_type_signature(first, &cx.state, &mut |signature| {
                    if let Some(key) = signature_key(signature)
                        && let Some(name) = static_name(key)
                    {
                        self.report_if_reserved(name, span_of_key(key, cx.file()), cx);
                    }
                });
            }
            return;
        };
        match get_inner_expression(arg).kind() {
            ExprKind::Array(elements) => self.check_elements(elements, cx),
            ExprKind::Object(properties) => {
                for prop in object_properties(properties) {
                    if let Some(name) = key_name(prop) {
                        self.report_if_reserved(name, key_span(prop), cx);
                    }
                }
            }
            _ => {}
        }
    }
}
