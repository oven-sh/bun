//! Port of src/shell/shell.zig
//! Shell lexer, parser, AST, and JS-bridge utilities for Bun's shell.

#![allow(non_camel_case_types, non_snake_case, dead_code, clippy::too_many_arguments)]

use core::ffi::{c_char, c_int};
use core::fmt;
use core::mem::size_of;
use std::io::Write as _;

use bun_alloc::Arena as Bump;
use bun_collections::{BabyList, IntegerBitSet};
use bun_core::{self, Output};
use bun_jsc::{
    self as jsc, CallFrame, JSArrayIterator, JSGlobalObject, JSValue, JsResult, MarkedArgumentBuffer,
    MiniEventLoop, PlatformEventLoop, SystemError, VirtualMachine,
};
use bun_str::{self as strings, String as BunString, ZStr};
use bun_sys::{self as sys, Fd};

// ───────────────────────────── re-exports ─────────────────────────────

pub mod interpret; // ./interpreter.zig → bun_shell::interpret
pub mod subproc; // ./subproc.zig → bun_shell::subproc
pub mod alloc_scope; // ./AllocScope.zig
pub use alloc_scope as AllocScope;

pub use interpret::{EnvMap, EnvStr, ExitCode, Interpreter, ParsedShellScript, unreachable_state};
pub use subproc::ShellSubprocess as Subprocess;
pub type IOWriter = interpret::Interpreter::IOWriter; // TODO(port): associated-type path
pub type IOReader = interpret::Interpreter::IOReader; // TODO(port): associated-type path

pub mod yield_; // ./Yield.zig
pub use yield_::Yield;

// TODO(port): GlobWalker = bun.glob.GlobWalker(null, true) — generic instantiation
pub type GlobWalker = bun_glob::GlobWalker;

pub const SUBSHELL_TODO_ERROR: &str =
    "Subshells are not implemented, please open GitHub issue!";

/// Using these instead of the file descriptor decl literals to make sure we use LibUV fds on Windows
pub const STDIN_FD: Fd = Fd::from_uv(0);
pub const STDOUT_FD: Fd = Fd::from_uv(1);
pub const STDERR_FD: Fd = Fd::from_uv(2);

pub const POSIX_DEV_NULL: &ZStr = ZStr::from_literal("/dev/null\0");
pub const WINDOWS_DEV_NULL: &ZStr = ZStr::from_literal("NUL\0");

// ───────────────────────────── ShellErr ─────────────────────────────

/// The strings in this type are allocated with event loop ctx allocator
pub enum ShellErr {
    Sys(SystemError),
    Custom(Box<[u8]>),
    InvalidArguments { val: Box<[u8]> },
    Todo(Box<[u8]>),
}

impl ShellErr {
    pub fn new_sys_from_syscall(e: sys::Error) -> Self {
        ShellErr::Sys(e.to_shell_system_error())
    }
    pub fn new_sys(e: SystemError) -> Self {
        ShellErr::Sys(e)
    }
    // TODO(port): Zig `newSys(e: anytype)` dispatched on @TypeOf(e); split into two ctors above.

    pub fn throw_js(&self, global: &JSGlobalObject) -> bun_jsc::JsError {
        // basically `transferToJS`. don't want to double deref the sys error
        let result = match self {
            ShellErr::Sys(sys) => {
                // sys.toErrorInstance handles decrementing the ref count
                let err = sys.to_error_instance(global);
                global.throw_value(err)
            }
            ShellErr::Custom(custom) => {
                let err_value =
                    BunString::clone_utf8(custom).to_error_instance(global);
                global.throw_value(err_value)
            }
            ShellErr::InvalidArguments { val } => {
                global.throw_invalid_arguments(format_args!(
                    "{}",
                    bstr::BStr::new(val)
                ))
            }
            ShellErr::Todo(todo) => global.throw_todo(todo),
        };
        match self {
            ShellErr::Sys(_) => {}
            ShellErr::Custom(_) | ShellErr::InvalidArguments { .. } | ShellErr::Todo(_) => {
                // TODO(port): Zig calls self.deinit(bun.default_allocator) here; in Rust the
                // Box<[u8]> is dropped by the caller who owns `self`. Consider taking `self`
                // by value to mirror "transfer" semantics.
            }
        }
        result
    }

    pub fn throw_mini(self) -> ! {
        match &self {
            ShellErr::Sys(err) => {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: Failed due to error: <b>bunsh: {}: {}<r>",
                    err.message, err.path
                ));
            }
            ShellErr::Custom(custom) => {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: Failed due to error: <b>{}<r>",
                    bstr::BStr::new(custom)
                ));
            }
            ShellErr::InvalidArguments { val } => {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: Failed due to error: <b>bunsh: invalid arguments: {}<r>",
                    bstr::BStr::new(val)
                ));
            }
            ShellErr::Todo(todo) => {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: Failed due to error: <b>TODO: {}<r>",
                    bstr::BStr::new(todo)
                ));
            }
        }
        drop(self);
        bun_core::Global::exit(1)
    }
}

impl fmt::Display for ShellErr {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ShellErr::Sys(e) => write!(f, "bun: {}: {}", e.message, e.path),
            ShellErr::Custom(msg) => write!(f, "bun: {}", bstr::BStr::new(msg)),
            ShellErr::InvalidArguments { val } => {
                write!(f, "bun: invalid arguments: {}", bstr::BStr::new(val))
            }
            ShellErr::Todo(msg) => write!(f, "bun: TODO: {}", bstr::BStr::new(msg)),
        }
    }
}

impl Drop for ShellErr {
    fn drop(&mut self) {
        match self {
            ShellErr::Sys(sys) => sys.deref(),
            // Box<[u8]> drops automatically; InvalidArguments empty in Zig deinit
            _ => {}
        }
    }
}

// ───────────────────────────── Result ─────────────────────────────

pub enum ShellResult<T> {
    Result(T),
    Err(ShellErr),
}

impl<T: Default> ShellResult<T> {
    pub const fn success() -> Self
    where
        T: Copy,
    {
        // TODO(port): Zig used std.mem.zeroes(T); Default is the safe Rust mapping
        ShellResult::Result(unsafe { core::mem::zeroed() })
    }
}

impl<T> ShellResult<T> {
    pub fn as_err(self) -> Option<ShellErr> {
        match self {
            ShellResult::Err(e) => Some(e),
            ShellResult::Result(_) => None,
        }
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ShellError {
    #[error("Init")]
    Init,
    #[error("Process")]
    Process,
    #[error("GlobalThisThrown")]
    GlobalThisThrown,
    #[error("Spawn")]
    Spawn,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr, Clone, Copy, PartialEq, Eq)]
pub enum ParseError {
    #[error("Unsupported")]
    Unsupported,
    #[error("Expected")]
    Expected,
    #[error("Unexpected")]
    Unexpected,
    #[error("Unknown")]
    Unknown,
    #[error("Lex")]
    Lex,
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn setenv(name: *const c_char, value: *const c_char, overwrite: c_int) -> c_int;
}

fn set_env(name: *const c_char, value: *const c_char) {
    // TODO: windows
    unsafe {
        let _ = setenv(name, value, 1);
    }
}

/// `[0]` => read end, `[1]` => write end
pub type Pipe = [Fd; 2];

bun_core::declare_scope!(SHELL, hidden);
macro_rules! log {
    ($($arg:tt)*) => { bun_core::scoped_log!(SHELL, $($arg)*) };
}

// ───────────────────────────── GlobalJS ─────────────────────────────

#[derive(Clone, Copy)]
pub struct GlobalJS<'a> {
    pub global_this: &'a JSGlobalObject,
}

impl<'a> GlobalJS<'a> {
    #[inline]
    pub fn init(g: &'a JSGlobalObject) -> Self {
        Self { global_this: g }
    }

    #[inline]
    pub fn event_loop_ctx(self) -> &'a VirtualMachine {
        self.global_this.bun_vm()
    }

    #[inline]
    pub fn throw_invalid_arguments(self, args: fmt::Arguments<'_>) -> ShellErr {
        let mut v = Vec::new();
        write!(&mut v, "{}", args).unwrap();
        ShellErr::InvalidArguments { val: v.into_boxed_slice() }
    }

    #[inline]
    pub fn throw_todo(self, msg: &[u8]) -> ShellErr {
        ShellErr::Todo(Box::<[u8]>::from(msg))
    }

    #[inline]
    pub fn throw_error(self, err: sys::Error) {
        // TODO(port): move to *_jsc — err.to_js() lives in jsc extension trait
        self.global_this.throw_value(err.to_js(self.global_this));
    }

    #[inline]
    pub fn handle_error(self, err: bun_core::Error, suffix: &str) -> ShellErr {
        let mut v = Vec::new();
        write!(&mut v, "{} {}", err.name(), suffix).unwrap();
        ShellErr::Custom(v.into_boxed_slice())
    }

    #[inline]
    pub fn throw(self, args: fmt::Arguments<'_>) -> ShellErr {
        let mut v = Vec::new();
        write!(&mut v, "{}", args).unwrap();
        ShellErr::Custom(v.into_boxed_slice())
    }

    #[inline]
    pub fn create_null_delimited_env_map(
        self,
        // TODO(port): allocator param dropped (global mimalloc)
    ) -> Result<Box<[Option<*const c_char>]>, bun_core::Error> {
        // TODO(port): narrow error set
        self.global_this
            .bun_vm()
            .transpiler
            .env
            .map
            .create_null_delimited_env_map()
    }

    #[inline]
    pub fn enqueue_task_concurrent_wait_pid<T>(self, task: T) {
        // TODO(port): jsc::ConcurrentTask::create + jsc::Task::init are FFI helpers
        self.global_this
            .bun_vm_concurrently()
            .enqueue_task_concurrent(jsc::ConcurrentTask::create(jsc::Task::init(task)));
    }

    #[inline]
    pub fn top_level_dir(self) -> &'a [u8] {
        self.global_this.bun_vm().transpiler.fs.top_level_dir()
    }

    #[inline]
    pub fn env(self) -> &'a bun_core::DotEnv::Loader {
        &self.global_this.bun_vm().transpiler.env
    }

    #[inline]
    pub fn platform_event_loop(self) -> &'a PlatformEventLoop {
        jsc::AbstractVM(self.event_loop_ctx()).platform_event_loop()
    }

    #[inline]
    pub fn actually_throw(self, shellerr: ShellErr) {
        let _ = shellerr.throw_js(self.global_this);
    }
}

// ───────────────────────────── GlobalMini ─────────────────────────────

#[derive(Clone, Copy)]
pub struct GlobalMini<'a> {
    pub mini: &'a MiniEventLoop,
}

impl<'a> GlobalMini<'a> {
    #[inline]
    pub fn init(g: &'a MiniEventLoop) -> Self {
        Self { mini: g }
    }

    #[inline]
    pub fn env(self) -> &'a bun_core::DotEnv::Loader {
        self.mini.env.as_ref().unwrap()
    }

    #[inline]
    pub fn event_loop_ctx(self) -> &'a MiniEventLoop {
        self.mini
    }

    #[inline]
    pub fn throw_todo(self, msg: &[u8]) -> ShellErr {
        ShellErr::Todo(Box::<[u8]>::from(msg))
    }

    #[inline]
    pub fn throw_invalid_arguments(self, args: fmt::Arguments<'_>) -> ShellErr {
        let mut v = Vec::new();
        write!(&mut v, "{}", args).unwrap();
        ShellErr::InvalidArguments { val: v.into_boxed_slice() }
    }

    #[inline]
    pub fn handle_error(self, err: bun_core::Error, suffix: &str) -> ShellErr {
        let mut v = Vec::new();
        write!(&mut v, "{} {}", err.name(), suffix).unwrap();
        ShellErr::Custom(v.into_boxed_slice())
    }

    #[inline]
    pub fn create_null_delimited_env_map(
        self,
    ) -> Result<Box<[Option<*const c_char>]>, bun_core::Error> {
        // TODO(port): narrow error set
        self.mini.env.as_ref().unwrap().map.create_null_delimited_env_map()
    }

    #[inline]
    pub fn enqueue_task_concurrent_wait_pid<T: 'static>(self, task: T) {
        let anytask = Box::new(jsc::AnyTaskWithExtraContext::default());
        // TODO(port): .from(task, "runFromMainThreadMini") — comptime field name lookup
        let anytask = Box::leak(anytask).from(task, "runFromMainThreadMini");
        self.mini.enqueue_task_concurrent(anytask);
    }

    #[inline]
    pub fn top_level_dir(self) -> &'a [u8] {
        self.mini.top_level_dir()
    }

    #[inline]
    pub fn throw(self, args: fmt::Arguments<'_>) -> ShellErr {
        let mut v = Vec::new();
        write!(&mut v, "{}", args).unwrap();
        ShellErr::Custom(v.into_boxed_slice())
    }

    #[inline]
    pub fn actually_throw(self, shellerr: ShellErr) {
        shellerr.throw_mini();
    }

    #[inline]
    pub fn platform_event_loop(self) -> &'a PlatformEventLoop {
        jsc::AbstractVM(self.event_loop_ctx()).platform_event_loop()
    }
}

// ───────────────────────────── AST ─────────────────────────────

pub mod ast {
    use super::*;

