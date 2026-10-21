//! Parses a file for its consumers: the type checker, the linter and the formatter. The text first
//! goes through the parser without recovery, which rejects it at the first error. A rejected text
//! is parsed again by the parser that recovers from errors the way TypeScript's does.

use crate::{Options, Part, Rejection, Scratch};
use bun_alloc::Arena;
use bun_sema::atom::{Intern, Interner};
use bun_sema::hir::{
    Diagnostic, DiagnosticKind, ExprKind, File, FileBuilder, FileKind, Stmt, StmtKind, rare,
};
use bun_sema::resolve::{Dialect, ScriptKind};
use bun_sema::session::Session;
use core::sync::atomic::AtomicU64;
use core::sync::atomic::Ordering::Relaxed;

thread_local! {
    /// Parser state reused from one file to the next. There are two because the formatter parses
    /// its output while it still holds the input file.
    static SCRATCH: core::cell::RefCell<[Option<Box<Scratch>>; 2]> =
        const { core::cell::RefCell::new([None, None]) };
}

/// Per-thread buffers reused from one file to the next to reduce allocation. A pool thread outlives
/// a check, so the check owns them, and a thread holds them only while it works for that check.
#[derive(Default)]
pub struct ThreadCaches([Option<Box<Scratch>>; 2]);

impl ThreadCaches {
    /// Takes the caches from the calling thread.
    pub fn take() -> ThreadCaches {
        ThreadCaches::default().install()
    }

    /// Installs the caches on the calling thread. Returns the previous ones.
    pub fn install(self) -> ThreadCaches {
        ThreadCaches(SCRATCH.replace(self.0))
    }
}

/// Takes one of the `SCRATCH` entries. Its slot stays empty until `return_scratch`.
fn take_scratch() -> Box<Scratch> {
    let taken = SCRATCH.with_borrow_mut(|all| all.iter_mut().find_map(Option::take));
    taken.unwrap_or_default()
}

fn return_scratch(scratch: Box<Scratch>) {
    SCRATCH.with_borrow_mut(|all| {
        if let Some(free) = all.iter_mut().find(|it| it.is_none()) {
            *free = Some(scratch);
        }
    });
}

/// How many parses succeeded, and how many texts the parser without recovery rejected, by reason.
#[derive(Default)]
pub struct Counts {
    pub parsed: AtomicU64,
    pub refused: [AtomicU64; Rejection::COUNT],
}

pub static COUNTS: Counts = Counts {
    parsed: AtomicU64::new(0),
    refused: [const { AtomicU64::new(0) }; Rejection::COUNT],
};

/// `Options::reads_jsdoc`
#[derive(Copy, Clone, PartialEq, Eq)]
enum JsDoc {
    Read,
    Ignored,
}

/// How to parse a file.
#[derive(Copy, Clone)]
struct ParseSettings<'a> {
    dialect: Dialect,
    path: &'a [u8],
    script_kind: Option<ScriptKind>,
    experimental_decorators: bool,
    every_file_is_a_module: bool,
    jsdoc: JsDoc,
    /// `Options::attach_comments`
    attach_comments: bool,
}

/// True if `path` ends in `.json` and no `script_kind` overrides that.
fn is_json(path: &[u8], script_kind: Option<ScriptKind>) -> bool {
    script_kind.is_none()
        && (path.len().checked_sub(b".json".len()))
            .is_some_and(|dot| path[dot..].eq_ignore_ascii_case(b".json"))
}

/// Position of the error in a text that both parsers rejected. The parser without recovery rejected it for `why` at
/// `at`, after the token that ends at `after`. The recovering parser gave up at `recovery_pos`.
fn refusal_position(
    text: &[u8],
    (why, at, after): (Rejection, u32, u32),
    recovery_pos: u32,
) -> u32 {
    match why {
        // The invalid token starts after the whitespace that follows the last token.
        _ if why.is_scanner_error() => {
            let rest = text.get(after as usize..).unwrap_or_default();
            let is_blank = |c: &&u8| matches!(**c, b' ' | b'\t' | b'\n' | b'\r');
            after + rest.iter().take_while(is_blank).count() as u32
        }
        // A construct that TypeScript only reports is noticed after all of it is read, so `at` is too late.
        Rejection::Reported => recovery_pos,
        _ => at,
    }
}

