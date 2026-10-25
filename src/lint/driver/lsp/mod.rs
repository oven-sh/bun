//! `bun lint --no-script --lsp` and `bun fmt --no-script --lsp`: a language server on standard input and output.
//!
//! The thread that reads the messages keeps the documents. Each workspace folder has a thread that lints and formats what is
//! in it, with the folder as the working directory and its `bunfig.toml`: as `bun lint` does there. It keeps the
//! configurations that it has read until one of their files changes. One more thread is for the documents that are in no
//! folder: nothing of theirs is run.
//!
//! Standard output carries the messages and nothing else: what the linter and the formatter have to say goes to the
//! client as a message, or is an answer.
//!
//! - [`rpc`]: the messages.
//! - [`text`]: places in a document.
//! - [`session`]: a text through the linter.
//! - [`answers`]: diagnostics, code actions, edits.

mod answers;
mod rpc;
mod session;
mod text;

use crate::cli::{Options, UsageError};
use crate::fmt::Formatted;
use crate::paths;
use crate::results::FileResult;
use crate::run::{Environment, Fatal, Linted, Script, Stream};
use answers::{Directives, FIX_ALL, Places, QUICK_FIX, wants};
use bun_core::strings;
use bun_lint::js_plugin::{Engine, Vm, Work};
use bun_lint::linter::LintMessage;
use bun_lint::options::Json;
use bun_sema::util::FxHashMap;
use bun_threading::{Condition, Guarded};
use rpc::{ErrorCode, Frame, Incoming, Reader, Writer, dig, number, object};
use session::{How, Session, Weight};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use text::{Encoding, Lines, Range};

/// What the server does: `bun lint --no-script --lsp` does both, `bun fmt --no-script --lsp` formats, and lints where the
/// build has `bun lint`.
#[derive(Copy, Clone)]
pub struct Features {
    pub format: bool,
    pub lint: bool,
}

/// What follows the command on the command line, `--lsp` included: the flags of the command that started the server.
/// The other command runs with its defaults.
#[derive(Copy, Clone)]
pub enum Args<'a> {
    Lint(&'a [&'a [u8]]),
    Format(&'a [&'a [u8]]),
}

/// The command whose work an error belongs to.
#[derive(Copy, Clone)]
enum Half {
    Lint,
    Format,
}

impl Half {
    /// The name of the command, which its errors are shown under.
    fn prefix(self) -> &'static [u8] {
        match self {
            Half::Lint => b"bun lint: ",
            Half::Format => b"bun fmt: ",
        }
    }
}

/// The engine of one workspace folder while its configurations stay as they are. Its realms run on threads of their
/// own.
pub trait Realms: Engine + Send {
    /// Ends the threads, and waits for them. Before the process exits.
    fn end_all(&self);
    /// Frees the realms. Once the folder has moved on to other configurations, or is closed.
    fn free_all(&self);
}

/// What the server takes from the process, beside the [`Environment`].
pub struct Process<'p> {
    /// Reads some of what the client sends. 0: there is no more.
    pub read: &'p (dyn Fn(&mut [u8]) -> usize + Sync),
    /// Writes all of it to the client.
    pub write: &'p (dyn Fn(&[u8]) + Sync),
    /// An engine that nothing else uses, for one workspace folder. `None`: the process has none to give, and the
    /// folder's plugins don't run.
    pub engines: &'p (dyn Fn() -> Option<Box<dyn Realms + 'p>> + Sync),
    /// Ends the process at once, whatever its threads are doing.
    pub exit: &'p (dyn Fn(u8) -> ! + Sync),
    pub features: Features,
    /// The flags of `bun lint` in a directory: those of its `bunfig.toml` and the ones above it, then the arguments.
    /// `Err`: what is wrong with one of them.
    pub lint_options: &'p (dyn Fn(&[u8], &[&[u8]]) -> Result<Options, Vec<u8>> + Sync),
    /// The same for `bun fmt`.
    pub format_options:
        &'p (dyn Fn(&[u8], &[&[u8]]) -> Result<crate::fmt::cli::Options, Vec<u8>> + Sync),
}

/// For what is in no workspace folder, and for a folder that the process has no engine for.
struct NoEngine {
    why: &'static [u8],
    /// A plugin would have run since this was last looked at.
    refused: AtomicBool,
}

impl NoEngine {
    fn new(why: &'static [u8]) -> NoEngine {
        NoEngine {
            why,
            refused: AtomicBool::new(false),
        }
    }

    fn refuse(&self) -> Result<(), Vec<u8>> {
        self.refused.store(true, Ordering::Relaxed);
        Err(self.why.to_vec())
    }
}

impl Engine for NoEngine {
    fn thread_has_realm(&self) -> bool {
        false
    }

    fn with_vm_here(&self, _: usize, _: &mut dyn FnMut(&mut dyn Vm)) -> Result<(), Vec<u8>> {
        self.refuse()
    }

    fn with_vm(&self, _: usize, _: &mut (dyn FnMut(&mut dyn Vm) + Send)) -> Result<(), Vec<u8>> {
        self.refuse()
    }

    fn work_off(&self, _: &dyn Work, meanwhile: &mut dyn FnMut()) -> Result<(), Vec<u8>> {
        meanwhile();
        self.refuse()
    }

    fn busy(&self) -> usize {
        0
    }
}

/// A document as it was at one moment.
struct Document {
    uri: Vec<u8>,
    /// What the client calls this state of it.
    version: Json,
    /// What the server calls it: higher for a later one, of whatever document.
    serial: u64,
    /// What it is linted and formatted as.
    path: Vec<u8>,
    text: Vec<u8>,
}

enum Job {
    Lint {
        document: Arc<Document>,
        with_types: bool,
    },
    /// `textDocument/codeAction`
    Actions {
        id: Json,
        document: Arc<Document>,
        range: Range,
        only: Option<Vec<Vec<u8>>>,
    },
    /// `textDocument/formatting`, and with a range `textDocument/rangeFormatting`.
    Format {
        id: Json,
        document: Arc<Document>,
        range: Option<Range>,
    },
}

