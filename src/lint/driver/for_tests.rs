//! Lints the test cases of the rules with what `bun lint` lints a file with once it has found the
//! file and its configuration. For `bun lint --run-eslint-tests`, which only debug and canary
//! builds have.

use crate::cli::Options;
use crate::embedded::Framework;
use crate::lint::Context;
use crate::paths::{self, Style};
use crate::run::{Environment, Pool, Timing};
use crate::typed::{self, Typed};
use bun_lint::context::Severity;
use bun_lint::js_plugin;
use bun_lint::linter::config::Dotfiles;
use bun_lint::linter::{
    Config, FileConfig, LegacyFailure, LegacyFile, LegacyKind, LegacyOptions, LintMessage, Linter,
    Registry, RuleId, write_json,
};
use bun_lint::options::Json;
use bun_lint_conformance::{Case, Host, Place};
use bun_lint_graph::{Graph, Store};
use bun_sema::atom::Interner;
use bun_sema::session::Session;
use std::sync::Arc;

struct Tester<'e> {
    linter: Linter,
    environment: &'e Environment<'e>,
    js_plugins: js_plugin::Host<'e>,
}

impl Host for Tester<'_> {
    fn linter(&self) -> &Linter {
        &self.linter
    }

    fn lint(&self, case: &Case<'_>) -> Option<Vec<LintMessage>> {
        // Nothing here hands out the file before it is linted.
        if case.prepare.is_some() {
            return None;
        }
        let directory = match case.place {
            Place::Nowhere => &self.environment.cwd[..],
            Place::Project(project) => project,
            Place::Program(tsconfig) => crate::paths::dirname(tsconfig),
        };
        let options = Options {
            project: match case.place {
                Place::Program(tsconfig) => Some(tsconfig.to_vec()),
                _ => None,
            },
            threads: 1,
            ..Options::default()
        };
        let names = Session::new();
        let (store, timing) = (Store::new(directory), Timing::default());
        let context = Context {
            linter: &self.linter,
            options: &options,
            cwd: directory,
            of_oxlint: None,
            checks_types: false,
            keeps_text: true,
            reads_fixes: true,
            reads_help: true,
            reads_suppressions: true,
            js_plugins: &self.js_plugins,
            modules: &Graph::new(&store),
            formatter: &crate::fmt::ForRules::new(self.environment),
            timing: &timing,
            atoms: &Interner::new_in(&names),
            memory: &names,
            skipped_in_comments: &bun_threading::Guarded::new(Vec::new()),
            out_of_stack: &bun_threading::Guarded::new(Vec::new()),
            broken_fixes: &bun_threading::Guarded::new(Vec::new()),
            handed_back: &bun_threading::Guarded::new(Vec::new()),
            invalid_tsconfigs: &bun_threading::Guarded::new(Default::default()),
        };
        let config = Arc::new(case.config.clone());
        match case.place {
            Place::Nowhere => Some(match Framework::of(case.path) {
                Some(framework) if config.language.is_oxlint => {
                    let linted = context.verify_scripts(framework, case.path, case.code, &config);
                    linted.messages
                }
                _ => context.verify(case.path, case.code, &config).messages,
            }),
            Place::Project(_) => {
                let mut result = context.verify_text(
                    case.path.to_vec(),
                    case.path,
                    case.code.to_vec(),
                    &config,
                    &|_| (),
                );
                if !context
                    .modules
                    .complete(&|count, work| (0..count).for_each(work))
                    .is_empty()
                {
                    // Or it is read from the disk.
                    result.text = Some(case.code.to_vec());
                    context.lint_again(&mut result).ok()?;
                }
                Some(result.messages)
            }
            Place::Program(_) => {
                let environment = Environment {
                    cwd: directory.to_vec(),
                    ..*self.environment
                };
                let file = Typed {
                    path: case.path,
                    config: &config,
                    text: Some(case.code.to_vec()),
                };
                Some(
                    typed::lint(&context, &environment, &[file], &|_| ())
                        .pop()??
                        .messages,
                )
            }
        }
    }

    fn for_each(&self, threads: usize, count: usize, work: &(dyn Fn(usize) + Sync)) {
        Pool::new(threads).for_each(count, 1, work);
    }
}

fn registry() -> Registry {
    Registry::new(&[
        bun_lint_eslint::RULES,
        bun_lint_typescript::RULES,
        bun_lint_plugins::RULES,
        bun_lint_unicorn::RULES,
        bun_lint_react::RULES,
        bun_lint_jest::RULES,
    ])
}

fn object(entries: Vec<(&[u8], Json)>) -> Json {
    let entries = entries.into_iter();
    Json::Object(entries.map(|(key, value)| (key.to_vec(), value)).collect())
}

