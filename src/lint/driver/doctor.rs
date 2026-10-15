//! `--doctor` tells someone coming from ESLint, oxlint, Prettier or oxfmt what to expect before they switch. It loads the
//! config and finds files the way a real run does, but it doesn't lint, format or write anything.
//!
//! To say what runs where, it asks the same code that decides in a real run: each file's [`ResolvedConfig`] and
//! [`Route`], and the plugins' [`Host`]. [`watching`] records which packages a config file needs while it loads.

mod packages;

use crate::cli::Options;
use crate::configs::{Flavor, Loaded, Loader, plugin_shorthand};
use crate::discover::{self, Status};
use crate::print_config::{object, text, write_indented};
use crate::run::{Environment, Fatal, Pool, Script};
use crate::{evaluate, paths};
use bstr::BStr;
use bun_lint::context::Severity;
use bun_lint::js_plugin::{self, Host, Route};
use bun_lint::linter::{FileConfig, ResolvedConfig, RuleId, parse_rule_id};
use bun_lint::options::Json;
use bun_sema::util::FxHashSet;
use bun_threading::Guarded;
pub(crate) use packages::{Need, Packages, is_for_formatting};
use std::io::Write;
use std::sync::Arc;

macro_rules! pretty {
    ($($arg:tt)*) => {
        let _ = bun_core::write_pretty!($($arg)*);
    };
}

/// How the report is printed.
#[derive(Copy, Clone)]
pub(crate) struct How {
    /// `-f json`
    pub(crate) as_json: bool,
    pub(crate) colors: bool,
}

/// Paths of the modules that were loaded while evaluating the config files.
#[derive(Default)]
pub(crate) struct Modules(Guarded<Vec<Vec<u8>>>);

impl Modules {
    /// The packages those modules belong to.
    pub(crate) fn packages(&self) -> Vec<Vec<u8>> {
        let modules = self.0.lock();
        let packages = modules.iter().filter_map(|it| package_of_file(it));
        sorted(packages.map(<[u8]>::to_vec).collect())
    }
}

/// Calls `run` with an [`Environment`] that records every module loaded by the scripts that evaluate config files.
pub(crate) fn watching<R>(
    environment: &Environment,
    run: impl FnOnce(&Environment, &Modules) -> R,
) -> R {
    let (modules, run_script) = (Modules::default(), environment.run_script);
    let watched = |script: &Script| {
        let printed = run_script(script)?;
        modules.0.lock().extend(evaluate::modules_in(&printed));
        Ok(printed)
    };
    let environment = Environment {
        cwd: environment.cwd.clone(),
        run_script: &watched,
        ..*environment
    };
    run(&environment, &modules)
}

pub(crate) fn sorted(mut names: Vec<Vec<u8>>) -> Vec<Vec<u8>> {
    bun_lint::utils::sort::sort_unstable(&mut names);
    names.dedup();
    names
}

/// The package that contains the file at `path`, if any.
fn package_of_file(path: &[u8]) -> Option<&[u8]> {
    let package = paths::package_of(path);
    (package.len() < path.len()).then_some(package)
}

pub(crate) fn texts(all: &[Vec<u8>]) -> Json {
    Json::Array(all.iter().map(|it| text(it)).collect())
}

/// File counts, grouped by extension.
#[derive(Default)]
pub(crate) struct Kinds(Vec<(Vec<u8>, usize)>);

impl Kinds {
    pub(crate) fn add(&mut self, path: &[u8]) {
        self.add_ending(crate::fmt::ending_of(path), 1);
    }

    /// Adds `count` files with the extension `ending`. For a file without a dot, `ending` is its whole name.
    pub(crate) fn add_ending(&mut self, ending: &[u8], count: usize) {
        let star: &[u8] = if ending.starts_with(b".") { b"*" } else { b"" };
        let kind = [star, ending].concat();
        match self.0.iter_mut().find(|it| it.0 == kind) {
            Some(known) => known.1 += count,
            None => self.0.push((kind, count)),
        }
    }

