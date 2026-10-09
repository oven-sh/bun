use bun_lint_oxlint::ast_util::{is_global_reference, static_property_name};
use crate::unicorn::GLOBAL_OBJECT_NAMES;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce the use of `new` for most builtins.
pub struct NewForBuiltins;

const ENFORCE: Message = Message::new("", "Use `new {{fn_name}}()` instead of `{{fn_name}}()`");
const DISALLOW: Message = Message::new("", "Use `{{fn_name}}()` instead of `new {{fn_name}}()`");
const ERROR_DATE: Message = Message::new("", "Use `String(new Date())` instead of `Date()`");

fn is_enforced(name: &[u8]) -> bool {
    matches!(
        name,
        b"Array"
            | b"ArrayBuffer"
            | b"BigInt64Array"
            | b"BigUint64Array"
            | b"DataView"
            | b"Date"
            | b"Error"
            | b"FinalizationRegistry"
            | b"Float16Array"
            | b"Float32Array"
            | b"Float64Array"
            | b"Function"
            | b"Int16Array"
            | b"Int32Array"
            | b"Int8Array"
            | b"Map"
            | b"Object"
            | b"Promise"
            | b"Proxy"
            | b"RegExp"
            | b"Set"
            | b"SharedArrayBuffer"
            | b"Uint16Array"
            | b"Uint32Array"
            | b"Uint8Array"
            | b"Uint8ClampedArray"
            | b"WeakMap"
            | b"WeakRef"
            | b"WeakSet"
    )
}

fn is_disallowed(name: &[u8]) -> bool {
    matches!(name, b"BigInt" | b"Boolean" | b"Number" | b"Symbol" | b"String")
}

/// The `Map` of `Map` and of `globalThis.Map`, if `is_builtin` says that it is one and nothing in the file declares it.
fn global_builtin<'a>(callee: Expr<'a>, is_builtin: fn(&[u8]) -> bool) -> Option<Name<'a>> {
    if let Some(name) = callee.as_ident() {
        return (is_builtin(name.bytes()) && is_global_reference(callee)).then_some(name);
    }
    let name = static_property_name(callee).filter(|it| is_builtin(it.bytes()))?;
    let is_of_global_object = callee.object()?.as_ident()?.is_any(&GLOBAL_OBJECT_NAMES);
    // What has a `?.` cannot become a `new` expression.
    (is_of_global_object && !callee.is_chain_root() && !callee.is_optional()).then_some(name)
}

impl Rule for NewForBuiltins {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "new-for-builtins", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NewForBuiltins
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::New], |_, e, cx| {
            if let Some(fn_name) = e.callee().and_then(|it| global_builtin(it, is_disallowed)) {
                cx.report(e, DISALLOW).data("fn_name", fn_name);
            }
        });
        on.exprs([ExprTag::Call], |_, e, cx| {
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
        });
    }
}
