//! What `[lint]` of bunfig.toml and the command line say about rules where neither ESLint nor oxlint has a configuration.
//! Every rule that is built in can be named, by any of its names, and a name of no rule is a mistake.

use crate::bunfig::RuleOfBunfig;
use crate::cli::Options;
use crate::configs::{CATEGORIES, is_category, severity_name};
use crate::print_config::object;
use crate::{Linter, fs, paths};
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::linter::{
    Missing, Registry, RuleId, Step, mistake_in_options, oxlint_category, severity_of, write_json,
};
use bun_lint::options::Json;
use bun_lint::rule::{Meta, Plugin};

/// What is wrong with what is said about a rule.
pub(crate) struct Mistake {
    /// What follows `error: `.
    pub(crate) message: Vec<u8>,
    /// Where it is in bunfig.toml, if it is there.
    at: Option<usize>,
}

impl Mistake {
    /// As Bun prints an error, with the line of the bunfig.toml of `cwd` that has it.
    pub(crate) fn print(&self, cwd: &[u8], colors: bool) -> Vec<u8> {
        let text = fs::read(&paths::join(cwd, b"bunfig.toml")).unwrap_or_default();
        let text = strings::without_utf8_bom(&text);
        let location = self.at.and_then(|at| {
            let before = text.get(..at)?;
            let start = strings::last_index_of_char(before, b'\n').map_or(0, |it| it + 1);
            let line = text.get(start..)?;
            let end = strings::index_of_char_usize(line, b'\n').unwrap_or(line.len());
            Some(bun_ast::Location {
                file: b"bunfig.toml".to_vec().into(),
                line: strings::count_char(before, b'\n') as i32 + 1,
                column: (at - start) as i32 + 1,
                line_text: Some(line.get(..end)?.to_vec().into()),
                ..Default::default()
            })
        });
        let message = bun_ast::Msg {
            kind: bun_ast::Kind::Err,
            data: bun_ast::Data {
                text: self.message.clone().into(),
                location,
            },
            ..Default::default()
        };
        let mut printed = String::new();
        let _ = match colors {
            true => message.write_format::<true>(&mut printed),
            false => message.write_format::<false>(&mut printed),
        };
        printed.push('\n');
        printed.into_bytes()
    }
}

/// What is wrong with `id`, the name of no rule: what follows `error: `.
pub(crate) fn unknown_rule(registry: &Registry, id: &[u8]) -> Vec<u8> {
    match registry.why_missing(id) {
        Missing::Formatting => [
            b"\"",
            id,
            b"\" is a formatting rule\n  bun format does that",
        ]
        .concat(),
        Missing::OfPluginWithoutRules(plugin) => [
            b"\"",
            id,
            b"\" is not supported\n  bun lint has no ",
            plugin.prefix().as_bytes(),
            b" rules",
        ]
        .concat(),
        Missing::Unknown(None) => [b"Unknown rule \"", id, b"\""].concat(),
        Missing::Unknown(Some(close)) => [
            b"Unknown rule \"",
            id,
            b"\"\n  Did you mean \"",
            &close,
            b"\"?",
        ]
        .concat(),
    }
}

/// What is wrong with `written`, which is where the severity of `rule`, or of a category, is expected.
pub(crate) fn invalid_severity(rule: &[u8], written: &Json) -> Vec<u8> {
    let mut message = Vec::new();
    write_json(&mut message, written);
    message.extend_from_slice(b" is not a valid severity for ");
    message.extend_from_slice(rule);
    message.extend_from_slice(b"\n  Expected \"off\", \"warn\", or \"error\"");
    message
}

/// The first mistake in `[lint.rules]`, after `--rule` and in the `rules` of `[[lint.overrides]]`: the name of no rule, no severity, options that the rule does not
/// take. To turn off what was left out on purpose asks for nothing.
pub(crate) fn check_rules(linter: &Linter, options: &Options) -> Result<(), Mistake> {
    check(linter, &options.rule, &options.rules_of_bunfig)?;
    let mut overrides = options.overrides.iter();
    overrides.try_for_each(|it| check(linter, &it.rules, &it.places))
}

/// `places`: for the first of `rules`, which are in bunfig.toml, where.
fn check(
    linter: &Linter,
    rules: &[(Vec<u8>, Json)],
    places: &[RuleOfBunfig],
) -> Result<(), Mistake> {
    let registry = linter.registry();
    for (at, (id, setting)) in rules.iter().enumerate() {
        // What `--rule` says about the same rule has taken its place.
        let written = places.get(at);
        let written = written.filter(|it| it.setting == *setting);
        let parts: &[Json] = match setting {
            Json::Array(items) => items,
            setting => std::slice::from_ref(setting),
        };
        let severity = parts.first().and_then(severity_of);
        let found = registry.find_by_any_name(id);
        if found.or_else(|| registry.base_of(id)).is_none() {
            let is_left_out = !matches!(registry.why_missing(id), Missing::Unknown(_));
            if is_left_out && severity == Some(Severity::Off) {
                continue;
            }
            return Err(Mistake {
                message: unknown_rule(registry, id),
                at: written.map(|it| it.key_at),
            });
        }
        let Some(severity) = severity else {
            let place = written.map(|it| it.place.items.first().unwrap_or(&it.place));
            return Err(Mistake {
                message: invalid_severity(id, parts.first().unwrap_or(&Json::Null)),
                at: place.map(|it| it.at),
            });
        };
        let given = parts.get(1..).unwrap_or_default();
        let entry = found.filter(|_| severity != Severity::Off);
        if let Some(mistake) = entry.and_then(|it| mistake_in_options(it.meta, id, given)) {
            let after_severity = mistake
                .path
                .iter()
                .enumerate()
                .map(|(depth, step)| match step {
                    Step::Index(index) if depth == 0 => Step::Index(index + 1),
                    step => step.clone(),
                });
            let path: Vec<Step> = after_severity.collect();
            return Err(Mistake {
                message: mistake.message,
                at: written.map(|it| it.place.find(&path, mistake.is_about_key)),
            });
        }
        // What no schema can tell: a selector or a regular expression that cannot be read.
        if let Some(Err(thrown)) = entry.map(|it| linter.validate(it, given)) {
            return Err(Mistake {
                message: [b"Invalid options for ", &id[..], b"\n  ", &thrown].concat(),
                at: written.map(|it| it.place.find(&[Step::Index(1)], false)),
            });
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
    let id = |meta: &'static Meta| RuleId::Known(meta).to_vec();
    let (mut everywhere, mut in_typescript) = (Vec::new(), Vec::new());
    for meta in registry.all().iter().map(|it| it.meta) {
        // Another rule stands in its place.
        let is_hidden = registry.names_of(meta).id != id(meta);
        let category = oxlint_category(meta.plugin, meta.name).filter(|_| !is_hidden);
        let Some(severity) = category.and_then(|it| severity_in(options, it.as_bytes())) else {
            continue;
        };
        if meta.plugin == Plugin::TypeScript {
            in_typescript.push((id(meta), severity_name(severity)));
            continue;
        }
        everywhere.push((id(meta), severity_name(severity)));
        let extension = registry.get_preferring(meta.plugin, meta.name.as_bytes(), true);
        if let Some(extension) = extension.filter(|it| it.meta.plugin != meta.plugin) {
            in_typescript.push((id(meta), severity_name(Severity::Off)));
            in_typescript.push((id(extension.meta), severity_name(severity)));
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
