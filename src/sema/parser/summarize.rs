//! A file for who reads it: the type checker, the linter, the formatter. The text is parsed by the
//! parser that refuses it at its first error. What that refuses is parsed again by the parser that
//! recovers from errors as TypeScript's does.

use crate::{Options, Refusal, Scratch};
use bun_alloc::Arena;
use bun_sema::atom::{Intern, Interner};
use bun_sema::hir::{Diagnostic, DiagnosticKind, ExprKind, File, FileBuilder, FileKind};
use bun_sema::resolve::{Dialect, ScriptKind};
use bun_sema::session::Session;
use core::sync::atomic::AtomicU64;
use core::sync::atomic::Ordering::Relaxed;

thread_local! {
    /// What the parser keeps from one file to the next. Two of them: who formats a file parses the
    /// result while the file is still at hand.
    static SCRATCH: core::cell::RefCell<[Option<Box<Scratch>>; 2]> =
        const { core::cell::RefCell::new([None, None]) };
}

/// Per-thread buffers reused from one file to the next to reduce allocation. A pool thread outlives
/// a check, so the check owns this: a thread holds one only while it works for the check.
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

/// One of `SCRATCH`, which is nobody's until `give_back_scratch`.
fn take_scratch() -> Box<Scratch> {
    let taken = SCRATCH.with_borrow_mut(|all| all.iter_mut().find_map(Option::take));
    taken.unwrap_or_default()
}

fn give_back_scratch(scratch: Box<Scratch>) {
    SCRATCH.with_borrow_mut(|all| {
        if let Some(free) = all.iter_mut().find(|it| it.is_none()) {
            *free = Some(scratch);
        }
    });
}

/// How many files were parsed at once, and how many the parser that refuses a text at its first
/// error has refused, by reason.
#[derive(Default)]
pub struct Counts {
    pub parsed: AtomicU64,
    pub refused: [AtomicU64; Refusal::COUNT],
}

pub static COUNTS: Counts = Counts {
    parsed: AtomicU64::new(0),
    refused: [const { AtomicU64::new(0) }; Refusal::COUNT],
};

/// `Options::reads_jsdoc`
#[derive(Copy, Clone, PartialEq, Eq)]
enum JsDoc {
    Read,
    Ignored,
}

/// How a file is read.
#[derive(Copy, Clone)]
struct Reading<'a> {
    dialect: Dialect,
    path: &'a [u8],
    script_kind: Option<ScriptKind>,
    experimental_decorators: bool,
    every_file_is_a_module: bool,
    jsdoc: JsDoc,
}

/// `path` has the extension of JSON, and nobody says what else the file is.
fn is_json(path: &[u8], script_kind: Option<ScriptKind>) -> bool {
    script_kind.is_none()
        && (path.len().checked_sub(b".json".len()))
            .is_some_and(|dot| path[dot..].eq_ignore_ascii_case(b".json"))
}

/// The file as the parser leaves it. Without `atoms`, the file has its own, which `scratch` knows.
fn parse(
    scratch: &mut Scratch,
    how: Reading<'_>,
    text: &[u8],
    atoms: Option<&dyn Intern>,
) -> FileBuilder {
    let Reading { dialect, path, .. } = how;
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
        // `flow-parser` reads it as a name outside an async function, in a module too.
        await_is_a_name: is_json
            || is_ecmascript && (dialect.script || dialect.flow && !dialect.babel),
        recovers: false,
        reads_jsdoc: how.jsdoc == JsDoc::Read,
        dialect,
        goal: Default::default(),
    };
    let parse = |options, scratch: &mut Scratch| match atoms {
        Some(atoms) => crate::parse(text, options, atoms, scratch),
        None => crate::parse_with_own_atoms(text, options, scratch),
    };
    let attempt = |mut options: Options, scratch: &mut Scratch| {
        let first = parse(options, scratch).map_err(|it| (it.why, it.at))?;
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
        let second = parse(options, scratch);
        second.map(|it| it.file).map_err(|it| (it.why, it.at))
    };
    let is_flow = dialect.flow && is_js;
    let parsed = attempt(options, scratch).or_else(|refused| {
        COUNTS.refused[refused.0 as usize].fetch_add(1, Relaxed);
        // No parser recovers from an error in Flow.
        if is_flow {
            return Err(refused);
        }
        let recovers = true;
        attempt(
            Options {
                recovers,
                ..options
            },
            scratch,
        )
        .or(Err(refused))
    });
    let mut file = match parsed {
        Ok(file) => file,
        // The file is not looked at any further: its first error is all that is said about it.
        Err((why, at)) => {
            let is_too_deep = why == Refusal::TooDeep;
            let error = match scratch.error_before_refusal() {
                Some(error) => error.clone(),
                None => Diagnostic::new(DiagnosticKind::Parse, (at, 0), 1128, &[]),
            };
            return FileBuilder {
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
                ..Default::default()
            };
        }
    };
    COUNTS.parsed.fetch_add(1, Relaxed);
    file.legacy_decorators = how.experimental_decorators;
    file
}

