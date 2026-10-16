//! What the linter talks to: loads plugins, and runs their rules on a file.

use super::engine::{Engine, Vm, Work};
use super::rules::{Configured, FileSettings, Plugin, Rule, Schema};
use super::wire::{self, ask, call, result};
use super::{ast, calls, directives, layouts, reports, schema, scopes, tokens};
use crate::ast::File;
use crate::code_path;
use crate::estree::Dialect;
use crate::fix::Fix;
use crate::language::{LanguageOptions, SourceType};
use crate::linter::{normalize_plugin_name, write_json};
use crate::options::Json;
use crate::rule::Kind;
use crate::selector::Selector;
use bun_core::printer::json_stringify;
use bun_core::strings::Utf16OffsetTable;
use bun_threading::Guarded;
use core::cell::RefCell;
use rustc_hash::FxHashMap;
use std::borrow::Cow;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

/// ESLint's `context.report()`.
#[derive(Clone, Debug)]
pub struct Report {
    /// The index of the rule among those that were run.
    pub rule: u32,
    pub message: Vec<u8>,
    pub message_id: Option<Box<str>>,
    /// From 1. `None`: the rule gave something that isn't a number.
    pub line: Option<u32>,
    /// From 1, in UTF-16 code units. `None`: as for `line`.
    pub column: Option<u32>,
    /// `endLine` and `endColumn`.
    pub end: Option<(u32, u32)>,
    pub fix: Option<Fix>,
    pub suggestions: Vec<Suggested>,
}

/// An element of ESLint's `suggestions`.
#[derive(Clone, Debug)]
pub struct Suggested {
    pub message_id: Option<Box<str>>,
    /// `desc`
    pub message: Vec<u8>,
    /// `data` as JSON, if the rule gave any.
    pub data: Option<Vec<u8>>,
    pub fix: Fix,
}

/// Why there are no reports for a file.
#[derive(Clone, Debug)]
pub struct Failure {
    /// The index of the rule that threw, among those that were run.
    pub rule: Option<u32>,
    pub at: ThrownAt,
    pub message: Vec<u8>,
}

/// Where a rule was when it threw.
#[derive(Copy, Clone, Debug)]
pub enum ThrownAt {
    /// In its `create`.
    Create,
    /// In a listener, at a node on this line.
    Line(u32),
    /// At a node whose line can't be read, in a listener for code paths, or not in a rule at all.
    Unknown,
}

impl From<Vec<u8>> for Failure {
    fn from(message: Vec<u8>) -> Failure {
        Failure {
            rule: None,
            at: ThrownAt::Unknown,
            message,
        }
    }
}

/// Parses the text of a file once more, on the thread that calls it, and hands over the result. It isn't called back if the text
/// can't be parsed.
pub type ParseAgain<'p> = dyn Fn(&mut dyn for<'f> FnMut(&'f File<'f>)) + Sync + 'p;

/// The JavaScript that a run has loaded, in all realms together.
#[derive(Clone, Default, Debug)]
pub struct Loading {
    pub realms: u32,
    /// Files. One that two realms load counts twice.
    pub modules: u64,
    /// Their size.
    pub bytes: u64,
    /// The time it took to load plugins and processors.
    pub milliseconds: f64,
    /// What only the configuration file has, so that a realm has to run all of that to get at it.
    pub need_the_configuration: Vec<Box<[u8]>>,
    /// How many texts ESLint's own `Linter` was given.
    pub linted_by_eslint: u64,
    /// [`Engine::sizes`]
    pub sizes: (usize, usize),
}

impl Loading {
    fn needs_the_configuration_for(&mut self, what: &[u8]) {
        if !self.need_the_configuration.iter().any(|it| **it == *what) {
            self.need_the_configuration.push(what.into());
        }
    }
}

/// A plugin that is loaded.
struct Loaded {
    /// JSON: where it is.
    location: Vec<u8>,
    /// Only the configuration file has it.
    needs_the_configuration: bool,
    /// The number of its first rule.
    first_rule: u32,
    plugin: Arc<Plugin>,
}