    pub(crate) fn count(&self) -> usize {
        self.0.iter().map(|it| it.1).sum()
    }

    /// Most frequent first.
    fn in_order(&self) -> Vec<&(Vec<u8>, usize)> {
        let mut all: Vec<_> = self.0.iter().collect();
        bun_lint::utils::sort::sort_by(&mut all, |a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        all
    }

    /// `2 *.md, 1 *.json`
    pub(crate) fn shown(&self) -> String {
        let all = self.in_order().into_iter();
        let all: Vec<String> = all
            .map(|it| format!("{} {}", it.1, BStr::new(&it.0)))
            .collect();
        all.join(", ")
    }

    pub(crate) fn json(&self) -> Json {
        let all = self.in_order().into_iter();
        Json::Object(
            all.map(|it| (it.0.clone(), Json::Number(it.1 as f64)))
                .collect(),
        )
    }
}

/// `   12 rules run natively`
pub(crate) fn write_count(out: &mut Vec<u8>, colors: bool, number: usize, what: &str) {
    pretty!(
        out,
        colors,
        "<b>{}<r> {}\n",
        format_args!("{number:>5}"),
        what
    );
}

/// Goes below a [`write_count`] line. Each row is a name followed by a number.
pub(crate) fn write_table(out: &mut Vec<u8>, colors: bool, rows: &[(Vec<u8>, usize)]) {
    let width = rows.iter().map(|it| it.0.len()).max().unwrap_or(0);
    for (name, number) in rows {
        let mut name = name.clone();
        name.resize(width, b' ');
        let number = format_args!("{number:>3}");
        pretty!(
            out,
            colors,
            "        <d>{}  {}<r>\n",
            BStr::new(&name),
            number
        );
    }
}

/// The warnings and advice a run prints besides its results.
pub(crate) fn write_notes(out: &mut Vec<u8>, colors: bool, notes: &[Vec<u8>]) {
    if !notes.is_empty() {
        out.push(b'\n');
    }
    for note in notes {
        pretty!(out, colors, "<blue>note<r><d>:<r> {}\n", BStr::new(note));
    }
}

/// Why a rule that's turned on doesn't run.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Reason {
    /// It isn't built in, and none of the config's plugins has it.
    NotSupported,
    /// Same, but for an ESLint 8 config. ESLint 8 reports the missing definition in every file.
    NotDefined,
    /// `bun fmt` does its job.
    Formatting,
    /// It needs types, and nothing turned them on.
    NeedsTypes,
}

impl Reason {
    fn key(self) -> &'static [u8] {
        match self {
            Reason::NotSupported => b"not_supported",
            Reason::NotDefined => b"not_defined",
            Reason::Formatting => b"formatting",
            Reason::NeedsTypes => b"needs_types",
        }
    }

    /// Printed after the number of rules, `count`.
    fn shown(self, count: usize) -> &'static str {
        match (self, count) {
            (Reason::NotSupported, 1) => "is not supported",
            (Reason::NotSupported, _) => "are not supported",
            (Reason::NotDefined, 1) => "is not defined by any plugin",
            (Reason::NotDefined, _) => "are not defined by any plugin",
            (Reason::Formatting, 1) => "is a formatting rule, use bun fmt",
            (Reason::Formatting, _) => "are formatting rules, use bun fmt",
            (Reason::NeedsTypes, 1) => "needs types, use --type-aware",
            (Reason::NeedsTypes, _) => "need types, use --type-aware",
        }
    }

    /// True if not running these rules loses nothing, so the report only names a few. `-f json` lists them all.
    fn is_harmless(self) -> bool {
        matches!(self, Reason::Formatting | Reason::NeedsTypes)
    }
}

/// Every rule that's on for at least one file the run would lint.
#[derive(Default)]
struct Rules {
    /// IDs as they appear in reports.
    native: Vec<Vec<u8>>,
    javascript: Vec<Arc<js_plugin::Rule>>,
    not_run: Vec<(Reason, Vec<u8>)>,
    /// At least one rule needs types and gets them.
    has_types: bool,
}

