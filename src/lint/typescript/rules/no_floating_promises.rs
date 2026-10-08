use bun_lint::prelude::*;
use bun_lint::types::tsutils::union_constituents;
use bun_lint::types::utils::{
    TypeOrValueSpecifier, is_builtin_symbol_like, parse_catch_call, parse_finally_call,
    parse_then_call, parse_type_or_value_specifiers, type_matches_some_specifier,
    value_matches_some_specifier,
};
use bun_lint::types::{Signature, TsSymbol, Type};
use bun_lint::utils::eslint_utils::is_parenthesized;
use bun_lint::utils::ts_utils::{OperatorPrecedence, get_operator_precedence_for_node};

/// Require Promise-like statements to be handled appropriately.
pub struct NoFloatingPromises {
    allow_for_known_safe_calls: Vec<TypeOrValueSpecifier>,
    allow_for_known_safe_promises: Vec<TypeOrValueSpecifier>,
    check_thenables: bool,
    ignore_iife: bool,
    ignore_void: bool,
}

const FLOATING: Message = Message::new(
    "floating",
    "Promises must be awaited, end with a call to .catch, or end with a call to .then with a rejection handler.",
);
const FLOATING_FIX_AWAIT: Message = Message::new("floatingFixAwait", "Add await operator.");
const FLOATING_FIX_VOID: Message = Message::new("floatingFixVoid", "Add void operator to ignore.");
const FLOATING_PROMISE_ARRAY: Message = Message::new(
    "floatingPromiseArray",
    "An array of Promises may be unintentional. Consider handling the promises' fulfillment or rejection with Promise.all or similar.",
);
const FLOATING_PROMISE_ARRAY_VOID: Message = Message::new(
    "floatingPromiseArrayVoid",
    "An array of Promises may be unintentional. Consider handling the promises' fulfillment or rejection with Promise.all or similar, or explicitly marking the expression as ignored with the `void` operator.",
);
const FLOATING_USELESS_REJECTION_HANDLER: Message = Message::new(
    "floatingUselessRejectionHandler",
    "Promises must be awaited, end with a call to .catch, or end with a call to .then with a rejection handler. A rejection handler that is not a function will be ignored.",
);
const FLOATING_USELESS_REJECTION_HANDLER_VOID: Message = Message::new(
    "floatingUselessRejectionHandlerVoid",
    "Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator. A rejection handler that is not a function will be ignored.",
);
const FLOATING_VOID: Message = Message::new(
    "floatingVoid",
    "Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.",
);

/// In which way a promise is not handled.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Unhandled {
    Promise,
    NonFunctionHandler,
    PromiseArray,
}

fn is_async_iife(expression: Expr) -> bool {
    // ESLint has a `ChainExpression` around `(() => {})?.()`.
    !expression.is_chain_root()
        && expression.as_call().is_some_and(|call| call.callee().as_fn().is_some())
}

fn is_valid_rejection_handler(rejection_handler: Expr) -> bool {
    !rejection_handler.ty().get_call_signatures().is_empty()
}

fn has_matching_signature<'a>(ty: Type<'a>, matcher: impl Fn(Signature<'a>) -> bool) -> bool {
    union_constituents(ty).iter().any(|t| t.get_call_signatures().iter().any(&matcher))
}

fn is_function_param<'a>(param: TsSymbol<'a>, node: Expr<'a>) -> bool {
    let ty = param.get_type_at_location(node).get_apparent_type();
    union_constituents(ty).iter().any(|t| !t.get_call_signatures().is_empty())
}

/// `keyword expression`, with parentheses around the expression if it needs them. `node` is what
/// the keyword is put in front of.
fn add_operator(fixer: Fixer, keyword: &str, node: Span, expression: Expr) -> Vec<Fix> {
    if is_parenthesized(expression)
        || get_operator_precedence_for_node(expression) > OperatorPrecedence::Unary
    {
        return vec![fixer.insert_before(node, format!("{keyword} "))];
    }
    vec![
        fixer.insert_before(node, format!("{keyword} (")),
        fixer.insert_after(expression, ")"),
    ]
}

