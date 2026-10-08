use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    CompilerOption, is_boolean_literal_type, is_compiler_option_enabled,
    is_property_readonly_in_type, is_strict_compiler_option_enabled, is_type_parameter,
    is_type_reference, union_constituents,
};
use bun_lint::types::utils::{
    get_constrained_type_at_location, get_contextual_type, get_declaration, is_nullable_type,
    is_type_flag_set,
};
use bun_lint::types::{Signature, SyntaxKind, Type, TypeFlags};
use bun_lint::utils::ast_utils::is_member_expression;
use bun_lint::utils::ts_utils::{
    is_start_of_arrow_function_body_needing_parentheses,
    is_start_of_expression_statement_needing_parentheses,
};
use rustc_hash::FxHashSet;
use smallvec::SmallVec;

/// Disallow type assertions that do not change the type of an expression.
pub struct NoUnnecessaryTypeAssertion {
    check_literal_const_assertions: bool,
    types_to_ignore: Vec<Vec<u8>>,
}

const CONTEXTUALLY_INFERRED_TYPE_ARGUMENTS: Message = Message::new(
    "contextuallyInferredTypeArguments",
    "The type arguments for this generic call may be inferred from the assertion. Specify them explicitly instead.",
);
const CONTEXTUALLY_UNNECESSARY: Message = Message::new(
    "contextuallyUnnecessary",
    "This assertion is unnecessary since the receiver accepts the original type of the expression.",
);
const UNNECESSARY_ASSERTION: Message = Message::new(
    "unnecessaryAssertion",
    "This assertion is unnecessary since it does not change the type of the expression.",
);

/// How deep [`type_contains`] looks. A type can be infinite: upstream runs out of stack, which ends the walk. To go on
/// with the rest of each level instead would take exponential time.
const MAX_DEPTH: u32 = 100;

/// `expression as T`, `<T>expression`
#[derive(Copy, Clone)]
struct Assertion<'a> {
    node: Expr<'a>,
    expression: Expr<'a>,
    /// `None`: `const`.
    type_annotation: Option<TypeNode<'a>>,
}

fn as_assertion(node: Expr<'_>) -> Option<Assertion<'_>> {
    let (expression, type_annotation) = match node.kind() {
        ExprKind::As { expr, ty } => (expr, Some(ty)),
        ExprKind::AsConst(expr) => (expr, None),
        _ => return None,
    };
    Some(Assertion {
        node,
        expression,
        type_annotation,
    })
}

/// Whether there is a chance that the variable is used before a value is assigned to it.
fn is_possibly_used_before_assigned(node: Expr) -> bool {
    let Some(declaration) = get_declaration(node) else {
        return true;
    };
    let options = node.file().type_checker().compiler_options();
    // Properties and parameters cannot be used before they are defined.
    if !is_strict_compiler_option_enabled(options, CompilerOption::StrictNullChecks)
        || declaration.kind() != SyntaxKind::VariableDeclaration
    {
        return false;
    }
    let list = declaration.parent().filter(|it| it.kind() == SyntaxKind::VariableDeclarationList);

    // A `var` may be used outside of the block that declares it.
    if list.is_some()
        && declaration.flags().is_empty()
        && let Some(declarator_node) = declaration.to_ast()
        && !has_parser_context_flags(declarator_node)
    {
        let scope = Node::Expr(node).scope();
        let mut parent_scope = declarator_node.scope().parent();
        while let Some(it) = parent_scope {
            if it == scope {
                return true;
            }
            parent_scope = it.parent();
        }
    }

    if declaration.initializer().is_none()
        && !declaration.has_exclamation_token()
        && let Some(type_node) = declaration.type_node()
    {
        // What is declared with `declare` is never narrowed.
        let is_declare = list.and_then(|it| it.parent()).is_some_and(|statement| {
            statement.kind() == SyntaxKind::VariableStatement
                && statement.children().any(|it| it.kind() == SyntaxKind::DeclareKeyword)
        });
        // The type has not changed since the declaration, so nothing may have been assigned.
        if !is_declare && type_node.get_type_from_type_node() == get_constrained_type_at_location(node) {
            return true;
        }
    }
    false
}

/// Whether TypeScript's parser gives the nodes at `node` flags for where they are, so that the
/// flags of a `var` are not `NodeFlags.None`.
fn has_parser_context_flags(node: Node) -> bool {
    node.file().is_javascript()
        || node.enclosing_function().is_some_and(|func| {
            func.is_async() || func.is_generator() || func.kind() == FnKind::StaticBlock
        })
}

fn is_template_literal_with_expressions(expression: Expr) -> bool {
    matches!(expression.kind(), ExprKind::Template(template) if !template.exprs().is_empty())
}

fn is_implicitly_narrowed_literal_declaration(assertion: Assertion) -> bool {
    // Even in a `const` declaration a template with expressions can be widened.
    if is_template_literal_with_expressions(assertion.expression) {
        return false;
    }
    match assertion.node.parent() {
        Node::VarDecl(declarator) => declarator.var_kind() == VarKind::Const,
        Node::Member(member) => {
            member.kind() == MemberKind::Property
                && member.flags().contains(Flags::READONLY)
                && !member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT)
                && !member.is_signature()
                && !member.decorators().any(|decorator| decorator == assertion.node)
        }
        _ => false,
    }
}

