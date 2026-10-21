use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    self, get_well_known_symbol_property_of_type, is_thenable_type, union_constituents,
};
use bun_lint::types::utils::{
    get_constrained_type_at_location, is_array_method_call_with_predicate, is_promise_like,
    is_rest_parameter_declaration, parse_finally_call,
};
use bun_lint::types::{NameOf, SyntaxKind, TsNode, TsSymbol, Type, TypeFlags};
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::oxlint::tsgolint_function_head_loc;
use bun_lint::utils::ts_utils::get_function_head_loc;
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};
use std::cell::Cell;

/// Disallow Promises in places not designed to handle them.
pub struct NoMisusedPromises {
    /// `None` if conditionals aren't checked.
    checks_conditionals: Option<FlagUnions>,
    checks_spreads: bool,
    checks_void_return: ChecksVoidReturn,
}

/// How a conditional treats a union that has a Promise among its constituents.
#[derive(Copy, Clone, PartialEq, Eq)]
enum FlagUnions {
    /// `Promise` and `Promise | ..` are reported.
    All,
    /// `Promise` is reported, `Promise | ..` is not.
    None,
    /// `Promise<T> | T` is reported, `Promise<T> | NotT` is not.
    Strict,
}

struct ChecksVoidReturn {
    arguments: bool,
    attributes: bool,
    inherited_methods: bool,
    properties: bool,
    returns: bool,
    variables: bool,
}

const CONDITIONAL: Message =
    Message::new("conditional", "Expected non-Promise value in a boolean conditional.");
const PREDICATE: Message = Message::new("predicate", "Expected a non-Promise value to be returned.");
const SPREAD: Message = Message::new("spread", "Expected a non-Promise value to be spread in an object.");
const VOID_RETURN_ARGUMENT: Message = Message::new(
    "voidReturnArgument",
    "Promise returned in function argument where a void return was expected.",
);
const VOID_RETURN_ATTRIBUTE: Message = Message::new(
    "voidReturnAttribute",
    "Promise-returning function provided to attribute where a void return was expected.",
);
const VOID_RETURN_INHERITED_METHOD: Message = Message::new(
    "voidReturnInheritedMethod",
    "Promise-returning method provided where a void return was expected by extended/implemented type '{{ heritageTypeName }}'.",
);
const VOID_RETURN_PROPERTY: Message = Message::new(
    "voidReturnProperty",
    "Promise-returning function provided to property where a void return was expected.",
);
const VOID_RETURN_RETURN_VALUE: Message = Message::new(
    "voidReturnReturnValue",
    "Promise-returning function provided to return value where a void return was expected.",
);
const VOID_RETURN_VARIABLE: Message = Message::new(
    "voidReturnVariable",
    "Promise-returning function provided to variable where a void return was expected.",
);

// ───────────────────────────── syntax ─────────────────────────────

fn is_logical_operator(op: BinOp) -> bool {
    matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish)
}

/// True if `node` is the `test` of a statement or conditional expression, or the operand of a `!`.
fn is_test(node: Expr) -> bool {
    match node.parent() {
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::If { test, .. } | StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } => test == node,
            StmtKind::For { test, .. } => test == Some(node),
            _ => false,
        },
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Cond { test, .. } => test == node,
            ExprKind::Unary { op, .. } => op == UnOp::Not,
            _ => false,
        },
        _ => false,
    }
}

/// True if `node` is an operand, at any depth, of logical operators that make up a [test](is_test).
fn is_in_test<'a>(node: Expr<'a>, known: &mut AncestorMemo<'a, bool>) -> bool {
    let decide = |at: Node<'a>, parent: Node<'a>| match (at, parent) {
        (Node::Expr(at), _) if at.with_jsdoc_cast() != at => Some(false),
        (_, Node::Expr(parent)) if matches!(parent.kind(), ExprKind::Binary { op, .. } if is_logical_operator(op)) => None,
        (Node::Expr(at), _) => Some(is_test(at)),
        _ => Some(false),
    };
    known.find(Node::Expr(node), decide).unwrap_or(false)
}

/// Caches whether each kind of primitive value has a `then`, which would come from `Boolean`, `Number`, `BigInt` or
/// `String`. A program can add to those interfaces. `None` until first use.
#[derive(Default)]
struct ThenablePrimitives([Cell<Option<bool>>; 4]);

/// True if `node`'s type can have a `then`. All primitive values of one kind give the same answer.
fn can_be_thenable(node: Expr, known: &ThenablePrimitives) -> bool {
    if node.has_jsdoc_cast() {
        return true;
    }
    let kind_index = match node.kind() {
        ExprKind::Null | ExprKind::Unary { op: UnOp::Void, .. } => return false,
        ExprKind::True | ExprKind::False | ExprKind::Unary { op: UnOp::Not | UnOp::Delete, .. } => 0,
        ExprKind::Number(_) => 1,
        ExprKind::BigInt(_) => 2,
        ExprKind::String(_) | ExprKind::Template(_) | ExprKind::Unary { op: UnOp::Typeof, .. } => 3,
        // A number, a bigint or a string. tsgolint gets the type of these as it does for any test.
        ExprKind::Unary { .. } => return node.file().language().is_oxlint,
        ExprKind::Binary { op, .. } => match op {
            BinOp::Lt
            | BinOp::Le
            | BinOp::Gt
            | BinOp::Ge
            | BinOp::EqEq
            | BinOp::NotEq
            | BinOp::EqEqEq
            | BinOp::NotEqEq
            | BinOp::In
            | BinOp::Instanceof => 0,
            BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma => return true,
            _ => return node.file().language().is_oxlint,
        },
        _ => return true,
    };
    let Some(known) = known.0.get(kind_index) else {
        return true;
    };
    known.get().unwrap_or_else(|| {
        let ty = node.ts_node().get_type_at_location().get_apparent_type();
        let has_then = ty.get_property(b"then").is_some();
        known.set(Some(has_then));
        has_then
    })
}

