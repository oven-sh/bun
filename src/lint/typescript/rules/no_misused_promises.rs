use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    self, get_well_known_symbol_property_of_type, is_thenable_type, union_constituents,
};
use bun_lint::types::utils::{
    get_constrained_type_at_location, is_array_method_call_with_predicate, is_promise_like,
    is_rest_parameter_declaration, parse_finally_call,
};
use bun_lint::types::{NameOf, SignatureList, SymbolList, SyntaxKind, TsNode, TsSymbol, Type, TypeFlags};
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::ts_utils::get_function_head_loc;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};
use std::cell::Cell;
use std::rc::Rc;

/// Disallow Promises in places not designed to handle them.
pub struct NoMisusedPromises {
    /// `None`: conditionals are not checked.
    checks_conditionals: Option<FlagUnions>,
    checks_spreads: bool,
    checks_void_return: ChecksVoidReturn,
}

/// How a union that has a Promise among its constituents is treated in a conditional.
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

/// Whether `node` is the `test` of a statement or of a conditional expression, or the operand of a `!`.
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

/// Whether `node` is an operand, at any depth, of logical operators that make up a [test](is_test).
fn is_in_test<'a>(node: Expr<'a>, known: &mut AncestorMemo<'a, bool>) -> bool {
    let decide = |at: Node<'a>, parent: Node<'a>| match (at, parent) {
        (_, Node::Expr(parent)) if matches!(parent.kind(), ExprKind::Binary { op, .. } if is_logical_operator(op)) => None,
        (Node::Expr(at), _) => Some(is_test(at)),
        _ => Some(false),
    };
    known.find(Node::Expr(node), decide).unwrap_or(false)
}

/// Whether the type of `node` can have a `then`. The syntax tells that of a primitive value.
fn can_be_thenable(node: Expr) -> bool {
    match node.kind() {
        ExprKind::True
        | ExprKind::False
        | ExprKind::Null
        | ExprKind::Number(_)
        | ExprKind::BigInt(_)
        | ExprKind::String(_)
        | ExprKind::Template(_)
        | ExprKind::Unary { .. } => false,
        ExprKind::Binary { op, .. } => op == BinOp::Comma || is_logical_operator(op),
        _ => true,
    }
}

/// Whether the literals of each sort have call signatures: those of `Boolean`, `Number`, `BigInt`,
/// `String` and `Array`, which a program can add to. `None`: not asked yet.
#[derive(Default)]
struct CallableLiterals([Cell<Option<bool>>; 5]);

/// Whether the type of `node` can have call signatures. All literals of a sort have the same.
fn can_be_function(node: Expr, known: &CallableLiterals) -> bool {
    let sort = match node.kind() {
        ExprKind::Missing | ExprKind::Null => return false,
        // `{ ...t }` has the type of `t` if that is a type parameter.
        ExprKind::Object(properties) => return properties.iter().any(|it| it.kind() == PropKind::Spread),
        ExprKind::True | ExprKind::False => 0,
        ExprKind::Number(_) => 1,
        ExprKind::BigInt(_) => 2,
        ExprKind::String(_) | ExprKind::Template(_) => 3,
        ExprKind::Array(_) => 4,
        _ => return true,
    };
    let Some(known) = known.0.get(sort) else {
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
    /// Whether what has been passed on the way up from an operand is in a test.
    tests: AncestorMemo<'a, bool>,
    callable_literals: CallableLiterals,
    parameters: ParametersByType<'a>,
}

/// Whether an annotated type is maybe a function type, as far as the syntax tells.
fn is_possibly_function_type(node: TypeNode) -> bool {
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

/// A variation on the thenable check which requires all constituents of a union to be thenable.
/// Otherwise `promise | undefined` would be caught where it is tested for `undefined`.
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

/// Whether any call signature of the type has a thenable return type.
fn any_signature_is_thenable_type<'a>(node: TsNode<'a>, ty: Type<'a>) -> bool {
    ty.get_call_signatures().iter().any(|signature| is_thenable_type(node, signature.get_return_type()))
}

/// Whether the type is a thenable-returning function.
fn is_thenable_returning_function_type<'a>(node: TsNode<'a>, ty: Type<'a>) -> bool {
    union_constituents(ty).iter().any(|sub_type| any_signature_is_thenable_type(node, sub_type))
}

