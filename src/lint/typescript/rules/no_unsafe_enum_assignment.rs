use bun_lint::prelude::*;
use bun_lint::types::tsutils::union_constituents;
use bun_lint::types::utils::{
    FunctionSignature, get_enum_types, get_enum_value_type, get_static_member_access_value,
    get_type_flags, is_number_like, is_string_like,
};
use bun_lint::types::{SyntaxKind, TsNode, Type, TypeFlags};
use bun_lint::utils::ts_utils::get_parent_function_node;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

/// Disallow assigning non-enum values to enum typed locations.
pub struct NoUnsafeEnumAssignment;

const UNSAFE_ENUM_ACCESS: Message = Message::new(
    "unsafeEnumAccess",
    "The computed key used here does not have a shared enum type with the expected enum {{enumNames}}.",
);
const UNSAFE_ENUM_ARGUMENT: Message = Message::new(
    "unsafeEnumArgument",
    "The argument passed here does not have a shared enum type with the expected enum {{enumNames}}.",
);
const UNSAFE_ENUM_ASSERTION: Message = Message::new(
    "unsafeEnumAssertion",
    "The value asserted here does not have a shared enum type with the expected enum {{enumNames}}.",
);
const UNSAFE_ENUM_ASSIGNMENT: Message = Message::new(
    "unsafeEnumAssignment",
    "The value assigned here does not have a shared enum type with the expected enum {{enumNames}}.",
);
const UNSAFE_ENUM_MUTATION: Message = Message::new(
    "unsafeEnumMutation",
    "This mutation can produce a value outside of the expected enum {{enumNames}}.",
);
const UNSAFE_ENUM_RETURN: Message = Message::new(
    "unsafeEnumReturn",
    "The value returned here does not have a shared enum type with the expected enum {{enumNames}}.",
);

const MAXIMUM_DEPTH: u32 = 5;

/// How many types [`describe_enum_types`] looks into. Upstream has no bound, and does not return
/// for a type whose members instantiate ever larger types.
const MAXIMUM_DESCRIBED_TYPES: usize = 10_000;

type Context<'a> = Cx<'a, NoUnsafeEnumAssignment>;

#[derive(Default)]
pub struct State<'a> {
    /// The array and object literals inside a value that has been reported, which are not reported
    /// element by element.
    checked_nodes: FxHashSet<Expr<'a>>,
    /// The array and object literals that have something to report, unless they turn out to be
    /// among `checked_nodes`.
    pending: Vec<Expr<'a>>,
    types: TypeCache<'a>,
    /// [`describe_enum_types`] of one type.
    descriptions: FxHashMap<Type<'a>, Vec<u8>>,
}

fn get_constraint_type(ty: Type<'_>) -> Type<'_> {
    ty.get_base_constraint_of_type().unwrap_or(ty)
}

/// Nothing but `any`, `unknown`, `never`, `object` and primitive types that are not enums. The
/// members of `String`, `Number` and the like have no enums in them, so nothing mismatches it.
fn is_without_enums(ty: Type) -> bool {
    const PLAIN: TypeFlags = TypeFlags::PRIMITIVE
        .union(TypeFlags::ANY_OR_UNKNOWN)
        .union(TypeFlags::NEVER)
        .union(TypeFlags::NON_PRIMITIVE)
        .difference(TypeFlags::ENUM_LIKE);
    PLAIN.contains(get_type_flags(ty))
}

fn has_shared_enum_type<'a>(ty: Type<'a>, expected_enum_types: &[Type<'a>]) -> bool {
    let type_enum_types = get_enum_types(ty);
    expected_enum_types
        .iter()
        .any(|expected_enum_type| type_enum_types.contains(expected_enum_type))
}

fn is_mismatched_enum_assignment_types<'a>(sender_type: Type<'a>, receiver_type: Type<'a>) -> bool {
    let receiver_type_parts = union_constituents(receiver_type);
    let (mut receives_numbers, mut receives_strings) = (false, false);
    for receiver_type_part in receiver_type_parts {
        match get_enum_value_type(receiver_type_part) {
            Some(value_type) if value_type == TypeFlags::NUMBER => receives_numbers = true,
            Some(_) => receives_strings = true,
            None => {}
        }
    }
    if !receives_numbers && !receives_strings {
        return false;
    }
    let receiver_enum_types = get_enum_types(receiver_type);
    union_constituents(sender_type).iter().any(|sender_type_part| {
        // const fruit: Fruit = 1;
        (receives_numbers && is_number_like(sender_type_part) || receives_strings && is_string_like(sender_type_part))
            // const fruit: Fruit = Fruit.Apple;
            && !has_shared_enum_type(sender_type_part, &receiver_enum_types)
            // const fruitOrNumber: Fruit | number = 1;
            && !receiver_type_parts.iter().any(|receiver_type_part| {
                get_enum_types(receiver_type_part).is_empty() && sender_type_part.is_assignable_to(receiver_type_part)
            })
    })
}

