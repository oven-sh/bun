//! `bun fmt`: formats JavaScript and TypeScript the way Prettier does. All of it is in
//! `bun_lint_driver::fmt`. See `lint_command.rs` for what that takes from the process.

use bun_core::{Global, ZStr};
use bun_format_conformance::{Bundle, Flags, Format};
use bun_lint_driver::fmt::cli::{Options, UsageError};

use super::command::{ContextData, Tag};
use super::lint_command::{read_bunfigs, run_and_exit, usage_error};
use bun_bunfig::Above;

pub(crate) struct FormatCommand;

pub(crate) use bun_lint_driver::fmt::cli::HELP;

/// Whether `bun fmt --run-prettier-tests` exists, for `test/cli/format/conformance.test.ts`. A
/// release build has none of it.
const HAS_TEST_RUNNER: bool = bun_core::Environment::IS_CANARY || bun_core::Environment::IS_DEBUG;

fn test_runner(flag: &[u8]) -> Option<fn(&Bundle<'_>, &Flags<'_>, Format<'_>)> {
    match flag {
        b"--run-prettier-tests" => Some(bun_format_conformance::run_prettier_tests),
        b"--run-oxfmt-tests" => Some(bun_format_conformance::run_oxfmt_tests),
        _ => None,
    }
}

impl FormatCommand {
    /// Whether `bun fmt <flag>` is a valid command line.
    pub(crate) fn has_flag(flag: &[u8]) -> bool {
        Options::parse(&[flag]).is_ok()
    }

    /// `args`: what follows `format`.
    pub(crate) fn exec(ctx: &mut ContextData, args: &[&ZStr]) -> ! {
        // `--debug-check-svelte <before> <after> ..`, for `test/cli/format/svelte/svelte.test.ts`: a line for each pair.
        if HAS_TEST_RUNNER
            && let [flag, pairs @ ..] = args
            && flag.as_bytes() == b"--debug-check-svelte"
        {
            let read = |path: &ZStr| bun_format_conformance::read_file(path.as_bytes());
            for [before, after] in pairs.as_chunks::<2>().0 {
                let is_same = matches!((read(before), read(after)), (Some(before), Some(after))
                    if bun_lint_driver::fmt::is_same_svelte_for_tests(&before, &after));
                bun_format_conformance::output_line!(
                    "{}",
                    if is_same { "same" } else { "different" }
                );
            }
            Global::exit(0);
        }
        if HAS_TEST_RUNNER
            && let [first, rest @ ..] = args
            && let Some(run) = test_runner(first.as_bytes())
        {
            let rest: Vec<&[u8]> = rest.iter().map(|arg| arg.as_bytes()).collect();
            let ran = bun_format_conformance::run_from_command_line(
                &rest,
                run,
                &|path, text, options| {
                    bun_lint_driver::fmt::format_for_tests(path, text, options).map_err(|refusal| {
                        match refusal {
                            bun_lint_driver::fmt::Refusal::Syntax => {
                                bun_format_conformance::Failure::SyntaxError
                            }
                            bun_lint_driver::fmt::Refusal::Bug => {
                                bun_format_conformance::Failure::Other
                            }
                        }
                    })
                },
            );
            Global::exit(u32::from(!ran));
        }
        let args: Vec<&[u8]> = args.iter().map(|arg| arg.as_bytes()).collect();
        let options = match Options::parse(&args) {
            Ok(options) => options,
            Err(UsageError(message)) => usage_error("fmt", &message),
        };
        if options.help {
            crate::cli::command::tag_print_help(Tag::FormatCommand, options.all);
            Global::exit(0);
        }
        let cwd = options.cwd.clone();
        run_and_exit(b"fmt", cwd.as_deref(), |environment| {
            let mut defaults = None;
            read_bunfigs(
                ctx,
                Tag::FormatCommand,
                b"fmt",
                &mut |file, path, is_named| {
                    let section = bun_lint_driver::bunfig::format(file)?;
                    defaults = section.map(|it| it.of_bunfig_at(path, is_named));
                    Ok(match defaults {
                        Some(_) => Above::Unwanted,
                        None => Above::Needed,
                    })
                },
            );
            let options = match defaults.map(|defaults| Options::parse_over(defaults, &args)) {
                None => options,
                Some(Ok(options)) => options,
                Some(Err(UsageError(message))) => usage_error("fmt", &message),
            };
            bun_lint_driver::fmt::run(&options, environment)
        })
    }
}
