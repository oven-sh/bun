//! `bun-lint conformance <fixtures> [--plugin=p] [--rule=r] [--report=dir] [--verbose] [--cases] [--types] [--threads=n] ..`: the
//! tests of ESLint, of typescript-eslint and of the plugins, which are run by the crate `bun_lint_conformance`. `<fixtures>` is
//! what is in `test/cli/lint/conformance/bundle.zst`, decompressed (then with `--projects=<directory> --extract`), or a directory
//! with the same files. A line for each rule is printed, with `--cases` one for each case that fails.

use crate::linter_cmd::{linter, with_file};
use crate::types_cmd::{Project, lint_project};
use bun_lint::linter::{Again, LintMessage, LintOptions, LintResult, Linter};
use bun_lint::options::Json;
use bun_lint::rule::Plugin;
use bun_lint::runner::RuleEntry;
use bun_lint_conformance::{Bundle, Case, Flags, Host, Outcome, Place};
use bun_lint_graph::{Graph, Store};
use std::path::Path;
use std::sync::OnceLock;

/// The linter as the harness runs it: without the driver.
struct Harness;

impl Host for Harness {
    fn linter(&self) -> &Linter {
        linter()
    }

    fn lint(&self, case: &Case<'_>) -> Option<Vec<LintMessage>> {
        let (code, config) = (case.code, case.config);
        let path = crate::text(case.path);
        match case.place {
            Place::Nowhere => Some(with_file(&path, code, &config.language, |file| {
                if let Some(prepare) = case.prepare {
                    prepare(file);
                }
                linter()
                    .lint(file, config, &LintOptions::default())
                    .messages
            })),
            Place::Project(project) => {
                let store = Store::new(project);
                let graph = Graph::new(&store);
                let lint = |previous: Option<&LintResult>| {
                    let options = LintOptions {
                        again: previous.map(|previous| Again {
                            previous,
                            had_types: false,
                        }),
                        ..LintOptions::default()
                    };
                    let linted = bun_lint_graph::with_file(
                        case.path,
                        code,
                        &config.language,
                        Some(&graph),
                        |file| linter().lint(file, config, &options),
                    );
                    linted.unwrap_or_default()
                };
                let first = lint(None);
                let is_linted_again = !graph
                    .complete(&|count, work| (0..count).for_each(work))
                    .is_empty();
                Some(if is_linted_again {
                    lint(Some(&first)).messages
                } else {
                    first.messages
                })
            }
            Place::Program(tsconfig) => {
                let tsconfig = crate::text(tsconfig);
                let files = [path];
                let project = Project {
                    cwd: tsconfig.rsplit_once('/').map_or(".", |it| it.0),
                    config: Some(&tsconfig),
                    files: &files,
                    overlay: vec![(files[0].clone(), code.to_vec())],
                    threads: 1,
                };
                let linted = lint_project(project, &config.language, &|file| {
                    linter()
                        .lint(file, config, &LintOptions::default())
                        .messages
                });
                linted.into_iter().next_back().map(|it| it.1)
            }
        }
    }

    fn for_each(&self, threads: usize, count: usize, work: &(dyn Fn(usize) + Sync)) {
        bun_sema_standalone::for_each_parallel(threads, count, work);
    }
}

/// The directory of the projects that some cases are files of.
static PROJECTS: OnceLock<String> = OnceLock::new();

/// What the rule `entry` reports for `code` as the file at `path`, as in a test of the rule that needs no types.
pub(crate) fn lint(
    entry: &'static RuleEntry,
    path: &str,
    code: &[u8],
    options: &[Json],
    language_options: &Json,
    settings: &Json,
) -> Outcome {
    let case = Json::Object(vec![
        (b"options".to_vec(), Json::Array(options.to_vec())),
        (b"languageOptions".to_vec(), language_options.clone()),
        (b"settings".to_vec(), settings.clone()),
    ]);
    let config = bun_lint_conformance::config_of(linter(), entry, &case);
    let directory = if entry.meta.plugin == Plugin::Node {
        "n-project"
    } else {
        "import-project"
    };
    let project = format!("{}/{directory}", PROJECTS.get().map_or(".", |it| &it[..]));
    let is_in_project = entry.meta.needs_modules || entry.meta.plugin == Plugin::Node;
    let path = if !is_in_project || path.starts_with(['<', '/']) {
        path.to_owned()
    } else {
        format!("{project}/{path}")
    };
    let messages = Harness.lint(&Case {
        code,
        path: path.as_bytes(),
        config: &config,
        place: if is_in_project {
            Place::Project(project.as_bytes())
        } else {
            Place::Nowhere
        },
        prepare: None,
    });
    Outcome::new(entry, code, &messages.unwrap_or_default())
}

/// The files below `directory`, by their path from `root`.
fn collect(root: &Path, directory: &Path, files: &mut Vec<(Vec<u8>, Vec<u8>)>) {
    for entry in std::fs::read_dir(directory).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, files);
        } else if let Ok(contents) = std::fs::read(&path) {
            files.push((
                path.strip_prefix(root)
                    .unwrap_or(&path)
                    .as_os_str()
                    .as_encoded_bytes()
                    .to_vec(),
                contents,
            ));
        }
    }
}

pub(crate) fn run(args: &[String]) {
    let path = Path::new(
        args.iter()
            .find(|it| !it.starts_with("--"))
            .expect("the fixtures"),
    );
    let raw: Vec<&[u8]> = args.iter().map(String::as_bytes).collect();
    let mut flags = Flags::parse(&raw);
    flags.table = !args.iter().any(|it| it == "--cases");
    let mut files = Vec::new();
    let bytes = if path.is_dir() {
        Vec::new()
    } else {
        std::fs::read(path).expect("the fixtures")
    };
    let absolute = std::fs::canonicalize(path)
        .map_or_else(|_| path.to_owned(), |it| it)
        .to_string_lossy()
        .into_owned();
    let bundle = match path.is_dir() {
        true => {
            collect(path, path, &mut files);
            let mut bundle = Bundle::default();
            files
                .iter()
                .for_each(|(path, contents)| bundle.insert(path, contents));
            flags.projects = flags.projects.or(Some(absolute.as_bytes()));
            bundle
        }
        false => Bundle::parse(&bytes).expect("a bundle"),
    };
    if let Some(projects) = flags.projects {
        let _ = PROJECTS.set(crate::text(projects));
    }
    bun_lint_conformance::run(&bundle, &flags, &Harness);
}
