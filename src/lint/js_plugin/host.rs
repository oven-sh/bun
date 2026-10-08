//! The workers, and the conversation with one about a file.

use super::offsets::Offsets;
use super::rules::{Configured, FileSettings, Plugin, Rule, Schema};
use super::wire::{self, ToWorker, from_worker};
use super::{ast, schema};
use crate::ast::File;
use crate::fix::Fix;
use crate::linter::write_json_string;
use crate::options::Json;
use crate::rule::Kind;
use crate::selector::Selector;
use crate::span::Span;
use bun_threading::{Condition, Guarded};
use std::sync::Arc;

/// Both ends of the pipes to a process. Dropping it closes them, at which the process ends.
pub trait Channel: Send {
    /// Writes all of `bytes`.
    fn send(&mut self, bytes: &[u8]) -> Result<(), Vec<u8>>;
    /// Reads until `into` is full.
    fn receive(&mut self, into: &mut [u8]) -> Result<(), Vec<u8>>;
}

/// Starts the running executable with [`BOOTSTRAP`](super::BOOTSTRAP).
pub type Spawn<'e> = dyn Fn() -> Result<Box<dyn Channel>, Vec<u8>> + Sync + 'e;

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
    pub message: Vec<u8>,
}

impl From<Vec<u8>> for Failure {
    fn from(message: Vec<u8>) -> Failure {
        Failure { rule: None, message }
    }
}

struct Worker {
    channel: Box<dyn Channel>,
    /// How many of [`State::plugins`] it has loaded.
    plugins: usize,
    /// The ids of the [`FileSettings`] and the [`Configured`] that it was told. Sorted.
    told: Vec<u32>,
    /// The selectors that it has sent, in that order. `None`: it cannot be parsed.
    selectors: Vec<Option<Selector>>,
    /// To write messages in.
    buffer: Vec<u8>,
}

/// A plugin, as it was asked for.
struct Loaded {
    /// The content of [`ToWorker::Load`].
    request: Vec<u8>,
    plugin: Arc<Plugin>,
}

#[derive(Default)]
struct State {
    idle: Vec<Worker>,
    /// How many workers there are, idle or not.
    workers: usize,
    plugins: Vec<Loaded>,
    rules: u32,
}

/// The workers. All threads share it.
pub struct Host<'e> {
    spawn: &'e Spawn<'e>,
    cwd: Vec<u8>,
    program: Vec<u8>,
    max_workers: usize,
    state: Guarded<State>,
    is_idle: Condition,
}

impl Worker {
    fn receive(&mut self) -> Result<(u32, Vec<u8>), Vec<u8>> {
        let mut header = [0; 8];
        self.channel.receive(&mut header)?;
        let [a, b, c, d, kind @ ..] = header;
        let mut content = vec![0; u32::from_le_bytes([a, b, c, d]) as usize];
        self.channel.receive(&mut content)?;
        Ok((u32::from_le_bytes(kind), content))
    }

    fn send(&mut self) -> Result<(), Vec<u8>> {
        let sent = self.channel.send(&self.buffer);
        self.buffer.clear();
        sent
    }

    /// Sends `request`, and returns the description of the plugin.
    fn load(&mut self, request: &[u8]) -> Result<Json, Vec<u8>> {
        wire::message(&mut self.buffer, ToWorker::Load, |out| out.extend_from_slice(request));
        self.send()?;
        match self.receive()? {
            (from_worker::LOADED, json) => crate::json::parse(&json).ok_or_else(|| b"The worker is out of step.".to_vec()),
            (_, why) => Err(why),
        }
    }

    /// Adds what is in `json` to what is sent next, unless the worker has it.
    fn tell(&mut self, kind: ToWorker, id: u32, json: &[u8]) {
        if let Err(at) = self.told.binary_search(&id) {
            self.told.insert(at, id);
            wire::message(&mut self.buffer, kind, |out| out.extend_from_slice(json));
        }
    }

