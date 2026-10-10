//! The globals of the program that a file belongs to, by its types.
//!
//! Nothing is type checked for it. The first question makes one request for all files of the run: for each
//! `tsconfig.json` that one of them belongs to, the libraries, the `types` and the files of the project that can
//! declare a global are loaded and bound, and the names are copied out.

use crate::run::Environment;
use bun_lint::linter::globals::{InferredGlobal, InferredGlobals};
use bun_sema::resolve::to_path;
use bun_sema::util::FxHashMap;
use bun_sema_driver::host::{Provided, from_native};
use std::sync::OnceLock;

pub(crate) struct Inferred<'e> {
    environment: &'e Environment<'e>,
    threads: usize,
    /// The files of the run that can ask, each as [`bun_lint::ast::File::path`] has it.
    paths: OnceLock<Vec<Vec<u8>>>,
    tables: OnceLock<Tables>,
}

struct Tables {
    is_case_sensitive: bool,
    /// By `tspath.Path`: where the names are in `lists`.
    of_file: FxHashMap<Vec<u8>, usize>,
    lists: Vec<Vec<InferredGlobal>>,
}

impl<'e> Inferred<'e> {
    pub(crate) fn new(environment: &'e Environment<'e>, threads: usize) -> Inferred<'e> {
        Inferred {
            environment,
            threads,
            paths: OnceLock::new(),
            tables: OnceLock::new(),
        }
    }

    /// Called once, before the first file is linted. Nothing is done with them before a file asks.
    pub(crate) fn files(&self, paths: Vec<Vec<u8>>) {
        let _ = self.paths.set(paths);
    }

    fn load(&self) -> Tables {
        let cwd = &self.environment.cwd;
        let paths = self.paths.get().into_iter().flatten();
        let paths: Vec<Vec<u8>> = paths
            .map(|it| crate::paths::to_native(it.clone()))
            .collect();
        let command_line = bun_sema_driver::parse_command_line(&[b"--skipLibCheck"], cwd);
        let request = bun_sema_driver::Request {
            cwd,
            project: None,
            listed_projects: None,
            build: false,
            errors: &[],
            paths: &paths,
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
                tables.lists.push(names.collect());
            }
            tables
        })
    }
}

impl InferredGlobals for Inferred<'_> {
    fn of(&self, path: &[u8]) -> Option<&[InferredGlobal]> {
        let tables = self.tables.get_or_init(|| self.load());
        let path = from_native(&crate::paths::to_native(path.to_vec()));
        let at = *(tables.of_file).get(&*to_path(&path, tables.is_case_sensitive))?;
        Some(&tables.lists[at])
    }
}