    pub struct Script<'arena> {
        pub stmts: &'arena mut [Stmt<'arena>],
    }

    impl<'arena> Script<'arena> {
        pub fn memory_cost(&self) -> usize {
            let mut cost = 0usize;
            for stmt in self.stmts.iter() {
                cost += stmt.memory_cost();
            }
            cost
        }
    }

    pub struct Stmt<'arena> {
        pub exprs: &'arena mut [Expr<'arena>],
    }

    impl<'arena> Stmt<'arena> {
        pub fn memory_cost(&self) -> usize {
            let mut cost = 0usize;
            for expr in self.exprs.iter() {
                cost += expr.memory_cost();
            }
            cost
        }
    }

    #[derive(strum::IntoStaticStr)]
    pub enum Expr<'arena> {
        Assign(&'arena mut [Assign<'arena>]),
        Binary(&'arena Binary<'arena>),
        Pipeline(&'arena Pipeline<'arena>),
        Cmd(&'arena Cmd<'arena>),
        Subshell(&'arena Subshell<'arena>),
        If(&'arena If<'arena>),
        CondExpr(&'arena CondExpr<'arena>),
        /// Valid async (`&`) expressions: pipeline, cmd, subshell, if, condexpr.
        /// Note that commands in a pipeline cannot be async.
        /// TODO: Extra indirection for essentially a boolean feels bad for performance
        /// could probably find a more efficient way to encode this information.
        Async(&'arena Expr<'arena>),
    }

    #[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
    pub enum ExprTag {
        Assign,
        Binary,
        Pipeline,
        Cmd,
        Subshell,
        If,
        CondExpr,
        Async,
    }

    impl<'arena> Expr<'arena> {
        pub fn tag(&self) -> ExprTag {
            match self {
                Expr::Assign(_) => ExprTag::Assign,
                Expr::Binary(_) => ExprTag::Binary,
                Expr::Pipeline(_) => ExprTag::Pipeline,
                Expr::Cmd(_) => ExprTag::Cmd,
                Expr::Subshell(_) => ExprTag::Subshell,
                Expr::If(_) => ExprTag::If,
                Expr::CondExpr(_) => ExprTag::CondExpr,
                Expr::Async(_) => ExprTag::Async,
            }
        }

        pub fn memory_cost(&self) -> usize {
            match self {
                Expr::Assign(assign) => {
                    let mut cost = 0usize;
                    for expr in assign.iter() {
                        cost += expr.memory_cost();
                    }
                    cost
                }
                Expr::Binary(b) => b.memory_cost(),
                Expr::Pipeline(p) => p.memory_cost(),
                Expr::Cmd(c) => c.memory_cost(),
                Expr::Subshell(s) => s.memory_cost(),
                Expr::If(i) => i.memory_cost(),
                Expr::CondExpr(c) => c.memory_cost(),
                Expr::Async(a) => a.memory_cost(),
            }
        }

        pub fn as_pipeline_item(&self) -> Option<PipelineItem<'arena>> {
            match self {
                Expr::Assign(a) => Some(PipelineItem::Assigns(*a as *const _ as *mut _)),
                // TODO(port): borrowck — Zig copies the arena ptr; here we re-borrow
                Expr::Cmd(c) => Some(PipelineItem::Cmd(*c)),
                Expr::Subshell(s) => Some(PipelineItem::Subshell(*s)),
                Expr::If(i) => Some(PipelineItem::If(*i)),
                Expr::CondExpr(c) => Some(PipelineItem::CondExpr(*c)),
                _ => None,
            }
        }
    }

    /// https://www.gnu.org/software/bash/manual/bash.html#Bash-Conditional-Expressions
    pub struct CondExpr<'arena> {
        pub op: CondExprOp,
        pub args: CondExprArgList<'arena>,
    }

    pub type CondExprArgList<'arena> = SmolList<Atom<'arena>, 2>;

    impl<'arena> CondExpr<'arena> {
        pub fn memory_cost(&self) -> usize {
            let mut cost = size_of::<CondExprOp>();
            cost += self.args.memory_cost();
            cost
        }

        pub fn to_expr(self, bump: &'arena Bump) -> Result<Expr<'arena>, bun_alloc::AllocError> {
            let condexpr = bump.alloc(self);
            Ok(Expr::CondExpr(condexpr))
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
    #[strum(serialize_all = "kebab-case")] // TODO(port): tag names must match Zig exactly ("-a", "==", etc.)
    pub enum CondExprOp {
        /// -a file: True if file exists.
        #[strum(serialize = "-a")] DashA,
        /// -b file: True if file exists and is a block special file.
        #[strum(serialize = "-b")] DashB,
        /// -c file: True if file exists and is a character special file.
        #[strum(serialize = "-c")] DashC,
        /// -d file: True if file exists and is a directory.
        #[strum(serialize = "-d")] DashD,
        /// -e file: True if file exists.
        #[strum(serialize = "-e")] DashE,
        /// -f file: True if file exists and is a regular file.
        #[strum(serialize = "-f")] DashF,
        /// -g file: True if file exists and its set-group-id bit is set.
        #[strum(serialize = "-g")] DashG,
        /// -h file: True if file exists and is a symbolic link.
        #[strum(serialize = "-h")] DashH,
        /// -k file: True if file exists and its "sticky" bit is set.
        #[strum(serialize = "-k")] DashK,
        /// -p file: True if file exists and is a named pipe (FIFO).
        #[strum(serialize = "-p")] DashP,
        /// -r file: True if file exists and is readable.
        #[strum(serialize = "-r")] DashR,
        /// -s file: True if file exists and has a size greater than zero.
        #[strum(serialize = "-s")] DashS,
        /// -t fd: True if file descriptor fd is open and refers to a terminal.
        #[strum(serialize = "-t")] DashT,
        /// -u file: True if file exists and its set-user-id bit is set.
        #[strum(serialize = "-u")] DashU,
        /// -w file: True if file exists and is writable.
        #[strum(serialize = "-w")] DashW,
        /// -x file: True if file exists and is executable.
        #[strum(serialize = "-x")] DashX,
        /// -G file: True if file exists and is owned by the effective group id.
        #[strum(serialize = "-G")] DashCapG,
        /// -L file: True if file exists and is a symbolic link.
        #[strum(serialize = "-L")] DashCapL,
        /// -N file: True if file exists and has been modified since it was last read.
        #[strum(serialize = "-N")] DashCapN,
        /// -O file: True if file exists and is owned by the effective user id.
        #[strum(serialize = "-O")] DashCapO,
        /// -S file: True if file exists and is a socket.
        #[strum(serialize = "-S")] DashCapS,
        /// file1 -ef file2
        #[strum(serialize = "-ef")] DashEf,
        /// file1 -nt file2
        #[strum(serialize = "-nt")] DashNt,
        /// file1 -ot file2
        #[strum(serialize = "-ot")] DashOt,
        /// -o optname
        #[strum(serialize = "-o")] DashO,
        /// -v varname
        #[strum(serialize = "-v")] DashV,
        /// -R varname
        #[strum(serialize = "-R")] DashCapR,
        /// -z string
        #[strum(serialize = "-z")] DashZ,
        /// -n string
        #[strum(serialize = "-n")] DashN,
        /// string1 == string2
        #[strum(serialize = "==")] EqEq,
        /// string1 != string2
        #[strum(serialize = "!=")] NotEq,
        /// string1 < string2
        #[strum(serialize = "<")] Lt,
        /// string1 > string2
        #[strum(serialize = ">")] Gt,
        #[strum(serialize = "-eq")] DashEq,
        #[strum(serialize = "-ne")] DashNe,
        #[strum(serialize = "-lt")] DashLt,
        #[strum(serialize = "-le")] DashLe,
        #[strum(serialize = "-gt")] DashGt,
        #[strum(serialize = "-ge")] DashGe,
    }

    impl CondExprOp {
        pub const SUPPORTED: &'static [CondExprOp] = &[
            CondExprOp::DashF,
            CondExprOp::DashZ,
            CondExprOp::DashN,
            CondExprOp::DashD,
            CondExprOp::DashC,
            CondExprOp::EqEq,
            CondExprOp::NotEq,
        ];

        pub fn is_supported(op: CondExprOp) -> bool {
            for supported_op in Self::SUPPORTED {
                if *supported_op == op {
                    return true;
                }
            }
            false
        }

        /// Single-arg ops: name starts with '-' and len == 2.
        // TODO(port): Zig built this via @typeInfo reflection over enum fields. Hand-rolled here.
        pub const SINGLE_ARG_OPS: &'static [(&'static str, CondExprOp)] = &[
            ("-a", CondExprOp::DashA), ("-b", CondExprOp::DashB), ("-c", CondExprOp::DashC),
            ("-d", CondExprOp::DashD), ("-e", CondExprOp::DashE), ("-f", CondExprOp::DashF),
            ("-g", CondExprOp::DashG), ("-h", CondExprOp::DashH), ("-k", CondExprOp::DashK),
            ("-p", CondExprOp::DashP), ("-r", CondExprOp::DashR), ("-s", CondExprOp::DashS),
            ("-t", CondExprOp::DashT), ("-u", CondExprOp::DashU), ("-w", CondExprOp::DashW),
            ("-x", CondExprOp::DashX), ("-G", CondExprOp::DashCapG), ("-L", CondExprOp::DashCapL),
            ("-N", CondExprOp::DashCapN), ("-O", CondExprOp::DashCapO), ("-S", CondExprOp::DashCapS),
            ("-o", CondExprOp::DashO), ("-v", CondExprOp::DashV), ("-R", CondExprOp::DashCapR),
            ("-z", CondExprOp::DashZ), ("-n", CondExprOp::DashN),
        ];

        /// Binary ops: NOT (name starts with '-' and len == 2).
        pub const BINARY_OPS: &'static [(&'static str, CondExprOp)] = &[
            ("-ef", CondExprOp::DashEf), ("-nt", CondExprOp::DashNt), ("-ot", CondExprOp::DashOt),
            ("==", CondExprOp::EqEq), ("!=", CondExprOp::NotEq),
            ("<", CondExprOp::Lt), (">", CondExprOp::Gt),
            ("-eq", CondExprOp::DashEq), ("-ne", CondExprOp::DashNe),
            ("-lt", CondExprOp::DashLt), ("-le", CondExprOp::DashLe),
            ("-gt", CondExprOp::DashGt), ("-ge", CondExprOp::DashGe),
        ];
    }

    pub struct Subshell<'arena> {
        pub script: Script<'arena>,
        pub redirect: Option<Redirect<'arena>>,
        pub redirect_flags: RedirectFlags,
    }

    impl<'arena> Subshell<'arena> {
        pub fn memory_cost(&self) -> usize {
            let mut cost = size_of::<Subshell>();
            cost += self.script.memory_cost();
            if let Some(redirect) = &self.redirect {
                cost += redirect.memory_cost();
            }
            cost
        }
    }

    /// TODO: If we know cond/then/elif/else is just a single command we don't need to store the stmt
    pub struct If<'arena> {
        pub cond: SmolList<Stmt<'arena>, 1>,
        pub then: SmolList<Stmt<'arena>, 1>,
        /// From the spec:
        ///
        /// else_part        : Elif compound_list Then else_part
        ///                  | Else compound_list
        ///
        /// If len is:
        /// - 0                                   => no else
        /// - 1                                   => just else
        /// - 2n (n is # of elif/then branches)   => n elif/then branches
        /// - 2n + 1                              => n elif/then branches and an else branch
        pub else_parts: SmolList<SmolList<Stmt<'arena>, 1>, 1>,
    }

    impl<'arena> Default for If<'arena> {
        fn default() -> Self {
            Self {
                cond: SmolList::zeroes(),
                then: SmolList::zeroes(),
                else_parts: SmolList::zeroes(),
            }
        }
    }

    impl<'arena> If<'arena> {
        pub fn to_expr(self, bump: &'arena Bump) -> Result<Expr<'arena>, bun_alloc::AllocError> {
            let i = bump.alloc(self);
            Ok(Expr::If(i))
        }

        pub fn memory_cost(&self) -> usize {
            let mut cost = size_of::<If>();
            cost += self.cond.memory_cost();
            cost += self.then.memory_cost();
            cost += self.else_parts.memory_cost();
            cost
        }
    }

    pub struct Binary<'arena> {
        pub op: BinaryOp,
        pub left: Expr<'arena>,
        pub right: Expr<'arena>,
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum BinaryOp {
        And,
        Or,
    }

    impl<'arena> Binary<'arena> {
        pub fn memory_cost(&self) -> usize {
            let mut cost = size_of::<Binary>();
            cost += self.left.memory_cost();
            cost += self.right.memory_cost();
            cost
        }
    }

    pub struct Pipeline<'arena> {
        pub items: &'arena mut [PipelineItem<'arena>],
    }

    impl<'arena> Pipeline<'arena> {
        pub fn memory_cost(&self) -> usize {
            let mut cost = 0usize;
            for item in self.items.iter() {
                cost += item.memory_cost();
            }
            cost
        }
    }

    pub enum PipelineItem<'arena> {
        Cmd(&'arena Cmd<'arena>),
        Assigns(*mut [Assign<'arena>]), // TODO(port): lifetime — arena slice shared with Expr::Assign
        Subshell(&'arena Subshell<'arena>),
        If(&'arena If<'arena>),
        CondExpr(&'arena CondExpr<'arena>),
    }

    impl<'arena> PipelineItem<'arena> {
        pub fn memory_cost(&self) -> usize {
            let mut cost = 0usize;
            match self {
                PipelineItem::Cmd(cmd) => cost += cmd.memory_cost(),
                PipelineItem::Assigns(assigns) => {
                    // SAFETY: arena slice is live for 'arena
                    for assign in unsafe { &**assigns }.iter() {
                        cost += assign.memory_cost();
                    }
                }
                PipelineItem::Subshell(s) => cost += s.memory_cost(),
                PipelineItem::If(i) => cost += i.memory_cost(),
                PipelineItem::CondExpr(c) => cost += c.memory_cost(),
            }
            cost
        }
    }

    pub enum CmdOrAssigns<'arena> {
        Cmd(Cmd<'arena>),
        Assigns(&'arena mut [Assign<'arena>]),
    }

    #[derive(Clone, Copy)]
    pub enum CmdOrAssignsTag {
        Cmd,
        Assigns,
    }

    impl<'arena> CmdOrAssigns<'arena> {
        pub fn to_pipeline_item(self, bump: &'arena Bump) -> PipelineItem<'arena> {
            match self {
                CmdOrAssigns::Cmd(cmd) => {
                    let cmd_ptr = bump.alloc(cmd);
                    PipelineItem::Cmd(cmd_ptr)
                }
                CmdOrAssigns::Assigns(assigns) => PipelineItem::Assigns(assigns),
            }
        }

        pub fn to_expr(self, bump: &'arena Bump) -> Result<Expr<'arena>, bun_alloc::AllocError> {
            match self {
                CmdOrAssigns::Cmd(cmd) => {
                    let cmd_ptr = bump.alloc(cmd);
                    Ok(Expr::Cmd(cmd_ptr))
                }
                CmdOrAssigns::Assigns(assigns) => Ok(Expr::Assign(assigns)),
            }
        }
    }

    /// A "buffer" from a JS object can be piped from and to, and also have
    /// output from commands redirected into it. Only BunFile, ArrayBufferView
    /// are supported.
    #[derive(Clone, Copy)]
    pub struct JSBuf {
        pub idx: u32,
    }

    impl JSBuf {
        pub fn new(idx: u32) -> JSBuf {
            JSBuf { idx }
        }
    }

    /// A Subprocess from JS
    #[derive(Clone, Copy)]
    pub struct JSProc {
        pub idx: JSValue,
    }

    pub struct Assign<'arena> {
        pub label: &'arena [u8],
        pub value: Atom<'arena>,
    }

    impl<'arena> Assign<'arena> {
        pub fn new(label: &'arena [u8], value: Atom<'arena>) -> Self {
            Self { label, value }
        }

        pub fn memory_cost(&self) -> usize {
            let mut cost = size_of::<Assign>();
            cost += self.label.len();
            cost += self.value.memory_cost();
            cost
        }
    }

    pub struct Cmd<'arena> {
        pub assigns: &'arena mut [Assign<'arena>],
        pub name_and_args: &'arena mut [Atom<'arena>],
        pub redirect: RedirectFlags,
        pub redirect_file: Option<Redirect<'arena>>,
    }

    impl<'arena> Cmd<'arena> {
        pub fn memory_cost(&self) -> usize {
            let mut cost = size_of::<Cmd>();
            for assign in self.assigns.iter() {
                cost += assign.memory_cost();
            }
            for atom in self.name_and_args.iter() {
                cost += atom.memory_cost();
            }
            if let Some(rf) = &self.redirect_file {
                cost += rf.memory_cost();
            }
            cost
        }
    }

    bitflags::bitflags! {
        /// Bit flags for redirects:
        /// -  `>`  = Redirect.Stdout
        /// -  `1>` = Redirect.Stdout
        /// -  `2>` = Redirect.Stderr
        /// -  `&>` = Redirect.Stdout | Redirect.Stderr
        /// -  `>>` = Redirect.Append | Redirect.Stdout
        /// - `1>>` = Redirect.Append | Redirect.Stdout
        /// - `2>>` = Redirect.Append | Redirect.Stderr
        /// - `&>>` = Redirect.Append | Redirect.Stdout | Redirect.Stderr
        ///
        /// Multiple redirects are not supported yet.
        #[derive(Clone, Copy, PartialEq, Eq, Default)]
        pub struct RedirectFlags: u8 {
            const STDIN         = 1 << 0;
            const STDOUT        = 1 << 1;
            const STDERR        = 1 << 2;
            const APPEND        = 1 << 3;
            /// 1>&2 === stdout=true and duplicate_out=true
            /// 2>&1 === stderr=true and duplicate_out=true
            const DUPLICATE_OUT = 1 << 4;
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum IoKind {
        Stdin,
        Stdout,
        Stderr,
    }

    impl RedirectFlags {
        #[inline]
        pub fn stdin(self) -> bool { self.contains(Self::STDIN) }
        #[inline]
        pub fn stdout(self) -> bool { self.contains(Self::STDOUT) }
        #[inline]
        pub fn stderr(self) -> bool { self.contains(Self::STDERR) }
        #[inline]
        pub fn append(self) -> bool { self.contains(Self::APPEND) }
        #[inline]
        pub fn duplicate_out(self) -> bool { self.contains(Self::DUPLICATE_OUT) }

        #[inline]
        pub fn is_empty(self) -> bool {
            self.bits() == 0
        }

        pub fn redirects_elsewhere(self, io_kind: IoKind) -> bool {
            match io_kind {
                IoKind::Stdin => self.stdin(),
                IoKind::Stdout => {
                    if self.duplicate_out() { !self.stdout() } else { self.stdout() }
                }
                IoKind::Stderr => {
                    if self.duplicate_out() { !self.stderr() } else { self.stderr() }
                }
            }
        }

        // TODO(port): Zig fns @"2>&1"/@"1>&2" reference nonexistent `.duplicate` field — likely dead code.
        pub fn two_gt_amp_one() -> RedirectFlags {
            Self::STDERR | Self::DUPLICATE_OUT
        }
        pub fn one_gt_amp_two() -> RedirectFlags {
            Self::STDOUT | Self::DUPLICATE_OUT
        }

        pub fn to_flags(self) -> i32 {
            let read_write_flags: i32 = if self.stdin() {
                bun_sys::O::RDONLY
            } else {
                bun_sys::O::WRONLY | bun_sys::O::CREAT
            };
            let extra: i32 = if self.append() { bun_sys::O::APPEND } else { bun_sys::O::TRUNC };
            if self.stdin() { read_write_flags } else { extra | read_write_flags }
        }

        pub fn lt() -> RedirectFlags { Self::STDIN }
        pub fn lt_lt() -> RedirectFlags { Self::STDIN | Self::APPEND }
        pub fn gt() -> RedirectFlags { Self::STDOUT }
        pub fn gt_gt() -> RedirectFlags { Self::APPEND | Self::STDOUT }
        pub fn amp_gt() -> RedirectFlags { Self::STDOUT | Self::STDERR }
        pub fn amp_gt_gt() -> RedirectFlags { Self::APPEND | Self::STDOUT | Self::STDERR }

        pub fn merge(a: RedirectFlags, b: RedirectFlags) -> RedirectFlags {
            RedirectFlags::from_bits_retain(a.bits() | b.bits())
        }
    }

    pub enum Redirect<'arena> {
        Atom(Atom<'arena>),
        JsBuf(JSBuf),
    }

    impl<'arena> Redirect<'arena> {
        pub fn memory_cost(&self) -> usize {
            match self {
                Redirect::Atom(a) => a.memory_cost(),
                Redirect::JsBuf(_) => size_of::<JSBuf>(),
            }
        }
    }

    pub enum Atom<'arena> {
        Simple(SimpleAtom<'arena>),
        Compound(CompoundAtom<'arena>),
    }

    #[repr(u8)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum AtomTag {
        Simple,
        Compound,
    }

    impl<'arena> Atom<'arena> {
        pub fn memory_cost(&self) -> usize {
            match self {
                Atom::Simple(s) => s.memory_cost(),
                Atom::Compound(c) => c.memory_cost(),
            }
        }

        pub fn merge(
            self,
            right: Atom<'arena>,
            bump: &'arena Bump,
        ) -> Result<Atom<'arena>, bun_alloc::AllocError> {
            use SimpleAtom as SA;
            match (&self, &right) {
                (Atom::Simple(l), Atom::Simple(r)) => {
                    let atoms = bump.alloc_slice_fill_default::<SimpleAtom>(2);
                    // TODO(port): bumpalo doesn't have alloc_slice_fill_default for non-Default;
                    // use alloc_slice_fill_iter or manual writes.
                    atoms[0] = l.clone();
                    atoms[1] = r.clone();
                    let brace = matches!(l, SA::BraceBegin | SA::BraceEnd)
                        || matches!(r, SA::BraceBegin | SA::BraceEnd);
                    let glob = matches!(l, SA::Asterisk | SA::DoubleAsterisk)
                        || matches!(r, SA::Asterisk | SA::DoubleAsterisk);
                    return Ok(Atom::Compound(CompoundAtom {
                        atoms,
                        brace_expansion_hint: brace,
                        glob_hint: glob,
                    }));
                }
                _ => {}
            }

            if let (Atom::Compound(l), Atom::Compound(r)) = (&self, &right) {
                let total = l.atoms.len() + r.atoms.len();
                let atoms = bump.alloc_slice_fill_with(total, |_| SimpleAtom::QuotedEmpty);
                atoms[..l.atoms.len()].clone_from_slice(l.atoms);
                atoms[l.atoms.len()..].clone_from_slice(r.atoms);
                return Ok(Atom::Compound(CompoundAtom {
                    atoms,
                    brace_expansion_hint: l.brace_expansion_hint || r.brace_expansion_hint,
                    glob_hint: l.glob_hint || r.glob_hint,
                }));
            }

            if let Atom::Simple(l) = &self {
                let Atom::Compound(r) = &right else { unreachable!() };
                let atoms = bump.alloc_slice_fill_with(1 + r.atoms.len(), |_| SimpleAtom::QuotedEmpty);
                atoms[0] = l.clone();
                atoms[1..].clone_from_slice(r.atoms);
                return Ok(Atom::Compound(CompoundAtom {
                    atoms,
                    brace_expansion_hint: matches!(l, SA::BraceBegin | SA::BraceEnd)
                        || r.brace_expansion_hint,
                    glob_hint: matches!(l, SA::Asterisk | SA::DoubleAsterisk) || r.glob_hint,
                }));
            }

            let Atom::Compound(l) = &self else { unreachable!() };
            let Atom::Simple(r) = &right else { unreachable!() };
            let atoms = bump.alloc_slice_fill_with(1 + l.atoms.len(), |_| SimpleAtom::QuotedEmpty);
            atoms[..l.atoms.len()].clone_from_slice(l.atoms);
            atoms[l.atoms.len()] = r.clone();
            Ok(Atom::Compound(CompoundAtom {
                atoms,
                brace_expansion_hint: matches!(r, SA::BraceBegin | SA::BraceEnd)
                    || l.brace_expansion_hint,
                glob_hint: matches!(r, SA::Asterisk | SA::DoubleAsterisk) || l.glob_hint,
            }))
        }

        pub fn atoms_len(&self) -> u32 {
            match self {
                Atom::Simple(_) => 1,
                Atom::Compound(c) => u32::try_from(c.atoms.len()).unwrap(),
            }
        }

        pub fn new_simple(atom: SimpleAtom<'arena>) -> Atom<'arena> {
            Atom::Simple(atom)
        }

        pub fn is_compound(&self) -> bool {
            matches!(self, Atom::Compound(_))
        }

        pub fn has_expansions(&self) -> bool {
            self.has_glob_expansion() || self.has_brace_expansion()
        }

        pub fn has_glob_expansion(&self) -> bool {
            match self {
                Atom::Simple(s) => s.glob_hint(),
                Atom::Compound(c) => c.glob_hint,
            }
        }

        pub fn has_brace_expansion(&self) -> bool {
            match self {
                Atom::Simple(_) => false,
                Atom::Compound(c) => c.brace_expansion_hint,
            }
        }

        pub fn has_tilde_expansion(&self) -> bool {
            match self {
                Atom::Simple(s) => matches!(s, SimpleAtom::Tilde),
                Atom::Compound(c) => {
                    !c.atoms.is_empty() && matches!(c.atoms[0], SimpleAtom::Tilde)
                }
            }
        }
    }

    #[derive(Clone)]
    pub enum SimpleAtom<'arena> {
        Var(&'arena [u8]),
        VarArgv(u8),
        Text(&'arena [u8]),
        /// An empty string from a quoted context (e.g. "", '', or ${''}). Preserved as an
        /// explicit empty argument during expansion, unlike unquoted empty text which is dropped.
        QuotedEmpty,
        Asterisk,
        DoubleAsterisk,
        BraceBegin,
        BraceEnd,
        Comma,
        Tilde,
        CmdSubst(CmdSubst<'arena>),
    }

    #[derive(Clone)]
    pub struct CmdSubst<'arena> {
        pub script: Script<'arena>,
        pub quoted: bool,
    }
    // TODO(port): Script contains &'arena mut — Clone is wrong; revisit in Phase B.

    impl<'arena> CmdSubst<'arena> {
        pub fn memory_cost(&self) -> usize {
            let mut cost = size_of::<Self>();
            cost += self.script.memory_cost();
            cost
        }
    }

    impl<'arena> SimpleAtom<'arena> {
        pub fn glob_hint(&self) -> bool {
            matches!(self, SimpleAtom::Asterisk | SimpleAtom::DoubleAsterisk)
        }

        pub fn memory_cost(&self) -> usize {
            (match self {
                SimpleAtom::Var(v) => v.len(),
                SimpleAtom::Text(t) => t.len(),
                SimpleAtom::CmdSubst(c) => c.memory_cost(),
                _ => 0,
            }) + size_of::<SimpleAtom>()
        }
    }

    pub struct CompoundAtom<'arena> {
        pub atoms: &'arena mut [SimpleAtom<'arena>],
        pub brace_expansion_hint: bool,
        pub glob_hint: bool,
    }

    impl<'arena> CompoundAtom<'arena> {
        pub fn memory_cost(&self) -> usize {
            let mut cost = size_of::<CompoundAtom>();
            cost += self.atoms_memory_cost();
            cost
        }

        fn atoms_memory_cost(&self) -> usize {
            let mut cost = 0usize;
            for atom in self.atoms.iter() {
                cost += atom.memory_cost();
            }
            cost
        }
    }
}

pub use ast as AST;

// ───────────────────────────── Parser ─────────────────────────────

pub struct Parser<'bump> {
    pub strpool: &'bump [u8],
    pub tokens: &'bump [Token],
    pub alloc: &'bump Bump,
    pub jsobjs: &'bump mut [JSValue],
    pub current: u32,
    pub errors: bumpalo::collections::Vec<'bump, ParserError<'bump>>,
    pub inside_subshell: Option<SubshellKind>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SubshellKind {
    CmdSubst,
    Normal,
}

impl SubshellKind {
    pub fn closing_tok(self) -> TokenTag {
        match self {
            SubshellKind::CmdSubst => TokenTag::CmdSubstEnd,
            SubshellKind::Normal => TokenTag::CloseParen,
        }
    }
}

// FIXME error location
pub struct ParserError<'bump> {
    pub msg: &'bump [u8],
}

type ParseResult<T> = Result<T, bun_core::Error>;
// TODO(port): narrow error set — Zig uses inferred error sets that include ParseError + OOM.