/// What has been found out about types, as long as the file is linted.
#[derive(Default)]
struct TypeCache<'a> {
    generic_types: FxHashMap<Type<'a>, bool>,
    top_level_mismatches: FxHashMap<(Type<'a>, Type<'a>), bool>,
    /// The pairs that the comparison at hand has looked at: recursive types would be visited
    /// endlessly.
    visited: FxHashSet<(Type<'a>, Type<'a>)>,
}

impl<'a> TypeCache<'a> {
    fn is_generic_type(&mut self, ty: Type<'a>) -> bool {
        if let Some(&generic) = self.generic_types.get(&ty) {
            return generic;
        }
        let parts_of = |ty: Type<'a>| {
            ty.types()
                .iter()
                .chain(ty.alias_type_arguments())
                .chain(ty.get_type_arguments())
        };
        // Not by recursion: a chain of aliases makes a type as deep as the file is long.
        // The types that are being gone through, and the parts that are left of each.
        let mut open = Vec::new();
        let mut entered = ty;
        loop {
            let generic = entered.has_flags(TypeFlags::INSTANTIABLE);
            self.generic_types.insert(entered, generic);
            if generic {
                break;
            }
            open.push((entered, parts_of(entered)));
            // The next part that nothing is known about.
            entered = loop {
                let Some((_, parts)) = open.last_mut() else {
                    return false;
                };
                match parts
                    .next()
                    .map(|part| (part, self.generic_types.get(&part).copied()))
                {
                    None => {
                        open.pop();
                    }
                    Some((_, Some(false))) => {}
                    Some((part, None)) => break part,
                    Some((_, Some(true))) => {
                        self.generic_types
                            .extend(open.iter().map(|&(outer, _)| (outer, true)));
                        return true;
                    }
                }
            };
        }
        self.generic_types
            .extend(open.iter().map(|&(outer, _)| (outer, true)));
        true
    }

    fn has_enum_assignment_mismatch(
        &mut self,
        sender_type: Type<'a>,
        receiver_type: Type<'a>,
    ) -> bool {
        if sender_type == receiver_type || is_without_enums(receiver_type) {
            return false;
        }
        if let Some(&mismatch) = self.top_level_mismatches.get(&(sender_type, receiver_type)) {
            return mismatch;
        }
        self.visited.clear();
        let mismatch = self.has_deep_enum_assignment_mismatch(sender_type, receiver_type, 0, false);
        self.top_level_mismatches
            .insert((sender_type, receiver_type), mismatch);
        mismatch
    }

    fn has_deep_enum_assignment_mismatch(
        &mut self,
        sender_type: Type<'a>,
        receiver_type: Type<'a>,
        depth: u32,
        within_generic_members: bool,
    ) -> bool {
        if depth > MAXIMUM_DEPTH {
            return false;
        }
        let sender_type = get_constraint_type(sender_type);
        let receiver_type = get_constraint_type(receiver_type);
        if sender_type == receiver_type
            || is_without_enums(receiver_type)
            || !self.visited.insert((sender_type, receiver_type))
        {
            return false;
        }
        if is_mismatched_enum_assignment_types(sender_type, receiver_type) {
            return true;
        }

        // Set<number> -> Set<Fruit>
        let sender_type_arguments = sender_type.get_type_arguments();
        let receiver_type_arguments = receiver_type.get_type_arguments();
        if sender_type_arguments.len() == receiver_type_arguments.len()
            && sender_type_arguments
                .iter()
                .zip(receiver_type_arguments)
                .any(|(sender, receiver)| {
                    self.has_deep_enum_assignment_mismatch(
                        sender,
                        receiver,
                        depth + 1,
                        within_generic_members,
                    )
                })
        {
            return true;
        }

        // Members of generic types can instantiate ever-larger generic types.
        let generic = self.is_generic_type(sender_type) || self.is_generic_type(receiver_type);
        if generic && within_generic_members {
            return false;
        }
        let within_generic_members = generic || within_generic_members;

        // [number, Fruit] -> Fruit[]
        if let (Some(sender), Some(receiver)) = (
            sender_type.get_number_index_type(),
            receiver_type.get_number_index_type(),
        ) && self.has_deep_enum_assignment_mismatch(
            sender,
            receiver,
            depth + 1,
            within_generic_members,
        ) {
            return true;
        }

        // { fruit: number } -> { fruit: Fruit }
        receiver_type
            .get_properties()
            .iter()
            .any(|receiver_property| {
                sender_type
                    .get_property(receiver_property.name())
                    .is_some_and(|sender_property| {
                        self.has_deep_enum_assignment_mismatch(
                            sender_property.get_type(),
                            receiver_property.get_type(),
                            depth + 1,
                            within_generic_members,
                        )
                    })
            })
    }
}