#[derive(Default)]
struct Queue {
    /// What the client waits for goes first.
    requests: VecDeque<Job>,
    lints: VecDeque<Job>,
    /// It goes up when a configuration may have changed.
    generation: u64,
    is_closed: bool,
}

/// A workspace folder, or what is in none.
struct Root {
    /// `/` for what is in no folder.
    path: Vec<u8>,
    is_folder: bool,
    queue: Guarded<Queue>,
    has_work: Condition,
}

impl Root {
    fn change(&self, change: impl FnOnce(&mut Queue)) {
        change(&mut self.queue.lock());
        self.has_work.notify_one();
    }

    /// Waits for a job. With it: [`Queue::generation`]. `None`: there are no more.
    fn take(&self) -> Option<(Job, u64)> {
        let mut queue = self.queue.lock();
        loop {
            if queue.is_closed {
                return None;
            }
            let job = queue.requests.pop_front();
            if let Some(job) = job.or_else(|| queue.lints.pop_front()) {
                return Some((job, queue.generation));
            }
            self.has_work.wait_guarded(&mut queue);
        }
    }
}

/// What the client can do.
struct Client {
    encoding: Encoding,
    has_versioned_edits: bool,
    watches_files: bool,
}

/// What the user has set in the editor.
#[derive(Copy, Clone, PartialEq, Eq)]
struct Settings {
    lints: bool,
    formats: bool,
    /// Not only when a document is opened or saved.
    lints_on_type: bool,
}

impl Settings {
    /// All that `features` has.
    fn new(features: Features) -> Settings {
        Settings {
            lints: features.lint,
            formats: features.format,
            lints_on_type: true,
        }
    }

    /// `{ lint: { enable, run }, format: { enable } }`. What is not there stays as it is. What `features` lacks stays
    /// off.
    fn read(&mut self, json: &Json, features: Features) {
        let flag = |path: &[&str]| dig(json, path).and_then(Json::as_bool);
        self.lints = features.lint && flag(&["lint", "enable"]).unwrap_or(self.lints);
        self.formats = features.format && flag(&["format", "enable"]).unwrap_or(self.formats);
        match dig(json, &["lint", "run"]).and_then(Json::as_str) {
            Some(b"onType") => self.lints_on_type = true,
            Some(b"onSave") => self.lints_on_type = false,
            _ => {}
        }
    }
}

/// The problems of a document, for its code actions.
struct Known {
    serial: u64,
    had_types: bool,
    /// How a comment turns a rule off in the document's language, if one can.
    directives: Option<Directives>,
    messages: Vec<LintMessage>,
    /// The text with every fix applied, once a code action has asked for it. `Some(None)`: there is none.
    fixed: Option<Option<Vec<u8>>>,
}

/// What all threads share.
struct Server<'s> {
    args: Args<'s>,
    environment: &'s Environment<'s>,
    process: &'s Process<'s>,
    out: Writer<'s>,
    client: OnceLock<Client>,
    settings: Guarded<Settings>,
    folders: Guarded<Vec<Vec<u8>>>,
    /// [`Document::serial`] of each open document, by its URI.
    latest: Guarded<FxHashMap<Vec<u8>, u64>>,
    /// The requests that are not answered yet, and whether the client has taken each back.
    pending: Guarded<Vec<(Json, bool)>>,
    /// The engines of the folders, while their threads use them: to end before the process does.
    realms: Guarded<Vec<Arc<dyn Realms + 's>>>,
}

/// The files that say how a file is linted or formatted, or whether it is at all.
const WATCHED: [&str; 13] = [
    "**/bunfig.toml",
    "**/package.json",
    "**/{eslint,oxlint,prettier,vite}.config.{js,mjs,cjs,ts,mts,cts}",
    "**/.eslintrc",
    "**/.eslintrc.{js,cjs,json,yaml,yml}",
    "**/.oxlintrc.{json,jsonc}",
    "**/.oxfmtrc.{json,jsonc}",
    "**/.prettierrc",
    "**/.prettierrc.{js,mjs,cjs,ts,mts,cts,json,json5,yaml,yml,toml}",
    "**/.editorconfig",
    "**/{.gitignore,.eslintignore,.prettierignore}",
    "**/{tsconfig,jsconfig}.json",
    "**/tsconfig.*.json",
];

/// Whether a file called `name` is one of [`WATCHED`]: for a client that does not watch.
fn is_watched(name: &[u8]) -> bool {
    let stem = strings::split_once_char(name, b'.').map_or(name, |it| it.0);
    matches!(
        name,
        b"bunfig.toml"
            | b"package.json"
            | b".editorconfig"
            | b".gitignore"
            | b".eslintignore"
            | b".prettierignore"
    ) || [&b".eslintrc"[..], b".oxlintrc", b".oxfmtrc", b".prettierrc"]
        .iter()
        .any(|it| name.starts_with(it))
        || (matches!(stem, b"eslint" | b"oxlint" | b"prettier" | b"vite")
            && strings::contains(name, b".config."))
        || (matches!(stem, b"tsconfig" | b"jsconfig") && name.ends_with(b".json"))
}

/// The path that a `file:` URI names, with `/` between its parts. `None`: it is another kind of URI.
fn path_of(uri: &[u8]) -> Option<Vec<u8>> {
    let rest = uri.strip_prefix(b"file://")?;
    let (host, path) = rest.split_at(strings::index_of_char_usize(rest, b'/')?);
    let path = bun_url::PercentEncoding::decode_alloc(path).ok()?;
    Some(match (host, &path[..]) {
        (b"" | b"localhost", [b'/', drive, b':', ..])
            if cfg!(windows) && drive.is_ascii_alphabetic() =>
        {
            path[1..].to_vec()
        }
        (b"" | b"localhost", _) => path.into_vec(),
        (host, _) => [b"//", host, &path].concat(),
    })
}