impl<'bump> Parser<'bump> {
    pub fn new(
        bump: &'bump Bump,
        lex_result: LexResult<'bump>,
        jsobjs: &'bump mut [JSValue],
    ) -> ParseResult<Parser<'bump>> {
        Ok(Parser {
            strpool: lex_result.strpool,
            tokens: lex_result.tokens,
            alloc: bump,
            jsobjs,
            current: 0,
            errors: bumpalo::collections::Vec::new_in(bump),
            inside_subshell: None,
        })
    }

    /// __WARNING__:
    /// If you make a subparser and call some fallible functions on it, you need to catch the errors
    /// and call `.continue_from_subparser()`, otherwise errors will not propagate upwards to the parent.
    pub fn make_subparser(&mut self, kind: SubshellKind) -> Parser<'bump> {
        // PORT NOTE: reshaped for borrowck — Zig copies `self.errors` (the ArrayList struct) into
        // the subparser by value, then writes it back in continue_from_subparser. We move it out
        // via mem::take and restore it later.
        Parser {
            strpool: self.strpool,
            tokens: self.tokens,
            alloc: self.alloc,
            jsobjs: unsafe { core::slice::from_raw_parts_mut(self.jsobjs.as_mut_ptr(), self.jsobjs.len()) },
            // TODO(port): borrowck — jsobjs is shared between parent/sub; raw reborrow.
            current: self.current,
            errors: core::mem::replace(
                &mut self.errors,
                bumpalo::collections::Vec::new_in(self.alloc),
            ),
            inside_subshell: Some(kind),
        }
    }

    pub fn continue_from_subparser(&mut self, subparser: &mut Parser<'bump>) {
        self.current = if subparser.current as usize >= self.tokens.len() {
            subparser.current
        } else {
            subparser.current + 1
        };
        self.errors = core::mem::replace(
            &mut subparser.errors,
            bumpalo::collections::Vec::new_in(self.alloc),
        );
    }

    /// Main parse function
    ///
    /// Loosely based on the shell grammar documented in the spec:
    /// https://pubs.opengroup.org/onlinepubs/009604499/utilities/xcu_chap02.html#tag_02_10
    pub fn parse(&mut self) -> ParseResult<ast::Script<'bump>> {
        self.parse_impl()
    }

    pub fn parse_impl(&mut self) -> ParseResult<ast::Script<'bump>> {
        let mut stmts = bumpalo::collections::Vec::new_in(self.alloc);
        if self.tokens.is_empty()
            || (self.tokens.len() == 1 && matches!(self.tokens[0], Token::Eof))
        {
            return Ok(ast::Script { stmts: stmts.into_bump_slice() });
        }

        while if self.inside_subshell.is_none() {
            !self.r#match(TokenTag::Eof)
        } else {
            !self.match_any(&[TokenTag::Eof, self.inside_subshell.unwrap().closing_tok()])
        } {
            self.skip_newlines();
            stmts.push(self.parse_stmt()?);
            self.skip_newlines();
        }
        if let Some(kind) = self.inside_subshell {
            let _ = self.expect_any(&[TokenTag::Eof, kind.closing_tok()]);
        } else {
            let _ = self.expect(TokenTag::Eof);
        }
        Ok(ast::Script { stmts: stmts.into_bump_slice() })
    }

    pub fn parse_stmt(&mut self) -> ParseResult<ast::Stmt<'bump>> {
        let mut exprs = bumpalo::collections::Vec::new_in(self.alloc);

        while if self.inside_subshell.is_none() {
            !self.match_any_comptime(&[TokenTag::Semicolon, TokenTag::Newline, TokenTag::Eof])
        } else {
            !self.match_any(&[
                TokenTag::Semicolon,
                TokenTag::Newline,
                TokenTag::Eof,
                self.inside_subshell.unwrap().closing_tok(),
            ])
        } {
            let expr = self.parse_expr()?;
            if self.r#match(TokenTag::Ampersand) {
                self.add_error(format_args!(
                    "Background commands \"&\" are not supported yet."
                ))?;
                return Err(ParseError::Unsupported.into());
                // (large block of commented-out async-handling code in Zig — omitted)
            }
            exprs.push(expr);
        }

        Ok(ast::Stmt { exprs: exprs.into_bump_slice() })
    }

    fn parse_expr(&mut self) -> ParseResult<ast::Expr<'bump>> {
        self.parse_binary()
    }

    fn parse_binary(&mut self) -> ParseResult<ast::Expr<'bump>> {
        let mut left = self.parse_pipeline()?;
        while self.match_any_comptime(&[TokenTag::DoubleAmpersand, TokenTag::DoublePipe]) {
            let op: ast::BinaryOp = {
                let previous = self.prev().tag();
                match previous {
                    TokenTag::DoubleAmpersand => ast::BinaryOp::And,
                    TokenTag::DoublePipe => ast::BinaryOp::Or,
                    _ => unreachable!(),
                }
            };

            let right = self.parse_pipeline()?;

            let binary = self.allocate(ast::Binary { op, left, right });
            left = ast::Expr::Binary(binary);
        }

        Ok(left)
    }

    fn parse_pipeline(&mut self) -> ParseResult<ast::Expr<'bump>> {
        let mut expr = self.parse_compound_cmd()?;

        if self.peek().tag() == TokenTag::Pipe {
            let mut pipeline_items = bumpalo::collections::Vec::new_in(self.alloc);
            let item = match expr.as_pipeline_item() {
                Some(i) => i,
                None => {
                    self.add_error_expected_pipeline_item(expr.tag())?;
                    return Err(ParseError::Expected.into());
                }
            };
            pipeline_items.push(item);

            while self.r#match(TokenTag::Pipe) {
                expr = self.parse_compound_cmd()?;
                let item = match expr.as_pipeline_item() {
                    Some(i) => i,
                    None => {
                        self.add_error_expected_pipeline_item(expr.tag())?;
                        return Err(ParseError::Expected.into());
                    }
                };
                pipeline_items.push(item);
            }
            let pipeline = self.allocate(ast::Pipeline {
                items: pipeline_items.into_bump_slice(),
            });
            return Ok(ast::Expr::Pipeline(pipeline));
        }

        Ok(expr)
    }

    fn extract_if_clause_text_token(if_clause_token: IfClauseTok) -> &'static [u8] {
        match if_clause_token {
            IfClauseTok::If => b"if",
            IfClauseTok::Else => b"else",
            IfClauseTok::Elif => b"elif",
            IfClauseTok::Then => b"then",
            IfClauseTok::Fi => b"fi",
        }
    }

    fn expect_if_clause_text_token(&mut self, if_clause_token: IfClauseTok) -> Token {
        let tagname = Self::extract_if_clause_text_token(if_clause_token);
        if cfg!(debug_assertions) {
            debug_assert!(self.peek().tag() == TokenTag::Text);
        }
        if let Token::Text(range) = self.peek() {
            if self.delimits(self.peek_n(1)) && self.text(range) == tagname {
                let tok = self.advance();
                let _ = self.expect_delimit();
                return tok;
            }
        }
        panic!("Expected: {}", bstr::BStr::new(tagname));
    }

    fn is_if_clause_text_token(&mut self, if_clause_token: IfClauseTok) -> bool {
        match self.peek() {
            Token::Text(range) => self.is_if_clause_text_token_impl(range, if_clause_token),
            _ => false,
        }
    }

    fn is_if_clause_text_token_impl(
        &self,
        range: TextRange,
        if_clause_token: IfClauseTok,
    ) -> bool {
        let tagname = Self::extract_if_clause_text_token(if_clause_token);
        self.text(range) == tagname
    }

    fn skip_newlines(&mut self) {
        while self.r#match(TokenTag::Newline) {}
    }

    fn parse_compound_cmd(&mut self) -> ParseResult<ast::Expr<'bump>> {
        // Placeholder for when we fully support subshells
        if self.peek().tag() == TokenTag::OpenParen {
            let subshell = self.parse_subshell()?;
            if !subshell.redirect_flags.is_empty() {
                self.add_error(format_args!(
                    "Subshells with redirections are currently not supported. Please open a GitHub issue."
                ))?;
                return Err(ParseError::Unsupported.into());
            }

            return Ok(ast::Expr::Subshell(self.allocate(subshell)));
        }

        if self.is_if_clause_text_token(IfClauseTok::If) {
            return self.parse_if_clause()?.to_expr(self.alloc).map_err(Into::into);
        }

        match self.peek().tag() {
            TokenTag::DoubleBracketOpen => {
                return self.parse_cond_expr()?.to_expr(self.alloc).map_err(Into::into);
            }
            _ => {}
        }

        self.parse_simple_cmd()?.to_expr(self.alloc).map_err(Into::into)
    }

    fn parse_subshell(&mut self) -> ParseResult<ast::Subshell<'bump>> {
        let _ = self.expect(TokenTag::OpenParen);
        let mut subparser = self.make_subparser(SubshellKind::Normal);
        let script = match subparser.parse_impl() {
            Ok(s) => s,
            Err(e) => {
                self.continue_from_subparser(&mut subparser);
                return Err(e);
            }
        };
        self.continue_from_subparser(&mut subparser);
        let parsed_redirect = self.parse_redirect()?;

        Ok(ast::Subshell {
            script,
            redirect: parsed_redirect.redirect,
            redirect_flags: parsed_redirect.flags,
        })
    }

    fn parse_cond_expr(&mut self) -> ParseResult<ast::CondExpr<'bump>> {
        let _ = self.expect(TokenTag::DoubleBracketOpen);

        // Quick check to see if it's a single operand operator
        // Operators are not allowed to be expanded (i.e. `FOO=-f; [[ $FOO package.json ]]` won't work)
        // So it must be a .Text token
        // Also, all single operand operators start with "-", so check it starts with "-".
        if let Token::Text(range) = self.peek() {
            let txt = self.text(range);

            if txt[0] == b'-' {
                // Is a potential single arg op
                for &(name, op) in ast::CondExprOp::SINGLE_ARG_OPS {
                    if txt == name.as_bytes() {
                        let is_supported = ast::CondExprOp::is_supported(op);
                        if !is_supported {
                            self.add_error(format_args!(
                                "Conditional expression operation: {}, is not supported right now. Please open a GitHub issue if you would like it to be supported.",
                                name
                            ))?;
                            return Err(ParseError::Unsupported.into());
                        }

                        let _ = self.expect(TokenTag::Text);
                        if !self.r#match(TokenTag::Delimit) {
                            self.add_error(format_args!("Expected a single, simple word"))?;
                            return Err(ParseError::Expected.into());
                        }

                        let arg = match self.parse_atom()? {
                            Some(a) => a,
                            None => {
                                self.add_error(format_args!(
                                    "Expected a word, but got: {}",
                                    bstr::BStr::new(self.peek().as_human_readable(self.strpool))
                                ))?;
                                return Err(ParseError::Expected.into());
                            }
                        };

                        if !self.r#match(TokenTag::DoubleBracketClose) {
                            self.add_error(format_args!(
                                "Expected \"]]\" but got: {}",
                                bstr::BStr::new(self.peek().as_human_readable(self.strpool))
                            ))?;
                            return Err(ParseError::Expected.into());
                        }

                        return Ok(ast::CondExpr {
                            op,
                            args: ast::CondExprArgList::init_with(arg),
                        });
                    }
                }

                self.add_error(format_args!(
                    "Unknown conditional expression operation: {}",
                    bstr::BStr::new(txt)
                ))?;
                return Err(ParseError::Unknown.into());
            }
        }

        // Otherwise check binary operators like:
        //     arg1 -eq arg2
        // Again the token associated with the operator (in this case `-eq`) *must* be a .Text token.

        let arg1 = match self.parse_atom()? {
            Some(a) => a,
            None => {
                self.add_error(format_args!(
                    "Expected a conditional expression operand, but got: {}",
                    bstr::BStr::new(self.peek().as_human_readable(self.strpool))
                ))?;
                return Err(ParseError::Expected.into());
            }
        };

        // Operator must be a regular text token
        if self.peek().tag() != TokenTag::Text {
            self.add_error(format_args!(
                "Expected a conditional expression operator, but got: {}",
                bstr::BStr::new(self.peek().as_human_readable(self.strpool))
            ))?;
            return Err(ParseError::Expected.into());
        }

        let op_tok = self.expect(TokenTag::Text);
        if !self.r#match(TokenTag::Delimit) {
            self.add_error(format_args!("Expected a single, simple word"))?;
            return Err(ParseError::Expected.into());
        }
        let Token::Text(range) = op_tok else { unreachable!() };
        let txt = self.text(range);

        for &(name, op) in ast::CondExprOp::BINARY_OPS {
            if txt == name.as_bytes() {
                let is_supported = ast::CondExprOp::is_supported(op);
                if !is_supported {
                    self.add_error(format_args!(
                        "Conditional expression operation: {}, is not supported right now. Please open a GitHub issue if you would like it to be supported.",
                        name
                    ))?;
                    return Err(ParseError::Unsupported.into());
                }

                let arg2 = match self.parse_atom()? {
                    Some(a) => a,
                    None => {
                        self.add_error(format_args!(
                            "Expected a word, but got: {}",
                            bstr::BStr::new(self.peek().as_human_readable(self.strpool))
                        ))?;
                        return Err(ParseError::Expected.into());
                    }
                };

                if !self.r#match(TokenTag::DoubleBracketClose) {
                    self.add_error(format_args!(
                        "Expected \"]]\" but got: {}",
                        bstr::BStr::new(self.peek().as_human_readable(self.strpool))
                    ))?;
                    return Err(ParseError::Expected.into());
                }

                return Ok(ast::CondExpr {
                    op,
                    args: ast::CondExprArgList::init_with_slice(&[arg1, arg2]),
                });
            }
        }

        self.add_error(format_args!(
            "Unknown conditional expression operation: {}",
            bstr::BStr::new(txt)
        ))?;
        Err(ParseError::Unknown.into())
    }

    fn parse_if_body(
        &mut self,
        until: &[IfClauseTok],
    ) -> ParseResult<SmolList<ast::Stmt<'bump>, 1>> {
        let mut ret: SmolList<ast::Stmt<'bump>, 1> = SmolList::zeroes();
        while if self.inside_subshell.is_none() {
            !self.peek_any_comptime_ifclausetok(until) && !self.peek_any_comptime(&[TokenTag::Eof])
        } else {
            !self.peek_any_ifclausetok(until)
                && !self.peek_any(&[self.inside_subshell.unwrap().closing_tok(), TokenTag::Eof])
        } {
            self.skip_newlines();
            let stmt = self.parse_stmt()?;
            ret.append(stmt);
            self.skip_newlines();
        }

        Ok(ret)
    }

    fn parse_if_clause(&mut self) -> ParseResult<ast::If<'bump>> {
        let _ = self.expect_if_clause_text_token(IfClauseTok::If);

        let cond = self.parse_if_body(&[IfClauseTok::Then])?;

        if !self.match_if_clausetok(IfClauseTok::Then) {
            self.add_error(format_args!(
                "Expected \"then\" but got: {}",
                <&'static str>::from(self.peek().tag())
            ))?;
            return Err(ParseError::Expected.into());
        }

        let then = self.parse_if_body(&[IfClauseTok::Else, IfClauseTok::Elif, IfClauseTok::Fi])?;

        let mut else_parts: SmolList<SmolList<ast::Stmt<'bump>, 1>, 1> = SmolList::zeroes();

        let if_clause_tok = match IfClauseTok::from_tok(self, self.peek()) {
            Some(t) => t,
            None => {
                self.add_error(format_args!(
                    "Expected \"else\", \"elif\", or \"fi\" but got: {}",
                    <&'static str>::from(self.peek().tag())
                ))?;
                return Err(ParseError::Expected.into());
            }
        };

        match if_clause_tok {
            IfClauseTok::If | IfClauseTok::Then => {
                self.add_error(format_args!(
                    "Expected \"else\", \"elif\", or \"fi\" but got: {}",
                    <&'static str>::from(self.peek().tag())
                ))?;
                Err(ParseError::Expected.into())
            }
            IfClauseTok::Else => {
                let _ = self.expect_if_clause_text_token(IfClauseTok::Else);
                let else_ = self.parse_if_body(&[IfClauseTok::Fi])?;
                if !self.match_if_clausetok(IfClauseTok::Fi) {
                    self.add_error(format_args!(
                        "Expected \"fi\" but got: {}",
                        <&'static str>::from(self.peek().tag())
                    ))?;
                    return Err(ParseError::Expected.into());
                }
                else_parts.append(else_);
                Ok(ast::If { cond, then, else_parts })
            }
            IfClauseTok::Elif => {
                loop {
                    let _ = self.expect_if_clause_text_token(IfClauseTok::Elif);
                    let elif_cond = self.parse_if_body(&[IfClauseTok::Then])?;
                    if !self.match_if_clausetok(IfClauseTok::Then) {
                        self.add_error(format_args!(
                            "Expected \"then\" but got: {}",
                            <&'static str>::from(self.peek().tag())
                        ))?;
                        return Err(ParseError::Expected.into());
                    }
                    let then_part = self.parse_if_body(&[
                        IfClauseTok::Elif,
                        IfClauseTok::Else,
                        IfClauseTok::Fi,
                    ])?;
                    else_parts.append(elif_cond);
                    else_parts.append(then_part);

                    match IfClauseTok::from_tok(self, self.peek()) {
                        None => break,
                        Some(IfClauseTok::Elif) => continue,
                        Some(IfClauseTok::Else) => {
                            let _ = self.expect_if_clause_text_token(IfClauseTok::Else);
                            let else_part = self.parse_if_body(&[IfClauseTok::Fi])?;
                            else_parts.append(else_part);
                            break;
                        }
                        Some(_) => break,
                    }
                }
                if !self.match_if_clausetok(IfClauseTok::Fi) {
                    self.add_error(format_args!(
                        "Expected \"fi\" but got: {}",
                        <&'static str>::from(self.peek().tag())
                    ))?;
                    return Err(ParseError::Expected.into());
                }
                Ok(ast::If { cond, then, else_parts })
            }
            IfClauseTok::Fi => {
                let _ = self.expect_if_clause_text_token(IfClauseTok::Fi);
                Ok(ast::If { cond, then, else_parts: SmolList::zeroes() })
            }
        }
    }

    fn parse_simple_cmd(&mut self) -> ParseResult<ast::CmdOrAssigns<'bump>> {
        let mut assigns = bumpalo::collections::Vec::new_in(self.alloc);
        while if self.inside_subshell.is_none() {
            !self.check_any_comptime(&[TokenTag::Semicolon, TokenTag::Newline, TokenTag::Eof])
        } else {
            !self.check_any(&[
                TokenTag::Semicolon,
                TokenTag::Newline,
                TokenTag::Eof,
                self.inside_subshell.unwrap().closing_tok(),
            ])
        } {
            if let Some(assign) = self.parse_assign()? {
                assigns.push(assign);
            } else {
                break;
            }
        }

        let at_end = if self.inside_subshell.is_none() {
            self.check_any_comptime(&[TokenTag::Semicolon, TokenTag::Newline, TokenTag::Eof])
        } else {
            self.check_any(&[
                TokenTag::Semicolon,
                TokenTag::Newline,
                TokenTag::Eof,
                self.inside_subshell.unwrap().closing_tok(),
            ])
        };
        if at_end {
            if assigns.is_empty() {
                self.add_error(format_args!("expected a command or assignment"))?;
                return Err(ParseError::Expected.into());
            }
            return Ok(ast::CmdOrAssigns::Assigns(assigns.into_bump_slice()));
        }

        let name = match self.parse_atom()? {
            Some(n) => n,
            None => {
                if assigns.is_empty() {
                    self.add_error(format_args!(
                        "expected a command or assignment but got: \"{}\"",
                        <&'static str>::from(self.peek().tag())
                    ))?;
                    return Err(ParseError::Expected.into());
                }
                return Ok(ast::CmdOrAssigns::Assigns(assigns.into_bump_slice()));
            }
        };

        let mut name_and_args = bumpalo::collections::Vec::new_in(self.alloc);
        name_and_args.push(name);
        while let Some(arg) = self.parse_atom()? {
            name_and_args.push(arg);
        }
        let parsed_redirect = self.parse_redirect()?;

        Ok(ast::CmdOrAssigns::Cmd(ast::Cmd {
            assigns: assigns.into_bump_slice(),
            name_and_args: name_and_args.into_bump_slice(),
            redirect_file: parsed_redirect.redirect,
            redirect: parsed_redirect.flags,
        }))
    }

    fn parse_redirect(&mut self) -> ParseResult<ParsedRedirect<'bump>> {
        let has_redirect = self.r#match(TokenTag::Redirect);
        let redirect = if has_redirect {
            let Token::Redirect(r) = self.prev() else { unreachable!() };
            r
        } else {
            ast::RedirectFlags::default()
        };
        let redirect_file: Option<ast::Redirect<'bump>> = 'redirect_file: {
            if has_redirect {
                if self.r#match(TokenTag::JSObjRef) {
                    let Token::JSObjRef(obj_ref) = self.prev() else { unreachable!() };
                    break 'redirect_file Some(ast::Redirect::JsBuf(ast::JSBuf::new(obj_ref)));
                }

                let file = match self.parse_atom()? {
                    Some(f) => f,
                    None => {
                        if redirect.duplicate_out() {
                            break 'redirect_file None;
                        }
                        self.add_error(format_args!("Redirection with no file"))?;
                        return Err(ParseError::Expected.into());
                    }
                };
                break 'redirect_file Some(ast::Redirect::Atom(file));
            }
            None
        };
        // TODO check for multiple redirects and error
        Ok(ParsedRedirect { flags: redirect, redirect: redirect_file })
    }

    /// Try to parse an assignment. If no assignment could be parsed then return
    /// None and backtrack the parser state
    fn parse_assign(&mut self) -> ParseResult<Option<ast::Assign<'bump>>> {
        match self.peek() {
            Token::Text(txtrng) => {
                let start_idx = self.current;
                let _ = self.expect(TokenTag::Text);
                let txt = self.text(txtrng);
                let var_decl: Option<ast::Assign<'bump>> = 'var_decl: {
                    if let Some(eq_idx) = has_eq_sign(txt) {
                        // If it starts with = then it's not valid assignment (e.g. `=FOO`)
                        if eq_idx == 0 {
                            break 'var_decl None;
                        }
                        let label = &txt[..eq_idx as usize];
                        if !is_valid_var_name(label) {
                            break 'var_decl None;
                        }

                        if eq_idx as usize == txt.len() - 1 {
                            if self.delimits(self.peek()) {
                                let _ = self.expect_delimit();
                                break 'var_decl Some(ast::Assign {
                                    label,
                                    value: ast::Atom::Simple(ast::SimpleAtom::Text(b"")),
                                });
                            }
                            let atom = match self.parse_atom()? {
                                Some(a) => a,
                                None => {
                                    self.add_error(format_args!("Expected an atom"))?;
                                    return Err(ParseError::Expected.into());
                                }
                            };
                            break 'var_decl Some(ast::Assign { label, value: atom });
                        }

                        let txt_value = &txt[eq_idx as usize + 1..];
                        if self.delimits(self.peek()) {
                            let _ = self.expect_delimit();
                            break 'var_decl Some(ast::Assign {
                                label,
                                value: ast::Atom::Simple(ast::SimpleAtom::Text(txt_value)),
                            });
                        }

                        let right = match self.parse_atom()? {
                            Some(a) => a,
                            None => {
                                self.add_error(format_args!("Expected an atom"))?;
                                return Err(ParseError::Expected.into());
                            }
                        };
                        let left = ast::Atom::Simple(ast::SimpleAtom::Text(txt_value));
                        let merged = left.merge(right, self.alloc)?;
                        break 'var_decl Some(ast::Assign { label, value: merged });
                    }
                    None
                };

                if let Some(vd) = var_decl {
                    return Ok(Some(vd));
                }

                // Rollback
                self.current = start_idx;
                Ok(None)
            }
            _ => Ok(None),
        }
    }

    fn parse_atom(&mut self) -> ParseResult<Option<ast::Atom<'bump>>> {
        // PERF(port): was stack-fallback (1 SimpleAtom) — profile in Phase B
        let mut atoms = bumpalo::collections::Vec::with_capacity_in(1, self.alloc);
        let mut has_brace_open = false;
        let mut has_brace_close = false;
        let mut has_comma = false;
        let mut has_glob_syntax = false;
        {
            while match self.peek() {
                Token::Delimit => {
                    let _ = self.expect(TokenTag::Delimit);
                    false
                }
                Token::Eof | Token::Semicolon | Token::Newline => false,
                t => {
                    if self.inside_subshell.is_some()
                        && self.inside_subshell.unwrap().closing_tok() == t.tag()
                    {
                        false
                    } else {
                        true
                    }
                }
            } {
                let next = self.peek_n(1);
                let next_delimits = self.delimits(next);
                let peeked = self.peek();
                let should_break = next_delimits;
                match peeked {
                    Token::Asterisk => {
                        has_glob_syntax = true;
                        let _ = self.expect(TokenTag::Asterisk);
                        atoms.push(ast::SimpleAtom::Asterisk);
                        if next_delimits {
                            let _ = self.r#match(TokenTag::Delimit);
                            break;
                        }
                    }
                    Token::DoubleAsterisk => {
                        has_glob_syntax = true;
                        let _ = self.expect(TokenTag::DoubleAsterisk);
                        atoms.push(ast::SimpleAtom::DoubleAsterisk);
                        if next_delimits {
                            let _ = self.r#match(TokenTag::Delimit);
                            break;
                        }
                    }
                    Token::BraceBegin => {
                        has_brace_open = true;
                        let _ = self.expect(TokenTag::BraceBegin);
                        atoms.push(ast::SimpleAtom::BraceBegin);
                        // TODO in this case we know it can't possibly be the beginning of a brace
                        // expansion so maybe its faster to just change it to text here
                        if next_delimits {
                            let _ = self.r#match(TokenTag::Delimit);
                            if should_break {
                                break;
                            }
                        }
                    }
                    Token::BraceEnd => {
                        has_brace_close = true;
                        let _ = self.expect(TokenTag::BraceEnd);
                        atoms.push(ast::SimpleAtom::BraceEnd);
                        if next_delimits {
                            let _ = self.r#match(TokenTag::Delimit);
                            break;
                        }
                    }
                    Token::Comma => {
                        has_comma = true;
                        let _ = self.expect(TokenTag::Comma);
                        atoms.push(ast::SimpleAtom::Comma);
                        if next_delimits {
                            let _ = self.r#match(TokenTag::Delimit);
                            if should_break {
                                break;
                            }
                        }
                    }
                    Token::CmdSubstBegin => {
                        let _ = self.expect(TokenTag::CmdSubstBegin);
                        let is_quoted = self.r#match(TokenTag::CmdSubstQuoted);
                        let mut subparser = self.make_subparser(SubshellKind::CmdSubst);
                        let script = match subparser.parse_impl() {
                            Ok(s) => s,
                            Err(e) => {
                                self.continue_from_subparser(&mut subparser);
                                return Err(e);
                            }
                        };
                        atoms.push(ast::SimpleAtom::CmdSubst(ast::CmdSubst {
                            script,
                            quoted: is_quoted,
                        }));
                        self.continue_from_subparser(&mut subparser);
                        if self.delimits(self.peek()) {
                            let _ = self.r#match(TokenTag::Delimit);
                            break;
                        }
                    }
                    Token::SingleQuotedText(txtrng)
                    | Token::DoubleQuotedText(txtrng)
                    | Token::Text(txtrng) => {
                        let _ = self.advance();
                        let mut txt = self.text(txtrng);
                        if peeked.tag() == TokenTag::Text && !txt.is_empty() && txt[0] == b'~' {
                            txt = &txt[1..];
                            atoms.push(ast::SimpleAtom::Tilde);
                            if !txt.is_empty() {
                                atoms.push(ast::SimpleAtom::Text(txt));
                            }
                        } else if txt.is_empty()
                            && (peeked.tag() == TokenTag::SingleQuotedText
                                || peeked.tag() == TokenTag::DoubleQuotedText)
                        {
                            // Preserve empty quoted strings ("", '') as explicit empty arguments
                            atoms.push(ast::SimpleAtom::QuotedEmpty);
                        } else {
                            atoms.push(ast::SimpleAtom::Text(txt));
                        }
                        if next_delimits {
                            let _ = self.r#match(TokenTag::Delimit);
                            if should_break {
                                break;
                            }
                        }
                    }
                    Token::Var(txtrng) => {
                        let _ = self.expect(TokenTag::Var);
                        let txt = self.text(txtrng);
                        atoms.push(ast::SimpleAtom::Var(txt));
                        if next_delimits {
                            let _ = self.r#match(TokenTag::Delimit);
                            if should_break {
                                break;
                            }
                        }
                    }
                    Token::VarArgv(int) => {
                        let _ = self.expect(TokenTag::VarArgv);
                        atoms.push(ast::SimpleAtom::VarArgv(int));
                        if next_delimits {
                            let _ = self.r#match(TokenTag::Delimit);
                            if should_break {
                                break;
                            }
                        }
                    }
                    Token::OpenParen | Token::CloseParen => {
                        self.add_error(format_args!(
                            "Unexpected token: `{}`",
                            if peeked.tag() == TokenTag::OpenParen { "(" } else { ")" }
                        ))?;
                        return Err(ParseError::Unexpected.into());
                    }
                    Token::Pipe
                    | Token::DoublePipe
                    | Token::Ampersand
                    | Token::DoubleAmpersand
                    | Token::Redirect(_)
                    | Token::Dollar
                    | Token::Eq
                    | Token::Semicolon
                    | Token::Newline
                    | Token::CmdSubstQuoted
                    | Token::CmdSubstEnd
                    | Token::JSObjRef(_)
                    | Token::Delimit
                    | Token::Eof
                    | Token::DoubleBracketOpen
                    | Token::DoubleBracketClose => return Ok(None),
                }
            }
        }

        Ok(match atoms.len() {
            0 => None,
            1 => {
                debug_assert!(atoms.capacity() == 1);
                Some(ast::Atom::new_simple(atoms.into_iter().next().unwrap()))
            }
            _ => Some(ast::Atom::Compound(ast::CompoundAtom {
                atoms: atoms.into_bump_slice(),
                brace_expansion_hint: has_brace_open && has_brace_close && has_comma,
                glob_hint: has_glob_syntax,
            })),
        })
    }

    fn allocate<T>(&self, val: T) -> &'bump mut T {
        self.alloc.alloc(val)
    }

    fn text(&self, range: TextRange) -> &'bump [u8] {
        &self.strpool[range.start as usize..range.end as usize]
    }

    fn advance(&mut self) -> Token {
        if !self.is_at_end() {
            self.current += 1;
        }
        self.prev()
    }

    fn is_at_end(&self) -> bool {
        self.peek().tag() == TokenTag::Eof
            || (self.inside_subshell.is_some()
                && self.inside_subshell.unwrap().closing_tok() == self.peek().tag())
    }

    fn expect(&mut self, toktag: TokenTag) -> Token {
        debug_assert!(toktag == self.peek().tag());
        if self.check(toktag) {
            return self.advance();
        }
        panic!("Unexpected token");
    }

    fn expect_any(&mut self, toktags: &[TokenTag]) -> Token {
        let peeked = self.peek();
        for &toktag in toktags {
            if toktag == peeked.tag() {
                return self.advance();
            }
        }
        panic!("Unexpected token");
    }

    fn delimits(&self, tok: Token) -> bool {
        let tag = tok.tag();
        tag == TokenTag::Delimit
            || tag == TokenTag::Semicolon
            || tag == TokenTag::Semicolon
            || tag == TokenTag::Eof
            || tag == TokenTag::Newline
            || (self.inside_subshell.is_some()
                && tag == self.inside_subshell.unwrap().closing_tok())
    }

    fn expect_delimit(&mut self) -> Token {
        debug_assert!(self.delimits(self.peek()));
        if self.check(TokenTag::Delimit)
            || self.check(TokenTag::Semicolon)
            || self.check(TokenTag::Newline)
            || self.check(TokenTag::Eof)
            || (self.inside_subshell.is_some()
                && self.check(self.inside_subshell.unwrap().closing_tok()))
        {
            return self.advance();
        }
        panic!("Expected a delimiter token");
    }

    fn match_if_clausetok(&mut self, toktag: IfClauseTok) -> bool {
        if let Token::Text(range) = self.peek() {
            if self.delimits(self.peek_n(1))
                && self.text(range) == <&'static str>::from(toktag).as_bytes()
            {
                let _ = self.advance();
                let _ = self.expect_delimit();
                return true;
            }
        }
        false
    }

    /// Consumes token if it matches
    fn r#match(&mut self, toktag: TokenTag) -> bool {
        if self.peek().tag() == toktag {
            let _ = self.advance();
            return true;
        }
        false
    }

    fn match_any_comptime(&mut self, toktags: &[TokenTag]) -> bool {
        // PERF(port): was comptime monomorphization — profile in Phase B
        let peeked = self.peek().tag();
        for &tag in toktags {
            if peeked == tag {
                let _ = self.advance();
                return true;
            }
        }
        false
    }

    fn match_any(&mut self, toktags: &[TokenTag]) -> bool {
        let peeked = self.peek().tag();
        for &tag in toktags {
            if peeked == tag {
                let _ = self.advance();
                return true;
            }
        }
        false
    }

    fn peek_any_ifclausetok(&self, toktags: &[IfClauseTok]) -> bool {
        let peektok = self.peek();
        let Token::Text(range) = peektok else { return false };
        let txt = self.text(range);
        for &tag in toktags {
            if txt == <&'static str>::from(tag).as_bytes() {
                return true;
            }
        }
        false
    }

    fn peek_any_comptime_ifclausetok(&self, toktags: &[IfClauseTok]) -> bool {
        // PERF(port): was comptime monomorphization — profile in Phase B
        self.peek_any_ifclausetok(toktags)
    }

    fn peek_any_comptime(&self, toktags: &[TokenTag]) -> bool {
        let peeked = self.peek().tag();
        for &tag in toktags {
            if peeked == tag {
                return true;
            }
        }
        false
    }

    fn peek_any(&self, toktags: &[TokenTag]) -> bool {
        self.peek_any_comptime(toktags)
    }

    fn check_any_comptime(&self, toktags: &[TokenTag]) -> bool {
        self.peek_any_comptime(toktags)
    }

    fn check_any(&self, toktags: &[TokenTag]) -> bool {
        self.peek_any(toktags)
    }

    fn check(&self, toktag: TokenTag) -> bool {
        self.peek().tag() == toktag
    }

    fn peek(&self) -> Token {
        self.tokens[self.current as usize]
    }

    fn peek_n(&self, n: u32) -> Token {
        if (self.current + n) as usize >= self.tokens.len() {
            return self.tokens[self.tokens.len() - 1];
        }
        self.tokens[(self.current + n) as usize]
    }

    fn prev(&self) -> Token {
        self.tokens[self.current as usize - 1]
    }

    pub fn combine_errors(&self) -> &'bump [u8] {
        let errors = &self.errors[..];
        let str = {
            let size = {
                let mut i = 0usize;
                for e in errors {
                    i += e.msg.len();
                }
                i
            };
            let buf = self.alloc.alloc_slice_fill_copy(size, 0u8);
            let mut i = 0usize;
            for e in errors {
                buf[i..i + e.msg.len()].copy_from_slice(e.msg);
                i += e.msg.len();
            }
            buf
        };
        str
    }

    fn add_error(&mut self, args: fmt::Arguments<'_>) -> ParseResult<()> {
        let mut v = bumpalo::collections::Vec::new_in(self.alloc);
        write!(&mut v, "{}", args)?;
        let msg = v.into_bump_slice();
        self.errors.push(ParserError { msg });
        Ok(())
    }

    fn add_error_expected_pipeline_item(&mut self, kind: ast::ExprTag) -> ParseResult<()> {
        self.add_error(format_args!(
            "Expected a command, assignment, or subshell but got: {}",
            <&'static str>::from(kind)
        ))
    }
}

