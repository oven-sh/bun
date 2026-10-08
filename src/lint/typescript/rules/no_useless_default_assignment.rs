use bun_lint::prelude::*;
use bun_lint::types::tsutils::{CompilerOption, is_strict_compiler_option_enabled, is_type_parameter};
use bun_lint::types::utils::{
    is_rest_parameter_declaration, is_type_any_type, is_type_flag_set, is_type_unknown_type,
};
use bun_lint::types::{SymbolFlags, Type, TypeFlags};

/// Disallow default values that will never be used.
pub struct NoUselessDefaultAssignment {
    allow_rule_to_run_without_strict_null_checks_i_know_what_i_am_doing: bool,
}

const NO_STRICT_NULL_CHECK: Message = Message::new(
    "noStrictNullCheck",
    "This rule requires the `strictNullChecks` compiler option to be turned on to function correctly.",
);
const PREFER_OPTIONAL_SYNTAX: Message = Message::new(
    "preferOptionalSyntax",
    "Using `= undefined` to make a parameter optional adds unnecessary runtime logic.",
);
const REMOVE_DEFAULT_ASSIGNMENT: Message = Message::new("removeDefaultAssignment", "Remove the default value.");
const USELESS_DEFAULT_ASSIGNMENT: Message = Message::new(
    "uselessDefaultAssignment",
    "Default value is useless because the {{ type }} is not optional.",
);
const USELESS_UNDEFINED: Message = Message::new(
    "uselessUndefined",
    "Default value is useless because it is undefined. Optional {{ type }}s are already undefined by default.",
);
const USE_OPTIONAL_SYNTAX: Message = Message::new("useOptionalSyntax", "Use the `?` optional syntax instead.");

type Context<'a> = Cx<'a, NoUselessDefaultAssignment>;

fn can_be_undefined(ty: Type) -> bool {
    is_type_any_type(ty)
        || is_type_unknown_type(ty)
        || ty.is_unresolved()
        || is_type_flag_set(ty, TypeFlags::UNDEFINED)
}

fn get_array_element_type<'a>(array_type: Type<'a>, element_index: usize) -> Option<Type<'a>> {
    if array_type.is_tuple_type()
        && let Some(element_type) = array_type.get_type_arguments().get(element_index)
    {
        return Some(element_type);
    }
    array_type.get_number_index_type()
}

/// As upstream, the `a` of the computed key `[a]` is taken for the name.
fn get_property_name<'a>(key: Key<'a>) -> Option<&'a [u8]> {
    let name: &'a [u8] = match key.kind() {
        KeyKind::Ident(name)
        | KeyKind::String(name)
        | KeyKind::Number(name)
        | KeyKind::ComputedString(name)
        | KeyKind::ComputedNumber(name) => name.bytes(),
        KeyKind::Private(_) => return None,
        KeyKind::Computed(e) => match e.kind() {
            ExprKind::Ident(name) | ExprKind::String(name) => name.bytes(),
            ExprKind::Template(template) => template.as_static()?.bytes(),
            ExprKind::Null => b"null",
            ExprKind::True => b"true",
            ExprKind::False => b"false",
            _ => return None,
        },
    };
    (!name.is_empty()).then_some(name)
}

fn has_property_in_all_branches<'a>(expression: Expr<'a>, property_name: &'a [u8]) -> bool {
    match expression.kind() {
        ExprKind::Object(properties) => {
            properties.iter().any(|prop| prop.key().and_then(get_property_name) == Some(property_name))
        }
        ExprKind::Cond { yes, no, .. } => {
            has_property_in_all_branches(yes, property_name) && has_property_in_all_branches(no, property_name)
        }
        _ => false,
    }
}

fn is_conditional_or_logical(expression: Expr) -> bool {
    matches!(
        expression.kind(),
        ExprKind::Cond { .. }
            | ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                ..
            }
    )
}

