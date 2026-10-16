use bun_lint::prelude::*;
use bun_lint::types::tsutils::{CompilerOption, is_strict_compiler_option_enabled, is_type_parameter};
use bun_lint::types::utils::{
    is_rest_parameter_declaration, is_type_any_type, is_type_flag_set, is_type_unknown_type,
};
use bun_lint::types::{IdMap, SymbolFlags, TupleTarget, Type, TypeFlags};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};

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

/// As upstream, the `a` of the computed key `[a]` is taken for the name. tsgolint has a name there only for an identifier
/// or a literal that is written without parentheses, and takes the empty name too.
fn get_property_name<'a>(key: Key<'a>, is_oxlint: bool) -> Option<&'a [u8]> {
    let name: &'a [u8] = match key.kind() {
        KeyKind::Ident(name)
        | KeyKind::String(name)
        | KeyKind::Number(name)
        | KeyKind::ComputedString(name)
        | KeyKind::ComputedNumber(name) => name.bytes(),
        KeyKind::Private(_) => return None,
        KeyKind::Computed(e) if is_oxlint && e.is_parenthesized() => return None,
        KeyKind::Computed(e) => match e.kind() {
            ExprKind::Ident(name) | ExprKind::String(name) => name.bytes(),
            ExprKind::Template(template) => template.as_static()?.bytes(),
            ExprKind::Null if !is_oxlint => b"null",
            ExprKind::True if !is_oxlint => b"true",
            ExprKind::False if !is_oxlint => b"false",
            _ => return None,
        },
    };
    (is_oxlint || !name.is_empty()).then_some(name)
}

/// The names for which upstream's `hasPropertyInAllBranches(expression, name)` holds: those of the properties that every branch
/// of `expression` has, if all of them are object literals.
fn get_properties_in_all_branches<'a>(expression: Expr<'a>, is_oxlint: bool) -> FxHashSet<&'a [u8]> {
    // For each name, how many branches have it, and the last of them.
    let mut found: FxHashMap<&'a [u8], (u32, u32)> = FxHashMap::default();
    let mut branches = 0;
    let mut rest: SmallVec<[Expr<'a>; 8]> = smallvec![expression];
    while let Some(branch) = rest.pop() {
        match branch.kind() {
            ExprKind::Object(properties) => {
                branches += 1;
                let names = properties.iter().filter_map(|prop| get_property_name(prop.key()?, is_oxlint));
                for name in names {
                    let (count, last) = found.entry(name).or_insert((0, 0));
                    if *last != branches {
                        (*count, *last) = (*count + 1, branches);
                    }
                }
            }
            ExprKind::Cond { yes, no, .. } => rest.extend([yes, no]),
            _ => return FxHashSet::default(),
        }
    }
    found.into_iter().filter(|(_, (count, _))| *count == branches).map(|(name, _)| name).collect()
}

/// The index of `item` in `list`, whose elements are in the order of the source.
fn index_in<'a, T: Handle<'a> + Spanned + PartialEq>(list: List<'a, T>, item: T) -> Option<usize> {
    let index = list.index_of_start(item.span().start).filter(|&index| list.get(index) == Some(item));
    index.or_else(|| list.iter().position(|it| it == item))
}

