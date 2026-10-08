use bun_lint::prelude::*;

/// Disallow lexical declarations in case clauses.
pub struct NoCaseDeclarations;

const ADD_BRACKETS: Message = Message::new("addBrackets", "Add {} brackets around the case block.");
const UNEXPECTED: Message =
    Message::new("unexpected", "Unexpected lexical declaration in case block.");

fn is_lexical_declaration(statement: Stmt) -> bool {
    match statement.kind() {
        // Without a body it is a `TSDeclareFunction`.
        StmtKind::Fn(func) => func.has_body(),
        StmtKind::Class(_) => true,
        StmtKind::Var(declarations) => {
            declarations.first().is_some_and(|it| it.var_kind() != VarKind::Var)
        }
        _ => false,
    }
}

impl Rule for NoCaseDeclarations {
    const META: Meta = Meta::eslint("no-case-declarations", Kind::Suggestion)
        .has_suggestions()
        .recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoCaseDeclarations
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.cases(|_, case, cx| {
            let body = case.body();
            for statement in body {
                if !is_lexical_declaration(statement) {
                    continue;
                }
                cx.report(statement, UNEXPECTED).suggest(ADD_BRACKETS, |fixer| {
                    Some([
                        fixer.insert_before(body.first()?, "{ "),
                        fixer.insert_after(body.last()?, " }"),
                    ])
                });
            }
        });
    }
}
