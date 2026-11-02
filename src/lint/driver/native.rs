//! Rule settings for projects with no ESLint or oxlint config ("native mode"). They come from `[lint]` in bunfig.toml
//! and from `--rule`. Every built-in rule is available under any of its names, and an unknown name is an error.
//! `react/*` is a wildcard that turns off every rule of a plugin. See [`expand_wildcards`].

use crate::bunfig::BunfigRule;
use crate::cli::{Options, Wildcard};
use crate::configs::{CATEGORIES, is_category, plugin_longhand, severity_name};
use crate::print_config::object;
use crate::{Linter, fs, paths};
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::js_plugin::Plugin as JsPlugin;
use bun_lint::linter::{
    Missing, NamedPlugin, Registry, RuleId, Step, mistake_in_options, oxlint_category,
    parse_rule_id, severity_of, write_json,
};
use bun_lint::options::Json;
use bun_lint::rule::{Frameworks, Meta, Plugin};

/// An invalid rule setting, or a plugin that can't be used.
pub(crate) struct Mistake {
    /// The text printed after `error: `.
    pub(crate) message: Vec<u8>,
    /// Byte offset in the bunfig. `None` if it came from the command line.
    at: Option<usize>,
}

impl Mistake {
    pub(crate) fn new(message: Vec<u8>, at: Option<usize>) -> Mistake {
        Mistake { message, at }
    }