/// The type of the property that `property` of an object pattern reads.
fn get_type_of_property<'a>(property: PatProp<'a>) -> Option<Type<'a>> {
    let Node::Pat(object_pattern) = property.parent() else {
        return None;
    };
    let source_type = get_source_type_for_pattern(object_pattern)?;
    let property_name = get_property_name(property.key()?)?;
    let symbol = source_type.get_property(property_name)?;
    if symbol.has_flags(SymbolFlags::OPTIONAL)
        && let Node::VarDecl(declarator) = object_pattern.parent()
        && let Some(init) = declarator.init()
        && is_conditional_or_logical(init)
        && !has_property_in_all_branches(init, property_name)
    {
        return None;
    }
    Some(symbol.get_type())
}

/// The type of what the object or array pattern `pattern` destructures.
fn get_source_type_for_pattern<'a>(pattern: Pat<'a>) -> Option<Type<'a>> {
    match pattern.parent() {
        Node::VarDecl(declarator) => Some(declarator.init()?.ty()),
        Node::Param(param) if !param.is_rest() && !param.is_parameter_property() => {
            let func = param.func().filter(|it| it.has_body())?;
            let mut param_index = func.params_with_this().position(|it| it == param)?;
            let signature = func.signature()?;
            if signature.this_parameter().is_some() {
                param_index = param_index.checked_sub(1)?;
            }
            Some(signature.get_parameters().get(param_index)?.get_type())
        }
        Node::PatProp(property) if !property.is_rest() => get_type_of_property(property),
        Node::PatElem(element) if !element.is_rest() => {
            let Node::Pat(array_pattern) = element.parent() else {
                return None;
            };
            let PatKind::Array(elements) = array_pattern.kind() else {
                return None;
            };
            let array_type = get_source_type_for_pattern(array_pattern)?;
            get_array_element_type(array_type, elements.iter().position(|it| it == element)?)
        }
        _ => None,
    }
}

/// `removal`: from the end of what has the default `right` to the end of the default.
fn report_useless<'a>(message: Message, right: Expr<'a>, removal: Span, ty: &'static str, cx: &Context<'a>) {
    cx.report(right, message)
        .data("type", ty)
        .suggest(REMOVE_DEFAULT_ASSIGNMENT, |fixer| fixer.remove(removal));
}

fn check_parameter<'a>(param: Param<'a>, cx: &Context<'a>) {
    let Some(right) = param.default() else {
        return;
    };
    let removal = Span::new(param.binding_span().end, param.span().end);
    if right.is_ident("undefined") {
        if !param.ty().is_some_and(|annotation| can_be_undefined(annotation.ty())) {
            report_useless(USELESS_UNDEFINED, right, removal, "parameter", cx);
            return;
        }
        cx.report(right, PREFER_OPTIONAL_SYNTAX).suggest(USE_OPTIONAL_SYNTAX, |fixer| {
            let mut fixes = vec![fixer.remove(removal)];
            if let Some(name) = param.pat().as_ident() {
                let name_end = param.pat().span().start + name.bytes().len() as u32;
                fixes.push(fixer.insert_after(Span::empty(name_end), "?"));
            }
            fixes
        });
        return;
    }

    // Only a function expression has a contextual type that says what it is called with.
    if param.is_parameter_property() {
        return;
    }
    let Some(func) = param.func().filter(|it| matches!(it.kind(), FnKind::Arrow | FnKind::Expr)) else {
        return;
    };
    let Node::Expr(function_expression) = func.owner() else {
        return;
    };
    let Some(param_index) = func.params_with_this().position(|it| it == param) else {
        return;
    };
    let Some(contextual_type) = function_expression.contextual_type() else {
        return;
    };
    let signatures = contextual_type.get_call_signatures();
    if signatures.first().is_none_or(|first| first.declaration() == Some(func.ts_node())) {
        return;
    }
    let default_can_be_used = signatures.iter().any(|signature| {
        let Some(param_symbol) = signature.get_parameters().get(param_index) else {
            return true;
        };
        if param_symbol.value_declaration().is_some_and(is_rest_parameter_declaration)
            || param_symbol.has_flags(SymbolFlags::OPTIONAL)
        {
            return true;
        }
        let param_type = param_symbol.get_type();
        is_type_parameter(param_type) || can_be_undefined(param_type)
    });
    if !default_can_be_used {
        report_useless(USELESS_DEFAULT_ASSIGNMENT, right, removal, "parameter", cx);
    }
}

