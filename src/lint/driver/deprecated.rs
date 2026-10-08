//! ESLint's `usedDeprecatedRules`.

#[path = "deprecated_data.rs"]
mod data;

use bun_lint::context::Severity;
use bun_lint::linter::{ResolvedConfig, RuleId};

/// `JSON.stringify(result.usedDeprecatedRules)` for a file that has `config`.
pub(crate) fn write_used(out: &mut Vec<u8>, config: Option<&ResolvedConfig>) {
    out.push(b'[');
    let rules = config.map_or(&[][..], |config| &config.rules[..]);
    let mut is_first = true;
    for rule in rules.iter().filter(|it| it.severity != Severity::Off && it.entry.meta.is_deprecated) {
        let id = RuleId::Known(rule.entry.meta).to_vec();
        let Ok(at) = data::DEPRECATED.binary_search_by(|it| it.0.as_bytes().cmp(&id[..])) else {
            continue;
        };
        if !std::mem::take(&mut is_first) {
            out.push(b',');
        }
        out.extend_from_slice(b"{\"ruleId\":\"");
        out.extend_from_slice(&id);
        out.extend_from_slice(b"\",");
        out.extend_from_slice(data::DEPRECATED[at].1.as_bytes());
        out.push(b'}');
    }
    out.push(b']');
}
