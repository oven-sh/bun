use bun_lint::prelude::*;
use bun_lint::types::utils::get_base_types_of_class_member;
use bun_lint::types::{Signature, Type, TypeFlags, tsutils};
use bun_lint::utils::eslint_utils::{HasSideEffectOptions, has_side_effect};
use bun_lint::utils::ts_utils::{WrappingFixerParams, get_function_head_loc, get_wrapping_fixer};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Disallow passing a value-returning function in a position accepting a void function.
pub struct StrictVoidReturn {
    allowed_return_type: TypeFlags,
}

const ASYNC_FUNC: Message =
    Message::new("asyncFunc", "Async function used in a context where a void function is expected.");
const NON_VOID_FUNC: Message = Message::new(
    "nonVoidFunc",
    "Value-returning function used in a context where a void function is expected.",
);
const NON_VOID_RETURN: Message =
    Message::new("nonVoidReturn", "Value returned in a context where a void return is expected.");
const SUGGEST_ADD_VOID_OP: Message =
    Message::new("suggestAddVoidOp", "Add a void operator to discard the return value.");
const SUGGEST_WRAP_IN_ASYNC_IIFE: Message =
    Message::new("suggestWrapInAsyncIIFE", "Wrap the function body in an async IIFE.");

/// What the functions return that all the signatures of a callee expect for an argument.
#[derive(Copy, Clone)]
pub struct ExpectedReturnTypes {
    /// `void`, nullish, `any` or a type parameter, which is not resolved even for an overload that matches the call.
    are_all_void: bool,
    is_any_void: bool,
    are_all_nullish_or_any: bool,
}

impl ExpectedReturnTypes {
    fn of<'a>(func_signatures: &[Signature<'a>], arg_idx: usize, callee: Expr<'a>) -> Self {
        let mut found = ExpectedReturnTypes { are_all_void: true, is_any_void: false, are_all_nullish_or_any: true };
        let return_types = func_signatures
            .iter()
            .filter_map(|signature| signature.parameters().get(arg_idx))
            .flat_map(|param| tsutils::union_constituents(param.get_type_at_location(callee)))
            .flat_map(|param_type| param_type.get_call_signatures())
            .map(|param_signature| param_signature.get_return_type());
        for ty in return_types {
            found.are_all_void &= is_void(ty) || is_nullish_or_any(ty) || tsutils::is_type_parameter(ty);
            found.is_any_void |= is_void(ty);
            found.are_all_nullish_or_any &= is_nullish_or_any(ty);
        }
        found
    }
}

/// By the type of a callee that has many signatures, whether it is called with `new`, and the index of the argument: to
/// go through the signatures for each call takes long.
type ExpectedByCallee<'a> = FxHashMap<(Type<'a>, bool, usize), ExpectedReturnTypes>;

/// What stands where a function is expected.
#[derive(Copy, Clone)]
enum FuncNode<'a> {
    Expr(Expr<'a>),
    /// The `FunctionExpression` that is the `value` of a method or an accessor.
    Method(Func<'a>),
}

/// Whether the type of `node` can have call signatures at all.
fn may_be_function(node: Expr) -> bool {
    !matches!(
        node.tag(),
        ExprTag::Missing
            | ExprTag::Spread
            | ExprTag::Null
            | ExprTag::True
            | ExprTag::False
            | ExprTag::Number
            | ExprTag::String
            | ExprTag::BigInt
            | ExprTag::Regex
            | ExprTag::Template
            | ExprTag::Array
            | ExprTag::Object
            | ExprTag::Class
            | ExprTag::Unary
    )
}

fn is_void(ty: Type) -> bool {
    ty.has_flags(TypeFlags::VOID)
}

fn is_nullish_or_any(ty: Type) -> bool {
    ty.has_flags(TypeFlags::VOID_LIKE | TypeFlags::UNDEFINED | TypeFlags::NULL | TypeFlags::ANY | TypeFlags::NEVER)
}

fn is_void_returning_function_type(ty: Type) -> bool {
    let signatures = tsutils::get_call_signatures_of_type(ty);
    !signatures.is_empty()
        && signatures.iter().all(|signature| tsutils::union_constituents(signature.get_return_type()).iter().all(is_void))
}

/// Whether the contextual type of `node` is that of a void function.
fn expects_void_function(node: Expr) -> bool {
    node.contextual_type().is_some_and(is_void_returning_function_type)
}

/// The `Property` or the `MethodDefinition` that the function is in, otherwise the function.
fn func_head_span(func: Func) -> Span {
    match func.owner() {
        Node::Expr(e) => match e.parent() {
            Node::Prop(prop) if !prop.is_jsx_attribute() && prop.kind() != PropKind::Spread => prop.span(),
            _ => e.span(),
        },
        owner => owner.span(),
    }
}

/// Removes the `async` keyword and replaces the return type with `void`.
fn make_sync_func_fix<'a>(fixer: Fixer<'a>, func: Func<'a>) -> Vec<Fix> {
    let mut fixes = Vec::new();
    if func.is_async()
        && let Some(async_token) = fixer.file().tokens_in(func_head_span(func)).find(|token| token.value() == b"async")
    {
        fixes.push(fixer.remove(async_token));
    }
    if let Some(return_type) = func.return_type() {
        fixes.push(fixer.replace(return_type, "void"));
    }
    fixes
}

