use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    get_well_known_symbol_property_of_type, is_object_flag_set, is_object_type, type_constituents,
    union_constituents,
};
use bun_lint::types::utils::{
    TypeOrValueSpecifier, get_constrained_type_at_location, is_builtin_symbol_like,
    is_higher_precedence_than_await, is_promise_like, is_type_flag_set,
    parse_type_or_value_specifiers, type_matches_some_specifier,
};
use bun_lint::types::{ObjectFlags, SyntaxKind, Type, TypeFlags};
use bun_lint::utils::ts_utils::{WrappingFixerParams, get_wrapping_fixer};

/// Disallow using the spread operator when it might cause unexpected behavior.
pub struct NoMisusedSpread {
    allow: Vec<TypeOrValueSpecifier>,
}

const ADD_AWAIT: Message = Message::new("addAwait", "Add await operator.");
const NO_ARRAY_SPREAD_IN_OBJECT: Message = Message::new(
    "noArraySpreadInObject",
    "Using the spread operator on an array in an object will result in a list of indices.",
);
const NO_CLASS_DECLARATION_SPREAD_IN_OBJECT: Message = Message::new(
    "noClassDeclarationSpreadInObject",
    "Using the spread operator on class declarations will spread only their static properties, and will lose their class prototype.",
);
const NO_CLASS_INSTANCE_SPREAD_IN_OBJECT: Message = Message::new(
    "noClassInstanceSpreadInObject",
    "Using the spread operator on class instances will lose their class prototype.",
);
const NO_FUNCTION_SPREAD_IN_OBJECT: Message = Message::new(
    "noFunctionSpreadInObject",
    "Using the spread operator on a function without additional properties can cause unexpected behavior. Did you forget to call the function?",
);
const NO_ITERABLE_SPREAD_IN_OBJECT: Message = Message::new(
    "noIterableSpreadInObject",
    "Using the spread operator on an Iterable in an object can cause unexpected behavior.",
);
const NO_MAP_SPREAD_IN_OBJECT: Message = Message::new(
    "noMapSpreadInObject",
    "Using the spread operator on a Map in an object will result in an empty object. Did you mean to use `Object.fromEntries(map)` instead?",
);
const NO_PROMISE_SPREAD_IN_OBJECT: Message = Message::new(
    "noPromiseSpreadInObject",
    "Using the spread operator on Promise in an object can cause unexpected behavior. Did you forget to await the promise?",
);
const NO_STRING_SPREAD: Message = Message::new(
    "noStringSpread",
    "Using the spread operator on a string can mishandle special characters, as can `.split(\"\")`.\n\
     - `...` produces Unicode code points, which will decompose complex emojis into individual emojis\n\
     - .split(\"\") produces UTF-16 code units, which breaks rich characters in many languages\n\
     Consider using `Intl.Segmenter` for locale-aware string decomposition.\n\
     Otherwise, if you don't need to preserve emojis or other non-Ascii characters, disable this lint rule on this line or configure the 'allow' rule option.",
);
const REPLACE_MAP_SPREAD_IN_OBJECT: Message = Message::new(
    "replaceMapSpreadInObject",
    "Replace map spread in object with `Object.fromEntries()`",
);

fn is_type_recurser<'a>(ty: Type<'a>, predicate: &impl Fn(Type<'a>) -> bool) -> bool {
    if ty.is_union_or_intersection() {
        return ty.types().iter().any(|t| is_type_recurser(t, predicate));
    }
    predicate(ty)
}

fn is_iterable(ty: Type) -> bool {
    type_constituents(ty).iter().any(|t| get_well_known_symbol_property_of_type(t, "iterator").is_some())
}

fn is_array(ty: Type) -> bool {
    is_type_recurser(ty, &|t| t.is_array_type() || t.is_tuple_type())
}

fn is_string(ty: Type) -> bool {
    is_type_recurser(ty, &|t| is_type_flag_set(t, TypeFlags::STRING_LIKE))
}

fn is_function_without_props(ty: Type) -> bool {
    is_type_recurser(ty, &|t| !t.get_call_signatures().is_empty() && t.get_properties().is_empty())
}

fn is_promise(ty: Type) -> bool {
    is_type_recurser(ty, &is_promise_like)
}

fn is_class_instance(ty: Type) -> bool {
    is_type_recurser(ty, &|t| {
        // A type that has a construct signature itself is a class, or like one.
        if !t.get_construct_signatures().is_empty() {
            return false;
        }
        // If its symbol has one, the type is an instance.
        t.get_symbol().is_some_and(|symbol| {
            symbol
                .declarations()
                .any(|declaration| !symbol.get_type_at_location(declaration).get_construct_signatures().is_empty())
        })
    })
}

