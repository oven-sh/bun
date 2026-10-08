//! What the linter talks to: loads plugins, and runs their rules on a file.

use super::engine::{Engine, Vm};
use super::offsets::Offsets;
use super::rules::{Configured, FileSettings, Plugin, Rule, Schema};
use super::wire::{self, ask, call, result};
use super::{ast, schema, scopes, tokens};
use crate::ast::File;
use crate::estree::Dialect;
use crate::fix::Fix;
use crate::linter::{write_json, write_json_string};
use crate::options::Json;
use crate::rule::Kind;
use crate::selector::Selector;
use crate::span::Span;
use bun_threading::Guarded;
use rustc_hash::FxHashMap;
use std::sync::Arc;

/// ESLint's `context.report()`.
#[derive(Clone, Debug)]
pub struct Report {
    /// The index of the rule among those that were run.
    pub rule: u32,
    pub message: Vec<u8>,
    pub message_id: Option<Box<str>>,
    /// From 1.
    pub line: u32,
    /// From 1, in UTF-16 code units.
    pub column: u32,
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
    pub data: Vec<(Box<str>, Vec<u8>)>,
    pub fix: Fix,
}

/// Why there are no reports for a file.
#[derive(Clone, Debug)]
pub struct Failure {
    /// The index of the rule that threw, among those that were run.
    pub rule: Option<u32>,
    /// The line of the node that was being visited.
    pub line: Option<u32>,
    pub message: Vec<u8>,
}

impl From<Vec<u8>> for Failure {
    fn from(message: Vec<u8>) -> Failure {
        Failure {
            rule: None,
            line: None,
            message,
        }
    }
}

/// A plugin that is loaded.
struct Loaded {
    /// JSON: where it is.
    location: Vec<u8>,
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
}

/// The plugins of a run. All threads share it.
pub struct Host<'e> {
    engine: &'e dyn Engine,
    cwd: Vec<u8>,
    state: Guarded<State>,
}

fn number(json: Option<&Json>) -> Option<u32> {
    match json {
        // A column of -1, which ESLint has, is `u32::MAX`.
        Some(Json::Number(n)) if *n < 0.0 => Some((*n as i64) as u32),
        Some(Json::Number(n)) => Some(*n as u32),
        _ => None,
    }
}

fn text_of(json: Option<&Json>) -> Option<Box<str>> {
    Some(std::str::from_utf8(json?.as_str()?).ok()?.into())
}

/// `[start, end, text]`
fn fix_of(json: Option<&Json>, offsets: &Offsets) -> Option<Fix> {
    let [start, end, text] = json?.as_array()? else {
        return None;
    };
    // The byte order mark is at -1.
    let at = |it: &Json| match it {
        Json::Number(n) if *n < 0.0 => Some(0),
        it => Some(offsets.to_bytes(number(Some(it))?)),
    };
    Some(Fix {
        span: Span::new(at(start)?, at(end)?),
        text: text.as_str()?.to_vec(),
    })
}

/// `[rule, message, messageId, line, column, endLine, endColumn, fix, suggestions]`
fn report_of(json: &Json, offsets: &Offsets) -> Option<Report> {
    let parts = json.as_array()?;
    let suggestions = parts.get(8).and_then(Json::as_array).unwrap_or_default();
    // `[messageId, desc, data, fix]`
    let suggested = |it: &Json| {
        let parts = it.as_array()?;
        let data = parts.get(2).and_then(Json::as_object).unwrap_or_default();
        let data = data.iter().filter_map(|(key, value)| {
            Some((
                std::str::from_utf8(key).ok()?.into(),
                value.as_str()?.to_vec(),
            ))
        });
        Some(Suggested {
            message_id: text_of(parts.first()),
            message: parts.get(1)?.as_str()?.to_vec(),
            data: data.collect(),
            fix: fix_of(parts.get(3), offsets)?,
        })
    };
    Some(Report {
        rule: number(parts.first())?,
        message: parts.get(1)?.as_str()?.to_vec(),
        message_id: text_of(parts.get(2)),
        line: number(parts.get(3))?,
        column: number(parts.get(4))?,
        end: number(parts.get(5)).zip(number(parts.get(6))),
        fix: fix_of(parts.get(7), offsets),
        suggestions: suggestions.iter().filter_map(suggested).collect(),
    })
}