fn is_type_unchanged<'a>(
    type_annotation: Option<TypeNode<'a>>,
    expression: Expr<'a>,
    uncast: Type<'a>,
    cast: Type<'a>,
) -> bool {
    if uncast == cast {
        return true;
    }
    if type_annotation.is_some_and(|it| it.tag() == TypeTag::Intersection) && contains_type_variable(cast) {
        return false;
    }
    if is_type_flag_set(uncast, TypeFlags::UNDEFINED)
        && is_type_flag_set(cast, TypeFlags::UNDEFINED)
        && is_compiler_option_enabled(
            expression.file().type_checker().compiler_options(),
            CompilerOption::ExactOptionalPropertyTypes,
        )
    {
        return are_union_parts_equivalent_ignoring_undefined(uncast, cast);
    }
    if expression.tag() != ExprTag::Object && is_conceptually_literal(expression) {
        return false;
    }
    if (is_type_flag_set(uncast, TypeFlags::NON_PRIMITIVE) && !is_type_flag_set(cast, TypeFlags::NON_PRIMITIVE))
        || has_index_signature(uncast) != has_index_signature(cast)
        || contains_any(uncast)
        || contains_any(cast)
        || (contains_type_variable(cast) && !contains_type_variable(uncast))
    {
        return false;
    }
    if let ExprKind::Object(properties) = expression.kind()
        && (properties.is_empty() || cast.get_properties().iter().any(|p| is_type_literal(p.get_type())))
    {
        return false;
    }
    if cast.is_intersection() && !uncast.is_intersection() {
        // `T & {}`, where `T` cannot be `null` or `undefined`.
        let cast_parts = cast.types();
        return is_type_parameter(uncast)
            && cast_parts.len() == 2
            && cast_parts.contains(uncast)
            && cast_parts
                .iter()
                .find(|part| *part != uncast)
                .is_some_and(|other_part| is_empty_object_type(other_part) && !contains_type_variable(other_part))
            && uncast.get_base_constraint_of_type().is_some_and(|constraint| !is_nullable_type(constraint));
    }
    // The properties last: each is looked up in each constituent of a union.
    have_same_type_arguments(uncast, cast)
        && are_mutually_assignable(uncast, cast)
        && has_same_properties(uncast, cast)
}

fn is_type_literal(ty: Type) -> bool {
    ty.is_literal() || is_boolean_literal_type(ty)
}

fn has_index_signature(ty: Type) -> bool {
    union_constituents(ty).iter().any(|part| part.get_index_infos().len() > 0)
}