/// True if `text` contains something that a script may parse differently from a module.
fn may_parse_differently_as_script(text: &[u8]) -> bool {
    // `\u` is listed because an `await` written with an escape is a name in a script.
    let words: [&[u8]; 4] = [b"await", b"<!--", b"-->", b"\\u"];
    words.iter().any(|it| bun_core::strings::contains(text, it))
}

/// Parses `text` and returns the file as the parser built it. Without `atoms`, the file gets its
/// own atoms, which are stored in `scratch`.
fn parse_file(
    scratch: &mut Scratch,
    how: ParseSettings<'_>,
    text: &[u8],
    atoms: Option<&dyn Intern>,
) -> Box<FileBuilder> {
    // This is a different text than the last one, possibly at the same address.
    scratch.stops.forget();
    let is_named = |names: [&[u8]; 2]| names.iter().any(|it| how.path.ends_with(it));
    let as_script = ParseSettings {
        dialect: Dialect {
            script: true,
            ..how.dialect
        },
        every_file_is_a_module: false,
        ..how
    };
    // oxc treats it as a script no matter what's in it, and recovers from the error about a
    // top-level `await` expression.
    let is_script_by_name = how.dialect.oxc && is_named([b".cjs", b".cts"]);
    if is_script_by_name && !how.dialect.script {
        return parse_file_as(scratch, as_script, text, atoms, false);
    }
    let mut file = parse_file_as(scratch, how, text, atoms, false);
    let is_rejected = |file: &FileBuilder| file.has_errors || file.has_parse_diagnostics;
    let (was_rejected, html_opens) = (is_rejected(&file), scratch.html_opens);
    let has_only_ambiguous_awaits = scratch.has_only_ambiguous_awaits;
    let may_be_script = html_opens.first.is_some() || has_only_ambiguous_awaits;
    if how.dialect.module_or_script && !how.dialect.oxc && !how.dialect.script {
        let is_module = file.has_module_syntax || file.rare_syntax & rare::IMPORT_META != 0;
        let is_same_in_a_script = match was_rejected {
            true => !may_parse_differently_as_script(text),
            false => html_opens.first.is_none(),
        };
        if is_module || is_same_in_a_script {
            return file;
        }
        scratch.recycle(file);
        let script = parse_file_as(scratch, as_script, text, atoms, true);
        if !is_rejected(&script) && !script.has_module_syntax {
            return script;
        }
        scratch.recycle(script);
        return parse_file_as(scratch, how, text, atoms, false);
    }
    if !how.dialect.oxc || how.dialect.script || !was_rejected && !may_be_script {
        return file;
    }
    // For oxc a file is a script unless something in it makes it a module. Only the constructs
    // checked above parse differently in a script.
    let is_module_by_name = is_named([b".mjs", b".mts"]);
    let has_import_meta = (file.exprs.iter()).any(|e| matches!(e.kind, ExprKind::ImportMeta));
    // TypeScript doesn't count `export as namespace` as module syntax.
    let is_global_name = |it: &Stmt| matches!(it.kind, StmtKind::ExportAsNamespace(..));
    let is_module = is_module_by_name
        || file.has_module_syntax
        || has_import_meta
        || file.stmts.iter().any(is_global_name);
    if was_rejected && (is_module || !may_parse_differently_as_script(text)) {
        return file;
    }
    // `a <!--b`, which every other parser reads as `a < !--b`.
    if is_module {
        let html_comment_pos = match is_module_by_name {
            true => html_opens.first_on_its_line,
            false => html_opens.first,
        };
        if let Some(at) = html_comment_pos {
            let error = Diagnostic::new(DiagnosticKind::Parse, (at, at + 4), 1109, &[]);
            *file = FileBuilder {
                kind: FileKind::Tsx,
                is_js: file.is_js,
                is_flow: file.is_flow,
                has_errors: true,
                has_parse_diagnostics: true,
                error_pos: at,
                source_len: text.len() as u32,
                diagnostics: vec![error],
                ..Default::default()
            };
        }
        return file;
    }
    scratch.recycle(file);
    let script = parse_file_as(scratch, as_script, text, atoms, true);
    // `<!--` makes it a script even if the script doesn't parse. `await (a)` is a call in a script,
    // and `await a` makes it a module. If nothing makes it a module, oxc has parsed `await` as a
    // name and reports the errors of that parse: `await /a/;`.
    let is_script = !is_rejected(&script)
        || !was_rejected && html_opens.first.is_some()
        || has_only_ambiguous_awaits;
    if is_script && !script.has_module_syntax {
        return script;
    }
    // A file's own atoms are those of the last parse, so parse it again.
    scratch.recycle(script);
    parse_file_as(scratch, how, text, atoms, false)
}

