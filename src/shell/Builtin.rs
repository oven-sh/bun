//! Some common commands (e.g. `ls`, `which`, `mv`, essentially coreutils) we make "built-in"
//! to the shell and implement natively in Zig/Rust. We do this for a couple reasons:
//!
//! 1. We can re-use a lot of our existing code in Bun and often times it's
//!    faster (for example `cp` and `mv` can be implemented using our Node FS
//!    logic)
//!
//! 2. Builtins run in the Bun process, so we can save a lot of time not having to
//!    spawn a new subprocess. A lot of the times, just spawning the shell can take
//!    longer than actually running the command. This is especially noticeable and
//!    important to consider for Windows.

use core::ffi::c_char;
use core::fmt::Arguments;
use core::mem::offset_of;
use std::sync::Arc;

use bun_alloc::ArenaAllocator;
use bun_collections::ByteList;
use bun_str::ZStr;
use bun_sys::{self as sys, Fd};

use crate::ast;
use crate::interpret::{
    self, Cmd, EnvMap, ExitCode, IOReader, IOWriter, Interpreter, OutputNeedsIOSafeGuard,
    ShellSyscall, IO,
};
use crate::{AllocScope, ShellErr, Yield};

// TODO(port): `log` in Zig is `shell.interpret.log` (Output.scoped). Forward to the same scope.
macro_rules! log {
    ($($arg:tt)*) => {
        bun_output::scoped_log!(SHELL, $($arg)*)
    };
}

pub struct Builtin<'a> {
    pub kind: Kind,
    pub stdin: BuiltinIO::Input,
    pub stdout: BuiltinIO::Output<'a>,
    pub stderr: BuiltinIO::Output<'a>,
    pub exit_code: Option<ExitCode>,

    pub export_env: &'a mut EnvMap,
    pub cmd_local_env: &'a mut EnvMap,

    pub arena: &'a mut ArenaAllocator,
    pub cwd: Fd,

    /// TODO: It would be nice to make this mutable so that certain commands (e.g.
    /// `export`) don't have to duplicate arguments. However, it is tricky because
    /// modifications will invalidate any codepath which previously sliced the array
    /// list (e.g. turned it into a `&[&ZStr]`)
    pub args: &'a Vec<Option<*const c_char>>,
    /// Cached slice of `args`.
    ///
    /// This caches the result of calling `bun.span(this.args.items[i])` since the
    /// items in `this.args` are sentinel terminated and don't carry their length.
    // TODO(port): lifetime — boxed cache of spanned arg ZStrs; revisit ownership in Phase B
    pub args_slice: Option<Box<[ZStr<'a>]>>,

    pub r#impl: Impl,
}

pub enum Impl {
    Cat(Cat),
    Touch(Touch),
    Mkdir(Mkdir),
    Export(Export),
    Cd(Cd),
    Echo(Echo),
    Pwd(Pwd),
    Which(Which),
    Rm(Rm),
    Mv(Mv),
    Ls(Ls),
    Exit(Exit),
    True(True),
    False(False),
    Yes(Yes),
    Seq(Seq),
    Dirname(Dirname),
    Basename(Basename),
    Cp(Cp),
}

pub use bun_core::result::Result;

// Note: this enum uses @tagName, choose wisely!
#[derive(Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
#[strum(serialize_all = "lowercase")]
pub enum Kind {
    Cat,
    Touch,
    Mkdir,
    #[strum(serialize = "export")]
    Export,
    Cd,
    Echo,
    Pwd,
    Which,
    Rm,
    Mv,
    Ls,
    Exit,
    #[strum(serialize = "true")]
    True,
    #[strum(serialize = "false")]
    False,
    Yes,
    Seq,
    Dirname,
    Basename,
    Cp,
}

impl Kind {
    pub const DISABLED_ON_POSIX: &'static [Kind] = &[Kind::Cat, Kind::Cp];

    // TODO(port): Zig `parentType` returned a `type` and was unused; no Rust equivalent.
    // pub fn parent_type(self) -> ! { ... }

    pub fn usage_string(self) -> &'static [u8] {
        match self {
            Kind::Cat => b"usage: cat [-belnstuv] [file ...]\n",
            Kind::Touch => b"usage: touch [-A [-][[hh]mm]SS] [-achm] [-r file] [-t [[CC]YY]MMDDhhmm[.SS]]\n       [-d YYYY-MM-DDThh:mm:SS[.frac][tz]] file ...\n",
            Kind::Mkdir => b"usage: mkdir [-pv] [-m mode] directory_name ...\n",
            Kind::Export => b"",
            Kind::Cd => b"",
            Kind::Echo => b"",
            Kind::Pwd => b"",
            Kind::Which => b"",
            Kind::Rm => b"usage: rm [-f | -i] [-dIPRrvWx] file ...\n       unlink [--] file\n",
            Kind::Mv => b"usage: mv [-f | -i | -n] [-hv] source target\n       mv [-f | -i | -n] [-v] source ... directory\n",
            Kind::Ls => b"usage: ls [-@ABCFGHILOPRSTUWabcdefghiklmnopqrstuvwxy1%,] [--color=when] [-D format] [file ...]\n",
            Kind::Exit => b"usage: exit [n]\n",
            Kind::True => b"",
            Kind::False => b"",
            Kind::Yes => b"usage: yes [expletive]\n",
            Kind::Seq => b"usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n",
            Kind::Dirname => b"usage: dirname string\n",
            Kind::Basename => b"usage: basename string\n",
            Kind::Cp => b"usage: cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file target_file\n       cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file ... target_directory\n",
        }
    }

    fn force_enable_on_posix() -> bool {
        bun_core::feature_flag::BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS.get()
    }

    pub fn from_str(str: &[u8]) -> Option<Kind> {
        let result: Kind = match str {
            b"cat" => Kind::Cat,
            b"touch" => Kind::Touch,
            b"mkdir" => Kind::Mkdir,
            b"export" => Kind::Export,
            b"cd" => Kind::Cd,
            b"echo" => Kind::Echo,
            b"pwd" => Kind::Pwd,
            b"which" => Kind::Which,
            b"rm" => Kind::Rm,
            b"mv" => Kind::Mv,
            b"ls" => Kind::Ls,
            b"exit" => Kind::Exit,
            b"true" => Kind::True,
            b"false" => Kind::False,
            b"yes" => Kind::Yes,
            b"seq" => Kind::Seq,
            b"dirname" => Kind::Dirname,
            b"basename" => Kind::Basename,
            b"cp" => Kind::Cp,
            _ => return None,
        };
        #[cfg(windows)]
        {
            return Some(result);
        }
        #[cfg(not(windows))]
        {
            if Self::force_enable_on_posix() {
                return Some(result);
            }
            for &disabled in Kind::DISABLED_ON_POSIX {
                if disabled == result {
                    log!(
                        "{} builtin disabled on posix for now",
                        bstr::BStr::new(<&'static str>::from(disabled))
                    );
                    return None;
                }
            }
            Some(result)
        }
    }
}

