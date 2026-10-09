use bun_lint_oxlint::ast_util::{as_function, callee_name, get_inner_expression, is_react_component_name};
use crate::react::{component_wrapper_functions, is_hoc_call, is_jsx};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::{SmallVec, smallvec};

/// Disallows using object, array, function, class, regex, JSX, or `new`-constructed values as default values for
/// destructured React component props.
pub struct NoObjectTypeAsDefaultProp;

const NO_OBJECT_TYPE_AS_DEFAULT_PROP: Message =
    Message::new("", "Do not use {{kind}} as default prop value. Use a stable reference instead.");

impl Rule for NoObjectTypeAsDefaultProp {
    const META: Meta = Meta::oxlint(Plugin::React, "no-object-type-as-default-prop", Kind::Suggestion);
    /// `settings.react.componentWrapperFunctions`
    type State<'a> = &'a [Json];

    fn new(_: &Options) -> Self {
        NoObjectTypeAsDefaultProp
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if !is_jsx(file) {
            return &[];
        }
        on.funcs(|_, func, cx| {
            let Some(first) = func.params().first().filter(|it| !it.is_rest() && it.pat().tag() != PatTag::Ident)
            else {
                return;
            };
            if !is_function_component(func, cx.state) {
                return;
            }
            // Every default in the pattern. That of the parameter itself is not looked at.
            let mut pending: SmallVec<[Pat<'a>; 4]> = smallvec![first.pat()];
            while let Some(pat) = pending.pop() {
                let check = |default: Option<Expr<'a>>| {
                    if let Some(right) = default.map(get_inner_expression)
                        && let Some(kind) = forbidden_default_kind(right)
                    {
                        cx.report(right, NO_OBJECT_TYPE_AS_DEFAULT_PROP).data("kind", kind);
                    }
                };
                match pat.kind() {
                    PatKind::Object(properties) => {
                        properties.iter().for_each(|it| check(it.default()));
                        pending.extend(properties.iter().map(PatProp::value));
                    }
                    PatKind::Array(elements) => {
                        elements.iter().for_each(|it| check(it.default()));
                        pending.extend(elements.iter().filter_map(PatElem::pat));
                    }
                    PatKind::Ident(_) | PatKind::Missing => {}
                }
            }
        });
        component_wrapper_functions(file)
    }
}

fn forbidden_default_kind(expr: Expr) -> Option<&'static str> {
    Some(match expr.tag() {
        ExprTag::Object => "an object literal",
        ExprTag::Array => "an array literal",
        ExprTag::Fn => "a function expression",
        ExprTag::Class => "a class expression",
        ExprTag::New => "a `new` expression",
        ExprTag::Regex => "a regular expression literal",
        ExprTag::Jsx => "a JSX element",
        _ => return None,
    })
}

fn is_function_component(func: Func, component_wrapper_functions: &[Json]) -> bool {
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
            .is_some_and(|name| is_hoc_call(name.bytes(), component_wrapper_functions)),
        _ => false,
    }
}
