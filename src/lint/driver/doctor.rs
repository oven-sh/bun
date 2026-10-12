//! `--doctor`: what somebody who comes from ESLint, oxlint, Prettier or oxfmt wants to know before switching. It reads the
//! configuration and finds the files as a run does. Nothing is linted, formatted or written.
//!
//! What runs where is asked of what decides it in a run: the [`ResolvedConfig`] of each file, its [`Route`], the [`Host`] of the
//! plugins. Which packages a configuration file cannot be read without is seen while it is read: [`watching`].

use crate::cli::Options;
use crate::configs::{Flavor, Loaded, Loader};
use crate::discover::{self, Status};
use crate::print_config::{object, text, write_indented};
use crate::run::{Environment, Fatal, Pool, Script};
use crate::{evaluate, fs, paths};
use bstr::BStr;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::js_plugin::{self, Host, Route};
use bun_lint::linter::{FileConfig, ResolvedConfig, RuleId, parse_rule_id};
use bun_lint::options::Json;
use bun_sema::util::FxHashSet;
use bun_threading::Guarded;
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

/// The files of the modules that were loaded to read the configuration files.
#[derive(Default)]
pub(crate) struct Modules(Guarded<Vec<Vec<u8>>>);

impl Modules {
    /// The packages that they are of.
    pub(crate) fn packages(&self) -> Vec<Vec<u8>> {
        let modules = self.0.lock();
        let packages = modules.iter().filter_map(|it| package_of_file(it));
        sorted(packages.map(<[u8]>::to_vec).collect())
    }
}

/// Calls `run` with an [`Environment`] in which what the programs that read configuration files load is noted.
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
    names.sort_unstable();
    names.dedup();
    names
}

/// The package that the file at `path` is in. `None`: it is in none.
fn package_of_file(path: &[u8]) -> Option<&[u8]> {
    let package = paths::package_of(path);
    (package.len() < path.len()).then_some(package)
}

pub(crate) fn texts(all: &[Vec<u8>]) -> Json {
    Json::Array(all.iter().map(|it| text(it)).collect())
}

/// How many files there are of each kind, by how their names end.
#[derive(Default)]
pub(crate) struct Kinds(Vec<(Vec<u8>, usize)>);

impl Kinds {
    pub(crate) fn add(&mut self, path: &[u8]) {
        self.add_ending(crate::fmt::ending_of(path), 1);
    }

    /// `count` files whose names end in `ending`, which is the whole name of one without a dot.
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

    /// The most frequent first.
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

/// Why a package has to stay installed.
#[derive(Clone, PartialEq, Eq)]
pub(crate) enum Need {
    /// Rules of it run in JavaScript.
    Rules,
    /// It lints or formats files.
    Files,
    /// The configuration file, which is shown as this, cannot be read without it.
    Configuration(Vec<u8>),
    /// There is no configuration file: that the project depends on it says whose defaults apply.
    Defaults,
}

impl Need {
    fn key(&self) -> &'static [u8] {
        match self {
            Need::Rules => b"rules",
            Need::Files => b"files",
            Need::Configuration(_) => b"config",
            Need::Defaults => b"defaults",
        }
    }

    /// Behind the names of `count` packages.
    fn shown(&self, count: usize) -> String {
        let (it, its) = if count == 1 {
            ("it", "its")
        } else {
            ("them", "their")
        };
        match self {
            Need::Rules => format!("{its} rules run in JavaScript"),
            Need::Files => format!("some files go to {it}"),
            Need::Configuration(file) => format!("{} loads {it}", BStr::new(file)),
            Need::Defaults => format!("{its} defaults apply while package.json has {it}"),
        }
    }
}

