//! Ported from ESLint lib/rules/no-duplicate-case.js.

use bun_ast::S;

use crate::lint::context::Context;
use crate::lint::rule::{Category, Rule};
use crate::lint::tokens::CaseTest;

static RULE: Rule = Rule {
    name: "no-duplicate-case",
    category: Category::Correctness,
};

pub(crate) fn s_switch(context: &mut Context<'_, '_>, node: &S::Switch) {
    let mut earlier: Vec<CaseTest> = Vec::new();
    for case in node.cases.slice() {
        let Some(value) = &case.value else {
            continue;
        };
        // A test whose text does not read is not compared.
        let Some(test) = context.case_test(value) else {
            continue;
        };
        if earlier.iter().any(|seen| seen.same(&test, context.text())) {
            let (start, len) = context.case_start(case, value);
            context.report(&RULE, start, len, b"Duplicate case label.".to_vec());
        } else {
            earlier.push(test);
        }
    }
}