fn add_await(fixer: Fixer, node: Span, expression: Expr) -> Vec<Fix> {
    if let ExprKind::Unary { op: UnOp::Void, .. } = expression.kind() {
        let start = expression.span().start;
        return vec![fixer.replace(Span::new(start, start + 4), "await")];
    }
    add_operator(fixer, "await", node, expression)
}

impl NoFloatingPromises {
    /// `node`: the range of the statement, or of the expression if it is the body of an arrow
    /// function.
    fn check_node<'a>(&self, node: Span, expression: Expr<'a>, cx: &Cx<'a, Self>) {
        if self.is_known_safe_promise_call(expression) {
            return;
        }
        let Some(unhandled) = self.is_unhandled_promise(expression, true) else {
            return;
        };
        let message = match (unhandled, self.ignore_void) {
            (Unhandled::PromiseArray, true) => FLOATING_PROMISE_ARRAY_VOID,
            (Unhandled::PromiseArray, false) => FLOATING_PROMISE_ARRAY,
            (Unhandled::NonFunctionHandler, true) => FLOATING_USELESS_REJECTION_HANDLER_VOID,
            (Unhandled::NonFunctionHandler, false) => FLOATING_USELESS_REJECTION_HANDLER,
            (Unhandled::Promise, true) => FLOATING_VOID,
            (Unhandled::Promise, false) => FLOATING,
        };
        let mut report = cx.report(node, message);
        if unhandled == Unhandled::PromiseArray {
            return;
        }
        if self.ignore_void {
            report = report.suggest(FLOATING_FIX_VOID, |fixer| {
                add_operator(fixer, "void", node, expression)
            });
        }
        report.suggest(FLOATING_FIX_AWAIT, |fixer| add_await(fixer, node, expression));
    }

    fn is_known_safe_promise_call(&self, node: Expr) -> bool {
        let specifiers = &self.allow_for_known_safe_calls;
        if specifiers.is_empty() {
            return false;
        }
        let Some(call) = node.as_call() else {
            return false;
        };
        let callee = call.callee();
        let ty = callee.ty();
        value_matches_some_specifier(callee, specifiers, ty)
            || type_matches_some_specifier(ty, specifiers)
    }

    /// `is_chain_element`: where ESLint has a `ChainExpression` and in it the call, `node` stands
    /// for the call.
    fn is_unhandled_promise(&self, node: Expr, is_chain_element: bool) -> Option<Unhandled> {
        match node.kind() {
            ExprKind::Assign { .. } => return None,
            // Any operand of a comma expression can be an unhandled promise, whatever the type of
            // the last is.
            ExprKind::Binary { op: BinOp::Comma, .. } => {
                let mut items = node.sequence().into_iter();
                return items.find_map(|item| self.is_unhandled_promise(item, false));
            }
            ExprKind::Unary { op: UnOp::Void, operand } if !self.ignore_void => {
                return self.is_unhandled_promise(operand, false);
            }
            // The value of every other unary operator is a primitive.
            ExprKind::Unary { .. } => return None,
            _ => {}
        }

        let ty = node.ty();
        if self.is_promise_array(node, ty) {
            return Some(Unhandled::PromiseArray);
        }
        // `await` handles a promise, but not an array of promises. The type does not tell: that of
        // `await (promise as Promise<number> & number)` is `Promise<number> & number`.
        if let ExprKind::Await(_) = node.kind() {
            return None;
        }
        if !self.is_promise_like(node, ty) {
            return None;
        }

        match node.kind() {
            ExprKind::Call(_) if is_chain_element || !node.is_chain_root() => {
                let promise_handling_method_call = match parse_catch_call(node) {
                    Some(call) => Some(call.on_rejected),
                    None => parse_then_call(node).map(|call| call.on_rejected),
                };
                if let Some(on_rejected) = promise_handling_method_call {
                    return match on_rejected {
                        Some(handler) if is_valid_rejection_handler(handler) => None,
                        Some(_) => Some(Unhandled::NonFunctionHandler),
                        None => Some(Unhandled::Promise),
                    };
                }
                match parse_finally_call(node) {
                    Some(call) => self.is_unhandled_promise(call.object, false),
                    None => Some(Unhandled::Promise),
                }
            }
            // The promise is the value of one of the branches.
            ExprKind::Cond { yes, no, .. } => self
                .is_unhandled_promise(no, false)
                .or_else(|| self.is_unhandled_promise(yes, false)),
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, right } => self
                .is_unhandled_promise(left, false)
                .or_else(|| self.is_unhandled_promise(right, false)),
            _ => Some(Unhandled::Promise),
        }
    }

    fn is_promise_array<'a>(&self, node: Expr<'a>, ty: Type<'a>) -> bool {
        union_constituents(ty).iter().map(|t| t.get_apparent_type()).any(|ty| {
            if ty.is_array_type() {
                let array_type = ty.get_type_arguments().first();
                return array_type.is_some_and(|it| self.is_promise_like(node, it));
            }
            ty.is_tuple_type()
                && ty.get_type_arguments().iter().any(|it| self.is_promise_like(node, it))
        })
    }

    fn is_promise_like<'a>(&self, node: Expr<'a>, ty: Type<'a>) -> bool {
        if type_matches_some_specifier(ty, &self.allow_for_known_safe_promises) {
            return false;
        }
        let type_parts = union_constituents(ty.get_apparent_type());
        if type_parts.iter().any(|type_part| is_builtin_symbol_like(type_part, "Promise")) {
            return true;
        }
        if !self.check_thenables {
            return false;
        }
        // Only thenables that can be rejected or caught by a second parameter.
        type_parts.iter().any(|ty| {
            let Some(then) = ty.get_property(b"then") else {
                return false;
            };
            has_matching_signature(then.get_type_at_location(node), |signature| {
                let parameters = signature.parameters();
                match (parameters.get(0), parameters.get(1)) {
                    (Some(on_fulfilled), Some(on_rejected)) => {
                        is_function_param(on_fulfilled, node) && is_function_param(on_rejected, node)
                    }
                    _ => false,
                }
            })
        })
    }
}