#[derive(Default)]
struct ParsedRedirect<'bump> {
    flags: ast::RedirectFlags,
    redirect: Option<ast::Redirect<'bump>>,
}

/// We make it so that `if`/`else`/`elif`/`then`/`fi` need to be single,
/// simple .Text tokens (so the whitespace logic remains the same).
/// This is used to convert them
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum IfClauseTok {
    #[strum(serialize = "if")]
    If,
    #[strum(serialize = "else")]
    Else,
    #[strum(serialize = "elif")]
    Elif,
    #[strum(serialize = "then")]
    Then,
    #[strum(serialize = "fi")]
    Fi,
}

impl IfClauseTok {
    pub fn from_tok(p: &Parser<'_>, tok: Token) -> Option<IfClauseTok> {
        match tok {
            Token::Text(range) => Self::from_text(p.text(range)),
            _ => None,
        }
    }

    pub fn from_text(txt: &[u8]) -> Option<IfClauseTok> {
        if txt == b"if" { return Some(IfClauseTok::If); }
        if txt == b"else" { return Some(IfClauseTok::Else); }
        if txt == b"elif" { return Some(IfClauseTok::Elif); }
        if txt == b"then" { return Some(IfClauseTok::Then); }
        if txt == b"fi" { return Some(IfClauseTok::Fi); }
        None
    }
}

// ───────────────────────────── Token ─────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum TokenTag {
    Pipe,
    DoublePipe,
    Ampersand,
    DoubleAmpersand,
    Redirect,
    Dollar,
    Asterisk,
    DoubleAsterisk,
    Eq,
    Semicolon,
    Newline,
    BraceBegin,
    Comma,
    BraceEnd,
    CmdSubstBegin,
    CmdSubstQuoted,
    CmdSubstEnd,
    OpenParen,
    CloseParen,
    Var,
    VarArgv,
    Text,
    SingleQuotedText,
    DoubleQuotedText,
    JSObjRef,
    DoubleBracketOpen,
    DoubleBracketClose,
    Delimit,
    Eof,
}

#[derive(Clone, Copy)]
pub enum Token {
    /// |
    Pipe,
    /// ||
    DoublePipe,
    /// &
    Ampersand,
    /// &&
    DoubleAmpersand,

    Redirect(ast::RedirectFlags),

    /// $
    Dollar,
    /// `*`
    Asterisk,
    DoubleAsterisk,

    /// =
    Eq,
    /// ;
    Semicolon,
    /// \n (unescaped newline)
    Newline,

    BraceBegin,
    Comma,
    BraceEnd,
    CmdSubstBegin,
    /// When cmd subst is wrapped in quotes, then it should be interpreted as literal string, not
    /// word split-ed arguments to a cmd. We lose quotation context in the AST, so we don't know
    /// how to disambiguate that. So this is a quick hack to give the AST that context.
    ///
    /// This matches this shell behaviour:
    /// echo test$(echo "1    2") -> test1 2\n
    /// echo "test$(echo "1    2")" -> test1    2\n
    CmdSubstQuoted,
    CmdSubstEnd,
    OpenParen,
    CloseParen,

    Var(TextRange),
    VarArgv(u8),
    Text(TextRange),
    /// Quotation information is lost from the lexer -> parser stage and it is
    /// helpful to disambiguate from regular text and quoted text
    SingleQuotedText(TextRange),
    DoubleQuotedText(TextRange),
    JSObjRef(u32),

    DoubleBracketOpen,
    DoubleBracketClose,

    Delimit,
    Eof,
}

#[derive(Clone, Copy)]
pub struct TextRange {
    pub start: u32,
    pub end: u32,
}

impl TextRange {
    pub fn len(self) -> u32 {
        debug_assert!(self.start <= self.end);
        self.end - self.start
    }

    pub fn slice(self, buf: &[u8]) -> &[u8] {
        &buf[self.start as usize..self.end as usize]
    }
}

impl Token {
    pub fn tag(self) -> TokenTag {
        match self {
            Token::Pipe => TokenTag::Pipe,
            Token::DoublePipe => TokenTag::DoublePipe,
            Token::Ampersand => TokenTag::Ampersand,
            Token::DoubleAmpersand => TokenTag::DoubleAmpersand,
            Token::Redirect(_) => TokenTag::Redirect,
            Token::Dollar => TokenTag::Dollar,
            Token::Asterisk => TokenTag::Asterisk,
            Token::DoubleAsterisk => TokenTag::DoubleAsterisk,
            Token::Eq => TokenTag::Eq,
            Token::Semicolon => TokenTag::Semicolon,
            Token::Newline => TokenTag::Newline,
            Token::BraceBegin => TokenTag::BraceBegin,
            Token::Comma => TokenTag::Comma,
            Token::BraceEnd => TokenTag::BraceEnd,
            Token::CmdSubstBegin => TokenTag::CmdSubstBegin,
            Token::CmdSubstQuoted => TokenTag::CmdSubstQuoted,
            Token::CmdSubstEnd => TokenTag::CmdSubstEnd,
            Token::OpenParen => TokenTag::OpenParen,
            Token::CloseParen => TokenTag::CloseParen,
            Token::Var(_) => TokenTag::Var,
            Token::VarArgv(_) => TokenTag::VarArgv,
            Token::Text(_) => TokenTag::Text,
            Token::SingleQuotedText(_) => TokenTag::SingleQuotedText,
            Token::DoubleQuotedText(_) => TokenTag::DoubleQuotedText,
            Token::JSObjRef(_) => TokenTag::JSObjRef,
            Token::DoubleBracketOpen => TokenTag::DoubleBracketOpen,
            Token::DoubleBracketClose => TokenTag::DoubleBracketClose,
            Token::Delimit => TokenTag::Delimit,
            Token::Eof => TokenTag::Eof,
        }
    }

    pub fn as_human_readable(self, strpool: &[u8]) -> &[u8] {
        // TODO(port): Zig builds varargv_strings as a 10x[2]u8 stack array; in Rust we'd need
        // a thread_local or to return Cow. For Phase A use static lookup.
        const VARARGV_STRINGS: [&[u8]; 10] = [
            b"$0", b"$1", b"$2", b"$3", b"$4", b"$5", b"$6", b"$7", b"$8", b"$9",
        ];
        match self {
            Token::Pipe => b"`|`",
            Token::DoublePipe => b"`||`",
            Token::Ampersand => b"`&`",
            Token::DoubleAmpersand => b"`&&`",
            Token::Redirect(_) => b"`>`",
            Token::Dollar => b"`$`",
            Token::Asterisk => b"`*`",
            Token::DoubleAsterisk => b"`**`",
            Token::Eq => b"`=`",
            Token::Semicolon => b"`;`",
            Token::Newline => b"`\\n`",
            Token::BraceBegin => b"`{`",
            Token::Comma => b"`,`",
            Token::BraceEnd => b"`}`",
            Token::CmdSubstBegin => b"`$(`",
            Token::CmdSubstQuoted => b"CmdSubstQuoted",
            Token::CmdSubstEnd => b"`)`",
            Token::OpenParen => b"`(`",
            Token::CloseParen => b"`)",
            Token::Var(r) => &strpool[r.start as usize..r.end as usize],
            Token::VarArgv(n) => VARARGV_STRINGS[n as usize],
            Token::Text(r) => &strpool[r.start as usize..r.end as usize],
            Token::SingleQuotedText(r) => &strpool[r.start as usize..r.end as usize],
            Token::DoubleQuotedText(r) => &strpool[r.start as usize..r.end as usize],
            Token::JSObjRef(_) => b"JSObjRef",
            Token::DoubleBracketOpen => b"[[",
            Token::DoubleBracketClose => b"]]",
            Token::Delimit => b"Delimit",
            Token::Eof => b"EOF",
        }
    }
}

// ───────────────────────────── Lexer ─────────────────────────────

pub type LexerAscii<'bump> = Lexer<'bump, { StringEncoding::Ascii }>;
pub type LexerUnicode<'bump> = Lexer<'bump, { StringEncoding::Wtf8 }>;

pub struct LexResult<'bump> {
    pub errors: &'bump mut [LexError],
    pub tokens: &'bump [Token],
    pub strpool: &'bump [u8],
}

impl<'bump> LexResult<'bump> {
    pub fn combine_errors(&self, bump: &'bump Bump) -> &'bump [u8] {
        let errors = &self.errors[..];
        let str = {
            let size = {
                let mut i = 0usize;
                for e in errors {
                    i += e.msg.len() as usize;
                }
                i
            };
            let buf = bump.alloc_slice_fill_copy(size, 0u8);
            let mut i = 0usize;
            for e in errors {
                let s = e.msg.slice(self.strpool);
                buf[i..i + s.len()].copy_from_slice(s);
                i += s.len();
            }
            buf
        };
        str
    }
}

#[derive(Clone, Copy)]
pub struct LexError {
    /// Allocated with lexer arena
    pub msg: TextRange,
}

/// A special char used to denote the beginning of a special token
/// used for substituting JS variables into the script string.
///
/// \b (decimal value of 8) is deliberately chosen so that it is not
/// easy for the user to accidentally use this char in their script.
const SPECIAL_JS_CHAR: u8 = 8;
pub const LEX_JS_OBJREF_PREFIX: &[u8] = b"\x08__bun_";
pub const LEX_JS_STRING_PREFIX: &[u8] = b"\x08__bunstr_";

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum StringEncoding {
    Ascii,
    Wtf8,
    Utf16,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum LexerError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("Utf8CannotEncodeSurrogateHalf")]
    Utf8CannotEncodeSurrogateHalf,
    #[error("Utf8InvalidStartByte")]
    Utf8InvalidStartByte,
    #[error("CodepointTooLarge")]
    CodepointTooLarge,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SubShellKind {
    /// (echo hi; echo hello)
    Normal,
    /// `echo hi; echo hello`
    Backtick,
    /// $(echo hi; echo hello)
    Dollar,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RedirectDirection {
    Out,
    In,
}

#[derive(Clone, Copy)]
pub struct BacktrackSnapshot<const ENCODING: StringEncoding> {
    chars: ShellCharIter<ENCODING>,
    j: u32,
    word_start: u32,
    delimit_quote: bool,
}

pub struct Lexer<'bump, const ENCODING: StringEncoding> {
    pub chars: ShellCharIter<ENCODING>,

    /// Tell us the beginning of a "word", indexes into the string pool (`buf`)
    /// Anytime a word is added, this needs to be updated
    pub word_start: u32,

    /// Keeps track of the end of a "word", indexes into the string pool (`buf`),
    /// anytime characters are added to the string pool this needs to be updated
    pub j: u32,

    pub strpool: bumpalo::collections::Vec<'bump, u8>,
    pub tokens: bumpalo::collections::Vec<'bump, Token>,
    pub delimit_quote: bool,
    pub in_subshell: Option<SubShellKind>,
    pub errors: bumpalo::collections::Vec<'bump, LexError>,

    /// Contains a list of strings we need to escape
    /// Not owned by this struct
    pub string_refs: &'bump mut [BunString],

    /// Number of JS object references expected (for bounds validation)
    pub jsobjs_len: u32,
}

impl<'bump, const ENCODING: StringEncoding> Lexer<'bump, ENCODING> {
    pub const JS_OBJREF_PREFIX: &'static str = "$__bun_";

    pub fn new(
        bump: &'bump Bump,
        src: &'bump [u8],
        strings_to_escape: &'bump mut [BunString],
        jsobjs_len: u32,
    ) -> Self {
        Self {
            chars: ShellCharIter::<ENCODING>::init(src),
            tokens: bumpalo::collections::Vec::new_in(bump),
            strpool: bumpalo::collections::Vec::new_in(bump),
            errors: bumpalo::collections::Vec::new_in(bump),
            word_start: 0,
            j: 0,
            delimit_quote: false,
            in_subshell: None,
            string_refs: strings_to_escape,
            jsobjs_len,
        }
    }

    pub fn get_result(self) -> LexResult<'bump> {
        LexResult {
            tokens: self.tokens.into_bump_slice(),
            strpool: self.strpool.into_bump_slice(),
            errors: self.errors.into_bump_slice(),
        }
    }

    pub fn add_error(&mut self, msg: &[u8]) {
        let start = self.strpool.len();
        self.strpool.extend_from_slice(msg);
        let end = self.strpool.len();
        self.errors.push(LexError {
            msg: TextRange {
                start: u32::try_from(start).unwrap(),
                end: u32::try_from(end).unwrap(),
            },
        });
    }

    fn make_sublexer(&mut self, kind: SubShellKind) -> Self {
        log!("[lex] make sublexer");
        // PORT NOTE: reshaped for borrowck — Zig copies ArrayLists by value (shared backing buffer
        // until reallocation). In Rust we move them out via mem::take and restore in
        // continue_from_sublexer.
        let bump = self.strpool.bump();
        let mut sublexer = Self {
            chars: self.chars,
            strpool: core::mem::replace(&mut self.strpool, bumpalo::collections::Vec::new_in(bump)),
            tokens: core::mem::replace(&mut self.tokens, bumpalo::collections::Vec::new_in(bump)),
            errors: core::mem::replace(&mut self.errors, bumpalo::collections::Vec::new_in(bump)),
            in_subshell: Some(kind),
            word_start: self.word_start,
            j: self.j,
            delimit_quote: false,
            string_refs: unsafe {
                // SAFETY: parent doesn't use string_refs while sublexer is active; restored after.
                core::slice::from_raw_parts_mut(self.string_refs.as_mut_ptr(), self.string_refs.len())
            },
            jsobjs_len: self.jsobjs_len,
        };
        sublexer.chars.state = CharState::Normal;
        sublexer
    }