/// `parse_file` for exactly `how.dialect`. `rejects_top_level_await`: a top-level `await` expression is an error.
fn parse_file_as(
    scratch: &mut Scratch,
    how: ParseSettings<'_>,
    text: &[u8],
    atoms: Option<&dyn Intern>,
    rejects_top_level_await: bool,
) -> Box<FileBuilder> {
    let ParseSettings { dialect, path, .. } = how;
    let by_name = how.script_kind.is_none();
    let script_kind = how.script_kind.or_else(|| ScriptKind::from_file_name(path));
    let is_js = script_kind.is_some_and(ScriptKind::is_javascript);
    let is_json = is_json(path, how.script_kind);
    let is_ecmascript = dialect.ecmascript && is_js;
    let every_file_is_a_module = match is_ecmascript {
        true => !dialect.script,
        false => how.every_file_is_a_module,
    };
    let options = Options {
        is_declaration_file: by_name && bun_sema::resolve::is_declaration_file_name(path),
        is_jsx: is_js || is_json || script_kind == Some(ScriptKind::Tsx),
        is_javascript: is_js || is_json,
        is_json,
        // `flow-parser` treats `await` as a name outside an async function, even in a module.
        await_is_a_name: is_json
            || (is_ecmascript || dialect.oxc) && dialect.script
            || is_ecmascript && dialect.flow && !dialect.babel,
        is_module_or_script: dialect.oxc
            && !dialect.script
            && ![&b".mjs"[..], b".mts"].iter().any(|it| path.ends_with(it)),
        recovers: false,
        reads_jsdoc: how.jsdoc == JsDoc::Read,
        dialect,
        part: None,
        attach_comments: how.attach_comments,
    };
    let once = |options, scratch: &mut Scratch| match atoms {
        Some(atoms) => crate::parse(text, options, atoms, scratch),
        None => crate::parse_with_own_atoms(text, options, scratch),
    };
    let attempt = |mut options: Options, scratch: &mut Scratch| {
        let first = once(options, scratch).map_err(|it| (it.why, it.at, it.after))?;
        if rejects_top_level_await && first.has_top_level_await {
            scratch.recycle(first.file);
            return Err((Rejection::Reported, 0, 0));
        }
        // `parseSourceFileWorker`: only a file with an `ExternalModuleIndicator` has an [Await]
        // context at its top level.
        let parse_again = first.has_top_level_await
            && !every_file_is_a_module
            && !first.file.has_module_syntax
            && (dialect.script
                || ![&b".mts"[..], b".cts", b".mjs", b".cjs"]
                    .iter()
                    .any(|e| path.ends_with(e)))
            && !(first.file.exprs.iter()).any(|e| matches!(e.kind, ExprKind::ImportMeta));
        if !parse_again {
            return Ok(first.file);
        }
        scratch.recycle(first.file);
        options.await_is_a_name = true;
        let second = once(options, scratch);
        second
            .map(|it| it.file)
            .map_err(|it| (it.why, it.at, it.after))
    };
    let is_flow = dialect.flow && is_js;
    let parsed = attempt(options, scratch).or_else(|rejection| {
        COUNTS.refused[rejection.0 as usize].fetch_add(1, Relaxed);
        // No parser recovers from an error in Flow.
        if is_flow {
            return Err(rejection);
        }
        let recovers = true;
        let general = Options {
            recovers,
            ..options
        };
        let file = attempt(general, scratch).map_err(|recovery_rejection| {
            (
                rejection.0,
                refusal_position(text, rejection, recovery_rejection.1),
                0,
            )
        })?;
        // TypeScript's parser accepts `var;`, `class {}` and `catch (a = 1)` and leaves them to its
        // checker. acorn and Babel reject them, and only the parser without recovery knows that.
        let is_an_error = matches!(rejection.0, Rejection::Syntax | Rejection::Reported);
        if is_ecmascript && is_an_error && file.diagnostics.is_empty() {
            scratch.recycle(file);
            return Err(rejection);
        }
        Ok(file)
    });
    let mut file = match parsed {
        Ok(file) => file,
        // Nothing looks at the file any further. Its first error is the only thing reported.
        Err((why, at, _)) => {
            let is_too_deep = why == Rejection::TooDeep;
            let is_first_in_text = dialect == Dialect::default();
            let error = match scratch.error_before_rejection(is_first_in_text, text.len()) {
                Some(error) => error.clone(),
                None => Diagnostic::new(DiagnosticKind::Parse, (at, 0), 1128, &[]),
            };
            let mut file = scratch.recycled.take().unwrap_or_default();
            *file = FileBuilder {
                kind: FileKind::Tsx,
                is_js,
                is_flow,
                has_errors: true,
                has_parse_diagnostics: !is_too_deep,
                ran_out_of_stack: is_too_deep,
                error_pos: error.start,
                source_len: text.len() as u32,
                diagnostics: match is_too_deep {
                    true => Vec::new(),
                    false => vec![error],
                },
                // The comments the lexer got past. oxlint looks for `@flow` in the first one.
                comments: std::mem::take(&mut file.comments),
                ..Default::default()
            };
            return file;
        }
    };
    COUNTS.parsed.fetch_add(1, Relaxed);
    file.legacy_decorators = how.experimental_decorators;
    file
}

