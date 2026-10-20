use bun_lint::prelude::*;

/// Disallow throwing literals as exceptions.
pub struct NoThrowLiteral;

const OBJECT: Message = Message::new("object", "Expected an error object to be thrown.");
const UNDEF: Message = Message::new("undef", "Do not throw undefined.");

/// oxlint looks through type-only wrappers and points at the thrown expression, including its parentheses if that's a
/// string, a template or `undefined`.
fn check_as_oxlint<'a>(argument: Expr<'a>, cx: &mut Cx<'a, NoThrowLiteral>) {
    let inner = argument.skip_type_wrappers();
    if matches!(inner.tag(), ExprTag::String | ExprTag::Template) {
        let whole = argument.outer_span();
        cx.report(whole, OBJECT)
            .unless_claimed(argument)
            .fix(|fixer| fixer.replace(whole, [&b"new Error("[..], fixer.file().slice(whole), b")"].concat()));
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
            cx.report(stmt, OBJECT);
        } else if argument.is_ident("undefined") && ast_utils::is_global_reference(argument) {
            cx.report(stmt, UNDEF);
        }
    }
}
