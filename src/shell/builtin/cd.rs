//! Some additional behaviour beyond basic `cd <dir>`:
//! - `cd` by itself or `cd ~` will always put the user in their home directory.
//! - `cd ~username` will put the user in the home directory of the specified user
//! - `cd -` will put the user in the previous directory

use core::fmt;
use core::mem::offset_of;

use bstr::BStr;

use bun_jsc::SystemError;
use bun_shell::interpreter::{Builtin, BuiltinImpl, BuiltinKind, StdioKind};
use bun_shell::Yield;
use bun_str::ZStr;
use bun_sys::{self as syscall, E};

bun_output::declare_scope!(Cd, hidden);

#[derive(Default)]
pub struct Cd {
    pub state: State,
}

pub enum State {
    Idle,
    WaitingWriteStderr,
    Done,
    Err(syscall::Error),
}

impl Default for State {
    fn default() -> Self {
        State::Idle
    }
}

impl Cd {
    fn write_stderr_non_blocking(&mut self, args: fmt::Arguments<'_>) -> Yield {
        self.state = State::WaitingWriteStderr;
        if let Some(safeguard) = self.bltn().stderr.needs_io() {
            return self
                .bltn()
                .stderr
                .enqueue_fmt_bltn(self, BuiltinKind::Cd, args, safeguard);
        }
        let buf = self.bltn().fmt_error_arena(BuiltinKind::Cd, args);
        let _ = self.bltn().write_no_io(StdioKind::Stderr, buf);
        self.state = State::Done;
        self.bltn().done(1)
    }

    pub fn start(&mut self) -> Yield {
        let args = self.bltn().args_slice();
        if args.len() > 1 {
            return self.write_stderr_non_blocking(format_args!("too many arguments\n"));
        }

        if args.len() == 1 {
            // SAFETY: args[0] is a NUL-terminated C string from argsSlice()
            let first_arg: &ZStr = unsafe { ZStr::from_ptr(args[0]) };
            match first_arg.as_bytes()[0] {
                b'-' => {
                    // PORT NOTE: reshaped for borrowck — Zig calls self.bltn() twice in one expr
                    let base = &mut self.bltn().parent_cmd().base;
                    match base.shell.change_prev_cwd(base.interpreter) {
                        Ok(()) => {}
                        Err(err) => {
                            let prev = self.bltn().parent_cmd().base.shell.prev_cwd_z();
                            return self.handle_change_cwd_err(err, prev.as_bytes());
                        }
                    }
                }
                b'~' => {
                    let homedir = self.bltn().parent_cmd().base.shell.get_homedir();
                    // `homedir.deref()` in Zig drops the refcount; Rust drops at scope exit.
                    let base = &mut self.bltn().parent_cmd().base;
                    match base.shell.change_cwd(base.interpreter, homedir.slice()) {
                        Ok(()) => {}
                        Err(err) => {
                            return self.handle_change_cwd_err(err, homedir.slice());
                        }
                    }
                }
                _ => {
                    let base = &mut self.bltn().parent_cmd().base;
                    match base.shell.change_cwd(base.interpreter, first_arg) {
                        Ok(()) => {}
                        Err(err) => {
                            return self.handle_change_cwd_err(err, first_arg.as_bytes());
                        }
                    }
                }
            }
        }

        self.bltn().done(0)
    }

    fn handle_change_cwd_err(&mut self, err: syscall::Error, new_cwd_: &[u8]) -> Yield {
        let errno: usize = usize::from(err.errno);

        match errno {
            e if e == E::NOTDIR as usize => {
                if self.bltn().stderr.needs_io().is_none() {
                    let buf = self.bltn().fmt_error_arena(
                        BuiltinKind::Cd,
                        format_args!("not a directory: {}\n", BStr::new(new_cwd_)),
                    );
                    let _ = self.bltn().write_no_io(StdioKind::Stderr, buf);
                    self.state = State::Done;
                    return self.bltn().done(1);
                }

                self.write_stderr_non_blocking(format_args!(
                    "not a directory: {}\n",
                    BStr::new(new_cwd_)
                ))
            }
            e if e == E::NOENT as usize => {
                if self.bltn().stderr.needs_io().is_none() {
                    let buf = self.bltn().fmt_error_arena(
                        BuiltinKind::Cd,
                        format_args!("not a directory: {}\n", BStr::new(new_cwd_)),
                    );
                    let _ = self.bltn().write_no_io(StdioKind::Stderr, buf);
                    self.state = State::Done;
                    return self.bltn().done(1);
                }

                self.write_stderr_non_blocking(format_args!(
                    "not a directory: {}\n",
                    BStr::new(new_cwd_)
                ))
            }
            e if e == E::NAMETOOLONG as usize => {
                if self.bltn().stderr.needs_io().is_none() {
                    let buf = self
                        .bltn()
                        .fmt_error_arena(BuiltinKind::Cd, format_args!("file name too long\n"));
                    let _ = self.bltn().write_no_io(StdioKind::Stderr, buf);
                    self.state = State::Done;
                    return self.bltn().done(1);
                }

                self.write_stderr_non_blocking(format_args!("file name too long\n"))
            }
            _ => {
                let errmsg = err.msg().unwrap_or_else(|| err.name());
                if self.bltn().stderr.needs_io().is_none() {
                    let buf = self.bltn().fmt_error_arena(
                        BuiltinKind::Cd,
                        format_args!("{}: {}\n", BStr::new(errmsg), BStr::new(new_cwd_)),
                    );
                    let _ = self.bltn().write_no_io(StdioKind::Stderr, buf);
                    self.state = State::Done;
                    return self.bltn().done(1);
                }

                self.write_stderr_non_blocking(format_args!(
                    "{}: {}\n",
                    BStr::new(errmsg),
                    BStr::new(new_cwd_)
                ))
            }
        }
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, e: Option<SystemError>) -> Yield {
        if cfg!(debug_assertions) {
            debug_assert!(matches!(self.state, State::WaitingWriteStderr));
        }

        if let Some(e) = e {
            // `defer e.?.deref()` — SystemError drops at scope exit in Rust.
            return self.bltn().done(e.get_errno());
        }

        self.state = State::Done;
        self.bltn().done(1)
    }

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: self is the `cd` field of Builtin::Impl, which is the `impl` field of Builtin.
        // TODO(port): field name `impl` is a Rust keyword; verify actual field name in Builtin.
        unsafe {
            let impl_ptr = (self as *mut Self as *mut u8)
                .sub(offset_of!(BuiltinImpl, cd))
                .cast::<BuiltinImpl>();
            &mut *(impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, impl_))
                .cast::<Builtin>()
        }
    }
}

impl Drop for Cd {
    fn drop(&mut self) {
        bun_output::scoped_log!(Cd, "({}) deinit", "cd");
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/cd.zig (153 lines)
//   confidence: medium
//   todos:      1
//   notes:      heavy borrowck reshaping needed around bltn()/parent_cmd() chains; BuiltinKind/StdioKind/BuiltinImpl import paths are guesses
// ──────────────────────────────────────────────────────────────────────────