/// The index of `param` among all that is written between the parentheses of `func`.
fn index_of_parameter<'a>(func: Func<'a>, param: Param<'a>) -> Option<usize> {
    match func.this_param() {
        Some(this_param) if this_param == param => Some(0),
        this_param => Some(index_in(func.params(), param)? + usize::from(this_param.is_some())),
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
fn get_type_of_property<'a>(property: PatProp<'a>, cx: &mut Context<'a>) -> Option<Type<'a>> {
    let Node::Pat(object_pattern) = property.parent() else {
        return None;
    };
    let is_oxlint = cx.language().is_oxlint;
    let source_type = get_source_type_for_pattern(object_pattern, cx)?;
    let property_name = get_property_name(property.key()?, is_oxlint)?;
    let symbol = source_type.get_property(property_name)?;
    if symbol.has_flags(SymbolFlags::OPTIONAL) {
        let init = match object_pattern.parent() {
            Node::VarDecl(declarator) => declarator.init(),
            _ => None,
        };
        // tsgolint knows the type of an optional property only where every branch of the initializer writes it.
        match init.filter(|init| is_oxlint || is_conditional_or_logical(*init)) {
            Some(init) => {
                let properties = cx.state.get_or_insert_with(init, || get_properties_in_all_branches(init, is_oxlint));
                if !properties.contains(property_name) {
                    return None;
                }
            }
            None if is_oxlint => return None,
            None => {}
        }
    }
    Some(symbol.get_type())
}

/// The type of what the object or array pattern `pattern` destructures.
fn get_source_type_for_pattern<'a>(pattern: Pat<'a>, cx: &mut Context<'a>) -> Option<Type<'a>> {
    // tsgolint also takes a rest parameter, a rest element and a parameter of a function without a body.
    let is_oxlint = cx.language().is_oxlint;
    match pattern.parent() {
        Node::VarDecl(declarator) => Some(declarator.init()?.ty()),
        Node::Param(param) if is_oxlint || (!param.is_rest() && !param.is_parameter_property()) => {
            let func = param.func().filter(|it| is_oxlint || it.has_body())?;
            let mut param_index = index_of_parameter(func, param)?;
            let signature = func.signature()?;
            if signature.this_parameter().is_some() {
                param_index = param_index.checked_sub(1)?;
            }
            Some(signature.get_parameters().get(param_index)?.get_type())
        }
        Node::PatProp(property) if !property.is_rest() => get_type_of_property(property, cx),
        Node::PatElem(element) if is_oxlint || !element.is_rest() => {
            let Node::Pat(array_pattern) = element.parent() else {
                return None;
            };
            let PatKind::Array(elements) = array_pattern.kind() else {
                return None;
            };
            let array_type = get_source_type_for_pattern(array_pattern, cx)?;
            get_array_element_type(array_type, index_in(elements, element)?)
        }
        _ => None,
    }
}

/// tsgolint's `isSimpleTypeForMessage`
fn is_simple_type_for_message(ty: Type) -> bool {
    if ty.has_flags(TypeFlags::UNION_OR_INTERSECTION) {
        return false;
    }
    let primitive_like = TypeFlags::STRING_LIKE
        | TypeFlags::NUMBER_LIKE
        | TypeFlags::BOOLEAN_LIKE
        | TypeFlags::BIG_INT_LIKE
        | TypeFlags::ES_SYMBOL_LIKE;
    ty.has_flags(primitive_like) || ty.symbol().is_some_and(|symbol| !symbol.name().is_empty())
}

/// tsgolint reports the default with the parentheses around it.
fn report_default<'a>(right: Expr<'a>, message: Message, cx: &Context<'a>) -> Report<'a> {
    match cx.language().is_oxlint && right.is_parenthesized() {
        true => cx.report(right.outer_span(), message),
        false => cx.report(right, message),
    }
}

/// `removal`: from the end of what has the default `right` to the end of the default.
fn report_useless<'a>(message: Message, right: Expr<'a>, removal: Span, ty: &'static str, cx: &Context<'a>) {
    let mut report = report_default(right, message, cx).data("type", ty);
    if cx.language().is_oxlint {
        report = report.data("types", if ty == "property" { "properties" } else { "parameters" });
    }
    report.suggest(REMOVE_DEFAULT_ASSIGNMENT, |fixer| fixer.remove(removal));
}

