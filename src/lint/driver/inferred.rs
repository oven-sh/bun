//! Infers a file's globals from the types of the program it belongs to.
//!
//! Nothing is type checked for this. The first lookup makes one request for all the run's files. For each
//! `tsconfig.json` that one of them belongs to, it loads and binds the libraries, the `types` and the project files
//! that can declare a global, then copies out the names.
//!
//! With `InferGlobals::ByOptions`, that's done for one program at a time, and only when one of its files is about to
//! report a name. Until then the project's options approximate its types. See `environments`.

use crate::run::Environment;
use bun_lint::language::{Global, LanguageOptions};
use bun_lint::linter::globals::{
    InferredGlobal, InferredGlobals, ProgramGlobals, Tables as Whose, environment,
};
use bun_sema::resolve::to_path;
use bun_sema::util::{AppendVec, FxHashMap};
use bun_sema_driver::host::{Provided, from_native, to_native};
use bun_sema_driver::outline::{Outline, Outlines};
use bun_threading::Guarded;
use std::sync::{Arc, OnceLock};

pub(crate) struct Inferred<'e> {
    environment: &'e Environment<'e>,
    threads: usize,
    /// The run's files that can look up globals, each spelled like [`bun_lint::ast::File::path`].
    paths: OnceLock<Vec<Vec<u8>>>,
    tables: OnceLock<Tables>,
    /// `Inferred::searched`
    searched: OnceLock<[Vec<Vec<u8>>; 2]>,
    /// Built on the first lookup.
    by_options: Option<OnceLock<ByOptions>>,
}

/// `InferGlobals::ByOptions`
struct ByOptions {
    outlines: Outlines,
    programs: AppendVec<Program>,
    /// Maps a config file to its index in `programs`.
    known: Guarded<FxHashMap<Vec<u8>, u32>>,
}

struct Program {
    outline: Arc<Outline>,
    /// Sorted by name.
    chosen: Vec<InferredGlobal>,
    /// The globals its types declare. `None` if it can't be loaded.
    declared: OnceLock<Option<Vec<InferredGlobal>>>,
}

/// Returns the environment that approximates a types package.
fn environment_of(package: &[u8]) -> Option<&[u8]> {
    match package {
        // `bun` includes `node`.
        b"node" | b"bun" | b"bun-types" => Some(b"node"),
        b"jest" | b"mocha" | b"jasmine" | b"jquery" => Some(package),
        b"vitest/globals" => Some(b"vitest"),
        _ => None,
    }
}

/// Returns the environments whose tables approximate a project's libraries and types packages. They include names that
/// are only values, like `window` and `parseInt`, which the library table lacks. Anything without an environment is
/// left to the types.
fn environments(libs: &[Vec<u8>], outline: &Outline) -> Vec<Vec<u8>> {
    let mut all: Vec<Vec<u8>> = Vec::new();
    let mut add = |name: &[u8]| {
        // An edition's table includes the earlier editions.
        if !all.iter().any(|it| it == name) {
            all.push(name.to_vec());
        }
    };
    for lib in libs {
        // The default library that `target` implies without `lib`: the edition plus a browser.
        let (edition, is_full): (&[u8], bool) = match &lib[..] {
            b"" => (b"es5", true),
            b"es6" => (b"es2015", true),
            lib => match lib.strip_suffix(b".full") {
                Some(edition) => (edition, true),
                None => (lib, false),
            },
        };
        match edition {
            b"dom" => add(b"browser"),
            b"webworker" => add(b"worker"),
            b"esnext" => add(b"es2026"),
            edition if edition.starts_with(b"es") => add(edition),
            _ => {}
        }
        if is_full {
            add(b"browser");
        }
    }
    for package in &outline.types {
        if let Some(name) = environment_of(&package.0) {
            add(name);
        }
    }
    all
}

