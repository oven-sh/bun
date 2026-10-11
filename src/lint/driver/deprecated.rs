//! ESLint's `usedDeprecatedRules`.

use bun_core::printer::json_stringify;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::js_plugin;
use bun_lint::linter::{Deprecated, ResolvedConfig, RuleId, deprecated_rule, write_json};
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

fn write(out: &mut Vec<u8>, (id, rest): &Deprecated) {
    let (id, rest) = (id.as_bytes(), rest.as_bytes());
    out.extend_from_slice(&[b"{\"ruleId\":\"", id, b"\",", rest, b"}"].concat());
}

/// `JSON.stringify(result.usedDeprecatedRules)` for a file that has `config`.
pub(crate) fn write_used(out: &mut Vec<u8>, config: Option<&ResolvedConfig>) {
    out.push(b'[');
    let rules = config.into_iter().flat_map(ResolvedConfig::configured);
    let mut js_rules = (config.map_or(&[][..], |config| &config.js_rules[..]).iter())
        .enumerate()
        .filter(|it| it.1.severity != Severity::Off)
        .filter_map(|(at, it)| {
            Some((
                (it.position, at),
                &*it.configured.rule,
                it.configured.rule.deprecated.as_deref()?,
            ))
        })
        .peekable();
    let formatting_rules = config.map_or(&[][..], |config| &config.formatting_rules[..]);
    let mut formatting_rules = formatting_rules.iter().peekable();
    let start = out.len();
    let separate = |out: &mut Vec<u8>| {
        if out.len() > start {
            out.push(b',');
        }
    };
    // In the order of the configuration.
    for (position, rule) in rules.map(Some).chain([None]).enumerate() {
        loop {
            let about_layout = formatting_rules.next_if(|it| {
                it.position.0 <= position
                    && js_rules.peek().is_none_or(|js| js.0.1 >= it.position.1)
            });
            if let Some(about_layout) = about_layout {
                separate(out);
                write(out, about_layout.rule);
            } else if let Some((_, rule, deprecated)) = js_rules.next_if(|it| it.0.0 <= position) {
                separate(out);
                write_js(out, rule, deprecated);
            } else {
                break;
            }
        }
        if let Some(rule) =
            rule.filter(|it| it.severity != Severity::Off && it.entry.meta.is_deprecated)
            && let Some(deprecated) = deprecated_rule(&RuleId::Known(rule.entry.meta).to_vec())
        {
            separate(out);
            write(out, deprecated);
        }
    }
    out.push(b']');
}