/// `[Fruit, Set<Vegetable>]` is `'Fruit', 'Vegetable'`.
fn describe_enum_types(types: &[Type]) -> Vec<u8> {
    let mut enum_names: Vec<Vec<u8>> = Vec::new();
    let mut enum_types = FxHashSet::default();
    let mut visited = FxHashSet::default();
    let mut pending = types.to_vec();
    while let Some(ty) = pending.pop() {
        let constrained_type = get_constraint_type(ty);
        if visited.len() >= MAXIMUM_DESCRIBED_TYPES || !visited.insert(constrained_type) {
            continue;
        }
        // One for each member of an enum.
        let new_enum_types = get_enum_types(constrained_type)
            .into_iter()
            .filter(|&enum_type| enum_types.insert(enum_type));
        enum_names.extend(new_enum_types.map(|enum_type| enum_type.to_text()));
        pending.extend(constrained_type.get_type_arguments());
        pending.extend(constrained_type.get_number_index_type());
        pending.extend(
            constrained_type
                .get_properties()
                .iter()
                .map(|property| property.get_type()),
        );
    }
    utils::sort::sort_unstable(&mut enum_names);
    enum_names.dedup();
    let mut description = Vec::new();
    for enum_name in &enum_names {
        if !description.is_empty() {
            description.extend_from_slice(b", ");
        }
        description.push(b'\'');
        description.extend_from_slice(enum_name);
        description.push(b'\'');
    }
    description
}

fn report<'a>(cx: &mut Context<'a>, node: Span, message: Message, receiver_types: &[Type<'a>]) {
    let enum_names = match receiver_types {
        &[only] => cx
            .state
            .descriptions
            .entry(only)
            .or_insert_with(|| describe_enum_types(receiver_types))
            .clone(),
        _ => describe_enum_types(receiver_types),
    };
    cx.report(node, message).data("enumNames", enum_names);
}