    fn continue_from_sublexer(&mut self, sublexer: &mut Self) {
        log!("[lex] drop sublexer");
        let bump = sublexer.strpool.bump();
        self.strpool =
            core::mem::replace(&mut sublexer.strpool, bumpalo::collections::Vec::new_in(bump));
        self.tokens =
            core::mem::replace(&mut sublexer.tokens, bumpalo::collections::Vec::new_in(bump));
        self.errors =
            core::mem::replace(&mut sublexer.errors, bumpalo::collections::Vec::new_in(bump));

        self.chars = sublexer.chars;
        self.word_start = sublexer.word_start;
        self.j = sublexer.j;
        self.delimit_quote = sublexer.delimit_quote;
    }

    fn make_snapshot(&self) -> BacktrackSnapshot<ENCODING> {
        BacktrackSnapshot {
            chars: self.chars,
            j: self.j,
            word_start: self.word_start,
            delimit_quote: self.delimit_quote,
        }
    }

    fn backtrack(&mut self, snap: BacktrackSnapshot<ENCODING>) {
        self.chars = snap.chars;
        self.j = snap.j;
        self.word_start = snap.word_start;
        self.delimit_quote = snap.delimit_quote;
    }

    fn last_tok_tag(&self) -> Option<TokenTag> {
        if self.tokens.is_empty() {
            return None;
        }
        Some(self.tokens[self.tokens.len() - 1].tag())
    }

    pub fn lex(&mut self) -> Result<(), LexerError> {
        loop {
            let input = match self.eat() {
                Some(i) => i,
                None => {
                    self.break_word(true)?;
                    break;
                }
            };
            let char = input.char;
            let escaped = input.escaped;

            // Special token to denote substituted JS variables
            // we use 8 or \b which is a non printable char
            if char == SPECIAL_JS_CHAR as u32 {
                if self.looks_like_js_string_ref() {
                    if let Some(bunstr) = self.eat_js_string_ref() {
                        self.break_word(false)?;
                        self.handle_js_string_ref(bunstr)?;
                        continue;
                    }
                } else if self.looks_like_js_obj_ref() {
                    if let Some(tok) = self.eat_js_obj_ref() {
                        if self.chars.state == CharState::Double {
                            self.add_error(b"JS object reference not allowed in double quotes");
                            return Ok(());
                        }
                        self.break_word(false)?;
                        self.tokens.push(tok);
                        continue;
                    }
                }
            }
            // Handle non-escaped chars:
            // 1. special syntax (operators, etc.)
            // 2. lexing state switchers (quotes)
            // 3. word breakers (spaces, etc.)
            else if !escaped {
                let mut fell_through = false;
                'escaped: {
                    match char {
                        // possibly double bracket open
                        c if c == b'[' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b'[' as usize));
                            if self.chars.state == CharState::Single
                                || self.chars.state == CharState::Double
                            {
                                break 'escaped;
                            }
                            if let Some(p) = self.peek() {
                                if p.escaped || p.char != b'[' as u32 {
                                    break 'escaped;
                                }
                                let state = self.make_snapshot();
                                let _ = self.eat();
                                'do_backtrack: {
                                    let p2 = match self.peek() {
                                        Some(p2) => p2,
                                        None => {
                                            self.break_word(true)?;
                                            self.tokens.push(Token::DoubleBracketClose);
                                            fell_through = true;
                                            break 'escaped;
                                        }
                                    };
                                    if p2.escaped {
                                        break 'do_backtrack;
                                    }
                                    match p2.char {
                                        c2 if c2 == b' ' as u32
                                            || c2 == b'\r' as u32
                                            || c2 == b'\n' as u32
                                            || c2 == b'\t' as u32 =>
                                        {
                                            self.break_word(true)?;
                                            self.tokens.push(Token::DoubleBracketOpen);
                                        }
                                        _ => break 'do_backtrack,
                                    }
                                    fell_through = true;
                                    break 'escaped;
                                }
                                self.backtrack(state);
                            }
                            break 'escaped;
                        }
                        c if c == b']' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b']' as usize));
                            if self.chars.state == CharState::Single
                                || self.chars.state == CharState::Double
                            {
                                break 'escaped;
                            }
                            if let Some(p) = self.peek() {
                                if p.escaped || p.char != b']' as u32 {
                                    break 'escaped;
                                }
                                let state = self.make_snapshot();
                                let _ = self.eat();
                                'do_backtrack: {
                                    let p2 = match self.peek() {
                                        Some(p2) => p2,
                                        None => {
                                            self.break_word(true)?;
                                            self.tokens.push(Token::DoubleBracketClose);
                                            fell_through = true;
                                            break 'escaped;
                                        }
                                    };
                                    if p2.escaped {
                                        break 'do_backtrack;
                                    }
                                    match p2.char {
                                        c2 if matches!(
                                            c2 as u8,
                                            b' ' | b'\r' | b'\n' | b'\t' | b';' | b'&' | b'|'
                                                | b'>'
                                        ) =>
                                        {
                                            self.break_word(true)?;
                                            self.tokens.push(Token::DoubleBracketClose);
                                        }
                                        _ => break 'do_backtrack,
                                    }
                                    fell_through = true;
                                    break 'escaped;
                                }
                                self.backtrack(state);
                            }
                            break 'escaped;
                        }
                        c if c == b'#' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b'#' as usize));
                            if self.chars.state == CharState::Single
                                || self.chars.state == CharState::Double
                            {
                                break 'escaped;
                            }
                            let whitespace_preceding = if let Some(prev) = self.chars.prev {
                                ShellCharIter::<ENCODING>::is_whitespace(prev)
                            } else {
                                true
                            };
                            if !whitespace_preceding {
                                break 'escaped;
                            }
                            self.break_word(true)?;
                            self.eat_comment();
                            fell_through = true;
                        }
                        c if c == b';' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b';' as usize));
                            if self.chars.state == CharState::Single
                                || self.chars.state == CharState::Double
                            {
                                break 'escaped;
                            }
                            self.break_word(true)?;
                            self.tokens.push(Token::Semicolon);
                            fell_through = true;
                        }
                        c if c == b'\n' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b'\n' as usize));
                            if self.chars.state == CharState::Single
                                || self.chars.state == CharState::Double
                            {
                                break 'escaped;
                            }
                            self.break_word_impl(true, true, false)?;
                            self.tokens.push(Token::Newline);
                            fell_through = true;
                        }
                        // glob asterisks
                        c if c == b'*' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b'*' as usize));
                            if self.chars.state == CharState::Single
                                || self.chars.state == CharState::Double
                            {
                                break 'escaped;
                            }
                            if let Some(next) = self.peek() {
                                if !next.escaped && next.char == b'*' as u32 {
                                    let _ = self.eat();
                                    self.break_word(false)?;
                                    self.tokens.push(Token::DoubleAsterisk);
                                    fell_through = true;
                                    break 'escaped;
                                }
                            }
                            self.break_word(false)?;
                            self.tokens.push(Token::Asterisk);
                            fell_through = true;
                        }
                        // brace expansion syntax
                        c if c == b'{' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b'{' as usize));
                            if self.chars.state == CharState::Single
                                || self.chars.state == CharState::Double
                            {
                                break 'escaped;
                            }
                            self.break_word(false)?;
                            self.tokens.push(Token::BraceBegin);
                            fell_through = true;
                        }
                        c if c == b',' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b',' as usize));
                            if self.chars.state == CharState::Single
                                || self.chars.state == CharState::Double
                            {
                                break 'escaped;
                            }
                            self.break_word(false)?;
                            self.tokens.push(Token::Comma);
                            fell_through = true;
                        }
                        c if c == b'}' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b'}' as usize));
                            if self.chars.state == CharState::Single
                                || self.chars.state == CharState::Double
                            {
                                break 'escaped;
                            }
                            self.break_word(false)?;
                            self.tokens.push(Token::BraceEnd);
                            fell_through = true;
                        }
                        // Command substitution
                        c if c == b'`' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b'`' as usize));
                            if self.chars.state == CharState::Single {
                                break 'escaped;
                            }
                            if self.in_subshell == Some(SubShellKind::Backtick) {
                                self.break_word_operator()?;
                                if let Some(toktag) = self.last_tok_tag() {
                                    if toktag != TokenTag::Delimit {
                                        self.tokens.push(Token::Delimit);
                                    }
                                }
                                self.tokens.push(Token::CmdSubstEnd);
                                return Ok(());
                            } else {
                                self.eat_subshell(SubShellKind::Backtick)?;
                            }
                        }
                        // Command substitution/vars
                        c if c == b'$' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b'$' as usize));
                            if self.chars.state == CharState::Single {
                                break 'escaped;
                            }

                            let peeked = self.peek().unwrap_or(InputChar { char: 0, escaped: false });
                            if !peeked.escaped && peeked.char == b'(' as u32 {
                                self.break_word(false)?;
                                self.eat_subshell(SubShellKind::Dollar)?;
                                fell_through = true;
                                break 'escaped;
                            }

                            // Handle variable
                            self.break_word(false)?;
                            let var_tok = self.eat_var()?;

                            match var_tok.len() {
                                0 => {
                                    self.append_char_to_str_pool(b'$' as u32)?;
                                    self.break_word(false)?;
                                }
                                1 => 'blk: {
                                    let c = self.strpool[var_tok.start as usize];
                                    if c >= b'0' && c <= b'9' {
                                        self.tokens.push(Token::VarArgv(c - b'0'));
                                        break 'blk;
                                    }
                                    self.tokens.push(Token::Var(var_tok));
                                }
                                _ => {
                                    self.tokens.push(Token::Var(var_tok));
                                }
                            }
                            self.word_start = self.j;
                            fell_through = true;
                        }
                        c if c == b'(' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b'(' as usize));
                            if self.chars.state == CharState::Single
                                || self.chars.state == CharState::Double
                            {
                                break 'escaped;
                            }
                            self.break_word(true)?;
                            self.eat_subshell(SubShellKind::Normal)?;
                            fell_through = true;
                        }
                        c if c == b')' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b')' as usize));
                            if self.chars.state == CharState::Single
                                || self.chars.state == CharState::Double
                            {
                                break 'escaped;
                            }
                            if self.in_subshell != Some(SubShellKind::Dollar)
                                && self.in_subshell != Some(SubShellKind::Normal)
                            {
                                self.add_error(b"Unexpected ')'");
                                fell_through = true;
                                break 'escaped;
                            }

                            self.break_word(true)?;
                            // Command substitution can be put in a word so need to add delimiter
                            if self.in_subshell == Some(SubShellKind::Dollar) {
                                if let Some(toktag) = self.last_tok_tag() {
                                    match toktag {
                                        TokenTag::Delimit
                                        | TokenTag::Semicolon
                                        | TokenTag::Eof
                                        | TokenTag::Newline => {}
                                        _ => {
                                            self.tokens.push(Token::Delimit);
                                        }
                                    }
                                }
                            }

                            if self.in_subshell == Some(SubShellKind::Dollar) {
                                self.tokens.push(Token::CmdSubstEnd);
                            } else if self.in_subshell == Some(SubShellKind::Normal) {
                                self.tokens.push(Token::CloseParen);
                            }
                            return Ok(());
                        }
                        c if (b'0' as u32..=b'9' as u32).contains(&c) => {
                            // PERF(port): was `comptime for ('0'..'9') |c| assertSpecialChar(c);`
                            if self.chars.state != CharState::Normal {
                                break 'escaped;
                            }
                            let snapshot = self.make_snapshot();
                            if let Some(redirect) = self.eat_redirect(input) {
                                self.break_word(true)?;
                                self.tokens.push(Token::Redirect(redirect));
                                fell_through = true;
                                break 'escaped;
                            }
                            self.backtrack(snapshot);
                            break 'escaped;
                        }
                        // Operators
                        c if c == b'|' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b'|' as usize));
                            if self.chars.state == CharState::Single
                                || self.chars.state == CharState::Double
                            {
                                break 'escaped;
                            }
                            self.break_word_operator()?;

                            let next = match self.peek() {
                                Some(n) => n,
                                None => {
                                    self.add_error(b"Unexpected EOF");
                                    return Ok(());
                                }
                            };
                            if !next.escaped && next.char == b'&' as u32 {
                                self.add_error(b"Piping stdout and stderr (`|&`) is not supported yet. Please file an issue on GitHub.");
                                return Ok(());
                            }
                            if next.escaped || next.char != b'|' as u32 {
                                self.tokens.push(Token::Pipe);
                            } else if next.char == b'|' as u32 {
                                self.eat().expect("unreachable");
                                self.tokens.push(Token::DoublePipe);
                            }
                            fell_through = true;
                        }
                        c if c == b'>' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b'>' as usize));
                            if self.chars.state == CharState::Single
                                || self.chars.state == CharState::Double
                            {
                                break 'escaped;
                            }
                            self.break_word_operator()?;
                            let redirect = self.eat_simple_redirect(RedirectDirection::Out);
                            self.tokens.push(Token::Redirect(redirect));
                            fell_through = true;
                        }
                        c if c == b'<' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b'<' as usize));
                            if self.chars.state == CharState::Single
                                || self.chars.state == CharState::Double
                            {
                                break 'escaped;
                            }
                            self.break_word_operator()?;
                            let redirect = self.eat_simple_redirect(RedirectDirection::In);
                            self.tokens.push(Token::Redirect(redirect));
                            fell_through = true;
                        }
                        c if c == b'&' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b'&' as usize));
                            if self.chars.state == CharState::Single
                                || self.chars.state == CharState::Double
                            {
                                break 'escaped;
                            }
                            self.break_word_operator()?;

                            let next = match self.peek() {
                                Some(n) => n,
                                None => {
                                    self.tokens.push(Token::Ampersand);
                                    fell_through = true;
                                    break 'escaped;
                                }
                            };

                            if next.char == b'>' as u32 && !next.escaped {
                                let _ = self.eat();
                                let inner = if self.eat_simple_redirect_operator(RedirectDirection::Out)
                                {
                                    ast::RedirectFlags::amp_gt_gt()
                                } else {
                                    ast::RedirectFlags::amp_gt()
                                };
                                self.tokens.push(Token::Redirect(inner));
                            } else if next.escaped || next.char != b'&' as u32 {
                                self.tokens.push(Token::Ampersand);
                            } else if next.char == b'&' as u32 {
                                self.eat().expect("unreachable");
                                self.tokens.push(Token::DoubleAmpersand);
                            } else {
                                self.tokens.push(Token::Ampersand);
                                fell_through = true;
                                break 'escaped;
                            }
                        }
                        // 2. State switchers
                        c if c == b'\'' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b'\'' as usize));
                            if self.chars.state == CharState::Single {
                                self.break_word(false)?;
                                self.chars.state = CharState::Normal;
                                fell_through = true;
                                break 'escaped;
                            }
                            if self.chars.state == CharState::Normal {
                                self.break_word(false)?;
                                self.chars.state = CharState::Single;
                                fell_through = true;
                                break 'escaped;
                            }
                            break 'escaped;
                        }
                        c if c == b'"' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b'"' as usize));
                            if self.chars.state == CharState::Single {
                                break 'escaped;
                            }
                            if self.chars.state == CharState::Normal {
                                self.break_word(false)?;
                                self.chars.state = CharState::Double;
                            } else if self.chars.state == CharState::Double {
                                self.break_word(false)?;
                                self.chars.state = CharState::Normal;
                            }
                            fell_through = true;
                        }
                        // 3. Word breakers
                        c if c == b' ' as u32 => {
                            const _: () = assert!(SPECIAL_CHARS_TABLE.is_set(b' ' as usize));
                            if self.chars.state == CharState::Normal {
                                self.break_word_impl(true, true, false)?;
                                fell_through = true;
                                break 'escaped;
                            }
                            break 'escaped;
                        }
                        _ => break 'escaped,
                    }
                }
                if fell_through {
                    continue;
                }
                // PORT NOTE: Zig has `continue;` after the switch in `else escaped:`, but only when
                // the case did NOT `break :escaped`. We model that with `fell_through`. Cases that
                // break 'escaped fall through to appendCharToStrPool below.
            }
            // Treat newline preceded by backslash as whitespace
            else if char == b'\n' as u32 {
                debug_assert!(input.escaped);
                if self.chars.state != CharState::Double {
                    self.break_word_impl(true, true, false)?;
                }
                continue;
            }

            self.append_char_to_str_pool(char)?;
        }

        if let Some(subshell_kind) = self.in_subshell {
            match subshell_kind {
                SubShellKind::Dollar | SubShellKind::Backtick => {
                    self.add_error(b"Unclosed command substitution")
                }
                SubShellKind::Normal => self.add_error(b"Unclosed subshell"),
            }
            return Ok(());
        }

        self.tokens.push(Token::Eof);
        Ok(())
    }

    fn append_char_to_str_pool(&mut self, char: u32) -> Result<(), LexerError> {
        if ENCODING == StringEncoding::Ascii {
            self.strpool.push(char as u8);
            self.j += 1;
        } else {
            if char <= 0x7F {
                self.strpool.push(char as u8);
                self.j += 1;
                return Ok(());
            } else {
                self.append_unicode_char_to_str_pool(char)?;
            }
        }
        Ok(())
    }

    #[cold]
    fn append_unicode_char_to_str_pool(&mut self, char: u32) -> Result<(), LexerError> {
        let ichar: i32 = char as i32;
        let mut bytes = [0u8; 4];
        let n = strings::encode_wtf8_rune(&mut bytes, ichar);
        self.j += n as u32;
        self.strpool.extend_from_slice(&bytes[..n as usize]);
        Ok(())
    }

    fn break_word(&mut self, add_delimiter: bool) -> Result<(), LexerError> {
        self.break_word_impl(add_delimiter, false, false)
    }

    /// NOTE: this adds a delimiter
    fn break_word_operator(&mut self) -> Result<(), LexerError> {
        self.break_word_impl(true, false, true)
    }

    #[inline]
    fn is_immediately_escaped_quote(&self) -> bool {
        (self.chars.state == CharState::Double
            && self.chars.current.is_some_and(|c| !c.escaped && c.char == b'"' as u32)
            && self.chars.prev.is_some_and(|p| !p.escaped && p.char == b'"' as u32))
            || (self.chars.state == CharState::Single
                && self.chars.current.is_some_and(|c| !c.escaped && c.char == b'\'' as u32)
                && self.chars.prev.is_some_and(|p| !p.escaped && p.char == b'\'' as u32))
    }

    fn break_word_impl(
        &mut self,
        add_delimiter: bool,
        in_normal_space: bool,
        in_operator: bool,
    ) -> Result<(), LexerError> {
        let start: u32 = self.word_start;
        let end: u32 = self.j;
        if start != end || self.is_immediately_escaped_quote() {
            let tok: Token = match self.chars.state {
                CharState::Normal => Token::Text(TextRange { start, end }),
                CharState::Single => Token::SingleQuotedText(TextRange { start, end }),
                CharState::Double => Token::DoubleQuotedText(TextRange { start, end }),
            };
            self.tokens.push(tok);
            if add_delimiter {
                self.tokens.push(Token::Delimit);
            }
        } else if (in_normal_space || in_operator)
            && !self.tokens.is_empty()
            && match self.tokens[self.tokens.len() - 1].tag() {
                TokenTag::Var
                | TokenTag::VarArgv
                | TokenTag::Text
                | TokenTag::SingleQuotedText
                | TokenTag::DoubleQuotedText
                | TokenTag::BraceBegin
                | TokenTag::Comma
                | TokenTag::BraceEnd
                | TokenTag::CmdSubstEnd
                | TokenTag::Asterisk => true,

                TokenTag::Pipe
                | TokenTag::DoublePipe
                | TokenTag::Ampersand
                | TokenTag::DoubleAmpersand
                | TokenTag::Redirect
                | TokenTag::Dollar
                | TokenTag::DoubleAsterisk
                | TokenTag::Eq
                | TokenTag::Semicolon
                | TokenTag::Newline
                | TokenTag::CmdSubstBegin
                | TokenTag::CmdSubstQuoted
                | TokenTag::OpenParen
                | TokenTag::CloseParen
                | TokenTag::JSObjRef
                | TokenTag::DoubleBracketOpen
                | TokenTag::DoubleBracketClose
                | TokenTag::Delimit
                | TokenTag::Eof => false,
            }
        {
            self.tokens.push(Token::Delimit);
            self.delimit_quote = false;
        }
        self.word_start = self.j;
        Ok(())
    }

    fn eat_simple_redirect(&mut self, dir: RedirectDirection) -> ast::RedirectFlags {
        let is_double = self.eat_simple_redirect_operator(dir);

        if is_double {
            return match dir {
                RedirectDirection::Out => ast::RedirectFlags::gt_gt(),
                RedirectDirection::In => ast::RedirectFlags::lt_lt(),
            };
        }

        match dir {
            RedirectDirection::Out => ast::RedirectFlags::gt(),
            RedirectDirection::In => ast::RedirectFlags::lt(),
        }
    }

    /// Returns true if the operator is "double one": >> or <<
    /// Returns false if not doubled or invalid (e.g. <> ><)
    fn eat_simple_redirect_operator(&mut self, dir: RedirectDirection) -> bool {
        if let Some(peeked) = self.peek() {
            if peeked.escaped {
                return false;
            }
            match peeked.char {
                c if c == b'>' as u32 => {
                    if dir == RedirectDirection::Out {
                        let _ = self.eat();
                        return true;
                    }
                    return false;
                }
                c if c == b'<' as u32 => {
                    if dir == RedirectDirection::In {
                        let _ = self.eat();
                        return true;
                    }
                    return false;
                }
                _ => return false,
            }
        }
        false
    }

    // TODO Arbitrary file descriptor redirect
    fn eat_redirect(&mut self, first: InputChar) -> Option<ast::RedirectFlags> {
        let mut flags = ast::RedirectFlags::default();
        match first.char {
            c if c == b'0' as u32 => flags |= ast::RedirectFlags::STDIN,
            c if c == b'1' as u32 => flags |= ast::RedirectFlags::STDOUT,
            c if c == b'2' as u32 => flags |= ast::RedirectFlags::STDERR,
            // Just allow the std file descriptors for now
            _ => return None,
        }
        let mut dir = RedirectDirection::Out;
        if let Some(input) = self.peek() {
            if input.escaped {
                return None;
            }
            match input.char {
                c if c == b'>' as u32 => {
                    let _ = self.eat();
                    dir = RedirectDirection::Out;
                    let is_double = self.eat_simple_redirect_operator(dir);
                    if is_double {
                        flags |= ast::RedirectFlags::APPEND;
                    }
                    if let Some(peeked) = self.peek() {
                        if !peeked.escaped && peeked.char == b'&' as u32 {
                            let _ = self.eat();
                            if let Some(peeked2) = self.peek() {
                                match peeked2.char {
                                    c2 if c2 == b'1' as u32 => {
                                        let _ = self.eat();
                                        if !flags.stdout() && flags.stderr() {
                                            flags |= ast::RedirectFlags::DUPLICATE_OUT;
                                            flags |= ast::RedirectFlags::STDOUT;
                                            flags.remove(ast::RedirectFlags::STDERR);
                                        } else {
                                            return None;
                                        }
                                    }
                                    c2 if c2 == b'2' as u32 => {
                                        let _ = self.eat();
                                        if !flags.stderr() && flags.stdout() {
                                            flags |= ast::RedirectFlags::DUPLICATE_OUT;
                                            flags |= ast::RedirectFlags::STDERR;
                                            flags.remove(ast::RedirectFlags::STDOUT);
                                        } else {
                                            return None;
                                        }
                                    }
                                    _ => return None,
                                }
                            }
                        }
                    }
                    Some(flags)
                }
                c if c == b'<' as u32 => {
                    dir = RedirectDirection::In;
                    let is_double = self.eat_simple_redirect_operator(dir);
                    if is_double {
                        flags |= ast::RedirectFlags::APPEND;
                    }
                    Some(flags)
                }
                _ => None,
            }
        } else {
            None
        }
    }

    fn eat_redirect_old(&mut self, first: InputChar) -> Option<ast::RedirectFlags> {
        let mut flags = ast::RedirectFlags::default();
        if self.matches_ascii_literal(b"2>&1") {
        } else if self.matches_ascii_literal(b"1>&2") {
        } else {
            match first.char {
                c if (b'0' as u32..=b'9' as u32).contains(&c) => {
                    // Codepoint int casts are safe here because the digits are in the ASCII range
                    let mut count: usize = 1;
                    let mut buf = [first.char as u8; 32];

                    while let Some(peeked) = self.peek() {
                        let char = peeked.char;
                        match char {
                            c2 if (b'0' as u32..=b'9' as u32).contains(&c2) => {
                                let _ = self.eat();
                                if count >= 32 {
                                    return None;
                                }
                                buf[count] = char as u8;
                                count += 1;
                                continue;
                            }
                            _ => break,
                        }
                    }

                    let num = match core::str::from_utf8(&buf[..count])
                        .ok()
                        .and_then(|s| s.parse::<usize>().ok())
                    {
                        Some(n) => n,
                        // This means the number was really large, meaning it
                        // probably was supposed to be a string
                        None => return None,
                    };

                    match num {
                        0 => flags |= ast::RedirectFlags::STDIN,
                        1 => flags |= ast::RedirectFlags::STDOUT,
                        2 => flags |= ast::RedirectFlags::STDERR,
                        _ => {
                            // FIXME support redirection to any arbitrary fd
                            log!("redirection to fd {} is invalid\n", num);
                            return None;
                        }
                    }
                }
                c if c == b'&' as u32 => {
                    if first.escaped {
                        return None;
                    }
                    flags |= ast::RedirectFlags::STDOUT;
                    flags |= ast::RedirectFlags::STDERR;
                    let _ = self.eat();
                }
                _ => return None,
            }
        }

        let mut dir = RedirectDirection::Out;
        if let Some(input) = self.peek() {
            if input.escaped {
                return None;
            }
            match input.char {
                c if c == b'>' as u32 => dir = RedirectDirection::Out,
                c if c == b'<' as u32 => dir = RedirectDirection::In,
                _ => return None,
            }
            let _ = self.eat();
        } else {
            return None;
        }

        let is_double = self.eat_simple_redirect_operator(dir);
        if is_double {
            flags |= ast::RedirectFlags::APPEND;
        }

        Some(flags)
    }

    /// Assumes the first character of the literal has been eaten
    /// Backtracks and returns false if unsuccessful
    fn eat_literal<CP: PartialEq + Copy + Default, const N: usize>(
        &mut self,
        literal: &[CP; N],
    ) -> bool {
        // TODO(port): Zig used `comptime CodepointType: type` + `comptime literal: []const CodepointType`.
        let literal_skip_first = &literal[1..];
        let snapshot = self.make_snapshot();
        let slice = match self.eat_slice::<CP, { N - 1 }>() {
            // TODO(port): const-generic arithmetic — needs `generic_const_exprs` feature; revisit.
            Some(s) => s,
            None => {
                self.backtrack(snapshot);
                return false;
            }
        };

        if &slice[..] == literal_skip_first {
            return true;
        }

        self.backtrack(snapshot);
        false
    }

    fn eat_number_word(&mut self) -> Option<usize> {
        let snap = self.make_snapshot();
        let mut count: usize = 0;
        let mut buf = [0u8; 32];

        while let Some(result) = self.eat() {
            let char = result.char;
            match char {
                c if (b'0' as u32..=b'9' as u32).contains(&c) => {
                    if count >= 32 {
                        return None;
                    }
                    buf[count] = char as u8;
                    count += 1;
                    continue;
                }
                _ => break,
            }
        }

        if count == 0 {
            self.backtrack(snap);
            return None;
        }

        let num = match core::str::from_utf8(&buf[..count])
            .ok()
            .and_then(|s| s.parse::<usize>().ok())
        {
            Some(n) => n,
            None => {
                self.backtrack(snap);
                return None;
            }
        };

        Some(num)
    }

    fn eat_subshell(&mut self, kind: SubShellKind) -> Result<(), LexerError> {
        if kind == SubShellKind::Dollar {
            // Eat the open paren
            let _ = self.eat();
        }

        match kind {
            SubShellKind::Dollar | SubShellKind::Backtick => {
                self.tokens.push(Token::CmdSubstBegin);
                if self.chars.state == CharState::Double {
                    self.tokens.push(Token::CmdSubstQuoted);
                }
            }
            SubShellKind::Normal => self.tokens.push(Token::OpenParen),
        }
        let prev_quote_state = self.chars.state;
        let mut sublexer = self.make_sublexer(kind);
        sublexer.lex()?;
        self.continue_from_sublexer(&mut sublexer);
        self.chars.state = prev_quote_state;
        Ok(())
    }

    fn append_string_to_str_pool(&mut self, bunstr: BunString) -> Result<(), LexerError> {
        let start = self.strpool.len();
        if bunstr.is_utf16() {
            let utf16 = bunstr.utf16();
            let additional =
                bun_str::simdutf::utf8_length_from_utf16le(utf16.as_ptr(), utf16.len());
            self.strpool.reserve(additional);
            strings::convert_utf16_to_utf8_append(&mut self.strpool, bunstr.utf16())
                .map_err(|_| LexerError::Utf8InvalidStartByte)?;
            // TODO(port): Zig used `try` propagating its own error set; map properly.
        } else if bunstr.is_utf8() {
            self.strpool.extend_from_slice(bunstr.byte_slice());
        } else if bunstr.is_8bit() {
            if is_all_ascii(bunstr.byte_slice()) {
                self.strpool.extend_from_slice(bunstr.byte_slice());
            } else {
                let bytes = bunstr.byte_slice();
                let non_ascii_idx = strings::first_non_ascii(bytes).unwrap_or(0);

                if non_ascii_idx > 0 {
                    self.strpool.extend_from_slice(&bytes[..non_ascii_idx as usize]);
                }
                // TODO(port): allocateLatin1IntoUTF8WithList — appends latin1→utf8 into the Vec
                strings::allocate_latin1_into_utf8_with_list(
                    &mut self.strpool,
                    self.strpool.len(),
                    &bytes[non_ascii_idx as usize..],
                )
                .map_err(|_| LexerError::OutOfMemory)?;
            }
        }
        let end = self.strpool.len();
        self.j += u32::try_from(end - start).unwrap();
        Ok(())
    }

    fn handle_js_string_ref(&mut self, bunstr: BunString) -> Result<(), LexerError> {
        if bunstr.length() == 0 {
            // Empty JS string ref: emit a zero-length DoubleQuotedText token directly.
            // The parser converts this to a quoted_empty atom, preserving the empty arg.
            // This works regardless of the lexer's current quote state (Normal/Single/Double)
            // because the \x08 marker is processed before quote-state handling.
            let pos = self.j;
            self.tokens.push(Token::DoubleQuotedText(TextRange { start: pos, end: pos }));
            return Ok(());
        }
        self.append_string_to_str_pool(bunstr)
    }

    fn looks_like_js_obj_ref(&mut self) -> bool {
        let bytes = self.chars.src_bytes_at_cursor();
        if LEX_JS_OBJREF_PREFIX.len() - 1 >= bytes.len() {
            return false;
        }
        bytes[..LEX_JS_OBJREF_PREFIX.len() - 1] == LEX_JS_OBJREF_PREFIX[1..]
    }

    fn looks_like_js_string_ref(&mut self) -> bool {
        let bytes = self.chars.src_bytes_at_cursor();
        if LEX_JS_STRING_PREFIX.len() - 1 >= bytes.len() {
            return false;
        }
        bytes[..LEX_JS_STRING_PREFIX.len() - 1] == LEX_JS_STRING_PREFIX[1..]
    }

    fn bump_cursor_ascii(&mut self, new_idx: usize, prev_ascii_char: Option<u8>, cur_ascii_char: u8) {
        if ENCODING == StringEncoding::Ascii {
            self.chars.src.set_ascii_i(new_idx);
            if let Some(pc) = prev_ascii_char {
                self.chars.prev = Some(InputChar { char: pc as u32, escaped: false });
            }
            self.chars.current = Some(InputChar { char: cur_ascii_char as u32, escaped: false });
            return;
        }
        // Set the cursor to decode the codepoint at new_idx.
        // Use width=0 so that nextCursor (which computes pos = width + i)
        // starts reading from exactly new_idx.
        // TODO(port): direct field access on SrcUnicode cursor — encapsulate in helper.
        self.chars.src.set_unicode_cursor(new_idx);
        if let Some(pc) = prev_ascii_char {
            self.chars.prev = Some(InputChar { char: pc as u32, escaped: false });
        }
        self.chars.current = Some(InputChar { char: cur_ascii_char as u32, escaped: false });
    }

    fn matches_ascii_literal(&mut self, literal: &[u8]) -> bool {
        let bytes = self.chars.src_bytes_at_cursor();
        if literal.len() >= bytes.len() {
            return false;
        }
        &bytes[..literal.len()] == literal
    }

    fn eat_js_substitution_idx(
        &mut self,
        literal: &'static [u8],
        name: &'static str,
        validate: fn(&mut Self, usize) -> bool,
    ) -> Option<usize> {
        if self.matches_ascii_literal(&literal[1..]) {
            let bytes = self.chars.src_bytes_at_cursor();
            let mut i: usize = 0;
            let mut digit_buf = [0u8; 32];
            let mut digit_buf_count: u8 = 0;

            i += literal.len() - 1;

            while i < bytes.len() {
                match bytes[i] {
                    b'0'..=b'9' => {
                        if digit_buf_count as usize >= digit_buf.len() {
                            // TODO(port): Zig comptime concat for error string. Build at runtime.
                            let mut error_buf = Vec::new();
                            write!(
                                &mut error_buf,
                                "Invalid {} (number too high):  {}{}",
                                name,
                                bstr::BStr::new(&digit_buf[..digit_buf_count as usize]),
                                bytes[i] as char
                            )
                            .unwrap();
                            self.add_error(&error_buf);
                            return None;
                        }
                        digit_buf[digit_buf_count as usize] = bytes[i];
                        digit_buf_count += 1;
                    }
                    _ => break,
                }
                i += 1;
            }

            if digit_buf_count == 0 {
                let mut e = Vec::new();
                write!(&mut e, "Invalid {} (no idx)", name).unwrap();
                self.add_error(&e);
                return None;
            }

            let idx = match core::str::from_utf8(&digit_buf[..digit_buf_count as usize])
                .ok()
                .and_then(|s| s.parse::<usize>().ok())
            {
                Some(n) => n,
                None => {
                    let mut e = Vec::new();
                    write!(&mut e, "Invalid {} ref ", name).unwrap();
                    self.add_error(&e);
                    return None;
                }
            };

            if !validate(self, idx) {
                return None;
            }

            // Bump the cursor
            let new_idx = self.chars.cursor_pos() + i;
            let prev_ascii_char: Option<u8> = if digit_buf_count == 1 {
                None
            } else {
                Some((digit_buf[digit_buf_count as usize - 2]) & 0x7F)
            };
            let cur_ascii_char: u8 = digit_buf[digit_buf_count as usize - 1] & 0x7F;
            self.bump_cursor_ascii(new_idx, prev_ascii_char, cur_ascii_char);

            return Some(idx);
        }
        None
    }

    /// __NOTE__: Do not store references to the returned BunString, it does not have its ref count incremented
    fn eat_js_string_ref(&mut self) -> Option<BunString> {
        if let Some(idx) = self.eat_js_substitution_idx(
            LEX_JS_STRING_PREFIX,
            "JS string ref",
            Self::validate_js_string_ref_idx,
        ) {
            return Some(self.string_refs[idx]);
        }
        None
    }

    fn validate_js_string_ref_idx(&mut self, idx: usize) -> bool {
        if idx >= self.string_refs.len() {
            self.add_error(b"Invalid JS string ref (out of bounds");
            return false;
        }
        true
    }

    fn eat_js_obj_ref(&mut self) -> Option<Token> {
        if let Some(idx) = self.eat_js_substitution_idx(
            LEX_JS_OBJREF_PREFIX,
            "JS object ref",
            Self::validate_js_obj_ref_idx,
        ) {
            return Some(Token::JSObjRef(u32::try_from(idx).unwrap()));
        }
        None
    }

    fn validate_js_obj_ref_idx(&mut self, idx: usize) -> bool {
        if idx >= self.jsobjs_len as usize {
            self.add_error(b"Invalid JS object ref (out of bounds)");
            return false;
        }
        true
    }

    fn eat_var(&mut self) -> Result<TextRange, LexerError> {
        let start = self.j;
        let mut i: usize = 0;
        let mut is_int = false;
        // Eat until special character
        while let Some(result) = self.peek() {
            let char = result.char;
            let escaped = result.escaped;

            if i == 0 {
                match char {
                    c if c == b'=' as u32 => {
                        return Ok(TextRange { start, end: self.j });
                    }
                    c if (b'0' as u32..=b'9' as u32).contains(&c) => {
                        is_int = true;
                        self.eat().unwrap();
                        self.append_char_to_str_pool(char)?;
                        i += 1;
                        continue;
                    }
                    c if (b'a' as u32..=b'z' as u32).contains(&c)
                        || (b'A' as u32..=b'Z' as u32).contains(&c)
                        || c == b'_' as u32 => {}
                    _ => return Ok(TextRange { start, end: self.j }),
                }
            }
            i += 1;
            if is_int {
                return Ok(TextRange { start, end: self.j });
            }

            match char {
                c if matches!(
                    c as u8,
                    b'{' | b'}' | b';' | b'\'' | b'"' | b' ' | b'|' | b'&' | b'>' | b',' | b'$'
                ) =>
                {
                    return Ok(TextRange { start, end: self.j });
                }
                _ => {
                    if !escaped
                        && ((self.in_subshell == Some(SubShellKind::Dollar)
                            && char == b')' as u32)
                            || (self.in_subshell == Some(SubShellKind::Backtick)
                                && char == b'`' as u32)
                            || (self.in_subshell == Some(SubShellKind::Normal)
                                && char == b')' as u32))
                    {
                        return Ok(TextRange { start, end: self.j });
                    }
                    match char {
                        c if (b'0' as u32..=b'9' as u32).contains(&c)
                            || (b'a' as u32..=b'z' as u32).contains(&c)
                            || (b'A' as u32..=b'Z' as u32).contains(&c)
                            || c == b'_' as u32 =>
                        {
                            self.eat().expect("unreachable");
                            self.append_char_to_str_pool(char)?;
                        }
                        _ => return Ok(TextRange { start, end: self.j }),
                    }
                }
            }
        }
        Ok(TextRange { start, end: self.j })
    }

    fn eat(&mut self) -> Option<InputChar> {
        self.chars.eat()
    }

    fn eat_comment(&mut self) {
        while let Some(peeked) = self.eat() {
            if peeked.escaped {
                continue;
            }
            if peeked.char == b'\n' as u32 {
                break;
            }
        }
    }

    fn eat_slice<CP: Copy + Default, const N: usize>(&mut self) -> Option<[CP; N]>
    where
        CP: TryFrom<u32>,
    {
        // TODO(port): Zig branched on whether CP's max >= source codepoint range; here we use
        // TryFrom and bail if conversion fails.
        let mut slice = [CP::default(); N];
        let mut i: usize = 0;
        while let Some(result) = self.peek() {
            let Ok(v) = CP::try_from(result.char) else { return None };
            slice[i] = v;
            i += 1;
            let _ = self.eat();
            if i == N {
                return Some(slice);
            }
        }
        None
    }

    fn peek(&mut self) -> Option<InputChar> {
        self.chars.peek()
    }

    fn read_char(&mut self) -> Option<InputChar> {
        self.chars.read_char()
    }
}

