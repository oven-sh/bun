use crate::react::{component_wrapper_functions, is_hoc_call, is_jsx};
use crate::util_ast::name_of_key;
use crate::util_components::Components;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::{as_function, callee_name, get_inner_expression, is_react_component_name};
use smallvec::{SmallVec, smallvec};

/// Disallow usage of referential-type variables as default param in functional component
pub struct NoObjectTypeAsDefaultProp;

const FORBIDDEN_TYPE_DEFAULT_PARAM: Message = Message::new(
    "forbiddenTypeDefaultParam",
    "{{propName}} has a/an {{forbiddenType}} as default prop. This could lead to potential infinite render loop in React. Use a variable reference instead of {{forbiddenType}}.",
);
const NO_OBJECT_TYPE_AS_DEFAULT_PROP: Message =
    Message::new("", "Do not use {{kind}} as default prop value. Use a stable reference instead.");

pub struct State<'a> {
    /// `settings.react.componentWrapperFunctions`, for oxlint, which goes by the name and by what the function is in.
    component_wrapper_functions: &'a [Json],
    components: Components<'a>,
}

/// A default that is reported if the function is a component.
struct Forbidden<'a> {
    right: Expr<'a>,
    kind: &'static str,
    /// `None`: it is in an array.
    property: Option<PatProp<'a>>,
}

impl Rule for NoObjectTypeAsDefaultProp {
    const META: Meta = Meta::plugin(Plugin::React, "no-object-type-as-default-prop", Kind::None);
    const ON: On = On::new().funcs();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoObjectTypeAsDefaultProp
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        // oxlint looks at files that can have JSX.
        let is_candidate = if file.language().is_oxlint { is_jsx(file) } else { Components::may_have_any(file) };
        is_candidate.then(|| State {
            component_wrapper_functions: component_wrapper_functions(file),
            components: Components::new(file),
        })
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        let Some(first) = func.params().first().filter(|it| !it.is_rest()) else {
            return;
        };
        let has_used_destructuring_syntax = match (first.pat().tag(), is_oxlint) {
            // oxlint: an array as well. The default of the parameter itself is not looked at.
            (tag, true) => tag != PatTag::Ident,
            (PatTag::Object, false) => {
                first.default().is_none() && !first.is_parameter_property() && func.this_param().is_none()
            }
            _ => false,
        };
        if !has_used_destructuring_syntax {
            return;
        }
        // oxlint looks through parentheses and TypeScript's wrappers.
        let forbidden = |default: Option<Expr<'a>>, property: Option<PatProp<'a>>| {
            let right = default.map(|it| if is_oxlint { get_inner_expression(it) } else { it })?;
            Some(Forbidden { right, kind: forbidden_default_kind(right, is_oxlint)?, property })
        };
        let mut found: SmallVec<[Forbidden<'a>; 4]> = SmallVec::new();
        let mut pending: SmallVec<[Pat<'a>; 4]> = smallvec![first.pat()];
        while let Some(pat) = pending.pop() {
            match pat.kind() {
                PatKind::Object(properties) => {
                    found.extend(properties.iter().filter_map(|it| forbidden(it.default(), Some(it))));
                    // oxlint: every default in the pattern.
                    if is_oxlint {
                        pending.extend(properties.iter().map(PatProp::value));
                    }
                }
                PatKind::Array(elements) => {
                    found.extend(elements.iter().filter_map(|it| forbidden(it.default(), None)));
                    pending.extend(elements.iter().filter_map(PatElem::pat));
                }
                PatKind::Ident(_) | PatKind::Missing => {}
            }
        }
        if found.is_empty() || !is_function_component(func, cx) {
            return;
        }
        for Forbidden { right, kind, property } in found {
            match property.filter(|_| !is_oxlint) {
                // The `AssignmentPattern`
                Some(property) => cx
                    .report(Span::new(property.value().span().start, property.span().end), FORBIDDEN_TYPE_DEFAULT_PARAM)
                    .data("propName", property.key().and_then(name_of_key).unwrap_or(&b"undefined"[..]))
                    .data("forbiddenType", kind)
                    .at_the_end(),
                // oxlint points at the value.
                None => cx.report(right, NO_OBJECT_TYPE_AS_DEFAULT_PROP).data("kind", kind),
            };
        }
    }
}

/// upstream's `FORBIDDEN_TYPES_MAP`, and the two that it asks for before.
fn forbidden_default_kind(expr: Expr, is_oxlint: bool) -> Option<&'static str> {
    let (oxlint, upstream) = match expr.kind() {
        ExprKind::Object(_) => ("an object literal", "object literal"),
        ExprKind::Array(_) => ("an array literal", "array literal"),
        ExprKind::Fn(func) if func.is_arrow() => ("a function expression", "arrow function"),
        ExprKind::Fn(_) => ("a function expression", "function expression"),
        ExprKind::Class(_) => ("a class expression", "class expression"),
        ExprKind::New(_) => ("a `new` expression", "construction expression"),
        ExprKind::Regex(_) => ("a regular expression literal", "regex literal"),
        // Upstream passes over a fragment.
        ExprKind::Jsx(jsx) if is_oxlint || !jsx.is_fragment() => ("a JSX element", "JSX element"),
        // oxlint passes over it.
        ExprKind::Call(call) if !is_oxlint && !expr.is_chain_root() && call.callee().is_ident("Symbol") => {
            ("", "Symbol literal")
        }
        _ => return None,
    };
    Some(if is_oxlint { oxlint } else { upstream })
}

fn is_function_component<'a>(func: Func<'a>, cx: &mut Cx<'a, NoObjectTypeAsDefaultProp>) -> bool {
    if !cx.language().is_oxlint {
        // All is asked when the program ends: it is in `components.list()`.
        let components = &mut cx.state.components;
        components.finish();
        let component = components.get(Node::Func(func)).map(|id| components.component(id));
        return component.is_some_and(|it| it.confidence >= 2 && it.node == Node::Func(func));
    }
    if as_function(Node::Func(func)).is_none() {
        return false;
    }
    if func.name().is_some_and(|name| is_react_component_name(name.bytes())) {
        return true;
    }
    let Node::Expr(e) = func.owner() else {
        return false;
    };
    match e.parent() {
        Node::VarDecl(declarator) => {
            declarator.pat().as_ident().is_some_and(|name| is_react_component_name(name.bytes()))
        }
        Node::Expr(parent) => (parent.as_call().and_then(callee_name))
            .is_some_and(|name| is_hoc_call(name.bytes(), cx.state.component_wrapper_functions)),
        _ => false,
    }
}