    /// Takes in `[new selectors, indices of selectors]`, adds a description of the new ones to `out`, and returns the
    /// selectors at the indices.
    fn selectors(&mut self, request: &[u8], out: &mut Vec<u8>) -> Vec<Option<&Selector>> {
        let request = crate::json::parse(request);
        let part = |i: usize| request.as_ref().and_then(|it| it.as_array()?.get(i)?.as_array()).unwrap_or_default();
        if !part(0).is_empty() {
            // For each `[attributeCount, identifierCount]`, or the message of what ESLint throws.
            wire::message(out, ToWorker::Selectors, |out| {
                for (i, source) in part(0).iter().enumerate() {
                    out.push(if i == 0 { b'[' } else { b',' });
                    let parsed = Selector::parse(source.as_str().unwrap_or_default());
                    match &parsed {
                        Ok(selector) => {
                            let counts = format!("[{},{}]", selector.attribute_count(), selector.identifier_count());
                            out.extend_from_slice(counts.as_bytes());
                        }
                        Err(error) => write_json_string(out, error.message()),
                    }
                    self.selectors.push(parsed.ok());
                }
                out.push(b']');
            });
        }
        let index = |it: &Json| match it {
            Json::Number(index) => self.selectors.get(*index as usize)?.as_ref(),
            _ => None,
        };
        part(1).iter().map(index).collect()
    }
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
    let at = |it: &Json| Some(offsets.to_bytes(number(Some(it))?));
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
        let data = data.iter().filter_map(|(key, value)| Some((std::str::from_utf8(key).ok()?.into(), value.as_str()?.to_vec())));
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

impl<'e> Host<'e> {
    /// `cwd`: ESLint's `context.cwd`. No worker is started before it is needed, and never more than
    /// `max_workers`.
    pub fn new(spawn: &'e Spawn<'e>, cwd: &[u8], max_workers: usize) -> Host<'e> {
        Host {
            spawn,
            cwd: cwd.to_vec(),
            program: schema::PROGRAM.iter().flat_map(|it| it.1.bytes()).collect(),
            max_workers: max_workers.max(1),
            state: Guarded::new(State::default()),
            is_idle: Condition::default(),
        }
    }

    /// For the harness: another program than [`PROGRAM`](super::PROGRAM).
    #[doc(hidden)]
    pub fn set_program(&mut self, program: Vec<u8>) {
        self.program = program;
    }

    fn start(&self) -> Result<Worker, Vec<u8>> {
        let mut worker = Worker {
            channel: (self.spawn)()?,
            plugins: 0,
            told: Vec::new(),
            selectors: Vec::new(),
            buffer: Vec::new(),
        };
        wire::message(&mut worker.buffer, ToWorker::Program, |out| out.extend_from_slice(&self.program));
        wire::message(&mut worker.buffer, ToWorker::Start, |out| schema::write_start(&self.cwd, out));
        worker.send()?;
        Ok(worker)
    }

    /// A worker that is idle, or a new one, or the next that becomes idle. It has all the plugins.
    fn acquire(&self) -> Result<Worker, Vec<u8>> {
        let mut state = self.state.lock();
        let found = loop {
            if let Some(worker) = state.idle.pop() {
                break Some(worker);
            }
            if state.workers < self.max_workers {
                state.workers += 1;
                break None;
            }
            self.is_idle.wait_guarded(&mut state);
        };
        let loaded = found.as_ref().map_or(0, |it| it.plugins);
        let requests: Vec<Vec<u8>> = state.plugins.iter().skip(loaded).map(|it| it.request.clone()).collect();
        drop(state);
        let prepare = || {
            let mut worker = match found {
                Some(worker) => worker,
                None => self.start()?,
            };
            for request in &requests {
                worker.load(request)?;
                worker.plugins += 1;
            }
            Ok(worker)
        };
        prepare().inspect_err(|_| self.lose())
    }

    fn release(&self, worker: Worker) {
        self.state.lock().idle.push(worker);
        self.is_idle.notify_one();
    }

    /// A worker is gone.
    fn lose(&self) {
        self.state.lock().workers -= 1;
        self.is_idle.notify_one();
    }

