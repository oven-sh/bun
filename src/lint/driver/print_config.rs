//! `--print-config`

use bun_lint::language::{Global, Parser, SourceType};
use bun_lint::linter::{ResolvedConfig, RuleId, write_json, write_json_string};
use bun_lint::options::Json;

/// `JSON.stringify(value, null, "  ")`
pub(crate) fn write_indented(out: &mut Vec<u8>, value: &Json, depth: usize) {
    let new_line = |out: &mut Vec<u8>, depth: usize| {
        out.push(b'\n');
        out.resize(out.len() + depth * 2, b' ');
    };
    match value {
        Json::Array(items) if !items.is_empty() => {
            out.push(b'[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                new_line(out, depth + 1);
                write_indented(out, item, depth + 1);
            }
            new_line(out, depth);
            out.push(b']');
        }
        Json::Object(entries) if !entries.is_empty() => {
            out.push(b'{');
            for (i, (key, item)) in entries.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                new_line(out, depth + 1);
                write_json_string(out, key);
                out.extend_from_slice(b": ");
                write_indented(out, item, depth + 1);
            }
            new_line(out, depth);
            out.push(b'}');
        }
        value => write_json(out, value),
    }
}

pub(crate) fn text(text: &[u8]) -> Json {
    Json::String(text.to_vec())
}

pub(crate) fn object(entries: Vec<(&[u8], Json)>) -> Json {
    Json::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_vec(), value))
            .collect(),
    )
}

/// What ESLint prints for a file that has `config`, but for the default options of the rules, which
/// ESLint fills in. `None`: the file is not linted.
pub(crate) fn print(config: Option<&ResolvedConfig>) -> Vec<u8> {
    let Some(config) = config else {
        return b"undefined".to_vec();
    };
    let number = |n: u32| Json::Number(f64::from(n));
    let mut linter_options = Vec::new();
    if config.linter.no_inline_config {
        linter_options.push((&b"noInlineConfig"[..], Json::Bool(true)));
    }
    linter_options.push((
        b"reportUnusedDisableDirectives",
        number(config.linter.report_unused_disable_directives as u32),
    ));
    if config.linter.report_unused_inline_configs as u32 != 0 {
        linter_options.push((
            b"reportUnusedInlineConfigs",
            number(config.linter.report_unused_inline_configs as u32),
        ));
    }
    let rules = config.rules.iter().map(|rule| {
        let mut setting = vec![number(rule.severity as u32)];
        setting.extend(rule.options.iter().cloned());
        (
            RuleId::Known(rule.entry.meta).to_vec(),
            Json::Array(setting),
        )
    });
    let js_rules = config.js_rules.iter().map(|rule| {
        let mut setting = vec![number(rule.severity as u32)];
        setting.extend(rule.options.iter().cloned());
        (rule.configured.rule.id.to_vec(), Json::Array(setting))
    });
    let mut plugins = vec![text(b"@")];
    let of_rules = config.rules.iter().map(|it| it.entry.meta.plugin);
    for prefix in config
        .plugins
        .clone()
        .unwrap_or_else(|| of_rules.collect())
        .iter()
        .map(|it| text(it.prefix().as_bytes()))
    {
        if prefix != text(b"") && !plugins.contains(&prefix) {
            plugins.push(prefix);
        }
    }
    plugins.extend(config.foreign_plugins.iter().map(|it| text(it)));
    if !config.printed_plugins.is_empty() {
        plugins.truncate(1);
        plugins.extend(config.printed_plugins.iter().map(|it| text(it)));
    }
    let language = &config.language;
    let mut language_options = vec![
        (
            &b"sourceType"[..],
            text(match language.source_type {
                SourceType::Module => b"module",
                SourceType::Script => b"script",
                SourceType::CommonJs => b"commonjs",
            }),
        ),
        (b"ecmaVersion", number(language.ecma_version)),
        (
            b"parser",
            text(match language.parser {
                Parser::Espree => b"espree",
                Parser::TypeScript => b"typescript-eslint/parser",
                Parser::Other => b"unknown",
            }),
        ),
        (
            b"parserOptions",
            if matches!(language.parser_options, Json::Null) {
                object(Vec::new())
            } else {
                language.parser_options.clone()
            },
        ),
    ];
    if !language.globals.is_empty() {
        let globals = language.globals.iter().map(|(name, global)| {
            let value: &[u8] = match global {
                Global::Readonly => b"readonly",
                Global::Writable => b"writable",
                Global::Off => b"off",
            };
            (name.to_vec(), text(value))
        });
        language_options.push((b"globals", Json::Object(globals.collect())));
    }
    let mut all = vec![(&b"linterOptions"[..], object(linter_options))];
    if !matches!(language.settings, Json::Null) {
        all.push((b"settings", language.settings.clone()));
    }
    all.push((b"rules", Json::Object(rules.chain(js_rules).collect())));
    all.push((b"plugins", Json::Array(plugins)));
    all.push((
        b"language",
        text(config.language_name.as_deref().unwrap_or(b"@/js")),
    ));
    all.push((b"languageOptions", object(language_options)));
    if let Some(processor) = &config.processor {
        all.push((b"processor", text(processor)));
    }
    let mut out = Vec::new();
    write_indented(&mut out, &object(all), 0);
    out
}
