use bun_core::strings;
use bun_lint::language::Parser;
use bun_lint::prelude::*;

/// Disallow duplicate case labels.
pub struct NoDuplicateCase;

const UNEXPECTED: Message = Message::new("unexpected", "Duplicate case label.");

/// It is a single token, so that two of them are equal only if their text is.
fn is_single_token(e: Expr) -> bool {
    matches!(
        e.tag(),
        ExprTag::This
            | ExprTag::Null
            | ExprTag::True
            | ExprTag::False
            | ExprTag::Number
            | ExprTag::String
            | ExprTag::BigInt
            | ExprTag::Regex
    )
}

/// Whether there can be whitespace, a comment or an escape sequence in it. Otherwise it is the text of its tokens.
fn can_be_written_differently(e: Expr) -> bool {
    let text = e.text();
    strings::contains_any(text, b" \t\n\r\x0B\x0C/\\") || strings::first_non_ascii(text).is_some()
}

/// Whether the two consist of the same tokens: they differ in whitespace and comments at most.
/// `is_text_enough`: no test of the `switch` can be written differently.
fn equal<'a>(file: &'a File<'a>, a: Expr<'a>, b: Expr<'a>, is_text_enough: bool) -> bool {
    if a.tag() != b.tag() {
        return false;
    }
    if a.text() == b.text() {
        return true;
    }
    // The value of espree's token is the name, that of typescript-estree's is the text: `\u0061` and `a`.
    if let (Some(a), Some(b)) = (a.as_ident(), b.as_ident()) {
        return a == b && file.language().parser == Parser::Espree;
    }
    if is_text_enough || is_single_token(a) {
        return false;
    }
    (can_be_written_differently(a) || can_be_written_differently(b)) && ast_utils::equal_tokens(file, a, b)
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
            // Spares the tokens of the file for `case Kind.A: case Kind.B:`.
            let mut tests = cases.iter().filter_map(Case::test);
            let is_text_enough = !tests.any(|it| !is_single_token(it) && can_be_written_differently(it));
            for (i, case) in cases.iter().enumerate() {
                let Some(test) = case.test() else {
                    continue;
                };
                let mut previous = cases.iter().take(i).filter_map(Case::test);
                if previous.any(|it| equal(cx.file(), it, test, is_text_enough)) {
                    cx.report(case, UNEXPECTED);
                }
            }
        });
    }
}