/// Caches whether each kind of literal has call signatures, which would come from `Boolean`, `Number`, `BigInt`,
/// `String` or `Array`. A program can add to those interfaces. `None` until first use.
#[derive(Default)]
struct CallableLiterals([Cell<Option<bool>>; 5]);

/// True if `node`'s type can have call signatures. All literals of one kind give the same answer.
fn can_be_function(node: Expr, known: &CallableLiterals) -> bool {
    if node.has_jsdoc_cast() {
        return true;
    }
    let kind_index = match node.kind() {
        ExprKind::Missing | ExprKind::Null => return false,
        // `{ ...t }` has `t`'s type if that's a type parameter.
        ExprKind::Object(properties) => return properties.iter().any(|it| it.kind() == PropKind::Spread),
        ExprKind::True | ExprKind::False => 0,
        ExprKind::Number(_) => 1,
        ExprKind::BigInt(_) => 2,
        ExprKind::String(_) | ExprKind::Template(_) => 3,
        ExprKind::Array(_) => 4,
        _ => return true,
    };
    let Some(known) = known.0.get(kind_index) else {
        return true;
    };
    known.get().unwrap_or_else(|| {
        let ty = node.ts_node().get_type_at_location().get_apparent_type();
        let is_callable = !ty.get_call_signatures().is_empty();
        known.set(Some(is_callable));
        is_callable
    })
}

#[derive(Default)]
pub struct State<'a> {
    /// Caches, for the nodes passed on the way up from an operand, whether they're in a test.
    tests: AncestorMemo<'a, bool>,
    callable_literals: CallableLiterals,
    thenable_primitives: ThenablePrimitives,
}

/// True if an annotated type might be a function type, judging by the syntax.
fn is_possibly_function_type(node: TypeNode, is_oxlint: bool) -> bool {
    // For tsgolint a parenthesized type is a `ParenthesizedType`, which isn't one of these.
    if is_oxlint && node.is_parenthesized() {
        return false;
    }
    match node.kind() {
        TypeKind::Cond { .. }
        | TypeKind::Fn(_)
        | TypeKind::Import { .. }
        | TypeKind::IndexedAccess { .. }
        | TypeKind::Infer(_)
        | TypeKind::Intersection(_)
        | TypeKind::Keyword(Keyword::This)
        | TypeKind::Keyof(_)
        | TypeKind::Readonly(_)
        | TypeKind::UniqueSymbol
        | TypeKind::Typeof { .. }
        | TypeKind::Ref { .. }
        | TypeKind::Union(_) => true,
        TypeKind::Object(members) => members
            .iter()
            .any(|member| matches!(member.kind(), MemberKind::CallSignature | MemberKind::ConstructSignature)),
        _ => false,
    }
}

// ───────────────────────────── types ─────────────────────────────

fn is_sometimes_thenable(node: TsNode) -> bool {
    let ty = node.get_type_at_location();
    union_constituents(ty.get_apparent_type()).iter().any(|sub_type| is_thenable_type(node, sub_type))
}

/// A variation on the thenable check that requires every constituent of a union to be thenable. Otherwise
/// `promise | undefined` would be reported where it's tested for `undefined`.
fn is_always_thenable(node: TsNode) -> bool {
    let ty = node.get_type_at_location();
    union_constituents(ty.get_apparent_type()).iter().all(|sub_type| {
        let Some(then_prop) = sub_type.get_property(b"then") else {
            return false;
        };
        union_constituents(then_prop.get_type_at_location(node)).iter().any(|sub_type| {
            sub_type.get_call_signatures().iter().any(|signature| {
                signature.parameters().first().is_some_and(|param| is_function_param(param, node))
            })
        })
    })
}

fn is_function_param<'a>(param: TsSymbol<'a>, node: TsNode<'a>) -> bool {
    let ty = param.get_type_at_location(node).get_apparent_type();
    union_constituents(ty).iter().any(|sub_type| !sub_type.get_call_signatures().is_empty())
}

/// True if any call signature of the type has a thenable return type.
fn any_signature_is_thenable_type<'a>(node: TsNode<'a>, ty: Type<'a>) -> bool {
    ty.get_call_signatures().iter().any(|signature| is_thenable_type(node, signature.get_return_type()))
}

/// True if the type is a thenable-returning function.
fn is_thenable_returning_function_type<'a>(node: TsNode<'a>, ty: Type<'a>) -> bool {
    union_constituents(ty).iter().any(|sub_type| any_signature_is_thenable_type(node, sub_type))
}

/// True if the type is a void-returning function.
fn is_void_returning_function_type<'a>(node: TsNode<'a>, ty: Type<'a>) -> bool {
    let mut had_void_return = false;
    for sub_type in union_constituents(ty) {
        for signature in sub_type.get_call_signatures() {
            let return_type = signature.get_return_type();
            // If both thenable and void returns are accepted, a promise-returning function is valid.
            if is_thenable_type(node, return_type) {
                return false;
            }
            had_void_return |= tsutils::is_type_flag_set(return_type, TypeFlags::VOID);
        }
    }
    had_void_return
}

/// True if the expression or declaration is a function that returns a thenable.
fn returns_thenable(node: TsNode) -> bool {
    let ty = node.get_type_at_location().get_apparent_type();
    union_constituents(ty).iter().any(|t| any_signature_is_thenable_type(node, t))
}