/// What files in the language `id` end in.
fn extension_of(id: &[u8]) -> &'static [u8] {
    match id {
        b"javascript" => b".js",
        b"javascriptreact" => b".jsx",
        b"typescript" => b".ts",
        b"typescriptreact" => b".tsx",
        b"json" => b".json",
        b"jsonc" => b".jsonc",
        b"json5" => b".json5",
        b"css" => b".css",
        b"scss" => b".scss",
        b"less" => b".less",
        b"html" => b".html",
        b"vue" => b".vue",
        b"svelte" => b".svelte",
        b"astro" => b".astro",
        b"markdown" => b".md",
        b"mdx" => b".mdx",
        b"yaml" => b".yaml",
        b"graphql" => b".graphql",
        b"handlebars" => b".hbs",
        b"toml" => b".toml",
        _ => b"",
    }
}

/// What a document that is no file is called: `Untitled-1.ts` for `untitled:Untitled-1` in TypeScript.
fn name_of(uri: &[u8], language: &[u8]) -> Vec<u8> {
    let after_scheme = strings::split_once_char(uri, b':').map_or(uri, |it| it.1);
    let end = strings::index_of_any(after_scheme, b"?#").unwrap_or(after_scheme.len());
    let decoded = bun_url::PercentEncoding::decode_alloc(&after_scheme[..end]);
    let path = decoded.as_deref().unwrap_or(&after_scheme[..end]);
    let name = paths::basename(path);
    match paths::extname(name) {
        b"" => [name, extension_of(language)].concat(),
        _ => name.to_vec(),
    }
}

impl<'s> Server<'s> {
    fn client(&self) -> &Client {
        self.client.get_or_init(|| Client {
            encoding: Encoding::Utf16,
            has_versioned_edits: false,
            watches_files: false,
        })
    }

    fn features(&self) -> Features {
        self.process.features
    }

    /// `type`: 1 for an error, 2 for a warning, 3 for a note.
    fn tell(&self, method: &str, kind: u32, message: &[u8]) {
        let params = object([("type", number(kind)), ("message", rpc::text(message))]);
        self.out.notify(method, params);
    }

    /// Puts an error of `half` before the user, under the name of its command.
    fn show_error(&self, half: Half, message: &[u8]) {
        self.tell("window/showMessage", 1, &[half.prefix(), message].concat());
    }

    /// The half that the command that started the server is.
    fn half(&self) -> Half {
        match self.args {
            Args::Lint(_) => Half::Lint,
            Args::Format(_) => Half::Format,
        }
    }

    /// Ends the process with `code`, once the engines have ended their threads.
    fn exit(&self, code: u8) -> ! {
        let realms: Vec<Arc<dyn Realms + 's>> = std::mem::take(&mut *self.realms.lock());
        for realms in &realms {
            realms.end_all();
        }
        (self.process.exit)(code);
    }

    fn is_in_a_folder(&self, path: &[u8]) -> bool {
        (self.folders.lock().iter()).any(|it| paths::is_at_or_inside(it, path))
    }

    fn is_latest(&self, document: &Document) -> bool {
        self.latest.lock().get(&document.uri) == Some(&document.serial)
    }

    fn send_diagnostics(&self, document: &Document, diagnostics: Vec<Json>) {
        self.out.notify(
            "textDocument/publishDiagnostics",
            object([
                ("uri", rpc::text(&document.uri)),
                ("version", document.version.clone()),
                ("diagnostics", Json::Array(diagnostics)),
            ]),
        );
    }

    /// Unless the document has changed or is closed.
    fn publish(&self, document: &Document, diagnostics: Vec<Json>) {
        let latest = self.latest.lock();
        if latest.get(&document.uri) == Some(&document.serial) {
            self.send_diagnostics(document, diagnostics);
        }
    }

    /// Nothing is said about `document` any more.
    fn close(&self, document: &Document) {
        let mut latest = self.latest.lock();
        latest.remove(&document.uri);
        self.send_diagnostics(document, Vec::new());
    }

    /// Whether the request `id`, which is about `document`, is still to be answered. If not it is answered here.
    fn is_wanted(&self, id: &Json, document: &Document) -> bool {
        let is_cancelled = (self.pending.lock().iter()).any(|it| it.0 == *id && it.1);
        let is_latest = self.is_latest(document);
        if is_cancelled {
            self.cancel(id);
        } else if !is_latest {
            self.finish(
                id,
                Err((ErrorCode::ContentModified, "The document has changed")),
            );
        }
        !is_cancelled && is_latest
    }

    fn cancel(&self, id: &Json) {
        self.finish(
            id,
            Err((ErrorCode::RequestCancelled, "The request was cancelled")),
        );
    }

    fn finish(&self, id: &Json, answer: Result<Json, (ErrorCode, &str)>) {
        self.pending.lock().retain(|it| it.0 != *id);
        match answer {
            Ok(result) => self.out.reply(id.clone(), result),
            Err((code, message)) => self.out.fail(id.clone(), code, message),
        }
    }