impl Rules {
    /// `wants_types` says whether rules that need types run under `config`.
    #[optimize(size)]
    fn add(&mut self, config: &ResolvedConfig, wants_types: bool) {
        for rule in config
            .configured()
            .filter(|it| it.severity != Severity::Off)
        {
            let id = match rule.name() {
                Some(name) => name.to_vec(),
                None => RuleId::Known(rule.reported_as()).to_vec(),
            };
            match rule.entry.meta.requires_types && !wants_types {
                true => self.not_run.push((Reason::NeedsTypes, id)),
                false => self.native.push(id),
            }
            self.has_types |= rule.entry.meta.requires_types && wants_types;
        }
        let on = (config.js_rules.iter()).filter(|it| it.severity != Severity::Off);
        self.javascript
            .extend(on.map(|it| Arc::clone(&it.configured.rule)));
        let on = (config.formatting_rules.iter()).filter(|it| it.severity != Severity::Off);
        self.not_run
            .extend(on.map(|it| (Reason::Formatting, it.rule.0.into())));
        let missing = config.missing_rules.iter();
        self.not_run
            .extend(missing.map(|it| (Reason::NotDefined, it.to_vec())));
        let plugins = config.plugins_without_rules.iter();
        let all_of = |prefix: &str| [prefix.as_bytes(), b"/*"].concat();
        self.not_run
            .extend(plugins.map(|it| (Reason::NotSupported, all_of(it.prefix()))));
    }

    fn finish(&mut self) {
        self.native = sorted(std::mem::take(&mut self.native));
        bun_lint::utils::sort::sort_unstable(&mut self.not_run);
        self.not_run.dedup();
        bun_lint::utils::sort::sort_by(&mut self.javascript, |a, b| a.id.cmp(&b.id));
        self.javascript.dedup_by(|a, b| Arc::ptr_eq(a, b));
    }

    /// Number of built-in rules per plugin, largest first.
    fn native_by_plugin(&self) -> Vec<(Vec<u8>, usize)> {
        let mut plugins: Vec<(Vec<u8>, usize)> = Vec::new();
        for id in &self.native {
            let plugin = match parse_rule_id(id).0 {
                b"" => b"eslint",
                plugin => plugin,
            };
            match plugins.iter_mut().find(|it| it.0 == plugin) {
                Some(known) => known.1 += 1,
                None => plugins.push((plugin.to_vec(), 1)),
            }
        }
        bun_lint::utils::sort::sort_by(&mut plugins, |a, b| b.1.cmp(&a.1));
        plugins
    }
}

/// Where a plugin comes from, for display: its package name, or its file path relative to `cwd` if it isn't in a package.
/// `location` comes from [`Host::plugins`].
fn source_of(location: &Json, cwd: &[u8]) -> Option<Vec<u8>> {
    let file = |path: &[u8]| {
        let path = paths::from_native(path);
        package_of_file(&path).map_or_else(|| paths::relative(cwd, &path), <[u8]>::to_vec)
    };
    match location.as_array()? {
        [Json::String(directory), Json::String(specifier), ..] => {
            let is_path = specifier.starts_with(b".") || paths::is_absolute(specifier);
            Some(match is_path {
                true => file(&paths::resolve(directory, specifier)),
                false => file(&[b"node_modules/", &specifier[..]].concat()),
            })
        }
        [place, ..] => Some(file(
            place
                .get(b"module")
                .or_else(|| place.get(b"config"))?
                .as_str()?,
        )),
        [] => None,
    }
}

