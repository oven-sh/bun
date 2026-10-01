//! Ported from ESLint lib/rules/no-duplicate-case.js.

use std::collections::BTreeSet;

use bun_ast::S;

use crate::context::Context;
use crate::rule::{Rule, RuleCategory};

static RULE: Rule = Rule {
    name: "no-duplicate-case",
    category: RuleCategory::Correctness,
};

/// The `SwitchStatement` handler: a test that is equal to the test of an earlier clause is reported at its `case`.
pub(crate) fn s_switch(context: &mut Context<'_, '_>, node: &S::Switch) {
    let cases = node.cases.slice();
    // One clause repeats no test.
    if cases.len() < 2 {
        return;
    }
    // `previousTests`, each test as its key: what `equal` compares of it.
    let mut previous_tests: BTreeSet<Vec<u8>> = BTreeSet::new();
    for (index, case) in cases.iter().enumerate() {
        let Some(test) = &case.value else {
            continue;
        };
        // A test whose text does not read has no key: it is not compared.
        let Some(key) = context.tokens_of(test) else {
            continue;
        };
        if !previous_tests.insert(key) {
            let start = context.case_start(node, index);
            context.report(&RULE, start, b"Duplicate case label.");
        }
    }
}