    fn places<'d>(&self, document: &'d Document) -> Places<'d> {
        let client = self.client();
        Places::new(
            (&document.uri, &document.version, &document.path),
            Lines::new(&document.text, client.encoding),
            &document.text,
            client.has_versioned_edits,
        )
    }

    /// The flags of `bun lint` in `root`.
    fn lint_options_of(&self, root: &Root) -> Result<Options, Vec<u8>> {
        let args: &[&[u8]] = match self.args {
            Args::Lint(args) => args,
            Args::Format(_) => &[],
        };
        match root.is_folder {
            true => (self.process.lint_options)(&root.path, args),
            false => Options::parse(args).map_err(|UsageError(message)| message),
        }
    }

    /// The flags of `bun fmt` in `root`.
    fn format_options_of(&self, root: &Root) -> Result<crate::fmt::cli::Options, Vec<u8>> {
        let args: &[&[u8]] = match self.args {
            Args::Format(args) => args,
            Args::Lint(_) => &[],
        };
        match root.is_folder {
            true => (self.process.format_options)(&root.path, args),
            false => crate::fmt::cli::Options::parse(args).map_err(|UsageError(message)| message),
        }
    }

    /// What the thread of `root` does. A folder gets an engine per generation, which is freed once the thread is done
    /// with it.
    fn work(&self, root: &Root) {
        let mut next = root.take();
        while let Some(first) = next.take() {
            let realms: Option<Arc<dyn Realms + 's>> = match root.is_folder {
                true => (self.process.engines)().map(Arc::from),
                false => None,
            };
            let Some(realms) = realms else {
                let why: &[u8] = match root.is_folder {
                    true => b"Plugins do not run in the editor on this platform",
                    false => b"Plugins only run for files in a workspace folder",
                };
                let no_engine = NoEngine::new(why);
                next = self.work_with(root, &no_engine, Some(&no_engine), first);
                continue;
            };
            self.realms.lock().push(Arc::clone(&realms));
            next = self.work_with(root, &*realms, None, first);
            realms.free_all();
            self.realms.lock().retain(|it| !Arc::ptr_eq(it, &realms));
        }
    }

    /// Does `first` and what follows it, as long as the configurations are those of `generation`. Returns the first job that
    /// is for later ones. `no_engine`: `engine`, if it is one that refuses.
    fn work_with(
        &self,
        root: &Root,
        engine: &dyn Engine,
        no_engine: Option<&NoEngine>,
        (first, generation): (Job, u64),
    ) -> Option<(Job, u64)> {
        let run_script = |script: &Script| {
            match self.is_in_a_folder(script.cwd) {
            true => (self.environment.run_script)(script),
            false => Err(b"It is outside the workspace folders, so it was not run\n  Open its folder in the editor to use it".to_vec()),
        }
        };
        let environment = &Environment {
            cwd: root.path.clone(),
            stdout: Stream::default(),
            stderr: Stream::default(),
            is_ai_agent: false,
            is_github_action: false,
            run_script: &run_script,
            js_engine: engine,
            ..*self.environment
        };
        let mut worker = Worker {
            server: self,
            root,
            environment,
            no_engine,
            format_options: None,
            known: FxHashMap::default(),
            told: Vec::new(),
        };
        let Settings { lints, formats, .. } = *self.settings.lock();
        let options = lints.then(|| self.lint_options_of(root));
        if let Some(Err(why)) = &options {
            worker.show_error_once(Half::Lint, why);
        }
        match formats.then(|| self.format_options_of(root)) {
            Some(Ok(options)) => worker.format_options = Some(options),
            Some(Err(why)) => worker.show_error_once(Half::Format, &why),
            None => {}
        }
        let all = |session: Option<&Session>| {
            let mut job = first;
            loop {
                worker.handle(session, job);
                match root.take() {
                    Some((taken, now)) if now == generation => job = taken,
                    other => return other,
                }
            }
        };
        match options {
            Some(Ok(options)) => session::with_session(&options, environment, |session| {
                let refusal = session.refusal();
                if let Some(refusal) = &refusal {
                    self.show_error(Half::Lint, refusal);
                }
                all(refusal.is_none().then_some(session))
            }),
            _ => all(None),
        }
    }
}

/// The thread of a [`Root`], while its configurations stay as they are.
struct Worker<'w, 's> {
    server: &'w Server<'s>,
    root: &'w Root,
    environment: &'w Environment<'w>,
    /// The engine, if it is one that refuses.
    no_engine: Option<&'w NoEngine>,
    /// The flags of `bun fmt` in the root, read once per generation. `None`: formatting is off, or they could not be
    /// read, which the user was told.
    format_options: Option<crate::fmt::cli::Options>,
    /// By URI.
    known: FxHashMap<Vec<u8>, Known>,
    /// What the user has been told, which is not said again. An error is kept with the name of its command: both
    /// halves read the same `bunfig.toml`, and each reports its own failure.
    told: Vec<Vec<u8>>,
}

impl Worker<'_, '_> {
    fn tell_once(&mut self, line: Vec<u8>, tell: impl FnOnce(&[u8])) {
        if !self.told.contains(&line) {
            tell(&line);
            self.told.push(line);
        }
    }

    /// [`Server::show_error`], once per text and half.
    fn show_error_once(&mut self, half: Half, message: &[u8]) {
        let server = self.server;
        self.tell_once([half.prefix(), message].concat(), |line| server.tell("window/showMessage", 1, line));
    }

    /// Said when a plugin would have run, which is when the user looks for it.
    fn say_if_refused(&mut self) {
        let server = self.server;
        if let Some(no_engine) = self.no_engine
            && self.root.is_folder
            && no_engine.refused.swap(false, Ordering::Relaxed)
        {
            let why = no_engine.why.to_vec();
            self.tell_once(why, |why| server.tell("window/logMessage", 2, why));
        }
    }

    /// Lints `document`. `None`: it cannot be, which the user is told. `files == 0` in the result: it is not one to
    /// lint, which the user is told if there is a reason, like ESLint being needed for it.
    fn lint(&mut self, session: &Session, document: &Document, how: How) -> Option<Linted> {
        let server = self.server;
        let linted = session.lint(&document.path, document.text.clone(), how);
        for (weight, line) in session.notes() {
            let kind = if weight == Weight::Warning { 2 } else { 3 };
            self.tell_once(line, |line| server.tell("window/logMessage", kind, line));
        }
        self.say_if_refused();
        match linted {
            Ok(linted) => Some(linted),
            Err(Fatal(why)) => {
                self.show_error_once(Half::Lint, &why);
                None
            }
        }
    }