/// Makes the function sync and adds a `void` operator to the body of the arrow function. `None` if the body has no side effects.
fn add_void_to_arrow_fix<'a>(fixer: Fixer<'a>, func: Func<'a>, body: Expr<'a>) -> Option<Vec<Fix>> {
    if !has_side_effect(body, HasSideEffectOptions::default()) {
        return None;
    }
    let mut fixes = make_sync_func_fix(fixer, func);
    fixes.push(get_wrapping_fixer(
        fixer,
        WrappingFixerParams {
            node: body,
            inner_nodes: &[],
            wrap: |code: &[&[u8]]| [&b"void "[..], code[0]].concat(),
        },
    ));
    Some(fixes)
}

/// Makes the function sync and wraps the body in an inner async IIFE, which is an arrow function so that `this` stays what it is.
fn wrap_in_async_iife_fix<'a>(fixer: Fixer<'a>, func: Func<'a>) -> Vec<Fix> {
    let mut fixes = make_sync_func_fix(fixer, func);
    if let Some(arrow) = func.arrow_span() {
        fixes.push(fixer.insert_after(arrow, " void (async () =>"));
        fixes.push(fixer.insert_after(func.estree_span(), ")()"));
    } else if let Some(body) = func.body_span() {
        fixes.push(fixer.insert_before(body, "{ (async () => "));
        fixes.push(fixer.insert_after(body, ")(); }"));
    }
    fixes
}

impl StrictVoidReturn {
    fn is_allowed_return_type(&self, ty: Type) -> bool {
        let flags = ty.flags();
        flags.intersects(self.allowed_return_type) || flags.intersects(TypeFlags::ANY) && ty.is_unresolved()
    }

    /// Whether `node` is a function that is not void already. Nothing is ever reported for anything else, so this is asked first:
    /// it is cheaper than finding out what is expected.
    fn returns_a_value(&self, node: FuncNode) -> bool {
        let actual_type = match node {
            FuncNode::Expr(e) => e.ty(),
            FuncNode::Method(func) => func.type_at_location(),
        };
        tsutils::get_call_signatures_of_type(actual_type.get_apparent_type()).iter().any(|signature| {
            !tsutils::union_constituents(signature.get_return_type()).iter().all(|ty| self.is_allowed_return_type(ty))
        })
    }

    fn is_candidate(&self, node: Expr) -> bool {
        may_be_function(node) && self.returns_a_value(FuncNode::Expr(node))
    }