#[allow(non_snake_case)]
pub mod BuiltinIO {
    use super::*;

    /// in the case of array buffer we simply need to write to the pointer
    /// in the case of blob, we write to the file descriptor
    pub enum Output<'a> {
        Fd {
            writer: Arc<IOWriter>,
            captured: Option<&'a mut ByteList>,
        },
        Buf(Vec<u8>),
        Arraybuf(ArrayBuf),
        Blob(Arc<Blob>),
        Ignore,
    }

    // TODO(port): `FdOutput` is a dead duplicate of the anon `.fd` struct above; never instantiated.
    pub struct FdOutput<'a> {
        pub writer: Arc<IOWriter>,
        pub captured: Option<&'a mut ByteList>,
        // pub fn
    }

    impl<'a> Output<'a> {
        // TODO(port): Zig `ref()` bumps the intrusive refcount and returns `*Output` so the
        // caller can bitwise-copy the union (`.ref().*`). With `Arc` fields the natural
        // Rust mapping is `Clone`; kept as an explicit method for diff fidelity.
        pub fn r#ref(&mut self) -> &mut Self {
            match self {
                Output::Fd { writer, .. } => {
                    core::mem::forget(Arc::clone(writer));
                }
                Output::Blob(blob) => {
                    core::mem::forget(Arc::clone(blob));
                }
                _ => {}
            }
            self
        }

        // TODO(port): in Phase B this becomes `impl Drop for Output`; callers that do
        // `x.deref(); x = new;` collapse to `x = new;`.
        pub fn deref(&mut self) {
            match self {
                Output::Fd { writer, .. } => {
                    // SAFETY: paired with the leaked clone in `ref()` / `dupeRef()`.
                    unsafe { Arc::decrement_strong_count(Arc::as_ptr(writer)) };
                }
                Output::Blob(blob) => {
                    // SAFETY: paired with the leaked clone in `ref()` / `dupe_ref()`.
                    unsafe { Arc::decrement_strong_count(Arc::as_ptr(blob)) };
                }
                Output::Arraybuf(arraybuf) => arraybuf.buf.deinit(),
                Output::Buf(buf) => {
                    *buf = Vec::new();
                }
                Output::Ignore => {}
            }
        }

        pub fn needs_io(&self) -> Option<OutputNeedsIOSafeGuard> {
            match self {
                Output::Fd { .. } => Some(OutputNeedsIOSafeGuard::OutputNeedsIo),
                _ => None,
            }
        }

        /// You must check that `.needs_io() == Some(_)` before calling this!
        /// e.g.
        ///
        /// ```ignore
        /// if let Some(safeguard) = this.stderr.needs_io() {
        ///     this.bltn.stderr.enqueue_fmt_bltn(this, Kind::Cd, fmt, args, safeguard);
        /// }
        /// ```
        pub fn enqueue_fmt_bltn<P>(
            &mut self,
            ptr: P,
            // PERF(port): was `comptime kind: ?Kind` — Option<Kind> can't be a const generic.
            kind: Option<Kind>,
            args: Arguments<'_>,
            _: OutputNeedsIOSafeGuard,
        ) -> Yield {
            let Output::Fd { writer, captured } = self else {
                unreachable!()
            };
            writer.enqueue_fmt_bltn(ptr, captured.as_deref_mut(), kind, args)
        }

        pub fn enqueue<P>(&mut self, ptr: P, buf: &[u8], _: OutputNeedsIOSafeGuard) -> Yield {
            let Output::Fd { writer, captured } = self else {
                unreachable!()
            };
            writer.enqueue(ptr, captured.as_deref_mut(), buf)
        }

        pub fn enqueue_fmt<P>(
            &mut self,
            ptr: P,
            args: Arguments<'_>,
            _: OutputNeedsIOSafeGuard,
        ) -> Yield {
            let Output::Fd { writer, captured } = self else {
                unreachable!()
            };
            writer.enqueue_fmt(ptr, captured.as_deref_mut(), args)
        }
    }

    pub enum Input {
        Fd(Arc<IOReader>),
        /// array list not owned by this type
        Buf(Vec<u8>),
        Arraybuf(ArrayBuf),
        Blob(Arc<Blob>),
        Ignore,
    }

    impl Input {
        // TODO(port): see note on `Output::ref` — map to `Clone` in Phase B.
        pub fn r#ref(&mut self) -> &mut Self {
            match self {
                Input::Fd(fd) => {
                    core::mem::forget(Arc::clone(fd));
                }
                Input::Blob(blob) => {
                    core::mem::forget(Arc::clone(blob));
                }
                _ => {}
            }
            self
        }

        // TODO(port): becomes `impl Drop for Input` in Phase B.
        pub fn deref(&mut self) {
            match self {
                Input::Fd(fd) => {
                    // SAFETY: paired with the leaked clone in `ref()` / `dupe_ref()`.
                    unsafe { Arc::decrement_strong_count(Arc::as_ptr(fd)) };
                }
                Input::Blob(blob) => {
                    // SAFETY: paired with the leaked clone in `ref()` / `dupe_ref()`.
                    unsafe { Arc::decrement_strong_count(Arc::as_ptr(blob)) };
                }
                Input::Buf(buf) => {
                    *buf = Vec::new();
                }
                Input::Arraybuf(arraybuf) => arraybuf.buf.deinit(),
                Input::Ignore => {}
            }
        }

        pub fn needs_io(&self) -> bool {
            matches!(self, Input::Fd(_))
        }
    }

    pub struct ArrayBuf {
        // TODO(port): `jsc.ArrayBuffer.Strong` — confirm path in bun_jsc.
        pub buf: bun_jsc::array_buffer::Strong,
        pub i: u32,
    }

    impl Default for ArrayBuf {
        fn default() -> Self {
            Self {
                buf: Default::default(),
                i: 0,
            }
        }
    }

    pub struct Blob {
        // TODO(port): LIFETIMES.tsv classifies `*Blob` fields as `Arc<Blob>`, but Zig used
        // single-thread intrusive `bun.ptr.RefCount` (→ `bun_ptr::IntrusiveRc<Blob>`). Phase B
        // should pick one; intrusive ref_count field kept for layout fidelity.
        pub ref_count: core::cell::Cell<u32>,
        pub blob: bun_runtime::webcore::Blob,
    }

    impl Blob {
        pub fn dupe_ref(self: &Arc<Self>) -> Arc<Self> {
            Arc::clone(self)
        }
    }
}

