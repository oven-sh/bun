use bun_lint::prelude::*;

/// Disallow throwing literals as exceptions.
pub struct NoThrowLiteral;

const OBJECT: Message = Message::new("object", "Expected an error object to be thrown.");
const UNDEF: Message = Message::new("undef", "Do not throw undefined.");

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
            if !ast_utils::could_be_error(argument) {
                cx.report(stmt, OBJECT);
            } else if argument.is_ident("undefined") && ast_utils::is_global_reference(argument) {
                cx.report(stmt, UNDEF);
            }
        });
    }
}
