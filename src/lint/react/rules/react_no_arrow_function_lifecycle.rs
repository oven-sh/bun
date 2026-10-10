use crate::util_ast::{Property, get_component_properties};
use crate::util_components::Components;
use crate::util_lifecycle_methods::{INSTANCE, STATIC};
use crate::util_pragma::get_create_class_from_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Lifecycle methods should be methods on the prototype, not class fields
pub struct NoArrowFunctionLifecycle;

const LIFECYCLE: Message = Message::new(
    "lifecycle",
    "{{propertyName}} is a React lifecycle method, and should not be an arrow function or in a class field. \
     Use an instance method instead.",
);

fn mentions_create_class<'a>(file: &'a File<'a>) -> bool {
    std::str::from_utf8(get_create_class_from_context(file)).is_ok_and(|it| file.mentions(it))
}

impl Rule for NoArrowFunctionLifecycle {
    const META: Meta = Meta::plugin(Plugin::React, "no-arrow-function-lifecycle", Kind::Suggestion)
        .fixable(Fixable::Code)
        .reports_at_the_end();
    const ON: On = On::new().members().props().finish();
    /// Whether something with the name of a lifecycle method is an arrow function: few files need the components.
    type State<'a> = bool;

    fn new(_: &Options) -> Self {
        NoArrowFunctionLifecycle
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().members().finish();
        if mentions_create_class(file) { on.props() } else { on }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<bool> {
        ((file.has_classes() || mentions_create_class(file)) && Components::may_have_any(file)).then_some(false)
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        cx.state = cx.state || arrow_function_of_lifecycle_method(Property::Member(member)).is_some();
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        cx.state = cx.state || arrow_function_of_lifecycle_method(Property::Prop(prop)).is_some();
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        if !cx.state {
            return;
        }
        let mut components = Components::new(cx.file());
        components.finish();
        for id in components.list() {
            for node in get_component_properties(components.component(id).node) {
                if let Some(value) = arrow_function_of_lifecycle_method(node)
                    && let Some(key) = node.key()
                    && let Some(property_name) = node.name()
                {
                    cx.report(node.node(), LIFECYCLE)
                        .data("propertyName", property_name)
                        .fix(|fixer| fix(fixer, node, key, value));
                }
            }
        }
    }
}

/// `node.value`, if upstream's `reportNoArrowFunctionLifecycle` reports `node`. At an `accessor` upstream throws.
fn arrow_function_of_lifecycle_method(node: Property<'_>) -> Option<Func<'_>> {
    let value = node.value()?.as_fn().filter(|it| it.is_arrow())?;
    if matches!(node, Property::Member(it) if !ast_utils::is_property_definition(it)) {
        return None;
    }
    let methods: &[&str] = if node.is_static() { &STATIC } else { &INSTANCE };
    let property_name = node.name()?;
    methods.iter().any(|it| it.as_bytes() == property_name).then_some(value)
}

#[cold]
#[inline(never)]
fn fix<'a>(fixer: Fixer<'a>, node: Property<'a>, key: Key<'a>, value: Func<'a>) -> Option<Fix> {
    let file = fixer.file();
    // upstream's `getRuleText`
    let mut replacement = match node {
        Property::Prop(_) => b": function(".to_vec(),
        Property::Member(_) => b"(".to_vec(),
    };
    for (i, param) in value.params_with_this().enumerate() {
        if i > 0 {
            replacement.extend_from_slice(b", ");
        }
        // Only an `Identifier` has a `name`.
        if !param.is_rest()
            && param.default().is_none()
            && let Some(name) = param.pat().as_ident()
        {
            replacement.extend_from_slice(name.bytes());
        }
    }
    replacement.extend_from_slice(b") ");
    let key = key.inner_span(file);
    let FnBody::Expr(body) = value.body() else {
        return Some(fixer.replace(key.between(value.body_span()?), replacement));
    };
    replacement.extend_from_slice(b"{ return ");
    for comment in file.comments_before(body) {
        replacement.extend_from_slice(comment.text());
    }
    replacement.extend_from_slice(body.text());
    let mut last = body.span();
    for comment in file.comments_after(body) {
        replacement.extend_from_slice(comment.text());
        last = comment.span();
    }
    replacement.extend_from_slice(b"; }");
    // The parenthesis after an object literal.
    let is_wrapped = body.tag() == ExprTag::Object;
    let has_semi = file.slice(Span::after(value.estree_span(), node.node().span().end)) == b";";
    Some(fixer.replace(Span::after(key, last.end + u32::from(is_wrapped) + u32::from(has_semi)), replacement))
}