/// `parse_file`, then copies every list into the arena at its final size.
fn parse_into_arena<'s>(
    scratch: &mut Scratch,
    how: ParseSettings<'_>,
    memory: (&'s Arena, &'s Session),
    text: &[u8],
    atoms: &dyn Intern,
) -> File<'s> {
    let mut file = parse_file(scratch, how, text, Some(atoms));
    let mut in_arena = Summary::InPlace(&mut file).into_arena(memory);
    if in_arena.kind == FileKind::Json {
        bun_sema::json::validate_json(&mut in_arena, text);
    }
    // Don't keep a very large file's capacity around for every later file.
    if text.len() >= 4 << 20 {
        *file = FileBuilder::default();
    }
    scratch.recycle(file);
    in_arena
}

/// Parses the file `text` at `path` into the type checker's input. Its lists live in `arena`, which
/// must be the calling thread's arena in `atoms`' session. `script_kind`: see `Host::script_kind`.
pub fn summarize<'s>(
    arena: &'s Arena,
    path: &[u8],
    script_kind: Option<ScriptKind>,
    text: &[u8],
    atoms: &Interner<'s>,
    experimental_decorators: bool,
    every_file_is_a_module: bool,
) -> File<'s> {
    let how = ParseSettings {
        dialect: Dialect::default(),
        path,
        script_kind,
        experimental_decorators,
        every_file_is_a_module,
        jsdoc: JsDoc::Read,
        attach_comments: false,
    };
    SCRATCH.with_borrow_mut(|all| {
        let scratch = all[0].get_or_insert_default();
        parse_into_arena(scratch, how, (arena, atoms.session()), text, atoms)
    })
}

