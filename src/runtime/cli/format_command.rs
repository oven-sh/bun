//! `bun format`: formats JavaScript and TypeScript the way Prettier does. All of it is in
//! `bun_lint_driver::fmt`. See `lint_command.rs` for what that takes from the process.

use bun_core::{Global, ZStr};
use bun_lint_driver::fmt::cli::{Options, UsageError};

pub(crate) struct FormatCommand;

/// For the help.
pub(crate) use bun_lint_driver::fmt::cli::PARAMS;

impl FormatCommand {
    /// `args`: what follows `format`.
    pub(crate) fn exec(args: &[&ZStr]) -> ! {
        let args: Vec<&[u8]> = args.iter().map(|arg| arg.as_bytes()).collect();
        let options = match Options::parse(&args) {
            Ok(options) => options,
            Err(UsageError(message)) => super::lint_command::usage_error("format", &message),
        };
        if options.help {
            crate::cli::command::tag_print_help(crate::cli::command::Tag::FormatCommand, true);
            Global::exit(0);
        }
        super::lint_command::run_and_exit(b"format", options.cwd.as_deref(), |environment| {
            bun_lint_driver::fmt::run(&options, environment)
        })
    }
}