/// `parse`, with every list at its final size in the arena.
fn parse_into_arena<'s>(
    scratch: &mut Scratch,
    how: Reading<'_>,
    memory: (&'s Arena, &'s Session),
    text: &[u8],
    atoms: &dyn Intern,
) -> File<'s> {
    let mut file = parse(scratch, how, text, Some(atoms));
    let mut in_arena = Summary::InPlace(&mut file).into_arena(memory);
    if in_arena.kind == FileKind::Json {
        bun_sema::json::validate_json(&mut in_arena, text);
    }
    // A very large file would leave its capacity to every later file.
    if text.len() < 4 << 20 {
        scratch.recycle(file);
    }
    in_arena
}

/// The type checker's input for the file `text` at `path`. Its lists are in `arena`, which is the
/// arena that the calling thread has in the session of `atoms`. `script_kind`: see
/// `Host::script_kind`.
pub fn summarize<'s>(
    arena: &'s Arena,
    path: &[u8],
    script_kind: Option<ScriptKind>,
    text: &[u8],
    atoms: &Interner<'s>,
    experimental_decorators: bool,
    every_file_is_a_module: bool,
) -> File<'s> {
    let how = Reading {
        dialect: Dialect::default(),
        path,
        script_kind,
        experimental_decorators,
        every_file_is_a_module,
        jsdoc: JsDoc::Read,
    };
    SCRATCH.with_borrow_mut(|all| {
        let scratch = all[0].get_or_insert_default();
        parse_into_arena(scratch, how, (arena, atoms.session()), text, atoms)
    })
}

/// [`summarize`] for a tool that follows another parser than that of `tsc`, and that reads no types
/// from JSDoc comments.
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

/// [`summarize_as`] with names that outlive the file: `atoms` can be of another session than
/// `session`, which `arena` is of and which is dropped with the file.
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
    let how = Reading {
        dialect,
        path,
        script_kind,
        experimental_decorators,
        every_file_is_a_module,
        jsdoc: JsDoc::Ignored,
    };
    SCRATCH.with_borrow_mut(|all| {
        parse_into_arena(all[0].get_or_insert_default(), how, memory, text, atoms)
    })
}

/// A file as [`with_summary_in_place`] hands it out.
pub enum Summary<'a, 's> {
    /// Where the parser has left it. It does not hold its text, and what `File::finish_nodes`
    /// computes is missing.
    InPlace(&'a mut FileBuilder),
    InArena(Box<File<'s>>),
}

impl<'s> Summary<'_, 's> {
    /// The file as [`with_summary`] hands it out.
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

/// [`summarize_in`] for one who is done with a file before the next: calls `then` with the file,
/// which holds `text`, and with the interner of its atoms, which are the file's own and mean nothing
/// in another file. They are those of `atoms` only if the file is JSON.
///
/// The lists of nodes stay where the parser has left them. Little else is allocated in `arena`.
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

/// [`with_summary`] for one who can read the file where the parser has left it, which saves a copy
/// of its lists.
pub fn with_summary_in_place<'s, R>(
    dialect: Dialect,
    memory: (&'s Arena, &'s Session),
    path: &[u8],
    script_kind: Option<ScriptKind>,
    text: &[u8],
    atoms: &dyn Intern,
    experimental_decorators: bool,
    every_file_is_a_module: bool,
    then: impl FnOnce(Summary<'_, 's>, &dyn Intern) -> R,
) -> R {
    let how = Reading {
        dialect,
        path,
        script_kind,
        experimental_decorators,
        every_file_is_a_module,
        jsdoc: JsDoc::Ignored,
    };
    // `then` may parse another text.
    let mut scratch = take_scratch();
    // JSON is validated where it ends up.
    if is_json(path, script_kind) {
        let file = parse_into_arena(&mut scratch, how, memory, text, atoms);
        give_back_scratch(scratch);
        return then(Summary::InArena(Box::new(file)), atoms);
    }
    let mut file = parse(&mut scratch, how, text, None);
    let result = then(Summary::InPlace(&mut file), &scratch.atoms(text));
    // A very large file would leave its capacity to every later file.
    if text.len() < 4 << 20 {
        scratch.recycle(file);
    }
    give_back_scratch(scratch);
    result
}

/// [`with_summary_in_place`] for what a text starts with: see [`crate::Goal`]. Calls `then` with the file, which has one
/// statement, the interner of its atoms, and the end of the last token of the part. `Err`: where the first error is.
/// There is no JSX, `await` is a keyword, and nothing is recovered from.
pub fn with_part_in_place<'s, R>(
    dialect: Dialect,
    is_javascript: bool,
    text: &[u8],
    goal: crate::Goal,
    then: impl FnOnce(Summary<'_, 's>, &dyn Intern, u32) -> R,
) -> Result<R, u32> {
    let options = Options {
        is_javascript,
        dialect,
        goal,
        ..Default::default()
    };
    // `then` may parse another text.
    let mut scratch = take_scratch();
    let parsed = crate::parse_with_own_atoms(text, options, &mut scratch);
    let result = parsed.map_err(|refused| refused.at).map(|mut parsed| {
        let result = then(
            Summary::InPlace(&mut parsed.file),
            &scratch.atoms(text),
            parsed.end,
        );
        scratch.recycle(parsed.file);
        result
    });
    give_back_scratch(scratch);
    result
}
