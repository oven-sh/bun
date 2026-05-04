//! 1 arg  => returns absolute path of the arg (not found becomes exit code 1)
//!
//! N args => returns absolute path of each separated by newline, if any path is not found, exit code becomes 1, but continues execution until all args are processed

use core::ffi::{c_char, CStr};
use core::mem::offset_of;

use bun_jsc::SystemError;
use bun_paths::path_buffer_pool;
use bun_core::which;
// TODO(port): verify crate path for `bun.which` (src/which.zig) — assuming bun_core::which

use crate::interpreter::EnvStr;
use crate::interpreter::Builtin;
use crate::Yield;

bun_output::declare_scope!(which, hidden);

#[derive(Default)]
pub struct Which {
    pub state: State,
}

pub enum State {
    Idle,
    OneArg,
    MultiArgs(MultiArgs),
    Done,
}

impl Default for State {
    fn default() -> Self {
        State::Idle
    }
}

pub struct MultiArgs {
    // TODO(port): lifetime — borrowed from parent Builtin's argsSlice(); using raw fat ptr to avoid struct lifetime in Phase A
    pub args_slice: *const [*const c_char],
    pub arg_idx: usize,
    pub had_not_found: bool,
    pub state: MultiArgsState,
}

pub enum MultiArgsState {
    None,
    WaitingWrite,
}

impl Which {
    pub fn start(&mut self) -> Yield {
        let args = self.bltn().args_slice();
        if args.is_empty() {
            if let Some(safeguard) = self.bltn().stdout.needs_io() {
                self.state = State::OneArg;
                return self.bltn().stdout.enqueue(self, b"\n", safeguard);
            }
            let _ = self.bltn().write_no_io(.stdout, b"\n");
            // TODO(port): `.stdout` is a Zig enum literal selecting the fd kind; map to Builtin::Fd::Stdout or similar in Phase B
            return self.bltn().done(1);
        }

        if self.bltn().stdout.needs_io().is_none() {
            let path_buf = path_buffer_pool().get();
            let path_env = self
                .bltn()
                .parent_cmd()
                .base
                .shell
                .export_env
                .get(EnvStr::init_slice(b"PATH"))
                .unwrap_or_else(|| EnvStr::init_slice(b""));
            // `defer PATH.deref()` — EnvStr Drop handles deref
            let mut had_not_found = false;
            for &arg_raw in args {
                // SAFETY: args from argsSlice() are NUL-terminated C strings
                let arg = unsafe { CStr::from_ptr(arg_raw) }.to_bytes();
                let resolved = match which(
                    &mut *path_buf,
                    path_env.slice(),
                    self.bltn().parent_cmd().base.shell.cwd_z(),
                    arg,
                ) {
                    Some(r) => r,
                    None => {
                        had_not_found = true;
                        let buf = self.bltn().fmt_error_arena(
                            Some(.which),
                            // TODO(port): `.which` is Builtin.Kind enum literal
                            format_args!("{} not found\n", bstr::BStr::new(arg)),
                        );
                        let _ = self.bltn().write_no_io(.stdout, buf);
                        continue;
                    }
                };

                let _ = self.bltn().write_no_io(.stdout, resolved);
            }
            return self.bltn().done(had_not_found as u8);
        }

        self.state = State::MultiArgs(MultiArgs {
            args_slice: args as *const _,
            arg_idx: 0,
            had_not_found: false,
            state: MultiArgsState::None,
        });
        self.next()
    }