/// Object and array literals are reported per property and element.
fn is_array_or_object_literal(node: Expr) -> bool {
    matches!(node.tag(), ExprTag::Array | ExprTag::Object)
}

/// The literals inside a value that has been reported would otherwise be reported again:
/// `const value: T = [Fruit.Apple, 1] as const;`
fn mark_checked<'a>(cx: &mut Context<'a>, node: Expr<'a>) {
    let mut pending = vec![node];
    while let Some(node) = pending.pop() {
        match node.kind() {
            ExprKind::Array(elements) => {
                cx.state.checked_nodes.insert(node);
                pending.extend(elements);
            }
            ExprKind::Object(properties) => {
                cx.state.checked_nodes.insert(node);
                pending.extend(properties.iter().filter_map(Prop::value));
            }
            ExprKind::Cond { yes, no, .. } => pending.extend([yes, no]),
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => pending.extend([left, right]),
            ExprKind::Spread(expr)
            | ExprKind::As { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Satisfies { expr, .. } => pending.push(expr),
            _ => {}
        }
    }
}

/// Bitwise combinations of the members of an enum are its bit flags:
/// `const readWrite: Flags = Flags.Read | Flags.Write;`, `flags &= ~Flags.Write;`
fn is_safe_enum_bitwise_expression<'a>(node: Expr<'a>, receiver_type: Type<'a>) -> bool {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return true;
    }
    // Down the first operands in a loop: `a | b | c | ..` is as deep as it is long.
    let mut operands: SmallVec<[(Expr<'a>, Option<Expr<'a>>); 8]> = SmallVec::new();
    let mut at = node;
    loop {
        match at.kind() {
            ExprKind::Binary {
                op: BinOp::BitAnd | BinOp::BitXor | BinOp::BitOr,
                left,
                right,
            } => {
                operands.push((left, Some(right)));
                at = left;
            }
            ExprKind::Unary {
                op: UnOp::BitNot,
                operand,
            } => {
                operands.push((operand, None));
                at = operand;
            }
            _ => break,
        }
    }
    let is_of_the_type =
        |operand: Expr<'a>| !is_mismatched_enum_assignment_types(operand.ty(), receiver_type);
    // The answer for `first`, and then for the expression that it is the first operand of.
    let mut is_safe = false;
    for (first, other) in operands.into_iter().rev() {
        is_safe = (is_safe || is_of_the_type(first))
            && other.is_none_or(|it| {
                is_safe_enum_bitwise_expression(it, receiver_type) || is_of_the_type(it)
            });
    }
    is_safe
}

fn is_unsafe_assignment<'a>(
    cx: &mut Context<'a>,
    sender_node: Expr<'a>,
    receiver_type: Type<'a>,
    sender_type: Type<'a>,
) -> bool {
    cx.state
        .types
        .has_enum_assignment_mismatch(sender_type, receiver_type)
        && !is_safe_enum_bitwise_expression(sender_node, receiver_type)
}

/// Upstream's `checkAssignment`, for a `sender_node` that is known not to be an array or an object
/// literal.
fn check_assignment_of_type<'a>(
    cx: &mut Context<'a>,
    receiver_type: Type<'a>,
    sender_node: Expr<'a>,
    sender_type: Type<'a>,
    reporting_node: Span,
    message: Message,
) {
    if is_unsafe_assignment(cx, sender_node, receiver_type, sender_type) {
        report(cx, reporting_node, message, &[receiver_type]);
        mark_checked(cx, sender_node);
    }
}

/// `receiver_type` is asked only if there can be something to report.
fn check_assignment<'a>(
    cx: &mut Context<'a>,
    receiver_type: impl FnOnce() -> Option<Type<'a>>,
    sender_node: Expr<'a>,
    reporting_node: Span,
    message: Message,
) {
    if is_array_or_object_literal(sender_node) {
        return;
    }
    if let Some(receiver_type) = receiver_type().filter(|&it| !is_without_enums(it)) {
        check_assignment_of_type(
            cx,
            receiver_type,
            sender_node,
            sender_node.ty(),
            reporting_node,
            message,
        );
    }
}