impl Program {
    fn new(outline: Arc<Outline>, outlines: &Outlines) -> Program {
        // `node`'s types reference an edition themselves.
        let known = (outline.types.iter()).filter(|it| environment_of(&it.0).is_some());
        let referenced = known.flat_map(|it| outlines.libs_referenced_by(&it.1));
        let libs: Vec<Vec<u8>> = outline.libs.iter().cloned().chain(referenced).collect();
        // typescript-eslint's table has each library, including parts of editions, with the libraries it references.
        let mut language = LanguageOptions::default();
        let name_in_table = |lib: &Vec<u8>| -> Box<[u8]> {
            match lib.is_empty() {
                true => b"lib"[..].into(),
                false => lib[..].into(),
            }
        };
        language.lib = Some(libs.iter().map(name_in_table).collect());
        let values = language.lib_variables().filter(|it| it.2);
        let mut chosen: Vec<InferredGlobal> = values
            .map(|it| InferredGlobal {
                name: it.0.into(),
                is_value: true,
                is_type: it.1,
                is_writable: false,
            })
            .collect();
        for name in environments(&libs, &outline) {
            let variables = environment(&name, Whose::Today).into_iter().flatten();
            chosen.extend(
                variables
                    .filter(|it| it.1 != Global::Off)
                    .map(|it| InferredGlobal {
                        name: it.0.into(),
                        is_value: true,
                        is_type: true,
                        is_writable: it.1 == Global::Writable,
                    }),
            );
        }
        chosen.sort_by(|a, b| a.name.cmp(&b.name));
        chosen.dedup_by(|a, b| a.name == b.name);
        Program {
            outline,
            chosen,
            declared: OnceLock::new(),
        }
    }
}

struct Tables {
    is_case_sensitive: bool,
    /// Maps a `tspath.Path` to its program's index in `lists`.
    list_by_file: FxHashMap<Vec<u8>, usize>,
    /// Each list comes with its `ProgramGlobals::checks_javascript`.
    lists: Vec<(Vec<InferredGlobal>, bool)>,
}

