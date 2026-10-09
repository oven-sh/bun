use bun_lint_oxlint::ast_util::static_property_name;
use bun_lint_oxlint::codegen::{Codegen, print_expression};
use crate::unicorn::could_be_asi_hazard;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::cell::Cell;

/// Enforces the use of the spread operator (`...`) over outdated patterns.
pub struct PreferSpread;

const PREFER_SPREAD: Message = Message::new("", "Prefer the spread operator (`...`) over {{bad_method}}");

impl Rule for PreferSpread {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-spread", Kind::Suggestion).fixable(Fixable::Code);
    /// How many bytes the fixes have spread so far.
    type State<'a> = Cell<usize>;

    fn new(_: &Options) -> Self {
        PreferSpread
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if !file.mentions_any(&["from", "concat", "slice", "toSpliced"]) {
            return Cell::new(0);
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call_expr) = e.as_call() else {
                return;
            };
            // The whole of an optional chain, which here is in parentheses, is not a member expression for oxlint.
            let member_expr = call_expr.callee();
            let (Some(name), Some(object)) = (static_property_name(member_expr), member_expr.object()) else {
                return;
            };
            if member_expr.is_chain_root() {
                return;
            }
            let args = call_expr.args();
            let first_arg = args.first();
            if first_arg.is_some_and(|it| it.tag() == ExprTag::Spread) && !name.is("concat") {
                return;
            }
            // What is spread instead.
            let (bad_method, spread) = match (name.bytes(), first_arg) {
                (b"from", Some(expr)) if args.len() == 1 => {
                    if member_expr.tag() == ExprTag::Index || expr.tag() == ExprTag::Object || !object.is_ident("Array") {
                        return;
                    }
                    ("Array.from()", Some(expr))
                }
                (b"concat", _) if !is_not_array(object) => ("array.concat()", None),
                (b"slice", _) if args.len() <= 1 => {
                    if matches!(object.tag(), ExprTag::Array | ExprTag::This)
                        || !first_arg.is_none_or(|it| matches!(it.kind(), ExprKind::Number(value) if value == 0.0))
                        || object.as_ident().is_some_and(|it| it.is_any(&IGNORED_SLICE_CALLEE))
                        || is_typed_array_or_buffer_construction(object)
                        || is_not_array(object)
                    {
                        return;
                    }
                    ("array.slice()", Some(object))
                }
                (b"toSpliced", None) if object.tag() != ExprTag::Array => ("array.toSpliced()", Some(object)),
                _ => return,
            };
            let report = cx.report(e, PREFER_SPREAD).data("bad_method", bad_method);
            if let Some(expr_to_spread) = spread {
                report.fix(|fixer| {
                    // In `a.slice().slice() ..` each fix has all that is before it. After a megabyte only what is short is fixed.
                    let (size, spread_so_far) = (expr_to_spread.text().len(), cx.state.get());
                    if size > 1024 && spread_so_far > 1 << 20 {
                        return None;
                    }
                    cx.state.set(spread_so_far + size);
                    let mut codegen = Codegen::default();
                    codegen.code.extend_from_slice(if could_be_asi_hazard(e) { ";[..." } else { "[..." }.as_bytes());
                    // The parentheses around it are not printed.
                    match expr_to_spread.is_parenthesized() && expr_to_spread.tag() == ExprTag::Fn {
                        true => codegen.code.extend_from_slice(expr_to_spread.text()),
                        false => print_expression(&mut codegen, expr_to_spread),
                    }
                    codegen.code.push(b']');
                    Some(fixer.replace(e, codegen.code))
                });
            }
        });
        Cell::new(0)
    }
}

const IGNORED_SLICE_CALLEE: [&str; 5] = ["arrayBuffer", "blob", "buffer", "file", "this"];

fn is_typed_array_or_buffer_construction(expr: Expr) -> bool {
    let ExprKind::New(new_expr) = expr.kind() else {
        return false;
    };
    !new_expr.callee().is_parenthesized()
        && new_expr.callee().as_ident().is_some_and(|it| {
            it.is_any(&[
                "ArrayBuffer",
                "SharedArrayBuffer",
                "Int8Array",
                "Uint8Array",
                "Uint8ClampedArray",
                "Int16Array",
                "Uint16Array",
                "Int32Array",
                "Uint32Array",
                "Float16Array",
                "Float32Array",
                "Float64Array",
                "BigInt64Array",
                "BigUint64Array",
            ])
        })
}

/// `expr`: whether it is in parentheses or not.
fn is_not_array(expr: Expr) -> bool {
    let (mut at, mut is_parenthesized) = (expr, false);
    // Not further than anybody writes it: `var a = b, b = a` goes in a circle, and of `var b = a, c = b ..` each can be asked about.
    let mut steps = 0;
    loop {
        let name = match at.kind() {
            ExprKind::Template(_) => return true,
            ExprKind::Binary { op, left, .. } => {
                return !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma) && left.tag() != ExprTag::PrivateIdentifier;
            }
            _ if at.is_chain_root() => return false,
            // In parentheses, these are nothing that oxlint knows here.
            ExprKind::True | ExprKind::False | ExprKind::Null | ExprKind::Number(_) | ExprKind::BigInt(_) | ExprKind::Regex(_) | ExprKind::String(_) => {
                return !is_parenthesized;
            }
            ExprKind::Call(call_expr) => {
                let callee = call_expr.callee();
                return !is_parenthesized
                    && call_expr.args().len() < 2
                    && !callee.is_chain_root()
                    && static_property_name(callee).is_some_and(|it| it.is("join"));
            }
            ExprKind::Ident(name) => {
                let declaration = at.symbol().and_then(|it| it.declarations().next());
                if let Some(Node::VarDecl(variable_declarator)) = declaration.and_then(Declaration::node)
                    && let Some(init) = variable_declarator.init()
                {
                    steps += 1;
                    if steps > 32 {
                        return false;
                    }
                    (at, is_parenthesized) = (init, init.is_parenthesized());
                    continue;
                }
                name
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } => match static_property_name(at) {
                Some(name) => name,
                None => return false,
            },
            _ => return false,
        };
        // `Foo`, not `FOO`
        let name = name.bytes();
        return name.first().is_some_and(u8::is_ascii_uppercase) && name.iter().any(u8::is_ascii_lowercase);
    }
}