#[derive(Default)]
struct State {
    plugins: Vec<Loaded>,
    rules: u32,
    /// The selectors that rules have listened for, by their numbers. `None`: it cannot be parsed.
    selectors: Vec<Option<Arc<Selector>>>,
    /// By their text.
    selector_numbers: FxHashMap<Box<[u8]>, u32>,
    loading: Loading,
    /// [`Host::rules_that_asked_for_types`]
    asked_for_types: Vec<Arc<Rule>>,
}

/// What `getParserServices` of `@typescript-eslint/utils` throws starts so, in all its versions.
const ASKS_FOR_TYPES: &[u8] = b"You have used a rule which requires ";

/// The plugins of a run. All threads share it.
pub struct Host<'e> {
    pub(super) engine: &'e dyn Engine,
    cwd: Vec<u8>,
    /// Whether [`Host::loading`] is read.
    measures: bool,
    /// Whether a rule [has asked for types](Host::has_asked_for_types).
    has_been_asked_for_types: AtomicBool,
    state: Guarded<State>,
}

pub(super) fn number(json: Option<&Json>) -> Option<u32> {
    match json {
        // A column of -1, which ESLint has, is `u32::MAX`.
        Some(Json::Number(n)) if *n < 0.0 => Some((*n as i64) as u32),
        Some(Json::Number(n)) => Some(*n as u32),
        _ => None,
    }
}

/// [`Host::for_each`]
struct Each<'e> {
    /// The heavy ones, and the others.
    lists: [Vec<usize>; 2],
    /// How many of each are taken.
    next: [AtomicUsize; 2],
    work: &'e (dyn Fn(usize) + Sync),
}

impl Each<'_> {
    fn is_left(&self, list: usize) -> bool {
        self.next[list].load(Ordering::Relaxed) < self.lists[list].len()
    }

    fn take(&self, list: usize) -> bool {
        let next = self.lists[list].get(self.next[list].fetch_add(1, Ordering::Relaxed));
        next.map(|&it| (self.work)(it)).is_some()
    }
}

impl Work for Each<'_> {
    fn has_heavy(&self) -> bool {
        self.is_left(0)
    }

    fn heavy(&self) -> bool {
        self.take(0)
    }

    fn light(&self, _realm: usize) -> bool {
        self.take(1)
    }

    fn needs_realms(&self) -> bool {
        self.is_left(1)
    }
}

/// What [`Host::run_on_block`] is given besides the file.
#[derive(Copy, Clone)]
struct How<'h> {
    settings: &'h FileSettings,
    enabled: &'h [&'h Configured],
    wants_fixes: bool,
    physical_path_len: Option<usize>,
}

const OUT_OF_STEP: &[u8] =
    b"Internal error while running JavaScript plugins. This is a bug in Bun.";

impl<'e> Host<'e> {
    /// `cwd`: ESLint's `context.cwd`.
    pub fn with_engine(engine: &'e dyn Engine, cwd: &[u8]) -> Host<'e> {
        Host {
            engine,
            cwd: cwd.to_vec(),
            measures: false,
            has_been_asked_for_types: AtomicBool::new(false),
            state: Guarded::new(State::default()),
        }
    }

    /// The same host, which keeps track of what is loaded.
    pub fn measuring(self, measures: bool) -> Host<'e> {
        Host { measures, ..self }
    }

    pub(super) fn count_one_for_eslint(&self) {
        self.state.lock().loading.linted_by_eslint += 1;
    }

    /// What has been loaded so far. Only the number of realms is known unless the host is [measuring](Host::measuring).
    pub fn loading(&self) -> Loading {
        Loading {
            sizes: self.engine.sizes(),
            ..self.state.lock().loading.clone()
        }
    }