/// `node`: a call, a `new` or a tagged template, whose substitutions are the arguments.
fn check_arguments<'a>(cx: &mut Context<'a>, node: Expr<'a>) {
    let (ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call)) = node.kind()
    else {
        return;
    };
    if call.args().iter().all(is_array_or_object_literal) {
        return;
    }
    let mut signature = FunctionSignature::create(node);
    if node.tag() == ExprTag::TaggedTemplate {
        // The first parameter receives the strings of the template, not a value.
        signature.get_next_parameter_type();
    }

    for argument in call.args() {
        // takesFruits(...[Fruit.Apple, 1]);
        let spread_type = match argument.kind() {
            ExprKind::Spread(spread_argument) => Some(spread_argument.ty()),
            _ => None,
        };
        if let Some(spread_type) = spread_type.filter(|it| it.is_tuple_type()) {
            let mut mismatched_parameter_types: SmallVec<[Type<'a>; 2]> = SmallVec::new();
            for element_type in spread_type.get_type_arguments() {
                if let Some(parameter_type) = signature.get_next_parameter_type()
                    && cx
                        .state
                        .types
                        .has_enum_assignment_mismatch(element_type, parameter_type)
                {
                    mismatched_parameter_types.push(parameter_type);
                }
            }
            if !mismatched_parameter_types.is_empty() {
                report(
                    cx,
                    argument.span(),
                    UNSAFE_ENUM_ARGUMENT,
                    &mismatched_parameter_types,
                );
            }
            if spread_type
                .tuple_target()
                .is_some_and(|target| target.has_rest_element())
            {
                signature.consume_remaining_arguments();
            }
            continue;
        }

        // takesFruit(1);
        // takesFruits(...numbers);
        let parameter_type = signature.get_next_parameter_type();
        check_assignment(
            cx,
            || parameter_type,
            argument,
            argument.span(),
            UNSAFE_ENUM_ARGUMENT,
        );
    }
}

/// The types that the member has in what its class extends and implements.
fn get_heritage_member_types(member: Member<'_>) -> SmallVec<[Type<'_>; 2]> {
    let mut found = SmallVec::new();
    let Node::Class(class) = member.parent() else {
        return found;
    };
    if class.extends().is_none() && class.implements().is_empty() {
        return found;
    }
    let member_name = get_static_member_access_value(member);
    let Some(member_name) = member_name.as_ref().and_then(|it| it.as_string()) else {
        return found;
    };
    let Some(class_node) = member.ts_node().parent() else {
        return found;
    };
    for heritage_clause in class_node
        .children()
        .filter(|child| child.kind() == SyntaxKind::HeritageClause)
    {
        for heritage_type in heritage_clause.children() {
            if let Some(member_symbol) = heritage_type
                .get_type_at_location()
                .get_property(member_name)
            {
                found.push(member_symbol.get_type());
            }
        }
    }
    found
}

fn check_class_member<'a>(cx: &mut Context<'a>, member: Member<'a>) {
    let Some(value) = member.init() else {
        return;
    };
    if member.kind() != MemberKind::Property
        || member.is_signature()
        || member.flags().contains(Flags::ABSTRACT)
    {
        return;
    }
    // A member of a class is not contextually typed by the member that it implements or overrides:
    // `class Basket implements HasFruit { fruit = 1; }`
    let heritage_member_types = get_heritage_member_types(member);
    if !heritage_member_types.is_empty() {
        let value_type = value.ty();
        if heritage_member_types
            .iter()
            .all(|&it| is_unsafe_assignment(cx, value, it, value_type))
        {
            report(
                cx,
                member.span(),
                UNSAFE_ENUM_ASSIGNMENT,
                &heritage_member_types,
            );
            mark_checked(cx, value);
            return;
        }
    }
    check_assignment(
        cx,
        || Some(member.type_at_location()),
        value,
        member.span(),
        UNSAFE_ENUM_ASSIGNMENT,
    );
}