/// True if `predicate` accepts the type of a `ty` constituent's `[Symbol.dispose]`.
fn has_dispose_method<'a>(
    node: TsNode<'a>,
    ty: Type<'a>,
    predicate: fn(TsNode<'a>, Type<'a>) -> bool,
) -> bool {
    union_constituents(ty.get_apparent_type()).iter().any(|type_part| {
        get_well_known_symbol_property_of_type(type_part, "dispose")
            .is_some_and(|symbol| predicate(node, symbol.get_type_at_location(node)))
    })
}

fn are_equivalent<'a>(left: Type<'a>, right: Type<'a>) -> bool {
    left.is_assignable_to(right) && right.is_assignable_to(left)
}

/// True if the Promises in a union resolve to the same types as the rest of the union.
fn has_matching_promise_type_argument(node: TsNode) -> bool {
    let constituents = union_constituents(node.get_type_at_location().get_apparent_type());
    let (promise_types, non_promise_types): (SmallVec<[Type; 4]>, SmallVec<[Type; 4]>) =
        constituents.iter().partition(|&ty| is_thenable_type(node, ty));
    if promise_types.is_empty() {
        return false;
    }
    let mut awaited_types: SmallVec<[Type; 4]> = SmallVec::new();
    for promise_type in promise_types {
        let Some(awaited_type) = promise_type.get_awaited_type() else {
            return false;
        };
        awaited_types.extend(union_constituents(awaited_type));
    }
    non_promise_types.iter().all(|&ty| awaited_types.iter().any(|&awaited| are_equivalent(ty, awaited)))
        && awaited_types.iter().all(|&awaited| non_promise_types.iter().any(|&ty| are_equivalent(ty, awaited)))
}

/// A type that a class or interface extends or implements.
struct HeritageType<'a> {
    ty: Type<'a>,
    /// `type.getSymbol()?.members`: the first member with each name.
    members: FxHashMap<&'a [u8], TsSymbol<'a>>,
}

impl<'a> HeritageType<'a> {
    fn new(ty: Type<'a>) -> Self {
        let mut members = FxHashMap::default();
        for member in ty.get_symbol().into_iter().flat_map(|symbol| symbol.members()) {
            members.entry(member.name()).or_insert(member);
        }
        HeritageType { ty, members }
    }

    /// Returns the member with the given name, if it exists.
    fn get_member_if_exists(&self, member_name: &[u8]) -> Option<TsSymbol<'a>> {
        self.members.get(member_name).copied().or_else(|| self.ty.get_property(member_name))
    }
}

fn get_heritage_types(ts_node: TsNode<'_>) -> SmallVec<[HeritageType<'_>; 2]> {
    ts_node
        .children()
        .filter(|child| child.kind() == SyntaxKind::HeritageClause)
        .flat_map(|clause| clause.children())
        .map(|type_expression| HeritageType::new(type_expression.get_type_at_location()))
        .collect()
}

fn is_promise_finally_method(node: Expr) -> bool {
    parse_finally_call(node).is_some_and(|call| is_promise_like(get_constrained_type_at_location(call.object)))
}

/// Records whether a position accepts functions that return a thenable, and functions that return nothing.
#[derive(Copy, Clone, Default)]
struct Accepted {
    thenable_return: bool,
    void_return: bool,
}

impl Accepted {
    fn add_type<'a>(&mut self, expression: TsNode<'a>, ty: Type<'a>) {
        if is_thenable_returning_function_type(expression, ty) {
            self.thenable_return = true;
        } else if is_void_returning_function_type(expression, ty) {
            self.void_return = true;
        }
    }
}

/// An argument that returns a thenable, and what the parameters at its position accept.
struct Argument<'a> {
    index: usize,
    node: Expr<'a>,
    accepted: Accepted,
    /// The type of a parameter at its position: the last one visited.
    parameter_type: Option<Type<'a>>,
}

impl<'a> Argument<'a> {
    fn add_parameter_type(&mut self, expression: TsNode<'a>, ty: Type<'a>) {
        if self.parameter_type != Some(ty) {
            self.accepted.add_type(expression, ty);
            self.parameter_type = Some(ty);
        }
    }
}

/// A rest parameter at `index` takes all the arguments from there to the end.
fn add_rest_parameter_type<'a>(expression: TsNode<'a>, index: usize, ty: Type<'a>, arguments: &mut [Argument<'a>]) {
    let type_args = ty.get_type_arguments();
    let (is_array, is_tuple) = (ty.is_array_type(), ty.is_tuple_type());
    for argument in arguments.iter_mut().filter(|it| it.index >= index) {
        let element = match (is_array, is_tuple) {
            (true, _) => type_args.first(),
            (false, true) => type_args.get(argument.index - index),
            (false, false) => None,
        };
        if let Some(element) = element {
            argument.add_parameter_type(expression, element);
        }
    }
}

