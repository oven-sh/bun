use bun_core::strings;
use bun_lint::language::Parser;
use bun_lint::prelude::*;
use bun_lint::utils::token_key::TokenClasses;
use rustc_hash::FxHashMap;

/// Disallow duplicate case labels.
pub struct NoDuplicateCase;

const UNEXPECTED: Message = Message::new("unexpected", "Duplicate case label.");

/// With more cases than this, the tests are not compared with each other but looked up.
const COMPARED: usize = 16;

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

/// What comparing each test with those before it by [`equal`] finds, in time in proportion to the text of the tests.
fn check_many<'a>(cases: List<'a, Case<'a>>, is_text_enough: bool, cx: &Cx<'a, NoDuplicateCase>) {
    let is_espree = cx.language().parser == Parser::Espree;
    // Where the first of each is.
    let (mut texts, mut names) = (FxHashMap::default(), FxHashMap::default());
    let (mut classes, mut first_of_class) = (TokenClasses::default(), Vec::new());
    for case in cases {
        let Some(test) = case.test() else {
            continue;
        };
        let at = test.span();
        let first = match test.as_ident() {
            _ if is_text_enough => *texts.entry(test.text()).or_insert(at),
            Some(name) if is_espree => *names.entry(name).or_insert(at),
            Some(_) => *texts.entry(test.text()).or_insert(at),
            None => {
                let known = classes.len();
                let class = classes.number_of(cx.file(), test) as usize;
                if class == known {
                    first_of_class.push(at);
                }
                first_of_class.get(class).copied().unwrap_or(at)
            }
        };
        if first != at {
            report(case, first, cx);
        }
    }
}

/// oxlint points at the first test that is the same.
fn report<'a>(case: Case<'a>, first: Span, cx: &Cx<'a, NoDuplicateCase>) {
    cx.report(if cx.language().is_oxlint { first } else { case.span() }, UNEXPECTED).labels_with(|labels| {
        labels.push(case.test().map(Expr::span).unwrap_or_default(), "is duplicated here");
    });
}

impl Rule for NoDuplicateCase {
    const META: Meta = Meta::eslint("no-duplicate-case", Kind::Problem).recommended();
    const ON: On = On::new().stmts(&[StmtTag::Switch]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoDuplicateCase
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Switch { cases, .. } = stmt.kind() else {
            return;
        };
        // Spares the tokens of the file for `case Kind.A: case Kind.B:`.
        let mut tests = cases.iter().filter_map(Case::test);
        let is_text_enough = !tests.any(|it| !is_single_token(it) && can_be_written_differently(it));
        if cases.iter().nth(COMPARED).is_some() {
            return check_many(cases, is_text_enough, cx);
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