/// `{ basePath, flavor, config, extended, files, directories }`: what the configuration says about each file (`external`,
/// `ignored`, `unconfigured`, or the rules that are on) and whether each directory is ignored.
fn configuration_case(registry: &Registry, case: &Json) -> Json {
    let text = |key: &[u8]| case.get(key).and_then(Json::as_str);
    let list = |key: &[u8]| case.get(key).and_then(Json::as_array).unwrap_or_default();
    let base_path = text(b"basePath").unwrap_or(b"/");
    let null = Json::Null;
    let json = case.get(b"config").unwrap_or(&null);
    // By its path.
    let extended = |path: &[u8]| case.get(b"extended")?.get(path).cloned();
    let mut load = |directory: &[u8], name: &[u8]| {
        extended(&paths::resolve_as(Style::Windows, directory, name))
    };
    let config = match text(b"flavor") {
        Some(b"oxlint") => Config::from_rc_json(registry, base_path, json, &mut load),
        Some(b"eslintrc") => Config::from_legacy(
            registry,
            &LegacyOptions {
                root: b"/",
                cwd: base_path,
                ignore: true,
                extensions: None,
                rules: None,
                plugins_from: None,
                cascade: 1,
            },
            &[LegacyFile {
                path: paths::join(base_path, b".eslintrc.json"),
                name: b".eslintrc.json".to_vec(),
                base_path: base_path.to_vec(),
                json: json.clone(),
            }],
            &mut |kind, request, from, _| {
                let path = paths::resolve_as(
                    Style::Windows,
                    paths::dirname_as(Style::Windows, from),
                    request,
                );
                match (kind, extended(&path)) {
                    (LegacyKind::Config, Some(config)) => Ok(object(vec![
                        (b"path", Json::String(path)),
                        (b"config", config),
                    ])),
                    _ => Err(LegacyFailure {
                        message: [&b"There is no "[..], &path].concat(),
                        is_missing: true,
                    }),
                }
            },
            &mut |_, _| Err(Vec::new()),
        ),
        _ => Config::from_flat_json(registry, base_path, json),
    };
    let config = match config {
        Ok(config) => config,
        Err(error) => return object(vec![(b"error", Json::String(error.message))]),
    };
    let status = |file: &[u8]| match config.get(registry, file) {
        FileConfig::External => Json::String(b"external".to_vec()),
        FileConfig::Ignored => Json::String(b"ignored".to_vec()),
        FileConfig::Unconfigured => Json::String(b"unconfigured".to_vec()),
        FileConfig::Matched(resolved) => {
            let on = resolved.rules.iter();
            let on = on.filter(|it| it.severity != Severity::Off);
            let on = on.map(|it| Json::String(RuleId::Known(it.entry.meta).to_vec()));
            Json::Array(on.collect())
        }
    };
    let files = list(b"files").iter().filter_map(Json::as_str).map(status);
    let directories = list(b"directories").iter().filter_map(Json::as_str);
    let directories =
        directories.map(|it| Json::Bool(config.is_directory_ignored(it, Dotfiles::AsConfigured)));
    object(vec![
        (b"files", Json::Array(files.collect())),
        (b"directories", Json::Array(directories.collect())),
    ])
}

/// The file at `file` has a list of what [`configuration_case`] is given. Returns the list of what it answers.
fn configuration_cases(file: &[u8]) -> Option<Vec<u8>> {
    let cases = bun_lint::json::parse(&crate::fs::read(file).ok()?)?;
    let registry = registry();
    let answers = cases.as_array()?.iter();
    let answers = answers.map(|it| configuration_case(&registry, it));
    let mut out = Vec::new();
    write_json(&mut out, &Json::Array(answers.collect()));
    out.push(b'\n');
    Some(out)
}

/// `bun lint --run-path-tests <posix | windows> (<function> <a> <b>)..`, or `configurations <file>`: `args` is what follows the
/// flag. Returns what the functions answer, a line each: the paths of Windows are tested on every system. `None`: no such function.
pub fn run_path_tests(args: &[&[u8]]) -> Option<Vec<u8>> {
    let (style, mut rest) = match args {
        [b"posix", rest @ ..] => (Style::Posix, rest),
        [b"windows", rest @ ..] => (Style::Windows, rest),
        [b"configurations", file] => return configuration_cases(file),
        _ => return None,
    };
    let mut out = Vec::new();
    while let [function, a, b, after @ ..] = rest {
        rest = after;
        out.extend_from_slice(&match *function {
            b"resolve" => paths::resolve_as(style, a, b),
            b"relative" => paths::relative_as(style, a, b),
            b"inside" => match paths::inside_as(style, a, b) {
                Some(rest) => [b"inside: ", rest].concat(),
                None => b"outside".to_vec(),
            },
            b"dirname" => paths::dirname_as(style, a).to_vec(),
            b"namespaced" => paths::namespaced(a),
            _ => return None,
        });
        out.push(b'\n');
    }
    Some(out)
}

/// `bun lint --run-eslint-tests <bundle> ..`: `args` is what follows the flag. Prints the cases that
/// fail and the totals. Returns whether the tests could be run.
pub fn run_eslint_tests(args: &[&[u8]], environment: &Environment) -> bool {
    bun_lint_conformance::run_from_command_line(
        args,
        &Tester {
            linter: Linter::new(registry()),
            environment,
            js_plugins: js_plugin::Host::with_engine(
                environment.js_engine,
                &crate::paths::to_native(environment.cwd.clone()),
            ),
        },
    )
}