const OUT_OF_STEP: &[u8] = b"The program for JavaScript plugins is out of step.";

impl<'e> Host<'e> {
    /// `cwd`: ESLint's `context.cwd`.
    pub fn with_engine(engine: &'e dyn Engine, cwd: &[u8]) -> Host<'e> {
        Host {
            engine,
            cwd: cwd.to_vec(),
            state: Guarded::new(State::default()),
        }
    }

    /// Whether any plugin has been loaded.
    pub fn has_plugins(&self) -> bool {
        !self.state.lock().plugins.is_empty()
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
                Some(part) => write_json_string(&mut location, part),
                None => location.extend_from_slice(b"null"),
            }
            location.push(b',');
        }
        location.pop();
        location.push(b']');
        self.load_from(location)
    }

    /// Loads a plugin that an `eslint.config.js` has under `prefix`. `location`: what the script that
    /// evaluates such a file says about where the plugin is, in `$jsPlugins`.
    pub fn load_located(&self, location: &Json, prefix: &[u8]) -> Result<Arc<Plugin>, Vec<u8>> {
        let mut written = b"[".to_vec();
        write_json(&mut written, location);
        written.extend_from_slice(b",null,");
        write_json_string(&mut written, prefix);
        written.push(b']');
        self.load_from(written)
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
            .with_vm(&mut |vm| loaded = self.load_in(vm, &location, None))?;
        let described = crate::json::parse(&loaded?).ok_or(OUT_OF_STEP)?;
        let mut state = self.state.lock();
        // Another thread was faster.
        if let Some(plugin) = known(&state) {
            return Ok(plugin);
        }
        let plugin = Arc::new(plugin_of(&described, state.rules));
        let first_rule = state.rules;
        state.rules += plugin.rules.len() as u32;
        state.plugins.push(Loaded {
            location,
            first_rule,
            plugin: Arc::clone(&plugin),
        });
        Ok(plugin)
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
        let message = [b"[", location, b",", place.as_bytes(), b"]"].concat();
        let returned = vm.call(call::LOAD, &message, &mut |asked, _, out| {
            if asked == ask::START {
                schema::write_start(&self.cwd, out);
            }
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
                Ok((number, selector)) => {
                    let counts = format!(
                        "[{number},{},{}]",
                        selector.attribute_count(),
                        selector.identifier_count()
                    );
                    out.extend_from_slice(counts.as_bytes());
                }
                Err(error) => write_json_string(out, error.message()),
            }
        }
        out.push(b']');
    }

    /// Given JSON, the numbers of selectors, these.
    fn selectors(&self, numbers: &[u8]) -> Vec<Option<Arc<Selector>>> {
        let numbers = crate::json::parse(numbers);
        let numbers = numbers
            .as_ref()
            .and_then(Json::as_array)
            .unwrap_or_default();
        if numbers.is_empty() {
            return Vec::new();
        }
        let state = self.state.lock();
        numbers
            .iter()
            .map(|it| state.selectors.get(number(Some(it))? as usize)?.clone())
            .collect()
    }

    /// Runs the rules `enabled` on `file`. `wants_fixes`: whether anything reads [`Report::fix`] and
    /// [`Report::suggestions`].
    pub fn run<'a>(
        &self,
        file: &'a File<'a>,
        settings: &FileSettings,
        enabled: &[&Configured],
        wants_fixes: bool,
    ) -> Result<Vec<Report>, Failure> {
        let mut outcome = Err(Failure::from(OUT_OF_STEP.to_vec()));
        self.engine
            .with_vm(&mut |vm| outcome = self.run_in(vm, file, settings, enabled, wants_fixes))?;
        outcome
    }

    fn run_in<'a>(
        &self,
        vm: &mut dyn Vm,
        file: &'a File<'a>,
        settings: &FileSettings,
        enabled: &[&Configured],
        wants_fixes: bool,
    ) -> Result<Vec<Report>, Failure> {
        let text = file.text();
        let offsets = Offsets::new(text);
        let has_mark = text.starts_with(b"\xEF\xBB\xBF");
        let (path, plugins) = (file.path(), self.state.lock().plugins.len());
        let mut message = Vec::with_capacity(24 + enabled.len() * 4 + path.len() + text.len());
        let is_espree = Dialect::of(file) == Dialect::Espree;
        let flags =
            u32::from(wants_fixes) | (u32::from(has_mark) << 1) | (u32::from(is_espree) << 2);
        wire::words(
            &mut message,
            &[
                flags,
                plugins as u32,
                settings.id,
                enabled.len() as u32,
                path.len() as u32,
            ],
        );
        for configured in enabled {
            wire::words(&mut message, &[configured.id]);
        }
        message.extend_from_slice(path);
        message.extend_from_slice(if has_mark { &text[3..] } else { text });

        let mut ids = None;
        let mut serve = |asked: u32, details: &[u8], out: &mut Vec<u8>| match asked {
            ask::START => schema::write_start(&self.cwd, out),
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
            ask::AST | ask::MATCHES => {
                let selectors = self.selectors(details);
                let selectors: Vec<Option<&Selector>> =
                    selectors.iter().map(Option::as_deref).collect();
                match asked {
                    ask::AST => ids = Some(ast::write(file, &offsets, &selectors, out)),
                    _ => ast::write_only_matches(file, &offsets, &selectors, out),
                }
            }
            ask::TOKENS => tokens::write(file, &offsets, out),
            ask::COMMENTS => tokens::write_comments(file, &offsets, out),
            ask::SCOPES => {
                if let Some(ids) = &ids {
                    scopes::write(file, &offsets, ids, out);
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
                return Ok(Vec::new());
            }
            let Some(Json::Array(parts)) = crate::json::parse(content) else {
                return Err(OUT_OF_STEP.to_vec().into());
            };
            match kind {
                result::DONE => {
                    let part = |i: usize| parts.get(i).and_then(Json::as_array).unwrap_or_default();
                    scopes::mark_used(file, part(1).iter().filter_map(|it| number(Some(it))));
                    return Ok(part(0)
                        .iter()
                        .filter_map(|it| report_of(it, &offsets))
                        .collect());
                }
                result::FAILED => {
                    return Err(Failure {
                        rule: number(parts.first()),
                        line: number(parts.get(2)),
                        message: parts
                            .get(1)
                            .and_then(Json::as_str)
                            .unwrap_or_default()
                            .to_vec(),
                    });
                }
                result::NEEDS_PLUGINS if !parts.is_empty() => {
                    for position in parts.iter().filter_map(|it| number(Some(it))) {
                        let state = self.state.lock();
                        let Some(plugin) = state.plugins.get(position as usize) else {
                            return Err(OUT_OF_STEP.to_vec().into());
                        };
                        let (location, first_rule) = (plugin.location.clone(), plugin.first_rule);
                        drop(state);
                        self.load_in(vm, &location, Some((position as usize, first_rule)))?;
                    }
                }
                _ => return Err(OUT_OF_STEP.to_vec().into()),
            }
        }
    }
}

/// `{ name, rules: [{ name, type, fixable, hasSuggestions, schema, defaultOptions }] }`. The rules are
/// numbered from `first`, in that order.
fn plugin_of(described: &Json, first: u32) -> Plugin {
    let name = described
        .get(b"name")
        .and_then(Json::as_str)
        .unwrap_or_default();
    let rules = described
        .get(b"rules")
        .and_then(Json::as_array)
        .unwrap_or_default();
    let rule = |(i, it): (usize, &Json)| {
        Arc::new(Rule {
            id: [
                name,
                b"/",
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
            index: first + i as u32,
        })
    };
    let mut rules: Vec<Arc<Rule>> = rules.iter().enumerate().map(rule).collect();
    rules.sort_by(|a, b| a.id.cmp(&b.id));
    Plugin {
        name: name.into(),
        rules,
    }
}