    pub fn next(&mut self) -> Yield {
        // PORT NOTE: reshaped for borrowck — capture needed scalars before re-borrowing self via bltn()
        let State::MultiArgs(multiargs) = &mut self.state else {
            unreachable!()
        };
        // SAFETY: args_slice points into parent Builtin's args, which outlive this Which
        let args_slice = unsafe { &*multiargs.args_slice };
        if multiargs.arg_idx >= args_slice.len() {
            // Done
            let had_not_found = multiargs.had_not_found;
            return self.bltn().done(had_not_found as u8);
        }

        let arg_raw = args_slice[multiargs.arg_idx];
        // SAFETY: args from argsSlice() are NUL-terminated C strings
        let arg = unsafe { CStr::from_ptr(arg_raw) }.to_bytes();

        let path_buf = path_buffer_pool().get();
        let path_env = self
            .bltn()
            .parent_cmd()
            .base
            .shell
            .export_env
            .get(EnvStr::init_slice(b"PATH"))
            .unwrap_or_else(|| EnvStr::init_slice(b""));
        // `defer PATH.deref()` — EnvStr Drop handles deref

        let resolved = match which(
            &mut *path_buf,
            path_env.slice(),
            self.bltn().parent_cmd().base.shell.cwd_z(),
            arg,
        ) {
            Some(r) => r,
            None => {
                let State::MultiArgs(multiargs) = &mut self.state else {
                    unreachable!()
                };
                multiargs.had_not_found = true;
                if let Some(safeguard) = self.bltn().stdout.needs_io() {
                    let State::MultiArgs(multiargs) = &mut self.state else {
                        unreachable!()
                    };
                    multiargs.state = MultiArgsState::WaitingWrite;
                    return self.bltn().stdout.enqueue_fmt_bltn(
                        self,
                        None,
                        format_args!("{} not found\n", bstr::BStr::new(arg)),
                        safeguard,
                    );
                }

                let buf = self
                    .bltn()
                    .fmt_error_arena(None, format_args!("{} not found\n", bstr::BStr::new(arg)));
                let _ = self.bltn().write_no_io(.stdout, buf);
                return self.arg_complete();
            }
        };

        if let Some(safeguard) = self.bltn().stdout.needs_io() {
            let State::MultiArgs(multiargs) = &mut self.state else {
                unreachable!()
            };
            multiargs.state = MultiArgsState::WaitingWrite;
            return self.bltn().stdout.enqueue_fmt_bltn(
                self,
                None,
                format_args!("{}\n", bstr::BStr::new(resolved)),
                safeguard,
            );
        }

        let buf = self
            .bltn()
            .fmt_error_arena(None, format_args!("{}\n", bstr::BStr::new(resolved)));
        let _ = self.bltn().write_no_io(.stdout, buf);
        self.arg_complete()
    }

    fn arg_complete(&mut self) -> Yield {
        if cfg!(debug_assertions) {
            debug_assert!(matches!(
                &self.state,
                State::MultiArgs(m) if matches!(m.state, MultiArgsState::WaitingWrite)
            ));
        }

        let State::MultiArgs(multiargs) = &mut self.state else {
            unreachable!()
        };
        multiargs.arg_idx += 1;
        multiargs.state = MultiArgsState::None;
        self.next()
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, e: Option<SystemError>) -> Yield {
        if cfg!(debug_assertions) {
            debug_assert!(
                matches!(self.state, State::OneArg)
                    || matches!(
                        &self.state,
                        State::MultiArgs(m) if matches!(m.state, MultiArgsState::WaitingWrite)
                    )
            );
        }

        if let Some(err) = e {
            // `defer err.deref()` — SystemError Drop handles deref
            let errno = err.get_errno();
            return self.bltn().done(errno);
        }

        if matches!(self.state, State::OneArg) {
            // Calling which with on arguments returns exit code 1
            return self.bltn().done(1);
        }

        self.arg_complete()
    }

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: self points to the `which` field inside Builtin.Impl, which is the `impl` field inside Builtin
        unsafe {
            let impl_ptr = (self as *mut Which as *mut u8)
                .sub(offset_of!(Builtin::Impl, which))
                .cast::<Builtin::Impl>();
            // TODO(port): Builtin::Impl is a Zig union(enum); Rust enum layout differs — Phase B must rework @fieldParentPtr chain
            &mut *(impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, impl_))
                .cast::<Builtin>()
        }
    }
}

impl Drop for Which {
    fn drop(&mut self) {
        bun_output::scoped_log!(which, "({}) deinit", "which");
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/which.zig (156 lines)
//   confidence: medium
//   todos:      4
//   notes:      `.stdout`/`.which` enum literals and @fieldParentPtr chain over union(enum) need Phase B rework; args_slice stored as raw fat ptr (borrowed from parent)
// ──────────────────────────────────────────────────────────────────────────