impl<'a> Builtin<'a> {
    pub fn args_slice(&self) -> &[*const c_char] {
        let args_raw = &self.args[1..];
        let args_len = args_raw
            .iter()
            .position(|p| p.is_none())
            .unwrap_or_else(|| panic!("bad"));
        if args_len == 0 {
            return &[];
        }

        // SAFETY: `Option<*const c_char>` has the same layout as `*const c_char` (null-ptr niche),
        // and we've proven the first `args_len` elements are `Some`.
        let args_ptr = args_raw.as_ptr() as *const *const c_char;
        unsafe { core::slice::from_raw_parts(args_ptr, args_len) }
    }

    // TODO(port): `callImpl` / `callImplWithType` used `@field` reflection to dispatch a
    // method-by-name across every `Impl` variant. There is no Rust equivalent. The two
    // call sites in this file (`start`, `deinit`) are expanded below as explicit `match`es.
    // Phase B: introduce a `trait BuiltinCommand { fn start(&mut self) -> Yield; fn deinit(&mut self); }`
    // implemented by each builtin and dispatch via that.
    #[inline]
    fn call_impl_start(&mut self) -> Yield {
        match &mut self.r#impl {
            Impl::Cat(x) => x.start(),
            Impl::Touch(x) => x.start(),
            Impl::Mkdir(x) => x.start(),
            Impl::Export(x) => x.start(),
            Impl::Echo(x) => x.start(),
            Impl::Cd(x) => x.start(),
            Impl::Which(x) => x.start(),
            Impl::Rm(x) => x.start(),
            Impl::Pwd(x) => x.start(),
            Impl::Mv(x) => x.start(),
            Impl::Ls(x) => x.start(),
            Impl::Exit(x) => x.start(),
            Impl::True(x) => x.start(),
            Impl::False(x) => x.start(),
            Impl::Yes(x) => x.start(),
            Impl::Seq(x) => x.start(),
            Impl::Dirname(x) => x.start(),
            Impl::Basename(x) => x.start(),
            Impl::Cp(x) => x.start(),
        }
    }

    #[inline]
    fn call_impl_deinit(&mut self) {
        match &mut self.r#impl {
            Impl::Cat(x) => x.deinit(),
            Impl::Touch(x) => x.deinit(),
            Impl::Mkdir(x) => x.deinit(),
            Impl::Export(x) => x.deinit(),
            Impl::Echo(x) => x.deinit(),
            Impl::Cd(x) => x.deinit(),
            Impl::Which(x) => x.deinit(),
            Impl::Rm(x) => x.deinit(),
            Impl::Pwd(x) => x.deinit(),
            Impl::Mv(x) => x.deinit(),
            Impl::Ls(x) => x.deinit(),
            Impl::Exit(x) => x.deinit(),
            Impl::True(x) => x.deinit(),
            Impl::False(x) => x.deinit(),
            Impl::Yes(x) => x.deinit(),
            Impl::Seq(x) => x.deinit(),
            Impl::Dirname(x) => x.deinit(),
            Impl::Basename(x) => x.deinit(),
            Impl::Cp(x) => x.deinit(),
        }
    }

    // TODO(port): callers used bun.default_allocator — now implicit (mimalloc global).
    // pub fn allocator(&self) -> &dyn bun_alloc::Allocator { ... }

    pub fn init(
        cmd: &'a mut Cmd,
        interpreter: &mut Interpreter,
        kind: Kind,
        arena: &'a mut ArenaAllocator,
        node: &ast::Cmd,
        args: &'a Vec<Option<*const c_char>>,
        export_env: &'a mut EnvMap,
        cmd_local_env: &'a mut EnvMap,
        cwd: Fd,
        io: &mut IO,
    ) -> Option<Yield> {
        let stdin: BuiltinIO::Input = match &io.stdin {
            interpret::Stdin::Fd(fd) => BuiltinIO::Input::Fd(fd.dupe_ref()),
            interpret::Stdin::Ignore => BuiltinIO::Input::Ignore,
        };
        let stdout: BuiltinIO::Output = match &io.stdout {
            interpret::Stdout::Fd(val) => BuiltinIO::Output::Fd {
                writer: val.writer.dupe_ref(),
                captured: val.captured,
            },
            interpret::Stdout::Pipe => BuiltinIO::Output::Buf(Vec::new()),
            interpret::Stdout::Ignore => BuiltinIO::Output::Ignore,
        };
        let stderr: BuiltinIO::Output = match &io.stderr {
            interpret::Stdout::Fd(val) => BuiltinIO::Output::Fd {
                writer: val.writer.dupe_ref(),
                captured: val.captured,
            },
            interpret::Stdout::Pipe => BuiltinIO::Output::Buf(Vec::new()),
            interpret::Stdout::Ignore => BuiltinIO::Output::Ignore,
        };

        let r#impl: Impl = match kind {
            Kind::Rm => Impl::Rm(Rm {
                opts: Default::default(),
            }),
            Kind::Echo => Impl::Echo(Echo {
                // PERF(port): was arena-backed ArrayList; using Vec here.
                output: Vec::new(),
            }),
            Kind::Ls => Impl::Ls(Ls {
                alloc_scope: AllocScope::begin_scope(),
            }),
            Kind::Yes => Impl::Yes(Yes {
                alloc_scope: AllocScope::begin_scope(),
            }),
            Kind::Cat => Impl::Cat(Cat::default()),
            Kind::Touch => Impl::Touch(Touch::default()),
            Kind::Mkdir => Impl::Mkdir(Mkdir::default()),
            Kind::Export => Impl::Export(Export::default()),
            Kind::Cd => Impl::Cd(Cd::default()),
            Kind::Pwd => Impl::Pwd(Pwd::default()),
            Kind::Which => Impl::Which(Which::default()),
            Kind::Mv => Impl::Mv(Mv::default()),
            Kind::Exit => Impl::Exit(Exit::default()),
            Kind::True => Impl::True(True::default()),
            Kind::False => Impl::False(False::default()),
            Kind::Seq => Impl::Seq(Seq::default()),
            Kind::Dirname => Impl::Dirname(Dirname::default()),
            Kind::Basename => Impl::Basename(Basename::default()),
            Kind::Cp => Impl::Cp(Cp::default()),
        };

        // TODO(port): in-place init — Builtin is embedded in `Cmd.Exec` union; Phase B may
        // need `&mut MaybeUninit<Self>` if borrowck rejects the &'a mut self-reference here.
        cmd.exec = Cmd::Exec::Bltn(Builtin {
            kind,
            stdin,
            stdout,
            stderr,
            exit_code: None,
            arena,
            args,
            args_slice: None,
            export_env,
            cmd_local_env,
            cwd,
            r#impl,
        });

        Self::init_redirections(cmd, kind, node, interpreter)
    }

    fn init_redirections(
        cmd: &mut Cmd,
        kind: Kind,
        node: &ast::Cmd,
        interpreter: &mut Interpreter,
    ) -> Option<Yield> {
        if let Some(file) = &node.redirect_file {
            match file {
                ast::RedirectFile::Atom(_) => {
                    if cmd.redirection_file.is_empty() {
                        return Some(cmd.write_failing_error(format_args!(
                            "bun: ambiguous redirect: at `{}`\n",
                            <&'static str>::from(kind)
                        )));
                    }

                    // Regular files are not pollable on linux and macos
                    #[cfg(unix)]
                    let is_pollable: bool = false;
                    #[cfg(not(unix))]
                    let is_pollable: bool = true;

                    let path_len = cmd.redirection_file.len().saturating_sub(1);
                    // SAFETY: redirection_file is NUL-terminated by the expander; path_len excludes the NUL.
                    let path =
                        unsafe { ZStr::from_raw(cmd.redirection_file.as_ptr(), path_len) };
                    log!(
                        "EXPANDED REDIRECT: {}\n",
                        bstr::BStr::new(&cmd.redirection_file[..])
                    );
                    let perm = 0o666;

                    let mut pollable = false;
                    let mut is_socket = false;
                    let mut is_nonblocking = false;

                    let redirfd: Fd = 'redirfd: {
                        if node.redirect.stdin {
                            match ShellSyscall::openat(
                                cmd.base.shell.cwd_fd,
                                &path,
                                node.redirect.to_flags(),
                                perm,
                            ) {
                                sys::Result::Err(e) => {
                                    let sys_err = e.to_shell_system_error();
                                    let r = cmd.write_failing_error(format_args!(
                                        "bun: {}: {}",
                                        sys_err.message,
                                        bstr::BStr::new(path.as_bytes())
                                    ));
                                    drop(sys_err);
                                    return Some(r);
                                }
                                sys::Result::Ok(f) => break 'redirfd f,
                            }
                        }

                        // TODO(port): `bun.io.openForWritingImpl` takes a no-op
                        // `onForceSyncOrIsaTTY` callback and `isPollableFromMode` predicate.
                        let result = bun_io::open_for_writing_impl(
                            cmd.base.shell.cwd_fd,
                            &path,
                            node.redirect.to_flags(),
                            perm,
                            &mut pollable,
                            &mut is_socket,
                            false,
                            &mut is_nonblocking,
                            (),
                            |_: ()| {}, // onForceSyncOrIsaTTY
                            interpret::is_pollable_from_mode,
                            ShellSyscall::openat,
                        );

                        match result {
                            sys::Result::Err(e) => {
                                let sys_err = e.to_shell_system_error();
                                let r = cmd.write_failing_error(format_args!(
                                    "bun: {}: {}",
                                    sys_err.message,
                                    bstr::BStr::new(path.as_bytes())
                                ));
                                drop(sys_err);
                                return Some(r);
                            }
                            sys::Result::Ok(f) => {
                                #[cfg(windows)]
                                {
                                    match f.make_libuv_owned_for_syscall(
                                        sys::Tag::Open,
                                        sys::CloseOnFail,
                                    ) {
                                        sys::Result::Err(e) => {
                                            let sys_err = e.to_shell_system_error();
                                            let r = cmd.write_failing_error(format_args!(
                                                "bun: {}: {}",
                                                sys_err.message,
                                                bstr::BStr::new(path.as_bytes())
                                            ));
                                            drop(sys_err);
                                            return Some(r);
                                        }
                                        sys::Result::Ok(f2) => break 'redirfd f2,
                                    }
                                }
                                #[cfg(not(windows))]
                                {
                                    break 'redirfd f;
                                }
                            }
                        }
                    };

                    if node.redirect.stdin {
                        cmd.exec.bltn_mut().stdin.deref();
                        cmd.exec.bltn_mut().stdin =
                            BuiltinIO::Input::Fd(IOReader::init(redirfd, cmd.base.event_loop()));
                    }

                    if !node.redirect.stdout && !node.redirect.stderr {
                        return None;
                    }

                    let redirect_writer: Arc<IOWriter> = IOWriter::init(
                        redirfd,
                        interpret::IOWriterOpts {
                            pollable: is_pollable,
                            nonblocking: is_nonblocking,
                            is_socket,
                        },
                        cmd.base.event_loop(),
                    );
                    // `defer redirect_writer.deref()` — Arc drops at scope end.

                    if node.redirect.stdout {
                        cmd.exec.bltn_mut().stdout.deref();
                        cmd.exec.bltn_mut().stdout = BuiltinIO::Output::Fd {
                            writer: Arc::clone(&redirect_writer),
                            captured: None,
                        };
                    }

                    if node.redirect.stderr {
                        cmd.exec.bltn_mut().stderr.deref();
                        cmd.exec.bltn_mut().stderr = BuiltinIO::Output::Fd {
                            writer: Arc::clone(&redirect_writer),
                            captured: None,
                        };
                    }
                }
                ast::RedirectFile::Jsbuf(val) => {
                    let global_object = interpreter.event_loop.js.global;

                    if val.idx as usize >= interpreter.jsobjs.len() {
                        let _ = global_object
                            .throw(format_args!("Invalid JS object reference in shell"));
                        return Some(Yield::Failed);
                    }

                    if let Some(buf) =
                        interpreter.jsobjs[val.idx as usize].as_array_buffer(global_object)
                    {
                        // Each slot gets its own Strong; sharing one across stdin/stdout/stderr
                        // would double-free the heap *Impl in Builtin.deinit().
                        if node.redirect.stdin {
                            cmd.exec.bltn_mut().stdin.deref();
                            cmd.exec.bltn_mut().stdin =
                                BuiltinIO::Input::Arraybuf(BuiltinIO::ArrayBuf {
                                    buf: bun_jsc::array_buffer::Strong {
                                        array_buffer: buf,
                                        held: bun_jsc::Strong::create(buf.value, global_object),
                                    },
                                    i: 0,
                                });
                        }

                        if node.redirect.stdout {
                            cmd.exec.bltn_mut().stdout.deref();
                            cmd.exec.bltn_mut().stdout =
                                BuiltinIO::Output::Arraybuf(BuiltinIO::ArrayBuf {
                                    buf: bun_jsc::array_buffer::Strong {
                                        array_buffer: buf,
                                        held: bun_jsc::Strong::create(buf.value, global_object),
                                    },
                                    i: 0,
                                });
                        }

                        if node.redirect.stderr {
                            cmd.exec.bltn_mut().stderr.deref();
                            cmd.exec.bltn_mut().stderr =
                                BuiltinIO::Output::Arraybuf(BuiltinIO::ArrayBuf {
                                    buf: bun_jsc::array_buffer::Strong {
                                        array_buffer: buf,
                                        held: bun_jsc::Strong::create(buf.value, global_object),
                                    },
                                    i: 0,
                                });
                        }
                    } else if let Some(body) = interpreter.jsobjs[val.idx as usize]
                        .as_::<bun_runtime::webcore::body::Value>()
                    {
                        if (node.redirect.stdout || node.redirect.stderr)
                            && !(matches!(body, bun_runtime::webcore::body::Value::Blob(b) if !b.needs_to_read_file()))
                        {
                            // TODO: Locked->stream -> file -> blob conversion via .toBlobIfPossible() except we want to avoid modifying the Response/Request if unnecessary.
                            let _ = cmd.base.interpreter.event_loop.js.global.throw(format_args!(
                                "Cannot redirect stdout/stderr to an immutable blob. Expected a file"
                            ));
                            return Some(Yield::Failed);
                        }

                        let original_blob = body.r#use();
                        // `defer original_blob.deinit()` — Drop handles it.

                        if !node.redirect.stdin && !node.redirect.stdout && !node.redirect.stderr {
                            return None;
                        }

                        let blob: Arc<BuiltinIO::Blob> = Arc::new(BuiltinIO::Blob {
                            ref_count: core::cell::Cell::new(1),
                            blob: original_blob.dupe(),
                        });
                        // `defer blob.deref()` — Arc drops at scope end.

                        if node.redirect.stdin {
                            cmd.exec.bltn_mut().stdin.deref();
                            cmd.exec.bltn_mut().stdin = BuiltinIO::Input::Blob(blob.dupe_ref());
                        }

                        if node.redirect.stdout {
                            cmd.exec.bltn_mut().stdout.deref();
                            cmd.exec.bltn_mut().stdout = BuiltinIO::Output::Blob(blob.dupe_ref());
                        }

                        if node.redirect.stderr {
                            cmd.exec.bltn_mut().stderr.deref();
                            cmd.exec.bltn_mut().stderr = BuiltinIO::Output::Blob(blob.dupe_ref());
                        }
                    } else if let Some(blob) = interpreter.jsobjs[val.idx as usize]
                        .as_::<bun_runtime::webcore::Blob>()
                    {
                        if (node.redirect.stdout || node.redirect.stderr)
                            && !blob.needs_to_read_file()
                        {
                            // TODO: Locked->stream -> file -> blob conversion via .toBlobIfPossible() except we want to avoid modifying the Response/Request if unnecessary.
                            let _ = cmd.base.interpreter.event_loop.js.global.throw(format_args!(
                                "Cannot redirect stdout/stderr to an immutable blob. Expected a file"
                            ));
                            return Some(Yield::Failed);
                        }

                        let theblob: Arc<BuiltinIO::Blob> = Arc::new(BuiltinIO::Blob {
                            ref_count: core::cell::Cell::new(1),
                            blob: blob.dupe(),
                        });

                        if node.redirect.stdin {
                            cmd.exec.bltn_mut().stdin.deref();
                            cmd.exec.bltn_mut().stdin = BuiltinIO::Input::Blob(theblob);
                        } else if node.redirect.stdout {
                            cmd.exec.bltn_mut().stdout.deref();
                            cmd.exec.bltn_mut().stdout = BuiltinIO::Output::Blob(theblob);
                        } else if node.redirect.stderr {
                            cmd.exec.bltn_mut().stderr.deref();
                            cmd.exec.bltn_mut().stderr = BuiltinIO::Output::Blob(theblob);
                        }
                    } else {
                        let jsval = cmd.base.interpreter.jsobjs[val.idx as usize];
                        let _ = cmd.base.interpreter.event_loop.js.global.throw(format_args!(
                            "Unknown JS value used in shell: {}",
                            jsval.fmt_string(global_object)
                        ));
                        return Some(Yield::Failed);
                    }
                }
            }
        } else if node.redirect.duplicate_out {
            if node.redirect.stdout {
                // PORT NOTE: reshaped for borrowck — Zig did `stderr = stdout.ref().*`.
                // TODO(port): replace ref()/bitwise-copy with `Clone` on Output in Phase B.
                cmd.exec.bltn_mut().stderr.deref();
                cmd.exec.bltn_mut().stdout.r#ref();
                // SAFETY: bitwise duplicate of the union variant; the extra strong-count was added
                // by `r#ref()` immediately above, so dropping both copies is balanced.
                let dup = unsafe {
                    core::ptr::read(&cmd.exec.bltn_mut().stdout as *const BuiltinIO::Output)
                };
                cmd.exec.bltn_mut().stderr = dup;
            }

            if node.redirect.stderr {
                cmd.exec.bltn_mut().stdout.deref();
                cmd.exec.bltn_mut().stderr.r#ref();
                // SAFETY: bitwise duplicate of the union variant; the extra strong-count was added
                // by `r#ref()` immediately above, so dropping both copies is balanced.
                let dup = unsafe {
                    core::ptr::read(&cmd.exec.bltn_mut().stderr as *const BuiltinIO::Output)
                };
                cmd.exec.bltn_mut().stdout = dup;
            }
        }

        None
    }

    #[inline]
    pub fn event_loop(&self) -> bun_jsc::EventLoopHandle {
        self.parent_cmd().base.event_loop()
    }

    #[inline]
    pub fn throw(&self, err: &ShellErr) {
        let _ = self.parent_cmd().base.throw(err);
    }

    /// The `Cmd` state node associated with this builtin
    #[inline]
    pub fn parent_cmd(&self) -> &Cmd {
        // SAFETY: `self` is the `bltn` field of a `Cmd::Exec` union which is the `exec` field of `Cmd`.
        unsafe {
            let union_ptr = (self as *const Self as *const u8)
                .sub(offset_of!(Cmd::Exec, bltn))
                .cast::<Cmd::Exec>();
            &*(union_ptr as *const u8)
                .sub(offset_of!(Cmd, exec))
                .cast::<Cmd>()
        }
    }

    #[inline]
    pub fn parent_cmd_mut(&mut self) -> &mut Cmd {
        // SAFETY: `self` is the `bltn` field of a `Cmd::Exec` union which is the `exec` field of `Cmd`.
        unsafe {
            let union_ptr = (self as *mut Self as *mut u8)
                .sub(offset_of!(Cmd::Exec, bltn))
                .cast::<Cmd::Exec>();
            &mut *(union_ptr as *mut u8)
                .sub(offset_of!(Cmd, exec))
                .cast::<Cmd>()
        }
    }

    pub fn done(&mut self, exit_code: impl Into<ExitCode>) -> Yield {
        // TODO(port): Zig accepted `bun.sys.E | u1 | u8 | u16 | comptime_int`; ensure
        // `From<sys::E>`/`From<u8>`/`From<u16>` for `ExitCode` exist in interpret.
        let code: ExitCode = exit_code.into();
        self.exit_code = Some(code);

        let cmd = self.parent_cmd_mut();
        log!(
            "builtin done ({}: exit={}) cmd to free: ({:x})",
            <&'static str>::from(self.kind),
            code,
            cmd as *mut Cmd as usize
        );
        cmd.exit_code = self.exit_code.unwrap();

        // Aggregate output data if shell state is piped and this cmd is piped
        if matches!(cmd.io.stdout, interpret::Stdout::Pipe)
            && matches!(cmd.io.stdout, interpret::Stdout::Pipe)
        {
            if let BuiltinIO::Output::Buf(buf) = &self.stdout {
                cmd.base
                    .shell
                    .buffered_stdout()
                    .extend_from_slice(&buf[..]);
            }
        }
        // Aggregate output data if shell state is piped and this cmd is piped
        if matches!(cmd.io.stderr, interpret::Stdout::Pipe)
            && matches!(cmd.io.stderr, interpret::Stdout::Pipe)
        {
            if let BuiltinIO::Output::Buf(buf) = &self.stderr {
                cmd.base
                    .shell
                    .buffered_stderr()
                    .extend_from_slice(&buf[..]);
            }
        }

        cmd.parent.child_done(cmd, self.exit_code.unwrap())
    }

    pub fn start(&mut self) -> Yield {
        self.call_impl_start()
    }
}

