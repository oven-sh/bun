//! ESLint's `usedDeprecatedRules`.

use bun_core::printer::json_stringify;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::js_plugin;
use bun_lint::linter::{
    Deprecated, Entry, ResolvedConfig, RuleId, deprecated_info, deprecated_rule, write_json,
};
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

fn write(out: &mut Vec<u8>, rule: &Deprecated) {
    let (id, rest) = (rule.0.as_bytes(), deprecated_info(rule));
    out.extend_from_slice(&[b"{\"ruleId\":\"", id, b"\",", rest, b"}"].concat());
}

/// `JSON.stringify(result.usedDeprecatedRules)` for a file that has `config`.
pub(crate) fn write_used(out: &mut Vec<u8>, config: Option<&ResolvedConfig>) {
    out.push(b'[');
    let start = out.len();
    for entry in config.into_iter().flat_map(ResolvedConfig::entries) {
        let before = out.len();
        if before > start {
            out.push(b',');
        }
        let separated = out.len();
        match entry {
            Entry::Native(rule)
                if rule.severity != Severity::Off && rule.entry.meta.is_deprecated =>
            {
                let id = RuleId::Known(rule.entry.meta).to_vec();
                let deprecated = deprecated_rule(&id);
                deprecated.into_iter().for_each(|it| write(out, it));
            }
            Entry::Js(rule) if rule.severity != Severity::Off => {
                let rule = &*rule.configured.rule;
                let deprecated = rule.deprecated.as_deref().into_iter();
                deprecated.for_each(|it| write_js(out, rule, it));
            }
            Entry::Formatting(rule) if rule.severity != Severity::Off => write(out, rule.rule),
            _ => {}
        }
        if out.len() == separated {
            out.truncate(before);
        }
    }
    out.push(b']');
}
