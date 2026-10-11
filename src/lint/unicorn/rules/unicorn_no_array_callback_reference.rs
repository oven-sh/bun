use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr, is_import_from_module, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::{SmallVec, smallvec};

/// Prevents passing a function reference directly to iterator methods.
pub struct NoArrayCallbackReference;

const NO_ARRAY_CALLBACK_REFERENCE: Message = Message::new("", "Avoid passing a function reference directly to iterator methods");

const METHODS: [&str; 12] = [
    "every",
    "filter",
    "find",
    "findLast",
    "findIndex",
    "findLastIndex",
    "flatMap",
    "forEach",
    "map",
    "some",
    "reduce",
    "reduceRight",
];

impl Rule for NoArrayCallbackReference {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-array-callback-reference", Kind::Suggestion);
    const ON: On = On::new().method_calls(&METHODS);
    no_state!();

    fn new(_: &Options) -> Self {
        NoArrayCallbackReference
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if file.mentions_any(&METHODS) { Self::ON } else { On::new() }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call_expr) = e.as_call() else {
            return;
        };
        let member = get_inner_expression(call_expr.callee());
        if !member.member_name().is_some_and(|it| it.name().is_any(&METHODS)) {
            return;
        }
        let args = call_expr.args();
        // Most callbacks are functions.
        let Some(callback_expr) = args.first().filter(|it| args.len() <= 2 && !matches!(it.tag(), ExprTag::Fn | ExprTag::Spread))
        else {
            return;
        };
        let Some(object) = member.object() else {
            return;
        };
        if !is_ignored_object(object) && should_wrap_callback(callback_expr) {
            cx.report(callback_expr, NO_ARRAY_CALLBACK_REFERENCE);
        }
    }
}

/// What is in parentheses, and the whole of an optional chain, is nothing that oxlint knows here.
fn should_wrap_callback(expr: Expr) -> bool {
    let mut pending: SmallVec<[Expr; 4]> = smallvec![expr];
    while let Some(e) = pending.pop() {
        if e.is_parenthesized() || e.is_chain_root() {
            continue;
        }
        match e.kind() {
            ExprKind::Ident(name) if is_allowed_builtin(name) => {}
            ExprKind::Cond { yes, no, .. } => pending.extend([no, yes]),
            ExprKind::Call(call_expr) => {
                if !get_member_expr(call_expr.callee()).and_then(static_property_name).is_some_and(|it| it.is("bind")) {
                    return true;
                }
            }
            ExprKind::Binary { op: BinOp::Comma, right, .. } => pending.push(right),
            ExprKind::Binary { left, .. } if left.tag() == ExprTag::PrivateIdentifier => {}
            ExprKind::Index { .. }
            | ExprKind::Dot { .. }
            | ExprKind::Ident(_)
            | ExprKind::Yield { .. }
            | ExprKind::Assign { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Unary { .. }
            | ExprKind::New(_) => return true,
            // These cannot be callbacks.
            _ => {}
        }
    }
    false
}

fn is_allowed_builtin(name: Name) -> bool {
    name.is_any(&[
        "String",
        "Number",
        "Boolean",
        "Symbol",
        "BigInt",
        "RegExp",
        "Date",
        "Array",
        "Object",
        "Map",
        "Set",
        "WeakMap",
        "WeakSet",
        "Promise",
        "Error",
        "AggregateError",
        "EvalError",
        "RangeError",
        "ReferenceError",
        "SyntaxError",
        "TypeError",
        "URIError",
        "Int8Array",
        "Uint8Array",
        "Uint8ClampedArray",
        "Int16Array",
        "Uint16Array",
        "Int32Array",
        "Uint32Array",
        "Float32Array",
        "Float64Array",
        "BigInt64Array",
        "BigUint64Array",
        "DataView",
        "ArrayBuffer",
        "SharedArrayBuffer",
    ])
}

fn is_ignored_object(expr: Expr) -> bool {
    if expr.is_parenthesized() {
        return false;
    }
    match expr.kind() {
        ExprKind::Ident(name) => {
            // `types`: MobX State Tree and the like
            name.is_any(&["Promise", "lodash", "underscore", "_", "React", "Vue", "Async", "async", "$", "jQuery", "Children", "types"])
                || is_import_from_module(expr, "effect")
        }
        // `$(this)`, `jQuery(..)`
        ExprKind::Call(call_expr) => call_expr.callee().as_ident().is_some_and(|it| it.is_any(&["$", "jQuery"])),
        // `types.map`, `oidc.Client.find`: likely methods of namespaces and classes, not of arrays
        ExprKind::Dot { .. } | ExprKind::Index { .. } => true,
        _ => false,
    }
}