// TODO(port): Zig `deinit` was an explicit method, not Drop, because the parent `Cmd` controls
// when teardown happens (and Builtin lives inside a union). Kept as Drop per porting guide;
// Phase B may need to revert to an explicit `deinit()` if drop order conflicts with Cmd::Exec.
impl<'a> Drop for Builtin<'a> {
    fn drop(&mut self) {
        self.call_impl_deinit();

        // No need to free it because it belongs to the parent cmd
        // _ = Syscall.close(this.cwd);

        self.stdout.deref();
        self.stderr.deref();
        self.stdin.deref();

        // Parent cmd frees this
        // this.arena.deinit();
    }
}

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum IoKind {
    Stdout,
    Stderr,
}

impl<'a> Builtin<'a> {
    /// If the stdout/stderr is supposed to be captured then get the bytelist associated with that
    pub fn std_buffered_bytelist<const IO_KIND: IoKind>(&self) -> Option<&mut ByteList> {
        // TODO(port): the Zig version matched on a `BuiltinIO` (not `BuiltinIO.Output`) and looked
        // for a `.captured` arm — that type has no such variant, so this branch is dead in Zig too.
        // Preserving intent: return the shell's buffered list when the io is captured.
        let io: &BuiltinIO::Output = match IO_KIND {
            IoKind::Stdout => &self.stdout,
            IoKind::Stderr => &self.stderr,
        };
        match io {
            BuiltinIO::Output::Fd {
                captured: Some(_), ..
            } => Some(match IO_KIND {
                IoKind::Stdout => self.parent_cmd().base.shell.buffered_stdout(),
                IoKind::Stderr => self.parent_cmd().base.shell.buffered_stderr(),
            }),
            _ => None,
        }
    }