impl<'e> Inferred<'e> {
    pub(crate) fn new(
        environment: &'e Environment<'e>,
        threads: usize,
        by_options: bool,
    ) -> Inferred<'e> {
        Inferred {
            environment,
            threads,
            paths: OnceLock::new(),
            tables: OnceLock::new(),
            searched: OnceLock::new(),
            by_options: by_options.then(OnceLock::new),
        }
    }

    /// Called once, before the first file is linted, and not from a pool thread. Without `ByOptions`, every file looks
    /// up its globals in the types, so the request is made here, where it has the pool to itself.
    pub(crate) fn files(&self, paths: Vec<Vec<u8>>) {
        let loads_now = self.by_options.is_none() && !paths.is_empty();
        let _ = self.paths.set(paths);
        if loads_now {
            self.tables.get_or_init(|| self.load_all());
        }
    }

    /// Called once, before the first file is linted. `from` holds the directories where the file search began. Every
    /// directory between one of them and a found file has been listed. `configs` holds the `tsconfig.json` and
    /// `jsconfig.json` files in those directories. All paths are spelled like `File::path`.
    pub(crate) fn searched(&self, from: Vec<Vec<u8>>, configs: Vec<Vec<u8>>) {
        let _ = self.searched.set([from, configs].map(|paths| {
            let paths = paths.into_iter().map(crate::paths::to_native);
            paths.collect()
        }));
    }

    /// Run by one thread while the others lint their first files. Otherwise they'd all do their first lookup at the
    /// same time and wait for the one that reads the options. The cost is paid even if no file does a lookup. Does
    /// nothing if no file can.
    pub(crate) fn begin(&self) {
        if let Some(first) = self.paths.get().and_then(|it| it.first()) {
            let _ = self.program(first);
        }
    }

    /// `path` is spelled like `File::path`.
    fn program(&self, path: &[u8]) -> Option<&Program> {
        let by_options = self.by_options.as_ref()?.get_or_init(|| ByOptions {
            outlines: match self.searched.get() {
                Some([from, configs]) => Outlines::new(&self.environment.cwd, from, configs),
                None => Outlines::new(&self.environment.cwd, &[], &[]),
            },
            programs: AppendVec::new(),
            known: Default::default(),
        });
        let outline = (by_options.outlines).of(&crate::paths::to_native(path.to_vec()))?;
        let mut known = by_options.known.lock();
        let at = match known.get(&outline.config_path) {
            Some(&at) => at,
            None => {
                let config = outline.config_path.clone();
                let at = (by_options.programs).push(Program::new(outline, &by_options.outlines));
                known.insert(config, at);
                at
            }
        };
        drop(known);
        Some(by_options.programs.get(at))
    }

    fn load_all(&self) -> Tables {
        let paths = self.paths.get().into_iter().flatten();
        let paths: Vec<Vec<u8>> = paths
            .map(|it| crate::paths::to_native(it.clone()))
            .collect();
        self.load(None, &paths)
    }

    /// `project` and `paths` are native paths.
    fn load(&self, project: Option<&[u8]>, paths: &[Vec<u8>]) -> Tables {
        let cwd = &self.environment.cwd;
        let command_line = bun_sema_driver::parse_command_line(&[b"--skipLibCheck"], cwd);
        let request = bun_sema_driver::Request {
            cwd,
            project,
            listed_projects: None,
            build: false,
            errors: &[],
            paths,
            are_entry_points: false,
            script_kinds: &[],
            script_kinds_by_extension: &[],
            conditions: &[],
            compiler_options: &command_line.compiler_options,
            threads: self.threads,
            libs: self.environment.libs,
            progress: None,
            order: 1,
            plan_options: bun_sema_driver::PlanOptions {
                only_globals: true,
                // A script next to a project that doesn't include it wasn't written for that project's libraries.
                requires_including_project: true,
                reads_sources_of_references: true,
                uses_project_directory_as_cwd: true,
                skips_file_diagnostics: true,
                shares_every_file: true,
                prefers_project_typescript_libs: true,
                ..Default::default()
            },
            stops_like_tsc: false,
            uses_typescript_wording: false,
            after_file: None,
        };
        bun_sema_driver::check_provided_then(&request, Provided::default(), |report| {
            let mut tables = Tables {
                is_case_sensitive: report.is_case_sensitive,
                list_by_file: FxHashMap::default(),
                lists: Vec::with_capacity(report.globals.len()),
            };
            for program_report in report.globals {
                let at = tables.lists.len();
                let files = program_report.files.into_iter();
                tables.list_by_file.extend(files.map(|file| (file, at)));
                let names = program_report.names.into_iter().map(|it| InferredGlobal {
                    name: it.name,
                    is_value: it.is_value,
                    is_type: it.is_type,
                    is_writable: it.is_writable,
                });
                (tables.lists).push((names.collect(), program_report.checks_javascript));
            }
            tables
        })
    }
}

impl InferredGlobals for Inferred<'_> {
    fn chosen(&self, path: &[u8]) -> Option<ProgramGlobals<'_>> {
        if self.by_options.is_none() {
            return self.of(path);
        }
        let program = self.program(path)?;
        Some(ProgramGlobals {
            names: &program.chosen,
            checks_javascript: program.outline.checks_javascript,
        })
    }

    fn of(&self, path: &[u8]) -> Option<ProgramGlobals<'_>> {
        if self.by_options.is_some() {
            let program = self.program(path)?;
            let declared = program.declared.get_or_init(|| {
                let config = to_native(&program.outline.config_path);
                let path = crate::paths::to_native(path.to_vec());
                let mut tables = self.load(Some(config), &[path]);
                tables.lists.pop().map(|it| it.0)
            });
            return Some(ProgramGlobals {
                names: declared.as_ref()?,
                checks_javascript: program.outline.checks_javascript,
            });
        }
        let tables = self.tables.get_or_init(|| self.load_all());
        let path = from_native(&crate::paths::to_native(path.to_vec()));
        let at = *(tables.list_by_file).get(&*to_path(&path, tables.is_case_sensitive))?;
        let (names, checks_javascript) = &tables.lists[at];
        Some(ProgramGlobals {
            names,
            checks_javascript: *checks_javascript,
        })
    }
}
