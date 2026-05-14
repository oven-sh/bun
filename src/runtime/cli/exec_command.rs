use bstr::BStr;

use bun_bundler::Transpiler;
use bun_core::{Global, Output};
use bun_options_types::schema::api;

use crate::shell::Interpreter;
use bun_paths::{self, PathBuffer};
use bun_sys;

use crate::command::Context;

pub struct ExecCommand;

/// Process-lifetime arena for the exec command's `Transpiler`. Zig passed
/// `ctx.allocator` (== `bun.default_allocator`); the Rust port threads an
/// `&'static Arena` per PORTING.md §AST crates. Same `Once`-guarded
/// `RacyCell<MaybeUninit>` shape as `run_command::runner_arena` (Bump is
/// `!Sync`, so `OnceLock` cannot hold it directly).
fn exec_arena() -> &'static bun_alloc::Arena {
    static ONCE: std::sync::Once = std::sync::Once::new();
    // PORTING.md §Global mutable state: `Once`-guarded init; RacyCell because
    // `Bump` is `!Sync` so `OnceLock<Arena>` can't be used.
    static ARENA: bun_core::RacyCell<::core::mem::MaybeUninit<bun_alloc::Arena>> =
        bun_core::RacyCell::new(::core::mem::MaybeUninit::uninit());
    ONCE.call_once(|| {
        // SAFETY: one-time init under `Once`; no concurrent writer.
        unsafe { (*ARENA.get()).write(bun_alloc::Arena::new()) };
    });
    // SAFETY: initialized exactly once above; `bun exec` is a single-shot CLI
    // command on the dispatch thread, so the `!Sync` Bump is never observed
    // concurrently.
    unsafe { (*ARENA.get()).assume_init_ref() }
}

impl ExecCommand {
    // TODO(port): narrow error set
    pub fn exec(ctx: Context) -> Result<(), bun_core::Error> {
        // PORT NOTE: reshaped for borrowck — clone the positional so `ctx`
        // can be reborrowed `&mut` for `init_and_run_from_source` below.
        let script: Box<[u8]> = ctx.positionals[1].clone();
        // this is a hack: make dummy bundler so we can use its `.runEnvLoader()` function to populate environment variables probably should split out the functionality
        let mut bundle = Transpiler::init(
            exec_arena(),
            ctx.log,
            {
                // `configure_transform_options_for_bun_vm` (3 field writes).
                let mut args = ctx.args.clone();
                args.write = Some(false);
                args.resolve = Some(api::ResolveMode::Lazy);
                args.target = Some(api::Target::Bun);
                args
            },
            None,
        )?;
        // PORT NOTE: reshaped for borrowck — read field before &mut method call
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
        // SAFETY: `Transpiler::init` always populates `env` (caller-supplied,
        // process singleton, or freshly `heap::alloc`'d) — never null. The
        // loader is a thread-/process-lifetime singleton, so `&'static mut` is
        // sound for the single CLI dispatch thread.
        let env = unsafe { &mut *bundle.env.cast::<bun_dotenv::Loader<'static>>() };
        let mini = bun_event_loop::MiniEventLoop::init_global(Some(env), Some(cwd));
        let parts: [&[u8]; 2] = [cwd, b"[eval]"];
        let script_path = bun_paths::resolve_path::join::<bun_paths::platform::Auto>(&parts);

        // SAFETY: `init_global` returns the thread-local singleton raw pointer;
        // reborrow `&'static mut` for the duration of the interpreter run (no
        // other live `&mut` to the same `MiniEventLoop` on this thread).
        let mini_ref = unsafe { &mut *mini };
        let code = match Interpreter::init_and_run_from_source(
            ctx,
            mini_ref,
            script_path,
            &script,
            None,
        ) {
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

        // if (code > 0) {
        //     if (code != 2 and !silent) {
        //         Output.prettyErrorln("<r><red>error<r><d>:<r> script <b>\"{s}\"<r> exited with code {d}<r>", .{ name, code });
        //         Output.flush();
        //     }

        Global::exit(u32::from(code));
        // }
    }
}

// ported from: src/cli/exec_command.zig
