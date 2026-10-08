use bun_lint::prelude::*;
use bun_lint::utils::ast_utils;

/// Disallow duplicate case labels.
pub struct NoDuplicateCase;

const UNEXPECTED: Message = Message::new("unexpected", "Duplicate case label.");

/// It is a single token, so that two of them are equal only if their text is.
fn is_single_token(e: Expr) -> bool {
    matches!(
        e.tag(),
        ExprTag::Ident
            | ExprTag::This
            | ExprTag::Null
            | ExprTag::True
            | ExprTag::False
            | ExprTag::Number
            | ExprTag::String
            | ExprTag::BigInt
            | ExprTag::Regex
    )
}

/// Whether the two consist of the same tokens: they differ in whitespace and comments at most.
fn equal<'a>(file: &'a File<'a>, a: Expr<'a>, b: Expr<'a>) -> bool {
    if a.tag() != b.tag() {
        return false;
    }
    if a.text() == b.text() {
        return true;
    }
    if is_single_token(a) {
        return false;
    }
    ast_utils::equal_tokens(file, a, b)
}

impl Rule for NoDuplicateCase {
    const META: Meta = Meta::eslint("no-duplicate-case", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDuplicateCase
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Switch], |_, stmt, cx| {
            let StmtKind::Switch { cases, .. } = stmt.kind() else {
                return;
            };
            for (i, case) in cases.iter().enumerate() {
                let Some(test) = case.test() else {
                    continue;
                };
                let mut previous = cases.iter().take(i).filter_map(Case::test);
                if previous.any(|it| equal(cx.file(), it, test)) {
                    cx.report(case, UNEXPECTED);
                }
            }
        });
    }
}