fn check_mutation<'a>(cx: &mut Context<'a>, target_node: Expr<'a>, reporting_node: Expr<'a>) {
    let target_type = target_node.ty();
    if !get_enum_types(get_constraint_type(target_type)).is_empty() {
        report(
            cx,
            reporting_node.span(),
            UNSAFE_ENUM_MUTATION,
            &[target_type],
        );
    }
}

fn check_return<'a>(cx: &mut Context<'a>, return_node: Expr<'a>, reporting_node: Span) {
    if is_array_or_object_literal(return_node) {
        return;
    }
    let Some(function_node) = get_parent_function_node(return_node) else {
        return;
    };
    let Some(signature) = function_node.signature() else {
        return;
    };
    // async function getFruit(): Promise<Fruit> { return Promise.resolve(1); }
    let awaited = |ty: Type<'a>| match function_node.is_async() {
        true => ty.get_awaited_type(),
        false => Some(ty),
    };
    if let Some(receiver_type) =
        awaited(signature.get_return_type()).filter(|&it| !is_without_enums(it))
        && let Some(sender_type) = awaited(return_node.ty())
    {
        check_assignment_of_type(
            cx,
            receiver_type,
            return_node,
            sender_type,
            reporting_node,
            UNSAFE_ENUM_RETURN,
        );
    }
}

/// `{ [key in Fruit]: string }` is `Fruit`, `{ [Fruit.Apple]: string; [Vegetable.Asparagus]: string }`
/// is `Fruit.Apple` and `Vegetable.Asparagus`.
fn get_mapped_key_constraint_types<'a>(
    declaration: TsNode<'a>,
    found: &mut SmallVec<[Type<'a>; 2]>,
) {
    if !matches!(
        declaration.kind(),
        SyntaxKind::GetAccessor
            | SyntaxKind::Parameter
            | SyntaxKind::PropertyDeclaration
            | SyntaxKind::PropertySignature
            | SyntaxKind::VariableDeclaration
    ) {
        return;
    }
    let Some(type_node) = declaration.type_node() else {
        return;
    };
    match type_node.kind() {
        SyntaxKind::MappedType => {
            let type_parameter = type_node
                .children()
                .find(|child| child.kind() == SyntaxKind::TypeParameter);
            found.extend(
                type_parameter
                    .and_then(|it| it.constraint())
                    .map(|it| it.get_type_from_type_node()),
            );
        }
        SyntaxKind::TypeLiteral => {
            let names = type_node.children().filter_map(|member| member.name());
            let names = names.filter(|name| name.kind() == SyntaxKind::ComputedPropertyName);
            found.extend(
                names
                    .filter_map(|name| name.expression())
                    .map(|it| it.get_type_at_location()),
            );
        }
        _ => {}
    }
}

/// `declare const foo: { [key in Fruit]: string }; foo[0];`
fn check_computed_member<'a>(cx: &mut Context<'a>, node: Expr<'a>) {
    let ExprKind::Index { index, .. } = node.kind() else {
        return;
    };
    let Some(symbol) = node
        .ts_node()
        .expression()
        .and_then(|object| object.get_symbol_at_location())
    else {
        return;
    };
    let mut receiver_types = SmallVec::new();
    for declaration in symbol.declarations() {
        get_mapped_key_constraint_types(declaration, &mut receiver_types);
    }
    if receiver_types.is_empty() {
        return;
    }
    let sender_type = index.ty();
    let is_unsafe = receiver_types.iter().all(|&receiver_type| {
        cx.state
            .types
            .has_enum_assignment_mismatch(sender_type, receiver_type)
            || !sender_type.is_assignable_to(receiver_type)
    });
    if is_unsafe {
        report(cx, index.span(), UNSAFE_ENUM_ACCESS, &receiver_types);
    }
}

