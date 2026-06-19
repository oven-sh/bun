//! `bun explain` — deprecated alias for `bun why`.
//!
//! GitHub issue #23196: `bun explain` was removed in favor of `bun why`.
//! This command exists to give a friendly deprecation message and a hint
//! to use `bun why <pkg>` instead. It always exits 1 (so CI and scripts
//! notice) except when invoked with `--help`, which exits 0 and prints
//! a help-style pointer to `bun why` (matching the rest of the CLI's
//! `--help` contract — `Arguments.zig:434-439` short-circuits --help
//! to exit 0 before reaching this exec).

use bun_core::{Global, Output};

use crate::command;

pub(crate) struct ExplainCommand;

impl ExplainCommand {
    pub(crate) fn exec(_ctx: command::Context) -> Result<(), bun_core::Error> {
        Output::pretty_errorln(
            "<r><red>error<r>: <b>bun explain<r> has been removed.\n\
             \n\
             Use <green>bun why<r> <blue><package><r> instead. For example:\n\
             \n\
             <d>  $<r> <b><green>bun why<r> <blue>react<r>\n\
             \n\
             Full documentation: <magenta>https://bun.com/docs/cli/why<r>\n",
        );
        Output::flush();
        Global::exit(1);
    }
}