/// The names in `dependencies` and `devDependencies` of the `package.json` nearest to `cwd`.
fn dependencies(cwd: &[u8]) -> Vec<Vec<u8>> {
    let nearest =
        paths::ancestors(cwd).find_map(|it| fs::read(&paths::join(it, b"package.json")).ok());
    let Some(json) = nearest.and_then(|it| bun_lint::json::parse(&it)) else {
        return Vec::new();
    };
    let sections = [&b"dependencies"[..], b"devDependencies"].into_iter();
    let entries = sections
        .filter_map(|it| json.get(it)?.as_object())
        .flatten();
    sorted(entries.map(|it| it.0.clone()).collect())
}

/// What becomes of the packages of the tools that `package.json` depends on.
pub(crate) struct Packages {
    removable: Vec<Vec<u8>>,
    needed: Vec<(Vec<u8>, Need)>,
}

impl Packages {
    /// `is_of_a_tool`: whether a package is there for the tool that is replaced. `need`: why it has to stay.
    pub(crate) fn new(
        cwd: &[u8],
        is_of_a_tool: impl Fn(&[u8]) -> bool,
        need: impl Fn(&[u8]) -> Option<Need>,
    ) -> Packages {
        let mut packages = Packages {
            removable: Vec::new(),
            needed: Vec::new(),
        };
        for name in dependencies(cwd) {
            match need(&name) {
                Some(need) => packages.needed.push((name, need)),
                None if is_of_a_tool(&name) => packages.removable.push(name),
                None => {}
            }
        }
        packages
    }

    pub(crate) fn json(&self) -> Json {
        let needed = self
            .needed
            .iter()
            .map(|(name, need)| object(vec![(b"name", text(name)), (b"reason", text(need.key()))]));
        object(vec![
            (b"removable", texts(&self.removable)),
            (b"needed", Json::Array(needed.collect())),
        ])
    }

    pub(crate) fn write(&self, out: &mut Vec<u8>, colors: bool) {
        if self.removable.is_empty() && self.needed.is_empty() {
            return;
        }
        out.push(b'\n');
        if !self.removable.is_empty() {
            let names = self.removable.join(&b", "[..]);
            pretty!(
                out,
                colors,
                "<green>You can remove:<r> {}\n",
                BStr::new(&names)
            );
        }
        let mut groups: Vec<(&Need, Vec<&[u8]>)> = Vec::new();
        for (name, need) in &self.needed {
            match groups.iter_mut().find(|it| it.0 == need) {
                Some(group) => group.1.push(name),
                None => groups.push((need, vec![name])),
            }
        }
        for (at, (need, names)) in groups.iter().enumerate() {
            let label = if at == 0 {
                "Still needed:  "
            } else {
                "               "
            };
            pretty!(
                out,
                colors,
                "{} {} <d>({})<r>\n",
                label,
                BStr::new(&names.join(&b", "[..])),
                need.shown(names.len())
            );
        }
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

/// Below such a line: names, each with a number behind it.
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

/// What a run says beside its results.
pub(crate) fn write_notes(out: &mut Vec<u8>, colors: bool, notes: &[Vec<u8>]) {
    if !notes.is_empty() {
        out.push(b'\n');
    }
    for note in notes {
        pretty!(out, colors, "<blue>note<r><d>:<r> {}\n", BStr::new(note));
    }
}

/// Why a rule that is on does not run.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Reason {
    /// It is not built in, and no plugin of the configuration has it.
    NotSupported,
    /// With a configuration of ESLint 8, which says so in every file.
    NotDefined,
    /// `bun format` does its work.
    Formatting,
    /// Nothing asks for types.
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

    /// Behind the number of the rules, which is `count`.
    fn shown(self, count: usize) -> &'static str {
        match (self, count) {
            (Reason::NotSupported, 1) => "is not supported",
            (Reason::NotSupported, _) => "are not supported",
            (Reason::NotDefined, 1) => "is not defined by any plugin",
            (Reason::NotDefined, _) => "are not defined by any plugin",
            (Reason::Formatting, 1) => "is a formatting rule, use bun format",
            (Reason::Formatting, _) => "are formatting rules, use bun format",
            (Reason::NeedsTypes, 1) => "needs types, use --type-aware",
            (Reason::NeedsTypes, _) => "need types, use --type-aware",
        }
    }