// ───────────────────────────── ShellCharIter / Src ─────────────────────────────

/// Unified InputChar — Zig had two layouts (packed u8 for ascii, struct for unicode).
/// In Rust we use one struct; CodepointType is u32 in both (ascii values fit in u7).
// TODO(port): if the packed-u8 layout matters for perf, specialize via const generic in Phase B.
#[derive(Clone, Copy)]
pub struct InputChar {
    pub char: u32,
    pub escaped: bool,
}

#[derive(Clone, Copy)]
pub struct SrcAscii<'a> {
    pub bytes: &'a [u8],
    pub i: usize,
}

#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct SrcAsciiIndexValue(u8); // packed: char:7 + escaped:1

impl SrcAsciiIndexValue {
    #[inline]
    fn char(self) -> u8 { self.0 & 0x7F }
    #[inline]
    fn escaped(self) -> bool { (self.0 & 0x80) != 0 }
}

impl<'a> SrcAscii<'a> {
    fn init(bytes: &'a [u8]) -> Self {
        Self { bytes, i: 0 }
    }

    #[inline]
    fn index(&self) -> Option<SrcAsciiIndexValue> {
        if self.i >= self.bytes.len() {
            return None;
        }
        Some(SrcAsciiIndexValue(self.bytes[self.i] & 0x7F))
        // TODO(port): Zig @intCast to u7 — high bit truncated; assumes ASCII input.
    }

    #[inline]
    fn index_next(&self) -> Option<SrcAsciiIndexValue> {
        if self.i + 1 >= self.bytes.len() {
            return None;
        }
        Some(SrcAsciiIndexValue(self.bytes[self.i + 1] & 0x7F))
    }

    #[inline]
    fn eat(&mut self, escaped: bool) {
        self.i += 1 + (escaped as u32) as usize;
    }
}

pub type CodepointIterator = strings::UnsignedCodepointIterator;

#[derive(Clone, Copy)]
pub struct SrcUnicode<'a> {
    pub iter: CodepointIterator<'a>,
    pub cursor: strings::CodepointCursor,
    pub next_cursor: strings::CodepointCursor,
}

#[derive(Clone, Copy)]
pub struct SrcUnicodeIndexValue {
    pub char: u32,
    pub width: u8,
}

impl<'a> SrcUnicode<'a> {
    fn next_cursor(iter: &CodepointIterator<'a>, cursor: &mut strings::CodepointCursor) {
        if !iter.next(cursor) {
            // This will make `i > sourceBytes.len` so the condition in `index` will fail
            cursor.i = u32::try_from(iter.bytes().len() + 1).unwrap();
            cursor.width = 1;
            cursor.c = CodepointIterator::ZERO_VALUE;
        }
    }

    fn init(bytes: &'a [u8]) -> Self {
        let iter = CodepointIterator::init(bytes);
        let mut cursor = strings::CodepointCursor::default();
        Self::next_cursor(&iter, &mut cursor);
        let mut next_cursor = cursor;
        Self::next_cursor(&iter, &mut next_cursor);
        Self { iter, cursor, next_cursor }
    }

    #[inline]
    fn index(&self) -> Option<SrcUnicodeIndexValue> {
        if self.cursor.width as usize + self.cursor.i as usize > self.iter.bytes().len() {
            return None;
        }
        Some(SrcUnicodeIndexValue { char: self.cursor.c, width: self.cursor.width })
    }

    #[inline]
    fn index_next(&self) -> Option<SrcUnicodeIndexValue> {
        if self.next_cursor.width as usize + self.next_cursor.i as usize > self.iter.bytes().len() {
            return None;
        }
        Some(SrcUnicodeIndexValue {
            char: self.next_cursor.c as u32,
            width: self.next_cursor.width,
        })
    }

