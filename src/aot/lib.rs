//! The front end of the ahead-of-time compiler: from the trees and the types of the type checker to a small intermediate
//! representation in SSA form, which the engine reads and compiles. Nothing here knows the engine, a built-in or how a value is
//! stored.

pub mod build;
pub mod builder;
mod builtins_generated;
pub mod declared;
mod field_types;
pub mod format;
pub mod fragment;
pub mod id;
pub mod ir;
pub mod link;
pub mod prelude;
mod print;
mod verify;

use build::Problem;
use bun_sema::check::{Checker, Program as Checked};
use bun_sema::hir::FileKind;
use bun_sema::program::FileId;
use bun_sema::util::InParallel;
use fragment::Fragments;
pub use link::Explain;
use link::{Elsewhere, Errors, Linked};
use std::sync::{PoisonError, RwLock};

pub struct Translated {
    pub program: ir::Program,
    /// What could not be translated: file, line and what.
    pub problems: Vec<String>,
    /// What the soundness closure has cost and come to: `bun_sema::check::Sizes::line`.
    pub members: String,
    /// What `Translation::explaining` has asked for, a line each.
    pub explained: Vec<String>,
    /// For each of the errors that `Translation::finish` was handed: whether it stands. If one does, the program is of no use.
    pub errors_that_stand: Vec<bool>,
    /// For each of those that do not stand, in their order: why not.
    pub why_errors_do_not_stand: Vec<String>,
    /// The modules of the runtime that are not in the program, by id: file, line and what could not be translated.
    pub builtin_modules_left_out: Vec<(u32, String)>,
    pub builtin_functions_left_out: Vec<(u32, String)>,
    pub times: link::Times,
}

/// What the bundler has decided: what it replaces by constants, and which code each import stands for.
#[derive(Default)]
pub struct Constants {
    /// The directory the program is built in, in the checker's format. The paths in messages and stack traces are relative to it, as
    /// the bundler shows them.
    pub root: Vec<u8>,
    /// `--define`: the dotted name and the JavaScript text of the value.
    pub defines: Vec<(Vec<u8>, Vec<u8>)>,
    /// The flags for which `feature()` of `bun:bundle` is true.
    pub features: Vec<Vec<u8>>,
    /// What the bundler has resolved each import, `import()` and `require()` to, by the importing file and the specifier: the code that
    /// runs. The checker resolves an import for its types, often to another file. An import that is not here is of a module that is
    /// not compiled with the program. The paths are in the checker's format.
    /// `None`: there is no bundler, and an import stands for the file the checker resolves it to.
    pub resolved: Option<rustc_hash::FxHashMap<(Vec<u8>, Vec<u8>), Vec<u8>>>,
    /// The imports the bundler has left out, by the importing file and the specifier: nothing is evaluated for them.
    pub dropped_imports: rustc_hash::FxHashSet<(Vec<u8>, Vec<u8>)>,
    /// By file: where each statement at its top level starts, as the bundler has them, and whether it may be left out if nothing uses what
    /// it declares. A file that is not here: the bundler has said nothing.
    pub statements: rustc_hash::FxHashMap<Vec<u8>, Vec<(u32, bool)>>,
    /// The files that are imported as strings, by path, with their text.
    pub texts: rustc_hash::FxHashMap<Vec<u8>, Vec<u8>>,
    /// The files that are imported for their path, by path, with what stands for the path they end up at. The bundler tells the
    /// engine what to put in its place.
    pub assets: rustc_hash::FxHashMap<Vec<u8>, Vec<u8>>,
    /// What is built is run in place of its sources (`bun run --aot`), so each module says of itself what it says when it is run from
    /// its file: `import.meta.url`, `__dirname`, what `require` is relative to. The function makes the `file:` URL of a path.
    /// `None`: all of that is the entry point's, as in any bundle.
    pub own_paths: Option<fn(&[u8]) -> Vec<u8>>,
    /// What is built is run by `bun test`, which lets a file use `test`, `expect` and the like without importing them.
    pub has_test_globals: bool,
}