impl Rule for NoFloatingPromises {
    const META: Meta = Meta::typescript("no-floating-promises", Kind::Problem)
        .has_suggestions()
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoFloatingPromises {
            allow_for_known_safe_calls: parse_type_or_value_specifiers(
                options.array("allowForKnownSafeCalls"),
            ),
            allow_for_known_safe_promises: parse_type_or_value_specifiers(
                options.array("allowForKnownSafePromises"),
            ),
            check_thenables: options.bool_or("checkThenables", false),
            ignore_iife: options.bool_or("ignoreIIFE", false),
            ignore_void: options.bool_or("ignoreVoid", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Expr], |rule, stmt, cx| {
            let StmtKind::Expr(expression) = stmt.kind() else {
                return;
            };
            if rule.ignore_iife && is_async_iife(expression) {
                return;
            }
            rule.check_node(stmt.span(), expression, cx);
        });

        // The body of an arrow function that is a unary expression. Only what `void` is applied to
        // can be a promise, and only if `void` is not a way to ignore one.
        if !self.ignore_void {
            on.exprs([ExprTag::Unary], |rule, body, cx| {
                if let ExprKind::Unary { op: UnOp::Void, .. } = body.kind()
                    && let Node::Func(func) = body.parent()
                    && matches!(func.body(), FnBody::Expr(it) if it == body)
                {
                    rule.check_node(body.span(), body, cx);
                }
            });
        }
    }
}
