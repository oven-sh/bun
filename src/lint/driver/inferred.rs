//! The globals of the program that a file belongs to, by its types.
//!
//! Nothing is type checked for it. The first question makes one request for all files of the run: for each
//! `tsconfig.json` that one of them belongs to, the libraries, the `types` and the files of the project that can
//! declare a global are loaded and bound, and the names are copied out.
//!
//! Under `InferGlobals::ByOptions` that is done for one program, and only when a file of it is about to report a name.
//! Until then the options of the project stand for its types: `environments`.

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
    /// The files of the run that can ask, each as [`bun_lint::ast::File::path`] has it.
    paths: OnceLock<Vec<Vec<u8>>>,
    tables: OnceLock<Tables>,
    by_options: Option<ByOptions>,
}

/// `InferGlobals::ByOptions`
struct ByOptions {
    outlines: Outlines,
    programs: AppendVec<Program>,
    /// By configuration file: where it is in `programs`.
    known: Guarded<FxHashMap<Vec<u8>, u32>>,
}

struct Program {
    outline: Arc<Outline>,
    /// Sorted by name.
    chosen: Vec<InferredGlobal>,
    /// What its types declare. `None`: it cannot be loaded.
    declared: OnceLock<Option<Vec<InferredGlobal>>>,
}

/// The environment that stands for a package of types.
fn environment_of(package: &[u8]) -> Option<&[u8]> {
    match package {
        // `bun` takes `node` in.
        b"node" | b"bun" | b"bun-types" => Some(b"node"),
        b"jest" | b"mocha" | b"jasmine" | b"jquery" => Some(package),
        b"vitest/globals" => Some(b"vitest"),
        _ => None,
    }
}

/// The environments whose tables stand for libraries and for the packages of types of a project. They have what is only
/// a value, which the table of the libraries has not: `window`, `parseInt`. What has none is left to the types.
fn environments(libs: &[Vec<u8>], outline: &Outline) -> Vec<Vec<u8>> {
    let mut all: Vec<Vec<u8>> = Vec::new();
    let mut add = |name: &[u8]| {
        // The table of an edition has the earlier ones.
        if !all.iter().any(|it| it == name) {
            all.push(name.to_vec());
        }
    };
    for lib in libs {
        // What `target` stands for without `lib`: the edition, and a browser.
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
        // `node` refers to an edition of its own.
        let known = (outline.types.iter()).filter(|it| environment_of(&it.0).is_some());
        let referenced = known.flat_map(|it| outlines.libs_referenced_by(&it.1));
        let libs: Vec<Vec<u8>> = outline.libs.iter().cloned().chain(referenced).collect();
        // typescript-eslint's table: each library, parts of editions too, with those that it refers to.
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
    /// By `tspath.Path`: where the names are in `lists`.
    of_file: FxHashMap<Vec<u8>, usize>,
    /// With `ProgramGlobals::checks_javascript`.
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
            by_options: by_options.then(|| ByOptions {
                outlines: Outlines::new(&environment.cwd),
                programs: AppendVec::new(),
                known: Default::default(),
            }),
        }
    }

    /// Called once, before the first file is linted. Nothing is done with them before a file asks.
    pub(crate) fn files(&self, paths: Vec<Vec<u8>>) {
        let _ = self.paths.set(paths);
    }

    /// `path`: as `File::path`.
    fn program(&self, path: &[u8]) -> Option<&Program> {
        let by_options = self.by_options.as_ref()?;
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

    /// `project`, `paths`: native paths.
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
            only: None,
            order: 1,
            digests: false,
            task_clock: None,
            plan_options: bun_sema_driver::PlanOptions {
                only_the_globals: true,
                // A script beside a project that does not include it is not written for the libraries of that project.
                only_in_a_project_that_includes: true,
                reads_sources_of_references: true,
                current_directory_is_of_the_project: true,
                reports_nothing_about_files: true,
                shares_every_file: true,
                prefers_the_library_of_the_project: true,
                ..Default::default()
            },
            retains_everything: false,
            stops_like_tsc: false,
            uses_typescript_wording: false,
            loaded: None,
            checked: None,
            after_file: None,
            declaration_file_emitted: None,
        };
        bun_sema_driver::check_provided_then(&request, Provided::default(), |report| {
            let mut tables = Tables {
                is_case_sensitive: report.is_case_sensitive,
                of_file: FxHashMap::default(),
                lists: Vec::with_capacity(report.globals.len()),
            };
            for of_program in report.globals {
                let at = tables.lists.len();
                let files = of_program.files.into_iter();
                tables.of_file.extend(files.map(|file| (file, at)));
                let names = of_program.names.into_iter().map(|it| InferredGlobal {
                    name: it.name,
                    is_value: it.is_value,
                    is_type: it.is_type,
                    is_writable: it.is_writable,
                });
                (tables.lists).push((names.collect(), of_program.checks_javascript));
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
        let at = *(tables.of_file).get(&*to_path(&path, tables.is_case_sensitive))?;
        let (names, checks_javascript) = &tables.lists[at];
        Some(ProgramGlobals {
            names,
            checks_javascript: *checks_javascript,
        })
    }
}
