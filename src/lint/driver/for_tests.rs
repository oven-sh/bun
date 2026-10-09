//! Lints the test cases of the rules with what `bun lint` lints a file with once it has found the
//! file and its configuration. For `bun lint --run-eslint-tests`, which only debug and canary
//! builds have.

use crate::cli::Options;
use crate::embedded::Framework;
use crate::lint::Context;
use crate::run::{Environment, Pool, Timing};
use crate::typed::{self, Typed};
use bun_lint::js_plugin;
use bun_lint::linter::{LintMessage, Linter, Registry};
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
            reads_suppressions: true,
            js_plugins: &self.js_plugins,
            modules: &Graph::new(&store),
            timing: &timing,
            atoms: &Interner::new_in(&names),
            memory: &names,
            skipped_in_comments: &bun_threading::Guarded::new(Vec::new()),
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

/// `bun lint --run-eslint-tests <bundle> ..`: `args` is what follows the flag. Prints the cases that
/// fail and the totals. Returns whether the tests could be run.
pub fn run_eslint_tests(args: &[&[u8]], environment: &Environment) -> bool {
    bun_lint_conformance::run_from_command_line(
        args,
        &Tester {
            linter: Linter::new(Registry::new(&[
                bun_lint_eslint::RULES,
                bun_lint_typescript::RULES,
                bun_lint_plugins::RULES,
                bun_lint_unicorn::RULES,
                bun_lint_react::RULES,
                bun_lint_jest::RULES,
            ])),
            environment,
            js_plugins: js_plugin::Host::with_engine(
                environment.js_engine,
                &crate::paths::to_native(environment.cwd.clone()),
            ),
        },
    )
}