    /// Answers what a realm asks for whatever it is called with. Returns whether that is what was asked for.
    pub(super) fn serve_any(&self, asked: u32, details: &[u8], out: &mut Vec<u8>) -> bool {
        match asked {
            ask::START => {
                self.state.lock().loading.realms += 1;
                schema::write_start(&self.cwd, self.measures, out);
            }
            ask::LAYOUTS => layouts::write(out),
            ask::LOADED => {
                let parts = crate::json::parse(details);
                if let Some(
                    [
                        Json::Number(modules),
                        Json::Number(bytes),
                        Json::Number(time),
                    ],
                ) = parts.as_ref().and_then(Json::as_array)
                {
                    let loading = &mut self.state.lock().loading;
                    loading.modules += *modules as u64;
                    loading.bytes += *bytes as u64;
                    loading.milliseconds += *time;
                }
            }
            _ => return false,
        }
        true
    }

    /// [`Engine::expect`]
    pub fn expect(&self, files: usize, size: u64, most: usize) {
        self.engine.expect(files, size, most);
    }

    /// [`Engine::may_come`]
    pub fn may_come(&self, size: u64) {
        self.engine.may_come(size);
    }

    /// [`Engine::comes`]
    pub fn comes(&self, size: u64) {
        self.engine.comes(size);
    }

    /// [`Engine::has_shown`]
    pub fn has_shown(&self, size: u64, has_come: bool) {
        self.engine.has_shown(size, has_come);
    }

    /// [`Engine::work_off`]
    pub fn work_off(&self, work: &dyn Work, meanwhile: &mut dyn FnMut()) -> Result<(), Vec<u8>> {
        self.engine.work_off(work, meanwhile)
    }

    /// [`Engine::busy`]
    pub fn busy(&self) -> usize {
        self.engine.busy()
    }

    /// Calls `work` with every number below `count`, on threads that have a realm. `is_heavy`: whether the file with that number
    /// is [`HEAVY`](super::HEAVY).
    pub fn for_each(
        &self,
        count: usize,
        is_heavy: &dyn Fn(usize) -> bool,
        work: &(dyn Fn(usize) + Sync),
    ) {
        let (heavy, light) = (0..count).partition(|&it| is_heavy(it));
        let each = Each {
            lists: [heavy, light],
            next: Default::default(),
            work,
        };
        // Without a realm each fails, and says why.
        if self.engine.work_off(&each, &mut || ()).is_err() {
            each.finish_here();
        }
    }

    /// Whether `rule` has asked for types, which are not there for a rule in JavaScript. It runs on no more file.
    pub fn has_asked_for_types(&self, rule: &Arc<Rule>) -> bool {
        self.has_been_asked_for_types.load(Ordering::Relaxed)
            && (self.state.lock().asked_for_types.iter()).any(|it| Arc::ptr_eq(it, rule))
    }

    /// Whether `thrown`, the message of what `rule` has thrown, says that it needs types. From then on it
    /// [has asked](Host::has_asked_for_types).
    pub fn asks_for_types(&self, rule: &Arc<Rule>, thrown: &[u8]) -> bool {
        // With an oxlint config the message comes after the class of the error.
        let message = thrown.strip_prefix(b"Error: ").unwrap_or(thrown);
        if !message.starts_with(ASKS_FOR_TYPES) {
            return false;
        }
        if !self.has_asked_for_types(rule) {
            self.state.lock().asked_for_types.push(Arc::clone(rule));
            self.has_been_asked_for_types.store(true, Ordering::Relaxed);
        }
        true
    }

    /// The rules that [have asked for types](Host::has_asked_for_types), by their names.
    pub fn rules_that_asked_for_types(&self) -> Vec<Arc<Rule>> {
        let mut rules = self.state.lock().asked_for_types.clone();
        crate::utils::sort::sort_by(&mut rules, |a, b| a.id.cmp(&b.id));
        rules.dedup_by(|a, b| Arc::ptr_eq(a, b));
        rules
    }

    /// The plugins that are known, each with where it is: `[directory, specifier, alias]` of [`Host::load`], or
    /// `[location, null, prefix]` of [`Host::load_located`].
    pub fn plugins(&self) -> Vec<(Arc<Plugin>, Json)> {
        let state = self.state.lock();
        let located =
            |it: &Loaded| Some((Arc::clone(&it.plugin), crate::json::parse(&it.location)?));
        state.plugins.iter().filter_map(located).collect()
    }