    #[inline]
    fn eat(&mut self, escaped: bool) {
        if escaped {
            // eat two codepoints
            Self::next_cursor(&self.iter, &mut self.next_cursor);
            self.cursor = self.next_cursor;
            Self::next_cursor(&self.iter, &mut self.next_cursor);
        } else {
            // eat one codepoint
            self.cursor = self.next_cursor;
            Self::next_cursor(&self.iter, &mut self.next_cursor);
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CharState {
    Normal,
    Single,
    Double,
}

// TODO(port): Zig `Src = switch (encoding) { .ascii => SrcAscii, .wtf8/.utf16 => SrcUnicode }`
// — Rust const-generic-on-enum can't pick a struct type. Use a tagged union and branch on ENCODING.
#[derive(Clone, Copy)]
pub enum Src<'a> {
    Ascii(SrcAscii<'a>),
    Unicode(SrcUnicode<'a>),
}

impl<'a> Src<'a> {
    fn set_ascii_i(&mut self, new_idx: usize) {
        if let Src::Ascii(a) = self { a.i = new_idx; }
    }
    fn set_unicode_cursor(&mut self, new_idx: usize) {
        if let Src::Unicode(u) = self {
            u.cursor = strings::CodepointCursor {
                i: u32::try_from(new_idx).unwrap(),
                c: 0,
                width: 0,
            };
            SrcUnicode::next_cursor(&u.iter, &mut u.cursor);
            u.next_cursor = u.cursor;
            SrcUnicode::next_cursor(&u.iter, &mut u.next_cursor);
        }
    }
}

#[derive(Clone, Copy)]
pub struct ShellCharIter<'a, const ENCODING: StringEncoding> {
    pub src: Src<'a>,
    pub state: CharState,
    pub prev: Option<InputChar>,
    pub current: Option<InputChar>,
}

impl<'a, const ENCODING: StringEncoding> ShellCharIter<'a, ENCODING> {
    pub fn is_whitespace(char: InputChar) -> bool {
        matches!(char.char, c if c == b'\t' as u32 || c == b'\r' as u32 || c == b'\n' as u32 || c == b' ' as u32)
    }

    pub fn init(bytes: &'a [u8]) -> Self {
        let src = if ENCODING == StringEncoding::Ascii {
            Src::Ascii(SrcAscii::init(bytes))
        } else {
            Src::Unicode(SrcUnicode::init(bytes))
        };
        Self { src, state: CharState::Normal, prev: None, current: None }
    }

    pub fn src_bytes(&self) -> &'a [u8] {
        match &self.src {
            Src::Ascii(a) => a.bytes,
            Src::Unicode(u) => u.iter.bytes(),
        }
    }

    pub fn src_bytes_at_cursor(&self) -> &'a [u8] {
        let bytes = self.src_bytes();
        match &self.src {
            Src::Ascii(a) => {
                if a.i >= bytes.len() { return b""; }
                &bytes[a.i..]
            }
            Src::Unicode(u) => {
                if u.cursor.i as usize >= bytes.len() { return b""; }
                &bytes[u.cursor.i as usize..]
            }
        }
    }

    pub fn cursor_pos(&self) -> usize {
        match &self.src {
            Src::Ascii(a) => a.i,
            Src::Unicode(u) => u.cursor.i as usize,
        }
    }

    pub fn eat(&mut self) -> Option<InputChar> {
        if let Some(result) = self.read_char() {
            self.prev = self.current;
            self.current = Some(result);
            match &mut self.src {
                Src::Ascii(a) => a.eat(result.escaped),
                Src::Unicode(u) => u.eat(result.escaped),
            }
            return Some(result);
        }
        None
    }

    pub fn peek(&mut self) -> Option<InputChar> {
        self.read_char()
    }

    pub fn read_char(&mut self) -> Option<InputChar> {
        let (mut char, _width): (u32, u8) = match &self.src {
            Src::Ascii(a) => {
                let iv = a.index()?;
                (iv.char() as u32, 1)
            }
            Src::Unicode(u) => {
                let iv = u.index()?;
                (iv.char, iv.width)
            }
        };
        if char != b'\\' as u32 || self.state == CharState::Single {
            return Some(InputChar { char, escaped: false });
        }

        // Handle backslash
        match self.state {
            CharState::Normal => {
                let peeked = match &self.src {
                    Src::Ascii(a) => a.index_next().map(|v| v.char() as u32),
                    Src::Unicode(u) => u.index_next().map(|v| v.char),
                }?;
                char = peeked;
            }
            CharState::Double => {
                let peeked = match &self.src {
                    Src::Ascii(a) => a.index_next().map(|v| v.char() as u32),
                    Src::Unicode(u) => u.index_next().map(|v| v.char),
                }?;
                match peeked {
                    // Backslash only applies to these characters
                    c if matches!(c as u8, b'$' | b'`' | b'"' | b'\\' | b'\n' | b'#') => {
                        char = peeked;
                    }
                    _ => return Some(InputChar { char, escaped: false }),
                }
            }
            // We checked `self.state == .Single` above so this is impossible
            CharState::Single => unreachable!(),
        }

        Some(InputChar { char, escaped: true })
    }
}

// ───────────────────────────── var-name / eq helpers ─────────────────────────────

/// Only these characters allowed:
/// - a-zA-Z
/// - _
/// - 0-9 (but can't be first char)
pub fn is_valid_var_name(var_name: &[u8]) -> bool {
    if is_all_ascii(var_name) {
        return is_valid_var_name_ascii(var_name);
    }

    if var_name.is_empty() {
        return false;
    }
    let iter = CodepointIterator::init(var_name);
    let mut cursor = strings::CodepointCursor::default();

    if !iter.next(&mut cursor) {
        return false;
    }

    match cursor.c {
        c if c == b'=' as u32 || (b'0' as u32..=b'9' as u32).contains(&c) => return false,
        c if (b'a' as u32..=b'z' as u32).contains(&c)
            || (b'A' as u32..=b'Z' as u32).contains(&c)
            || c == b'_' as u32 => {}
        _ => return false,
    }

    while iter.next(&mut cursor) {
        match cursor.c {
            c if (b'0' as u32..=b'9' as u32).contains(&c)
                || (b'a' as u32..=b'z' as u32).contains(&c)
                || (b'A' as u32..=b'Z' as u32).contains(&c)
                || c == b'_' as u32 => {}
            _ => return false,
        }
    }

    true
}

fn is_valid_var_name_ascii(var_name: &[u8]) -> bool {
    if var_name.is_empty() {
        return false;
    }
    match var_name[0] {
        b'=' | b'0'..=b'9' => return false,
        b'a'..=b'z' | b'A'..=b'Z' | b'_' => {
            if var_name.len() == 1 {
                return true;
            }
        }
        _ => return false,
    }
    for &c in var_name {
        match c {
            b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' | b'_' => {}
            _ => return false,
        }
    }
    true
}

static STDERR_MUTEX: bun_threading::Mutex = bun_threading::Mutex::new();
// TODO(port): bun.Mutex{} — confirm crate path.

pub fn has_eq_sign(str: &[u8]) -> Option<u32> {
    if is_all_ascii(str) {
        return strings::index_of_char(str, b'=');
    }

    // TODO actually i think that this can also use the simd stuff
    let iter = CodepointIterator::init(str);
    let mut cursor = strings::CodepointCursor::default();
    while iter.next(&mut cursor) {
        if cursor.c == b'=' as u32 {
            return Some(cursor.i);
        }
    }

    None
}

#[inline]
fn is_all_ascii(s: &[u8]) -> bool {
    strings::is_all_ascii(s)
}

// ───────────────────────────── CmdEnvIter ─────────────────────────────

pub struct CmdEnvIter<'a> {
    pub env: &'a bun_collections::StringArrayHashMap<Box<ZStr>>,
    // TODO(port): Zig `[:0]const u8` value — confirm map value type.
    pub iter: bun_collections::array_hash_map::Iter<'a, Box<ZStr>>,
}

pub struct CmdEnvEntry<'a> {
    pub key: CmdEnvKey<'a>,
    pub value: CmdEnvValue<'a>,
}

pub struct CmdEnvValue<'a> {
    pub val: &'a ZStr,
}

impl fmt::Display for CmdEnvValue<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(bstr::BStr::new(self.val.as_bytes()).to_string().as_str())
        // TODO(port): write bytes without UTF-8 lossiness — use bstr Display directly.
    }
}

pub struct CmdEnvKey<'a> {
    pub val: &'a [u8],
}

impl fmt::Display for CmdEnvKey<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", bstr::BStr::new(self.val))
    }
}

impl CmdEnvKey<'_> {
    pub fn eql_comptime(&self, str: &'static [u8]) -> bool {
        self.val == str
    }
}

impl<'a> CmdEnvIter<'a> {
    pub fn from_env(env: &'a bun_collections::StringArrayHashMap<Box<ZStr>>) -> Self {
        let iter = env.iterator();
        Self { env, iter }
    }

    pub fn len(&self) -> usize {
        self.env.len()
    }

    pub fn next(&mut self) -> Result<Option<CmdEnvEntry<'a>>, bun_core::Error> {
        // TODO(port): narrow error set — Zig sig is `!?Entry` but body never errors.
        let Some(entry) = self.iter.next() else { return Ok(None) };
        Ok(Some(CmdEnvEntry {
            key: CmdEnvKey { val: entry.key() },
            value: CmdEnvValue { val: entry.value() },
        }))
    }
}

// ───────────────────────────── Test ─────────────────────────────

pub mod test {
    use super::*;

    pub enum TestToken<'a> {
        Pipe,
        DoublePipe,
        Ampersand,
        DoubleAmpersand,
        Redirect(ast::RedirectFlags),
        Dollar,
        Asterisk,
        DoubleAsterisk,
        Eq,
        Semicolon,
        Newline,
        BraceBegin,
        Comma,
        BraceEnd,
        CmdSubstBegin,
        CmdSubstQuoted,
        CmdSubstEnd,
        OpenParen,
        CloseParen,
        Var(&'a [u8]),
        VarArgv(u8),
        Text(&'a [u8]),
        SingleQuotedText(&'a [u8]),
        DoubleQuotedText(&'a [u8]),
        JSObjRef(u32),
        DoubleBracketOpen,
        DoubleBracketClose,
        Delimit,
        Eof,
    }

    impl<'a> TestToken<'a> {
        pub fn from_real(the_token: Token, buf: &'a [u8]) -> TestToken<'a> {
            match the_token {
                Token::Var(txt) => TestToken::Var(&buf[txt.start as usize..txt.end as usize]),
                Token::VarArgv(int) => TestToken::VarArgv(int),
                Token::Text(txt) => TestToken::Text(&buf[txt.start as usize..txt.end as usize]),
                Token::SingleQuotedText(txt) => {
                    TestToken::SingleQuotedText(&buf[txt.start as usize..txt.end as usize])
                }
                Token::DoubleQuotedText(txt) => {
                    TestToken::DoubleQuotedText(&buf[txt.start as usize..txt.end as usize])
                }
                Token::JSObjRef(val) => TestToken::JSObjRef(val),
                Token::Pipe => TestToken::Pipe,
                Token::DoublePipe => TestToken::DoublePipe,
                Token::Ampersand => TestToken::Ampersand,
                Token::DoubleAmpersand => TestToken::DoubleAmpersand,
                Token::Redirect(r) => TestToken::Redirect(r),
                Token::Dollar => TestToken::Dollar,
                Token::Asterisk => TestToken::Asterisk,
                Token::DoubleAsterisk => TestToken::DoubleAsterisk,
                Token::Eq => TestToken::Eq,
                Token::Semicolon => TestToken::Semicolon,
                Token::Newline => TestToken::Newline,
                Token::BraceBegin => TestToken::BraceBegin,
                Token::Comma => TestToken::Comma,
                Token::BraceEnd => TestToken::BraceEnd,
                Token::CmdSubstBegin => TestToken::CmdSubstBegin,
                Token::CmdSubstQuoted => TestToken::CmdSubstQuoted,
                Token::CmdSubstEnd => TestToken::CmdSubstEnd,
                Token::OpenParen => TestToken::OpenParen,
                Token::CloseParen => TestToken::CloseParen,
                Token::DoubleBracketOpen => TestToken::DoubleBracketOpen,
                Token::DoubleBracketClose => TestToken::DoubleBracketClose,
                Token::Delimit => TestToken::Delimit,
                Token::Eof => TestToken::Eof,
            }
        }
    }
}
pub use test as Test;

// ───────────────────────────── JS bridge ─────────────────────────────

pub fn shell_cmd_from_js(
    global: &JSGlobalObject,
    string_args: JSValue,
    template_args: &mut JSArrayIterator,
    out_jsobjs: &mut Vec<JSValue>,
    jsstrings: &mut Vec<BunString>,
    out_script: &mut Vec<u8>,
    marked_argument_buffer: &mut MarkedArgumentBuffer,
) -> JsResult<()> {
    let mut builder = ShellSrcBuilder::init(global, out_script, jsstrings);
    let mut jsobjref_buf = [0u8; 128];

    let mut string_iter = string_args.array_iterator(global)?;
    let mut i: u32 = 0;
    let last = string_iter.len().saturating_sub(1);
    while let Some(js_value) = string_iter.next()? {
        if !builder.append_js_value_str::<false>(js_value)? {
            return Err(global.throw(format_args!(
                "Shell script string contains invalid UTF-16"
            )));
        }
        if i < last {
            let template_value = match template_args.next()? {
                Some(v) => v,
                None => {
                    return Err(global.throw(format_args!(
                        "Shell script is missing JSValue arg"
                    )));
                }
            };
            // PORT NOTE: reshaped for borrowck — builder holds &mut out_script/jsstrings;
            // drop and re-create around the recursive call.
            drop(builder);
            handle_template_value(
                global,
                template_value,
                out_jsobjs,
                out_script,
                jsstrings,
                &mut jsobjref_buf[..],
                marked_argument_buffer,
            )?;
            builder = ShellSrcBuilder::init(global, out_script, jsstrings);
        }
        i += 1;
    }
    Ok(())
}

pub fn handle_template_value(
    global: &JSGlobalObject,
    template_value: JSValue,
    out_jsobjs: &mut Vec<JSValue>,
    out_script: &mut Vec<u8>,
    jsstrings: &mut Vec<BunString>,
    jsobjref_buf: &mut [u8],
    marked_argument_buffer: &mut MarkedArgumentBuffer,
) -> JsResult<()> {
    let mut builder = ShellSrcBuilder::init(global, out_script, jsstrings);
    if !template_value.is_empty() {
        if let Some(_array_buffer) = template_value.as_array_buffer(global) {
            let idx = out_jsobjs.len();
            marked_argument_buffer.append(template_value);
            out_jsobjs.push(template_value);
            let mut cursor = std::io::Cursor::new(&mut jsobjref_buf[..]);
            write!(cursor, "{}{}", bstr::BStr::new(LEX_JS_OBJREF_PREFIX), idx)
                .map_err(|_| global.throw_out_of_memory())?;
            let n = cursor.position() as usize;
            drop(builder);
            out_script.extend_from_slice(&jsobjref_buf[..n]);
            return Ok(());
        }

        if let Some(blob) = template_value.as_::<jsc::WebCore::Blob>() {
            if let Some(store) = &blob.store {
                if store.data.is_file() {
                    if let Some(path) = store.data.file().pathlike.as_path() {
                        let path = path.slice();

                        // Check for null bytes in path (security: prevent null byte injection)
                        if strings::index_of_char(path, 0).is_some() {
                            return Err(global
                                .err(jsc::ErrorCode::INVALID_ARG_VALUE, format_args!(
                                    "The shell argument must be a string without null bytes. Received {}",
                                    bun_core::fmt::quote(path)
                                ))
                                .throw());
                        }

                        if !builder.append_utf8::<true>(path)? {
                            return Err(global.throw(format_args!(
                                "Shell script string contains invalid UTF-16"
                            )));
                        }
                        return Ok(());
                    }
                }
            }

            let idx = out_jsobjs.len();
            marked_argument_buffer.append(template_value);
            out_jsobjs.push(template_value);
            let mut cursor = std::io::Cursor::new(&mut jsobjref_buf[..]);
            write!(cursor, "{}{}", bstr::BStr::new(LEX_JS_OBJREF_PREFIX), idx)
                .map_err(|_| global.throw_out_of_memory())?;
            let n = cursor.position() as usize;
            drop(builder);
            out_script.extend_from_slice(&jsobjref_buf[..n]);
            return Ok(());
        }

        if let Some(_rstream) = jsc::WebCore::ReadableStream::from_js(template_value, global)? {
            let idx = out_jsobjs.len();
            marked_argument_buffer.append(template_value);
            out_jsobjs.push(template_value);
            let mut cursor = std::io::Cursor::new(&mut jsobjref_buf[..]);
            write!(cursor, "{}{}", bstr::BStr::new(LEX_JS_OBJREF_PREFIX), idx)
                .map_err(|_| global.throw_out_of_memory())?;
            let n = cursor.position() as usize;
            drop(builder);
            out_script.extend_from_slice(&jsobjref_buf[..n]);
            return Ok(());
        }

        if let Some(_req) = template_value.as_::<jsc::WebCore::Response>() {
            let idx = out_jsobjs.len();
            marked_argument_buffer.append(template_value);
            out_jsobjs.push(template_value);
            let mut cursor = std::io::Cursor::new(&mut jsobjref_buf[..]);
            write!(cursor, "{}{}", bstr::BStr::new(LEX_JS_OBJREF_PREFIX), idx)
                .map_err(|_| global.throw_out_of_memory())?;
            let n = cursor.position() as usize;
            drop(builder);
            out_script.extend_from_slice(&jsobjref_buf[..n]);
            return Ok(());
        }

        if template_value.is_string() {
            if !builder.append_js_value_str::<true>(template_value)? {
                return Err(global.throw(format_args!(
                    "Shell script string contains invalid UTF-16"
                )));
            }
            return Ok(());
        }

        if template_value.js_type().is_array() {
            let mut array = template_value.array_iterator(global)?;
            let last = array.len().saturating_sub(1);
            let mut i: u32 = 0;
            drop(builder);
            while let Some(arr) = array.next()? {
                handle_template_value(
                    global,
                    arr,
                    out_jsobjs,
                    out_script,
                    jsstrings,
                    jsobjref_buf,
                    marked_argument_buffer,
                )?;
                if i < last {
                    let str = BunString::static_(b" ");
                    let mut b = ShellSrcBuilder::init(global, out_script, jsstrings);
                    if !b.append_bun_str::<false>(str)? {
                        return Err(global.throw(format_args!(
                            "Shell script string contains invalid UTF-16"
                        )));
                    }
                }
                i += 1;
            }
            return Ok(());
        }

        if template_value.is_object() {
            if let Some(maybe_str) = template_value.get_own_truthy(global, "raw")? {
                let bunstr = maybe_str.to_bun_string(global)?;
                let _guard = scopeguard::guard((), |_| bunstr.deref());

                // Check for null bytes in shell argument (security: prevent null byte injection)
                if bunstr.index_of_ascii_char(0).is_some() {
                    return Err(global
                        .err(jsc::ErrorCode::INVALID_ARG_VALUE, format_args!(
                            "The shell argument must be a string without null bytes. Received \"{}\"",
                            bunstr.to_zig_string()
                        ))
                        .throw());
                }

                if !builder.append_bun_str::<false>(bunstr)? {
                    return Err(global.throw(format_args!(
                        "Shell script string contains invalid UTF-16"
                    )));
                }
                return Ok(());
            }
        }

        if template_value.is_primitive() {
            if !builder.append_js_value_str::<true>(template_value)? {
                return Err(global.throw(format_args!(
                    "Shell script string contains invalid UTF-16"
                )));
            }
            return Ok(());
        }

        if template_value.implements_to_string(global)? {
            if !builder.append_js_value_str::<true>(template_value)? {
                return Err(global.throw(format_args!(
                    "Shell script string contains invalid UTF-16"
                )));
            }
            return Ok(());
        }

        return Err(global.throw(format_args!(
            "Invalid JS object used in shell: {}, you might need to call `.toString()` on it",
            template_value.fmt_string(global)
        )));
    }

    Ok(())
}

// ───────────────────────────── ShellSrcBuilder ─────────────────────────────

pub struct ShellSrcBuilder<'a> {
    pub global_this: &'a JSGlobalObject,
    pub outbuf: &'a mut Vec<u8>,
    pub jsstrs_to_escape: &'a mut Vec<BunString>,
    pub jsstr_ref_buf: [u8; 128],
}

impl<'a> ShellSrcBuilder<'a> {
    pub fn init(
        global: &'a JSGlobalObject,
        outbuf: &'a mut Vec<u8>,
        jsstrs_to_escape: &'a mut Vec<BunString>,
    ) -> Self {
        Self {
            global_this: global,
            outbuf,
            jsstrs_to_escape,
            jsstr_ref_buf: [0u8; 128],
        }
    }

    pub fn append_js_value_str<const ALLOW_ESCAPE: bool>(
        &mut self,
        jsval: JSValue,
    ) -> JsResult<bool> {
        let bunstr = jsval.to_bun_string(self.global_this)?;
        let _guard = scopeguard::guard((), |_| bunstr.deref());

        // Check for null bytes in shell argument (security: prevent null byte injection)
        if bunstr.index_of_ascii_char(0).is_some() {
            return Err(self
                .global_this
                .err(jsc::ErrorCode::INVALID_ARG_VALUE, format_args!(
                    "The shell argument must be a string without null bytes. Received \"{}\"",
                    bunstr.to_zig_string()
                ))
                .throw());
        }

        Ok(self.append_bun_str::<ALLOW_ESCAPE>(bunstr)?)
    }

    pub fn append_bun_str<const ALLOW_ESCAPE: bool>(
        &mut self,
        bunstr: BunString,
    ) -> Result<bool, bun_alloc::AllocError> {
        let invalid = (bunstr.is_utf16() && !bun_str::simdutf::validate::utf16le(bunstr.utf16()))
            || (bunstr.is_utf8() && !bun_str::simdutf::validate::utf8(bunstr.byte_slice()));
        if invalid {
            return Ok(false);
        }
        // Empty interpolated values must still produce an argument (e.g. `${''}` should
        // pass "" as an arg). Route through appendJSStrRef so the \x08 marker is recognized
        // by the lexer regardless of quote context (e.g. inside single quotes).
        if ALLOW_ESCAPE && bunstr.length() == 0 {
            self.append_js_str_ref(bunstr)?;
            return Ok(true);
        }
        if ALLOW_ESCAPE {
            if needs_escape_bunstr(bunstr) {
                self.append_js_str_ref(bunstr)?;
                return Ok(true);
            }
        }
        if bunstr.is_utf16() {
            self.append_utf16_impl(bunstr.utf16())?;
            return Ok(true);
        }
        if bunstr.is_utf8() || strings::is_all_ascii(bunstr.byte_slice()) {
            self.append_utf8_impl(bunstr.byte_slice())?;
            return Ok(true);
        }
        self.append_latin1_impl(bunstr.byte_slice())?;
        Ok(true)
    }

    pub fn append_utf8<const ALLOW_ESCAPE: bool>(
        &mut self,
        utf8: &[u8],
    ) -> Result<bool, bun_core::Error> {
        // TODO(port): narrow error set
        let invalid = bun_str::simdutf::validate::utf8(utf8);
        // PORT NOTE: Zig variable name `invalid` is misleading — it holds the validity bool.
        if !invalid {
            return Ok(false);
        }
        if ALLOW_ESCAPE {
            if needs_escape_utf8_ascii_latin1(utf8) {
                let bunstr = BunString::clone_utf8(utf8);
                let _guard = scopeguard::guard((), |_| bunstr.deref());
                self.append_js_str_ref(bunstr)?;
                return Ok(true);
            }
        }

        self.append_utf8_impl(utf8)?;
        Ok(true)
    }

    pub fn append_utf16_impl(&mut self, utf16: &[u16]) -> Result<(), bun_alloc::AllocError> {
        let size = bun_str::simdutf::utf8_length_from_utf16le(utf16.as_ptr(), utf16.len());
        self.outbuf.reserve(size);
        strings::convert_utf16_to_utf8_append(self.outbuf, utf16)
            .map_err(|_| bun_alloc::AllocError)?;
        // TODO(port): error mapping — Zig propagates encoding error directly.
        Ok(())
    }

    pub fn append_utf8_impl(&mut self, utf8: &[u8]) -> Result<(), bun_alloc::AllocError> {
        self.outbuf.extend_from_slice(utf8);
        Ok(())
    }

    pub fn append_latin1_impl(&mut self, latin1: &[u8]) -> Result<(), bun_alloc::AllocError> {
        let non_ascii_idx = strings::first_non_ascii(latin1).unwrap_or(0);

        if non_ascii_idx > 0 {
            self.append_utf8_impl(&latin1[..non_ascii_idx as usize])?;
        }

        strings::allocate_latin1_into_utf8_with_list(
            self.outbuf,
            self.outbuf.len(),
            latin1,
        )?;
        // TODO(port): Zig reassigns self.outbuf.* to the returned list; here we mutate in place.
        Ok(())
    }

    pub fn append_js_str_ref(&mut self, bunstr: BunString) -> Result<(), bun_alloc::AllocError> {
        let idx = self.jsstrs_to_escape.len();
        let mut cursor = std::io::Cursor::new(&mut self.jsstr_ref_buf[..]);
        write!(cursor, "{}{}", bstr::BStr::new(LEX_JS_STRING_PREFIX), idx)
            .expect("Impossible");
        let n = cursor.position() as usize;
        self.outbuf.extend_from_slice(&self.jsstr_ref_buf[..n]);
        bunstr.ref_();
        self.jsstrs_to_escape.push(bunstr);
        Ok(())
    }
}

// ───────────────────────────── escaping ─────────────────────────────

/// Characters that need to be escaped
const SPECIAL_CHARS: [u8; 34] = [
    b'~', b'[', b']', b'#', b';', b'\n', b'*', b'{', b',', b'}', b'`', b'$', b'=', b'(', b')',
    b'0', b'1', b'2', b'3', b'4', b'5', b'6', b'7', b'8', b'9', b'|', b'>', b'<', b'&', b'\'',
    b'"', b' ', b'\\', SPECIAL_JS_CHAR,
];

const SPECIAL_CHARS_TABLE: IntegerBitSet<256> = {
    let mut table = IntegerBitSet::<256>::empty();
    let mut i = 0;
    while i < SPECIAL_CHARS.len() {
        table = table.with_set(SPECIAL_CHARS[i] as usize);
        i += 1;
    }
    table
};
// TODO(port): IntegerBitSet const-fn API (`empty`/`with_set`/`is_set`) — confirm in bun_collections.

pub fn assert_special_char(c: u8) {
    debug_assert!(SPECIAL_CHARS_TABLE.is_set(c as usize));
}

/// Characters that need to be backslashed inside double quotes
const BACKSLASHABLE_CHARS: [u8; 4] = [b'$', b'`', b'"', b'\\'];

pub fn escape_bun_str<const ADD_QUOTES: bool>(
    bunstr: BunString,
    outbuf: &mut Vec<u8>,
) -> Result<bool, bun_alloc::AllocError> {
    if bunstr.is_utf16() {
        let res = escape_utf16::<ADD_QUOTES>(bunstr.utf16(), outbuf)?;
        return Ok(!res.is_invalid);
    }
    // otherwise should be utf-8, latin-1, or ascii
    escape_8bit::<ADD_QUOTES>(bunstr.byte_slice(), outbuf)?;
    Ok(true)
}

/// works for utf-8, latin-1, and ascii
pub fn escape_8bit<const ADD_QUOTES: bool>(
    str: &[u8],
    outbuf: &mut Vec<u8>,
) -> Result<(), bun_alloc::AllocError> {
    outbuf.reserve(str.len());

    if ADD_QUOTES {
        outbuf.push(b'"');
    }

    'outer: for &c in str {
        for &spc in &BACKSLASHABLE_CHARS {
            if spc == c {
                outbuf.extend_from_slice(&[b'\\', c]);
                continue 'outer;
            }
        }
        outbuf.push(c);
    }

    if ADD_QUOTES {
        outbuf.push(b'"');
    }
    Ok(())
}

pub struct EscapeUtf16Result {
    pub is_invalid: bool,
}

pub fn escape_utf16<const ADD_QUOTES: bool>(
    str: &[u16],
    outbuf: &mut Vec<u8>,
) -> Result<EscapeUtf16Result, bun_alloc::AllocError> {
    if ADD_QUOTES {
        outbuf.push(b'"');
    }

    let non_ascii = strings::first_non_ascii16(str).unwrap_or(0);
    let mut cp_buf = [0u8; 4];

    let mut i: usize = 0;
    'outer: while i < str.len() {
        let char: u32 = 'brk: {
            if i < non_ascii as usize {
                let c = str[i];
                i += 1;
                break 'brk c as u32;
            }
            let ret = strings::utf16_codepoint(&str[i..]);
            if ret.fail {
                return Ok(EscapeUtf16Result { is_invalid: true });
            }
            i += ret.len as usize;
            ret.code_point
        };

        for &bchar in &BACKSLASHABLE_CHARS {
            if bchar as u32 == char {
                outbuf.extend_from_slice(&[b'\\', char as u8]);
                continue 'outer;
            }
        }

        let len = strings::encode_wtf8_rune_t::<u32>(&mut cp_buf, char);
        outbuf.extend_from_slice(&cp_buf[..len as usize]);
    }
    if ADD_QUOTES {
        outbuf.push(b'"');
    }
    Ok(EscapeUtf16Result { is_invalid: false })
}