    pub fn read_stdin_no_io(&self) -> &[u8] {
        match &self.stdin {
            BuiltinIO::Input::Arraybuf(buf) => buf.buf.slice(),
            BuiltinIO::Input::Buf(buf) => &buf[..],
            BuiltinIO::Input::Blob(blob) => blob.blob.shared_view(),
            _ => b"",
        }
    }

    /// **WARNING** You should make sure that stdout/stderr does not need IO (e.g. `.needs_io()` is
    /// `None` before calling `.write_no_io::<{IoKind::Stderr}>(buf)`)
    pub fn write_no_io<const IO_KIND: IoKind>(&mut self, buf: &[u8]) -> sys::Result<usize> {
        if buf.is_empty() {
            return sys::Result::Ok(0);
        }

        let kind_tag = <&'static str>::from(self.kind);
        let io: &mut BuiltinIO::Output = match IO_KIND {
            IoKind::Stdout => &mut self.stdout,
            IoKind::Stderr => &mut self.stderr,
        };

        match io {
            BuiltinIO::Output::Fd { .. } => panic!(
                "writeNoIO(.{:?}, buf) can't write to a file descriptor, did you check that needsIO(.{:?}) was false?",
                IO_KIND, IO_KIND
            ),
            BuiltinIO::Output::Buf(b) => {
                log!(
                    "{} write to buf len={} str={}{}\n",
                    bstr::BStr::new(kind_tag),
                    buf.len(),
                    bstr::BStr::new(&buf[..buf.len().min(16)]),
                    if buf.len() > 16 { "..." } else { "" }
                );
                b.extend_from_slice(buf);
                sys::Result::Ok(buf.len())
            }
            BuiltinIO::Output::Arraybuf(ab) => {
                if ab.i >= ab.buf.array_buffer.byte_len {
                    return sys::Result::Err(sys::Error::from_code(sys::E::NOSPC, sys::Tag::Write));
                }

                let len = buf.len();
                if ab.i as usize + len > ab.buf.array_buffer.byte_len as usize {
                    // std.array_list.Managed(comptime T: type)
                }
                let write_len = if ab.i as usize + len > ab.buf.array_buffer.byte_len as usize {
                    (ab.buf.array_buffer.byte_len - ab.i) as usize
                } else {
                    len
                };

                let slice =
                    &mut ab.buf.slice_mut()[ab.i as usize..ab.i as usize + write_len];
                slice.copy_from_slice(&buf[..write_len]);
                ab.i = ab.i.saturating_add(write_len as u32);
                log!("{} write to arraybuf {}\n", bstr::BStr::new(kind_tag), write_len);
                sys::Result::Ok(write_len)
            }
            BuiltinIO::Output::Blob(_) | BuiltinIO::Output::Ignore => sys::Result::Ok(buf.len()),
        }
    }