    /// Loads a plugin. `specifier`: a path, relative to `directory`, or the name of a package, which
    /// is looked for from there. `alias`: the prefix of its rules, if it is not the name that the
    /// plugin has for itself.
    pub fn load(
        &self,
        directory: &[u8],
        specifier: &[u8],
        alias: Option<&[u8]>,
    ) -> Result<Arc<Plugin>, Vec<u8>> {
        let mut location = b"[".to_vec();
        for part in [Some(directory), Some(specifier), alias] {
            match part {
                Some(part) => json_stringify(part, &mut location),
                None => location.extend_from_slice(b"null"),
            }
            location.push(b',');
        }
        location.pop();
        location.push(b']');
        self.load_from(location)
    }

    /// The file that [`Host::load`] would load, as Node.js writes the path. Nothing is loaded.
    pub fn resolve(&self, directory: &[u8], specifier: &[u8]) -> Result<Vec<u8>, Vec<u8>> {
        let mut message = b"[[".to_vec();
        json_stringify(directory, &mut message);
        message.push(b',');
        json_stringify(specifier, &mut message);
        // `ONLY_RESOLVE`
        message.extend_from_slice(b",null],-1,null]");
        let mut found = Err(OUT_OF_STEP.to_vec());
        self.engine
            .with_vm(0, &mut |vm| found = self.ask_to_load(vm, &message))?;
        let found = crate::json::parse(&found?);
        let file = found.as_ref().and_then(|it| it.get(b"file")?.as_str());
        file.map(<[u8]>::to_vec).ok_or_else(|| OUT_OF_STEP.to_vec())
    }

    /// Loads a plugin that an `eslint.config.js` has under `prefix`. `location`: what the script that
    /// evaluates such a file says about where the plugin is, in `$jsPlugins`.
    /// With `described`, which is what the plugin consists of as JSON in a string, nothing is loaded yet.
    pub fn load_located(&self, location: &Json, prefix: &[u8]) -> Result<Arc<Plugin>, Vec<u8>> {
        let entries = location.as_object().unwrap_or_default().iter();
        let place = entries.filter(|it| it.0 != b"described").cloned().collect();
        let mut written = b"[".to_vec();
        write_json(&mut written, &Json::Object(place));
        written.extend_from_slice(b",null,");
        json_stringify(prefix, &mut written);
        written.push(b']');
        let described = location.get(b"described").and_then(Json::as_str);
        match described.and_then(crate::json::parse) {
            Some(described) => {
                Ok(self.register(written, &described, location.get(b"config").is_some()))
            }
            None => self.load_from(written),
        }
    }

    /// Takes note of the plugin at `location`, which is `described`.
    fn register(
        &self,
        location: Vec<u8>,
        described: &Json,
        needs_the_configuration: bool,
    ) -> Arc<Plugin> {
        let mut state = self.state.lock();
        if let Some(known) = state.plugins.iter().find(|it| it.location == location) {
            return Arc::clone(&known.plugin);
        }
        let place = (state.plugins.len() as u32, state.rules);
        let plugin = Arc::new(plugin_of(described, place, needs_the_configuration));
        let first_rule = state.rules;
        state.rules += plugin.rules.len() as u32;
        state.plugins.push(Loaded {
            location,
            needs_the_configuration,
            first_rule,
            plugin: Arc::clone(&plugin),
        });
        plugin
    }

    fn load_from(&self, location: Vec<u8>) -> Result<Arc<Plugin>, Vec<u8>> {
        let known = |state: &State| {
            state
                .plugins
                .iter()
                .find(|it| it.location == location)
                .map(|it| Arc::clone(&it.plugin))
        };
        if let Some(plugin) = known(&self.state.lock()) {
            return Ok(plugin);
        }
        let mut loaded = Err(OUT_OF_STEP.to_vec());
        self.engine
            .with_vm(0, &mut |vm| loaded = self.load_in(vm, &location, None))?;
        let described = crate::json::parse(&loaded?).ok_or(OUT_OF_STEP)?;
        Ok(self.register(location, &described, false))
    }