/// Checks `sender_node`, which is in `literal`, against the contextual type of `receiver_node`.
/// Unless `is_final`, what is unsafe is not reported: the literal is set aside, and the answer is
/// that there is no need to look further.
fn check_part_of_literal<'a>(
    cx: &mut Context<'a>,
    literal: Expr<'a>,
    (receiver_node, sender_node): (Expr<'a>, Expr<'a>),
    reporting_node: Span,
    is_final: bool,
) -> bool {
    if sender_node.is_missing() || is_array_or_object_literal(sender_node) {
        return false;
    }
    let Some(receiver_type) = receiver_node
        .contextual_type()
        .filter(|&it| !is_without_enums(it))
    else {
        return false;
    };
    if !is_unsafe_assignment(cx, sender_node, receiver_type, sender_node.ty()) {
        return false;
    }
    if !is_final {
        cx.state.pending.push(literal);
        return true;
    }
    report(cx, reporting_node, UNSAFE_ENUM_ASSIGNMENT, &[receiver_type]);
    mark_checked(cx, sender_node);
    false
}

/// `const fruits: Fruit[] = [1, ...numbers];`, `const box: { fruit: Fruit } = { fruit: 1, ...source };`
fn check_literal<'a>(cx: &mut Context<'a>, node: Expr<'a>, is_final: bool) {
    match node.kind() {
        ExprKind::Array(elements) => {
            for element in elements {
                if check_part_of_literal(cx, node, (element, element), element.span(), is_final) {
                    return;
                }
            }
        }
        ExprKind::Object(properties) => {
            for property in properties {
                let Some(value) = property.value() else {
                    continue;
                };
                let receiver_node = match property.kind() {
                    PropKind::Spread => node,
                    PropKind::Init | PropKind::Shorthand => value,
                    // The function of a method is no expression for TypeScript, and has no contextual type.
                    PropKind::Method | PropKind::Getter | PropKind::Setter => continue,
                };
                if check_part_of_literal(
                    cx,
                    node,
                    (receiver_node, value),
                    property.span(),
                    is_final,
                ) {
                    return;
                }
            }
        }
        _ => {}
    }
}

fn check_assignment_expression<'a>(cx: &mut Context<'a>, node: Expr<'a>) {
    let ExprKind::Assign { op, target, value } = node.kind() else {
        return;
    };
    match op {
        None
        | Some(
            BinOp::And | BinOp::BitAnd | BinOp::Nullish | BinOp::BitXor | BinOp::BitOr | BinOp::Or,
        ) => {
            check_assignment(
                cx,
                || Some(target.ty()),
                value,
                node.span(),
                UNSAFE_ENUM_ASSIGNMENT,
            );
        }
        Some(_) => check_mutation(cx, target, node),
    }
}

/// What is listened to in a file without JSX.
const WITHOUT_JSX: On = On::new()
    .members()
    .exprs(&[ExprTag::Fn])
    .stmts(&[StmtTag::Return])
    .exprs(&[ExprTag::Assign, ExprTag::Unary])
    .params()
    .pats(&[PatTag::Object, PatTag::Array])
    .var_decls()
    .exprs(&[ExprTag::Call, ExprTag::New, ExprTag::TaggedTemplate])
    .exprs(&[ExprTag::Index, ExprTag::As])
    .exprs(&[ExprTag::Array, ExprTag::Object])
    .finish();