    /// Error messages formatted to match bash
    // TODO(port): Zig `taskErrorToString` took `err: anytype` and `switch (@TypeOf(err))`.
    // Rust cannot dispatch on a value's type; split into three concrete overloads. Callers
    // pick the right one (or Phase B introduces a `TaskError` trait).
    // PERF(port): was comptime kind — demoted to runtime; only used to pick a prefix string.
    pub fn task_error_to_string_sys(&mut self, kind: Kind, err: &sys::Error) -> &[u8] {
        if let Some((_, sys_errno)) = err.get_error_code_tag_name() {
            if let Some(message) = sys::coreutils_error_map::get(sys_errno) {
                if !err.path.is_empty() {
                    return self.fmt_error_arena(Some(kind), format_args!(
                        "{}: {}\n",
                        bstr::BStr::new(&err.path),
                        bstr::BStr::new(message)
                    ));
                }
                return self.fmt_error_arena(Some(kind), format_args!(
                    "{}\n",
                    bstr::BStr::new(message)
                ));
            }
        }
        self.fmt_error_arena(Some(kind), format_args!("unknown error {}\n", err.errno))
    }

    // PERF(port): was comptime kind — demoted to runtime; only used to pick a prefix string.
    pub fn task_error_to_string_system(
        &mut self,
        kind: Kind,
        err: &bun_jsc::SystemError,
    ) -> &[u8] {
        if err.path.length() == 0 {
            return self.fmt_error_arena(Some(kind), format_args!(
                "{}\n",
                bstr::BStr::new(err.message.byte_slice())
            ));
        }
        self.fmt_error_arena(Some(kind), format_args!(
            "{}: {}\n",
            bstr::BStr::new(err.message.byte_slice()),
            err.path
        ))
    }