    /// Has `vm` load the plugin at `location`. `place`: its position among the plugins and the number of its first rule, once
    /// it has them. Returns the description of the plugin.
    fn load_in(
        &self,
        vm: &mut dyn Vm,
        location: &[u8],
        place: Option<(usize, u32)>,
    ) -> Result<Vec<u8>, Vec<u8>> {
        let place = place.map_or_else(
            || "null,null".to_owned(),
            |(position, first_rule)| format!("{position},{first_rule}"),
        );
        self.ask_to_load(vm, &[b"[", location, b",", place.as_bytes(), b"]"].concat())
    }

    fn ask_to_load(&self, vm: &mut dyn Vm, message: &[u8]) -> Result<Vec<u8>, Vec<u8>> {
        let returned = vm.call(call::LOAD, message, &mut |asked, details, out| {
            self.serve_any(asked, details, out);
        })?;
        match returned.split_first() {
            Some((&result::DONE, described)) => Ok(described.to_vec()),
            Some((&result::FAILED, why)) => Err(why.to_vec()),
            _ => Err(OUT_OF_STEP.to_vec()),
        }
    }

    /// Given JSON, selectors as text, appends what [`ask::SELECTORS`] says.
    fn describe_selectors(&self, texts: &[u8], out: &mut Vec<u8>) {
        let texts = crate::json::parse(texts);
        let mut state = self.state.lock();
        out.push(b'[');
        for (i, text) in texts
            .as_ref()
            .and_then(Json::as_array)
            .unwrap_or_default()
            .iter()
            .enumerate()
        {
            if i > 0 {
                out.push(b',');
            }
            let text = text.as_str().unwrap_or_default();
            let known = state
                .selector_numbers
                .get(text)
                .and_then(|&it| Some((it, state.selectors.get(it as usize)?.clone()?)));
            let parsed = match known {
                Some(known) => Ok(known),
                None => Selector::parse(text).map(|selector| {
                    let (number, selector) = (state.selectors.len() as u32, Arc::new(selector));
                    state.selectors.push(Some(Arc::clone(&selector)));
                    state.selector_numbers.insert(text.into(), number);
                    (number, selector)
                }),
            };
            match parsed {
                Ok((number, _)) => {
                    out.extend_from_slice(number.to_string().as_bytes());
                }
                Err(error) => json_stringify(error.message(), out),
            }
        }
        out.push(b']');
    }

    /// The selectors with these numbers.
    fn selectors_at(&self, numbers: impl Iterator<Item = u32>) -> Vec<Option<Arc<Selector>>> {
        let mut numbers = numbers.peekable();
        if numbers.peek().is_none() {
            return Vec::new();
        }
        let state = self.state.lock();
        numbers
            .map(|it| state.selectors.get(it as usize)?.clone())
            .collect()
    }

    /// The positions of the plugins that a realm has to load for the rules `enabled`, in ascending order.
    fn plugins_of(enabled: &[&Configured]) -> Vec<u32> {
        let without_module = enabled.iter().filter(|it| it.rule.location.is_none());
        let mut positions: Vec<u32> = without_module.map(|it| it.rule.plugin).collect();
        positions.sort_unstable();
        positions.dedup();
        positions
    }

