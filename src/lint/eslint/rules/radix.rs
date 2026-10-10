use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::is_reference_to_global_variable;

/// Enforce the use of the radix argument when using `parseInt()`.
pub struct Radix {
    /// `"as-needed"`, which ESLint 10 ignores.
    is_as_needed: bool,
}

const MISSING_PARAMETERS: Message = Message::new("missingParameters", "Missing parameters.");
const MISSING_RADIX: Message = Message::new("missingRadix", "Missing radix parameter.");
const INVALID_RADIX: Message = Message::new(
    "invalidRadix",
    "Invalid radix parameter, must be an integer between 2 and 36.",
);
const REDUNDANT_RADIX: Message = Message::new("redundantRadix", "Redundant radix parameter.");
const ADD_RADIX_PARAMETER_10: Message = Message::new(
    "addRadixParameter10",
    "Add radix parameter `10` for parsing decimal numbers.",
);

fn is_valid_radix_value(value: f64) -> bool {
    value.fract() == 0.0 && (2.0..=36.0).contains(&value)
}

/// ESLint's `isValidRadix`: anything but a literal that is not an integer between 2 and 36, and
/// `undefined`.
fn is_valid_radix(radix: Expr) -> bool {
    match radix.kind() {
        ExprKind::Unary { op: op @ (UnOp::Minus | UnOp::Plus), operand } => match operand.kind() {
            ExprKind::Number(value) => is_valid_radix_value(if op == UnOp::Minus { -value } else { value }),
            _ => true,
        },
        ExprKind::Number(value) => is_valid_radix_value(value),
        ExprKind::Ident(name) => !(name.is("undefined") && ast_utils::is_global_reference(radix)),
        _ => !ast_utils::is_literal(radix),
    }
}

/// oxlint's `is_valid_radix`: an integer between 2 and 36, or a name other than `undefined`.
fn is_valid_radix_for_oxlint(radix: Expr) -> bool {
    match radix.kind() {
        _ if radix.is_parenthesized() => false,
        ExprKind::Number(value) => is_valid_radix_value(value),
        ExprKind::Ident(name) => !name.is("undefined"),
        _ => false,
    }
}

impl Rule for Radix {
    const META: Meta = Meta::eslint("radix", Kind::Suggestion).has_suggestions().reports_at_the_end();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        Radix { is_as_needed: options.str(0) == Some("as-needed") }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("parseInt") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        let (callee, is_oxlint) = (call.callee(), cx.language().is_oxlint);
        let global = match callee.kind() {
            ExprKind::Ident(name) if name.is("parseInt") => callee,
            // oxlint knows `Number["parseInt"]` only as the whole of an optional chain.
            ExprKind::Index { .. } if is_oxlint && !callee.is_chain_root() => return,
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }
                if ast_utils::is_specific_member_access(callee, Some("Number"), Some("parseInt")) =>
            {
                obj
            }
            _ => return,
        };
        let is_global = match is_oxlint {
            true => is_reference_to_global_variable(global),
            false => ast_utils::is_global_reference(global),
        };
        if !is_global {
            return;
        }
        // For oxlint `...a` is an argument like another, and no radix.
        let args = call.args();
        if !is_oxlint && args.iter().take(2).any(|arg| arg.tag() == ExprTag::Spread) {
            return;
        }
        let is_as_needed = self.is_as_needed && cx.language().eslint_major < 10;
        match (args.first(), args.get(1)) {
            (None, _) => {
                cx.report(e, MISSING_PARAMETERS);
            }
            (Some(_), None) if is_as_needed => {}
            (Some(_), Some(radix)) if is_as_needed && matches!(radix.kind(), ExprKind::Number(it) if it == 10.0) => {
                cx.report(e, REDUNDANT_RADIX);
            }
            (Some(_), None) => {
                cx.report(e, MISSING_RADIX).suggest(ADD_RADIX_PARAMETER_10, |fixer| {
                    let last_token = fixer.file().last_token(e)?;
                    let has_trailing_comma =
                        fixer.file().token_before(last_token).is_some_and(|it| ast_utils::is_comma_token(&it));
                    Some(fixer.insert_before(last_token, if has_trailing_comma { " 10," } else { ", 10" }))
                });
            }
            (Some(_), Some(radix)) => {
                if !(if is_oxlint { is_valid_radix_for_oxlint(radix) } else { is_valid_radix(radix) }) {
                    // oxlint points at the radix.
                    cx.report(if is_oxlint { radix.outer_span() } else { e.span() }, INVALID_RADIX);
                }
            }
        }
    }
}
