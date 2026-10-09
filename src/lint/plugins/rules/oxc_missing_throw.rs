use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Checks whether the `throw` keyword is missing in front of a `new` expression.
pub struct MissingThrow;

const MISSING_THROW: Message = Message::new("", "Missing throw");
const ADD_THROW: Message = Message::new("", "The `throw` keyword seems to be missing in front of this 'new' expression");

impl Rule for MissingThrow {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "missing-throw", Kind::Problem).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        MissingThrow
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("Error") {
            return;
        }
        on.exprs([ExprTag::New], |_, e, cx| {
            if e.callee().is_some_and(|callee| get_inner_expression(callee).is_ident("Error"))
                && matches!(e.parent(), Node::Stmt(statement) if statement.tag() == StmtTag::Expr)
                && !e.is_parenthesized()
            {
                cx.report(e, MISSING_THROW).suggest(ADD_THROW, |fixer| fixer.insert_before(e, "throw "));
            }
        });
    }
}