    /// Runs the rules `enabled` on `file`. `physical_path_len`: how much of the path of the file is ESLint's `physicalFilename`, if
    /// not all of it. `wants_fixes`: `false` is ESLint's `disableFixes`. Not whether somebody reads them: to be asked for one is
    /// part of what a rule does. `parse_again`: for a thread that has no realm. A thread that has one parses the text itself.
    pub fn run_on_block<'a>(
        &self,
        file: &'a File<'a>,
        settings: &FileSettings,
        enabled: &[&Configured],
        wants_fixes: bool,
        physical_path_len: Option<usize>,
        parse_again: Option<&ParseAgain>,
    ) -> Result<Vec<Report>, Failure> {
        let how = How {
            settings,
            enabled,
            wants_fixes,
            physical_path_len,
        };
        let size = file.text().len();
        let mut outcome = Err(Failure::from(OUT_OF_STEP.to_vec()));
        if self.engine.is_here() {
            (self.engine).with_vm_here(size, &mut |vm| outcome = self.run_in(vm, file, &how))?;
        } else if let Some(parse_again) = parse_again {
            self.engine.with_vm(size, &mut |vm| {
                parse_again(&mut |file| outcome = self.run_in(vm, file, &how));
            })?;
        }
        let (reports, used) = outcome?;
        scopes::mark_used(file, used.into_iter());
        Ok(reports)
    }

    /// Returns the reports, and the indices of the variables that rules have marked as used.
    fn run_in<'a>(
        &self,
        vm: &mut dyn Vm,
        file: &'a File<'a>,
        how: &How,
    ) -> Result<(Vec<Report>, Vec<u32>), Failure> {
        let How {
            settings,
            enabled,
            wants_fixes,
            physical_path_len,
        } = *how;
        let text = file.text();
        let offsets = Utf16OffsetTable::without_bom(text);
        let has_mark = text.starts_with(b"\xEF\xBB\xBF");
        let path = file.path();
        let plugins = Self::plugins_of(enabled);
        let mut message =
            Vec::with_capacity(24 + (plugins.len() + enabled.len()) * 4 + path.len() + text.len());
        let is_espree = Dialect::of(file) == Dialect::Espree;
        let flags = u32::from(wants_fixes)
            | (u32::from(has_mark) << 1)
            | (u32::from(is_espree) << 2)
            | (u32::from(settings.sources.is_some()) << 3)
            | (u32::from(file.language().is_oxlint) << 4)
            | (source_type_for_oxlint(file) << 5)
            | (u32::from(ast::shortens_nodes(file)) << 8);
        wire::words(
            &mut message,
            &[
                flags,
                plugins.len() as u32,
                settings.id,
                enabled.len() as u32,
                path.len() as u32,
                physical_path_len.unwrap_or(path.len()).min(path.len()) as u32,
            ],
        );
        wire::words(&mut message, &plugins);
        for configured in enabled {
            wire::words(&mut message, &[configured.id]);
        }
        message.extend_from_slice(path);
        message.extend_from_slice(if has_mark { &text[3..] } else { text });

        let mut nodes = None;
        // What `code_path::estree::analyze` says about the file.
        let mut code_paths: Option<Vec<u32>> = None;
        let reported = RefCell::new(Vec::new());
        let mut serve = |asked: u32, details: &[u8], out: &mut Vec<u8>| match asked {
            _ if self.serve_any(asked, details, out) => {}
            ask::SETTINGS => out.extend_from_slice(&settings.json),
            ask::CONFIGURED => {
                let position = std::str::from_utf8(details)
                    .ok()
                    .and_then(|it| it.parse::<usize>().ok());
                if let Some(configured) = position.and_then(|it| enabled.get(it)) {
                    out.extend_from_slice(&configured.json);
                }
            }
            ask::SELECTORS => self.describe_selectors(details, out),
            ask::LISTEN => {
                let words: Vec<u32> = (details.as_chunks::<4>().0.iter())
                    .map(|it| u32::from_le_bytes(*it))
                    .collect();
                let selectors = self.selectors_at(calls::selector_numbers(&words));
                let selectors: Vec<Option<&Selector>> =
                    selectors.iter().map(Option::as_deref).collect();
                let known = calls::Known {
                    nodes: &mut nodes,
                    code_paths: &mut code_paths,
                };
                calls::listen(file, &offsets, &words, &selectors, known, out);
            }
            ask::REPORTS => reports::read(details, &offsets, &mut reported.borrow_mut()),
            ask::CONFIG_COMMENTS => directives::write(file, &offsets, out),
            ask::TOKENS => tokens::write(file, &offsets, out),
            ask::COMMENTS => tokens::write_comments(file, &offsets, out),
            ask::SCOPES => {
                if let Some(numbered) = &nodes {
                    scopes::write(file, &offsets, numbered, &settings.globals, out);
                }
            }
            ask::LIB_VARIABLES => {
                // typescript-eslint defines the `const` of `x as const` after the libraries.
                let for_const = LanguageOptions::lib_name_count() as u32;
                let mut words = vec![for_const + 1, 0];
                words.extend(file.language().lib_variable_entries());
                words.push(for_const << 2 | 1);
                words[1] = words.len() as u32 - 2;
                wire::words(out, &words);
            }
            ask::LIB_VARIABLE => {
                let entry = match details {
                    b"const" => Some((LanguageOptions::lib_name_count() as u32) << 2 | 1),
                    name => file.language().lib_variable_entry(name),
                };
                wire::words(out, entry.as_slice());
            }
            ask::LIB_NAME => {
                if let Ok(id) = <[u8; 4]>::try_from(details) {
                    let id = u32::from_le_bytes(id) as usize;
                    out.extend_from_slice(match id == LanguageOptions::lib_name_count() {
                        true => b"const",
                        false => LanguageOptions::lib_name(id),
                    });
                }
            }
            ask::CODE_PATHS => {
                if let Some(numbered) = &nodes {
                    let analyzed = code_paths
                        .get_or_insert_with(|| code_path::estree::analyze(file, numbered.view()));
                    wire::words(out, analyzed);
                }
            }
            _ => {}
        };
        loop {
            let returned = vm.call(call::LINT, &message, &mut serve)?;
            let Some((&kind, content)) = returned.split_first() else {
                return Err(OUT_OF_STEP.to_vec().into());
            };
            if kind == result::DONE && content.is_empty() {
                return Ok((reported.take(), Vec::new()));
            }
            let Some(parts) = crate::json::parse(content).and_then(Json::into_array) else {
                return Err(OUT_OF_STEP.to_vec().into());
            };
            match kind {
                result::DONE => {
                    let used = parts.iter().filter_map(|it| number(Some(it)));
                    return Ok((reported.take(), used.collect()));
                }
                result::FAILED => {
                    return Err(Failure {
                        rule: number(parts.first()),
                        at: match (parts.get(2), number(parts.get(2))) {
                            (Some(Json::String(_)), _) => ThrownAt::Create,
                            (_, Some(line)) => ThrownAt::Line(line),
                            _ => ThrownAt::Unknown,
                        },
                        message: parts
                            .get(1)
                            .and_then(Json::as_str)
                            .unwrap_or_default()
                            .to_vec(),
                    });
                }
                result::NEEDS_PLUGINS if !parts.is_empty() => {
                    for position in parts.iter().filter_map(|it| number(Some(it))) {
                        let mut state = self.state.lock();
                        let Some(plugin) = state.plugins.get(position as usize) else {
                            return Err(OUT_OF_STEP.to_vec().into());
                        };
                        let (location, first_rule) = (plugin.location.clone(), plugin.first_rule);
                        if plugin.needs_the_configuration {
                            let what = [b"the plugin \"", &plugin.plugin.name[..], b"\""].concat();
                            state.loading.needs_the_configuration_for(&what);
                        }
                        drop(state);
                        self.load_in(vm, &location, Some((position as usize, first_rule)))?;
                    }
                }
                result::NEEDS_SETTINGS => {
                    let Some(sources) = &settings.sources else {
                        return Err(OUT_OF_STEP.to_vec().into());
                    };
                    let id = settings.id.to_string();
                    let parts: [&[u8]; 7] = [
                        b"[",
                        id.as_bytes(),
                        b",",
                        &settings.json,
                        b",",
                        sources,
                        b"]",
                    ];
                    let loaded = vm.call(call::LOAD_SETTINGS, &parts.concat(), &mut serve)?;
                    match loaded.split_first() {
                        Some((&result::DONE, _)) => {}
                        Some((&result::FAILED, why)) => return Err(why.to_vec().into()),
                        _ => return Err(OUT_OF_STEP.to_vec().into()),
                    }
                    let loading = &mut self.state.lock().loading;
                    loading.needs_the_configuration_for(b"\"settings\"");
                }
                _ => return Err(OUT_OF_STEP.to_vec().into()),
            }
        }
    }
}