    /// Formats the error like Bun's other errors, with a code frame from `bunfig` ([`Options::bunfig`]).
    pub(crate) fn print(&self, cwd: &[u8], bunfig: &[u8], colors: bool) -> Vec<u8> {
        let text = fs::read(&paths::resolve(cwd, bunfig)).unwrap_or_default();
        let text = strings::without_utf8_bom(&text);
        let location = self.at.and_then(|at| {
            let before = text.get(..at)?;
            let start = strings::last_index_of_char(before, b'\n').map_or(0, |it| it + 1);
            let line = text.get(start..)?;
            let end = strings::index_of_char_usize(line, b'\n').unwrap_or(line.len());
            Some(bun_ast::Location {
                file: bunfig.to_vec().into(),
                line: strings::count_char(before, b'\n') as i32 + 1,
                column: strings::utf8_decoded_len_utf16(before.get(start..)?) as i32 + 1,
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

/// Error message for `id`, which is `name` with `plugin`'s prefix, when the plugin has no such rule. It's printed after
/// `error: `.
fn unknown_plugin_rule(plugin: &JsPlugin, id: &[u8], name: &[u8]) -> Vec<u8> {
    let skipped = plugin.name.len() + 1;
    let closest = (plugin.rules.iter())
        .map(|it| {
            (
                strings::edit_distance(
                    name.iter().copied(),
                    it.id.get(skipped..).unwrap_or_default(),
                ),
                &it.id,
            )
        })
        .min_by_key(|it| it.0)
        .filter(|it| it.0 <= name.len().max(3) / 3);
    let mut message = [b"Unknown rule \"", id, b"\"\n  "].concat();
    match closest {
        Some((_, closest)) => message.extend([b"Did you mean \"", &closest[..], b"\"?"].concat()),
        None => message.extend(
            [
                b"The plugin \"",
                &plugin.name[..],
                b"\" has no rule by that name",
            ]
            .concat(),
        ),
    }
    message
}

/// Where an unknown rule name came from.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum NameSource {
    Bunfig,
    Flag,
    Explain,
}

/// Error message for `id`, which isn't the name of any rule. Goes after `error: `.
pub(crate) fn unknown_rule(registry: &Registry, id: &[u8], name_source: NameSource) -> Vec<u8> {
    let prefix = parse_rule_id(id).0;
    // A rule for JSON or Markdown. `--rules` lists it, but only an ESLint config can assign its language to files.
    if let Some(language) = registry.find(id).and_then(|it| it.meta.languages.first()) {
        return [
            b"\"",
            id,
            b"\" needs an ESLint config\n  Set language: \"",
            language.as_bytes(),
            b"\" for the files in an eslint.config.js",
        ]
        .concat();
    }
    match registry.why_missing(id) {
        Missing::Formatting => {
            [b"\"", id, b"\" is a formatting rule\n  bun fmt does that"].concat()
        }
        Missing::PluginHasNoRules(plugin) => [
            b"\"",
            id,
            b"\" is not supported\n  bun lint has no ",
            plugin.prefix().as_bytes(),
            b" rules. To run eslint-plugin-",
            plugin.prefix().as_bytes(),
            b", add it to plugins in [lint]",
        ]
        .concat(),
        Missing::Unknown(None) => {
            // `react` is also a name for the rules of react-hooks.
            let has_exact_prefix = |it: &Plugin| it.prefix().as_bytes() == prefix;
            let built_in = (Plugin::spelled(prefix).find(has_exact_prefix))
                .or_else(|| Plugin::spelled(prefix).next());
            let hint: Vec<u8> = match (built_in, name_source) {
                _ if prefix.is_empty() => Vec::new(),
                // These rules don't come from a package.
                (Some(Plugin::Eslint | Plugin::Oxc), _) => Vec::new(),
                (Some(plugin), _) if plugin.is_always_available() => Vec::new(),
                (Some(_), NameSource::Explain) => Vec::new(),
                (Some(plugin), _) => {
                    let package = plugin.prefix().as_bytes();
                    let package = plugin_longhand(package).unwrap_or_else(|| package.to_vec());
                    let parts: [&[u8]; 7] = [
                        b"\n  ",
                        prefix,
                        b" is built in and has no rule of that name\n  To run a rule of the package, load it under another name in [lint]: plugins = [{ name = \"",
                        prefix,
                        b"-js\", specifier = \"",
                        &package,
                        b"\" }]",
                    ];
                    parts.concat()
                }
                (None, NameSource::Bunfig) => {
                    b"\n  To use a rule from an ESLint plugin, add the plugin to plugins in [lint]".to_vec()
                }
                (None, NameSource::Flag) => {
                    b"\n  To use a rule from an ESLint plugin, load the plugin with --plugin".to_vec()
                }
                // Loaded or not, a plugin's rules are documented by the plugin itself.
                (None, NameSource::Explain) => {
                    b"\n  --explain has the built-in rules. For a rule from a plugin, see the plugin's docs".to_vec()
                }
            };
            [b"Unknown rule \"", id, b"\"", &hint[..]].concat()
        }
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

/// Error message for `invalid_value`, which isn't a valid severity. `rule` is the rule or category it was set for.
pub(crate) fn invalid_severity(rule: &[u8], invalid_value: &Json) -> Vec<u8> {
    let mut message = Vec::new();
    write_json(&mut message, invalid_value);
    message.extend_from_slice(b" is not a valid severity for ");
    message.extend_from_slice(rule);
    message.extend_from_slice(b"\n  Expected \"off\", \"warn\", or \"error\"");
    message
}

/// Returns the first mistake in `[lint.rules]`, `--rule`, `-A` / `-W` / `-D` or the `rules` of `[[lint.overrides]]`: an
/// unknown rule, an invalid severity, or options the rule doesn't accept. Turning off a rule that Bun left out on
/// purpose is fine. `plugins` holds the loaded JavaScript plugins. `only_plugin_rules` is set if there's a config file,
/// whose tool has its own messages for the other rules. `Some(true)` means the tool is ESLint, which doesn't validate a
/// rule that's off.
pub(crate) fn check_rules(
    linter: &Linter,
    options: &Options,
    plugins: &[NamedPlugin],
    only_plugin_rules: Option<bool>,
) -> Result<(), Mistake> {
    let check = |rules: &[(Vec<u8>, Json)], rule_locations: &[BunfigRule]| {
        check(linter, plugins, rules, rule_locations, only_plugin_rules)
    };
    let filters = options.filters.iter().filter(|it| !is_category(&it.1));
    let filters: Vec<(Vec<u8>, Json)> = filters
        .map(|(severity, rule)| (rule.clone(), severity_name(*severity)))
        .collect();
    check(&filters, &[])?;
    check(&options.rule, &options.bunfig_rules)?;
    for it in &options.overrides {
        check(&it.rules, &it.rule_locations)?;
    }
    if only_plugin_rules.is_some() {
        return Ok(());
    }
    let override_wildcards = options.overrides.iter().flat_map(|it| &it.wildcards);
    let mut wildcards = options.wildcards.iter().chain(override_wildcards);
    wildcards.try_for_each(|it| check_wildcard(linter.registry(), plugins, it))
}

/// Returns a mistake if `wildcard` names a plugin that doesn't exist. Turning off a plugin that Bun left out on purpose is
/// fine, like turning off one of its rules.
fn check_wildcard(
    registry: &Registry,
    js_plugins: &[NamedPlugin],
    wildcard: &Wildcard,
) -> Result<(), Mistake> {
    let (id, plugin) = (&wildcard.id[..], wildcard.plugin());
    let is_intentionally_missing = !matches!(registry.why_missing(id), Missing::Unknown(_));
    if is_intentionally_missing || !rules_of_plugin(registry, js_plugins, plugin).is_empty() {
        return Ok(());
    }
    let message = match similar_plugin(registry, js_plugins, plugin) {
        Some(similar) => {
            let hint = [b"Did you mean \"", similar, b"/*\"?"].concat();
            [b"Unknown plugin \"", plugin, b"\"\n  ", &hint].concat()
        }
        None => {
            let name_source = wildcard
                .key_at
                .map_or(NameSource::Flag, |_| NameSource::Bunfig);
            unknown_rule(registry, id, name_source)
        }
    };
    Err(Mistake::new(message, wildcard.key_at))
}

/// `rule_locations` has the bunfig.toml locations of the first `rule_locations.len()` rules. The rest came from
/// `--rule`.
fn check(
    linter: &Linter,
    plugins: &[NamedPlugin],
    rules: &[(Vec<u8>, Json)],
    rule_locations: &[BunfigRule],
    only_plugin_rules: Option<bool>,
) -> Result<(), Mistake> {
    let registry = linter.registry();
    for (at, (id, setting)) in rules.iter().enumerate() {
        // `--rule` may have replaced this entry, so its bunfig.toml location no longer applies.
        let rule_location = rule_locations.get(at);
        let rule_location = rule_location.filter(|it| it.setting.as_ref() == Some(setting));
        let parts: &[Json] = match setting {
            Json::Array(items) => items,
            setting => std::slice::from_ref(setting),
        };
        let severity = parts.first().and_then(severity_of);
        let invalid_severity = || {
            let severity_location =
                rule_location.map(|it| it.offsets.items.first().unwrap_or(&it.offsets));
            Mistake {
                message: invalid_severity(id, parts.first().unwrap_or(&Json::Null)),
                at: severity_location.map(|it| it.at),
            }
        };
        let (prefix, name) = parse_rule_id(id);
        if let Some((plugin, _)) = plugins.iter().find(|it| *it.0.name == *prefix) {
            let Some(rule) = plugin.rule(name) else {
                if only_plugin_rules == Some(true) && severity == Some(Severity::Off) {
                    continue;
                }
                return Err(Mistake {
                    message: unknown_plugin_rule(plugin, id, name),
                    at: rule_location.map(|it| it.key_at),
                });
            };
            let given = parts.get(1..).unwrap_or_default();
            match severity {
                None => return Err(invalid_severity()),
                Some(Severity::Off) => continue,
                Some(_) => match rule.validate(given) {
                    Ok(()) => continue,
                    Err(lines) => {
                        // ESLint indents with tabs.
                        let lines: Vec<u8> = (strings::trim(&lines, b"\n").iter())
                            .flat_map(|it| {
                                if *it == b'\t' {
                                    &b"  "[..]
                                } else {
                                    std::slice::from_ref(it)
                                }
                            })
                            .copied()
                            .collect();
                        return Err(Mistake {
                            message: [b"Invalid options for ", &id[..], b"\n", &lines].concat(),
                            at: rule_location.map(|it| it.offsets.find(&[Step::Index(1)], false)),
                        });
                    }
                },
            }
        }
        if only_plugin_rules.is_some() {
            continue;
        }
        let found = registry.find_by_any_name(id);
        if found.or_else(|| registry.base_of(id)).is_none() {
            let is_intentionally_missing = !matches!(registry.why_missing(id), Missing::Unknown(_));
            if is_intentionally_missing && severity == Some(Severity::Off) {
                continue;
            }
            return Err(Mistake {
                message: unknown_rule(
                    registry,
                    id,
                    rule_location.map_or(NameSource::Flag, |_| NameSource::Bunfig),
                ),
                at: rule_location.map(|it| it.key_at),
            });
        }
        let Some(severity) = severity else {
            return Err(invalid_severity());
        };
        let given = parts.get(1..).unwrap_or_default();
        let entry = found.filter(|_| severity != Severity::Off);
        // Options are valid for a pair if either rule accepts them.
        let mistake = entry.and_then(|it| match registry.pair_of(it.meta) {
            Some((base, extension)) => mistake_in_options(base.meta, id, given)
                .and_then(|_| mistake_in_options(extension.meta, id, given)),
            None => mistake_in_options(it.meta, id, given),
        });
        if let Some(mistake) = mistake {
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
                at: rule_location.map(|it| it.offsets.find(&path, mistake.is_about_key)),
            });
        }
        // Some errors get past the schema, like an invalid selector or regular expression.
        if let Some(Err(thrown)) = entry.map(|it| linter.validate(it, given)) {
            return Err(Mistake {
                message: [b"Invalid options for ", &id[..], b"\n  ", &thrown].concat(),
                at: rule_location.map(|it| it.offsets.find(&[Step::Index(1)], false)),
            });
        }
    }
    Ok(())
}

/// Returns the severity that `[lint.categories]` sets for rules in oxlint's `category`.
fn severity_in(options: &Options, category: &[u8]) -> Option<Severity> {
    let is_about =
        |name: &[u8]| name == category || name == b"all" && CATEGORIES.contains(&category);
    let mut latest_first = options.filters.iter().rev();
    latest_first.find(|it| is_about(&it.1)).map(|it| it.0)
}

const TYPESCRIPT: &[u8] = b"**/*.{ts,mts,cts,tsx}";

/// Controls whether TypeScript files get type information in this run.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Types {
    /// `--type-aware`, `typeAware = true` or `--type-check`.
    On,
    /// `--no-type-aware` or `typeAware = false`.
    Off,
    /// Neither flag was given, so files are type checked only if a rule that needs types is on. Naming the core rule of a
    /// pair doesn't count. It isn't worth a type check on its own.
    WhenNeeded,
}

/// Returns true if `object` turns on a rule that needs types, under that rule's own name.
fn turns_on_typed_rule(registry: &Registry, object: &Json) -> bool {
    let rules = object.get(b"rules").and_then(Json::as_object);
    rules.unwrap_or_default().iter().any(|(name, setting)| {
        let severity = match setting {
            Json::Array(items) => items.first().and_then(severity_of),
            setting => severity_of(setting),
        };
        let needs_types = registry
            .find_by_any_name(name)
            .is_some_and(|it| it.meta.requires_types);
        needs_types && severity.is_some_and(|it| it != Severity::Off)
    })
}

/// Makes a core rule and its typescript-eslint version ([`Registry::pair_of`]) behave as one rule, so a problem is never
/// reported twice. Setting either name sets both. The core rule runs on JavaScript and the typescript-eslint version on
/// TypeScript. If a config object sets both names, each one applies to its own language.
///
/// The core rule also runs on TypeScript if only it accepts the options, or if the typescript-eslint version needs type
/// information and won't get it. See [`Types`].
pub(crate) fn split_pairs(registry: &Registry, objects: Vec<Json>, types: Types) -> Vec<Json> {
    let id = |meta: &'static Meta| RuleId::Known(meta).to_vec();
    let off = || severity_name(Severity::Off);
    let has_types = match types {
        Types::On => true,
        Types::Off => false,
        Types::WhenNeeded => objects.iter().any(|it| turns_on_typed_rule(registry, it)),
    };
    let mut split = Vec::with_capacity(objects.len());
    for object in objects {
        let rules = object.get(b"rules").and_then(Json::as_object);
        // The two rules of each pair, and the setting found under each name.
        let mut pairs: Vec<([&'static Meta; 2], [Option<&Json>; 2])> = Vec::new();
        let mut everywhere = Vec::new();
        for (name, setting) in rules.unwrap_or_default() {
            let found = registry.find_by_any_name(name);
            let Some((base, extension)) = found.and_then(|it| registry.pair_of(it.meta)) else {
                everywhere.push((name.clone(), setting.clone()));
                continue;
            };
            let is_extension = found.is_some_and(|it| it.meta.plugin == Plugin::TypeScript);
            let pair_settings = match is_extension {
                true => [None, Some(setting)],
                false => [Some(setting), None],
            };
            match pairs.iter_mut().find(|it| it.0[0].name == base.meta.name) {
                Some(pair) => {
                    pair.1 = [
                        pair_settings[0].or(pair.1[0]),
                        pair_settings[1].or(pair.1[1]),
                    ]
                }
                None => pairs.push(([base.meta, extension.meta], pair_settings)),
            }
        }
        if pairs.is_empty() {
            split.push(object);
            continue;
        }
        let mut in_typescript = Vec::new();
        for ([base, extension], [base_setting, extension_setting]) in pairs {
            let (Some(for_javascript), Some(for_typescript)) = (
                base_setting.or(extension_setting),
                extension_setting.or(base_setting),
            ) else {
                continue;
            };
            everywhere.push((id(base), for_javascript.clone()));
            everywhere.push((id(extension), off()));
            let given = for_typescript.as_array().and_then(|it| it.get(1..));
            let accepts_options =
                |it| mistake_in_options(it, b"", given.unwrap_or_default()).is_none();
            let can_run = has_types || !extension.requires_types;
            let (runs, rests) =
                match can_run && (accepts_options(extension) || !accepts_options(base)) {
                    true => (extension, base),
                    false => (base, extension),
                };
            // Leave a typed rule on if the user asked for it by name. It can't run, but the "Skipped" warning counts it.
            let is_skipped = !can_run && extension_setting.is_some();
            in_typescript.push((
                id(rests),
                if is_skipped {
                    for_typescript.clone()
                } else {
                    off()
                },
            ));
            in_typescript.push((id(runs), for_typescript.clone()));
        }
        let typescript = || Json::String(TYPESCRIPT.to_vec());
        let files = match object.get(b"files").and_then(Json::as_array) {
            Some(files) => (files.iter())
                .map(|it| match it {
                    Json::Array(all) => all.iter().cloned().chain([typescript()]).collect(),
                    one => vec![one.clone(), typescript()],
                })
                .map(Json::Array)
                .collect(),
            None => vec![typescript()],
        };
        let mut second = vec![(&b"files"[..], Json::Array(files))];
        for key in [&b"ignores"[..], b"basePath", b"$globsOfBun", b"$framework"] {
            second.extend(object.get(key).map(|it| (key, it.clone())));
        }
        second.push((b"rules", Json::Object(in_typescript)));
        let Some(mut first) = object.into_object() else {
            continue;
        };
        first.retain(|it| it.0 != b"rules");
        first.push((b"rules".to_vec(), Json::Object(everywhere)));
        split.push(Json::Object(first));
        split.push(crate::print_config::object(second));
    }
    split
}

/// Returns every built-in rule available in native mode, with the ID it's reported under.
fn native_rules(registry: &Registry) -> impl Iterator<Item = (&'static Meta, Vec<u8>)> {
    let all = registry.all().iter().map(|it| it.meta);
    let with_id = all.map(|meta| (meta, RuleId::Known(meta).to_vec()));
    // Some rules exist twice. Native mode uses the ESLint plugin's version and hides the other one.
    with_id.filter(|(meta, id)| registry.names_of(meta).id == *id)
}

/// Converts `[lint.categories]` to config objects. They go after the defaults and before `[lint.rules]`.
/// typescript-eslint rules only apply to TypeScript files. Rules of a framework plugin ([`Plugin::framework`]) only apply in
/// projects that use the framework. Pass the result through [`split_pairs`].
pub(crate) fn categories(registry: &Registry, options: &Options) -> Vec<Json> {
    if !options.filters.iter().any(|it| is_category(&it.1)) {
        return Vec::new();
    }
    let (mut everywhere, mut in_typescript) = (Vec::new(), Vec::new());
    let mut by_framework = Frameworks::PACKAGES.map(|(package, flag)| (package, flag, Vec::new()));
    for (meta, id) in native_rules(registry) {
        let category = oxlint_category(meta.plugin, meta.name);
        let Some(severity) = category.and_then(|it| severity_in(options, it.as_bytes())) else {
            continue;
        };
        let framework = meta.plugin.framework();
        let rules = match by_framework.iter_mut().find(|it| it.1 == framework) {
            Some((_, _, rules)) => rules,
            None if meta.plugin == Plugin::TypeScript => &mut in_typescript,
            None => &mut everywhere,
        };
        rules.push((id, severity_name(severity)));
    }
    let typescript = Json::Array(vec![Json::String(TYPESCRIPT.to_vec())]);
    let mut objects = vec![
        object(vec![(b"rules", Json::Object(everywhere))]),
        object(vec![
            (b"files", typescript),
            (b"rules", Json::Object(in_typescript)),
        ]),
    ];
    for (package, _, rules) in by_framework {
        objects.push(object(vec![
            (b"$framework", Json::String(package.into())),
            (b"rules", Json::Object(rules)),
        ]));
    }
    objects
}

/// Returns the IDs of all rules in the plugin named `prefix`: a loaded JavaScript plugin, or a built-in one under any
/// of its spellings. Empty if there's no such plugin.
fn rules_of_plugin(registry: &Registry, js_plugins: &[NamedPlugin], prefix: &[u8]) -> Vec<Vec<u8>> {
    if let Some((plugin, _)) = js_plugins.iter().find(|it| *it.0.name == *prefix) {
        return plugin.rules.iter().map(|it| it.id.to_vec()).collect();
    }
    // `react/rules-of-hooks` is accepted as a name for the react-hooks rule, but `react/*` covers only
    // eslint-plugin-react.
    let own = Plugin::spelled(prefix).find(|it| it.prefix().as_bytes() == prefix);
    let is_in_plugin = |meta: &Meta| match own {
        Some(own) => meta.plugin == own,
        None => Plugin::spelled(prefix).any(|it| it == meta.plugin),
    };
    // `react/jsx-uses-react` reports nothing. It keeps `no-unused-vars` quiet about `React`, so turning it off adds reports.
    let rules = native_rules(registry).filter(|it| it.1 != b"react/jsx-uses-react");
    rules
        .filter(|it| is_in_plugin(it.0))
        .map(|it| it.1)
        .collect()
}

/// Returns the plugin name closest to `prefix`, for a "Did you mean" hint. `None` if nothing is close.
fn similar_plugin<'a>(
    registry: &Registry,
    js_plugins: &'a [NamedPlugin],
    prefix: &[u8],
) -> Option<&'a [u8]> {
    let built_in = native_rules(registry).flat_map(|(meta, _)| meta.plugin.spellings());
    let names = (built_in.map(|it| it.as_bytes())).chain(js_plugins.iter().map(|it| &*it.0.name));
    // ESLint's own rules have no prefix.
    let names = names.filter(|it| !it.is_empty());
    let distance = |name: &[u8]| strings::edit_distance(prefix.iter().copied(), name);
    let closest = names.map(|it| (distance(it), it)).min_by_key(|it| it.0);
    (closest.filter(|it| it.0 <= prefix.len().max(3) / 3)).map(|it| it.1)
}

/// Returns the first wildcard in `[lint.rules]`, `[[lint.overrides]]`, `--rule` or `-A`.
pub(crate) fn first_wildcard(options: &Options) -> Option<&Wildcard> {
    let override_wildcards = options.overrides.iter().flat_map(|it| &it.wildcards);
    options.wildcards.iter().chain(override_wildcards).next()
}

/// Config object key for the IDs of its [`Wildcard`]s. [`expand_wildcards`] replaces it.
pub(crate) const WILDCARDS: &[u8] = b"$wildcards";

/// Moves the [`WILDCARDS`] of each config object into a new object that turns off every rule of those plugins. The new
/// object matches the same files and goes first, so the single rules of the original object override it.
///
/// Call after [`split_pairs`]. A wildcard covers one plugin, so `"@typescript-eslint/*"` must not turn `no-unused-vars`
/// off in JavaScript files, which naming `@typescript-eslint/no-unused-vars` does.
pub(crate) fn expand_wildcards(
    registry: &Registry,
    js_plugins: &[NamedPlugin],
    objects: Vec<Json>,
) -> Vec<Json> {
    let selects_files = |key: &[u8]| {
        let keys: [&[u8]; 5] = [
            b"files",
            b"ignores",
            b"basePath",
            b"$globsOfBun",
            b"$framework",
        ];
        keys.contains(&key)
    };
    let mut expanded = Vec::with_capacity(objects.len());
    for mut object in objects {
        let entries = match &mut object {
            Json::Object(entries) => entries,
            _ => &mut Vec::new(),
        };
        let Some(at) = entries.iter().position(|it| it.0 == WILDCARDS) else {
            expanded.push(object);
            continue;
        };
        let wildcards = entries.remove(at).1;
        let ids = wildcards.as_array().unwrap_or_default().iter();
        let plugins = ids.filter_map(|it| Wildcard::plugin_of(it.as_str()?));
        let rules = plugins.flat_map(|it| rules_of_plugin(registry, js_plugins, it));
        let rules = rules.map(|id| (id, severity_name(Severity::Off)));
        let mut turned_off: Vec<_> =
            (entries.iter().filter(|it| selects_files(&it.0)).cloned()).collect();
        turned_off.push((b"rules".to_vec(), Json::Object(rules.collect())));
        expanded.push(Json::Object(turned_off));
        expanded.push(object);
    }
    expanded
}