fn get_type_arguments<'a>(ty: Type<'a>) -> impl ExactSizeIterator<Item = Type<'a>> {
    let alias_type_arguments = ty.alias_type_arguments();
    match alias_type_arguments.is_empty() && is_type_reference(ty) {
        true => ty.get_type_arguments().iter(),
        false => alias_type_arguments.iter(),
    }
}

/// `None`: the type is infinite.
fn type_contains<'a>(
    ty: Type<'a>,
    predicate: fn(Type<'a>) -> bool,
    seen: &mut FxHashSet<Type<'a>>,
    depth: u32,
) -> Option<bool> {
    if depth > MAX_DEPTH {
        return None;
    }
    if !seen.insert(ty) {
        return Some(false);
    }
    if predicate(ty) {
        return Some(true);
    }
    let mut contains = |nested: Type<'a>| type_contains(nested, predicate, seen, depth + 1);
    if ty.is_union_or_intersection() {
        for part in ty.types() {
            if contains(part)? {
                return Some(true);
            }
        }
        return Some(false);
    }
    for type_argument in get_type_arguments(ty) {
        if contains(type_argument)? {
            return Some(true);
        }
    }
    for signature in ty.get_call_signatures() {
        if contains(signature.get_return_type())? {
            return Some(true);
        }
        for parameter in signature.parameters() {
            if contains(parameter.get_type())? {
                return Some(true);
            }
        }
    }
    Some(false)
}

fn contains_any(ty: Type) -> bool {
    type_contains(ty, |t| is_type_flag_set(t, TypeFlags::ANY), &mut FxHashSet::default(), 0).unwrap_or(false)
}

fn contains_type_variable(ty: Type) -> bool {
    type_contains(
        ty,
        |t| is_type_flag_set(t, TypeFlags::TYPE_VARIABLE | TypeFlags::INDEX),
        &mut FxHashSet::default(),
        0,
    )
    .unwrap_or(false)
}

fn has_phantom_type_arguments(ty: Type) -> bool {
    is_empty_object_type(ty) && get_type_arguments(ty).len() > 0
}

fn has_type_params(signature: Signature) -> bool {
    !signature.type_parameters().is_empty()
}

fn has_generic_call_signature(ty: Type) -> bool {
    ty.get_call_signatures().iter().any(has_type_params)
}

fn generics_mismatch<'a>(uncast: Type<'a>, contextual: Type<'a>) -> bool {
    contextual.get_properties().iter().any(|prop| {
        has_generic_call_signature(prop.get_type())
            && uncast
                .get_property(prop.escaped_name())
                .is_none_or(|uncast_prop| !has_generic_call_signature(uncast_prop.get_type()))
    })
}

fn has_same_properties<'a>(uncast: Type<'a>, cast: Type<'a>) -> bool {
    let (uncast_props, cast_props) = (uncast.get_properties(), cast.get_properties());
    if uncast_props.len() != cast_props.len() {
        return false;
    }
    let cast_prop_names: FxHashSet<&[u8]> = cast_props.iter().map(|p| p.escaped_name()).collect();
    uncast_props.iter().all(|prop| {
        let name = prop.escaped_name();
        cast_prop_names.contains(name)
            && is_property_readonly_in_type(uncast, name) == is_property_readonly_in_type(cast, name)
    })
}

fn have_same_type_arguments<'a>(uncast: Type<'a>, cast: Type<'a>) -> bool {
    get_type_arguments(uncast).eq(get_type_arguments(cast))
}

fn are_mutually_assignable<'a>(a: Type<'a>, b: Type<'a>) -> bool {
    a.is_assignable_to(b) && b.is_assignable_to(a)
}

fn are_union_parts_equivalent_ignoring_undefined<'a>(uncast: Type<'a>, cast: Type<'a>) -> bool {
    let parts = |ty: Type<'a>| {
        union_constituents(ty).iter().filter(|part| !is_type_flag_set(*part, TypeFlags::UNDEFINED))
    };
    if parts(uncast).count() != parts(cast).count() {
        return false;
    }
    let uncast_parts: FxHashSet<Type<'a>> = parts(uncast).collect();
    parts(cast).all(|part| uncast_parts.contains(&part))
}

