use bun_lint_oxlint::ast_util::get_member_expr;
use bun_lint_oxlint::codegen::print_string;
use crate::unicorn::{call_uses_optional_chain, concat, is_expression_statement};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Use `.dataset` on DOM elements over `getAttribute(…)`, `.setAttribute(…)`, `.removeAttribute(…)` and `.hasAttribute(…)`.
pub struct PreferDomNodeDataset;

const PREFER_DATASET: Message = Message::new("", "Prefer using `dataset` over `{{method_name}}`.");

impl Rule for PreferDomNodeDataset {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-dom-node-dataset", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferDomNodeDataset
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["setAttribute", "getAttribute", "removeAttribute", "hasAttribute"]) {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call_expr) = e.as_call() else {
                return;
            };
            let Some(member_expr) = get_member_expr(call_expr.callee()).filter(|it| !it.is_private_member()) else {
                return;
            };
            let ExprKind::Dot { obj, name: method, .. } = member_expr.kind() else {
                return;
            };
            let args = call_expr.args();
            let is_candidate = match method.bytes() {
                b"setAttribute" => args.len() == 2,
                b"removeAttribute" | b"hasAttribute" => args.len() == 1,
                // `Locator#getAttribute()` of Playwright returns a promise.
                b"getAttribute" => {
                    let is_awaited = matches!(e.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Await);
                    args.len() == 1 && !(is_awaited && !e.is_parenthesized() && !e.is_chain_root())
                }
                _ => false,
            };
            let Some(string_lit) = args.first().filter(|it| is_candidate && !it.is_parenthesized()) else {
                return;
            };
            let Some(attribute) = string_lit.as_string().map(Name::bytes) else {
                return;
            };
            let Some(dataset_property_name) = attribute.strip_prefix(b"data-").or_else(|| attribute.strip_prefix(b"DATA-")) else {
                return;
            };
            let is_removal = method.name().is("removeAttribute");
            let place = if is_removal { string_lit.span() } else { method.span() };
            cx.report(place, PREFER_DATASET).data("method_name", method).fix(|fixer| {
                let file = fixer.file();
                let name = dash_to_camel_case(dataset_property_name);
                let access: &[u8] = if member_expr.is_optional() { b"?.dataset" } else { b".dataset" };
                let object_text = file.slice(obj.outer_span());
                let fixed = match method.bytes() {
                    b"setAttribute" => {
                        if call_uses_optional_chain(call_expr) || !is_expression_statement(e) {
                            return None;
                        }
                        let value = file.slice(args.get(1)?.outer_span());
                        concat(&[object_text, b".dataset", &dataset_property_text(&name), b" = ", value])
                    }
                    b"getAttribute" if !call_expr.is_optional() => concat(&[object_text, access, &dataset_property_text(&name)]),
                    b"removeAttribute" if !call_expr.is_optional() && is_expression_statement(e) => {
                        concat(&[b"delete ", object_text, access, &dataset_property_text(&name)])
                    }
                    b"hasAttribute" if !call_uses_optional_chain(call_expr) => {
                        let mut fixed = concat(&[b"Object.hasOwn(", object_text, b".dataset, "]);
                        print_string(&mut fixed, &name, b'"');
                        fixed.push(b')');
                        fixed
                    }
                    _ => return None,
                };
                Some(fixer.replace(e, fixed))
            });
        });
    }
}

fn dash_to_camel_case(s: &[u8]) -> Vec<u8> {
    let lower = text::to_lower_case(s);
    let mut result = Vec::with_capacity(lower.len());
    let mut capitalize_next = false;
    for &byte in lower.iter() {
        if byte == b'-' {
            capitalize_next = true;
        } else {
            result.push(if capitalize_next { byte.to_ascii_uppercase() } else { byte });
            // The bytes after the first of a character stay as they are in any case.
            capitalize_next = false;
        }
    }
    result
}

/// `.name`, `["na-me"]`
fn dataset_property_text(name: &[u8]) -> Vec<u8> {
    if text::is_identifier_name(name) {
        return concat(&[b".", name]);
    }
    let mut property = b"[".to_vec();
    print_string(&mut property, name, b'"');
    property.push(b']');
    property
}