/// Whether the type is a void-returning function.
fn is_void_returning_function_type<'a>(node: TsNode<'a>, ty: Type<'a>) -> bool {
    let mut had_void_return = false;
    for sub_type in union_constituents(ty) {
        for signature in sub_type.get_call_signatures() {
            let return_type = signature.get_return_type();
            // Where both thenable and void returns are accepted, a promise-returning function is valid.
            if is_thenable_type(node, return_type) {
                return false;
            }
            had_void_return |= tsutils::is_type_flag_set(return_type, TypeFlags::VOID);
        }
    }
    had_void_return
}

/// Whether the expression or the declaration is a function that returns a thenable.
fn returns_thenable(node: TsNode) -> bool {
    let ty = node.get_type_at_location().get_apparent_type();
    union_constituents(ty).iter().any(|t| any_signature_is_thenable_type(node, t))
}

/// Whether `predicate` holds for the type of the `[Symbol.dispose]` of a constituent of `ty`.
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

/// Whether what the Promises in a union resolve to is the same as the rest of the union.
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

/// A type that a class or an interface extends or implements.
struct HeritageType<'a> {
    ty: Type<'a>,
    /// `type.getSymbol()?.members`
    members: Option<SymbolList<'a>>,
    /// The first of each name, if they are many.
    members_by_name: Option<FxHashMap<&'a [u8], TsSymbol<'a>>>,
}

impl<'a> HeritageType<'a> {
    fn new(ty: Type<'a>) -> Self {
        let members = ty.get_symbol().map(|symbol| symbol.members());
        let members_by_name = members.filter(|members| members.len() > 16).map(|members| {
            let mut by_name = FxHashMap::default();
            for member in members {
                by_name.entry(member.name()).or_insert(member);
            }
            by_name
        });
        HeritageType {
            ty,
            members,
            members_by_name,
        }
    }

    /// The member with the given name, if it exists.
    fn get_member_if_exists(&self, member_name: &[u8]) -> Option<TsSymbol<'a>> {
        let member = match &self.members_by_name {
            Some(by_name) => by_name.get(member_name).copied(),
            None => self.members.and_then(|members| members.iter().find(|member| member.name() == member_name)),
        };
        member.or_else(|| self.ty.get_property(member_name))
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

/// Whether functions that return a thenable, and functions that return nothing, are accepted somewhere.
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
    /// The type of a parameter at its position: the last that was looked at.
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

/// The parameters of all the signatures of a type that has many: to go through them for each call takes long.
#[derive(Default)]
struct Parameters<'a> {
    /// What those at an index accept that are no rest parameters, and the type of one of them.
    plain: FxHashMap<usize, (Accepted, Type<'a>)>,
    /// The index and the type of the rest parameters, each once.
    rest: Vec<(usize, Type<'a>)>,
}

impl<'a> Parameters<'a> {
    const MANY_SIGNATURES: usize = 16;

    fn of(signatures: SignatureList<'a>, expression: TsNode<'a>) -> Self {
        let (mut parameters, mut seen) = (Parameters::default(), FxHashSet::default());
        for signature in signatures {
            for (index, parameter) in signature.parameters().iter().enumerate() {
                let is_rest = parameter.value_declaration().is_some_and(is_rest_parameter_declaration);
                let ty = parameter.get_type_at_location(expression);
                if !seen.insert((index, is_rest, ty)) {
                    continue;
                }
                match is_rest {
                    true => parameters.rest.push((index, ty)),
                    false => {
                        let (accepted, _) = parameters.plain.entry(index).or_insert_with(|| (Accepted::default(), ty));
                        accepted.add_type(expression, ty);
                    }
                }
            }
        }
        parameters
    }
}

type ParametersByType<'a> = FxHashMap<(Type<'a>, bool), Rc<Parameters<'a>>>;

/// Finds out which of `arguments` are passed for void functions, and not also for thenable
/// functions. All signatures are looked at: the resolved one would be an early `() => void` where a
/// later `() => Promise<void>` applies as well.
fn void_function_arguments<'a>(
    node: Expr<'a>,
    call: Call<'a>,
    arguments: &mut [Argument<'a>],
    known: &mut ParametersByType<'a>,
) {
    let (node, is_new) = (node.ts_node(), node.tag() == ExprTag::New);
    let expression = call.callee().ts_node();
    for sub_type in union_constituents(expression.get_type_at_location()) {
        let signatures = match is_new {
            true => sub_type.get_construct_signatures(),
            false => sub_type.get_call_signatures(),
        };
        if signatures.len() > Parameters::MANY_SIGNATURES {
            let parameters = known.entry((sub_type, is_new));
            let parameters = Rc::clone(parameters.or_insert_with(|| Rc::new(Parameters::of(signatures, expression))));
            for argument in arguments.iter_mut() {
                if let Some(&(accepted, ty)) = parameters.plain.get(&argument.index) {
                    argument.accepted.thenable_return |= accepted.thenable_return;
                    argument.accepted.void_return |= accepted.void_return;
                    argument.parameter_type = Some(ty);
                }
            }
            for &(index, ty) in &parameters.rest {
                add_rest_parameter_type(expression, index, ty, arguments);
            }
            continue;
        }
        for signature in signatures {
            for (index, parameter) in signature.parameters().iter().enumerate() {
                if parameter.value_declaration().is_some_and(is_rest_parameter_declaration) {
                    add_rest_parameter_type(expression, index, parameter.get_type_at_location(expression), arguments);
                    continue;
                }
                // They are in the order of their indices.
                if let Ok(at) = arguments.binary_search_by_key(&index, |it| it.index)
                    && let Some(argument) = arguments.get_mut(at)
                {
                    argument.add_parameter_type(expression, parameter.get_type_at_location(expression));
                }
            }
        }
    }
    // Upstream looks at the contextual type beside each of the types of the parameters. It is the same for all of them.
    for argument in arguments {
        if let Some(parameter_type) = argument.parameter_type
            && let Some(contextual_type) = node.get_contextual_type_for_argument_at_index(argument.index)
            && contextual_type != parameter_type
        {
            argument.accepted.add_type(expression, contextual_type);
        }
    }
}

impl NoMisusedPromises {
    // ───────────────────────────── conditionals ─────────────────────────────