fn get_original_expression(assertion: Assertion<'_>) -> Expr<'_> {
    let mut current = assertion.expression;
    while let Some(inner) = as_assertion(current) {
        current = inner.expression;
    }
    current
}

fn is_double_assertion_unnecessary<'a>(
    assertion: Assertion<'a>,
    contextual_type: Option<Type<'a>>,
) -> Option<Message> {
    let inner_expression = assertion.expression;
    as_assertion(inner_expression)?;
    let original_type = get_original_expression(assertion).ty();
    let cast_type = assertion.node.ty();
    if is_type_unchanged(assertion.type_annotation, inner_expression, original_type, cast_type)
        && !is_type_flag_set(cast_type, TypeFlags::ANY)
    {
        return Some(UNNECESSARY_ASSERTION);
    }
    let contextual_type = contextual_type?;
    (is_type_flag_set(inner_expression.ty(), TypeFlags::ANY | TypeFlags::UNKNOWN)
        && original_type.is_assignable_to(contextual_type))
    .then_some(CONTEXTUALLY_UNNECESSARY)
}

fn is_conceptually_literal(node: Expr) -> bool {
    matches!(
        node.kind(),
        ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_)
            | ExprKind::Array(_)
            | ExprKind::Object(_)
            | ExprKind::Template(_)
            | ExprKind::Class(_)
            | ExprKind::Fn(_)
            | ExprKind::Jsx(_)
    )
}

fn is_empty_object_type(ty: Type) -> bool {
    is_type_flag_set(ty, TypeFlags::NON_PRIMITIVE)
        || (ty.get_properties().is_empty()
            && ty.get_call_signatures().is_empty()
            && ty.get_construct_signatures().is_empty()
            && ty.get_string_index_type().is_none()
            && ty.get_number_index_type().is_none())
}

