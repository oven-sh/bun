//! What `[lint]` of bunfig.toml and the command line say about rules where neither ESLint nor oxlint has a configuration.
//! Every rule that is built in can be named, by any of its names, and a name of no rule is a mistake.

use crate::cli::Options;
use crate::configs::{CATEGORIES, is_category};
use crate::print_config::object;
use crate::run::Fatal;
use bun_lint::context::Severity;
use bun_lint::linter::{Missing, Registry, RuleId, oxlint_category, severity_of};
use bun_lint::options::Json;
use bun_lint::rule::{Meta, Plugin};

/// What is wrong with `id`, the name of no rule: what follows `error: `. `place`: where it is written.
pub(crate) fn unknown_rule(registry: &Registry, id: &[u8], place: Option<&[u8]>) -> Vec<u8> {
    let place = place.map_or_else(Vec::new, |it| [b" in ", it].concat());
    match registry.why_missing(id) {
        Missing::Formatting => [
            b"\"",
            id,
            b"\"",
            &place,
            b" is a formatting rule\n  bun format does that",
        ]
        .concat(),
        Missing::OfPluginWithoutRules(plugin) => [
            b"\"",
            id,
            b"\"",
            &place,
            b" is not supported\n  bun lint has no ",
            plugin.prefix().as_bytes(),
            b" rules",
        ]
        .concat(),
        Missing::Unknown(None) => [b"Unknown rule \"", id, b"\"", &place].concat(),
        Missing::Unknown(Some(close)) => [
            b"Unknown rule \"",
            id,
            b"\"",
            &place,
            b"\n  Did you mean \"",
            &close,
            b"\"?",
        ]
        .concat(),
    }
}

/// Fails at the first name in `[lint.rules]` or after `--rule` that is the name of no rule. To turn off what was left out on
/// purpose asks for nothing.
pub(crate) fn check_rules(registry: &Registry, options: &Options) -> Result<(), Fatal> {
    for (at, (id, setting)) in options.rule.iter().enumerate() {
        if registry.find_by_any_name(id).is_some() || registry.base_of(id).is_some() {
            continue;
        }
        let severity = match setting {
            Json::Array(items) => items.first().and_then(severity_of),
            setting => severity_of(setting),
        };
        let is_a_mistake = matches!(registry.why_missing(id), Missing::Unknown(_));
        if is_a_mistake || severity != Some(Severity::Off) {
            let place: &[u8] = match at < options.rules_of_bunfig {
                true => b"bunfig.toml",
                false => b"--rule",
            };
            return Err(Fatal(unknown_rule(registry, id, Some(place))));
        }
    }
    Ok(())
}

/// What `[lint.categories]` says about a rule that oxlint has in `category`.
fn severity_in(options: &Options, category: &[u8]) -> Option<Severity> {
    let is_about =
        |name: &[u8]| name == category || name == b"all" && CATEGORIES.contains(&category);
    let mut said = options.filters.iter().rev();
    said.find(|it| is_about(&it.1)).map(|it| it.0)
}

/// `[lint.categories]` as configuration objects, which come after what is on without a word and before `[lint.rules]`. The rules of
/// typescript-eslint are for TypeScript, where its extension of a rule of ESLint stands in for that.
pub(crate) fn categories(registry: &Registry, options: &Options) -> Vec<Json> {
    if !options.filters.iter().any(|it| is_category(&it.1)) {
        return Vec::new();
    }
    let name = |severity: Severity| {
        Json::String(match severity {
            Severity::Off => b"off".to_vec(),
            Severity::Warn => b"warn".to_vec(),
            Severity::Error => b"error".to_vec(),
        })
    };
    let id = |meta: &'static Meta| RuleId::Known(meta).to_vec();
    let (mut everywhere, mut in_typescript) = (Vec::new(), Vec::new());
    for meta in registry.all().iter().map(|it| it.meta) {
        let is_hidden =
            (registry.find_by_any_name(&id(meta))).is_none_or(|it| it.meta.plugin != meta.plugin);
        let category = oxlint_category(meta.plugin, meta.name).filter(|_| !is_hidden);
        let Some(severity) = category.and_then(|it| severity_in(options, it.as_bytes())) else {
            continue;
        };
        if meta.plugin == Plugin::TypeScript {
            in_typescript.push((id(meta), name(severity)));
            continue;
        }
        everywhere.push((id(meta), name(severity)));
        let extension = registry.get_preferring(meta.plugin, meta.name.as_bytes(), true);
        if let Some(extension) = extension.filter(|it| it.meta.plugin != meta.plugin) {
            in_typescript.push((id(meta), name(Severity::Off)));
            in_typescript.push((id(extension.meta), name(severity)));
        }
    }
    let typescript = Json::Array(vec![Json::String(b"**/*.{ts,mts,cts,tsx}".to_vec())]);
    vec![
        object(vec![(b"rules", Json::Object(everywhere))]),
        object(vec![
            (b"files", typescript),
            (b"rules", Json::Object(in_typescript)),
        ]),
    ]
}