    /// Whether nothing is lost with the rules, so that a few names will do. `-f json` has them all.
    fn is_harmless(self) -> bool {
        matches!(self, Reason::Formatting | Reason::NeedsTypes)
    }
}

/// The rules that are on for a file that the run would lint.
#[derive(Default)]
struct Rules {
    /// As they are reported.
    native: Vec<Vec<u8>>,
    javascript: Vec<Arc<js_plugin::Rule>>,
    not_run: Vec<(Reason, Vec<u8>)>,
    /// One of them needs types, and has them.
    has_types: bool,
}

impl Rules {
    /// `wants_types`: whether the rules that need types run with `config`.
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
        self.not_run.sort_unstable();
        self.not_run.dedup();
        bun_lint::utils::sort::sort_by(&mut self.javascript, |a, b| a.id.cmp(&b.id));
        self.javascript.dedup_by(|a, b| Arc::ptr_eq(a, b));
    }

    /// How many of those that are built in each plugin has.
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

/// What a person calls the place that a plugin is from: its package, or else its file, from `cwd`. `location`: of
/// [`Host::plugins`].
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

fn kind_of(flavor: Flavor) -> (&'static [u8], &'static str) {
    match flavor {
        Flavor::Eslint => (b"eslint", "ESLint flat config"),
        Flavor::EslintRc => (b"eslintrc", "ESLint 8 config"),
        Flavor::Oxlint => (b"oxlint", "oxlint config"),
        Flavor::BuiltIn => (b"none", "Bun's defaults"),
    }
}

/// `bun lint --doctor`: the report.
pub(crate) fn lint(
    (loader, options, _): (&Loader, &Options, &dyn bun_lint::modules::Modules),
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
    for target in &targets {
        let Status::Matched(config) = &target.status else {
            continue;
        };
        match target.route() {
            Route::Eslint => {
                files += 1;
                by_eslint.add(&target.path);
            }
            Route::Unsupported => not_linted.add(&target.path),
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
    // Nothing is here yet: what a file would have.
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
    let sources: Vec<(&Arc<js_plugin::Plugin>, Vec<u8>)> = (plugins.iter())
        .filter_map(|it| Some((&it.0, source_of(&it.1, cwd)?)))
        .collect();
    let mut javascript: Vec<(Vec<u8>, Vec<Vec<u8>>)> = Vec::new();
    for rule in &rules.javascript {
        let has_it =
            |plugin: &js_plugin::Plugin| plugin.rules.iter().any(|it| Arc::ptr_eq(it, rule));
        let source = sources.iter().find(|it| has_it(it.0)).map(|it| &it.1[..]);
        let source = source.unwrap_or_else(|| parse_rule_id(&rule.id).0);
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
    let loaded = modules.packages();
    let packages = Packages::new(
        cwd,
        |name| strings::contains(name, b"eslint") || strings::contains(name, b"oxlint"),
        |name| {
            let is_named = || sources.iter().any(|it| it.1 == name);
            if javascript.iter().any(|it| it.0 == name) {
                Some(Need::Rules)
            } else if name == b"eslint" && by_eslint.count() > 0 {
                Some(Need::Files)
            } else if let Some(file) = &file {
                (loaded.iter().any(|it| it == name) || is_named())
                    .then(|| Need::Configuration(file.clone()))
            } else {
                let decides =
                    own.flavor == Flavor::Oxlint && matches!(name, b"oxlint" | b"vite-plus");
                decides.then_some(Need::Defaults)
            }
        },
    );
    let mut notes = std::mem::take(&mut *loader.warnings.lock());
    notes.append(&mut *loader.advice.lock());

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
    if is_native {
        out.extend_from_slice(b"\nRun bun lint --init to add a [lint] section to bunfig.toml\n");
    }
    write_notes(&mut out, colors, &notes);
    Ok(out)
}