/// Works out which of `arguments` are passed for void functions and not also for thenable functions. It looks at all
/// signatures, because the resolved one could be an early `() => void` where a later `() => Promise<void>` applies as
/// well.
fn void_function_arguments<'a>(
    node: Expr<'a>,
    call: Call<'a>,
    arguments: &mut [Argument<'a>],
) {
    let (node, is_new) = (node.ts_node(), node.tag() == ExprTag::New);
    let expression = call.callee().ts_node_with_parentheses();
    for sub_type in union_constituents(expression.get_type_at_location()) {
        let signatures = match is_new {
            true => sub_type.get_construct_signatures(),
            false => sub_type.get_call_signatures(),
        };
        for signature in signatures {
            for (index, parameter) in signature.parameters().iter().enumerate() {
                if parameter.value_declaration().is_some_and(is_rest_parameter_declaration) {
                    add_rest_parameter_type(expression, index, parameter.get_type_at_location(expression), arguments);
                    continue;
                }
                // They're sorted by index.
                if let Ok(at) = arguments.binary_search_by_key(&index, |it| it.index)
                    && let Some(argument) = arguments.get_mut(at)
                {
                    argument.add_parameter_type(expression, parameter.get_type_at_location(expression));
                }
            }
        }
    }
    // Upstream checks the contextual type next to each parameter type. It's the same for all of them.
    for argument in arguments {
        if let Some(parameter_type) = argument.parameter_type
            && let Some(contextual_type) = node.get_contextual_type_for_argument_at_index(argument.index)
            && contextual_type != parameter_type
        {
            argument.accepted.add_type(expression, contextual_type);
        }
    }
}

/// tsgolint's `promiseRange` of a function: its return type, or else its `=>`, or else its head.
fn tsgolint_promise_range(func: Func) -> Span {
    match (func.return_type(), func.arrow_span()) {
        (Some(return_type), _) => return_type.span(),
        (None, Some(arrow)) => arrow,
        (None, None) => tsgolint_function_head_loc(func),
    }
}

/// Returns where a value is reported. For a function, oxlint points at a part of it.
fn report_span(value: Expr) -> Span {
    let value = value.with_jsdoc_cast();
    match value.as_fn().filter(|_| value.file().language().is_oxlint) {
        Some(func) => tsgolint_promise_range(func),
        None => value.span(),
    }
}

/// Where in this file a void-returning function is expected, and through which type.
type Expectation<'a> = Option<(Span, Type<'a>)>;

/// tsgolint's `expectationRange`: a declaration's type annotation, or its name, or the whole declaration.
fn tsgolint_expectation_range(declaration: TsNode) -> Span {
    declaration.type_node().or_else(|| declaration.name()).unwrap_or(declaration).span()
}

/// tsgolint's `localExpectationForSymbol`: uses the first declaration that's in this file.
fn tsgolint_expectation_for_symbol<'a>(symbol: Option<TsSymbol<'a>>, ty: Type<'a>) -> Expectation<'a> {
    let symbol = symbol?;
    let mut declarations = symbol.value_declaration().into_iter().chain(symbol.declarations());
    Some((tsgolint_expectation_range(declarations.find(|it| it.is_in_linted_file())?), ty))
}

/// Returns what tsgolint's `voidFunctionArguments` records for the argument at `index`: the last parameter in this file
/// whose type is a void-returning function, or else the first parameter for which the argument's contextual type is
/// one.
fn tsgolint_expectation_for_argument<'a>(node: Expr<'a>, call: Call<'a>, index: usize) -> Expectation<'a> {
    let expression = call.callee().ts_node_with_parentheses();
    let contextual_type = node.ts_node().get_contextual_type_for_argument_at_index(index);
    let accepts_void = |ty: Type<'a>| {
        !is_thenable_returning_function_type(expression, ty) && is_void_returning_function_type(expression, ty)
    };
    let (mut parameter_expectation, mut context_expectation) = (None, None);
    for sub_type in union_constituents(expression.get_type_at_location()) {
        let signatures = match node.tag() == ExprTag::New {
            true => sub_type.get_construct_signatures(),
            false => sub_type.get_call_signatures(),
        };
        for signature in signatures {
            for (at, parameter) in signature.parameters().iter().enumerate() {
                let Some(declaration) = parameter.value_declaration().filter(|it| it.is_in_linted_file()) else {
                    continue;
                };
                let ty = parameter.get_type_at_location(expression);
                let ty = match is_rest_parameter_declaration(declaration) {
                    false => (at == index).then_some(ty),
                    true if index < at => None,
                    true if ty.is_array_type() => ty.get_type_arguments().first(),
                    true if ty.is_tuple_type() => ty.get_type_arguments().get(index - at),
                    true => None,
                };
                let Some(ty) = ty else {
                    continue;
                };
                if accepts_void(ty) {
                    parameter_expectation = Some((tsgolint_expectation_range(declaration), ty));
                }
                if let Some(contextual_type) = contextual_type.filter(|it| *it != ty && accepts_void(*it)) {
                    let at = tsgolint_expectation_range(declaration);
                    context_expectation = context_expectation.or(Some((at, contextual_type)));
                }
            }
        }
    }
    parameter_expectation.or(context_expectation)
}

/// tsgolint's labels: the type of the reported value, what's expected, and the diagnostic's location.
fn tsgolint_labels<'a>(
    labels: &mut Details,
    ty: Type<'a>,
    is_function: bool,
    primary: Span,
    expectation: Expectation<'a>,
) {
    let is_callback = is_function || !ty.get_call_signatures().is_empty();
    let what = if is_callback { "This callback" } else { "This expression" };
    labels.first(format!("{what} has type `{}`.", bstr::BStr::new(&ty.to_text())));
    if let Some((at, ty)) = expectation {
        let ty = ty.to_text();
        let ty = bstr::BStr::new(&ty);
        labels.push(at, format!("This context accepts a `void`-returning callback through type `{ty}`."));
    }
    labels.push(primary, "");
}

fn tsgolint_labels_of_value<'a>(labels: &mut Details, value: Expr<'a>, expectation: Expectation<'a>) {
    let value = value.with_jsdoc_cast();
    tsgolint_labels(labels, value.ty(), value.as_fn().is_some(), report_span(value), expectation);
}