    /// `checkExpressionNode`
    fn check_expression_node<'a>(&self, node: Expr<'a>, cx: &Cx<'a, Self>) {
        if self.is_candidate(node) && expects_void_function(node) {
            self.report_non_void_function(FuncNode::Expr(node), cx);
        }
    }

    /// `checkFunctionCallNode`
    fn check_function_call_node<'a>(&self, call_node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (call, is_new) = match call_node.kind() {
            ExprKind::Call(call) => (call, false),
            ExprKind::New(call) => (call, true),
            _ => return,
        };
        let mut callee: Option<(Type<'a>, SmallVec<[Signature<'a>; 4]>)> = None;
        for (arg_idx, arg_node) in call.args().iter().enumerate() {
            if !self.is_candidate(arg_node) {
                continue;
            }
            let (callee_type, func_signatures) = callee.get_or_insert_with(|| {
                let signatures_of = |ty: Type<'a>| match is_new {
                    true => ty.get_construct_signatures(),
                    false => ty.get_call_signatures(),
                };
                let ty = call.callee().ty();
                (ty, tsutils::union_constituents(ty).iter().flat_map(signatures_of).collect())
            });

            // The types from all of the call signatures.
            let find_expected = || ExpectedReturnTypes::of(func_signatures, arg_idx, call.callee());
            let expected = match func_signatures.len() > 16 {
                true => *cx.state.entry((*callee_type, is_new, arg_idx)).or_insert_with(find_expected),
                false => find_expected(),
            };
            let has_single_signature = func_signatures.len() == 1;

            // The contextual type is that of the first overload, though another one may match the call.
            let is_void_expected = (has_single_signature || expected.are_all_void) && expects_void_function(arg_node)
                || expected.is_any_void && expected.are_all_nullish_or_any;
            if is_void_expected {
                self.report_non_void_function(FuncNode::Expr(arg_node), cx);
            }
        }
    }

    /// `JSXAttribute`, and `checkObjectPropertyNode` for the properties of an `ObjectExpression`.
    fn check_prop<'a>(&self, prop_node: Prop<'a>, cx: &mut Cx<'a, Self>) {
        let Some(value_node) = prop_node.value() else {
            return;
        };
        if prop_node.is_jsx_attribute() {
            if prop_node.kind() == PropKind::Init && value_node.jsx_container_span().is_some() {
                self.check_expression_node(value_node, cx);
            }
            return;
        }
        let is_in_object_expression =
            || matches!(prop_node.parent(), Node::Expr(object) if !object.is_assignment_target());
        match prop_node.kind() {
            PropKind::Init => {}
            // With a default value it is an `AssignmentPattern`.
            PropKind::Shorthand if value_node.tag() == ExprTag::Ident => {}
            PropKind::Method => {
                let (Some(func), Some(key), Node::Expr(object)) = (prop_node.func(), prop_node.key(), prop_node.parent())
                else {
                    return;
                };
                let Some(name) = key.name().filter(|_| !key.is_computed()) else {
                    return;
                };
                if self.returns_a_value(FuncNode::Method(func))
                    && let Some(prop_symbol) = object.contextual_type().and_then(|it| it.get_property(name.bytes()))
                    && is_void_returning_function_type(prop_symbol.get_type_at_location(prop_node))
                {
                    self.report_non_void_function(FuncNode::Method(func), cx);
                }
                return;
            }
            _ => return,
        }
        if self.is_candidate(value_node) && is_in_object_expression() && expects_void_function(value_node) {
            self.report_non_void_function(FuncNode::Expr(value_node), cx);
        }
    }

    /// `checkClassPropertyNode`, `checkClassMethodNode`
    fn check_member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if member.is_signature() || member.flags().contains(Flags::ABSTRACT) {
            return;
        }
        let func_node = match member.kind() {
            MemberKind::Property if !member.flags().contains(Flags::ACCESSOR) => match member.init() {
                Some(value) if may_be_function(value) => FuncNode::Expr(value),
                _ => return,
            },
            MemberKind::Method | MemberKind::Getter | MemberKind::Setter => match member.func() {
                Some(func) if func.has_body() => FuncNode::Method(func),
                _ => return,
            },
            _ => return,
        };
        if !self.returns_a_value(func_node) {
            return;
        }
        let is_void_in_a_base_type = get_base_types_of_class_member(member)
            .iter()
            .any(|base| is_void_returning_function_type(base.base_member_type));
        let is_void_expected = is_void_in_a_base_type
            || match func_node {
                FuncNode::Expr(value) => expects_void_function(value),
                FuncNode::Method(_) => false,
            };
        if is_void_expected {
            self.report_non_void_function(func_node, cx);
        }
    }

    /// `reportIfNonVoidFunction`, for a `func_node` that [returns a value](Self::returns_a_value).
    fn report_non_void_function<'a>(&self, func_node: FuncNode<'a>, cx: &Cx<'a, Self>) {
        let func = match func_node {
            FuncNode::Method(func) => func,
            FuncNode::Expr(e) => match e.kind() {
                ExprKind::Fn(func) => func,
                _ => {
                    cx.report(e, NON_VOID_FUNC);
                    return;
                }
            },
        };

        // oxlint points at the function.
        let head = if cx.language().is_oxlint { func.span() } else { get_function_head_loc(func) };
        if func.is_generator() {
            cx.report(head, NON_VOID_FUNC);
            return;
        }

        if func.is_async() {
            let report = cx.report(head, ASYNC_FUNC);
            match func.body() {
                FnBody::Expr(body) => report.suggest(SUGGEST_ADD_VOID_OP, |fixer| add_void_to_arrow_fix(fixer, func, body)),
                _ => report.suggest(SUGGEST_WRAP_IN_ASYNC_IIFE, |fixer| wrap_in_async_iife_fix(fixer, func)),
            };
            return;
        }

        if let FnBody::Expr(body) = func.body() {
            cx.report(if cx.language().is_oxlint { body.outer_span() } else { body.span() }, NON_VOID_RETURN)
                .suggest(SUGGEST_ADD_VOID_OP, |fixer| add_void_to_arrow_fix(fixer, func, body));
            return;
        }

        if let Some(return_type) = func.return_type()
            && !return_type.is_keyword(Keyword::Void)
        {
            cx.report(return_type, NON_VOID_FUNC);
            return;
        }

        for statement in func.returns() {
            if let StmtKind::Return(Some(argument)) = statement.kind()
                && !self.is_allowed_return_type(argument.ty())
            {
                // oxlint points at the statement.
                let Span { start, end } = statement.span();
                let end = if cx.language().is_oxlint { end } else { start + "return".len() as u32 };
                cx.report(Span::new(start, end), NON_VOID_RETURN);
            }
        }
    }
}