/// [`summarize`] for a tool that follows a parser other than `tsc`'s and doesn't read types from JSDoc comments.
pub fn summarize_as<'s>(
    dialect: Dialect,
    arena: &'s Arena,
    path: &[u8],
    script_kind: Option<ScriptKind>,
    text: &[u8],
    atoms: &Interner<'s>,
    experimental_decorators: bool,
    every_file_is_a_module: bool,
) -> File<'s> {
    summarize_in(
        dialect,
        (arena, atoms.session()),
        path,
        script_kind,
        text,
        atoms,
        experimental_decorators,
        every_file_is_a_module,
    )
}

/// [`summarize_as`] with names that outlive the file. `atoms` can belong to a different session
/// than the one in `memory`, which owns the arena and is dropped with the file.
pub fn summarize_in<'s>(
    dialect: Dialect,
    memory: (&'s Arena, &'s Session),
    path: &[u8],
    script_kind: Option<ScriptKind>,
    text: &[u8],
    atoms: &dyn Intern,
    experimental_decorators: bool,
    every_file_is_a_module: bool,
) -> File<'s> {
    let how = ParseSettings {
        dialect,
        path,
        script_kind,
        experimental_decorators,
        every_file_is_a_module,
        jsdoc: JsDoc::Ignored,
        attach_comments: false,
    };
    SCRATCH.with_borrow_mut(|all| {
        parse_into_arena(all[0].get_or_insert_default(), how, memory, text, atoms)
    })
}

/// The file that [`with_summary_in_place`] passes to its callback.
pub enum Summary<'a, 's> {
    /// Still in the parser's buffers. It doesn't hold its text, and `File::finish_nodes` hasn't run.
    InPlace(&'a mut FileBuilder),
    InArena(Box<File<'s>>),
}

impl<'s> Summary<'_, 's> {
    /// Returns the finished file, like the one [`with_summary`] passes to its callback.
    pub fn into_arena(self, (arena, session): (&'s Arena, &'s Session)) -> File<'s> {
        match self {
            Summary::InArena(file) => *file,
            Summary::InPlace(file) => {
                let (mut in_arena, emptied) = core::mem::take(file).into_arena(arena, session);
                *file = emptied;
                in_arena.finish_nodes();
                in_arena
            }
        }
    }
}

/// [`summarize_in`] for a caller that's done with each file before it parses the next. Calls `then`
/// with the file, which holds `text`, and with the interner of its atoms. The atoms are the file's
/// own and mean nothing in another file, except that a JSON file uses `atoms`.
///
/// The node lists stay in the parser's buffers. Little else is allocated in `arena`.
pub fn with_summary<R>(
    dialect: Dialect,
    (arena, session): (&Arena, &Session),
    path: &[u8],
    script_kind: Option<ScriptKind>,
    text: &[u8],
    atoms: &dyn Intern,
    experimental_decorators: bool,
    every_file_is_a_module: bool,
    then: impl for<'x> FnOnce(File<'x>, &dyn Intern) -> R,
) -> R {
    with_summary_in_place(
        dialect,
        (arena, session),
        path,
        script_kind,
        text,
        atoms,
        experimental_decorators,
        every_file_is_a_module,
        false,
        |file, atoms| match file {
            Summary::InArena(mut file) => {
                file.text = std::borrow::Cow::Borrowed(text);
                then(*file, atoms)
            }
            Summary::InPlace(file) => {
                let mut file = file.lend(arena, session);
                file.finish_nodes();
                file.text = std::borrow::Cow::Borrowed(text);
                then(file, atoms)
            }
        },
    )
}

/// [`with_summary`] for a caller that can read the file from the parser's buffers, which saves copying its lists.
pub fn with_summary_in_place<'s, R>(
    dialect: Dialect,
    memory: (&'s Arena, &'s Session),
    path: &[u8],
    script_kind: Option<ScriptKind>,
    text: &[u8],
    atoms: &dyn Intern,
    experimental_decorators: bool,
    every_file_is_a_module: bool,
    attach_comments: bool,
    then: impl FnOnce(Summary<'_, 's>, &dyn Intern) -> R,
) -> R {
    let how = ParseSettings {
        dialect,
        path,
        script_kind,
        experimental_decorators,
        every_file_is_a_module,
        jsdoc: JsDoc::Ignored,
        attach_comments,
    };
    // `then` may parse another text.
    let mut scratch = take_scratch();
    // JSON is validated once it's in the arena.
    if is_json(path, script_kind) {
        let file = parse_into_arena(&mut scratch, how, memory, text, atoms);
        return_scratch(scratch);
        return then(Summary::InArena(Box::new(file)), atoms);
    }
    let mut file = parse_file(&mut scratch, how, text, None);
    let result = then(Summary::InPlace(&mut file), &scratch.atoms(text));
    // Don't keep a very large file's capacity around for every later file.
    if text.len() >= 4 << 20 {
        *file = FileBuilder::default();
    }
    scratch.recycle(file);
    return_scratch(scratch);
    result
}

