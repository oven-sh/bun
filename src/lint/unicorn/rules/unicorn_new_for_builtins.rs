use bun_lint_oxlint::ast_util::{is_global_reference, static_property_name};
use crate::unicorn::GLOBAL_OBJECT_NAMES;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce the use of `new` for most builtins.
pub struct NewForBuiltins;

const ENFORCE: Message = Message::new("", "Use `new {{fn_name}}()` instead of `{{fn_name}}()`");
const DISALLOW: Message = Message::new("", "Use `{{fn_name}}()` instead of `new {{fn_name}}()`");
const ERROR_DATE: Message = Message::new("", "Use `String(new Date())` instead of `Date()`");

const ENFORCED: [&str; 29] = [
    "Array", "ArrayBuffer", "BigInt64Array", "BigUint64Array", "DataView", "Date", "Error", "FinalizationRegistry",
    "Float16Array", "Float32Array", "Float64Array", "Function", "Int16Array", "Int32Array", "Int8Array", "Map",
    "Object", "Promise", "Proxy", "RegExp", "Set", "SharedArrayBuffer", "Uint16Array", "Uint32Array", "Uint8Array",
    "Uint8ClampedArray", "WeakMap", "WeakRef", "WeakSet",
];

fn is_enforced(name: &[u8]) -> bool {
    ENFORCED.iter().any(|it| it.as_bytes() == name)
}

fn is_disallowed(name: &[u8]) -> bool {
    matches!(name, b"BigInt" | b"Boolean" | b"Number" | b"Symbol" | b"String")
}

/// The `Map` of `Map` and of `globalThis.Map`, if `is_builtin` says that it is one and nothing in the file declares it.
fn global_builtin<'a>(callee: Expr<'a>, is_builtin: fn(&[u8]) -> bool) -> Option<Name<'a>> {
    let is_builtin = |name: &[u8]| name.first().is_some_and(u8::is_ascii_uppercase) && is_builtin(name);
    if let Some(name) = callee.as_ident() {
        return (is_builtin(name.bytes()) && is_global_reference(callee)).then_some(name);
    }
    if !callee.object()?.as_ident()?.is_any(&GLOBAL_OBJECT_NAMES) {
        return None;
    }
    let name = static_property_name(callee).filter(|it| is_builtin(it.bytes()))?;
    // What has a `?.` cannot become a `new` expression.
    (!callee.is_chain_root() && !callee.is_optional()).then_some(name)
}

impl Rule for NewForBuiltins {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "new-for-builtins", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::New]).calls_named(&ENFORCED);
    no_state!();

    fn new(_: &Options) -> Self {
        NewForBuiltins
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::New => {
                if let Some(fn_name) = e.callee().and_then(|it| global_builtin(it, is_disallowed)) {
                    cx.report(e, DISALLOW).data("fn_name", fn_name);
                }
            }
            ExprTag::Call => self.call(e, cx),
            _ => {}
        }
    }
}

impl NewForBuiltins {
    fn call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(fn_name) = e.callee().and_then(|it| global_builtin(it, is_enforced)) else {
            return;
        };
        if e.is_optional() {
            return;
        }
        // `Object(a) === a`
        if fn_name.is("Object")
            && !e.is_parenthesized()
            && matches!(e.parent(), Node::Expr(parent)
                if matches!(parent.binary_op(), Some(BinOp::EqEqEq | BinOp::NotEqEq)))
        {
            return;
        }
        if fn_name.is("Date") {
            cx.report(e, ERROR_DATE);
        } else {
            cx.report(e, ENFORCE).data("fn_name", fn_name);
        }
    }
}