fn is_class_declaration(ty: Type) -> bool {
    is_type_recurser(ty, &|t| {
        if is_object_type(t) && is_object_flag_set(t, ObjectFlags::INSTANTIATION_EXPRESSION_TYPE) {
            return true;
        }
        let kind = t.get_symbol().and_then(|symbol| symbol.value_declaration()).map(|it| it.kind());
        matches!(kind, Some(SyntaxKind::ClassDeclaration | SyntaxKind::ClassExpression))
    })
}

fn is_map(ty: Type) -> bool {
    is_type_recurser(ty, &|t| is_builtin_symbol_like(t, &["Map", "ReadonlyMap", "WeakMap"]))
}

fn is_iterable_map(ty: Type) -> bool {
    is_type_recurser(ty, &|t| is_builtin_symbol_like(t, &["Map", "ReadonlyMap"]))
}

impl NoMisusedSpread {
    fn check_array_or_call_spread<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Spread(argument) = node.kind() else {
            return;
        };
        let Node::Expr(parent) = node.parent() else {
            return;
        };
        match parent.kind() {
            ExprKind::Call(_) => {}
            // In an `ArrayPattern` it is a `RestElement`.
            ExprKind::Array(_) if !parent.is_assignment_target() => {}
            _ => return,
        }
        let ty = get_constrained_type_at_location(argument);
        if is_string(ty) && !type_matches_some_specifier(ty, &self.allow) {
            cx.report(node, NO_STRING_SPREAD);
        }
    }

    fn check_object_spread<'a>(&self, node: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if node.kind() != PropKind::Spread {
            return;
        }
        let (Some(argument), Node::Expr(parent)) = (node.value(), node.parent()) else {
            return;
        };
        // In an `ObjectPattern` it is a `RestElement`.
        if !node.is_jsx_attribute() && parent.is_assignment_target() {
            return;
        }
        let ty = get_constrained_type_at_location(argument);
        if type_matches_some_specifier(ty, &self.allow) {
            return;
        }

        if is_promise(ty) {
            cx.report(node, NO_PROMISE_SPREAD_IN_OBJECT).suggest(ADD_AWAIT, |fixer| {
                match is_higher_precedence_than_await(argument) {
                    true => vec![fixer.insert_before(argument, "await ")],
                    false => vec![fixer.insert_before(argument, "await ("), fixer.insert_after(argument, ")")],
                }
            });
        } else if is_function_without_props(ty) {
            cx.report(node, NO_FUNCTION_SPREAD_IN_OBJECT);
        } else if is_map(ty) {
            let report = cx.report(node, NO_MAP_SPREAD_IN_OBJECT);
            if union_constituents(ty).iter().all(is_iterable_map) {
                report.suggest(REPLACE_MAP_SPREAD_IN_OBJECT, |fixer| {
                    let inner = [argument];
                    let is_only_property = matches!(parent.kind(), ExprKind::Object(properties) if properties.len() == 1);
                    let (node, inner_nodes): (Expr, &[Expr]) = match is_only_property {
                        true => (parent, &inner[..]),
                        false => (argument, &inner[..0]),
                    };
                    get_wrapping_fixer(
                        fixer,
                        WrappingFixerParams {
                            node,
                            inner_nodes,
                            wrap: |code: &[&[u8]]| [&b"Object.fromEntries("[..], code[0], b")"].concat(),
                        },
                    )
                });
            }
        } else if is_array(ty) {
            cx.report(node, NO_ARRAY_SPREAD_IN_OBJECT);
        } else if is_iterable(ty) && !is_string(ty) {
            // TypeScript flags a string already.
            cx.report(node, NO_ITERABLE_SPREAD_IN_OBJECT);
        } else if is_class_instance(ty) {
            cx.report(node, NO_CLASS_INSTANCE_SPREAD_IN_OBJECT);
        } else if is_class_declaration(ty) {
            cx.report(node, NO_CLASS_DECLARATION_SPREAD_IN_OBJECT);
        }
    }
}

impl Rule for NoMisusedSpread {
    const META: Meta = Meta::typescript("no-misused-spread", Kind::Problem)
        .has_suggestions()
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoMisusedSpread {
            allow: parse_type_or_value_specifiers(options.object(0).array("allow")),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Spread], Self::check_array_or_call_spread);
        on.props(Self::check_object_spread);
    }
}