/// Why a part can't be parsed.
#[derive(Debug, Copy, Clone)]
pub struct PartError {
    /// Position of the first error in the whole text.
    pub at: u32,
    pub is_too_deep: bool,
}

impl PartError {
    fn of(rejection: &crate::Rejected, at: u32) -> PartError {
        PartError {
            at,
            is_too_deep: rejection.why == Rejection::TooDeep,
        }
    }
}

/// Parses the parts of one text: see [`Part`]. What the scanner needs to know about the whole text is computed once.
pub struct Parts<'t> {
    text: &'t [u8],
    scratch: Option<Box<Scratch>>,
    /// Swapped in for `scratch.stops` while parsing the text of one part.
    part_stops: bun_highway::ScannerStopsBuffer,
}

impl<'t> Parts<'t> {
    pub fn of(text: &'t [u8]) -> Parts<'t> {
        let mut scratch = take_scratch();
        // This is a different text than the last one, possibly at the same address.
        scratch.stops.forget();
        Parts {
            text,
            scratch: Some(scratch),
            part_stops: Default::default(),
        }
    }

    /// Calls `then` with the file, which has one statement, the interner of its atoms, the file's text, and the end of
    /// `part`'s last token in that text. The text starts where the part starts and ends with the token after the part,
    /// so a search in the file's text doesn't scan everything around the part. There's no JSX, `await` is a keyword,
    /// and there's no error recovery.
    pub fn parse<'s, R>(
        &mut self,
        dialect: Dialect,
        is_javascript: bool,
        part: Part,
        then: impl FnOnce(Summary<'_, 's>, &dyn Intern, &[u8], u32) -> R,
    ) -> Result<R, PartError> {
        let (text, scratch) = (self.text, self.scratch.get_or_insert_default());
        let options = |from: u32, until: u32| Options {
            is_javascript,
            dialect,
            part: Some(Part {
                from,
                until,
                ..part
            }),
            attach_comments: true,
            ..Default::default()
        };
        // Find where the part ends.
        let whole = options(part.from, part.until);
        let found = crate::parse_with_own_atoms(text, whole, scratch).or_else(|rejection| {
            if !rejection.why.is_scanner_error() {
                return Err(PartError::of(&rejection, rejection.at));
            }
            // What follows a part doesn't have to be a valid token. If it isn't, end the text before it.
            crate::parse_with_own_atoms(text, options(part.from, rejection.after), scratch)
                .map_err(|again| PartError::of(&again, rejection.after))
        })?;
        let until = found.end.1;
        scratch.recycle(found.file);
        let code = (text.get(part.from as usize..until as usize)).unwrap_or_default();
        core::mem::swap(&mut scratch.stops, &mut self.part_stops);
        scratch.stops.forget();
        let parsed = crate::parse_with_own_atoms(code, options(0, code.len() as u32), scratch);
        core::mem::swap(&mut scratch.stops, &mut self.part_stops);
        let mut parsed =
            parsed.map_err(|rejection| PartError::of(&rejection, part.from + rejection.at))?;
        let result = then(
            Summary::InPlace(&mut parsed.file),
            &scratch.atoms(code),
            code,
            parsed.end.0,
        );
        scratch.recycle(parsed.file);
        Ok(result)
    }
}

impl Drop for Parts<'_> {
    fn drop(&mut self) {
        if let Some(scratch) = self.scratch.take() {
            return_scratch(scratch);
        }
    }
}
