use bun_lint::prelude::*;

/// Enforce the use of the radix argument when using `parseInt()`.
pub struct Radix;

const MISSING_PARAMETERS: Message = Message::new("missingParameters", "Missing parameters.");
const MISSING_RADIX: Message = Message::new("missingRadix", "Missing radix parameter.");
const INVALID_RADIX: Message = Message::new(
    "invalidRadix",
    "Invalid radix parameter, must be an integer between 2 and 36.",
);
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

impl Radix {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        let callee = call.callee();
        let global = match callee.kind() {
            ExprKind::Ident(name) if name.is("parseInt") => callee,
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }
                if ast_utils::is_specific_member_access(callee, Some("Number"), Some("parseInt")) =>
            {
                obj
            }
            _ => return,
        };
        if !ast_utils::is_global_reference(global) {
            return;
        }
        let args = call.args();
        if args.iter().take(2).any(|arg| arg.tag() == ExprTag::Spread) {
            return;
        }
        match (args.first(), args.get(1)) {
            (None, _) => {
                cx.report(e, MISSING_PARAMETERS);
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
                if !is_valid_radix(radix) {
                    cx.report(e, INVALID_RADIX);
                }
            }
        }
    }
}

impl Rule for Radix {
    const META: Meta = Meta::eslint("radix", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Radix
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call], Self::check);
    }
}
