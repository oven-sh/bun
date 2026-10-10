//! ESLint's `usedDeprecatedRules`.

#[path = "deprecated_data.rs"]
mod data;

use bun_core::printer::json_stringify;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::js_plugin;
use bun_lint::linter::{ResolvedConfig, RuleId, write_json};
use bun_lint::options::Json;

/// `getShorthandName(name, "eslint-plugin")`
fn shorthand(name: &[u8]) -> Vec<u8> {
    match (name, strings::split_once_char(name, b'/')) {
        ([b'@', ..], Some((scope, b"eslint-plugin"))) => scope.to_vec(),
        ([b'@', ..], Some((scope, rest))) => match rest.strip_prefix(b"eslint-plugin-") {
            Some(rest) if !rest.is_empty() => [scope, b"/", rest].concat(),
            _ => name.to_vec(),
        },
        ([b'@', ..], None) => name.to_vec(),
        _ => name
            .strip_prefix(b"eslint-plugin-")
            .unwrap_or(name)
            .to_vec(),
    }
}

/// `getDeprecatedRuleReplacements`
fn replacements(deprecated: &Json, replaced_by: &Json) -> Json {
    let Json::Object(_) = deprecated else {
        return match replaced_by {
            Json::Null | Json::Bool(false) => Json::Array(Vec::new()),
            Json::Number(n) if *n == 0.0 || n.is_nan() => Json::Array(Vec::new()),
            Json::String(text) if text.is_empty() => Json::Array(Vec::new()),
            other => other.clone(),
        };
    };
    let all = deprecated.get(b"replacedBy").and_then(Json::as_array);
    let name_of = |it: &Json, key: &[u8]| Some(it.get(key)?.get(b"name")?.as_str()?.to_vec());
    let names = all.unwrap_or_default().iter().map(|it| {
        let plugin = name_of(it, b"plugin").map(|it| [&shorthand(&it)[..], b"/"].concat());
        let rule = name_of(it, b"rule").unwrap_or_default();
        Json::String([plugin.unwrap_or_default(), rule].concat())
    });
    Json::Array(names.collect())
}

fn write_js(out: &mut Vec<u8>, rule: &js_plugin::Rule, (deprecated, replaced_by): &(Json, Json)) {
    out.extend_from_slice(b"{\"ruleId\":");
    json_stringify(&rule.id, out);
    out.extend_from_slice(b",\"replacedBy\":");
    write_json(out, &replacements(deprecated, replaced_by));
    if let Json::Object(_) = deprecated {
        out.extend_from_slice(b",\"info\":");
        write_json(out, deprecated);
    }
    out.push(b'}');
}

/// `JSON.stringify(result.usedDeprecatedRules)` for a file that has `config`.
pub(crate) fn write_used(out: &mut Vec<u8>, config: Option<&ResolvedConfig>) {
    out.push(b'[');
    let rules = config.map_or(&[][..], |config| &config.rules[..]);
    let mut js_rules = (config.map_or(&[][..], |config| &config.js_rules[..]).iter())
        .filter(|it| it.severity != Severity::Off)
        .filter_map(|it| {
            Some((
                it.position,
                &*it.configured.rule,
                it.configured.rule.deprecated.as_deref()?,
            ))
        })
        .peekable();
    let start = out.len();
    // In the order of the configuration.
    for position in 0..=rules.len() {
        while let Some((_, rule, deprecated)) = js_rules.next_if(|it| it.0 <= position) {
            if out.len() > start {
                out.push(b',');
            }
            write_js(out, rule, deprecated);
        }
        let Some(rule) = (rules.get(position))
            .filter(|it| it.severity != Severity::Off && it.entry.meta.is_deprecated)
        else {
            continue;
        };
        let id = RuleId::Known(rule.entry.meta).to_vec();
        let Ok(at) = data::DEPRECATED.binary_search_by(|it| it.0.as_bytes().cmp(&id[..])) else {
            continue;
        };
        if out.len() > start {
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
