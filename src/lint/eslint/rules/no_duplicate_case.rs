use bun_core::strings;
use bun_lint::language::Parser;
use bun_lint::prelude::*;
use rustc_hash::FxHashMap;

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

/// oxlint points at the first test that is the same.
fn report<'a>(case: Case<'a>, first: Span, cx: &Cx<'a, NoDuplicateCase>) {
    let report = cx.report(if cx.language().is_oxlint { first } else { case.span() }, UNEXPECTED).hint_with(|| {
        Some(format!("Only the first case with this label runs. It is on line {}.", cx.line_of(first.start)))
    });
    report.labels_with(|labels| {
        labels.push(case.test().map(Expr::span).unwrap_or_default(), "is duplicated here");
    });
}

/// For a `switch` of which no test can be written differently: two are [`equal`] if they are of one kind and have one text.
#[inline(never)]
fn check_by_text<'a>(cases: List<'a, Case<'a>>, cx: &Cx<'a, NoDuplicateCase>) {
    let mut first_of = FxHashMap::default();
    for case in cases {
        let Some(test) = case.test() else {
            continue;
        };
        let first = *first_of.entry((test.tag() as u8, test.text())).or_insert(test);
        debug_assert_eq!(Some(first), cases.iter().filter_map(Case::test).find(|&it| equal(cx.file(), it, test, true)));
        if first != test {
            report(case, first.span(), cx);
        }
    }
}

impl Rule for NoDuplicateCase {
    const META: Meta = Meta::eslint("no-duplicate-case", Kind::Problem).recommended().hints();
    const ON: On = On::new().stmts(&[StmtTag::Switch]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoDuplicateCase
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let Some((_, cases)) = stmt.as_switch() else {
            return;
        };
        // Spares the tokens of the file for `case Kind.A: case Kind.B:`.
        let mut tests = cases.iter().filter_map(Case::test);
        let is_text_enough = !tests.any(|it| !is_single_token(it) && can_be_written_differently(it));
        if is_text_enough && cases.len() > 8 {
            return check_by_text(cases, cx);
        }
        for (i, case) in cases.iter().enumerate() {
            let Some(test) = case.test() else {
                continue;
            };
            let mut previous = cases.iter().take(i).filter_map(Case::test);
            if let Some(first) = previous.find(|&it| equal(cx.file(), it, test, is_text_enough)) {
                report(case, first.span(), cx);
            }
        }
    }
}