/// `value`: the type of what has the default, if it is known as one type. `target`: the type annotation of what has the
/// default, or its name.
fn report_useless_default<'a>(
    right: Expr<'a>,
    removal: Span,
    target: Span,
    ty: &'static str,
    value: Option<Type<'a>>,
    cx: &Context<'a>,
) {
    let named = value.filter(|it| is_simple_type_for_message(*it));
    let mut report = report_default(right, USELESS_DEFAULT_ASSIGNMENT, cx).data("type", ty).labels_with(|labels| {
        labels.first("Default value");
        if let Some(value) = named {
            labels.push(target, format!("{ty} type `{}` is not nullish", bstr::BStr::new(&value.to_text())));
        }
        labels.push(right.outer_span(), "");
    });
    if cx.language().is_oxlint {
        let why = match named {
            Some(value) => [&b" has type `"[..], &value.to_text(), b"` (not nullish)"].concat(),
            None => b" is not nullish".to_vec(),
        };
        report = report.data("why", why);
    }
    report.suggest(REMOVE_DEFAULT_ASSIGNMENT, |fixer| fixer.remove(removal));
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
        report_default(right, PREFER_OPTIONAL_SYNTAX, cx).suggest(USE_OPTIONAL_SYNTAX, |fixer| {
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
    let Some(param_index) = index_of_parameter(func, param) else {
        return;
    };
    let Some(contextual_type) = function_expression.contextual_type() else {
        return;
    };
    let signatures = contextual_type.get_call_signatures();
    if signatures.first().is_none_or(|first| first.declaration() == Some(func.ts_node())) {
        return;
    }
    // tsgolint asks the first signature only.
    let asked = if cx.language().is_oxlint { 1 } else { signatures.len() };
    let default_can_be_used = signatures.iter().take(asked).any(|signature| {
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
        let first = signatures.iter().find_map(|it| it.get_parameters().get(param_index));
        let target = param.ty().map_or_else(|| param.pat().span(), |it| it.outer_span());
        report_useless_default(right, removal, target, "parameter", first.map(|it| it.get_type()), cx);
    }
}

fn check_property<'a>(property: PatProp<'a>, cx: &mut Context<'a>) {
    let Some(right) = property.default() else {
        return;
    };
    let removal = Span::new(property.value().span().end, property.span().end);
    if right.is_ident("undefined") {
        report_useless(USELESS_UNDEFINED, right, removal, "property", cx);
    } else if let Some(ty) = get_type_of_property(property, cx).filter(|ty| !can_be_undefined(*ty)) {
        report_useless_default(right, removal, property.value().span(), "property", Some(ty), cx);
    }
}

/// `element`: the one at `element_index` of `array_pattern`. `source`: the type of what `array_pattern` destructures, once it
/// has been asked for, if that is a tuple type.
fn check_element<'a>(
    array_pattern: Pat<'a>,
    element_index: usize,
    element: PatElem<'a>,
    source: &mut Option<Option<(Type<'a>, TupleTarget<'a>)>>,
    cx: &mut Context<'a>,
) {
    let (Some(left), Some(right)) = (element.pat(), element.default()) else {
        return;
    };
    let removal = Span::new(left.span().end, element.span().end);
    if right.is_ident("undefined") {
        report_useless(USELESS_UNDEFINED, right, removal, "property", cx);
        return;
    }
    let source = source.get_or_insert_with(|| {
        let source_type = get_source_type_for_pattern(array_pattern, cx)?;
        let target = source_type.tuple_target().filter(|_| source_type.is_tuple_type())?;
        Some((source_type, target))
    });
    let Some((source_type, target)) = *source else {
        return;
    };
    let tuple_args = source_type.get_type_arguments();
    if element_index >= tuple_args.len() || element_index >= target.min_length() {
        return;
    }
    let fixed_length = target.fixed_length();
    let mut end = tuple_args.len();
    if cx.language().is_oxlint && element_index >= fixed_length {
        // tsgolint: a trailing element cannot reach this position if too many required elements precede it.
        let (flags, mut position) = (target.element_flags(), fixed_length);
        end = fixed_length;
        while end < tuple_args.len() && position <= element_index {
            position += usize::from(flags.get(end).is_some_and(|it| it.contains(bun_lint::types::ElementFlags::REQUIRED)));
            end += 1;
        }
    }
    let is_used = match element_index < fixed_length {
        true => tuple_args.get(element_index).is_some_and(can_be_undefined),
        false => tuple_args.iter().take(end).skip(fixed_length).any(can_be_undefined),
    };
    if !is_used {
        let mut candidates = tuple_args.iter().take(end).skip(fixed_length);
        let value = match element_index < fixed_length {
            true => tuple_args.get(element_index),
            // tsgolint names `getUnionType` of the candidates: known here only where they are one type.
            false if cx.language().is_oxlint => candidates.next().filter(|first| candidates.all(|it| it == *first)),
            false => None,
        };
        report_useless_default(right, removal, left.span(), "property", value, cx);
    }
}

impl Rule for NoUselessDefaultAssignment {
    const META: Meta = Meta::typescript("no-useless-default-assignment", Kind::Suggestion)
        .has_suggestions()
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new()
        .finish()
        .params()
        .pats(&[PatTag::Object, PatTag::Array])
        .exprs(&[ExprTag::Assign]);
    /// [`get_properties_in_all_branches`] of what has been asked about.
    type State<'a> = IdMap<Expr<'a>, FxHashSet<&'a [u8]>>;

    fn new(options: &Options) -> Self {
        NoUselessDefaultAssignment {
            allow_rule_to_run_without_strict_null_checks_i_know_what_i_am_doing: options
                .object(0)
                .bool_or("allowRuleToRunWithoutStrictNullChecksIKnowWhatIAmDoing", false),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        let compiler_options = file.type_checker().compiler_options();
        if !is_strict_compiler_option_enabled(compiler_options, CompilerOption::StrictNullChecks)
            && !self.allow_rule_to_run_without_strict_null_checks_i_know_what_i_am_doing
        {
            on = on.finish();
        }
        on = on.params().pats(&[PatTag::Object, PatTag::Array]);
        // tsgolint does not look at the defaults of a destructuring assignment.
        match file.language().is_oxlint {
            true => on,
            false => on.exprs(&[ExprTag::Assign]),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(IdMap::new())
    }

    // A default in the target of a destructuring assignment. What is assigned has no type that
    // upstream looks at, so only `= undefined` is useless there.
    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
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
    }

    fn pat<'a>(&self, pattern: Pat<'a>, cx: &mut Cx<'a, Self>) {
        match pattern.kind() {
            PatKind::Object(properties) => properties.iter().for_each(|it| check_property(it, cx)),
            PatKind::Array(elements) => {
                let mut source = None;
                for (element_index, element) in elements.iter().enumerate() {
                    check_element(pattern, element_index, element, &mut source, cx);
                }
            }
            _ => {}
        }
    }

    fn param<'a>(&self, param: Param<'a>, cx: &mut Cx<'a, Self>) {
        check_parameter(param, cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        ts_utils::report_at_line_zero(cx, NO_STRICT_NULL_CHECK);
    }
}
