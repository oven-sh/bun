use bstr::BStr;

use bun_bundler::Transpiler;
use bun_core::{Global, Output};
use bun_options_types::schema::api;

use crate::shell::Interpreter;
use bun_sys;

use crate::command::Context;

pub(crate) struct ExecCommand;

/// Process-lifetime arena for the exec command's `Transpiler`; threads an
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
    pub(crate) fn exec(ctx: Context) -> Result<(), crate::Error> {
        // Clone the positional so `ctx` can be reborrowed `&mut` for
        // `init_and_run_from_source` below.
        let script: Box<[u8]> = ctx.positionals[1].clone();
        // this is a hack: make dummy bundler so we can use its `.runEnvLoader()` function to populate environment variables probably should split out the functionality
        let mut bundle = Transpiler::init(
            exec_arena(),
            ctx.log,
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
        let mut buf = bun_paths::path_buffer_pool::get();
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
        let env = unsafe { &mut *bundle.env };
        #[cfg(unix)]
        Self::exec_in_place(&script, env, cwd);
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

        Global::exit(u32::from(code));
    }

    /// A script that is one plain command runs in place of this process, as
    /// `sh -c <command>` does. The process a parent signals and waits for is
    /// then the program itself. Anything else (a second command, an
    /// assignment, a redirect, an expansion, a builtin) takes the
    /// interpreter, and so does a failed `execve`.
    #[cfg(unix)]
    fn exec_in_place(src: &[u8], env: &mut bun_dotenv::Loader, cwd: &[u8]) {
        use bun_shell_parser::ast::{Atom, Expr, SimpleAtom};

        let arena = bun_alloc::Arena::new();
        let mut out_parser = None;
        let mut out_lex_result = None;
        let Ok(script) = Interpreter::parse(
            &arena,
            src,
            &mut [],
            &[],
            &mut out_parser,
            &mut out_lex_result,
        ) else {
            return;
        };
        let [stmt] = script.stmts else { return };
        let [Expr::Cmd(cmd)] = stmt.exprs else { return };
        if !cmd.assigns.is_empty() || !cmd.redirect.is_empty() || cmd.redirect_file.is_some() {
            return;
        }
        fn push_text(word: &mut Vec<u8>, atom: &SimpleAtom<'_>) -> bool {
            match atom {
                SimpleAtom::Text(text) => word.extend_from_slice(text),
                SimpleAtom::QuotedEmpty => {}
                _ => return false,
            }
            true
        }
        let mut argv: Vec<Vec<u8>> = Vec::with_capacity(cmd.name_and_args.len());
        for atom in cmd.name_and_args {
            let mut word = Vec::new();
            let plain = match atom {
                Atom::Simple(atom) => push_text(&mut word, atom),
                Atom::Compound(compound) => {
                    compound.atoms.iter().all(|atom| push_text(&mut word, atom))
                }
            };
            if !plain {
                return;
            }
            argv.push(word);
        }
        let Some(name) = argv.first() else { return };
        if crate::shell::builtin::Kind::from_argv0(name).is_some() {
            return;
        }
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let Some(resolved) =
            bun_which::which(&mut path_buf, env.get(b"PATH").unwrap_or(b""), cwd, name)
        else {
            return;
        };
        let Ok(envp) = env.map.create_null_delimited_env_map() else {
            return;
        };
        let args_z: Vec<Box<[u8]>> = argv
            .into_iter()
            .map(|mut word| {
                word.push(0);
                word.into_boxed_slice()
            })
            .collect();
        let mut argv_ptrs: Vec<*const ::core::ffi::c_char> =
            args_z.iter().map(|arg| arg.as_ptr().cast()).collect();
        argv_ptrs.push(core::ptr::null());
        // SAFETY: `resolved`, every `args_z` element and the `envp` strings are
        // NUL-terminated and outlive the call. The pointer arrays end in null.
        // `execve` returns only on failure.
        unsafe {
            libc::execve(
                resolved.as_ptr(),
                argv_ptrs.as_ptr(),
                envp.as_slice().as_ptr(),
            )
        };
    }
}
