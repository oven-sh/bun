//! `bun format`: formats JavaScript and TypeScript the way Prettier does. All of it is in
//! `bun_lint_driver::fmt`. See `lint_command.rs` for what that takes from the process.

use bun_core::{Global, ZStr};
use bun_format_conformance::{Bundle, Flags, Format};
use bun_lint_driver::fmt::cli::{Options, UsageError};

use super::command::{ContextData, Tag};
use super::lint_command::{defaults_of_bunfig, run_and_exit, usage_error};

pub(crate) struct FormatCommand;

/// For the help.
pub(crate) use bun_lint_driver::fmt::cli::PARAMS;

/// Whether `bun format --run-prettier-tests` exists, for `test/cli/format/conformance.test.ts`. A
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
    /// `args`: what follows `format`.
    pub(crate) fn exec(ctx: &mut ContextData, args: &[&ZStr]) -> ! {
        if HAS_TEST_RUNNER
            && let [first, rest @ ..] = args
            && let Some(run) = test_runner(first.as_bytes())
        {
            let rest: Vec<&[u8]> = rest.iter().map(|arg| arg.as_bytes()).collect();
            let ran = bun_format_conformance::run_from_command_line(
                &rest,
                run,
                &|path, text, options| {
                    bun_lint_driver::fmt::format_for_tests(path, text, options, false).map_err(
                        |refusal| match refusal {
                            bun_lint_driver::fmt::Refusal::Syntax => {
                                bun_format_conformance::Failure::SyntaxError
                            }
                            _ => bun_format_conformance::Failure::Other,
                        },
                    )
                },
            );
            Global::exit(u32::from(!ran));
        }
        let args: Vec<&[u8]> = args.iter().map(|arg| arg.as_bytes()).collect();
        let options = match Options::parse(&args) {
            Ok(options) => options,
            Err(UsageError(message)) => usage_error("format", &message),
        };
        if options.help {
            crate::cli::command::tag_print_help(Tag::FormatCommand, true);
            Global::exit(0);
        }
        let cwd = options.cwd.clone();
        run_and_exit(b"format", cwd.as_deref(), |environment| {
            let read = bun_lint_driver::bunfig::format;
            let defaults = defaults_of_bunfig(ctx, Tag::FormatCommand, b"format", read);
            let options = match defaults.map(|defaults| Options::parse_over(defaults, &args)) {
                None => options,
                Some(Ok(options)) => options,
                Some(Err(UsageError(message))) => usage_error("format", &message),
            };
            bun_lint_driver::fmt::run(&options, environment)
        })
    }
}
