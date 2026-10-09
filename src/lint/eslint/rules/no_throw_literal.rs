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
        let whole = argument.outer_span();
        cx.report(whole, OBJECT)
            .fix(|fixer| fixer.replace(whole, [&b"new Error("[..], fixer.file().slice(whole), b")"].concat()));
    } else if inner.is_ident("undefined") && ast_utils::is_global_reference(inner) {
        cx.report(argument.outer_span(), UNDEF);
    } else if !ast_utils::could_be_error(inner) {
        cx.report(inner, OBJECT);
    }
}

impl Rule for NoThrowLiteral {
    const META: Meta = Meta::eslint("no-throw-literal", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoThrowLiteral
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Throw], |_, stmt, cx| {
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
        });
    }
}
