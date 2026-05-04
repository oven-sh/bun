use bstr::BStr;

use bun_bundler::Transpiler;
use bun_core::{Global, Output};
use bun_jsc::config::configure_transform_options_for_bun_vm;
use bun_jsc::MiniEventLoop;
use bun_paths::{self, PathBuffer, Platform};
use bun_shell::Interpreter;
use bun_sys;

use crate::command::Context;

pub struct ExecCommand;

impl ExecCommand {
    // TODO(port): narrow error set
    pub fn exec(ctx: Context) -> Result<(), bun_core::Error> {
        let script: &[u8] = &ctx.positionals[1];
        // this is a hack: make dummy bundler so we can use its `.runEnvLoader()` function to populate environment variables probably should split out the functionality
        let mut bundle = Transpiler::init(
            ctx.log,
            configure_transform_options_for_bun_vm(ctx.args)?,
            None,
        )?;
        // PORT NOTE: reshaped for borrowck — read field before &mut method call
        let disable_default_env_files = bundle.options.env.disable_default_env_files;
        bundle.run_env_loader(disable_default_env_files)?;
        let mut buf = PathBuffer::uninit();
        let cwd: &[u8] = match bun_sys::getcwd(&mut buf) {
            Ok(p) => p,
            Err(e) => {
                Output::err(
                    e,
                    format_args!("failed to run script <b>{}<r>", BStr::new(script)),
                );
                Global::exit(1);
            }
        };
        let mini = MiniEventLoop::init_global(bundle.env, cwd);
        let parts: [&[u8]; 2] = [
            cwd,
            b"[eval]",
        ];
        let script_path = bun_paths::join(&parts, Platform::Auto);

        let code = match Interpreter::init_and_run_from_source(ctx, mini, script_path, script, None) {
            Ok(c) => c,
            Err(err) => {
                Output::err(
                    err,
                    format_args!("failed to run script <b>{}<r>", BStr::new(script_path)),
                );
                Global::exit(1);
            }
        };

        // if (code > 0) {
        //     if (code != 2 and !silent) {
        //         Output.prettyErrorln("<r><red>error<r><d>:<r> script <b>\"{s}\"<r> exited with code {d}<r>", .{ name, code });
        //         Output.flush();
        //     }

        Global::exit(code);
        // }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/exec_command.zig (46 lines)
//   confidence: medium
//   todos:      1
//   notes:      Output::err signature & bun_paths::join API guessed; ctx ownership vs borrow into Interpreter may need adjusting
// ──────────────────────────────────────────────────────────────────────────