    /// The problems of `document` as they are known, or as they are found now.
    fn problems(&mut self, session: &Session, document: &Document) -> Option<&Known> {
        if self
            .known
            .get(&document.uri)
            .is_none_or(|it| it.serial != document.serial)
        {
            let result = self.lint(session, document, How::default())?.results.pop();
            self.note(document, result);
        }
        self.known.get(&document.uri)
    }

    fn note(&mut self, document: &Document, result: Option<FileResult>) {
        let known = Known {
            serial: document.serial,
            had_types: result.as_ref().is_some_and(|it| it.had_types),
            directives: (result.as_ref().and_then(|it| it.linted.as_ref()))
                .and_then(|it| Directives::of(&it.config, &document.path)),
            messages: result.map(|it| it.messages).unwrap_or_default(),
            fixed: None,
        };
        self.known.insert(document.uri.clone(), known);
    }

    /// The text of `document` with every fix applied, found once per [`Document::serial`]. `None`: nothing is fixed.
    fn fixed(&mut self, session: &Session, document: &Document, with_types: bool) -> Option<&[u8]> {
        let is_found = (self.known.get(&document.uri)).is_some_and(|it| it.fixed.is_some());
        if !is_found {
            let how = How {
                with_types,
                fixes: true,
            };
            let fixed = self
                .lint(session, document, how)
                .and_then(|mut it| it.results.pop());
            let text = (fixed.as_ref().filter(|it| it.is_fixed))
                .and_then(FileResult::text_to_write)
                .map(<[u8]>::to_vec);
            if let Some(known) = self.known.get_mut(&document.uri) {
                known.fixed = Some(text);
            }
        }
        self.known.get(&document.uri)?.fixed.as_ref()?.as_deref()
    }

    fn handle(&mut self, session: Option<&Session>, job: Job) {
        let server = self.server;
        // Of the documents that are closed nothing is kept.
        {
            let latest = server.latest.lock();
            self.known.retain(|uri, _| latest.contains_key(uri));
        }
        match job {
            Job::Lint {
                document,
                with_types,
            } => {
                if !server.is_latest(&document) {
                    return;
                }
                let how = How {
                    with_types,
                    fixes: false,
                };
                let Some(mut linted) = session.and_then(|it| self.lint(it, &document, how)) else {
                    self.known.remove(&document.uri);
                    return server.publish(&document, Vec::new());
                };
                if linted.files == 0 {
                    // Not one to lint: the problems it had as one are taken back, once.
                    let had_problems =
                        (self.known.get(&document.uri)).is_some_and(|it| !it.messages.is_empty());
                    self.note(&document, None);
                    if had_problems {
                        server.publish(&document, Vec::new());
                    }
                    return;
                }
                let result = linted.results.pop();
                // They take as long as it takes to check the program: when there is nothing else to do.
                let lacks_types = !with_types
                    && (session.zip(result.as_ref())).is_some_and(|(session, result)| {
                        session.wants_types(&document.path, result)
                    });
                let places = server.places(&document);
                self.note(&document, result);
                let known = self.known.get(&document.uri);
                let messages = known.map(|it| &it.messages[..]).unwrap_or_default();
                let diagnostics = messages.iter().map(|it| places.diagnostic(it));
                server.publish(&document, diagnostics.collect());
                if lacks_types {
                    self.root.change(|queue| {
                        queue.lints.push_back(Job::Lint {
                            document,
                            with_types: true,
                        });
                    });
                }
            }
            Job::Actions {
                id,
                document,
                range,
                only,
            } => {
                if server.is_wanted(&id, &document) {
                    let actions =
                        session.map(|it| self.actions(it, &document, range, only.as_deref()));
                    server.finish(&id, Ok(Json::Array(actions.unwrap_or_default())));
                }
            }
            Job::Format {
                id,
                document,
                range,
            } => {
                if server.is_wanted(&id, &document) {
                    let edits = self.format(&document, range);
                    server.finish(&id, Ok(edits.map_or(Json::Null, Json::Array)));
                }
            }
        }
    }

    fn actions(
        &mut self,
        session: &Session,
        document: &Document,
        range: Range,
        only: Option<&[Vec<u8>]>,
    ) -> Vec<Json> {
        let places = self.server.places(document);
        let Some(known) = self.problems(session, document) else {
            return Vec::new();
        };
        let with_types = known.had_types;
        let fixable = known.messages.iter().filter(|it| it.fix.is_some()).count();
        let mut actions = match wants(only, QUICK_FIX) {
            true => places.quick_fixes(&known.messages, range, known.directives),
            false => Vec::new(),
        };
        // Beside the fix of one problem, if there are others.
        let has_a_fix = actions.iter().any(|it| it.get(b"isPreferred").is_some());
        let kinds = [
            (QUICK_FIX, has_a_fix && fixable > 1),
            (FIX_ALL, fixable > 0 && wants(only, FIX_ALL)),
        ];
        if kinds.iter().any(|it| it.1)
            && let Some(fixed) = self.fixed(session, document, with_types)
        {
            let kinds = kinds.iter().filter(|it| it.1);
            actions.extend(kinds.map(|it| places.fix_all(it.0, fixed)));
        }
        actions
    }