fn check_property<'a>(property: PatProp<'a>, cx: &Context<'a>) {
    let Some(right) = property.default() else {
        return;
    };
    let removal = Span::new(property.value().span().end, property.span().end);
    if right.is_ident("undefined") {
        report_useless(USELESS_UNDEFINED, right, removal, "property", cx);
    } else if get_type_of_property(property).is_some_and(|ty| !can_be_undefined(ty)) {
        report_useless(USELESS_DEFAULT_ASSIGNMENT, right, removal, "property", cx);
    }
}

/// `element`: the one at `element_index` of `array_pattern`.
fn check_element<'a>(array_pattern: Pat<'a>, element_index: usize, element: PatElem<'a>, cx: &Context<'a>) {
    let (Some(left), Some(right)) = (element.pat(), element.default()) else {
        return;
    };
    let removal = Span::new(left.span().end, element.span().end);
    if right.is_ident("undefined") {
        report_useless(USELESS_UNDEFINED, right, removal, "property", cx);
        return;
    }
    let Some(source_type) = get_source_type_for_pattern(array_pattern) else {
        return;
    };
    let Some(target) = source_type.tuple_target().filter(|_| source_type.is_tuple_type()) else {
        return;
    };
    let tuple_args = source_type.get_type_arguments();
    if element_index >= tuple_args.len() || element_index >= target.min_length() {
        return;
    }
    let is_used = match element_index < target.fixed_length() {
        true => tuple_args.get(element_index).is_some_and(can_be_undefined),
        false => tuple_args.iter().skip(target.fixed_length()).any(can_be_undefined),
    };
    if !is_used {
        report_useless(USELESS_DEFAULT_ASSIGNMENT, right, removal, "property", cx);
    }
}

impl Rule for NoUselessDefaultAssignment {
    const META: Meta = Meta::typescript("no-useless-default-assignment", Kind::Suggestion)
        .has_suggestions()
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoUselessDefaultAssignment {
            allow_rule_to_run_without_strict_null_checks_i_know_what_i_am_doing: options
                .object(0)
                .bool_or("allowRuleToRunWithoutStrictNullChecksIKnowWhatIAmDoing", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        let compiler_options = file.type_checker().compiler_options();
        if !is_strict_compiler_option_enabled(compiler_options, CompilerOption::StrictNullChecks)
            && !self.allow_rule_to_run_without_strict_null_checks_i_know_what_i_am_doing
        {
            on.finish(|_, cx| {
                let start_of_nothing = Position { line: 0, column: 0 };
                cx.report(Span::empty(0), NO_STRICT_NULL_CHECK).start_at(start_of_nothing).end_at(start_of_nothing);
            });
        }
        on.params(|_, param, cx| check_parameter(param, cx));
        on.pats([PatTag::Object, PatTag::Array], |_, pattern, cx| match pattern.kind() {
            PatKind::Object(properties) => properties.iter().for_each(|it| check_property(it, cx)),
            PatKind::Array(elements) => {
                for (element_index, element) in elements.iter().enumerate() {
                    check_element(pattern, element_index, element, cx);
                }
            }
            _ => {}
        });
        // A default in the target of a destructuring assignment. What is assigned has no type that
        // upstream looks at, so only `= undefined` is useless there.
        on.exprs([ExprTag::Assign], |_, node, cx| {
            if let ExprKind::Assign {
                op: None,
                target,
                value,
            } = node.kind()
                && value.is_ident("undefined")
                && node.is_assignment_target()
            {
                let removal = Span::new(target.span().end, node.span().end);
                report_useless(USELESS_UNDEFINED, value, removal, "property", cx);
            }
        });
    }
}