impl Constants {
    pub fn statements_by_file(statements: impl Iterator<Item = (Vec<u8>, u32, bool)>) -> rustc_hash::FxHashMap<Vec<u8>, Vec<(u32, bool)>> {
        let mut by_file: rustc_hash::FxHashMap<Vec<u8>, Vec<(u32, bool)>> = Default::default();
        for (path, start, verdict) in statements {
            by_file.entry(path).or_default().push((start, verdict));
        }
        by_file
    }
}

/// The translation of a program along with its check. Each file is translated by the task that has checked it, while the types of the
/// task are alive, and what comes of the files is put together when all are done. Each call is for the hook of the driver's `Request`
/// that its description names.
pub struct Translation<'a> {
    constants: &'a Constants,
    explain: Explain,
    /// `None`: `begin` has not been called.
    begun: RwLock<Option<Begun<'a>>>,
}

struct Begun<'a> {
    /// `Program::files_without_whole_trees`
    without_whole_trees: Vec<FileId>,
    /// `None` unless that is empty. Nothing is made of a tree that is not whole, and the translation of a file looks into the trees of
    /// others.
    translating: Option<(build::Shared<'a>, Fragments)>,
}

impl<'a> Translation<'a> {
    pub fn new(constants: &'a Constants) -> Translation<'a> {
        Translation { constants, explain: Explain::default(), begun: RwLock::new(None) }
    }

    /// The same, which says of what it decides what is asked for.
    pub fn explaining(self, explain: Explain) -> Translation<'a> {
        Translation { explain, ..self }
    }

    /// `Request::loaded`. `entry_points`: for each, the files that are run when the program is started with it, in order. What can run then,
    /// whichever it is started with, is translated. A program that is loaded again is begun again.
    pub fn begin(&self, program: &Checked<'_>, entry_points: &[Vec<FileId>]) {
        let without_whole_trees = program.files_without_whole_trees();
        let translating = without_whole_trees.is_empty().then(|| (build::Shared::new(program, entry_points, self.constants), Fragments::new(program.files.modules.len())));
        *self.begun.write().unwrap_or_else(PoisonError::into_inner) = Some(Begun { without_whole_trees, translating });
    }

    /// `Request::before_visits`. What JavaScript is expected to do goes by how the whole program uses it. So the files that are
    /// visited are all looked at before the first of them is translated.
    pub fn note_file(&self, c: &mut Checker<'_, '_>, file: FileId) {
        let begun = self.begun.read().unwrap_or_else(PoisonError::into_inner);
        if let Some((shared, _)) = &begun.as_ref().expect(IS_BEGUN).translating
            && shared.is_compiled(file)
        {
            c.note_uses_of_functions_in(file);
        }
    }

    /// `Request::all_visited_once`
    pub fn merge_notes(&self, program: &Checked<'_>) {
        program.checker().merge_noted_uses_of_functions();
    }

    /// `Request::after_file`. Whatever an earlier call has made of the file is replaced. A file that is checked is translated before
    /// the notes on all files are there: what is expected in it goes by the file itself. A file with errors is translated like any
    /// other, with `any` where the checker has no type: whether the errors matter is known in the end.
    pub fn translate_file(&self, c: &mut Checker<'_, '_>, file: FileId) {
        let begun = self.begun.read().unwrap_or_else(PoisonError::into_inner);
        let Some((shared, fragments)) = &begun.as_ref().expect(IS_BEGUN).translating else { return };
        if !shared.is_compiled(file) {
            return;
        }
        if !c.knows_uses_of_functions() {
            c.note_uses_of_functions_in(file);
        }
        fragments.put(build::translate_file(c, shared, file));
    }