/// Some packages never export the plugin object their own configs use (eslint-plugin-unicorn is one), so `location` only
/// names the config file. Then the plugin comes from the package the config loaded whose name gives its prefix.
fn package_of_prefix(location: &Json, loaded: &[Vec<u8>]) -> Option<Vec<u8>> {
    let [place, _, Json::String(prefix)] = location.as_array()? else {
        return None;
    };
    if place.get(b"module").is_some() || place.get(b"config").is_none() {
        return None;
    }
    let mut named = loaded
        .iter()
        .filter(|it| *it != prefix && plugin_shorthand(it) == *prefix);
    named.next().cloned()
}

fn kind_of(flavor: Flavor) -> (&'static [u8], &'static str) {
    match flavor {
        Flavor::Eslint => (b"eslint", "ESLint flat config"),
        Flavor::EslintRc => (b"eslintrc", "ESLint 8 config"),
        Flavor::Oxlint => (b"oxlint", "oxlint config"),
        Flavor::BuiltIn => (b"none", "Bun's defaults"),
    }
}

/// Builds the `bun lint --doctor` report.
#[optimize(size)]
pub(crate) fn lint(
    (loader, options): (&Loader, &Options),
    pool: &Pool,
    js_plugins: &Host,
    modules: &Modules,
    how: How,
) -> Result<Vec<u8>, Fatal> {
    let cwd = &loader.environment().cwd[..];
    let own = loader.for_directory(cwd)?;
    let dot = [b".".to_vec()];
    let patterns = match &options.patterns[..] {
        [] => &dot[..],
        patterns => patterns,
    };
    let targets = discover::find_files(loader, pool, patterns, false)?;
    let (mut rules, mut files) = (Rules::default(), 0usize);
    let (mut by_eslint, mut not_linted) = (Kinds::default(), Kinds::default());
    let mut all_loaded: Vec<&Arc<Loaded>> = vec![&own];
    let mut seen = FxHashSet::default();
    // Some files are skipped only because the `eslint` package isn't installed.
    let mut lacks_eslint = false;
    for target in &targets {
        let Status::Matched(config) = &target.status else {
            continue;
        };
        match target.route() {
            Route::Eslint => {
                files += 1;
                by_eslint.add(&target.path);
            }
            Route::Unsupported => {
                not_linted.add(&target.path);
                lacks_eslint |= target.loaded.flavor == Flavor::Eslint
                    && config.route_as_it_is(&target.path) == Route::Eslint;
            }
            Route::Native | Route::Processor => {
                files += 1;
                if seen.insert(Arc::as_ptr(config)) {
                    if let Some(error) = &config.error {
                        return Err(Fatal(error.clone()));
                    }
                    rules.add(config, loader.wants_types(&target.loaded, config));
                }
            }
        }
        if !all_loaded.iter().any(|it| Arc::ptr_eq(it, &target.loaded)) {
            all_loaded.push(&target.loaded);
        }
    }
    // No files yet, so report the rules a new `.js` and `.ts` file would get.
    for name in [&b"a.js"[..], b"a.ts"]
        .iter()
        .filter(|_| targets.is_empty())
    {
        if let FileConfig::Matched(config) = loader.config_of(&own, &paths::join(cwd, name)) {
            rules.add(&config, loader.wants_types(&own, &config));
        }
    }
    let unknown = all_loaded.iter().flat_map(|it| it.config.unknown_rules());
    rules
        .not_run
        .extend(unknown.map(|it| (Reason::NotSupported, it.to_vec())));
    rules.finish();
    if rules.has_types && own.flavor != Flavor::Oxlint {
        loader.advise_about_typescript();
    }

    let plugins = js_plugins.plugins();
    let loaded = modules.packages();
    let source = |it: &Json| package_of_prefix(it, &loaded).or_else(|| source_of(it, cwd));
    let sources: Vec<(&Arc<js_plugin::Plugin>, Vec<u8>)> = (plugins.iter())
        .filter_map(|it| Some((&it.0, source(&it.1)?)))
        .collect();
    let mut javascript: Vec<(Vec<u8>, Vec<Vec<u8>>)> = Vec::new();
    for rule in &rules.javascript {
        let has_it =
            |plugin: &js_plugin::Plugin| plugin.rules.iter().any(|it| Arc::ptr_eq(it, rule));
        let source = sources.iter().find(|it| has_it(it.0)).map(|it| &it.1[..]);
        let source = source.unwrap_or_else(|| match parse_rule_id(&rule.id).0 {
            // Only `--rulesdir` adds rules without a prefix.
            b"" => b"--rulesdir",
            prefix => prefix,
        });
        match javascript.iter_mut().find(|it| it.0 == source) {
            Some(known) => known.1.push(rule.id.to_vec()),
            None => javascript.push((source.to_vec(), vec![rule.id.to_vec()])),
        }
    }
    bun_lint::utils::sort::sort_by(&mut javascript, |a, b| {
        b.1.len().cmp(&a.1.len()).then_with(|| a.0.cmp(&b.0))
    });

    let shown = |file: &Vec<u8>| paths::relative(cwd, file);
    let file = own.file.as_ref().map(shown);
    let nested = all_loaded.iter().skip(1).filter_map(|it| it.file.as_ref());
    let nested = sorted(nested.map(shown).collect());
    let packages = Packages::new(cwd, &packages::is_for_linting, &|name| {
        let is_named = || sources.iter().any(|it| it.1 == name);
        if javascript.iter().any(|it| it.0 == name) {
            Some(Need::Rules)
        } else if name == b"eslint" && (by_eslint.count() > 0 || lacks_eslint) {
            Some(Need::Files)
        } else if let Some(file) = file.as_ref().or_else(|| nested.first()) {
            (loaded.iter().any(|it| it == name) || is_named())
                .then(|| Need::Configuration(file.clone()))
        } else {
            let decides = own.flavor == Flavor::Oxlint && matches!(name, b"oxlint" | b"vite-plus");
            decides.then_some(Need::Defaults)
        }
    });
    let mut notes = std::mem::take(&mut *loader.warnings.lock());
    notes.append(&mut *loader.advice.lock());

    let ignored = loader.passed_over().map(|it| &it.0[..]);

    let bunfig = (options.has_section_of_bunfig).then_some(&options.bunfig[..]);
    let mut out = Vec::new();
    if how.as_json {
        let javascript = javascript.iter().map(|it| (it.0.clone(), texts(&it.1)));
        let not_run = rules
            .not_run
            .iter()
            .map(|(reason, id)| object(vec![(b"rule", text(id)), (b"reason", text(reason.key()))]));
        let report = object(vec![
            (
                b"config",
                object(vec![
                    (b"path", file.as_ref().map_or(Json::Null, |it| text(it))),
                    (b"kind", text(kind_of(own.flavor).0)),
                    (b"nested", texts(&nested)),
                    (b"ignored", ignored.map_or(Json::Null, text)),
                    (b"bunfig", bunfig.map_or(Json::Null, text)),
                ]),
            ),
            (
                b"files",
                object(vec![
                    (b"linted", Json::Number(files as f64)),
                    (b"by_eslint", by_eslint.json()),
                    (b"not_linted", not_linted.json()),
                ]),
            ),
            (
                b"rules",
                object(vec![
                    (b"native", texts(&rules.native)),
                    (b"javascript", Json::Object(javascript.collect())),
                    (b"not_run", Json::Array(not_run.collect())),
                ]),
            ),
            (b"packages", packages.json()),
            (b"notes", texts(&notes)),
        ]);
        write_indented(&mut out, &report, 0);
        out.push(b'\n');
        return Ok(out);
    }

    let colors = how.colors;
    let is_native = own.flavor == Flavor::BuiltIn;
    match (&file, own.flavor) {
        (Some(file), flavor) => {
            pretty!(
                &mut out,
                colors,
                "Using <b>{}<r> <d>({})<r>\n",
                BStr::new(file),
                kind_of(flavor).1
            );
        }
        (None, Flavor::BuiltIn) if bunfig.is_some() => {}
        (None, Flavor::BuiltIn) => {
            out.extend_from_slice(b"No ESLint or oxlint config found. Using Bun's defaults.\n");
        }
        (None, Flavor::Oxlint) => {
            out.extend_from_slice(b"No config file found. Using oxlint's defaults.\n");
        }
        (None, Flavor::Eslint | Flavor::EslintRc) => {
            out.extend_from_slice(b"No config file is used. Only the command line sets rules.\n");
        }
    }
    if let Some(bunfig) = bunfig {
        let what = match is_native {
            true => "[lint], on top of Bun's defaults",
            false => "[lint]",
        };
        pretty!(
            &mut out,
            colors,
            "Using <b>{}<r> <d>({})<r>\n",
            BStr::new(bunfig),
            what
        );
    }
    if let Some(ignored) = ignored {
        pretty!(
            &mut out,
            colors,
            "<d>{} is ignored because the project also has an oxlint config. Use --config to pick it.<r>\n",
            BStr::new(ignored)
        );
    }
    if !nested.is_empty() {
        pretty!(
            &mut out,
            colors,
            "<d>Also {}<r>\n",
            BStr::new(&nested.join(&b", "[..]))
        );
    }
    out.push(b'\n');
    let noun =
        |count: usize, one: &'static str, many: &'static str| if count == 1 { one } else { many };
    write_count(
        &mut out,
        colors,
        files,
        noun(files, "file to lint", "files to lint"),
    );
    if by_eslint.count() > 0 {
        let what = noun(by_eslint.count(), "of them goes", "of them go");
        let what = format!("{what} to your installed ESLint: {}", by_eslint.shown());
        write_count(&mut out, colors, by_eslint.count(), &what);
    }
    if not_linted.count() > 0 {
        let what = noun(not_linted.count(), "file", "files");
        let what = format!("{what} cannot be linted: {}", not_linted.shown());
        write_count(&mut out, colors, not_linted.count(), &what);
        if lacks_eslint {
            pretty!(
                &mut out,
                colors,
                "        <d>Install eslint to lint them<r>\n"
            );
        }
    }
    out.push(b'\n');
    let native = rules.native.len();
    if is_native {
        write_count(
            &mut out,
            colors,
            native,
            noun(native, "rule is on", "rules are on"),
        );
        write_table(&mut out, colors, &rules.native_by_plugin());
    } else {
        write_count(
            &mut out,
            colors,
            native,
            noun(native, "rule runs natively", "rules run natively"),
        );
    }
    let in_javascript = rules.javascript.len();
    if in_javascript > 0 || !is_native {
        let what = noun(
            in_javascript,
            "rule runs in JavaScript",
            "rules run in JavaScript",
        );
        write_count(&mut out, colors, in_javascript, what);
        let rows: Vec<_> = javascript
            .iter()
            .map(|it| (it.0.clone(), it.1.len()))
            .collect();
        write_table(&mut out, colors, &rows);
    }
    if !rules.not_run.is_empty() {
        let what = noun(rules.not_run.len(), "rule does not run", "rules do not run");
        write_count(&mut out, colors, rules.not_run.len(), what);
        for group in rules.not_run.chunk_by(|a, b| a.0 == b.0) {
            let Some((reason, _)) = group.first() else {
                continue;
            };
            let shown = if reason.is_harmless() { 3 } else { group.len() };
            let ids: Vec<&[u8]> = group.iter().take(shown).map(|it| &it.1[..]).collect();
            pretty!(
                &mut out,
                colors,
                "      {} <d>{}:<r> {}{}\n",
                format_args!("{:>3}", group.len()),
                reason.shown(group.len()),
                BStr::new(&ids.join(&b", "[..])),
                if shown < group.len() { ", .." } else { "" }
            );
        }
    }
    packages.write(&mut out, colors);
    if is_native && bunfig.is_none() {
        out.extend_from_slice(b"\nRun bun lint --init to add a [lint] section to bunfig.toml\n");
    }
    write_notes(&mut out, colors, &notes);
    Ok(out)
}
