use bun_lint_oxlint::ast_util::{as_object_property, is_specific_id, parent_node};
use crate::oxlint::vue::{
    is_specific_static_name, is_vue_component_options_object, is_vue_file, is_vue_setup, key_name, object_of,
    property_of_function,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that a `return` statement is present in `emits` validators (in Vue.js 3.0.0+).
pub struct ReturnInEmitsValidator;

const EXPECTED_BOOLEAN: Message = Message::new("", "Expected to return a boolean value in \"{{name}}\" emits validator.");
const EXPECTED_TRUE: Message = Message::new("", "Expected to return a true value in \"{{name}}\" emits validator.");

impl Rule for ReturnInEmitsValidator {
    const META: Meta = Meta::oxlint(Plugin::Vue, "return-in-emits-validator", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ReturnInEmitsValidator
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !is_vue_file(file) || !file.mentions_any(&["emits", "defineEmits"]) {
            return;
        }
        on.funcs(|_, func, cx| {
            let Some(emit_name) = get_emit_validator_name(func) else {
                return;
            };
            let body = match func.body() {
                FnBody::Expr(e) => Some(e),
                _ => None,
            };
            let returned = func.returns().filter_map(|it| match it.kind() {
                StmtKind::Return(argument) => argument,
                _ => None,
            });
            let mut values = body.into_iter().chain(returned).peekable();
            let has_return_value = values.peek().is_some();
            if values.all(is_falsy) {
                let message = if has_return_value { EXPECTED_TRUE } else { EXPECTED_BOOLEAN };
                cx.report(func.estree_span(), message).data("name", emit_name);
            }
        });
    }
}

/// The `name` of `emits: { name: func }` in the options of a component, or of `defineEmits({ name: func })`.
fn get_emit_validator_name(func: Func<'_>) -> Option<Name<'_>> {
    let prop = property_of_function(func)?;
    let emit_name = key_name(prop)?;
    let outer = parent_node(object_of(prop)?)?;
    let is_validator = match as_object_property(outer) {
        Some(emits_prop) => {
            is_specific_static_name(emits_prop, "emits") && object_of(emits_prop).is_some_and(is_vue_component_options_object)
        }
        None => {
            is_vue_setup(func.file())
                && outer.as_expr().and_then(Expr::as_call).is_some_and(|it| is_specific_id(it.callee(), "defineEmits"))
        }
    };
    is_validator.then_some(emit_name)
}

fn is_falsy(expr: Expr) -> bool {
    !expr.is_parenthesized()
        && match expr.kind() {
            ExprKind::False | ExprKind::Null => true,
            ExprKind::Number(value) => value == 0.0,
            ExprKind::String(value) => value.bytes().is_empty(),
            ExprKind::BigInt(_) => {
                let digits = expr.text().strip_suffix(b"n").unwrap_or_else(|| expr.text());
                let digits = if let [b'0', b'x' | b'X' | b'o' | b'O' | b'b' | b'B', rest @ ..] = digits { rest } else { digits };
                digits.iter().all(|it| matches!(it, b'0' | b'_'))
            }
            ExprKind::Ident(name) => name.is_any(&["undefined", "NaN"]),
            _ => false,
        }
}