impl Rule for StrictVoidReturn {
    const META: Meta = Meta::typescript("strict-void-return", Kind::Problem).has_suggestions().requires_types();
    type State<'a> = ExpectedByCallee<'a>;

    fn new(options: &Options) -> Self {
        let mut allowed_return_type = TypeFlags::VOID | TypeFlags::NEVER | TypeFlags::UNDEFINED;
        if options.object(0).bool_or("allowReturnAny", false) {
            allowed_return_type |= TypeFlags::ANY;
        }
        StrictVoidReturn { allowed_return_type }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> ExpectedByCallee<'a> {
        on.exprs([ExprTag::Array], |rule, node, cx| {
            let ExprKind::Array(elements) = node.kind() else {
                return;
            };
            for element in elements {
                if rule.is_candidate(element) && !node.is_assignment_target() && expects_void_function(element) {
                    rule.report_non_void_function(FuncNode::Expr(element), cx);
                }
            }
        });
        on.funcs(|rule, func, cx| {
            if func.is_arrow()
                && let FnBody::Expr(body) = func.body()
            {
                rule.check_expression_node(body, cx);
            }
        });
        on.exprs([ExprTag::Assign], |rule, node, cx| {
            let ExprKind::Assign { value, .. } = node.kind() else {
                return;
            };
            // A default value is in an `AssignmentPattern`.
            let is_assignment_pattern = || {
                node.is_assignment_target() || matches!(node.parent(), Node::Prop(prop) if prop.kind() == PropKind::Shorthand)
            };
            if rule.is_candidate(value) && !is_assignment_pattern() && expects_void_function(value) {
                rule.report_non_void_function(FuncNode::Expr(value), cx);
            }
        });
        on.exprs([ExprTag::Call, ExprTag::New], Self::check_function_call_node);
        on.props(Self::check_prop);
        on.members(Self::check_member);
        on.stmts([StmtTag::Return], |rule, node, cx| {
            if let StmtKind::Return(Some(argument)) = node.kind() {
                rule.check_expression_node(argument, cx);
            }
        });
        on.var_decls(|rule, node, cx| {
            if let Some(init) = node.init() {
                rule.check_expression_node(init, cx);
            }
        });
        ExpectedByCallee::default()
    }
}
