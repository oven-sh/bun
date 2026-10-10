//! `bun-lint conformance <fixtures> [--plugin=p] [--rule=r] [--report=dir] [--verbose] [--cases] [--types] [--threads=n] ..`: the
//! tests of ESLint, of typescript-eslint and of the plugins, which are run by the crate `bun_lint_conformance`. `<fixtures>` is
//! what is in `test/cli/lint/conformance/bundle.zst`, decompressed (then with `--projects=<directory> --extract`), or a directory
//! with the same files. A line for each rule is printed, with `--cases` one for each case that fails.

use crate::host::{self, error_line};
use crate::linter_cmd::{linter, with_file};
use crate::types_cmd::{Project, lint_project};
use bun_lint::linter::{Again, LintMessage, LintOptions, LintResult, Registry};
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
    fn registry(&self) -> &Registry {
        linter().registry()
    }

    fn lint(&self, case: &Case<'_>) -> Option<Vec<LintMessage>> {
        let (code, config) = (case.code, case.config);
        // The formatter comes with the driver: `bun-lint cli --run-eslint-tests`.
        if config.has_enabled(|meta| meta.plugin == Plugin::Prettier) {
            return None;
        }
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
                    cwd: host::rsplit_once(&tsconfig, "/").map_or(".", |it| it.0),
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
    let config = bun_lint_conformance::config_of(linter().registry(), entry, &case);
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
    for path in host::list(directory) {
        if path.is_dir() {
            collect(root, &path, files);
        } else if let Ok(contents) = host::read(&path) {
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

fn usage(problem: &str) -> ! {
    error_line!("{problem}");
    error_line!(
        "usage: bun-lint conformance <fixtures> [--plugin=p] [--rule=r] [--verbose] [--cases] [--types] [--threads=n]"
    );
    std::process::exit(2)
}

pub(crate) fn run(args: &[String]) {
    let Some(path) = args.iter().find(|it| !it.starts_with("--")) else {
        usage("<fixtures>: a directory, or bundle.zst decompressed");
    };
    let path = Path::new(path);
    let raw: Vec<&[u8]> = args.iter().map(String::as_bytes).collect();
    let mut flags = Flags::parse(&raw);
    flags.table = !args.iter().any(|it| it == "--cases");
    let mut files = Vec::new();
    let bytes = if path.is_dir() {
        Vec::new()
    } else {
        host::read(path).unwrap_or_else(|_| usage("the fixtures cannot be read"))
    };
    let absolute = host::real_path(path)
        .unwrap_or_else(|_| path.to_owned())
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
        false => Bundle::parse(&bytes).unwrap_or_else(|| usage("the file is no bundle")),
    };
    if let Some(projects) = flags.projects {
        let _ = PROJECTS.set(crate::text(projects));
    }
    bun_lint_conformance::run(&bundle, &flags, &Harness);
}