/// What oxlint takes the file for: 0 a module, 1 a script, 2 CommonJS, and 4 if it can't have JSX. With another configuration 0.
fn source_type_for_oxlint<'a>(file: &'a File<'a>) -> u32 {
    if !file.language().is_oxlint {
        return 0;
    }
    let source_type = match crate::utils::oxlint::source_type(file) {
        SourceType::Module => 0,
        SourceType::Script => 1,
        SourceType::CommonJs => 2,
    };
    let has_no_jsx = matches!(
        file.path(),
        [.., b'.', b't', b's'] | [.., b'.', b'c' | b'm', b't', b's']
    );
    source_type | (u32::from(has_no_jsx) << 2)
}

/// `{ name, isAlias, id, file, export, hasNothing, rules: [{ name, at, type, fixable, hasSuggestions, schema, defaultOptions, deprecated, replacedBy }] }`. The rules are
/// numbered from `first`, in that order. `position`: that of the plugin. `needs_the_configuration`: no module exports it.
fn plugin_of(
    described: &Json,
    (position, first): (u32, u32),
    needs_the_configuration: bool,
) -> Plugin {
    let name = described
        .get(b"name")
        .and_then(Json::as_str)
        .unwrap_or_default();
    let name = match described.get(b"isAlias").and_then(Json::as_bool) {
        Some(true) => Cow::Borrowed(name),
        _ => normalize_plugin_name(name),
    };
    let name = &*name;
    let rules = described
        .get(b"rules")
        .and_then(Json::as_array)
        .unwrap_or_default();
    // The rules of `--rulesdir` are those of a plugin without a name, and have no prefix.
    let separator: &[u8] = if name.is_empty() { b"" } else { b"/" };
    let rule = |(i, it): (usize, &Json)| {
        Arc::new(Rule {
            id: [
                name,
                separator,
                it.get(b"name").and_then(Json::as_str).unwrap_or_default(),
            ]
            .concat()
            .into(),
            kind: match it.get(b"type").and_then(Json::as_str) {
                Some(b"problem") => Some(Kind::Problem),
                Some(b"suggestion") => Some(Kind::Suggestion),
                Some(b"layout") => Some(Kind::Layout),
                _ => None,
            },
            is_fixable: it.get(b"fixable").and_then(Json::as_bool) == Some(true),
            has_suggestions: it.get(b"hasSuggestions").and_then(Json::as_bool) == Some(true),
            schema: match it.get(b"schema") {
                None | Some(Json::Null) => Schema::None,
                Some(Json::Bool(false)) => Schema::Any,
                Some(schema) => Schema::Json(schema.clone()),
            },
            default_options: it
                .get(b"defaultOptions")
                .and_then(Json::as_array)
                .unwrap_or_default()
                .to_vec(),
            deprecated: it.get(b"deprecated").map(|deprecated| {
                let replaced_by = it.get(b"replacedBy").cloned().unwrap_or(Json::Null);
                Box::new((deprecated.clone(), replaced_by))
            }),
            needs_the_configuration: needs_the_configuration && it.get(b"at").is_none(),
            location: it.get(b"at").map(|at| {
                let mut written = Vec::new();
                write_json(&mut written, at);
                written.into()
            }),
            plugin: position,
            index: first + i as u32,
        })
    };
    let mut rules: Vec<Arc<Rule>> = rules.iter().enumerate().map(rule).collect();
    crate::utils::sort::sort_by(&mut rules, |a, b| a.id.cmp(&b.id));
    Plugin {
        name: name.into(),
        location: described.get(b"file").map(|file| {
            let exported = described.get(b"export").cloned();
            Json::Object(vec![
                (b"module".to_vec(), file.clone()),
                (
                    b"export".to_vec(),
                    exported.unwrap_or(Json::Array(Vec::new())),
                ),
            ])
        }),
        id: (described.get(b"id").and_then(Json::as_str)).map(Into::into),
        has_nothing: described.get(b"hasNothing").and_then(Json::as_bool) == Some(true),
        rules,
    }
}