    /// Checks an operand that is not a logical expression itself.
    fn check_conditional_operand<'a>(&self, node: Expr<'a>, cx: &Cx<'a, Self>) {
        if !can_be_thenable(node) {
            return;
        }
        let ts_node = node.ts_node();
        let is_misused = is_always_thenable(ts_node)
            || match self.checks_conditionals {
                Some(FlagUnions::All) => is_sometimes_thenable(ts_node),
                Some(FlagUnions::Strict) => has_matching_promise_type_argument(ts_node),
                Some(FlagUnions::None) | None => false,
            };
        if is_misused {
            cx.report(node, CONDITIONAL);
        }
    }

    /// Checks a test, and all the operands of the logical operators that it consists of.
    fn check_test<'a>(&self, test: Expr<'a>, cx: &Cx<'a, Self>) {
        let mut rest: SmallVec<[Expr; 8]> = smallvec![test];
        while let Some(node) = rest.pop() {
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
            | StmtKind::For { test: Some(test), .. } => self.check_test(test, cx),
            _ => {}
        }
    }

    fn check_test_of_expression<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match node.kind() {
            ExprKind::Cond { test, .. } | ExprKind::Unary { op: UnOp::Not, operand: test } => self.check_test(test, cx),
            _ => {}
        }
    }

    /// Outside of a test only the left operand is converted to a boolean, and not that of `??`. One
    /// that is a logical expression comes here itself.
    fn check_logical_expression<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op: BinOp::And | BinOp::Or, left, .. } = node.kind() else {
            return;
        };
        if matches!(left.kind(), ExprKind::Binary { op, .. } if is_logical_operator(op))
            || !can_be_thenable(left)
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
        if !is_array_method_call_with_predicate(node) || !returns_thenable(callback.ts_node()) {
            return;
        }
        // Upstream listens for every `MemberExpression` directly in a call: the callee, and the
        // arguments that are one.
        let is_member_expression =
            |it: &Expr| matches!(it.tag(), ExprTag::Dot | ExprTag::Index) && !it.is_chain_root();
        for _ in 0..=call.args().iter().filter(is_member_expression).count() {
            cx.report(callback, PREDICATE);
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
                can_be_function(*argument, &cx.state.callable_literals) && returns_thenable(argument.ts_node())
            })
            .map(|(index, node)| Argument {
                index,
                node,
                accepted: Accepted::default(),
                parameter_type: None,
            })
            .collect();
        if arguments.is_empty() || is_promise_finally_method(node) {
            return;
        }
        void_function_arguments(node, call, &mut arguments, &mut cx.state.parameters);
        for argument in arguments {
            if argument.accepted.void_return && !argument.accepted.thenable_return {
                cx.report(argument.node, VOID_RETURN_ARGUMENT);
            }
        }
    }

    fn check_assignment<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Assign { target, value, .. } = node.kind() else {
            return;
        };
        // A default in a destructuring assignment is an `AssignmentPattern`.
        if !can_be_function(value, &cx.state.callable_literals) || node.is_assignment_target() {
            return;
        }
        let left = target.ts_node();
        if returns_thenable(value.ts_node()) && is_void_returning_function_type(left, left.get_type_at_location()) {
            cx.report(value, VOID_RETURN_VARIABLE);
        }
    }

    fn check_variable_declaration<'a>(&self, node: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let Some(init) = node.init() else {
            return;
        };
        let (annotation, is_using) = (node.ty(), node.var_kind() == VarKind::Using);
        if annotation.is_none() && !is_using {
            return;
        }
        let initializer = init.ts_node();
        let disposes_asynchronously = || {
            has_dispose_method(initializer, initializer.get_type_at_location(), is_thenable_returning_function_type)
        };
        if is_using && disposes_asynchronously() {
            cx.report(init, VOID_RETURN_VARIABLE);
        }
        let Some(annotation) = annotation else {
            return;
        };
        // Neither functions nor disposable.
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
        if has_dispose_method(name, variable_type, is_void_returning_function_type) && disposes_asynchronously() {
            cx.report(init, VOID_RETURN_VARIABLE);
        }
        if is_possibly_function_type(annotation)
            && can_be_function(init, &cx.state.callable_literals)
            && is_void_returning_function_type(initializer, variable_type)
            && returns_thenable(initializer)
        {
            cx.report(init, VOID_RETURN_VARIABLE);
        }
    }

    /// Reports a function that is the value of a property.
    fn report_property_function<'a>(function_node: Func<'a>, cx: &Cx<'a, Self>) {
        match function_node.return_type() {
            Some(return_type) => cx.report(return_type, VOID_RETURN_PROPERTY),
            None => cx.report(get_function_head_loc(function_node), VOID_RETURN_PROPERTY),
        };
    }

    /// `key: value` and `key`
    fn check_property_value<'a>(&self, value: Expr<'a>, cx: &Cx<'a, Self>) {
        if !can_be_function(value, &cx.state.callable_literals) {
            return;
        }
        let initializer = value.ts_node();
        if !returns_thenable(initializer)
            || !initializer
                .get_contextual_type()
                .is_some_and(|contextual_type| is_void_returning_function_type(initializer, contextual_type))
        {
            return;
        }
        match value.as_fn() {
            Some(function_node) => Self::report_property_function(function_node, cx),
            None => {
                cx.report(value, VOID_RETURN_PROPERTY);
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
        let Some(obj_type) = obj.contextual_type() else {
            return;
        };
        let name_text = cx.slice(key.span(cx.file()));
        let Some(property_symbol) = union_constituents(obj_type).iter().find_map(|t| t.get_property(name_text)) else {
            return;
        };
        let name = NameOf(node).ts_node();
        if is_void_returning_function_type(name, property_symbol.get_type_at_location(name)) {
            Self::report_property_function(function_node, cx);
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
        let expression = value.ts_node();
        if returns_thenable(expression)
            && expression
                .get_contextual_type()
                .is_some_and(|contextual_type| is_void_returning_function_type(expression, contextual_type))
        {
            cx.report(expression_container, VOID_RETURN_ATTRIBUTE);
        }
    }

    fn check_return_statement<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Return(Some(argument)) = node.kind() else {
            return;
        };
        if !can_be_function(argument, &cx.state.callable_literals) {
            return;
        }
        // A `return` outside of a function is legal in a CommonJS module.
        let Some(function_node) = Node::Stmt(node).enclosing_function() else {
            return;
        };
        if function_node.return_type().is_some_and(|return_type| !is_possibly_function_type(return_type)) {
            return;
        }
        let expression = argument.ts_node();
        if returns_thenable(expression)
            && expression
                .get_contextual_type()
                .is_some_and(|contextual_type| is_void_returning_function_type(expression, contextual_type))
        {
            cx.report(argument, VOID_RETURN_RETURN_VALUE);
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

    /// Reports the members that return a Promise where a type that the class or the interface
    /// `ts_node` extends or implements has a member of that name that returns void.
    fn check_members<'a>(&self, ts_node: TsNode<'a>, members: List<'a, Member<'a>>, cx: &Cx<'a, Self>) {
        let mut heritage_types: Option<SmallVec<[HeritageType; 2]>> = None;
        for member in members {
            // Call, construct and index signatures have no name. A private name is not inherited.
            let Some(key) = member.key().filter(|key| !key.is_private()) else {
                continue;
            };
            let node_member = member.ts_node();
            if member.is_static() || !returns_thenable(node_member) {
                continue;
            }
            let member_name = cx.slice(key.span(cx.file()));
            for heritage_type in heritage_types.get_or_insert_with(|| get_heritage_types(ts_node)).iter() {
                let Some(heritage_member) = heritage_type.get_member_if_exists(member_name) else {
                    continue;
                };
                if is_void_returning_function_type(node_member, heritage_member.get_type_at_location(node_member)) {
                    cx.report(member, VOID_RETURN_INHERITED_METHOD).data("heritageTypeName", heritage_type.ty.to_text());
                }
            }
        }
    }

    // ───────────────────────────── spreads ─────────────────────────────

    fn check_spread_argument<'a>(argument: Expr<'a>, cx: &Cx<'a, Self>) {
        if is_sometimes_thenable(argument.ts_node()) {
            cx.report(argument, SPREAD);
        }
    }

    /// `...argument` in an array literal or among the arguments of a call.
    fn check_spread_element<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (ExprKind::Spread(argument), Node::Expr(parent)) = (node.kind(), node.parent()) else {
            return;
        };
        match parent.kind() {
            ExprKind::Call(_) | ExprKind::New(_) => {}
            // In an `ArrayPattern` it is a `RestElement`.
            ExprKind::Array(_) if !parent.is_assignment_target() => {}
            _ => return,
        }
        Self::check_spread_argument(argument, cx);
    }

    /// The properties of object literals and the attributes of JSX elements.
    fn check_prop<'a>(&self, node: Prop<'a>, cx: &mut Cx<'a, Self>) {
        let checks = &self.checks_void_return;
        match (node.kind(), node.is_jsx_attribute()) {
            (PropKind::Spread, true) => {}
            (PropKind::Spread, false) => {
                // In an `ObjectPattern` it is a `RestElement`.
                if self.checks_spreads
                    && let (Some(argument), Node::Expr(parent)) = (node.value(), node.parent())
                    && !parent.is_assignment_target()
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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> State<'a> {
        let checks = &self.checks_void_return;
        if self.checks_conditionals.is_some() {
            on.stmts(
                [StmtTag::If, StmtTag::For, StmtTag::While, StmtTag::DoWhile],
                Self::check_test_of_statement,
            );
            on.exprs([ExprTag::Cond, ExprTag::Unary], Self::check_test_of_expression);
            on.exprs([ExprTag::Binary], Self::check_logical_expression);
            on.exprs([ExprTag::Call], Self::check_array_predicates);
        }
        if checks.arguments {
            on.exprs([ExprTag::Call, ExprTag::New], Self::check_arguments);
        }
        if checks.inherited_methods {
            on.classes(Self::check_class);
            on.stmts([StmtTag::Interface], Self::check_interface);
        }
        if checks.returns {
            on.stmts([StmtTag::Return], Self::check_return_statement);
        }
        if checks.variables {
            on.exprs([ExprTag::Assign], Self::check_assignment);
            on.var_decls(Self::check_variable_declaration);
        }
        if self.checks_spreads {
            on.exprs([ExprTag::Spread], Self::check_spread_element);
        }
        if self.checks_spreads || checks.attributes || checks.properties {
            on.props(Self::check_prop);
        }
        State::default()
    }
}