    /// The edits that format `document`. `None`: it cannot be formatted, or is not to be.
    fn format(&mut self, document: &Document, range: Option<Range>) -> Option<Vec<Json>> {
        let server = self.server;
        let mut options = self.format_options.clone()?;
        let places = server.places(document);
        let range =
            range.map(|(start, end)| (places.lines.offset(start), places.lines.offset(end)));
        if let Some((start, end)) = range {
            // Prettier counts code units of UTF-16.
            let index = |offset: usize| {
                strings::wtf8_len_utf16(&document.text[..offset])
                    .to_string()
                    .into_bytes()
            };
            options
                .format
                .retain(|it| !matches!(it.0, b"rangeStart" | b"rangeEnd"));
            options.format.push((&b"rangeStart"[..], index(start)));
            options.format.push((&b"rangeEnd"[..], index(end)));
        }
        options.stdin_filepath = Some(paths::to_native(document.path.clone()));
        let formatted = crate::fmt::format_text(&options, self.environment, document.text.clone());
        self.say_if_refused();
        match formatted {
            Formatted::Text(text) => Some(places.edits_to(&text, range)),
            Formatted::Unchanged => Some(Vec::new()),
            Formatted::NotFormatted { stderr } => {
                server.tell("window/logMessage", 2, stderr.trim_ascii_end());
                None
            }
            Formatted::Failed { stderr } => {
                let why = stderr.trim_ascii_end();
                let why = why.strip_prefix(b"error: ").unwrap_or(why);
                self.show_error_once(Half::Format, why);
                None
            }
        }
    }
}

/// Where the server is in its life.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Phase {
    /// Before `initialize`.
    New,
    Running,
    /// After `shutdown`.
    Down,
}

/// What only the thread has that reads the messages.
struct Desk<'d, 'scope, 's> {
    server: &'d Server<'s>,
    scope: &'scope std::thread::Scope<'scope, 'd>,
    phase: Phase,
    /// By URI.
    documents: FxHashMap<Vec<u8>, Arc<Document>>,
    roots: Vec<Arc<Root>>,
    /// [`Document::serial`] of the next.
    serial: u64,
}

/// As the threads of the pool: the rules walk a tree by recursion.
const STACK: usize = 8 * bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize;

fn uri_in(params: &Json) -> Option<&[u8]> {
    dig(params, &["textDocument", "uri"])?.as_str()
}

impl<'d> Desk<'d, '_, '_> {
    /// The root of the file at `path`: the innermost folder that it is in. Its thread is started when it is first asked for.
    fn root_of(&mut self, path: &[u8]) -> Option<Arc<Root>> {
        let folders = self.server.folders.lock();
        let inside = folders.iter().filter(|it| paths::is_at_or_inside(it, path));
        let folder = inside.max_by_key(|it| it.len()).cloned();
        drop(folders);
        let is_folder = folder.is_some();
        let path = folder.unwrap_or_else(|| b"/".to_vec());
        let known = |it: &&Arc<Root>| it.path == path && it.is_folder == is_folder;
        if let Some(root) = self.roots.iter().find(known) {
            return Some(Arc::clone(root));
        }
        let root = Arc::new(Root {
            path,
            is_folder,
            queue: Guarded::default(),
            has_work: Condition::default(),
        });
        let (server, of_thread) = (self.server, Arc::clone(&root));
        let thread = std::thread::Builder::new().stack_size(STACK);
        let spawned = thread.spawn_scoped(self.scope, move || {
            bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Bun LSP"));
            server.work(&of_thread)
        });
        if spawned.is_err() {
            server.show_error(server.half(), b"Could not start a thread");
            return None;
        }
        self.roots.push(Arc::clone(&root));
        Some(root)
    }

    fn lint(&mut self, document: &Arc<Document>) {
        if !self.server.settings.lock().lints {
            return;
        }
        if let Some(root) = self.root_of(&document.path) {
            let document = Arc::clone(document);
            root.change(|queue| {
                // One that is overtaken is not even begun.
                queue.lints.retain(|it| !matches!(it, Job::Lint { document: other, .. } if other.uri == document.uri));
                queue.lints.push_back(Job::Lint {
                    document,
                    with_types: false,
                });
            });
        }
    }

    /// The configurations are read again, and every document is linted with them.
    fn look_again(&mut self) {
        for root in &self.roots {
            root.change(|queue| queue.generation += 1);
        }
        self.lint_all();
    }

    /// Every document is linted again, or has no diagnostics any more while linting is off.
    fn lint_all(&mut self) {
        let lints = self.server.settings.lock().lints;
        let documents: Vec<Arc<Document>> = self.documents.values().cloned().collect();
        for document in &documents {
            match lints {
                true => self.lint(document),
                false => self.server.publish(document, Vec::new()),
            }
        }
    }

    /// Takes in a state of the document at `uri`.
    fn keep(&mut self, uri: &[u8], version: Json, path: Vec<u8>, text: Vec<u8>) -> Arc<Document> {
        self.serial += 1;
        let document = Arc::new(Document {
            uri: uri.to_vec(),
            version,
            serial: self.serial,
            path,
            text,
        });
        self.server.latest.lock().insert(uri.to_vec(), self.serial);
        self.documents.insert(uri.to_vec(), Arc::clone(&document));
        document
    }

    fn set_folders(&mut self, added: &[Json], removed: &[Json]) {
        let path = |it: &Json| path_of(it.get(b"uri")?.as_str()?).map(|it| paths::normalize(&it));
        let removed: Vec<Vec<u8>> = removed.iter().filter_map(path).collect();
        let mut folders = self.server.folders.lock();
        folders.retain(|it| !removed.contains(it));
        for folder in added.iter().filter_map(path) {
            if !folders.contains(&folder) {
                folders.push(folder);
            }
        }
        drop(folders);
        let is_gone = |it: &Arc<Root>| it.is_folder && removed.contains(&it.path);
        for root in self.roots.iter().filter(|it| is_gone(it)) {
            let mut unanswered = VecDeque::new();
            root.change(|queue| {
                queue.is_closed = true;
                unanswered = std::mem::take(&mut queue.requests);
            });
            for job in unanswered {
                if let Job::Actions { id, .. } | Job::Format { id, .. } = job {
                    self.server.cancel(&id);
                }
            }
        }
        self.roots.retain(|it| !is_gone(it));
    }