    // PERF(port): was comptime kind — demoted to runtime; only used to pick a prefix string.
    pub fn task_error_to_string_shell(&mut self, kind: Kind, err: &ShellErr) -> &[u8] {
        match err {
            ShellErr::Sys(sys) => self.task_error_to_string_sys(kind, sys),
            ShellErr::Custom(custom) => self
                .fmt_error_arena(Some(kind), format_args!("{}\n", bstr::BStr::new(custom))),
            ShellErr::InvalidArguments { val } => {
                self.fmt_error_arena(Some(kind), format_args!("{}\n", bstr::BStr::new(val)))
            }
            ShellErr::Todo(todo) => {
                self.fmt_error_arena(Some(kind), format_args!("{}\n", bstr::BStr::new(todo)))
            }
        }
    }

    // PERF(port): was `comptime kind: ?Kind`; `Option<Kind>` can't be a const generic on stable
    // and `kind` is only read as a value (prefix selection), so demoted to a runtime arg.
    pub fn fmt_error_arena(&mut self, kind: Option<Kind>, args: Arguments<'_>) -> &mut [u8] {
        use std::io::Write;
        let mut v: Vec<u8> = Vec::new();
        if let Some(k) = kind {
            let _ = v.write_all(<&'static str>::from(k).as_bytes());
            let _ = v.write_all(b": ");
        }
        let _ = v.write_fmt(args);
        // PERF(port): was `std.fmt.allocPrint(this.arena.allocator(), ...)` — arena bulk-free.
        // TODO(port): allocate into `self.arena` (bumpalo) instead of leaking a Vec; needs
        // `&'a mut ArenaAllocator` → `&'bump Bump` retyping.
        self.arena.alloc_slice_copy(&v)
    }
}

// --- Shell Builtin Commands ---
pub use crate::builtin::basename::Basename;
pub use crate::builtin::cat::Cat;
pub use crate::builtin::cd::Cd;
pub use crate::builtin::cp::Cp;
pub use crate::builtin::dirname::Dirname;
pub use crate::builtin::echo::Echo;
pub use crate::builtin::exit::Exit;
pub use crate::builtin::export::Export;
pub use crate::builtin::false_::False;
pub use crate::builtin::ls::Ls;
pub use crate::builtin::mkdir::Mkdir;
pub use crate::builtin::mv::Mv;
pub use crate::builtin::pwd::Pwd;
pub use crate::builtin::rm::Rm;
pub use crate::builtin::seq::Seq;
pub use crate::builtin::touch::Touch;
pub use crate::builtin::true_::True;
pub use crate::builtin::which::Which;
pub use crate::builtin::yes::Yes;
// --- End Shell Builtin Commands ---

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/Builtin.zig (841 lines)
//   confidence: medium
//   todos:      20
//   notes:      ref/deref → Clone/Drop in Phase B; callImpl reflection expanded to explicit match; Arc<Blob> per TSV vs IntrusiveRc per RefCount — reconcile.
// ──────────────────────────────────────────────────────────────────────────