pub fn needs_escape_bunstr(bunstr: BunString) -> bool {
    if bunstr.is_utf16() {
        return needs_escape_utf16(bunstr.utf16());
    }
    // Otherwise is utf-8, ascii, or latin-1
    needs_escape_utf8_ascii_latin1(bunstr.byte_slice())
}

pub fn needs_escape_utf16(str: &[u16]) -> bool {
    for &codeunit in str {
        if codeunit < 0xff && SPECIAL_CHARS_TABLE.is_set(codeunit as usize) {
            return true;
        }
    }
    false
}

/// Checks for the presence of any char from `SPECIAL_CHARS` in `str`. This
/// indicates the *possibility* that the string must be escaped, so it can have
/// false positives, but it is faster than running the shell lexer through the
/// input string for a more correct implementation.
pub fn needs_escape_utf8_ascii_latin1(str: &[u8]) -> bool {
    for &c in str {
        if SPECIAL_CHARS_TABLE.is_set(c as usize) {
            return true;
        }
    }
    false
}

// ───────────────────────────── SmolList ─────────────────────────────

/// A list that can store its items inlined, and promote itself to a heap allocated BabyList<T>
pub enum SmolList<T, const INLINED_MAX: usize> {
    Inlined(SmolListInlined<T, INLINED_MAX>),
    Heap(BabyList<T>),
}

pub struct SmolListInlined<T, const INLINED_MAX: usize> {
    pub items: [core::mem::MaybeUninit<T>; INLINED_MAX],
    pub len: u32,
}

impl<T, const INLINED_MAX: usize> Default for SmolListInlined<T, INLINED_MAX> {
    fn default() -> Self {
        Self {
            // SAFETY: array of MaybeUninit is always valid uninitialized
            items: unsafe { core::mem::MaybeUninit::uninit().assume_init() },
            len: 0,
        }
    }
}

impl<T, const INLINED_MAX: usize> SmolListInlined<T, INLINED_MAX> {
    pub fn slice(&self) -> &[T] {
        // SAFETY: first `len` elements are initialized
        unsafe {
            core::slice::from_raw_parts(self.items.as_ptr() as *const T, self.len as usize)
        }
    }

    pub fn slice_mut(&mut self) -> &mut [T] {
        unsafe {
            core::slice::from_raw_parts_mut(self.items.as_mut_ptr() as *mut T, self.len as usize)
        }
    }

    pub fn allocated_slice(&self) -> &[core::mem::MaybeUninit<T>] {
        &self.items
    }

    pub fn promote(&mut self, n: usize, new: T) -> BabyList<T> {
        let mut list = BabyList::<T>::with_capacity(n);
        // SAFETY: moving INLINED_MAX initialized elements out
        for i in 0..INLINED_MAX {
            // SAFETY: all INLINED_MAX slots are initialized when promote is called (len == INLINED_MAX)
            let v = unsafe { self.items[i].assume_init_read() };
            list.push(v);
        }
        self.len = 0;
        list.push(new);
        list
    }

    pub fn ordered_remove(&mut self, idx: usize) -> T {
        if self.len as usize - 1 == idx {
            return self.pop();
        }
        // SAFETY: idx < len, elements initialized
        let removed = unsafe { self.items[idx].assume_init_read() };
        unsafe {
            core::ptr::copy(
                self.items.as_ptr().add(idx + 1),
                self.items.as_mut_ptr().add(idx),
                self.len as usize - idx - 1,
            );
        }
        self.len -= 1;
        removed
        // TODO(port): Zig fn returns T but body falls off end without returning the removed item
        // (likely a Zig bug). Here we return it.
    }

    pub fn swap_remove(&mut self, idx: usize) -> T {
        if self.len as usize - 1 == idx {
            return self.pop();
        }
        let old_item = unsafe { self.items[idx].assume_init_read() };
        let last = self.pop();
        self.items[idx].write(last);
        old_item
        // TODO(port): same Zig oddity — pop() decremented len already; restore by writing back.
    }

    pub fn pop(&mut self) -> T {
        let ret = unsafe { self.items[self.len as usize - 1].assume_init_read() };
        self.len -= 1;
        ret
    }
}

// TODO(port): MemoryCost trait for the `@hasDecl(T, "memoryCost")` reflection.
pub trait MemoryCost {
    fn memory_cost(&self) -> usize;
}

impl<T, const INLINED_MAX: usize> SmolList<T, INLINED_MAX> {
    pub fn zeroes() -> Self {
        SmolList::Inlined(SmolListInlined::default())
    }

    pub fn init_with(val: T) -> Self {
        let mut this = Self::zeroes();
        if let SmolList::Inlined(inlined) = &mut this {
            inlined.items[0].write(val);
            inlined.len += 1;
        }
        this
    }

    pub fn memory_cost(&self) -> usize
    where
        T: MemoryCost,
    {
        let mut cost = size_of::<Self>();
        match self {
            SmolList::Inlined(inlined) => {
                // TODO(port): Zig branches on `@hasDecl(T, "memoryCost")` — express via trait/specialization.
                for item in inlined.slice() {
                    cost += item.memory_cost();
                }
            }
            SmolList::Heap(heap) => {
                for item in heap.slice() {
                    cost += item.memory_cost();
                }
                cost += heap.memory_cost();
            }
        }
        cost
    }

    pub fn init_with_slice(vals: &[T]) -> Self
    where
        T: Clone,
    {
        debug_assert!(vals.len() <= u32::MAX as usize);
        if vals.len() <= INLINED_MAX {
            let mut this = Self::zeroes();
            if let SmolList::Inlined(inlined) = &mut this {
                for (i, v) in vals.iter().enumerate() {
                    inlined.items[i].write(v.clone());
                }
                inlined.len += u32::try_from(vals.len()).unwrap();
            }
            return this;
        }
        let mut heap = BabyList::<T>::with_capacity(vals.len());
        heap.extend_from_slice(vals);
        // PERF(port): was assume_capacity
        SmolList::Heap(heap)
    }

    // TODO(port): jsonStringify — wire up serde or custom JSON writer in Phase B.

    #[inline]
    pub fn len(&self) -> usize {
        match self {
            SmolList::Inlined(i) => i.len as usize,
            SmolList::Heap(h) => h.len() as usize,
        }
    }

    pub fn ordered_remove(&mut self, idx: usize) {
        match self {
            SmolList::Heap(h) => {
                let _ = h.ordered_remove(idx);
            }
            SmolList::Inlined(i) => {
                let _ = i.ordered_remove(idx);
            }
        }
    }

    pub fn pop(&mut self) -> T {
        match self {
            SmolList::Heap(h) => h.pop().unwrap(),
            SmolList::Inlined(i) => {
                let val = unsafe { i.items[i.len as usize - 1].assume_init_read() };
                i.len -= 1;
                val
            }
        }
    }

    pub fn swap_remove(&mut self, idx: usize) {
        match self {
            SmolList::Heap(h) => {
                let _ = h.swap_remove(idx);
            }
            SmolList::Inlined(i) => {
                let _ = i.swap_remove(idx);
            }
        }
    }

    pub fn truncate(&mut self, starting_idx: usize) {
        match self {
            SmolList::Inlined(inlined) => {
                if starting_idx >= inlined.len as usize {
                    return;
                }
                let new_len = inlined.len as usize - starting_idx;
                // SAFETY: overlapping copy within initialized region
                unsafe {
                    core::ptr::copy(
                        inlined.items.as_ptr().add(starting_idx),
                        inlined.items.as_mut_ptr(),
                        new_len,
                    );
                }
                inlined.len = u32::try_from(new_len).unwrap();
                // TODO(port): Zig version copies into [0..starting_idx] which is a bug if
                // new_len > starting_idx; mirroring intended semantics (shift-down) here.
            }
            SmolList::Heap(heap) => {
                let new_len = heap.len() as usize - starting_idx;
                // SAFETY: overlapping copy within heap buffer
                unsafe {
                    core::ptr::copy(
                        heap.as_ptr().add(starting_idx),
                        heap.as_mut_ptr(),
                        new_len,
                    );
                }
                heap.set_len(u32::try_from(new_len).unwrap());
            }
        }
    }

    #[inline]
    pub fn slice_mutable(&mut self) -> &mut [T] {
        match self {
            SmolList::Inlined(i) => {
                if i.len == 0 {
                    return &mut [];
                }
                i.slice_mut()
            }
            SmolList::Heap(h) => {
                if h.len() == 0 {
                    return &mut [];
                }
                h.slice_mut()
            }
        }
    }

    #[inline]
    pub fn slice(&self) -> &[T] {
        match self {
            SmolList::Inlined(i) => {
                if i.len == 0 {
                    return &[];
                }
                i.slice()
            }
            SmolList::Heap(h) => {
                if h.len() == 0 {
                    return &[];
                }
                h.slice()
            }
        }
    }

    #[inline]
    pub fn get(&mut self, idx: usize) -> &mut T {
        match self {
            SmolList::Inlined(i) => {
                if cfg!(debug_assertions) && idx >= i.len as usize {
                    panic!("Index out of bounds");
                }
                // SAFETY: idx < len, initialized
                unsafe { i.items[idx].assume_init_mut() }
            }
            SmolList::Heap(h) => &mut h.slice_mut()[idx],
        }
    }

    #[inline]
    pub fn get_const(&self, idx: usize) -> &T {
        match self {
            SmolList::Inlined(i) => {
                if cfg!(debug_assertions) && idx >= i.len as usize {
                    panic!("Index out of bounds");
                }
                unsafe { i.items[idx].assume_init_ref() }
            }
            SmolList::Heap(h) => &h.slice()[idx],
        }
    }

    pub fn append(&mut self, new: T) {
        match self {
            SmolList::Inlined(inlined) => {
                if inlined.len as usize == INLINED_MAX {
                    let promoted = inlined.promote(INLINED_MAX, new);
                    *self = SmolList::Heap(promoted);
                    return;
                }
                inlined.items[inlined.len as usize].write(new);
                inlined.len += 1;
            }
            SmolList::Heap(heap) => {
                heap.push(new);
            }
        }
    }

    pub fn clear_retaining_capacity(&mut self) {
        match self {
            SmolList::Inlined(i) => {
                // TODO(port): drop initialized elements if T: Drop
                i.len = 0;
            }
            SmolList::Heap(h) => h.clear(),
        }
    }

    pub fn last(&mut self) -> Option<&mut T> {
        if self.len() == 0 {
            return None;
        }
        let idx = self.len() - 1;
        Some(self.get(idx))
    }

    pub fn last_unchecked(&mut self) -> &mut T {
        let idx = self.len() - 1;
        self.get(idx)
    }

    pub fn last_unchecked_const(&self) -> &T {
        self.get_const(self.len() - 1)
    }
}

impl<T, const N: usize> Drop for SmolList<T, N> {
    fn drop(&mut self) {
        if let SmolList::Heap(_) = self {
            // BabyList drops itself
        }
        // Inlined: TODO(port): drop initialized elements if T: Drop. Zig deinit only freed heap.
        // Reset to zeroes is implicit.
    }
}

impl<T: fmt::Debug, const N: usize> fmt::Display for SmolList<T, N> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self.slice())
    }
}

// ───────────────────────────── TestingAPIs ─────────────────────────────

/// Used in JS tests, see `internal-for-testing.ts` and shell tests.
pub mod testing_apis {
    use super::*;

    #[bun_jsc::host_fn]
    pub fn disabled_on_this_platform(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        #[cfg(windows)]
        {
            return Ok(JSValue::FALSE);
        }
        #[cfg(not(windows))]
        {
            let arguments_ = callframe.arguments_old(1);
            let mut arguments =
                jsc::CallFrame::ArgumentsSlice::init(global.bun_vm(), arguments_.slice());
            let string = match arguments.next_eat() {
                Some(s) => s,
                None => {
                    return Err(global.throw(format_args!(
                        "shellInternals.disabledOnPosix: expected 1 arguments, got 0"
                    )));
                }
            };

            let bunstr = string.to_bun_string(global)?;
            let _g1 = scopeguard::guard((), |_| bunstr.deref());
            let utf8str = bunstr.to_utf8();

            for disabled in interpret::Interpreter::Builtin::Kind::DISABLED_ON_POSIX {
                if utf8str.byte_slice() == <&'static str>::from(*disabled).as_bytes() {
                    return Ok(JSValue::TRUE);
                }
            }
            Ok(JSValue::FALSE)
        }
    }

    // TODO(port): jsc::MarkedArgumentBuffer::wrap — generates a host_fn shim that allocates a
    // MarkedArgumentBuffer and forwards to the impl. Hand-write or proc-macro in Phase B.
    pub const SHELL_LEX: jsc::JSHostFn = jsc::MarkedArgumentBuffer::wrap(shell_lex_impl);

    fn shell_lex_impl(
        global: &JSGlobalObject,
        callframe: &CallFrame,
        marked_argument_buffer: &mut MarkedArgumentBuffer,
    ) -> JsResult<JSValue> {
        let arguments_ = callframe.arguments_old(2);
        let mut arguments =
            jsc::CallFrame::ArgumentsSlice::init(global.bun_vm(), arguments_.slice());
        let string_args = match arguments.next_eat() {
            Some(s) => s,
            None => {
                return Err(global.throw(format_args!(
                    "shell_parse: expected 2 arguments, got 0"
                )));
            }
        };

        let arena = Bump::new();

        let template_args_js = match arguments.next_eat() {
            Some(s) => s,
            None => {
                return Err(global.throw(format_args!("shell: expected 2 arguments, got 0")));
            }
        };
        let mut template_args = template_args_js.array_iterator(global)?;
        // PERF(port): was stack-fallback (4 BunString) — profile in Phase B
        let mut jsstrings: Vec<BunString> = Vec::with_capacity(4);
        let _jsstrings_guard = scopeguard::guard(&mut jsstrings as *mut _, |p| {
            // SAFETY: pointer valid for scope
            let v: &mut Vec<BunString> = unsafe { &mut *p };
            for bunstr in v.iter() {
                bunstr.deref();
            }
        });
        // TODO(port): scopeguard captures &mut over the same Vec used below — borrowck conflict.
        let mut jsobjs: Vec<JSValue> = Vec::new();

        let mut script: Vec<u8> = Vec::new();
        shell_cmd_from_js(
            global,
            string_args,
            &mut template_args,
            &mut jsobjs,
            &mut jsstrings,
            &mut script,
            marked_argument_buffer,
        )?;

        let jsobjs_len: u32 = u32::try_from(jsobjs.len()).unwrap();
        let lex_result = 'brk: {
            if strings::is_all_ascii(&script[..]) {
                let mut lexer =
                    LexerAscii::new(&arena, &script[..], &mut jsstrings[..], jsobjs_len);
                if let Err(err) = lexer.lex() {
                    return Err(global.throw_error(err.into(), "failed to lex shell"));
                }
                break 'brk lexer.get_result();
            }
            let mut lexer =
                LexerUnicode::new(&arena, &script[..], &mut jsstrings[..], jsobjs_len);
            if let Err(err) = lexer.lex() {
                return Err(global.throw_error(err.into(), "failed to lex shell"));
            }
            lexer.get_result()
        };

        if !lex_result.errors.is_empty() {
            let str = lex_result.combine_errors(&arena);
            return Err(global.throw_pretty(format_args!("{}", bstr::BStr::new(str))));
        }

        let mut test_tokens: Vec<test::TestToken> =
            Vec::with_capacity(lex_result.tokens.len());
        for &tok in lex_result.tokens {
            let test_tok = test::TestToken::from_real(tok, lex_result.strpool);
            test_tokens.push(test_tok);
        }

        // TODO(port): std.json.fmt — serde_json or custom JSON serializer in Phase B.
        let mut str = Vec::new();
        write!(&mut str, "{}", bun_core::json::fmt(&test_tokens[..])).unwrap();

        let mut bun_str = BunString::from_bytes(&str);
        // TODO(port): move to *_jsc — to_js() lives in StringJsc extension trait
        Ok(bun_str.to_js(global))
    }

    pub const SHELL_PARSE: jsc::JSHostFn = jsc::MarkedArgumentBuffer::wrap(shell_parse_impl);

    fn shell_parse_impl(
        global: &JSGlobalObject,
        callframe: &CallFrame,
        marked_argument_buffer: &mut MarkedArgumentBuffer,
    ) -> JsResult<JSValue> {
        let arguments_ = callframe.arguments_old(2);
        let mut arguments =
            jsc::CallFrame::ArgumentsSlice::init(global.bun_vm(), arguments_.slice());
        let string_args = match arguments.next_eat() {
            Some(s) => s,
            None => {
                return Err(global.throw(format_args!(
                    "shell_parse: expected 2 arguments, got 0"
                )));
            }
        };

        let arena = Bump::new();

        let template_args_js = match arguments.next_eat() {
            Some(s) => s,
            None => {
                return Err(global.throw(format_args!("shell: expected 2 arguments, got 0")));
            }
        };
        let mut template_args = template_args_js.array_iterator(global)?;
        // PERF(port): was stack-fallback
        let mut jsstrings: Vec<BunString> = Vec::with_capacity(4);
        // TODO(port): defer-loop dereffing jsstrings (same scopeguard issue as above)
        let mut jsobjs: Vec<JSValue> = Vec::new();
        let mut script: Vec<u8> = Vec::new();
        shell_cmd_from_js(
            global,
            string_args,
            &mut template_args,
            &mut jsobjs,
            &mut jsstrings,
            &mut script,
            marked_argument_buffer,
        )?;

        let mut out_parser: Option<Parser> = None;
        let mut out_lex_result: Option<LexResult> = None;

        let script_ast = match interpret::Interpreter::parse(
            &arena,
            &script[..],
            &mut jsobjs[..],
            &mut jsstrings[..],
            &mut out_parser,
            &mut out_lex_result,
        ) {
            Ok(a) => a,
            Err(err) => {
                if err == bun_core::err!("Lex") {
                    debug_assert!(out_lex_result.is_some());
                    let str = out_lex_result.unwrap().combine_errors(&arena);
                    return Err(global.throw_pretty(format_args!("{}", bstr::BStr::new(str))));
                }

                if let Some(p) = &mut out_parser {
                    let errstr = p.combine_errors();
                    return Err(
                        global.throw_pretty(format_args!("{}", bstr::BStr::new(errstr)))
                    );
                }

                return Err(global.throw_error(err, "failed to lex/parse shell"));
            }
        };

        // TODO(port): std.json.fmt
        let mut str = Vec::new();
        write!(&mut str, "{}", bun_core::json::fmt(&script_ast)).unwrap();

        BunString::create_utf8_for_js(global, &str)
    }
}
pub use testing_apis as TestingAPIs;

pub use subproc::ShellSubprocess;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/shell.zig (4706 lines)
//   confidence: medium
//   todos:      55
//   notes:      Arena ('bump) lifetimes threaded through AST/Parser/Lexer; Lexer<const ENCODING> uses runtime Src enum (Zig comptime type-switch); SmolList uses MaybeUninit; lex() control-flow models Zig `break :escaped`+trailing-`continue` via fell_through flag; sublexer/subparser ArrayList copy-by-value reshaped to mem::replace; several jsc/WebCore/json APIs stubbed.
// ──────────────────────────────────────────────────────────────────────────
