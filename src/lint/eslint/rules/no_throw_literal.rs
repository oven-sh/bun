use bun_lint::prelude::*;

/// Disallow throwing literals as exceptions.
pub struct NoThrowLiteral;

const OBJECT: Message = Message::new("object", "Expected an error object to be thrown.");
const UNDEF: Message = Message::new("undef", "Do not throw undefined.");

/// oxlint sees through what only concerns types, and points at what is thrown: with its parentheses if that is a
/// string, a template or `undefined`.
fn check_as_oxlint<'a>(argument: Expr<'a>, cx: &mut Cx<'a, NoThrowLiteral>) {
    let inner = argument.skip_type_wrappers();
    if matches!(inner.tag(), ExprTag::String | ExprTag::Template) {
        cx.report(argument.outer_span(), OBJECT)
            .unless_claimed(argument)
            .fix(|fixer| utils::oxlint::wrap_in_new_error(fixer, argument));
    } else if inner.is_ident("undefined") && ast_utils::is_global_reference(inner) {
        cx.report(argument.outer_span(), UNDEF).unless_claimed(argument);
    } else if !ast_utils::could_be_error(inner) {
        cx.report(inner, OBJECT).unless_claimed(argument);
    }
}

impl Rule for NoThrowLiteral {
    const META: Meta = Meta::eslint("no-throw-literal", Kind::Suggestion);
    const ON: On = On::new().stmts(&[StmtTag::Throw]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoThrowLiteral
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Throw(argument) = stmt.kind() else {
            return;
        };
        if cx.language().is_oxlint {
            return check_as_oxlint(argument, cx);
        }
        if !ast_utils::could_be_error(argument) {
            cx.report(stmt, OBJECT).unless_claimed(argument);
        } else if argument.is_ident("undefined") && ast_utils::is_global_reference(argument) {
            cx.report(stmt, UNDEF).unless_claimed(argument);
        }
    }
}
