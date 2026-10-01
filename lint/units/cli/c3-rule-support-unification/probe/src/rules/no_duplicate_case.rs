//! ESLint: lib/rules/no-duplicate-case.js
use crate::context::Context;
use crate::tokens::Kind;
use bun_ast::{Expr, S};
use bun_js_parser::lexer::T;

const NAME: &str = "no-duplicate-case";

/// The tokens of a test: equal tests are equal token for token (ESLint: equalTokens).
type Test = Vec<(Kind, Vec<u8>)>;

pub(crate) fn s_switch(cx: &mut Context<'_, '_>, node: &S::Switch) {
    let cases = node.cases.slice();
    if cases.iter().filter(|case| case.value.is_some()).count() < 2 {
        return;
    }
    let mut seen: Vec<Test> = Vec::new();
    for (index, case) in cases.iter().enumerate() {
        let Some(value) = &case.value else { continue };
        // A test that cannot be read again is compared with nothing.
        let Some(test) = test_tokens(cx, value) else { continue };
        if seen.contains(&test) {
            let at = cx.case_loc(node, index);
            cx.report(NAME, at, format_args!("Duplicate case label."));
        } else {
            seen.push(test);
        }
    }
}

/// From the first token of the test to the `:` of its clause, without the `)` of parentheses around all of it.
fn test_tokens(cx: &Context<'_, '_>, value: &Expr) -> Option<Test> {
    let text = cx.text();
    let mut test: Test = Vec::new();
    // Per token: a `)` whose `(` stands before the test.
    let mut unmatched: Vec<bool> = Vec::new();
    cx.case_test(value, |token, closes_outer| {
        let raw = text.get(token.start as usize..token.end as usize).unwrap_or(b"");
        let spelled = match token.kind {
            // ESLint compares the name of an identifier, not how it is escaped.
            Kind::Code(T::TIdentifier) if raw.contains(&b'\\') => unescape_identifier(raw),
            _ => raw.to_vec(),
        };
        test.push((token.kind, spelled));
        unmatched.push(closes_outer);
    })?;
    while unmatched.last() == Some(&true) {
        unmatched.pop();
        test.pop();
    }
    Some(test)
}

fn unescape_identifier(raw: &[u8]) -> Vec<u8> {
    let text = String::from_utf8_lossy(raw);
    let mut out = String::new();
    let mut rest = text.as_ref();
    while let Some(at) = rest.find("\\u") {
        out.push_str(&rest[..at]);
        rest = &rest[at + 2..];
        let (digits, after) = match rest.strip_prefix('{') {
            Some(braced) => match braced.split_once('}') {
                Some((digits, after)) => (digits, after),
                None => (braced, ""),
            },
            None => rest.split_at(rest.len().min(4)),
        };
        if let Some(c) = u32::from_str_radix(digits, 16).ok().and_then(char::from_u32) {
            out.push(c);
        }
        rest = after;
    }
    out.push_str(rest);
    out.into_bytes()
}