    /// Loads a plugin. `specifier`: a path, relative to `directory`, or the name of a package, which
    /// is looked for from there. `alias`: the prefix of its rules, if it is not the name that the
    /// plugin has for itself.
    pub fn load(&self, directory: &[u8], specifier: &[u8], alias: Option<&[u8]>) -> Result<Arc<Plugin>, Vec<u8>> {
        let mut request = b"[".to_vec();
        for part in [Some(directory), Some(specifier), alias] {
            match part {
                Some(part) => write_json_string(&mut request, part),
                None => request.extend_from_slice(b"null"),
            }
            request.push(b',');
        }
        request.pop();
        request.push(b']');
        let known = |state: &State| state.plugins.iter().find(|it| it.request == request).map(|it| Arc::clone(&it.plugin));
        if let Some(plugin) = known(&self.state.lock()) {
            return Ok(plugin);
        }
        let mut worker = self.acquire()?;
        let described = match worker.load(&request) {
            Ok(described) => described,
            Err(why) => {
                // It is as it was, if it is still there.
                self.release(worker);
                return Err(why);
            }
        };
        let mut state = self.state.lock();
        // Another thread was faster, or has loaded another one, which this worker lacks.
        if known(&state).is_some() || state.plugins.len() != worker.plugins {
            drop(state);
            drop(worker);
            self.lose();
            return self.load(directory, specifier, alias);
        }
        let plugin = Arc::new(plugin_of(&described, state.rules));
        state.rules += plugin.rules.len() as u32;
        state.plugins.push(Loaded {
            request,
            plugin: Arc::clone(&plugin),
        });
        worker.plugins += 1;
        drop(state);
        self.release(worker);
        Ok(plugin)
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
        let mut worker = self.acquire()?;
        match converse(&mut worker, file, settings, enabled, wants_fixes) {
            Ok(result) => {
                self.release(worker);
                result
            }
            Err(why) => {
                drop(worker);
                self.lose();
                Err([b"A worker for JavaScript plugins has failed: ", &why[..]].concat().into())
            }
        }
    }
}

/// The outer `Err`: the worker is of no more use.
fn converse<'a>(
    worker: &mut Worker,
    file: &'a File<'a>,
    settings: &FileSettings,
    enabled: &[&Configured],
    wants_fixes: bool,
) -> Result<Result<Vec<Report>, Failure>, Vec<u8>> {
    let text = file.text();
    let offsets = Offsets::new(text);
    worker.tell(ToWorker::Settings, settings.id, &settings.json);
    for configured in enabled {
        worker.tell(ToWorker::Configure, configured.id, &configured.json);
    }
    let has_mark = text.starts_with(b"\xEF\xBB\xBF");
    wire::message(&mut worker.buffer, ToWorker::Lint, |out| {
        let path = file.path();
        let flags = u32::from(wants_fixes) | u32::from(has_mark) << 1;
        wire::words(out, &[flags, settings.id, enabled.len() as u32, path.len() as u32]);
        for configured in enabled {
            wire::words(out, &[configured.id]);
        }
        out.extend_from_slice(path);
        out.extend_from_slice(if has_mark { &text[3..] } else { text });
    });
    worker.send()?;
    loop {
        let (kind, content) = worker.receive()?;
        match kind {
            from_worker::DONE if content.is_empty() => return Ok(Ok(Vec::new())),
            from_worker::DONE => {
                let reports = crate::json::parse(&content);
                let reports = reports.as_ref().and_then(Json::as_array).ok_or(b"It is out of step.".as_slice())?;
                return Ok(Ok(reports.iter().filter_map(|it| report_of(it, &offsets)).collect()));
            }
            // `[rule, message]`
            from_worker::FAILED => {
                let failure = crate::json::parse(&content);
                let part = |i: usize| failure.as_ref().and_then(|it| it.as_array()?.get(i));
                return Ok(Err(Failure {
                    rule: number(part(0)),
                    message: part(1).and_then(Json::as_str).unwrap_or_default().to_vec(),
                }));
            }
            from_worker::NEEDS_AST | from_worker::NEEDS_MATCHES => {
                let mut buffer = std::mem::take(&mut worker.buffer);
                let selectors = worker.selectors(&content, &mut buffer);
                match kind {
                    from_worker::NEEDS_AST => {
                        wire::message(&mut buffer, ToWorker::Ast, |out| ast::write(file, &offsets, &selectors, out));
                    }
                    _ => wire::message(&mut buffer, ToWorker::Matches, |out| {
                        ast::write_only_matches(file, &offsets, &selectors, out);
                    }),
                }
                worker.buffer = buffer;
                worker.send()?;
            }
            _ => return Err(b"It is out of step.".to_vec()),
        }
    }
}

/// `{ name, rules: [{ name, type, fixable, hasSuggestions, schema, defaultOptions }] }`. The rules are
/// numbered from `first`, in that order.
fn plugin_of(described: &Json, first: u32) -> Plugin {
    let name = described.get(b"name").and_then(Json::as_str).unwrap_or_default();
    let rules = described.get(b"rules").and_then(Json::as_array).unwrap_or_default();
    let rule = |(i, it): (usize, &Json)| {
        Arc::new(Rule {
            id: [name, b"/", it.get(b"name").and_then(Json::as_str).unwrap_or_default()].concat().into(),
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
            default_options: it.get(b"defaultOptions").and_then(Json::as_array).unwrap_or_default().to_vec(),
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