fn get_innermost_call(expression: Expr<'_>) -> Option<Call<'_>> {
    let mut expression = expression;
    loop {
        expression = match expression.kind() {
            ExprKind::Call(call) => return Some(call),
            ExprKind::Await(argument) | ExprKind::NonNull(argument) => argument,
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => right,
            _ => return None,
        };
    }
}

fn is_generic_call_with_inferred_type_arguments(expression: Expr) -> bool {
    get_innermost_call(expression)
        .is_some_and(|call| call.type_args().is_empty() && has_generic_call_signature(call.callee().ty()))
}

/// The call or the `new` that `node` is an argument of, and which one.
fn as_argument(node: Expr<'_>) -> Option<(Call<'_>, usize)> {
    let Node::Expr(parent) = node.parent() else {
        return None;
    };
    let (ExprKind::Call(call) | ExprKind::New(call)) = parent.kind() else {
        return None;
    };
    let index = call.args().index_of_start(node.span().start)?;
    (call.args().get(index) == Some(node)).then_some((call, index))
}

fn is_argument_to_overloaded_function(assertion: Assertion) -> bool {
    let Some((call, arg_index)) = as_argument(assertion.node) else {
        return false;
    };
    // The callee of `foo?.bar(..)` can be `undefined`, and a union has no call signatures.
    let signatures = call.callee().ty().get_non_nullable_type().get_call_signatures();
    if signatures.len() <= 1 {
        return false;
    }
    let mut param_types: SmallVec<[Type; 4]> = SmallVec::new();
    for signature in signatures {
        let Some(param) = signature.parameters().get(arg_index) else {
            return true;
        };
        let param_type = param.get_type();
        let is_rest = param
            .value_declaration()
            .is_some_and(|it| it.kind() == SyntaxKind::Parameter && it.has_dot_dot_dot_token());
        let element_type = if is_rest { get_type_arguments(param_type).next() } else { None };
        param_types.push(element_type.unwrap_or(param_type));
    }
    if param_types.iter().all(|ty| Some(ty) == param_types.first()) {
        return false;
    }
    let uncast_type = assertion.expression.ty();
    !param_types.iter().all(|ty| uncast_type.is_assignable_to(*ty))
}

fn is_in_destructuring_declaration(node: Expr) -> bool {
    matches!(
        node.parent(),
        Node::VarDecl(declarator) if declarator.init() == Some(node)
            && matches!(declarator.pat().tag(), PatTag::Object | PatTag::Array)
    )
}

/// ESTree's `Property`, of an object or of a pattern.
fn is_property(prop: Prop) -> bool {
    prop.kind() != PropKind::Spread && !prop.is_jsx_attribute() && !prop.is_import_attribute()
}

fn is_property_in_problematic_context(assertion: Assertion) -> bool {
    let node = assertion.node;
    let Node::Prop(parent) = node.parent() else {
        return false;
    };
    if !is_property(parent) || parent.value() != Some(node) {
        return false;
    }
    let Node::Expr(object_expr) = parent.parent() else {
        return false;
    };
    if object_expr.is_assignment_target() {
        return false;
    }
    if object_expr.contextual_type().is_some_and(|it| it.is_union()) {
        let Some(prop_contextual_type) = node.contextual_type() else {
            return true;
        };
        let non_nullable_contextual_type = prop_contextual_type.get_non_nullable_type();
        return non_nullable_contextual_type.is_union()
            || !assertion.expression.ty().is_assignable_to(non_nullable_contextual_type);
    }
    let is_satisfies = |node: Node| matches!(node, Node::Expr(e) if e.tag() == ExprTag::Satisfies);
    let object_parent = object_expr.parent();
    is_satisfies(object_parent)
        || matches!(
            object_parent,
            // ESLint has a `ChainExpression` around `f?.({})`.
            Node::Expr(call) if call.tag() == ExprTag::Call && !call.is_chain_root() && is_satisfies(call.parent())
        )
}

/// The `AssignmentExpression` that `node` is the right of.
fn as_assigned_value(node: Expr<'_>) -> Option<(Expr<'_>, Option<BinOp>)> {
    let Node::Expr(parent) = node.parent() else {
        return None;
    };
    match parent.kind() {
        ExprKind::Assign { op, value, .. } if value == node && !parent.is_assignment_target() => Some((parent, op)),
        _ => None,
    }
}

fn is_assignment_in_non_statement_context(node: Expr) -> bool {
    as_assigned_value(node).is_some_and(|(assignment, _)| {
        !matches!(assignment.parent(), Node::Stmt(statement) if matches!(statement.kind(), StmtKind::Expr(_)))
    })
}

fn is_right_hand_side_of_logical_assignment(node: Expr) -> bool {
    matches!(as_assigned_value(node), Some((_, Some(BinOp::And | BinOp::Or | BinOp::Nullish))))
}

fn is_in_generic_context(node: Expr) -> bool {
    let mut seen_function = false;
    for current in Node::Expr(node).ancestors() {
        match current {
            Node::Func(func) if func.has_body() && func.kind() != FnKind::StaticBlock => {
                if seen_function || !matches!(func.body(), FnBody::Expr(_)) {
                    return false;
                }
                seen_function = true;
            }
            Node::Expr(current) => {
                let (call, is_new) = match current.kind() {
                    ExprKind::Call(call) => (call, false),
                    ExprKind::New(call) => (call, true),
                    _ => continue,
                };
                let callee = call.callee();
                if !call.type_args().is_empty()
                    || (!is_new
                        && is_member_expression(callee)
                        && !callee.is_chain_root()
                        && call.args().around(node.span().start) == Some(node))
                {
                    continue;
                }
                if has_generic_call_signature(callee.ty()) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn has_phantom_type_argument_mismatch<'a>(node: Expr<'a>, uncast_type: Type<'a>, contextual_type: Type<'a>) -> bool {
    is_in_generic_context(node)
        && (has_phantom_type_arguments(uncast_type) || has_phantom_type_arguments(contextual_type))
        && !have_same_type_arguments(uncast_type, contextual_type)
}

/// The parent is a `TSAsExpression`, a `TSTypeAssertion`, a `SpreadElement` or a
/// `TSSatisfiesExpression`.
fn has_parent_to_skip(node: Expr) -> bool {
    match node.parent() {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::As { .. } | ExprKind::AsConst(_) | ExprKind::Satisfies { .. } => true,
            ExprKind::Spread(_) => !parent.is_assignment_target() && parent.jsx_container_span().is_none(),
            _ => false,
        },
        Node::Prop(parent) => {
            parent.kind() == PropKind::Spread
                && !parent.is_jsx_attribute()
                && !matches!(parent.parent(), Node::Expr(object) if object.is_assignment_target())
        }
        _ => false,
    }
}

fn should_skip_contextual_type_fallback(assertion: Assertion, cast_is_any: bool) -> bool {
    let Assertion { node, expression, .. } = assertion;
    if cast_is_any {
        let is_in_logical_expression = matches!(
            node.parent(),
            Node::Expr(parent) if matches!(
                parent.kind(),
                ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, .. }
            )
        );
        return is_in_logical_expression || is_in_generic_context(node);
    }
    // A template with expressions can be widened to `string` where the contextual type still
    // accepts it.
    if is_template_literal_with_expressions(expression)
        || has_parent_to_skip(node)
        || expression.tag() == ExprTag::Array
        || is_in_destructuring_declaration(node)
        || is_property_in_problematic_context(assertion)
        || is_assignment_in_non_statement_context(node)
        || is_right_hand_side_of_logical_assignment(node)
        || is_argument_to_overloaded_function(assertion)
    {
        return true;
    }
    is_in_generic_context(node)
        && !is_conceptually_literal(get_original_expression(assertion))
        && !matches!(node.parent(), Node::Prop(parent) if is_property(parent))
}

fn get_uncast_type(expression: Expr<'_>) -> Type<'_> {
    // Of an IIFE, the return type of the function.
    if let ExprKind::Call(call) = expression.kind()
        && !expression.is_chain_root()
        && let Some(callee) = call.callee().as_fn()
        && let Some(signature) = call.callee().ty().get_call_signatures().first()
    {
        let return_type = signature.get_return_type();
        // What is inferred for `() => {}` should be `void`.
        if callee.return_type().is_none() && is_type_flag_set(return_type, TypeFlags::UNDEFINED) {
            return expression.file().type_checker().get_void_type();
        }
        return return_type;
    }
    expression.ty()
}

fn fix_assertion<'a>(fixer: Fixer<'a>, assertion: Assertion<'a>) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let Assertion {
        node,
        expression,
        type_annotation,
    } = assertion;
    if node.is_angle_bracket_assertion() {
        let type_annotation = match type_annotation {
            Some(it) => it.span(),
            None => node.const_keyword_span()?,
        };
        let opening_angle_bracket = file.tokens_before(type_annotation).find(|it| it.is_punctuator("<"))?;
        let closing_angle_bracket = file.tokens_after(type_annotation).find(|it| it.is_punctuator(">"))?;
        // Without the angle brackets the operand is where the assertion was. There a `{`, a
        // `function` or a `class` can be taken for a block or a declaration.
        let first_operand_token = file.token_after(closing_angle_bracket)?;
        let needs_parens = is_start_of_expression_statement_needing_parentheses(node, &first_operand_token)
            || is_start_of_arrow_function_body_needing_parentheses(node, &first_operand_token);
        let remove = fixer.remove(Span::new(opening_angle_bracket.start(), closing_angle_bracket.end()));
        return Some(match needs_parens {
            true => vec![fixer.insert_before(node, "("), remove, fixer.insert_after(node, ")")],
            false => vec![remove],
        });
    }
    let as_token = file.tokens_after(expression).find(|it| it.kind() == TokenKind::Identifier && it.is("as"))?;
    let token_before_as = file.tokens_before(as_token).with_comments().next()?;
    Some(vec![fixer.remove(Span::new(token_before_as.end(), node.span().end))])
}

/// `node`: the range of a `TSNonNullExpression`, which ends with its `!`.
fn fix_non_null_assertion(fixer: Fixer, node: Span) -> Fix {
    fixer.remove(Span::new(node.end.saturating_sub(1), node.end))
}

impl NoUnnecessaryTypeAssertion {
    fn check_assertion<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(assertion) = as_assertion(node) else {
            return;
        };
        let Assertion {
            expression,
            type_annotation,
            ..
        } = assertion;
        let type_annotation_text = type_annotation.map_or(&b"const"[..], |it| it.text());
        if self.types_to_ignore.iter().any(|it| it == type_annotation_text) {
            return;
        }

        let cast_type = node.ty();
        let cast_type_is_literal = is_type_literal(cast_type);
        let type_annotation_is_const_assertion = type_annotation.is_none();
        if !self.check_literal_const_assertions && cast_type_is_literal && type_annotation_is_const_assertion {
            return;
        }

        let uncast_type = get_uncast_type(expression);
        if cast_type.is_unresolved() || uncast_type.is_unresolved() {
            return;
        }
        let would_same_type_be_inferred = match cast_type_is_literal {
            true => is_implicitly_narrowed_literal_declaration(assertion),
            false => !type_annotation_is_const_assertion,
        };
        if would_same_type_be_inferred && is_type_unchanged(type_annotation, expression, uncast_type, cast_type) {
            if is_generic_call_with_inferred_type_arguments(expression) {
                cx.report(node, CONTEXTUALLY_INFERRED_TYPE_ARGUMENTS);
            } else {
                cx.report(node, UNNECESSARY_ASSERTION).fix(|fixer| fix_assertion(fixer, assertion));
            }
            return;
        }

        let cast_is_any = is_type_flag_set(cast_type, TypeFlags::ANY) && !has_parent_to_skip(node);
        let contextual_type = match should_skip_contextual_type_fallback(assertion, cast_is_any) {
            true => None,
            false => node.contextual_type(),
        };

        if let Some(contextual_type) = contextual_type {
            let contextual_type_is_any = is_type_flag_set(contextual_type, TypeFlags::ANY);
            let any_involved_in_contextual_check = || match contextual_type_is_any {
                true => as_argument(node).is_some() && !contains_any(cast_type),
                false => !contains_any(contextual_type),
            };
            let is_nullish_literal_to_union = cast_type.is_union()
                && (expression.tag() == ExprTag::Null || expression.is_ident("undefined"));
            let is_contextually_unnecessary = !type_annotation_is_const_assertion
                && !is_nullish_literal_to_union
                && !contextual_type.is_unresolved()
                && !contains_any(uncast_type)
                && any_involved_in_contextual_check()
                && !has_phantom_type_argument_mismatch(node, uncast_type, contextual_type)
                && (cast_is_any || !generics_mismatch(uncast_type, contextual_type))
                && (contextual_type_is_any || uncast_type.is_assignable_to(contextual_type));
            if is_contextually_unnecessary {
                cx.report(node, CONTEXTUALLY_UNNECESSARY).fix(|fixer| fix_assertion(fixer, assertion));
                return;
            }
        }

        if let Some(message) = is_double_assertion_unnecessary(assertion, contextual_type) {
            cx.report(node, message).fix(|fixer| {
                let original_expr = get_original_expression(assertion);
                let text = original_expr.text();
                let is_body_of_arrow_function = matches!(
                    node.parent(),
                    Node::Func(func) if matches!(func.body(), FnBody::Expr(body) if body == node)
                );
                match original_expr.tag() == ExprTag::Object && is_body_of_arrow_function {
                    true => fixer.replace(node, [&b"("[..], text, b")"].concat()),
                    false => fixer.replace(node, text),
                }
            });
        }
    }

    fn check_non_null_assertion<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::NonNull(expression) = node.kind() else {
            return;
        };
        // `x!!` is one node here. For ESLint it is `x!` in another assertion, and each is looked at.
        let mut inner = node.inner_non_null_spans();
        let innermost = inner.next();
        let is_run = innermost.is_some();
        let outermost = node.span();

        let actual_type = expression.ty();
        let is_resolved = !actual_type.is_unresolved();
        let constrained_type = get_constrained_type_at_location(expression);
        // The constraint of a type parameter can be `any`, which is nullable, while TypeScript
        // takes the type parameter itself for what it is.
        let is_nullable = is_nullable_type(constrained_type) || is_nullable_type(actual_type);
        // What an assertion is applied to in a run, from the second on: the type of the one before.
        let asserted_type = node.ty();
        if let Some(innermost) = innermost
            && is_resolved
        {
            // Nothing is known about what an assertion accepts, so `x!` is only reported if `x` cannot be null.
            if !is_nullable && !(expression.tag() == ExprTag::Ident && is_possibly_used_before_assigned(expression)) {
                cx.report(innermost, UNNECESSARY_ASSERTION).fix(|fixer| fix_non_null_assertion(fixer, innermost));
            }
            if !is_nullable_type(asserted_type) {
                for between in inner {
                    cx.report(between, UNNECESSARY_ASSERTION).fix(|fixer| fix_non_null_assertion(fixer, between));
                }
            }
        }

        if let Node::Expr(parent) = node.parent()
            && let ExprKind::Assign { op: None, target, .. } = parent.kind()
            && !parent.is_assignment_target()
        {
            if target == node {
                cx.report(node, CONTEXTUALLY_UNNECESSARY).fix(|fixer| fix_non_null_assertion(fixer, outermost));
            }
            // What is assigned is not looked at: an assertion that the assignment does not need
            // can change the type of the variable in what follows.
            return;
        }
        if !is_resolved {
            return;
        }
        let (actual_type, constrained_type, is_nullable) = match is_run {
            true => (asserted_type, asserted_type, is_nullable_type(asserted_type)),
            false => (actual_type, constrained_type, is_nullable),
        };

        if !is_nullable {
            if !is_run && expression.tag() == ExprTag::Ident && is_possibly_used_before_assigned(expression) {
                return;
            }
            cx.report(node, UNNECESSARY_ASSERTION).fix(|fixer| fix_non_null_assertion(fixer, outermost));
            return;
        }

        // It is nullable. Does what receives it accept that?
        if constrained_type != actual_type {
            return;
        }
        let Some(contextual_type) = get_contextual_type(node) else {
            return;
        };
        if is_type_flag_set(constrained_type, TypeFlags::UNKNOWN)
            && !is_type_flag_set(contextual_type, TypeFlags::UNKNOWN)
        {
            return;
        }
        // `null` cannot be assigned to `undefined`, so each of them has to be accepted.
        let is_valid = [TypeFlags::UNDEFINED, TypeFlags::NULL, TypeFlags::VOID]
            .into_iter()
            .all(|flag| !is_type_flag_set(constrained_type, flag) || is_type_flag_set(contextual_type, flag));
        if is_valid {
            cx.report(node, CONTEXTUALLY_UNNECESSARY).fix(|fixer| fix_non_null_assertion(fixer, outermost));
        }
    }
}

impl Rule for NoUnnecessaryTypeAssertion {
    const META: Meta = Meta::typescript("no-unnecessary-type-assertion", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoUnnecessaryTypeAssertion {
            check_literal_const_assertions: options.bool_or("checkLiteralConstAssertions", false),
            types_to_ignore: options.strings("typesToIgnore").into_iter().map(|it| it.as_bytes().to_vec()).collect(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::As, ExprTag::AsConst], Self::check_assertion);
        on.exprs([ExprTag::NonNull], Self::check_non_null_assertion);
    }
}