    fn initialize(&mut self, params: &Json) -> Json {
        let server = self.server;
        let capability = |path: &[&str]| dig(params, &[&["capabilities"][..], path].concat());
        let is_on = |path: &[&str]| capability(path).and_then(Json::as_bool) == Some(true);
        let encodings = capability(&["general", "positionEncodings"]).and_then(Json::as_array);
        let takes_utf8 = encodings
            .unwrap_or_default()
            .iter()
            .any(|it| it.as_str() == Some(b"utf-8"));
        let client = server.client.get_or_init(|| Client {
            encoding: if takes_utf8 {
                Encoding::Utf8
            } else {
                Encoding::Utf16
            },
            has_versioned_edits: is_on(&["workspace", "workspaceEdit", "documentChanges"]),
            watches_files: is_on(&["workspace", "didChangeWatchedFiles", "dynamicRegistration"]),
        });
        match params.get(b"workspaceFolders").and_then(Json::as_array) {
            Some(folders) => self.set_folders(folders, &[]),
            None => {
                let uri = params
                    .get(b"rootUri")
                    .filter(|it| it.as_str().is_some())
                    .cloned();
                let path = params.get(b"rootPath").and_then(Json::as_str);
                match (uri, path) {
                    (Some(uri), _) => self.set_folders(&[object([("uri", uri)])], &[]),
                    (None, Some(path)) => {
                        let path = paths::normalize(&paths::from_native(path));
                        server.folders.lock().push(path);
                    }
                    (None, None) => {}
                }
            }
        }
        if let Some(settings) = params.get(b"initializationOptions") {
            server.settings.lock().read(settings, server.features());
        }
        let Settings { lints, formats, .. } = *server.settings.lock();
        let formats = Json::Bool(formats);
        let kinds = [QUICK_FIX, FIX_ALL].map(rpc::text).to_vec();
        let actions = match lints {
            true => object([("codeActionKinds", Json::Array(kinds))]),
            false => Json::Bool(false),
        };
        let capabilities = object([
            (
                "positionEncoding",
                rpc::text(match client.encoding {
                    Encoding::Utf8 => b"utf-8",
                    Encoding::Utf16 => b"utf-16",
                }),
            ),
            (
                "textDocumentSync",
                object([
                    ("openClose", Json::Bool(true)),
                    // Incremental.
                    ("change", number(2)),
                    ("save", Json::Bool(true)),
                ]),
            ),
            ("codeActionProvider", actions),
            ("documentFormattingProvider", formats.clone()),
            ("documentRangeFormattingProvider", formats),
            (
                "workspace",
                object([(
                    "workspaceFolders",
                    object([
                        ("supported", Json::Bool(true)),
                        ("changeNotifications", Json::Bool(true)),
                    ]),
                )]),
            ),
        ]);
        let info = object([
            ("name", rpc::text(b"bun")),
            ("version", rpc::text(server.environment.version)),
        ]);
        object([("capabilities", capabilities), ("serverInfo", info)])
    }

    /// Hands a request about a document to the thread of its root.
    fn hand_over(
        &mut self,
        id: Json,
        params: &Json,
        job: impl FnOnce(Json, Arc<Document>) -> Option<Job>,
    ) {
        let server = self.server;
        let document = uri_in(params)
            .and_then(|uri| self.documents.get(uri))
            .cloned();
        let root = document.as_ref().and_then(|it| self.root_of(&it.path));
        let job = document.and_then(|it| job(id.clone(), it));
        let (Some(root), Some(job)) = (root, job) else {
            return (server.out).fail(
                id,
                ErrorCode::InvalidParams,
                "The request is about no open document",
            );
        };
        server.pending.lock().push((id, false));
        root.change(|queue| queue.requests.push_back(job));
    }

    fn request(&mut self, id: Json, method: &[u8], params: &Json) {
        let server = self.server;
        match (self.phase, method) {
            (Phase::New, b"initialize") => {
                self.phase = Phase::Running;
                server.out.reply(id, self.initialize(params));
            }
            (Phase::New, _) => {
                (server.out).fail(
                    id,
                    ErrorCode::ServerNotInitialized,
                    "The first request has to be initialize",
                );
            }
            (Phase::Running, b"shutdown") => {
                self.phase = Phase::Down;
                server.out.reply(id, Json::Null);
            }
            (Phase::Down, _) | (_, b"initialize") => {
                server.out.fail(
                    id,
                    ErrorCode::InvalidRequest,
                    "The request comes at the wrong time",
                );
            }
            (_, b"textDocument/codeAction") if !server.settings.lock().lints => {
                server.out.reply(id, Json::Array(Vec::new()));
            }
            (_, b"textDocument/codeAction") => self.hand_over(id, params, |id, document| {
                let only = dig(params, &["context", "only"]).and_then(Json::as_array);
                let kinds = |all: &[Json]| {
                    all.iter()
                        .filter_map(|it| Some(it.as_str()?.to_vec()))
                        .collect()
                };
                Some(Job::Actions {
                    id,
                    document,
                    range: text::range_from_json(params.get(b"range")?)?,
                    only: only.map(kinds),
                })
            }),
            (_, b"textDocument/formatting" | b"textDocument/rangeFormatting")
                if !server.settings.lock().formats =>
            {
                server.out.reply(id, Json::Null);
            }
            (_, b"textDocument/formatting") => self.hand_over(id, params, |id, document| {
                Some(Job::Format {
                    id,
                    document,
                    range: None,
                })
            }),
            (_, b"textDocument/rangeFormatting") => self.hand_over(id, params, |id, document| {
                Some(Job::Format {
                    id,
                    document,
                    range: Some(text::range_from_json(params.get(b"range")?)?),
                })
            }),
            _ => server.out.fail(
                id,
                ErrorCode::MethodNotFound,
                "The server does not have this method",
            ),
        }
    }

