use bun_lint_oxlint::ast_util::{get_member_expr, is_import_from_module, is_method_call, static_property_name};
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
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoArrayCallbackReference
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&METHODS) {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call_expr) = e.as_call() else {
                return;
            };
            // Most callbacks are functions.
            let Some(callback_expr) = call_expr.args().first().filter(|it| !matches!(it.tag(), ExprTag::Fn | ExprTag::Spread)) else {
                return;
            };
            if !is_method_call(call_expr, None, Some(&METHODS), Some(1), Some(2)) {
                return;
            }
            let Some(ExprKind::Dot { obj: object, .. }) = get_member_expr(call_expr.callee()).map(Expr::kind) else {
                return;
            };
            if !is_ignored_object(object) && should_wrap_callback(callback_expr) {
                cx.report(callback_expr, NO_ARRAY_CALLBACK_REFERENCE);
            }
        });
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
