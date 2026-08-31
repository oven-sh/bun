use bstr::BStr;

use bun_bundler::Transpiler;
use bun_core::{Global, Output};
use bun_options_types::schema::api;

use crate::shell::Interpreter;
use bun_paths::{self, PathBuffer};
use bun_sys;

use crate::command::Context;

pub(crate) struct ExecCommand;

/// Process-lifetime arena for the exec command's `Transpiler`; threads an
/// `&'static Arena` per PORTING.md §AST crates. Routes through the shared
/// `cli::cli_arena()` like `run_command::runner_arena`.
fn exec_arena() -> &'static bun_alloc::Arena {
    crate::cli::cli_arena()
}

impl ExecCommand {
    pub(crate) fn exec(ctx: Context) -> Result<(), crate::Error> {
        // Clone the positional so `ctx` can be reborrowed `&mut` for
        // `init_and_run_from_source` below.
        let script: Box<[u8]> = ctx.positionals[1].clone();
        // this is a hack: make dummy bundler so we can use its `.runEnvLoader()` function to populate environment variables probably should split out the functionality
        let mut bundle = Transpiler::init(
            exec_arena(),
            ctx.log_ptr(),
            {
                let mut args = ctx.args.clone();
                args.write = Some(false);
                args.target = Some(api::Target::Bun);
                args
            },
            None,
        )?;
        // Read the field before the `&mut` method call (borrowck).
        let disable_default_env_files = bundle.options.env.disable_default_env_files;
        bundle.run_env_loader(disable_default_env_files)?;
        let mut buf = PathBuffer::uninit();
        let cwd: &[u8] = match bun_sys::getcwd(&mut *buf) {
            Ok(n) => &buf[..n],
            Err(e) => {
                Output::err(e, "failed to run script <b>{}<r>", (BStr::new(&script),));
                Global::exit(1);
            }
        };
        let mini = bun_event_loop::MiniEventLoop::GlobalMiniEventLoop::init(
            Some(bun_ptr::BackRef::new_mut(bundle.env_mut())),
            Some(cwd),
        );
        let parts: [&[u8]; 2] = [cwd, b"[eval]"];
        let script_path = bun_paths::resolve_path::join::<bun_paths::platform::Auto>(&parts);

        let code =
            match Interpreter::init_and_run_from_source(ctx, mini, script_path, &script, None) {
                Ok(c) => c,
                Err(err) => {
                    Output::err(
                        err,
                        "failed to run script <b>{}<r>",
                        (BStr::new(script_path),),
                    );
                    Global::exit(1);
                }
            };

        Global::exit(u32::from(code));
    }
}
