use bun_lint_oxlint::ast_util::static_name;
use crate::jsx::{AttributeValue, get_prop_value, has_jsx_prop_ignore_case};
use crate::react::{is_create_element_call, is_jsx};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::{SmallVec, smallvec};

/// Enforces an explicit `type` attribute for all HTML `button` elements.
pub struct ButtonHasType {
    button: bool,
    submit: bool,
    reset: bool,
}

const MISSING_TYPE_PROP: Message = Message::new("", "`button` elements must have an explicit `type` attribute.");
const INVALID_TYPE_PROP: Message = Message::new("", "`button` elements must have a valid `type` attribute.");

impl Rule for ButtonHasType {
    const META: Meta = Meta::oxlint(Plugin::React, "button-has-type", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        ButtonHasType {
            button: options.bool_or("button", true),
            submit: options.bool_or("submit", true),
            reset: options.bool_or("reset", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !is_jsx(file) || !file.mentions("button") {
            return;
        }
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            let ExprKind::Jsx(jsx) = e.kind() else {
                return;
            };
            let Some(identifier) = jsx.tag().filter(|it| it.is_ident("button")) else {
                return;
            };
            match has_jsx_prop_ignore_case(jsx, "type") {
                None => drop(cx.report(identifier, MISSING_TYPE_PROP)),
                Some(button_type_prop) => {
                    let is_valid = match get_prop_value(button_type_prop) {
                        Some(AttributeValue::StringLiteral(literal)) => {
                            rule.is_valid_button_type_prop_string_literal(literal.value)
                        }
                        Some(value) => {
                            value.as_expression().is_some_and(|it| rule.is_valid_button_type_prop_expression(it))
                        }
                        None => false,
                    };
                    if !is_valid {
                        cx.report(button_type_prop, INVALID_TYPE_PROP).data("allowed_types", rule.allowed_types_message());
                    }
                }
            }
        });
        if !file.mentions("createElement") {
            return;
        }
        on.exprs([ExprTag::Call], |rule, e, cx| {
            let Some(call) = e.as_call().filter(|call| is_create_element_call(*call)) else {
                return;
            };
            let arguments = call.args();
            if !arguments
                .first()
                .is_some_and(|it| it.as_string().is_some_and(|it| it.is("button")) && !it.is_parenthesized())
            {
                return;
            }
            let Some((object, ExprKind::Object(properties))) =
                arguments.get(1).filter(|it| !it.is_parenthesized()).map(|it| (it, it.kind()))
            else {
                cx.report(e, MISSING_TYPE_PROP);
                return;
            };
            match properties.iter().find(|it| it.key().and_then(static_name).is_some_and(|key| key.is("type"))) {
                None => drop(cx.report(object, MISSING_TYPE_PROP)),
                Some(type_prop) => {
                    if !type_prop.value().is_some_and(|it| rule.is_valid_button_type_prop_expression(it)) {
                        cx.report(type_prop, INVALID_TYPE_PROP).data("allowed_types", rule.allowed_types_message());
                    }
                }
            }
        });
    }
}

impl ButtonHasType {
    fn allowed_types_message(&self) -> &'static str {
        match (self.button, self.submit, self.reset) {
            (true, true, true) => "`button`, `submit`, or `reset`",
            (true, true, false) => "`button` or `submit`",
            (true, false, true) => "`button` or `reset`",
            (false, true, true) => "`submit` or `reset`",
            (true, false, false) => "`button`",
            (false, true, false) => "`submit`",
            (false, false, true) => "`reset`",
            (false, false, false) => "",
        }
    }

    /// A valid string, or `a ? b : c` of which both are.
    fn is_valid_button_type_prop_expression(&self, expr: Expr) -> bool {
        let mut pending: SmallVec<[Expr; 4]> = smallvec![expr];
        while let Some(expr) = pending.pop() {
            let value = match expr.kind() {
                ExprKind::Cond { yes, no, .. } => {
                    pending.extend([yes, no]);
                    continue;
                }
                ExprKind::String(value) => Some(value),
                ExprKind::Template(template) => template.as_static(),
                _ => None,
            };
            if !value.is_some_and(|it| self.is_valid_button_type_prop_string_literal(it.bytes())) {
                return false;
            }
        }
        true
    }

    fn is_valid_button_type_prop_string_literal(&self, s: &[u8]) -> bool {
        match s {
            b"button" => self.button,
            b"submit" => self.submit,
            b"reset" => self.reset,
            _ => false,
        }
    }
}