impl Rule for NoUnsafeEnumAssignment {
    const META: Meta = Meta::typescript("no-unsafe-enum-assignment", Kind::Problem)
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    const ON: On = WITHOUT_JSX.props();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoUnsafeEnumAssignment
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if file.has_exprs([ExprTag::Jsx]) {
            Self::ON
        } else {
            WITHOUT_JSX
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match node.tag() {
            // As an expression, so that it comes before its body: both can be reported at the same
            // place, and ESLint has what is about the arrow function first.
            ExprTag::Fn => {
                if let ExprKind::Fn(func) = node.kind()
                    && let FnBody::Expr(body) = func.body()
                {
                    check_return(cx, body, body.span());
                }
            }
            // Also a default in the target of a destructuring assignment, which upstream treats alike.
            ExprTag::Assign => check_assignment_expression(cx, node),
            ExprTag::Unary => {
                if let ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                    operand,
                } = node.kind()
                {
                    check_mutation(cx, operand, node);
                }
            }
            ExprTag::Call | ExprTag::New | ExprTag::TaggedTemplate => check_arguments(cx, node),
            ExprTag::Index => check_computed_member(cx, node),
            // The type of `e as const` is that of `e`.
            ExprTag::As => {
                if let ExprKind::As { expr, ty } = node.kind() {
                    check_assignment(
                        cx,
                        || Some(ty.ty()),
                        expr,
                        node.span(),
                        UNSAFE_ENUM_ASSERTION,
                    );
                }
            }
            // Whether a literal is reported depends on what is reported around it, so that is decided at
            // the end, from the outside in.
            ExprTag::Array | ExprTag::Object => {
                // In JavaScript a property can have a type of its own, from a JSDoc comment.
                if !node.is_assignment_target()
                    && (cx.is_javascript() || node.contextual_type().is_some())
                {
                    check_literal(cx, node, false);
                }
            }
            _ => {}
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Return(Some(argument)) = statement.kind() {
            check_return(cx, argument, statement.span());
        }
    }

    fn pat<'a>(&self, pattern: Pat<'a>, cx: &mut Cx<'a, Self>) {
        match pattern.kind() {
            PatKind::Object(properties) => {
                for property in properties {
                    if let Some(right) = property.default() {
                        let left = property.value();
                        let node = Span::new(left.span().start, property.span().end);
                        check_assignment(
                            cx,
                            || Some(left.ty()),
                            right,
                            node,
                            UNSAFE_ENUM_ASSIGNMENT,
                        );
                    }
                }
            }
            PatKind::Array(elements) => {
                for element in elements {
                    if let (Some(left), Some(right)) = (element.pat(), element.default()) {
                        check_assignment(
                            cx,
                            || Some(left.ty()),
                            right,
                            element.span(),
                            UNSAFE_ENUM_ASSIGNMENT,
                        );
                    }
                }
            }
            _ => {}
        }
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        check_class_member(cx, member);
    }

    fn prop<'a>(&self, attribute: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if attribute.is_jsx_attribute()
            && attribute.kind() != PropKind::Spread
            && let Some(value) = attribute.value()
            && value.jsx_container_span().is_some()
            && !value.is_missing()
        {
            check_assignment(
                cx,
                || value.contextual_type(),
                value,
                value.span(),
                UNSAFE_ENUM_ASSIGNMENT,
            );
        }
    }

    fn param<'a>(&self, param: Param<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(right) = param.default() {
            let node = param.span_without_modifiers();
            check_assignment(
                cx,
                || Some(param.pat().ty()),
                right,
                node,
                UNSAFE_ENUM_ASSIGNMENT,
            );
        }
    }

    fn var_decl<'a>(&self, declarator: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(init) = declarator.init() {
            check_assignment(
                cx,
                || Some(declarator.pat().ty()),
                init,
                declarator.span(),
                UNSAFE_ENUM_ASSIGNMENT,
            );
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut pending = std::mem::take(&mut cx.state.pending);
        utils::sort::sort_unstable_by_key(&mut pending, |literal| literal.span().start);
        for literal in pending {
            if !cx.state.checked_nodes.contains(&literal) {
                check_literal(cx, literal, true);
            }
        }
    }
}