impl NoMisusedPromises {
    // ───────────────────────────── conditionals ─────────────────────────────

    /// Checks an operand that isn't a logical expression itself.
    fn check_conditional_operand<'a>(&self, node: Expr<'a>, cx: &Cx<'a, Self>) {
        if !can_be_thenable(node, &cx.state.thenable_primitives) {
            return;
        }
        let ts_node = node.ts_node_for_type();
        let is_misused = is_always_thenable(ts_node)
            || match self.checks_conditionals {
                Some(FlagUnions::All) => is_sometimes_thenable(ts_node),
                Some(FlagUnions::Strict) => has_matching_promise_type_argument(ts_node),
                Some(FlagUnions::None) | None => false,
            };
        if is_misused {
            cx.report(node, CONDITIONAL).labels_with(|labels| tsgolint_labels_of_value(labels, node, None));
        }
    }

    /// Checks a test, including all the operands of the logical operators it consists of.
    fn check_test<'a>(&self, test: Expr<'a>, cx: &Cx<'a, Self>) {
        let mut rest: SmallVec<[Expr; 8]> = smallvec![test];
        while let Some(node) = rest.pop() {
            let node = node.with_jsdoc_cast();
            match node.kind() {
                ExprKind::Binary { op, left, right } if is_logical_operator(op) => rest.extend([right, left]),
                _ => self.check_conditional_operand(node, cx),
            }
        }
    }

    fn check_test_of_statement<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match node.kind() {
            StmtKind::If { test, .. }
            | StmtKind::While { test, .. }
            | StmtKind::DoWhile { test, .. }
            | StmtKind::For { test: Some(test), .. } => {
                // tsgolint doesn't check a test that's an assignment, unless it's parenthesized.
                if !(cx.language().is_oxlint && test.tag() == ExprTag::Assign && !test.is_parenthesized()) {
                    self.check_test(test, cx);
                }
            }
            _ => {}
        }
    }

    fn check_test_of_expression<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match node.kind() {
            ExprKind::Cond { test, .. } | ExprKind::Unary { op: UnOp::Not, operand: test } => self.check_test(test, cx),
            _ => {}
        }
    }

    /// Outside a test only the left operand is converted to a boolean, and not for `??`. A left operand that's a
    /// logical expression gets its own call.
    fn check_logical_expression<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op: BinOp::And | BinOp::Or, left, .. } = node.kind() else {
            return;
        };
        let left = left.with_jsdoc_cast();
        if matches!(left.kind(), ExprKind::Binary { op, .. } if is_logical_operator(op))
            || !can_be_thenable(left, &cx.state.thenable_primitives)
            || is_in_test(node, &mut cx.state.tests)
        {
            return;
        }
        self.check_conditional_operand(left, cx);
    }

    fn check_array_predicates<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = node.kind() else {
            return;
        };
        let known = &cx.state.callable_literals;
        let Some(callback) = call.args().first().filter(|&callback| can_be_function(callback, known)) else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // For tsgolint `(a.filter)` is a `ParenthesizedExpression`, so the callee isn't an access expression.
        if (is_oxlint && call.callee().is_parenthesized())
            || !is_array_method_call_with_predicate(node)
            || !returns_thenable(callback.ts_node_for_type())
        {
            return;
        }
        // Upstream listens for every `MemberExpression` directly in a call: the callee, and any arguments that are one.
        // tsgolint has one where ESLint has a `ChainExpression`, and none in parentheses.
        let is_member_expression = |it: &Expr| {
            matches!(it.tag(), ExprTag::Dot | ExprTag::Index)
                && if is_oxlint { !it.is_parenthesized() } else { !it.is_chain_root() }
        };
        for _ in 0..=call.args().iter().filter(is_member_expression).count() {
            cx.report(report_span(callback), PREDICATE)
                .labels_with(|labels| tsgolint_labels_of_value(labels, callback, None));
        }
    }

    // ───────────────────────────── void returns ─────────────────────────────

    fn check_arguments<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (ExprKind::Call(call) | ExprKind::New(call)) = node.kind() else {
            return;
        };
        let mut arguments: SmallVec<[Argument; 2]> = call
            .args()
            .iter()
            .enumerate()
            .filter(|(_, argument)| {
                can_be_function(*argument, &cx.state.callable_literals) && returns_thenable(argument.ts_node_for_type())
            })
            .map(|(index, node)| Argument {
                index,
                node,
                accepted: Accepted::default(),
                parameter_type: None,
            })
            .collect();
        // tsgolint does report `finally`.
        if arguments.is_empty() || !cx.language().is_oxlint && is_promise_finally_method(node) {
            return;
        }
        void_function_arguments(node, call, &mut arguments);
        for argument in arguments {
            if argument.accepted.void_return && !argument.accepted.thenable_return {
                cx.report(report_span(argument.node), VOID_RETURN_ARGUMENT).labels_with(|labels| {
                    let expectation = tsgolint_expectation_for_argument(node, call, argument.index);
                    tsgolint_labels_of_value(labels, argument.node, expectation);
                });
            }
        }
    }

    fn check_assignment<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Assign { target, value, .. } = node.kind() else {
            return;
        };
        // A default in a destructuring assignment is an `AssignmentPattern`. For tsgolint it's a `BinaryExpression`
        // like any assignment, except in `{ a = b }`.
        let is_pattern = match cx.language().is_oxlint {
            true => matches!(node.parent(), Node::Prop(property) if property.kind() == PropKind::Shorthand),
            false => node.is_assignment_target(),
        };
        if is_pattern || !can_be_function(value, &cx.state.callable_literals) {
            return;
        }
        let left = target.ts_node_for_type();
        if returns_thenable(value.ts_node_with_parentheses())
            && is_void_returning_function_type(left, left.get_type_at_location())
        {
            cx.report(report_span(value), VOID_RETURN_VARIABLE).labels_with(|labels| {
                let expectation = tsgolint_expectation_for_symbol(target.ts_symbol(), left.get_type_at_location());
                tsgolint_labels_of_value(labels, value, expectation);
            });
        }
    }

    fn check_variable_declaration<'a>(&self, node: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let Some(init) = node.init() else {
            return;
        };
        // tsgolint doesn't handle `using`.
        let is_oxlint = cx.language().is_oxlint;
        let (annotation, is_using) = (node.ty(), !is_oxlint && node.var_kind() == VarKind::Using);
        if annotation.is_none() && !is_using {
            return;
        }
        let initializer = init.ts_node_with_parentheses();
        let disposes_asynchronously = || {
            has_dispose_method(initializer, initializer.get_type_at_location(), is_thenable_returning_function_type)
        };
        if is_using && disposes_asynchronously() {
            cx.report(report_span(init), VOID_RETURN_VARIABLE)
                .labels_with(|labels| tsgolint_labels_of_value(labels, init, None));
        }
        let Some(annotation) = annotation else {
            return;
        };
        // These are neither functions nor disposable.
        match annotation.kind() {
            TypeKind::Keyword(Keyword::This) => {}
            TypeKind::Keyword(_)
            | TypeKind::StringLit(_)
            | TypeKind::NumberLit(_)
            | TypeKind::BigIntLit { .. }
            | TypeKind::BoolLit(_)
            | TypeKind::Template(_) => return,
            _ => {}
        }
        let name = node.pat().ts_node();
        let variable_type = name.get_type_at_location();
        if !is_oxlint
            && has_dispose_method(name, variable_type, is_void_returning_function_type)
            && disposes_asynchronously()
        {
            cx.report(report_span(init), VOID_RETURN_VARIABLE)
                .labels_with(|labels| tsgolint_labels_of_value(labels, init, None));
        }
        if is_possibly_function_type(annotation, is_oxlint)
            && can_be_function(init, &cx.state.callable_literals)
            && is_void_returning_function_type(initializer, variable_type)
            && returns_thenable(initializer)
        {
            cx.report(report_span(init), VOID_RETURN_VARIABLE).labels_with(|labels| {
                tsgolint_labels_of_value(labels, init, Some((annotation.outer_span(), variable_type)));
            });
        }
    }

    /// Reports a function that's a property's value.
    fn report_property_function<'a>(
        function_node: Func<'a>,
        expectation: impl FnOnce() -> Expectation<'a>,
        cx: &Cx<'a, Self>,
    ) {
        let report_span = match function_node.return_type() {
            Some(return_type) => return_type.span(),
            None if cx.language().is_oxlint => tsgolint_promise_range(function_node),
            None => get_function_head_loc(function_node),
        };
        cx.report(report_span, VOID_RETURN_PROPERTY).labels_with(|labels| {
            tsgolint_labels(labels, function_node.type_at_location(), true, report_span, expectation());
        });
    }

    /// `key: value` and `key`
    fn check_property_value<'a>(&self, value: Expr<'a>, cx: &Cx<'a, Self>) {
        let value = value.with_jsdoc_cast();
        if !can_be_function(value, &cx.state.callable_literals) {
            return;
        }
        let initializer = value.ts_node_with_parentheses();
        if !returns_thenable(initializer)
            || !initializer
                .get_contextual_type()
                .is_some_and(|contextual_type| is_void_returning_function_type(initializer, contextual_type))
        {
            return;
        }
        // tsgolint's `localPropertyExpectation`
        let expectation = || {
            let Node::Prop(property) = value.parent() else {
                return None;
            };
            let Node::Expr(object) = property.parent() else {
                return None;
            };
            let symbol = object.ts_node().get_contextual_type()?.get_property(property.key()?.name()?.bytes());
            tsgolint_expectation_for_symbol(symbol, initializer.get_contextual_type()?)
        };
        match value.as_fn() {
            Some(function_node) => Self::report_property_function(function_node, expectation, cx),
            None => {
                cx.report(value, VOID_RETURN_PROPERTY)
                    .labels_with(|labels| tsgolint_labels_of_value(labels, value, expectation()));
            }
        }
    }

    /// `key() {}`
    fn check_method<'a>(&self, node: Prop<'a>, cx: &Cx<'a, Self>) {
        let (Some(key), Some(function_node), Node::Expr(obj)) = (node.key(), node.func(), node.parent()) else {
            return;
        };
        if key.is_computed() || !returns_thenable(node.ts_node()) {
            return;
        }
        let Some(obj_type) = obj.ts_node().get_contextual_type() else {
            return;
        };
        // tsgolint queries the contextual type itself, by the name without its quotes. A union only has the properties
        // that all of its constituents have.
        let is_oxlint = cx.language().is_oxlint;
        let name_text = match key.name() {
            Some(name) if is_oxlint => name.bytes(),
            _ => cx.slice(key.span(cx.file())),
        };
        let property_symbol = match is_oxlint {
            true => obj_type.get_property(name_text),
            false => union_constituents(obj_type).iter().find_map(|t| t.get_property(name_text)),
        };
        let Some(property_symbol) = property_symbol else {
            return;
        };
        let name = NameOf(node).ts_node();
        let contextual_type = property_symbol.get_type_at_location(name);
        if is_void_returning_function_type(name, contextual_type) {
            let expectation = || tsgolint_expectation_for_symbol(Some(property_symbol), contextual_type);
            Self::report_property_function(function_node, expectation, cx);
        }
    }

    fn check_jsx_attribute<'a>(&self, node: Prop<'a>, cx: &Cx<'a, Self>) {
        let known = &cx.state.callable_literals;
        let Some(value) = node.value().filter(|&value| can_be_function(value, known)) else {
            return;
        };
        let Some(expression_container) = value.jsx_container_span() else {
            return;
        };
        let expression = value.ts_node_for_type();
        if returns_thenable(expression)
            && expression
                .get_contextual_type()
                .is_some_and(|contextual_type| is_void_returning_function_type(expression, contextual_type))
        {
            let at = if cx.language().is_oxlint { report_span(value) } else { expression_container };
            cx.report(at, VOID_RETURN_ATTRIBUTE).labels_with(|labels| tsgolint_labels_of_value(labels, value, None));
        }
    }

    fn check_return_statement<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Return(Some(argument)) = node.kind() else {
            return;
        };
        if !can_be_function(argument, &cx.state.callable_literals) {
            return;
        }
        // A `return` outside a function is legal in a CommonJS module.
        let Some(function_node) = Node::Stmt(node).enclosing_function() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        if function_node.return_type().is_some_and(|it| !is_possibly_function_type(it, is_oxlint)) {
            return;
        }
        let expression = argument.ts_node_with_parentheses();
        if returns_thenable(expression)
            && expression
                .get_contextual_type()
                .is_some_and(|contextual_type| is_void_returning_function_type(expression, contextual_type))
        {
            cx.report(report_span(argument), VOID_RETURN_RETURN_VALUE).labels_with(|labels| {
                // Or the return type of the signature that a callback gets its types from.
                let contextual_return_type = || {
                    let signatures = function_node.ts_node().get_contextual_type()?.get_call_signatures();
                    let mut declarations = signatures.into_iter().filter_map(|it| it.declaration());
                    let declaration = declarations.find(|it| it.is_in_linted_file())?;
                    Some(declaration.type_node()?.span())
                };
                let at = function_node.return_type().map(|it| it.outer_span()).or_else(contextual_return_type);
                tsgolint_labels_of_value(labels, argument, at.zip(expression.get_contextual_type()));
            });
        }
    }

    fn check_class<'a>(&self, node: Class<'a>, cx: &mut Cx<'a, Self>) {
        if node.extends().is_some() || !node.implements().is_empty() {
            self.check_members(node.ts_node(), node.members(), cx);
        }
    }

    fn check_interface<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Interface(interface) = node.kind()
            && !interface.extends().is_empty()
        {
            self.check_members(node.ts_node(), interface.members(), cx);
        }
    }

    /// Reports the members that return a Promise where a type that the class or interface `ts_node` extends or
    /// implements has a member with the same name that returns void.
    fn check_members<'a>(&self, ts_node: TsNode<'a>, members: List<'a, Member<'a>>, cx: &Cx<'a, Self>) {
        let mut heritage_types: Option<SmallVec<[HeritageType; 2]>> = None;
        for member in members {
            // Call, construct and index signatures have no name. A private name isn't inherited.
            let Some(key) = member.key().filter(|key| !key.is_private()) else {
                continue;
            };
            let node_member = member.ts_node();
            if member.is_static() || !returns_thenable(node_member) {
                continue;
            }
            // tsgolint uses the name without its quotes, and skips a computed one.
            let member_name = match (cx.language().is_oxlint, key.name()) {
                (false, _) => cx.slice(key.span(cx.file())),
                (true, Some(name)) if !key.is_computed() => name.bytes(),
                (true, _) => continue,
            };
            for heritage_type in heritage_types.get_or_insert_with(|| get_heritage_types(ts_node)).iter() {
                let Some(heritage_member) = heritage_type.get_member_if_exists(member_name) else {
                    continue;
                };
                if is_void_returning_function_type(node_member, heritage_member.get_type_at_location(node_member)) {
                    let report_span = match member.func().filter(|_| cx.language().is_oxlint) {
                        Some(func) => tsgolint_promise_range(func),
                        None => member.span(),
                    };
                    cx.report(report_span, VOID_RETURN_INHERITED_METHOD)
                        .data("heritageTypeName", heritage_type.ty.to_text())
                        .labels_with(|labels| {
                            let member_type = heritage_member.get_type_at_location(node_member);
                            let expectation = tsgolint_expectation_for_symbol(Some(heritage_member), member_type);
                            let ty = node_member.get_type_at_location();
                            tsgolint_labels(labels, ty, member.func().is_some(), report_span, expectation);
                        });
                }
            }
        }
    }

    // ───────────────────────────── spreads ─────────────────────────────

    fn check_spread_argument<'a>(argument: Expr<'a>, cx: &Cx<'a, Self>) {
        let argument = argument.with_jsdoc_cast();
        if is_sometimes_thenable(argument.ts_node_with_parentheses()) {
            let dots = Span::before(argument.parent().span().start, argument.outer_span());
            cx.report(argument, SPREAD).comments_apply_at(dots).labels_with(|labels| {
                tsgolint_labels(labels, argument.ty(), argument.as_fn().is_some(), dots, None);
            });
        }
    }

    /// `...argument` in an array literal or in a call's arguments.
    fn check_spread_element<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (ExprKind::Spread(argument), Node::Expr(parent)) = (node.kind(), node.parent()) else {
            return;
        };
        match parent.kind() {
            ExprKind::Call(_) | ExprKind::New(_) => {}
            // In an `ArrayPattern` it's a `RestElement`, which is a `SpreadElement` for tsgolint.
            ExprKind::Array(_) if cx.language().is_oxlint || !parent.is_assignment_target() => {}
            _ => return,
        }
        Self::check_spread_argument(argument, cx);
    }

    /// Object literal properties and JSX attributes.
    fn check_prop<'a>(&self, node: Prop<'a>, cx: &mut Cx<'a, Self>) {
        let checks = &self.checks_void_return;
        match (node.kind(), node.is_jsx_attribute()) {
            (PropKind::Spread, true) => {}
            (PropKind::Spread, false) => {
                // In an `ObjectPattern` it's a `RestElement`.
                if self.checks_spreads
                    && let (Some(argument), Node::Expr(parent)) = (node.value(), node.parent())
                    && (cx.language().is_oxlint || !parent.is_assignment_target())
                {
                    Self::check_spread_argument(argument, cx);
                }
            }
            (_, true) => {
                if checks.attributes {
                    self.check_jsx_attribute(node, cx);
                }
            }
            (PropKind::Init | PropKind::Shorthand, false) => {
                if checks.properties
                    && let Some(value) = node.value()
                {
                    self.check_property_value(value, cx);
                }
            }
            (PropKind::Method, false) => {
                if checks.properties {
                    self.check_method(node, cx);
                }
            }
            (PropKind::Getter | PropKind::Setter, false) => {}
        }
    }
}

