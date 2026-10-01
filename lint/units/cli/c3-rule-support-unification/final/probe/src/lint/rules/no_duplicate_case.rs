//! Ported from ESLint lib/rules/no-duplicate-case.js.

use bun_ast::S;

use crate::lint::context::Context;
use crate::lint::rule::{Rule, RuleCategory};

static RULE: Rule = Rule {
    name: "no-duplicate-case",
    category: RuleCategory::Correctness,
};

pub(crate) fn s_switch(context: &mut Context<'_, '_>, node: &S::Switch) {
    let cases = node.cases.slice();
    // Each test by what ESLint compares of it, with its place. A test whose text does not read is not compared.
    let mut tests: Vec<(Vec<u8>, usize)> = Vec::new();
    for (index, case) in cases.iter().enumerate() {
        if let Some(key) = case
            .value
            .as_ref()
            .and_then(|value| context.case_test(value))
        {
            tests.push((key, index));
        }
    }
    tests.sort_unstable();
    // Equal tests are neighbours now, the first one written first: every later one is a duplicate.
    let mut previous: Option<&[u8]> = None;
    for (key, index) in &tests {
        if previous == Some(key.as_slice()) {
            if let Some(value) = cases.get(*index).and_then(|case| case.value.as_ref()) {
                let start = context.case_start(value);
                context.report(&RULE, start, b"Duplicate case label.");
            }
        }
        previous = Some(key);
    }
}