    fn notification(&mut self, method: &[u8], params: &Json) {
        let server = self.server;
        if method == b"exit" {
            server.exit(u8::from(self.phase != Phase::Down));
        }
        if self.phase != Phase::Running {
            return;
        }
        match method {
            b"initialized" if server.client().watches_files => {
                let watcher = |it: &str| object([("globPattern", rpc::text(it.as_bytes()))]);
                let registration = object([
                    ("id", rpc::text(b"bun-watched-files")),
                    ("method", rpc::text(b"workspace/didChangeWatchedFiles")),
                    (
                        "registerOptions",
                        object([("watchers", Json::Array(WATCHED.map(watcher).to_vec()))]),
                    ),
                ]);
                let params = object([("registrations", Json::Array(vec![registration]))]);
                (server.out).request(b"bun-register", "client/registerCapability", params);
            }
            b"textDocument/didOpen" => {
                let part = |key: &str| dig(params, &["textDocument", key]);
                let (Some(uri), Some(text)) = (uri_in(params), part("text").and_then(Json::as_str))
                else {
                    return;
                };
                let language = part("languageId")
                    .and_then(Json::as_str)
                    .unwrap_or_default();
                // What is no file is as good as one at the top of the first folder.
                let path = path_of(uri)
                    .map(|it| paths::normalize(&it))
                    .unwrap_or_else(|| {
                        let folders = server.folders.lock();
                        let directory = folders.first().map_or(&b"/"[..], |it| &it[..]);
                        paths::join(directory, &name_of(uri, language))
                    });
                let version = part("version").cloned().unwrap_or(Json::Null);
                let document = self.keep(uri, version, path, text.to_vec());
                self.lint(&document);
            }
            b"textDocument/didChange" => {
                let Some(before) = uri_in(params)
                    .and_then(|uri| self.documents.get(uri))
                    .cloned()
                else {
                    return;
                };
                let changes = params.get(b"contentChanges").and_then(Json::as_array);
                let encoding = server.client().encoding;
                let Some(text) =
                    text::apply_changes(before.text.clone(), changes.unwrap_or_default(), encoding)
                else {
                    return;
                };
                let version = dig(params, &["textDocument", "version"]).cloned();
                let document = self.keep(
                    &before.uri,
                    version.unwrap_or(Json::Null),
                    before.path.clone(),
                    text,
                );
                if server.settings.lock().lints_on_type {
                    self.lint(&document);
                }
            }
            b"textDocument/didSave" => {
                let Some(document) = uri_in(params)
                    .and_then(|uri| self.documents.get(uri))
                    .cloned()
                else {
                    return;
                };
                if !server.client().watches_files && is_watched(paths::basename(&document.path)) {
                    self.look_again();
                } else if !server.settings.lock().lints_on_type {
                    self.lint(&document);
                }
            }
            b"textDocument/didClose" => {
                if let Some(document) = uri_in(params).and_then(|uri| self.documents.remove(uri)) {
                    server.close(&document);
                }
            }
            b"workspace/didChangeWatchedFiles" => self.look_again(),
            b"workspace/didChangeConfiguration" => {
                let Some(settings) = dig(params, &["settings", "bun"]) else {
                    return;
                };
                let before = *server.settings.lock();
                let mut after = before;
                after.read(settings, server.features());
                if after == before {
                    return;
                }
                *server.settings.lock() = after;
                // The configurations of the folders are as they were: their engines go on. A session is made and
                // the format options are read only while that half is on, so a folder's thread starts over when
                // either changes.
                match after.lints == before.lints && after.formats == before.formats {
                    true => self.lint_all(),
                    false => self.look_again(),
                }
            }
            b"workspace/didChangeWorkspaceFolders" => {
                let list = |key: &str| {
                    dig(params, &["event", key])
                        .and_then(Json::as_array)
                        .unwrap_or_default()
                };
                self.set_folders(list("added"), list("removed"));
                self.look_again();
            }
            b"$/cancelRequest" => {
                if let Some(id) = params.get(b"id") {
                    let mut pending = server.pending.lock();
                    (pending.iter_mut().filter(|it| it.0 == *id)).for_each(|it| it.1 = true);
                }
            }
            _ => {}
        }
    }

    fn run(&mut self) -> ! {
        let server = self.server;
        let mut reader = Reader::new(server.process.read);
        loop {
            let message = match reader.next() {
                Frame::Message(message) => message,
                Frame::Malformed => {
                    (server.out).fail(
                        Json::Null,
                        ErrorCode::ParseError,
                        "The header has no Content-Length",
                    );
                    continue;
                }
                // The client is gone.
                Frame::End => server.exit(u8::from(self.phase != Phase::Down)),
            };
            match Incoming::parse(&message) {
                Incoming::Request { id, method, params } => self.request(id, &method, &params),
                Incoming::Notification { method, params } => self.notification(&method, &params),
                Incoming::Response => {}
                Incoming::Unreadable => {
                    server
                        .out
                        .fail(Json::Null, ErrorCode::ParseError, "The message is not JSON");
                }
                Incoming::Invalid { id } => {
                    server.out.fail(
                        id,
                        ErrorCode::InvalidRequest,
                        "The message is not a request",
                    );
                }
            }
        }
    }
}

/// Serves a client until it says `exit` or is gone, which ends the process.
pub fn serve<'a>(args: Args<'a>, environment: &'a Environment<'a>, process: &'a Process<'a>) -> ! {
    let server = &Server {
        args,
        environment,
        process,
        out: Writer::new(process.write),
        client: OnceLock::new(),
        settings: Guarded::new(Settings::new(process.features)),
        folders: Guarded::default(),
        latest: Guarded::default(),
        pending: Guarded::default(),
        realms: Guarded::default(),
    };
    std::thread::scope(|scope| {
        let mut desk = Desk {
            server,
            scope,
            phase: Phase::New,
            documents: FxHashMap::default(),
            roots: Vec::new(),
            serial: 0,
        };
        desk.run()
    })
}