impl Rule for NoMisusedPromises {
    const META: Meta = Meta::typescript("no-misused-promises", Kind::Problem)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new()
        .stmts(&[StmtTag::If, StmtTag::For, StmtTag::While, StmtTag::DoWhile])
        .exprs(&[ExprTag::Cond, ExprTag::Unary])
        .exprs(&[ExprTag::Binary])
        .exprs(&[ExprTag::Call, ExprTag::New])
        .classes()
        .stmts(&[StmtTag::Interface])
        .stmts(&[StmtTag::Return])
        .exprs(&[ExprTag::Assign])
        .var_decls()
        .exprs(&[ExprTag::Spread])
        .props();
    /// [`is_in_test`]
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let checks_conditionals = match options.get("checksConditionals") {
            Some(value) if value.as_bool() == Some(false) => None,
            value => Some(match Object::of(value).str("flagUnions") {
                Some("all") => FlagUnions::All,
                Some("strict") => FlagUnions::Strict,
                _ => FlagUnions::None,
            }),
        };
        let checks_void_return = options.get("checksVoidReturn");
        let is_enabled = checks_void_return.and_then(Json::as_bool) != Some(false);
        let checks_void_return = Object::of(checks_void_return);
        let checks = |key: &str| is_enabled && checks_void_return.bool_or(key, true);
        NoMisusedPromises {
            checks_conditionals,
            checks_spreads: options.bool_or("checksSpreads", true),
            checks_void_return: ChecksVoidReturn {
                arguments: checks("arguments"),
                attributes: checks("attributes"),
                inherited_methods: checks("inheritedMethods"),
                properties: checks("properties"),
                returns: checks("returns"),
                variables: checks("variables"),
            },
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let checks = &self.checks_void_return;
        let mut on = On::new();
        if self.checks_conditionals.is_some() {
            on = on.stmts(&[StmtTag::If, StmtTag::For, StmtTag::While, StmtTag::DoWhile]);
            on = on.exprs(&[ExprTag::Cond, ExprTag::Unary]);
            on = on.exprs(&[ExprTag::Binary]);
            on = on.exprs(&[ExprTag::Call]);
        }
        if checks.arguments {
            on = on.exprs(&[ExprTag::Call, ExprTag::New]);
        }
        if checks.inherited_methods {
            on = on.classes();
            on = on.stmts(&[StmtTag::Interface]);
        }
        if checks.returns {
            on = on.stmts(&[StmtTag::Return]);
        }
        if checks.variables {
            on = on.exprs(&[ExprTag::Assign]);
            on = on.var_decls();
        }
        if self.checks_spreads {
            on = on.exprs(&[ExprTag::Spread]);
        }
        if self.checks_spreads || checks.attributes || checks.properties {
            on = on.props();
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match node.tag() {
            ExprTag::Cond | ExprTag::Unary => self.check_test_of_expression(node, cx),
            ExprTag::Binary => self.check_logical_expression(node, cx),
            // Two options apply to a call.
            ExprTag::Call => {
                if self.checks_conditionals.is_some() {
                    self.check_array_predicates(node, cx);
                }
                if self.checks_void_return.arguments {
                    self.check_arguments(node, cx);
                }
            }
            ExprTag::New => self.check_arguments(node, cx),
            ExprTag::Assign => self.check_assignment(node, cx),
            ExprTag::Spread => self.check_spread_element(node, cx),
            _ => {}
        }
    }

    fn stmt<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match node.tag() {
            StmtTag::If | StmtTag::For | StmtTag::While | StmtTag::DoWhile => {
                self.check_test_of_statement(node, cx);
            }
            StmtTag::Interface => self.check_interface(node, cx),
            StmtTag::Return => self.check_return_statement(node, cx),
            _ => {}
        }
    }

    fn class<'a>(&self, node: Class<'a>, cx: &mut Cx<'a, Self>) {
        self.check_class(node, cx);
    }

    fn prop<'a>(&self, node: Prop<'a>, cx: &mut Cx<'a, Self>) {
        self.check_prop(node, cx);
    }

    fn var_decl<'a>(&self, node: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        self.check_variable_declaration(node, cx);
    }
}