    /// `Request::compile`. `errors`: where the checker has found errors. An error stands only if it lies in code that is in the
    /// program: types that describe code that does not exist make no difference to the code that does. It does not stand in what a
    /// constant has cut away or stands in the place of, in an import that the bundler has dropped, in a function that nothing
    /// reaches, in a module that is not in the program. The declaration of a type is code of whatever it is written in. A
    /// declaration file is no code at all, and says what the code is: an error there stands. So does one outside of functions in a
    /// file that is no module of the program and that a module of the program imports, be it through other such files.
    pub fn finish(&self, program: &Checked<'_>, in_parallel: InParallel<'_>, errors: &[(FileId, u32)]) -> Translated {
        let begun = self.begun.read().unwrap_or_else(PoisonError::into_inner);
        let begun = begun.as_ref().expect(IS_BEGUN);
        let mut linked = match &begun.translating {
            Some((shared, fragments)) => {
                let mut c = program.checker();
                let errors = Errors { places: errors, imported_by: &mut |file| build::files_imported_by(&mut c, shared, file) };
                link::link(program, fragments.take(), shared.roots(), shared.entry_points(), shared.builtin_modules(), shared.prelude(), &self.constants.root, errors, in_parallel, self.explain, &|c, missing, is_defined| build::describe(c, shared, missing, is_defined))
            }
            // A file that is only code is not checked, so that nobody has reported it.
            None => {
                let does_not_parse = |&file: &FileId| Problem { file, pos: program.files.hir(file).error_pos, what: "a file that does not parse".into() };
                Linked { problems: begun.without_whole_trees.iter().map(does_not_parse).collect(), errors: errors.iter().map(|_| None).collect(), ..Linked::default() }
            }
        };
        for (elsewhere, _) in linked.errors.iter_mut().zip(errors).filter(|(_, place)| program.files.hir(place.0).kind == FileKind::Declaration) {
            *elsewhere = None;
        }
        let line_of = |file: FileId, pos: u32| {
            let text = &program.files.hir(file).text;
            text[..(pos as usize).min(text.len())].iter().filter(|&&b| b == b'\n').count() + 1
        };
        let why_errors_do_not_stand = (linked.errors.iter().zip(errors))
            .filter_map(|(elsewhere, &(file, _))| {
                Some(match elsewhere.as_ref()? {
                    Elsewhere::Cut(start) => format!("cut by a constant at line {}", line_of(file, *start)),
                    Elsewhere::DroppedImport => "in a dropped import".to_owned(),
                    Elsewhere::NotReached(name) => format!("in `{name}`, which is not reached"),
                    Elsewhere::NoModule => "the file is not in the program".to_owned(),
                })
            })
            .collect();
        let shown = |problem: &Problem| {
            let module = program.files.module(problem.file);
            format!("{}:{}: not compiled yet: {}", String::from_utf8_lossy(module.file_name()), line_of(problem.file, problem.pos), problem.what)
        };
        let problems = linked.problems.iter().map(shown).collect();
        let builtin_modules_left_out = linked.builtin_modules_left_out.iter().map(|(id, problem)| (*id, shown(problem))).collect();
        let builtin_functions_left_out = linked.builtin_functions_left_out.iter().map(|(id, problem)| (*id, shown(problem))).collect();
        Translated { program: linked.program, problems, members: linked.members, explained: linked.explained, errors_that_stand: linked.errors.iter().map(Option::is_none).collect(), why_errors_do_not_stand, builtin_modules_left_out, builtin_functions_left_out, times: linked.times }
    }

    /// The same as what the engine reads, with `Translated::errors_that_stand`. `Err`: what could not be translated. Nothing, if an
    /// error stands.
    pub fn finish_for_engine(&self, program: &Checked<'_>, in_parallel: InParallel<'_>, errors: &[(FileId, u32)]) -> (Result<Vec<u8>, Vec<String>>, Vec<bool>) {
        let translated = self.finish(program, in_parallel, errors);
        let written = if translated.errors_that_stand.contains(&true) {
            Err(Vec::new())
        } else if !translated.problems.is_empty() {
            Err(translated.problems)
        } else {
            Ok(format::write(&translated.program))
        };
        (written, translated.errors_that_stand)
    }
}

const IS_BEGUN: &str = "`begin` comes first";
