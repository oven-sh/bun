// This file contains the underlying implementation for sync & async functions
// for interacting with the filesystem from JavaScript.
// The top-level functions assume the arguments are already validated

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::mem::offset_of;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use bun_aio::KeepAlive;
use bun_alloc::ArenaAllocator;
use bun_collections::UnboundedQueue;
use bun_core::Environment;
use bun_jsc::{
    CallFrame, ConcurrentTask, EventLoopHandle, JSGlobalObject, JSPromise, JSValue, JsError,
    JsResult, MiniEventLoop, Task, VirtualMachine, ZigString,
};
use bun_jsc::node::{
    self as node, ArgumentsSlice, Dirent, Encoding, FileSystemFlags, PathLike,
    PathOrFileDescriptor, Stats, StringOrBuffer, TimeLike, VectorArrayBuffer,
};
use bun_jsc::debugger::AsyncTaskTracker;
use bun_jsc::webcore::{self, AbortSignal, Blob};
use bun_paths::{self as paths, OSPathBuffer, OSPathChar, OSPathSliceZ, PathBuffer, PathString};
use bun_str::{self as bstr, strings, String as BunString, ZStr};
use bun_sys::{self as sys, Fd as FD, Maybe, Mode, SystemErrno, E};
use bun_threading::{WorkPool, WorkPoolTask};

pub use super::node_fs_constant as constants;
pub use super::node_fs_binding::Binding;
pub use super::node_fs_watcher::FSWatcher as Watcher;
pub use super::node_fs_stat_watcher::StatWatcher;

use super::dir_iterator as DirIterator;
use bun_resolver::fs::FileSystem;

#[cfg(windows)]
use bun_sys::windows::{self, libuv as uv};
#[cfg(not(windows))]
use bun_sys::libuv_stub as uv; // TODO(port): uv stubs on posix

// Syscall = bun.sys.sys_uv on Windows, bun.sys otherwise
#[cfg(windows)]
use bun_sys::sys_uv as Syscall;
#[cfg(not(windows))]
use bun_sys as Syscall;

type ReadPosition = i64;
type Buffer = bun_jsc::node::Buffer;
type ArrayBuffer = bun_jsc::MarkedArrayBuffer;
type GidT = node::gid_t;
type UidT = node::uid_t;

#[cfg(unix)]
pub const DEFAULT_PERMISSION: Mode = sys::S::IRUSR
    | sys::S::IWUSR
    | sys::S::IRGRP
    | sys::S::IWGRP
    | sys::S::IROTH
    | sys::S::IWOTH;
#[cfg(not(unix))]
// Windows does not have permissions
pub const DEFAULT_PERMISSION: Mode = 0;

/// All async FS functions are run in a thread pool, but some implementations may
/// decide to do something slightly different. For example, reading a file has
/// an extra stack buffer in the async case.
#[derive(Copy, Clone, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum Flavor {
    Sync,
    Async,
}

// ──────────────────────────────────────────────────────────────────────────
// Async task type aliases
// ──────────────────────────────────────────────────────────────────────────
pub mod async_ {
    use super::*;

    pub type Access = AsyncFSTask<ret::Access, args::Access, { NodeFSFunctionEnum::Access }>;
    pub type AppendFile = AsyncFSTask<ret::AppendFile, args::AppendFile, { NodeFSFunctionEnum::AppendFile }>;
    pub type Chmod = AsyncFSTask<ret::Chmod, args::Chmod, { NodeFSFunctionEnum::Chmod }>;
    pub type Chown = AsyncFSTask<ret::Chown, args::Chown, { NodeFSFunctionEnum::Chown }>;
    pub type Close = UVFSRequest<ret::Close, args::Close, { NodeFSFunctionEnum::Close }>;
    pub type CopyFile = AsyncFSTask<ret::CopyFile, args::CopyFile, { NodeFSFunctionEnum::CopyFile }>;
    pub type Exists = AsyncFSTask<ret::Exists, args::Exists, { NodeFSFunctionEnum::Exists }>;
    pub type Fchmod = AsyncFSTask<ret::Fchmod, args::FChmod, { NodeFSFunctionEnum::Fchmod }>;
    pub type Fchown = AsyncFSTask<ret::Fchown, args::Fchown, { NodeFSFunctionEnum::Fchown }>;
    pub type Fdatasync = AsyncFSTask<ret::Fdatasync, args::FdataSync, { NodeFSFunctionEnum::Fdatasync }>;
    pub type Fstat = AsyncFSTask<ret::Fstat, args::Fstat, { NodeFSFunctionEnum::Fstat }>;
    pub type Fsync = AsyncFSTask<ret::Fsync, args::Fsync, { NodeFSFunctionEnum::Fsync }>;
    pub type Ftruncate = AsyncFSTask<ret::Ftruncate, args::FTruncate, { NodeFSFunctionEnum::Ftruncate }>;
    pub type Futimes = AsyncFSTask<ret::Futimes, args::Futimes, { NodeFSFunctionEnum::Futimes }>;
    pub type Lchmod = AsyncFSTask<ret::Lchmod, args::LCHmod, { NodeFSFunctionEnum::Lchmod }>;
    pub type Lchown = AsyncFSTask<ret::Lchown, args::LChown, { NodeFSFunctionEnum::Lchown }>;
    pub type Link = AsyncFSTask<ret::Link, args::Link, { NodeFSFunctionEnum::Link }>;
    pub type Lstat = AsyncFSTask<ret::Stat, args::Stat, { NodeFSFunctionEnum::Lstat }>;
    pub type Lutimes = AsyncFSTask<ret::Lutimes, args::Lutimes, { NodeFSFunctionEnum::Lutimes }>;
    pub type Mkdir = AsyncFSTask<ret::Mkdir, args::Mkdir, { NodeFSFunctionEnum::Mkdir }>;
    pub type Mkdtemp = AsyncFSTask<ret::Mkdtemp, args::MkdirTemp, { NodeFSFunctionEnum::Mkdtemp }>;
    pub type Open = UVFSRequest<ret::Open, args::Open, { NodeFSFunctionEnum::Open }>;
    pub type Read = UVFSRequest<ret::Read, args::Read, { NodeFSFunctionEnum::Read }>;
    pub type Readdir = AsyncFSTask<ret::Readdir, args::Readdir, { NodeFSFunctionEnum::Readdir }>;
    pub type ReadFile = AsyncFSTask<ret::ReadFile, args::ReadFile, { NodeFSFunctionEnum::ReadFile }>;
    pub type Readlink = AsyncFSTask<ret::Readlink, args::Readlink, { NodeFSFunctionEnum::Readlink }>;
    pub type Readv = UVFSRequest<ret::Readv, args::Readv, { NodeFSFunctionEnum::Readv }>;
    pub type Realpath = AsyncFSTask<ret::Realpath, args::Realpath, { NodeFSFunctionEnum::Realpath }>;
    pub type RealpathNonNative = AsyncFSTask<ret::Realpath, args::Realpath, { NodeFSFunctionEnum::RealpathNonNative }>;
    pub type Rename = AsyncFSTask<ret::Rename, args::Rename, { NodeFSFunctionEnum::Rename }>;
    pub type Rm = AsyncFSTask<ret::Rm, args::Rm, { NodeFSFunctionEnum::Rm }>;
    pub type Rmdir = AsyncFSTask<ret::Rmdir, args::RmDir, { NodeFSFunctionEnum::Rmdir }>;
    pub type Stat = AsyncFSTask<ret::Stat, args::Stat, { NodeFSFunctionEnum::Stat }>;
    pub type Symlink = AsyncFSTask<ret::Symlink, args::Symlink, { NodeFSFunctionEnum::Symlink }>;
    pub type Truncate = AsyncFSTask<ret::Truncate, args::Truncate, { NodeFSFunctionEnum::Truncate }>;
    pub type Unlink = AsyncFSTask<ret::Unlink, args::Unlink, { NodeFSFunctionEnum::Unlink }>;
    pub type Utimes = AsyncFSTask<ret::Utimes, args::Utimes, { NodeFSFunctionEnum::Utimes }>;
    pub type Write = UVFSRequest<ret::Write, args::Write, { NodeFSFunctionEnum::Write }>;
    pub type WriteFile = AsyncFSTask<ret::WriteFile, args::WriteFile, { NodeFSFunctionEnum::WriteFile }>;
    pub type Writev = UVFSRequest<ret::Writev, args::Writev, { NodeFSFunctionEnum::Writev }>;
    pub type Statfs = UVFSRequest<ret::StatFS, args::StatFS, { NodeFSFunctionEnum::Statfs }>;

    const _: () = assert!(ReadFile::HAVE_ABORT_SIGNAL);
    const _: () = assert!(WriteFile::HAVE_ABORT_SIGNAL);

    pub type Cp = AsyncCpTask;
    pub type ReaddirRecursive = AsyncReaddirRecursiveTask;

    /// Used internally. Not from JavaScript.
    pub struct AsyncMkdirp {
        pub completion_ctx: *mut (),
        pub completion: fn(*mut (), Maybe<()>),
        /// Memory is not owned by this struct
        pub path: *const [u8], // BORROW: not owned
        pub task: WorkPoolTask,
    }

    impl AsyncMkdirp {
        pub fn new(init: AsyncMkdirp) -> Box<Self> {
            Box::new(init)
        }

        pub fn work_pool_callback(task: *mut WorkPoolTask) {
            // SAFETY: task points to AsyncMkdirp.task
            let this: &mut AsyncMkdirp = unsafe {
                &mut *((task as *mut u8).sub(offset_of!(AsyncMkdirp, task)).cast::<AsyncMkdirp>())
            };

            let mut node_fs = NodeFS::default();
            // SAFETY: caller keeps `path` alive until completion
            let path = unsafe { &*this.path };
            let result = node_fs.mkdir_recursive(args::Mkdir {
                path: PathLike::String(PathString::init(path)),
                recursive: true,
                ..Default::default()
            });
            match result {
                Maybe::Err(err) => {
                    (this.completion)(
                        this.completion_ctx,
                        Maybe::Err(err.with_path(Box::<[u8]>::from(err.path()))),
                    );
                }
                Maybe::Ok(_) => {
                    (this.completion)(this.completion_ctx, Maybe::SUCCESS);
                }
            }
        }

        pub fn schedule(&mut self) {
            WorkPool::schedule(&mut self.task);
        }
    }

    impl Default for AsyncMkdirp {
        fn default() -> Self {
            Self {
                completion_ctx: core::ptr::null_mut(),
                completion: |_, _| {},
                path: core::ptr::slice_from_raw_parts(core::ptr::null(), 0),
                task: WorkPoolTask { callback: Self::work_pool_callback },
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// NewUVFSRequest — Windows-only async wrapper around libuv fs requests.
// On non-Windows it is just AsyncFSTask.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
pub type UVFSRequest<R, A, const F: NodeFSFunctionEnum> = AsyncFSTask<R, A, F>;

#[cfg(windows)]
pub struct UVFSRequest<R, A, const F: NodeFSFunctionEnum> {
    pub promise: JSPromise::Strong,
    pub args: A,
    pub global_object: *mut JSGlobalObject,
    pub req: uv::fs_t,
    pub result: Maybe<R>,
    pub r#ref: KeepAlive,
    pub tracker: AsyncTaskTracker,
}

#[cfg(windows)]
impl<R, A: FsArgument, const F: NodeFSFunctionEnum> UVFSRequest<R, A, F> {
    // TODO(port): heap_label = "Async" ++ typeBaseName(A) ++ "UvTask" — needs proc-macro
    pub const HEAP_LABEL: &'static str = "AsyncUvTask";

    pub fn create(
        global_object: &JSGlobalObject,
        binding: &mut Binding,
        task_args: A,
        vm: &mut VirtualMachine,
    ) -> JSValue {
        let mut task = Box::new(Self {
            promise: JSPromise::Strong::init(global_object),
            args: task_args,
            result: unsafe { core::mem::zeroed() }, // SAFETY: written before read
            global_object: global_object as *const _ as *mut _,
            req: unsafe { core::mem::zeroed() },
            r#ref: KeepAlive::default(),
            tracker: AsyncTaskTracker::init(vm),
        });
        task.r#ref.ref_(vm);
        task.args.to_thread_safe();
        task.tracker.did_schedule(global_object);

        let log = sys::syslog;
        let loop_ = uv::Loop::get();
        task.req.data = (&mut *task) as *mut Self as *mut c_void;

        // TODO(port): comptime switch on FunctionEnum dispatching to uv_fs_open/close/read/write/readv/writev/statfs.
        // The full body is mechanical libuv plumbing; preserved as a per-variant match below.
        match F {
            NodeFSFunctionEnum::Open => {
                // TODO(port): see node_fs.zig:161-174
            }
            NodeFSFunctionEnum::Close => {
                // TODO(port): see node_fs.zig:175-189
            }
            NodeFSFunctionEnum::Read => { /* TODO(port) */ }
            NodeFSFunctionEnum::Write => { /* TODO(port) */ }
            NodeFSFunctionEnum::Readv => { /* TODO(port) */ }
            NodeFSFunctionEnum::Writev => { /* TODO(port) */ }
            NodeFSFunctionEnum::Statfs => { /* TODO(port) */ }
            _ => unreachable!("UVFSRequest type not implemented"),
        }

        let _ = (log, loop_, binding);
        task.promise.value()
    }

    extern "C" fn uv_callback(req: *mut uv::fs_t) {
        // SAFETY: req.data was set to Box<Self> in create()
        let this: &mut Self = unsafe { &mut *((*req).data as *mut Self) };
        let _cleanup = scopeguard::guard((), |_| unsafe { uv::uv_fs_req_cleanup(req) });
        let mut node_fs = NodeFS::default();
        // TODO(port): dispatch to NodeFS::uv_<F>(&node_fs, this.args, req.result as i64)
        this.result = NodeFS::uv_dispatch::<R, A, F>(&mut node_fs, &this.args, unsafe { (*req).result } as i64);
        if let Maybe::Err(err) = &mut this.result {
            *err = err.clone();
            core::hint::black_box(&node_fs);
        }
        unsafe { &*this.global_object }.bun_vm().event_loop().enqueue_task(Task::init(this));
    }

    extern "C" fn uv_callbackreq(req: *mut uv::fs_t) {
        // Same as uv_callback but passes `req` to the dispatch fn (statfs needs req.ptr).
        // TODO(port): mirror node_fs.zig:276-288
        Self::uv_callback(req);
    }

    pub fn run_from_js_thread(&mut self) -> Result<(), bun_jsc::JSTerminated> {
        let _deinit = scopeguard::guard(self as *mut Self, |p| unsafe { (*p).deinit() });
        let global_object = unsafe { &*self.global_object };
        let success = matches!(self.result, Maybe::Ok(_));
        let promise_value = self.promise.value();
        let promise = self.promise.get();
        let result = match &mut self.result {
            Maybe::Err(err) => match err.to_js_with_async_stack(global_object, promise) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, global_object.take_exception(e)),
            },
            Maybe::Ok(res) => match global_object.to_js(res) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, global_object.take_exception(e)),
            },
        };
        promise_value.ensure_still_alive();

        let tracker = self.tracker;
        tracker.will_dispatch(global_object);
        let _did = scopeguard::guard((), |_| tracker.did_dispatch(global_object));

        if success {
            promise.resolve(global_object, result)?;
        } else {
            promise.reject(global_object, result)?;
        }
        Ok(())
    }

    pub fn deinit(&mut self) {
        if let Maybe::Err(err) = &mut self.result {
            err.deinit();
        }
        self.r#ref.unref(unsafe { &*self.global_object }.bun_vm());
        self.args.deinit_and_unprotect();
        self.promise.deinit();
        // SAFETY: self was Box::into_raw'd; reconstitute and drop.
        unsafe { drop(Box::from_raw(self as *mut Self)) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// NewAsyncFSTask — runs a NodeFS method on the thread pool.
// ──────────────────────────────────────────────────────────────────────────

/// Trait abstracting over Argument types' deinit/toThreadSafe.
pub trait FsArgument {
    const HAVE_ABORT_SIGNAL: bool = false;
    fn to_thread_safe(&mut self);
    fn deinit_and_unprotect(&mut self);
    fn signal(&self) -> Option<&AbortSignal> { None }
}

pub struct AsyncFSTask<R, A, const F: NodeFSFunctionEnum> {
    pub promise: JSPromise::Strong,
    pub args: A,
    pub global_object: *mut JSGlobalObject,
    pub task: WorkPoolTask,
    pub result: Maybe<R>,
    pub r#ref: KeepAlive,
    pub tracker: AsyncTaskTracker,
}

impl<R, A: FsArgument, const F: NodeFSFunctionEnum> AsyncFSTask<R, A, F> {
    /// NewAsyncFSTask supports cancelable operations via AbortSignal,
    /// so long as a "signal" field exists. The task wrapper will ensure
    /// a promise rejection happens if signaled, but if `function` is
    /// already called, no guarantees are made. It is recommended for
    /// the functions to check .signal.aborted() for early returns.
    pub const HAVE_ABORT_SIGNAL: bool = A::HAVE_ABORT_SIGNAL;
    // TODO(port): heap_label = "Async" ++ typeBaseName(A) ++ "Task"
    pub const HEAP_LABEL: &'static str = "AsyncFSTask";

    pub fn create(
        global_object: &JSGlobalObject,
        _binding: &mut Binding,
        args: A,
        vm: &mut VirtualMachine,
    ) -> JSValue {
        let mut task = Box::new(Self {
            promise: JSPromise::Strong::init(global_object),
            args,
            result: unsafe { core::mem::zeroed() }, // SAFETY: written before read
            global_object: global_object as *const _ as *mut _,
            task: WorkPoolTask { callback: Self::work_pool_callback },
            r#ref: KeepAlive::default(),
            tracker: AsyncTaskTracker::init(vm),
        });
        task.r#ref.ref_(vm);
        task.args.to_thread_safe();
        task.tracker.did_schedule(global_object);
        let promise = task.promise.value();
        WorkPool::schedule(&mut Box::leak(task).task);
        promise
    }

    fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: task points to Self.task
        let this: &mut Self = unsafe {
            &mut *((task as *mut u8).sub(offset_of!(Self, task)).cast::<Self>())
        };

        let mut node_fs = NodeFS::default();
        // TODO(port): dispatch via NodeFSFunctionEnum const-generic to the correct NodeFS method
        this.result = NodeFS::dispatch::<R, A, F>(&mut node_fs, &this.args, Flavor::Async);

        if let Maybe::Err(err) = &mut this.result {
            *err = err.clone();
            core::hint::black_box(&node_fs);
        }

        unsafe { &*this.global_object }
            .bun_vm_concurrently()
            .event_loop()
            .enqueue_task_concurrent(ConcurrentTask::create_from(this));
    }

    pub fn run_from_js_thread(&mut self) -> Result<(), bun_jsc::JSTerminated> {
        let _deinit = scopeguard::guard(self as *mut Self, |p| unsafe { (*p).deinit() });
        let global_object = unsafe { &*self.global_object };

        let tracker = self.tracker;
        tracker.will_dispatch(global_object);
        let _did = scopeguard::guard((), |_| tracker.did_dispatch(global_object));

        let success = matches!(self.result, Maybe::Ok(_));
        let promise_value = self.promise.value();
        let promise = self.promise.get();
        let result = match &mut self.result {
            Maybe::Err(err) => match err.to_js_with_async_stack(global_object, promise) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, global_object.take_exception(e)),
            },
            Maybe::Ok(res) => match global_object.to_js(res) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, global_object.take_exception(e)),
            },
        };
        promise_value.ensure_still_alive();

        if Self::HAVE_ABORT_SIGNAL {
            if let Some(signal) = self.args.signal() {
                if let Some(reason) = signal.reason_if_aborted(global_object) {
                    return promise.reject(global_object, reason.to_js(global_object));
                }
            }
        }

        if success {
            promise.resolve(global_object, result)?;
        } else {
            promise.reject(global_object, result)?;
        }
        Ok(())
    }

    pub fn deinit(&mut self) {
        if let Maybe::Err(err) = &mut self.result {
            err.deinit();
        }
        self.r#ref.unref(unsafe { &*self.global_object }.bun_vm());
        self.args.deinit_and_unprotect();
        self.promise.deinit();
        // SAFETY: self was Box::leak'd; reconstitute and drop.
        unsafe { drop(Box::from_raw(self as *mut Self)) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// AsyncCpTask
// ──────────────────────────────────────────────────────────────────────────

pub type AsyncCpTask = NewAsyncCpTask<false>;
pub type ShellAsyncCpTask = NewAsyncCpTask<true>;

type ShellCpTask = bun_shell::Interpreter::Builtin::Cp::ShellCpTask;

pub struct NewAsyncCpTask<const IS_SHELL: bool> {
    pub promise: JSPromise::Strong,
    pub args: args::Cp,
    pub evtloop: EventLoopHandle,
    pub task: WorkPoolTask,
    pub result: Maybe<ret::Cp>,
    /// If this task is called by the shell then we shouldn't call this as
    /// it is not threadsafe and is unnecessary as the process will be kept
    /// alive by the shell instance
    // TODO(port): conditional field — using KeepAlive unconditionally; on shell path it's never ref()'d
    pub r#ref: KeepAlive,
    pub arena: ArenaAllocator,
    pub tracker: AsyncTaskTracker,
    pub has_result: AtomicBool,
    /// Number of in-flight references to `this`. Starts at 1 for the main
    /// directory-scan task; incremented for each `SingleTask` spawned. Every
    /// holder calls `onSubtaskDone` exactly once when finished (regardless of
    /// success or error). `runFromJSThread` — which destroys `this` — is only
    /// enqueued once the count reaches zero, so subtasks still running on the
    /// thread pool never dereference a freed parent.
    pub subtask_count: AtomicUsize,
    // BACKREF: only valid when IS_SHELL
    pub shelltask: *mut ShellCpTask,
}

/// This task is used by `AsyncCpTask/fs.promises.cp` to copy a single file.
/// When clonefile cannot be used, this task is started once per file.
pub struct CpSingleTask<const IS_SHELL: bool> {
    pub cp_task: *mut NewAsyncCpTask<IS_SHELL>,
    pub src: OSPathSliceZ,  // points into owned path_buf
    pub dest: OSPathSliceZ, // points into owned path_buf
    pub task: WorkPoolTask,
}

impl<const IS_SHELL: bool> CpSingleTask<IS_SHELL> {
    pub fn create(parent: *mut NewAsyncCpTask<IS_SHELL>, src: OSPathSliceZ, dest: OSPathSliceZ) {
        let task = Box::new(CpSingleTask {
            cp_task: parent,
            src,
            dest,
            task: WorkPoolTask { callback: Self::work_pool_callback },
        });
        WorkPool::schedule(&mut Box::leak(task).task);
    }

    fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: task points to Self.task
        let this: &mut Self = unsafe {
            &mut *((task as *mut u8).sub(offset_of!(Self, task)).cast::<Self>())
        };
        let parent = unsafe { &mut *this.cp_task };

        // TODO: error strings on node_fs will die
        let mut node_fs = NodeFS::default();

        let args = &parent.args;
        let result = node_fs._copy_single_file_sync(
            this.src,
            this.dest,
            constants::Copyfile::from_raw(
                if args.flags.error_on_exist || !args.flags.force { constants::COPYFILE_EXCL } else { 0u8 },
            ),
            None,
            &parent.args,
        );

        'brk: {
            match result {
                Maybe::Err(ref err) => {
                    if err.errno == E::EXIST as _ && !args.flags.error_on_exist {
                        break 'brk;
                    }
                    parent.finish_concurrently(result);
                }
                Maybe::Ok(_) => {
                    parent.on_copy(this.src, this.dest);
                }
            }
        }

        this.deinit();
        // Must be the very last use of `parent`: when the count reaches
        // zero, runFromJSThread is enqueued and may destroy the parent.
        parent.on_subtask_done();
    }

    pub fn deinit(&mut self) {
        // There is only one path buffer for both paths. 2 extra bytes are the nulls at the end of each
        let total_len = self.src.len() + self.dest.len() + 2;
        // SAFETY: src.ptr is the start of a heap allocation of `total_len` OSPathChar
        unsafe {
            drop(Box::from_raw(core::slice::from_raw_parts_mut(
                self.src.as_ptr() as *mut OSPathChar,
                total_len,
            )));
        }
        unsafe { drop(Box::from_raw(self as *mut Self)) };
    }
}

impl<const IS_SHELL: bool> NewAsyncCpTask<IS_SHELL> {
    pub fn on_copy(&mut self, src: impl AsRef<[OSPathChar]>, dest: impl AsRef<[OSPathChar]>) {
        if !IS_SHELL { return; }
        unsafe { &mut *self.shelltask }.cp_on_copy(src, dest);
    }

    pub fn on_finish(&mut self, result: Maybe<()>) {
        if !IS_SHELL { return; }
        unsafe { &mut *self.shelltask }.cp_on_finish(result);
    }

    pub fn create(
        global_object: &JSGlobalObject,
        _binding: &mut Binding,
        cp_args: args::Cp,
        vm: &mut VirtualMachine,
        arena: ArenaAllocator,
    ) -> JSValue {
        let task = Self::create_with_shell_task(global_object, cp_args, vm, arena, core::ptr::null_mut(), true);
        unsafe { &*task }.promise.value()
    }

    pub fn create_with_shell_task(
        global_object: &JSGlobalObject,
        cp_args: args::Cp,
        vm: &mut VirtualMachine,
        arena: ArenaAllocator,
        shelltask: *mut ShellCpTask,
        enable_promise: bool,
    ) -> *mut Self {
        let mut task = Box::new(Self {
            promise: if enable_promise { JSPromise::Strong::init(global_object) } else { JSPromise::Strong::default() },
            args: cp_args,
            has_result: AtomicBool::new(false),
            result: unsafe { core::mem::zeroed() },
            evtloop: EventLoopHandle::Js(vm.event_loop),
            task: WorkPoolTask { callback: Self::work_pool_callback },
            r#ref: KeepAlive::default(),
            tracker: AsyncTaskTracker::init(vm),
            arena,
            subtask_count: AtomicUsize::new(1),
            shelltask,
        });
        if !IS_SHELL { task.r#ref.ref_(vm); }
        task.args.src.to_thread_safe();
        task.args.dest.to_thread_safe();
        task.tracker.did_schedule(global_object);

        let raw = Box::leak(task);
        WorkPool::schedule(&mut raw.task);
        raw
    }

    pub fn create_mini(
        cp_args: args::Cp,
        mini: &mut MiniEventLoop,
        arena: ArenaAllocator,
        shelltask: *mut ShellCpTask,
    ) -> *mut Self {
        let mut task = Box::new(Self {
            promise: JSPromise::Strong::default(),
            args: cp_args,
            has_result: AtomicBool::new(false),
            result: unsafe { core::mem::zeroed() },
            evtloop: EventLoopHandle::Mini(mini),
            task: WorkPoolTask { callback: Self::work_pool_callback },
            r#ref: KeepAlive::default(),
            tracker: AsyncTaskTracker { id: 0 },
            arena,
            subtask_count: AtomicUsize::new(1),
            shelltask,
        });
        if !IS_SHELL { task.r#ref.ref_(mini); }
        task.args.src.to_thread_safe();
        task.args.dest.to_thread_safe();

        let raw = Box::leak(task);
        WorkPool::schedule(&mut raw.task);
        raw
    }

    fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: task points to Self.task
        let this: &mut Self = unsafe {
            &mut *((task as *mut u8).sub(offset_of!(Self, task)).cast::<Self>())
        };
        let mut node_fs = NodeFS::default();
        Self::cp_async(&mut node_fs, this);
    }

    /// May be called from any thread (the subtasks).
    /// Records the result (first caller wins). Does NOT schedule destruction —
    /// `runFromJSThread` is only enqueued from `onSubtaskDone` once every
    /// in-flight subtask has dropped its reference, so that subtasks still
    /// running on the thread pool don't dereference a freed parent.
    fn finish_concurrently(&mut self, result: Maybe<ret::Cp>) {
        if self.has_result.compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed).is_err() {
            return;
        }
        self.result = result;
        if let Maybe::Err(err) = &mut self.result {
            *err = err.clone();
        }
    }

    /// Called exactly once by the main directory-scan task and once by each
    /// `SingleTask` when it is done touching `this`. The last caller (count
    /// drops to zero) enqueues `runFromJSThread`, which resolves the promise
    /// and destroys `this`.
    fn on_subtask_done(&mut self) {
        let old_count = self.subtask_count.fetch_sub(1, Ordering::AcqRel);
        debug_assert!(old_count > 0);
        if old_count != 1 { return; }

        // All subtasks have finished. If none reported an error, the copy succeeded.
        if !self.has_result.load(Ordering::Relaxed) {
            self.has_result.store(true, Ordering::Relaxed);
            self.result = Maybe::SUCCESS;
        }

        if matches!(self.evtloop, EventLoopHandle::Js(_)) {
            self.evtloop.enqueue_task_concurrent(ConcurrentTask::from_callback(self, Self::run_from_js_thread));
        } else {
            self.evtloop.enqueue_task_concurrent(
                bun_jsc::AnyTaskWithExtraContext::from_callback_auto_deinit(self, Self::run_from_js_thread_mini),
            );
        }
    }

    pub fn run_from_js_thread_mini(&mut self, _: *mut c_void) {
        let _ = self.run_from_js_thread(); // TODO: properly propagate exception upwards
    }

    fn run_from_js_thread(&mut self) -> Result<(), bun_jsc::JSTerminated> {
        if IS_SHELL {
            unsafe { &mut *self.shelltask }.cp_on_finish(self.result);
            self.deinit();
            return Ok(());
        }
        let global_object = self.evtloop.global_object().unwrap_or_else(|| {
            panic!("No global object, this indicates a bug in Bun. Please file a GitHub issue.")
        });
        let success = matches!(self.result, Maybe::Ok(_));
        let promise_value = self.promise.value();
        let promise = self.promise.get();
        let result = match &mut self.result {
            Maybe::Err(err) => match err.to_js_with_async_stack(global_object, promise) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, global_object.take_exception(e)),
            },
            Maybe::Ok(res) => match global_object.to_js(res) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, global_object.take_exception(e)),
            },
        };
        promise_value.ensure_still_alive();

        let tracker = self.tracker;
        tracker.will_dispatch(global_object);
        let _did = scopeguard::guard((), |_| tracker.did_dispatch(global_object));

        self.deinit();
        if success {
            promise.resolve(global_object, result)?;
        } else {
            promise.reject(global_object, result)?;
        }
        Ok(())
    }

    pub fn deinit(&mut self) {
        if let Maybe::Err(err) = &mut self.result {
            err.deinit();
        }
        if !IS_SHELL { self.r#ref.unref(self.evtloop); }
        self.args.deinit();
        self.promise.deinit();
        self.arena.deinit();
        unsafe { drop(Box::from_raw(self as *mut Self)) };
    }

    /// Directory scanning + clonefile will block this thread, then each individual file copy (what the sync version
    /// calls "_copySingleFileSync") will be dispatched as a separate task.
    pub fn cp_async(nodefs: &mut NodeFS, this: &mut Self) {
        // The directory-scan task holds one reference in `subtask_count`
        // (initialized to 1 in create*). Drop it on return. `runFromJSThread`
        // (which destroys `this`) is only enqueued once this reference and
        // every spawned SingleTask's reference have been dropped.
        let _done = scopeguard::guard(this as *mut Self, |p| unsafe { (*p).on_subtask_done() });
        let this = unsafe { &mut **_done };

        let args = &this.args;
        let mut src_buf = OSPathBuffer::uninit();
        let mut dest_buf = OSPathBuffer::uninit();
        let src = args.src.os_path(&mut src_buf);
        let dest = args.dest.os_path(&mut dest_buf);

        #[cfg(windows)]
        {
            let attributes = unsafe { bun_sys::c::GetFileAttributesW(src.as_ptr()) };
            if attributes == bun_sys::c::INVALID_FILE_ATTRIBUTES {
                this.finish_concurrently(Maybe::Err(sys::Error {
                    errno: SystemErrno::ENOENT as _,
                    syscall: sys::Tag::copyfile,
                    path: nodefs.os_path_into_sync_error_buf(src),
                    ..Default::default()
                }));
                return;
            }
            let file_or_symlink = (attributes & bun_sys::c::FILE_ATTRIBUTE_DIRECTORY) == 0
                || (attributes & bun_sys::c::FILE_ATTRIBUTE_REPARSE_POINT) != 0;
            if file_or_symlink {
                let r = nodefs._copy_single_file_sync(
                    src,
                    dest,
                    if IS_SHELL {
                        // Shell always forces copy
                        constants::Copyfile::from_raw(constants::Copyfile::FORCE)
                    } else {
                        constants::Copyfile::from_raw(
                            if args.flags.error_on_exist || !args.flags.force { constants::COPYFILE_EXCL } else { 0u8 },
                        )
                    },
                    Some(attributes),
                    &this.args,
                );
                if let Maybe::Err(e) = &r {
                    if e.errno == E::EXIST as _ && !args.flags.error_on_exist {
                        this.finish_concurrently(Maybe::SUCCESS);
                        return;
                    }
                }
                this.on_copy(src, dest);
                this.finish_concurrently(r);
                return;
            }
        }
        #[cfg(not(windows))]
        {
            let stat_ = match Syscall::lstat(src) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => {
                    nodefs.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                    this.finish_concurrently(Maybe::Err(err.with_path(&nodefs.sync_error_buf[..src.len()])));
                    return;
                }
            };

            if !sys::S::isdir(stat_.mode) {
                // This is the only file, there is no point in dispatching subtasks
                let r = nodefs._copy_single_file_sync(
                    src,
                    dest,
                    constants::Copyfile::from_raw(
                        if args.flags.error_on_exist || !args.flags.force { constants::COPYFILE_EXCL } else { 0u8 },
                    ),
                    Some(stat_),
                    &this.args,
                );
                if let Maybe::Err(e) = &r {
                    if e.errno == E::EXIST as _ && !args.flags.error_on_exist {
                        this.on_copy(src, dest);
                        this.finish_concurrently(Maybe::SUCCESS);
                        return;
                    }
                }
                this.on_copy(src, dest);
                this.finish_concurrently(r);
                return;
            }
        }
        if !args.flags.recursive {
            this.finish_concurrently(Maybe::Err(sys::Error {
                errno: E::ISDIR as _,
                syscall: sys::Tag::copyfile,
                path: nodefs.os_path_into_sync_error_buf(src),
                ..Default::default()
            }));
            return;
        }

        let _ = Self::_cp_async_directory(
            nodefs,
            args.flags,
            this,
            &mut src_buf,
            src.len() as PathString::PathInt,
            &mut dest_buf,
            dest.len() as PathString::PathInt,
        );
    }

    // returns boolean `should_continue`
    fn _cp_async_directory(
        nodefs: &mut NodeFS,
        args: args::CpFlags,
        this: &mut Self,
        src_buf: &mut OSPathBuffer,
        src_dir_len: PathString::PathInt,
        dest_buf: &mut OSPathBuffer,
        dest_dir_len: PathString::PathInt,
    ) -> bool {
        // SAFETY: callers NUL-terminate at src_dir_len/dest_dir_len before calling
        let src = unsafe { ZStr::from_raw(src_buf.as_ptr().cast(), src_dir_len as usize) };
        let dest = unsafe { ZStr::from_raw(dest_buf.as_ptr().cast(), dest_dir_len as usize) };

        #[cfg(target_os = "macos")]
        {
            if let Some(err) = Maybe::<ret::Cp>::errno_sys_p(
                unsafe { bun_sys::c::clonefile(src.as_ptr(), dest.as_ptr(), 0) },
                sys::Tag::clonefile,
                src,
            ) {
                match err.get_errno() {
                    E::ACCES | E::NAMETOOLONG | E::ROFS | E::PERM | E::INVAL => {
                        nodefs.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                        this.finish_concurrently(Maybe::Err(err.err.with_path(&nodefs.sync_error_buf[..src.len()])));
                        return false;
                    }
                    // Other errors may be due to clonefile() not being supported
                    // We'll fall back to other implementations
                    _ => {}
                }
            } else {
                return true;
            }
        }

        let open_flags = sys::O::DIRECTORY | sys::O::RDONLY;
        let fd = match Syscall::openat_os_path(FD::cwd(), src, open_flags, 0) {
            Maybe::Err(err) => {
                this.finish_concurrently(Maybe::Err(err.with_path(nodefs.os_path_into_sync_error_buf(src))));
                return false;
            }
            Maybe::Ok(fd_) => fd_,
        };
        let _close = scopeguard::guard(fd, |fd| fd.close());

        let mut buf = OSPathBuffer::uninit();
        #[cfg(windows)]
        let normdest: OSPathSliceZ = match sys::normalize_path_windows::<u16>(FD::INVALID, dest, &mut buf, sys::NormalizeOpts { add_nt_prefix: false }) {
            Maybe::Err(err) => { this.finish_concurrently(Maybe::Err(err)); return false; }
            Maybe::Ok(n) => n,
        };
        #[cfg(not(windows))]
        let normdest: OSPathSliceZ = { let _ = &buf; dest };

        let mkdir_ = nodefs.mkdir_recursive_os_path(normdest, args::Mkdir::DEFAULT_MODE, false);
        match mkdir_ {
            Maybe::Err(err) => { this.finish_concurrently(Maybe::Err(err)); return false; }
            Maybe::Ok(_) => { this.on_copy(src, normdest); }
        }

        let mut iterator = DirIterator::iterate(fd, if cfg!(windows) { DirIterator::Kind::U16 } else { DirIterator::Kind::U8 });
        let mut entry = iterator.next();
        loop {
            let current = match entry {
                Maybe::Err(err) => {
                    this.finish_concurrently(Maybe::Err(err.with_path(nodefs.os_path_into_sync_error_buf(src))));
                    return false;
                }
                Maybe::Ok(ent) => match ent {
                    Some(e) => e,
                    None => break,
                },
            };
            let cname = current.name.slice();

            // The accumulated path for deep directory trees can exceed the fixed
            // OSPathBuffer. Bail out with ENAMETOOLONG instead of writing past the
            // end of the buffer and corrupting the stack.
            if (src_dir_len as usize) + 1 + cname.len() >= src_buf.len()
                || (dest_dir_len as usize) + 1 + cname.len() >= dest_buf.len()
            {
                this.finish_concurrently(Maybe::Err(sys::Error {
                    errno: E::NAMETOOLONG as _,
                    syscall: sys::Tag::copyfile,
                    path: nodefs.os_path_into_sync_error_buf(&src_buf[..src_dir_len as usize]),
                    ..Default::default()
                }));
                return false;
            }

            match current.kind {
                DirIterator::Kind::Directory => {
                    let sd = src_dir_len as usize;
                    let dd = dest_dir_len as usize;
                    src_buf[sd + 1..sd + 1 + cname.len()].copy_from_slice(cname);
                    src_buf[sd] = paths::SEP as OSPathChar;
                    src_buf[sd + 1 + cname.len()] = 0;
                    dest_buf[dd + 1..dd + 1 + cname.len()].copy_from_slice(cname);
                    dest_buf[dd] = paths::SEP as OSPathChar;
                    dest_buf[dd + 1 + cname.len()] = 0;

                    let should_continue = Self::_cp_async_directory(
                        nodefs, args, this,
                        src_buf, (sd + 1 + cname.len()) as PathString::PathInt,
                        dest_buf, (dd + 1 + cname.len()) as PathString::PathInt,
                    );
                    if !should_continue { return false; }
                }
                _ => {
                    this.subtask_count.fetch_add(1, Ordering::Relaxed);
                    let sd = src_dir_len as usize;
                    let dd = dest_dir_len as usize;
                    let total = sd + 1 + cname.len() + 1 + dd + 1 + cname.len() + 1;

                    // Allocate a path buffer for the path data
                    let mut path_buf = vec![0 as OSPathChar; total].into_boxed_slice();

                    path_buf[..sd].copy_from_slice(&src_buf[..sd]);
                    path_buf[sd] = paths::SEP as OSPathChar;
                    path_buf[sd + 1..sd + 1 + cname.len()].copy_from_slice(cname);
                    path_buf[sd + 1 + cname.len()] = 0;
                    let dest_off = sd + 1 + cname.len() + 1;
                    path_buf[dest_off..dest_off + dd].copy_from_slice(&dest_buf[..dd]);
                    path_buf[dest_off + dd] = paths::SEP as OSPathChar;
                    path_buf[dest_off + dd + 1..dest_off + dd + 1 + cname.len()].copy_from_slice(cname);
                    path_buf[dest_off + dd + 1 + cname.len()] = 0;

                    let raw = Box::leak(path_buf);
                    let src_z = unsafe { OSPathSliceZ::from_raw(raw.as_ptr(), sd + 1 + cname.len()) };
                    let dest_z = unsafe { OSPathSliceZ::from_raw(raw.as_ptr().add(dest_off), dd + 1 + cname.len()) };
                    CpSingleTask::<IS_SHELL>::create(this, src_z, dest_z);
                }
            }
            entry = iterator.next();
        }

        true
    }
}

// ──────────────────────────────────────────────────────────────────────────
// AsyncReaddirRecursiveTask
// ──────────────────────────────────────────────────────────────────────────

pub struct AsyncReaddirRecursiveTask {
    pub promise: JSPromise::Strong,
    pub args: args::Readdir,
    pub global_object: *mut JSGlobalObject,
    pub task: WorkPoolTask,
    pub r#ref: KeepAlive,
    pub tracker: AsyncTaskTracker,

    // It's not 100% clear this one is necessary
    pub has_result: AtomicBool,

    pub subtask_count: AtomicUsize,

    /// The final result list
    pub result_list: ResultListEntryValue,

    /// When joining the result list, we use this to preallocate the joined array.
    pub result_list_count: AtomicUsize,

    /// A lockless queue of result lists.
    ///
    /// Using a lockless queue instead of mutex + joining the lists as we go was a meaningful performance improvement
    pub result_list_queue: UnboundedQueue<ResultListEntry>,

    /// All the subtasks will use this fd to open files
    pub root_fd: FD,

    /// This isued when joining the file paths for error messages
    pub root_path: PathString,

    pub pending_err: Option<sys::Error>,
    pub pending_err_mutex: bun_threading::Mutex,
}

pub enum ResultListEntryValue {
    WithFileTypes(Vec<Dirent>),
    Buffers(Vec<Buffer>),
    Files(Vec<BunString>),
}

impl ResultListEntryValue {
    pub fn deinit(&mut self) {
        match self {
            ResultListEntryValue::WithFileTypes(res) => {
                for item in res.iter() { item.deref(); }
                res.clear();
            }
            ResultListEntryValue::Buffers(res) => {
                for item in res.iter() {
                    // TODO(port): free item.buffer.byteSlice() — owned bytes
                    drop(item);
                }
                res.clear();
            }
            ResultListEntryValue::Files(res) => {
                for item in res.iter() { item.deref(); }
                res.clear();
            }
        }
    }
}

pub struct ResultListEntry {
    pub next: *mut ResultListEntry, // INTRUSIVE: UnboundedQueue link
    pub value: ResultListEntryValue,
}

pub struct ReaddirSubtask {
    pub readdir_task: *mut AsyncReaddirRecursiveTask, // BACKREF
    pub basename: PathString,
    pub task: WorkPoolTask,
}

impl ReaddirSubtask {
    pub fn new(init: ReaddirSubtask) -> Box<Self> { Box::new(init) }

    pub fn call(task: *mut WorkPoolTask) {
        // SAFETY: task points to Self.task
        let this: &mut Self = unsafe {
            &mut *((task as *mut u8).sub(offset_of!(Self, task)).cast::<Self>())
        };
        let _cleanup = scopeguard::guard(this as *mut Self, |p| unsafe {
            // free duped basename + destroy self
            drop(Box::from_raw((*p).basename.slice_assume_z().as_ptr() as *mut u8));
            drop(Box::from_raw(p));
        });
        let mut buf = PathBuffer::uninit();
        unsafe { &mut *this.readdir_task }.perform_work(this.basename.slice_assume_z(), &mut buf, false);
    }
}

impl AsyncReaddirRecursiveTask {
    pub fn new(init: Self) -> Box<Self> { Box::new(init) }

    pub fn enqueue(&mut self, basename: &ZStr) {
        let task = ReaddirSubtask::new(ReaddirSubtask {
            readdir_task: self,
            basename: PathString::init(ZStr::from_bytes(basename.as_bytes())), // dupeZ
            task: WorkPoolTask { callback: ReaddirSubtask::call },
        });
        debug_assert!(self.subtask_count.fetch_add(1, Ordering::Relaxed) > 0);
        WorkPool::schedule(&mut Box::leak(task).task);
    }

    pub fn create(
        global_object: &JSGlobalObject,
        args: args::Readdir,
        vm: &mut VirtualMachine,
    ) -> JSValue {
        let result_list = match args.tag() {
            ret::ReaddirTag::Files => ResultListEntryValue::Files(Vec::new()),
            ret::ReaddirTag::WithFileTypes => ResultListEntryValue::WithFileTypes(Vec::new()),
            ret::ReaddirTag::Buffers => ResultListEntryValue::Buffers(Vec::new()),
        };
        let root_path = PathString::init(ZStr::from_bytes(args.path.slice()));
        let mut task = Self::new(AsyncReaddirRecursiveTask {
            promise: JSPromise::Strong::init(global_object),
            args,
            has_result: AtomicBool::new(false),
            global_object: global_object as *const _ as *mut _,
            task: WorkPoolTask { callback: Self::work_pool_callback },
            r#ref: KeepAlive::default(),
            tracker: AsyncTaskTracker::init(vm),
            subtask_count: AtomicUsize::new(1),
            root_path,
            result_list,
            result_list_count: AtomicUsize::new(0),
            result_list_queue: UnboundedQueue::default(),
            root_fd: FD::INVALID,
            pending_err: None,
            pending_err_mutex: bun_threading::Mutex::default(),
        });
        task.r#ref.ref_(vm);
        task.args.to_thread_safe();
        task.tracker.did_schedule(global_object);
        let promise = task.promise.value();
        WorkPool::schedule(&mut Box::leak(task).task);
        promise
    }

    pub fn perform_work(&mut self, basename: &ZStr, buf: &mut PathBuffer, is_root: bool) {
        // PERF(port): was comptime monomorphization on tag — runtime match here
        // PERF(port): was stack-fallback alloc (8192) for entries
        macro_rules! impl_tag {
            ($T:ty, $variant:ident) => {{
                let mut entries: Vec<$T> = Vec::new();
                let res = NodeFS::readdir_with_entries_recursive_async::<$T>(
                    buf, &self.args, self, basename, &mut entries, is_root,
                );
                match res {
                    Maybe::Err(err) => {
                        for item in &mut entries {
                            // TODO(port): per-type deref/free
                            let _ = item;
                        }
                        {
                            let _lock = self.pending_err_mutex.lock();
                            if self.pending_err.is_none() {
                                let err_path = if !err.path().is_empty() { err.path() } else { self.args.path.slice() };
                                self.pending_err = Some(err.with_path(Box::<[u8]>::from(err_path)));
                            }
                        }
                        if self.subtask_count.fetch_sub(1, Ordering::Relaxed) == 1 {
                            self.finish_concurrently();
                        }
                    }
                    Maybe::Ok(()) => {
                        self.write_results::<$T>(&mut entries);
                    }
                }
            }};
        }
        match self.args.tag() {
            ret::ReaddirTag::Files => impl_tag!(BunString, Files),
            ret::ReaddirTag::WithFileTypes => impl_tag!(Dirent, WithFileTypes),
            ret::ReaddirTag::Buffers => impl_tag!(Buffer, Buffers),
        }
    }

    fn work_pool_callback(task: *mut WorkPoolTask) {
        let this: &mut Self = unsafe {
            &mut *((task as *mut u8).sub(offset_of!(Self, task)).cast::<Self>())
        };
        let mut buf = PathBuffer::uninit();
        this.perform_work(this.root_path.slice_assume_z(), &mut buf, true);
    }

    pub fn write_results<T>(&mut self, result: &mut Vec<T>) {
        if !result.is_empty() {
            let mut clone: Vec<T> = Vec::with_capacity(result.len());
            // PERF(port): was appendSliceAssumeCapacity
            clone.append(result);
            self.result_list_count.fetch_add(clone.len(), Ordering::Relaxed);
            // TODO(port): @unionInit by ResultType — needs trait dispatch to map T -> variant
            let list = Box::new(ResultListEntry {
                next: core::ptr::null_mut(),
                value: ResultListEntryValue::from_vec(clone),
            });
            self.result_list_queue.push(Box::leak(list));
        }

        if self.subtask_count.fetch_sub(1, Ordering::Relaxed) == 1 {
            self.finish_concurrently();
        }
    }

    /// May be called from any thread (the subtasks)
    pub fn finish_concurrently(&mut self) {
        if self.has_result.compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed).is_err() {
            return;
        }
        debug_assert!(self.subtask_count.load(Ordering::Relaxed) == 0);

        let root_fd = self.root_fd;
        if root_fd != FD::INVALID {
            self.root_fd = FD::INVALID;
            root_fd.close();
            // free root_path's heap-backed slice
            // TODO(port): self.root_path was allocator.dupeZ; drop owned slice here
            self.root_path = PathString::EMPTY;
        }

        if self.pending_err.is_some() {
            self.clear_result_list();
        }

        {
            let mut list = self.result_list_queue.pop_batch();
            let mut iter = list.iterator();
            // we have to free only the previous one because the next value will
            // be read by the iterator.
            let mut to_destroy: Option<*mut ResultListEntry> = None;

            // TODO(port): match on tag, ensureTotalCapacityPrecise on the correct vec,
            // append each batch's items, then drop the entry box. Mirrors zig:1206-1225.
            let cap = self.result_list_count.swap(0, Ordering::Relaxed);
            self.result_list.reserve_exact(cap);
            while let Some(val) = iter.next() {
                if let Some(dest) = to_destroy {
                    unsafe { drop(Box::from_raw(dest)) };
                }
                to_destroy = Some(val);
                self.result_list.append_from(&mut unsafe { &mut *val }.value);
            }
            if let Some(dest) = to_destroy {
                unsafe { drop(Box::from_raw(dest)) };
            }
        }

        unsafe { &*self.global_object }
            .bun_vm_concurrently()
            .enqueue_task_concurrent(ConcurrentTask::create(Task::init(self)));
    }

    fn clear_result_list(&mut self) {
        self.result_list.deinit();
        let mut batch = self.result_list_queue.pop_batch();
        let mut iter = batch.iterator();
        let mut to_destroy: Option<*mut ResultListEntry> = None;
        while let Some(val) = iter.next() {
            unsafe { &mut *val }.value.deinit();
            if let Some(dest) = to_destroy { unsafe { drop(Box::from_raw(dest)) }; }
            to_destroy = Some(val);
        }
        if let Some(dest) = to_destroy { unsafe { drop(Box::from_raw(dest)) }; }
        self.result_list_count.store(0, Ordering::Relaxed);
    }

    pub fn run_from_js_thread(&mut self) -> Result<(), bun_jsc::JSTerminated> {
        let global_object = unsafe { &*self.global_object };
        let success = self.pending_err.is_none();
        let promise_value = self.promise.value();
        let promise = self.promise.get();
        let result = if let Some(err) = &mut self.pending_err {
            match err.to_js_with_async_stack(global_object, promise) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, global_object.take_exception(e)),
            }
        } else {
            let res = match core::mem::replace(&mut self.result_list, ResultListEntryValue::Files(Vec::new())) {
                ResultListEntryValue::WithFileTypes(v) => ret::Readdir::WithFileTypes(v.into_boxed_slice()),
                ResultListEntryValue::Buffers(v) => ret::Readdir::Buffers(v.into_boxed_slice()),
                ResultListEntryValue::Files(v) => ret::Readdir::Files(v.into_boxed_slice()),
            };
            match res.to_js(global_object) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, global_object.take_exception(e)),
            }
        };
        promise_value.ensure_still_alive();

        let tracker = self.tracker;
        tracker.will_dispatch(global_object);
        let _did = scopeguard::guard((), |_| tracker.did_dispatch(global_object));

        self.deinit();
        if success {
            promise.resolve(global_object, result)?;
        } else {
            promise.reject(global_object, result)?;
        }
        Ok(())
    }

    pub fn deinit(&mut self) {
        debug_assert!(self.root_fd == FD::INVALID); // should already have closed it
        if let Some(err) = &mut self.pending_err { err.deinit(); }
        self.r#ref.unref(unsafe { &*self.global_object }.bun_vm());
        self.args.deinit();
        // TODO(port): free root_path slice
        self.clear_result_list();
        self.promise.deinit();
        unsafe { drop(Box::from_raw(self as *mut Self)) };
    }
}

// TODO(port): helper trait — maps Vec<T> -> ResultListEntryValue variant
impl ResultListEntryValue {
    fn from_vec<T>(_v: Vec<T>) -> Self { todo!("ResultListEntryValue::from_vec dispatch") }
    fn reserve_exact(&mut self, _n: usize) { /* TODO(port) */ }
    fn append_from(&mut self, _other: &mut Self) { /* TODO(port) */ }
}

// ──────────────────────────────────────────────────────────────────────────
// Arguments
// ──────────────────────────────────────────────────────────────────────────
// TODO: to improve performance for all of these
// The tagged unions for each type should become regular unions
// and the tags should be passed in as comptime arguments to the functions performing the syscalls
// This would reduce stack size, at the cost of instruction cache misses
pub mod args {
    use super::*;

    pub struct Rename {
        pub old_path: PathLike,
        pub new_path: PathLike,
    }
    impl Rename {
        pub fn deinit(&self) { self.old_path.deinit(); self.new_path.deinit(); }
        pub fn deinit_and_unprotect(&self) { self.old_path.deinit_and_unprotect(); self.new_path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.old_path.to_thread_safe(); self.new_path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Rename> {
            let old_path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| {
                ctx.throw_invalid_argument_type_value("oldPath", "string or an instance of Buffer or URL", arguments.next().unwrap_or(JSValue::UNDEFINED))
            })?;
            let new_path = match PathLike::from_js(ctx, arguments)? {
                Some(p) => p,
                None => { old_path.deinit(); return Err(ctx.throw_invalid_argument_type_value("newPath", "string or an instance of Buffer or URL", arguments.next().unwrap_or(JSValue::UNDEFINED))); }
            };
            Ok(Rename { old_path, new_path })
        }
    }

    pub struct Truncate {
        /// Passing a file descriptor is deprecated and may result in an error being thrown in the future.
        pub path: PathOrFileDescriptor,
        pub len: u64, // u63
        pub flags: i32,
    }
    impl Default for Truncate {
        fn default() -> Self { Self { path: PathOrFileDescriptor::default(), len: 0, flags: 0 } }
    }
    impl Truncate {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Truncate> {
            let path = PathOrFileDescriptor::from_js(ctx, arguments)?.ok_or_else(|| {
                ctx.throw_invalid_arguments("path must be a string or TypedArray")
            })?;
            let len: u64 = 'brk: {
                let Some(len_value) = arguments.next() else { break 'brk 0 };
                node::validators::validate_integer(ctx, len_value, "len", None, None)?.max(0) as u64
            };
            Ok(Truncate { path, len, flags: 0 })
        }
    }

    pub struct Writev {
        pub fd: FD,
        pub buffers: VectorArrayBuffer,
        pub position: Option<u64>, // u52
    }
    impl Writev {
        pub fn deinit(&self) {}
        pub fn deinit_and_unprotect(&self) {
            self.buffers.value.unprotect();
            self.buffers.buffers.deinit();
        }
        pub fn to_thread_safe(&mut self) {
            self.buffers.value.protect();
            let clone: Vec<sys::PlatformIOVec> = self.buffers.buffers.as_slice().to_vec();
            self.buffers.buffers = clone;
        }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Writev> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let buffers = VectorArrayBuffer::from_js(
                ctx,
                arguments.protect_eat_next().ok_or_else(|| ctx.throw_invalid_arguments("Expected an ArrayBufferView[]"))?,
                arguments.arena.allocator(),
            )?;
            let mut position: Option<u64> = None;
            if let Some(pos_value) = arguments.next_eat() {
                if !pos_value.is_undefined_or_null() {
                    if pos_value.is_number() {
                        position = Some(pos_value.to::<u64>());
                    } else {
                        return Err(ctx.throw_invalid_arguments("position must be a number"));
                    }
                }
            }
            Ok(Writev { fd, buffers, position })
        }
    }

    pub struct Readv {
        pub fd: FD,
        pub buffers: VectorArrayBuffer,
        pub position: Option<u64>, // u52
    }
    impl Readv {
        pub fn deinit(&self) {}
        pub fn deinit_and_unprotect(&self) {
            self.buffers.value.unprotect();
            self.buffers.buffers.deinit();
        }
        pub fn to_thread_safe(&mut self) {
            self.buffers.value.protect();
            let clone: Vec<sys::PlatformIOVec> = self.buffers.buffers.as_slice().to_vec();
            self.buffers.buffers = clone;
        }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Readv> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let buffers = VectorArrayBuffer::from_js(
                ctx,
                arguments.protect_eat_next().ok_or_else(|| ctx.throw_invalid_arguments("Expected an ArrayBufferView[]"))?,
                arguments.arena.allocator(),
            )?;
            let mut position: Option<u64> = None;
            if let Some(pos_value) = arguments.next_eat() {
                if !pos_value.is_undefined_or_null() {
                    if pos_value.is_number() {
                        position = Some(pos_value.to::<u64>());
                    } else {
                        return Err(ctx.throw_invalid_arguments("position must be a number"));
                    }
                }
            }
            Ok(Readv { fd, buffers, position })
        }
    }

    pub struct FTruncate {
        pub fd: FD,
        pub len: Option<Blob::SizeType>,
    }
    impl FTruncate {
        pub fn deinit(&self) {}
        pub fn deinit_and_unprotect(&mut self) {}
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<FTruncate> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let len: Blob::SizeType = node::validators::validate_integer(
                ctx,
                arguments.next().unwrap_or(JSValue::js_number(0)),
                "len",
                Some(i64::from(i52::MIN)),
                Some(Blob::SizeType::MAX as i64),
            )?.max(0) as Blob::SizeType;
            Ok(FTruncate { fd, len: Some(len) })
        }
    }

    pub struct Chown {
        pub path: PathLike,
        pub uid: UidT,
        pub gid: GidT,
    }
    impl Chown {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Chown> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let uid: UidT = 'brk: {
                let Some(uid_value) = arguments.next() else { path.deinit(); return Err(ctx.throw_invalid_arguments("uid is required")); };
                arguments.eat();
                break 'brk wrap_to::<UidT>(node::validators::validate_integer(ctx, uid_value, "uid", Some(-1), Some(u32::MAX as i64))?);
            };
            let gid: GidT = 'brk: {
                let Some(gid_value) = arguments.next() else { path.deinit(); return Err(ctx.throw_invalid_arguments("gid is required")); };
                arguments.eat();
                break 'brk wrap_to::<GidT>(node::validators::validate_integer(ctx, gid_value, "gid", Some(-1), Some(u32::MAX as i64))?);
            };
            Ok(Chown { path, uid, gid })
        }
    }

    pub struct Fchown {
        pub fd: FD,
        pub uid: UidT,
        pub gid: GidT,
    }
    impl Fchown {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Fchown> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let uid: UidT = 'brk: {
                let Some(uid_value) = arguments.next() else { return Err(ctx.throw_invalid_arguments("uid is required")); };
                arguments.eat();
                break 'brk wrap_to::<UidT>(node::validators::validate_integer(ctx, uid_value, "uid", Some(-1), Some(u32::MAX as i64))?);
            };
            let gid: GidT = 'brk: {
                let Some(gid_value) = arguments.next() else { return Err(ctx.throw_invalid_arguments("gid is required")); };
                arguments.eat();
                break 'brk wrap_to::<GidT>(node::validators::validate_integer(ctx, gid_value, "gid", Some(-1), Some(u32::MAX as i64))?);
            };
            Ok(Fchown { fd, uid, gid })
        }
    }

    fn wrap_to<T: TryFrom<i64> + num_traits::Bounded + num_traits::Unsigned>(in_: i64) -> T
    where T::Error: core::fmt::Debug {
        // TODO(port): @typeInfo(T).int.signedness == .unsigned — enforced by trait bound
        T::try_from(in_.rem_euclid(T::max_value().try_into().unwrap_or(i64::MAX))).unwrap()
    }

    pub type LChown = Chown;

    pub struct Lutimes {
        pub path: PathLike,
        pub atime: TimeLike,
        pub mtime: TimeLike,
    }
    impl Lutimes {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Lutimes> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let atime = node::time_like_from_js(ctx, arguments.next().ok_or_else(|| { path.deinit(); ctx.throw_invalid_arguments("atime is required") })?)?
                .ok_or_else(|| { path.deinit(); ctx.throw_invalid_arguments("atime must be a number or a Date") })?;
            arguments.eat();
            let mtime = node::time_like_from_js(ctx, arguments.next().ok_or_else(|| { path.deinit(); ctx.throw_invalid_arguments("mtime is required") })?)?
                .ok_or_else(|| { path.deinit(); ctx.throw_invalid_arguments("mtime must be a number or a Date") })?;
            arguments.eat();
            Ok(Lutimes { path, atime, mtime })
        }
    }

    pub struct Chmod {
        pub path: PathLike,
        pub mode: Mode,
    }
    impl Default for Chmod { fn default() -> Self { Self { path: PathLike::default(), mode: 0x777 } } }
    impl Chmod {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Chmod> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mode_arg = arguments.next().unwrap_or(JSValue::UNDEFINED);
            let mode: Mode = match node::mode_from_js(ctx, mode_arg)? {
                Some(m) => m,
                None => { path.deinit(); return Err(node::validators::throw_err_invalid_arg_type(ctx, "mode", &[], "number", mode_arg)); }
            };
            arguments.eat();
            Ok(Chmod { path, mode })
        }
    }

    pub struct FChmod {
        pub fd: FD,
        pub mode: Mode,
    }
    impl Default for FChmod { fn default() -> Self { Self { fd: FD::INVALID, mode: 0x777 } } }
    impl FChmod {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<FChmod> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let mode_arg = arguments.next().unwrap_or(JSValue::UNDEFINED);
            let mode: Mode = node::mode_from_js(ctx, mode_arg)?.ok_or_else(|| node::validators::throw_err_invalid_arg_type(ctx, "mode", &[], "number", mode_arg))?;
            arguments.eat();
            Ok(FChmod { fd, mode })
        }
    }

    pub type LCHmod = Chmod;

    pub struct StatFS {
        pub path: PathLike,
        pub big_int: bool,
    }
    impl StatFS {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<StatFS> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let big_int = 'brk: {
                if let Some(next_val) = arguments.next() {
                    if next_val.is_object() {
                        if next_val.is_callable() { break 'brk false; }
                        arguments.eat();
                        if let Some(b) = next_val.get_boolean_strict(ctx, "bigint")? { break 'brk b; }
                    }
                }
                false
            };
            Ok(StatFS { path, big_int })
        }
    }

    pub struct Stat {
        pub path: PathLike,
        pub big_int: bool,
        pub throw_if_no_entry: bool,
    }
    impl Default for Stat { fn default() -> Self { Self { path: PathLike::default(), big_int: false, throw_if_no_entry: true } } }
    impl Stat {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Stat> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut throw_if_no_entry = true;
            let big_int = 'brk: {
                if let Some(next_val) = arguments.next() {
                    if next_val.is_object() {
                        if next_val.is_callable() { break 'brk false; }
                        arguments.eat();
                        if let Some(v) = next_val.get_boolean_strict(ctx, "throwIfNoEntry")? { throw_if_no_entry = v; }
                        if let Some(b) = next_val.get_boolean_strict(ctx, "bigint")? { break 'brk b; }
                    }
                }
                false
            };
            Ok(Stat { path, big_int, throw_if_no_entry })
        }
    }

    pub struct Fstat {
        pub fd: FD,
        pub big_int: bool,
    }
    impl Fstat {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&mut self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Fstat> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let big_int = 'brk: {
                if let Some(next_val) = arguments.next() {
                    if next_val.is_object() {
                        if next_val.is_callable() { break 'brk false; }
                        arguments.eat();
                        if let Some(b) = next_val.get_boolean_strict(ctx, "bigint")? { break 'brk b; }
                    }
                }
                false
            };
            Ok(Fstat { fd, big_int })
        }
    }

    pub type Lstat = Stat;

    pub struct Link {
        pub old_path: PathLike,
        pub new_path: PathLike,
    }
    impl Link {
        pub fn deinit(&self) { self.old_path.deinit(); self.new_path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.old_path.deinit_and_unprotect(); self.new_path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.old_path.to_thread_safe(); self.new_path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Link> {
            let old_path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("oldPath must be a string or TypedArray"))?;
            let new_path = match PathLike::from_js(ctx, arguments)? {
                Some(p) => p,
                None => { old_path.deinit(); return Err(ctx.throw_invalid_arguments("newPath must be a string or TypedArray")); }
            };
            Ok(Link { old_path, new_path })
        }
    }

    #[derive(Copy, Clone)]
    pub enum SymlinkLinkType { Unspecified, File, Dir, Junction }

    pub struct Symlink {
        /// Where the symbolic link is targetting.
        pub target_path: PathLike,
        /// The path to create the symbolic link at.
        pub new_path: PathLike,
        /// Windows has multiple link types. By default, only junctions can be created by non-admin.
        #[cfg(windows)]
        pub link_type: SymlinkLinkType,
        #[cfg(not(windows))]
        pub link_type: (),
    }
    impl Symlink {
        pub fn deinit(&self) { self.target_path.deinit(); self.new_path.deinit(); }
        pub fn deinit_and_unprotect(&self) { self.target_path.deinit_and_unprotect(); self.new_path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.target_path.to_thread_safe(); self.new_path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Symlink> {
            let old_path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("target must be a string or TypedArray"))?;
            let new_path = match PathLike::from_js(ctx, arguments)? {
                Some(p) => p,
                None => { old_path.deinit(); return Err(ctx.throw_invalid_arguments("path must be a string or TypedArray")); }
            };
            // The type argument is only available on Windows and
            // ignored on other platforms. It can be set to 'dir',
            // 'file', or 'junction'. If the type argument is not set,
            // Node.js will autodetect target type and use 'file' or
            // 'dir'. If the target does not exist, 'file' will be used.
            // Windows junction points require the destination path to
            // be absolute. When using 'junction', the target argument
            // will automatically be normalized to absolute path.
            let link_type: SymlinkLinkType = 'link_type: {
                if let Some(next_val) = arguments.next() {
                    if next_val.is_undefined_or_null() { break 'link_type SymlinkLinkType::Unspecified; }
                    if next_val.is_string() {
                        arguments.eat();
                        let str = next_val.to_bun_string(ctx)?;
                        let lt = if str.eql_comptime("dir") { SymlinkLinkType::Dir }
                            else if str.eql_comptime("file") { SymlinkLinkType::File }
                            else if str.eql_comptime("junction") { SymlinkLinkType::Junction }
                            else {
                                str.deref();
                                old_path.deinit(); new_path.deinit();
                                return Err(ctx.err_invalid_arg_value(format_args!("Symlink type must be one of \"dir\", \"file\", or \"junction\". Received \"{}\"", str)).throw());
                            };
                        str.deref();
                        break 'link_type lt;
                    }
                    // not a string. fallthrough to auto detect.
                    old_path.deinit(); new_path.deinit();
                    return Err(ctx.err_invalid_arg_value("Symlink type must be one of \"dir\", \"file\", or \"junction\".").throw());
                }
                SymlinkLinkType::Unspecified
            };
            Ok(Symlink {
                target_path: old_path,
                new_path,
                #[cfg(windows)] link_type,
                #[cfg(not(windows))] link_type: { let _ = link_type; () },
            })
        }
    }

    pub struct Readlink {
        pub path: PathLike,
        pub encoding: Encoding,
    }
    impl Readlink {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Readlink> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut encoding = Encoding::Utf8;
            if let Some(val) = arguments.next() {
                arguments.eat();
                match val.js_type() {
                    bun_jsc::JSType::String | bun_jsc::JSType::StringObject | bun_jsc::JSType::DerivedStringObject => {
                        encoding = Encoding::assert(val, ctx, encoding)?;
                    }
                    _ => if val.is_object() { encoding = get_encoding(val, ctx, encoding)?; }
                }
            }
            Ok(Readlink { path, encoding })
        }
    }

    pub struct Realpath {
        pub path: PathLike,
        pub encoding: Encoding,
    }
    impl Realpath {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Realpath> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut encoding = Encoding::Utf8;
            if let Some(val) = arguments.next() {
                arguments.eat();
                match val.js_type() {
                    bun_jsc::JSType::String | bun_jsc::JSType::StringObject | bun_jsc::JSType::DerivedStringObject => {
                        encoding = Encoding::assert(val, ctx, encoding)?;
                    }
                    _ => if val.is_object() { encoding = get_encoding(val, ctx, encoding)?; }
                }
            }
            Ok(Realpath { path, encoding })
        }
    }

    pub(super) fn get_encoding(object: JSValue, global_object: &JSGlobalObject, default: Encoding) -> JsResult<Encoding> {
        if let Some(value) = object.fast_get(global_object, bun_jsc::BuiltinName::Encoding)? {
            return Encoding::assert(value, global_object, default);
        }
        Ok(default)
    }

    pub struct Unlink {
        pub path: PathLike,
    }
    impl Unlink {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Unlink> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            Ok(Unlink { path })
        }
    }

    pub type Rm = RmDir;

    pub struct RmDir {
        pub path: PathLike,
        pub force: bool,
        pub max_retries: u32,
        pub recursive: bool,
        pub retry_delay: c_uint,
    }
    impl Default for RmDir {
        fn default() -> Self { Self { path: PathLike::default(), force: false, max_retries: 0, recursive: false, retry_delay: 100 } }
    }
    impl RmDir {
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<RmDir> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut recursive = false;
            let mut force = false;
            let mut max_retries: u32 = 0;
            let mut retry_delay: c_uint = 100;
            if let Some(val) = arguments.next() {
                arguments.eat();
                if val.is_object() {
                    if let Some(boolean) = val.get(ctx, "recursive")? {
                        if boolean.is_boolean() { recursive = boolean.to_boolean(); }
                        else { path.deinit(); return Err(ctx.throw_invalid_arguments("The \"options.recursive\" property must be of type boolean.")); }
                    }
                    if let Some(boolean) = val.get(ctx, "force")? {
                        if boolean.is_boolean() { force = boolean.to_boolean(); }
                        else { path.deinit(); return Err(ctx.throw_invalid_arguments("The \"options.force\" property must be of type boolean.")); }
                    }
                    if let Some(delay) = val.get(ctx, "retryDelay")? {
                        retry_delay = node::validators::validate_integer(ctx, delay, "options.retryDelay", Some(0), Some(c_uint::MAX as i64))? as c_uint;
                    }
                    if let Some(retries) = val.get(ctx, "maxRetries")? {
                        max_retries = node::validators::validate_integer(ctx, retries, "options.maxRetries", Some(0), Some(u32::MAX as i64))? as u32;
                    }
                } else if !val.is_undefined() {
                    path.deinit();
                    return Err(ctx.throw_invalid_arguments("The \"options\" argument must be of type object."));
                }
            }
            Ok(RmDir { path, recursive, force, max_retries, retry_delay })
        }
    }

    /// https://github.com/nodejs/node/blob/master/lib/fs.js#L1285
    pub struct Mkdir {
        pub path: PathLike,
        /// Indicates whether parent folders should be created.
        /// If a folder was created, the path to the first created folder will be returned.
        /// @default false
        pub recursive: bool,
        /// A file mode. If a string is passed, it is parsed as an octal integer. If not specified
        pub mode: Mode,
        /// If set to true, the return value is never set to a string
        pub always_return_none: bool,
    }
    impl Mkdir {
        pub const DEFAULT_MODE: Mode = 0o777;
    }
    impl Default for Mkdir {
        fn default() -> Self { Self { path: PathLike::default(), recursive: false, mode: Self::DEFAULT_MODE, always_return_none: false } }
    }
    impl Mkdir {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Mkdir> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut recursive = false;
            let mut mode: Mode = 0o777;
            if let Some(val) = arguments.next() {
                arguments.eat();
                if val.is_object() {
                    if let Some(b) = val.get_boolean_strict(ctx, "recursive")? { recursive = b; }
                    if let Some(mode_) = val.get(ctx, "mode")? {
                        mode = node::mode_from_js(ctx, mode_)?.unwrap_or(mode);
                    }
                }
                if val.is_number() || val.is_string() {
                    mode = node::mode_from_js(ctx, val)?.unwrap_or(mode);
                }
            }
            Ok(Mkdir { path, recursive, mode, always_return_none: false })
        }
    }

    pub struct MkdirTemp {
        pub prefix: PathLike,
        pub encoding: Encoding,
    }
    impl Default for MkdirTemp {
        fn default() -> Self { Self { prefix: PathLike::Buffer(Buffer { buffer: bun_jsc::ArrayBuffer::EMPTY }), encoding: Encoding::Utf8 } }
    }
    impl MkdirTemp {
        pub fn deinit(&self) { self.prefix.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.prefix.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.prefix.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<MkdirTemp> {
            let prefix = PathLike::from_js(ctx, arguments)?.ok_or_else(|| {
                ctx.throw_invalid_argument_type_value("prefix", "string, Buffer, or URL", arguments.next().unwrap_or(JSValue::UNDEFINED))
            })?;
            let mut encoding = Encoding::Utf8;
            if let Some(val) = arguments.next() {
                arguments.eat();
                match val.js_type() {
                    bun_jsc::JSType::String | bun_jsc::JSType::StringObject | bun_jsc::JSType::DerivedStringObject => {
                        encoding = Encoding::assert(val, ctx, encoding)?;
                    }
                    _ => if val.is_object() { encoding = get_encoding(val, ctx, encoding)?; }
                }
            }
            Ok(MkdirTemp { prefix, encoding })
        }
    }

    pub struct Readdir {
        pub path: PathLike,
        pub encoding: Encoding,
        pub with_file_types: bool,
        pub recursive: bool,
    }
    impl Readdir {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn tag(&self) -> ret::ReaddirTag {
            match self.encoding {
                Encoding::Buffer => ret::ReaddirTag::Buffers,
                _ => if self.with_file_types { ret::ReaddirTag::WithFileTypes } else { ret::ReaddirTag::Files },
            }
        }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Readdir> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut encoding = Encoding::Utf8;
            let mut with_file_types = false;
            let mut recursive = false;
            if let Some(val) = arguments.next() {
                arguments.eat();
                match val.js_type() {
                    bun_jsc::JSType::String | bun_jsc::JSType::StringObject | bun_jsc::JSType::DerivedStringObject => {
                        encoding = Encoding::assert(val, ctx, encoding)?;
                    }
                    _ => if val.is_object() {
                        encoding = get_encoding(val, ctx, encoding)?;
                        if let Some(r) = val.get_boolean_strict(ctx, "recursive")? { recursive = r; }
                        if let Some(w) = val.get_boolean_strict(ctx, "withFileTypes")? { with_file_types = w; }
                    }
                }
            }
            Ok(Readdir { path, encoding, with_file_types, recursive })
        }
    }

    pub struct Close { pub fd: FD }
    impl Close {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Close> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            Ok(Close { fd })
        }
    }

    pub struct Open {
        pub path: PathLike,
        pub flags: FileSystemFlags,
        pub mode: Mode,
    }
    impl Default for Open { fn default() -> Self { Self { path: PathLike::default(), flags: FileSystemFlags::R, mode: DEFAULT_PERMISSION } } }
    impl Open {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Open> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut flags = FileSystemFlags::R;
            let mut mode: Mode = DEFAULT_PERMISSION;
            if let Some(val) = arguments.next() {
                arguments.eat();
                if val.is_object() {
                    if let Some(flags_) = val.get_truthy(ctx, "flags")? {
                        flags = FileSystemFlags::from_js(ctx, flags_)?.unwrap_or(flags);
                    }
                    if let Some(mode_) = val.get_truthy(ctx, "mode")? {
                        mode = node::mode_from_js(ctx, mode_)?.unwrap_or(mode);
                    }
                } else if !val.is_empty() {
                    if !val.is_undefined_or_null() {
                        // error is handled below
                        flags = FileSystemFlags::from_js(ctx, val)?.unwrap_or(flags);
                    }
                    if let Some(next) = arguments.next_eat() {
                        mode = node::mode_from_js(ctx, next)?.unwrap_or(mode);
                    }
                }
            }
            Ok(Open { path, flags, mode })
        }
    }

    /// Change the file system timestamps of the object referenced by `path`.
    ///
    /// The `atime` and `mtime` arguments follow these rules:
    ///
    /// * Values can be either numbers representing Unix epoch time in seconds,`Date`s, or a numeric string like `'123456789.0'`.
    /// * If the value can not be converted to a number, or is `NaN`, `Infinity` or`-Infinity`, an `Error` will be thrown.
    /// @since v0.4.2
    pub type Utimes = Lutimes;

    pub struct Futimes {
        pub fd: FD,
        pub atime: TimeLike,
        pub mtime: TimeLike,
    }
    impl Futimes {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Futimes> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let atime = node::time_like_from_js(ctx, arguments.next().ok_or_else(|| ctx.throw_invalid_arguments("atime is required"))?)?
                .ok_or_else(|| ctx.throw_invalid_arguments("atime must be a number or a Date"))?;
            arguments.eat();
            let mtime = node::time_like_from_js(ctx, arguments.next().ok_or_else(|| ctx.throw_invalid_arguments("mtime is required"))?)?
                .ok_or_else(|| ctx.throw_invalid_arguments("mtime must be a number or a Date"))?;
            arguments.eat();
            Ok(Futimes { fd, atime, mtime })
        }
    }

    /// Write `buffer` to the file specified by `fd`. If `buffer` is a normal object, it
    /// must have an own `toString` function property.
    ///
    /// `offset` determines the part of the buffer to be written, and `length` is
    /// an integer specifying the number of bytes to write.
    ///
    /// `position` refers to the offset from the beginning of the file where this data
    /// should be written. If `typeof position !== 'number'`, the data will be written
    /// at the current position. See [`pwrite(2)`](http://man7.org/linux/man-pages/man2/pwrite.2.html).
    ///
    /// The callback will be given three arguments `(err, bytesWritten, buffer)` where`bytesWritten` specifies how many _bytes_ were written from `buffer`.
    ///
    /// If this method is invoked as its `util.promisify()` ed version, it returns
    /// a promise for an `Object` with `bytesWritten` and `buffer` properties.
    ///
    /// It is unsafe to use `fs.write()` multiple times on the same file without waiting
    /// for the callback. For this scenario, {@link createWriteStream} is
    /// recommended.
    ///
    /// On Linux, positional writes don't work when the file is opened in append mode.
    /// The kernel ignores the position argument and always appends the data to
    /// the end of the file.
    /// @since v0.0.2
    pub struct Write {
        pub fd: FD,
        pub buffer: StringOrBuffer,
        // pub buffer_val: JSValue,
        pub offset: u64,
        pub length: u64,
        pub position: Option<ReadPosition>,
        pub encoding: Encoding,
    }
    impl Default for Write {
        fn default() -> Self { Self { fd: FD::INVALID, buffer: StringOrBuffer::default(), offset: 0, length: u64::MAX, position: None, encoding: Encoding::Buffer } }
    }
    impl Write {
        pub fn deinit(&self) { self.buffer.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.buffer.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.buffer.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Write> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let buffer_value = arguments.next();
            let bv = buffer_value.ok_or_else(|| ctx.throw_invalid_arguments("data is required"))?;
            let buffer = StringOrBuffer::from_js(ctx, bv)?.ok_or_else(|| ctx.throw_invalid_argument_type_value("buffer", "string or TypedArray", bv))?;
            if bv.is_string() && !bv.is_string_literal() {
                return Err(ctx.throw_invalid_argument_type_value("buffer", "string or TypedArray", bv));
            }
            let mut args = Write {
                fd, buffer,
                encoding: if matches!(buffer, StringOrBuffer::Buffer(_)) { Encoding::Buffer } else { Encoding::Utf8 },
                ..Default::default()
            };
            arguments.eat();
            'parse: {
                let Some(mut current) = arguments.next() else { break 'parse };
                match &args.buffer {
                    // fs.write(fd, buffer[, offset[, length[, position]]], callback)
                    StringOrBuffer::Buffer(_) => {
                        if current.is_undefined_or_null() || current.is_function() { break 'parse; }
                        args.offset = node::validators::validate_integer(ctx, current, "offset", Some(0), Some(9007199254740991))? as u64;
                        arguments.eat();
                        let Some(next) = arguments.next() else { break 'parse }; current = next;
                        if !(current.is_number() || current.is_big_int()) { break 'parse; }
                        let length = current.to::<i64>();
                        let buf_len = args.buffer.buffer().slice().len();
                        let max_offset = (buf_len as i64).min(i64::MAX);
                        if args.offset as i64 > max_offset {
                            return Err(ctx.throw_range_error(args.offset as f64, bun_jsc::RangeErrorOpts { field_name: "offset", max: Some(max_offset), ..Default::default() }));
                        }
                        let max_len = ((buf_len as u64 - args.offset) as i64).min(i32::MAX as i64);
                        if length > max_len || length < 0 {
                            return Err(ctx.throw_range_error(length as f64, bun_jsc::RangeErrorOpts { field_name: "length", min: Some(0), max: Some(max_len), ..Default::default() }));
                        }
                        args.length = length as u64;
                        arguments.eat();
                        let Some(next) = arguments.next() else { break 'parse }; current = next;
                        if !(current.is_number() || current.is_big_int()) { break 'parse; }
                        let position = current.to::<i64>();
                        if position >= 0 { args.position = Some(position); }
                        arguments.eat();
                    }
                    // fs.write(fd, string[, position[, encoding]], callback)
                    _ => {
                        if current.is_number() {
                            args.position = Some(current.to::<i64>());
                            arguments.eat();
                            let Some(next) = arguments.next() else { break 'parse }; current = next;
                        }
                        if current.is_string() {
                            args.encoding = Encoding::assert(current, ctx, args.encoding)?;
                            arguments.eat();
                        }
                    }
                }
            }
            Ok(args)
        }
    }

    pub struct Read {
        pub fd: FD,
        pub buffer: Buffer,
        pub offset: u64,
        pub length: u64,
        pub position: Option<ReadPosition>,
    }
    impl Read {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&self) { self.buffer.buffer.value.protect(); }
        pub fn deinit_and_unprotect(&mut self) { self.buffer.buffer.value.unprotect(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Read> {
            // About half of the normalization has already been done. The second half is done in the native code.
            // fs_binding.read(fd, buffer, offset, length, position)

            // fd = getValidatedFd(fd);
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;

            //  validateBuffer(buffer);
            let buffer_value = arguments.next_eat().ok_or_else(||
                // theoretically impossible, argument has been passed already
                ctx.throw_invalid_arguments("buffer is required"))?;
            let buffer: bun_jsc::MarkedArrayBuffer = Buffer::from_js(ctx, buffer_value)
                .ok_or_else(|| ctx.throw_invalid_argument_type_value("buffer", "TypedArray", buffer_value))?;

            let offset_value = arguments.next_eat().unwrap_or(JSValue::NULL);
            // if (offset == null) {
            //   offset = 0;
            // } else {
            //   validateInteger(offset, 'offset', 0);
            // }
            let offset: u64 = if offset_value.is_undefined_or_null() {
                0
            } else {
                node::validators::validate_integer(ctx, offset_value, "offset", Some(0), Some(bun_jsc::MAX_SAFE_INTEGER))? as u64
            };

            // length |= 0;
            let length_float: f64 = if let Some(arg) = arguments.next_eat() { arg.to_number(ctx)? } else { 0.0 };

            //   if (length === 0) {
            //     return process.nextTick(function tick() {
            //       callback(null, 0, buffer);
            //     });
            //   }
            if length_float == 0.0 {
                return Ok(Read { fd, buffer, length: 0, offset: 0, position: None });
            }

            let buf_len = buffer.slice().len();
            if buf_len == 0 {
                return Err(ctx.err_invalid_arg_value("The argument 'buffer' is empty and cannot be written.").throw());
            }
            // validateOffsetLengthRead(offset, length, buffer.byteLength);
            if length_float % 1.0 != 0.0 {
                return Err(ctx.throw_range_error(length_float, bun_jsc::RangeErrorOpts { field_name: "length", msg: Some("an integer"), ..Default::default() }));
            }
            let length_int: i64 = length_float as i64;
            if length_int as usize > buf_len {
                return Err(ctx.throw_range_error(length_float, bun_jsc::RangeErrorOpts { field_name: "length", max: Some((buf_len as i64).min(i64::MAX)), ..Default::default() }));
            }
            if (offset as i64).saturating_add(length_int) > buf_len as i64 {
                return Err(ctx.throw_range_error(length_float, bun_jsc::RangeErrorOpts { field_name: "length", max: Some((buf_len as u64).saturating_sub(offset) as i64), ..Default::default() }));
            }
            if length_int < 0 {
                return Err(ctx.throw_range_error(length_float, bun_jsc::RangeErrorOpts { field_name: "length", min: Some(0), ..Default::default() }));
            }
            let length: u64 = length_int as u64;

            // if (position == null) {
            //   position = -1;
            // } else {
            //   validatePosition(position, 'position', length);
            // }
            let position_value = arguments.next_eat().unwrap_or(JSValue::NULL);
            let position_int: i64 = if position_value.is_undefined_or_null() {
                -1
            } else if position_value.is_number() {
                node::validators::validate_integer(ctx, position_value, "position", Some(-1), Some(bun_jsc::MAX_SAFE_INTEGER))?
            } else if let Some(position) = bun_jsc::JSBigInt::from_js(position_value) {
                // const maxPosition = 2n ** 63n - 1n - BigInt(length)
                let max_position = i64::MAX - length_int;
                if position.order(-1i64) == core::cmp::Ordering::Less || position.order(max_position) == core::cmp::Ordering::Greater {
                    let position_str = position.to_string(ctx)?;
                    let r = Err(ctx.throw_range_error(position_str, bun_jsc::RangeErrorOpts { field_name: "position", min: Some(-1), max: Some(max_position), ..Default::default() }));
                    position_str.deref();
                    return r;
                }
                position.to_int64()
            } else {
                return Err(ctx.throw_invalid_argument_type_value("position", "number or bigint", position_value));
            };

            // Bun needs `null` to tell the native function if to use pread or read
            let position: Option<ReadPosition> = if position_int >= 0 { Some(position_int) } else { None };

            Ok(Read { fd, buffer, offset, length, position })
        }
    }

    /// Asynchronously reads the entire contents of a file.
    /// @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
    /// If a file descriptor is provided, the underlying file will _not_ be closed automatically.
    /// @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
    /// If a flag is not provided, it defaults to `'r'`.
    pub struct ReadFile {
        pub path: PathOrFileDescriptor,
        pub encoding: Encoding,
        pub offset: Blob::SizeType,
        pub max_size: Option<Blob::SizeType>,
        pub limit_size_for_javascript: bool,
        pub flag: FileSystemFlags,
        pub signal: Option<webcore::RefPtr<AbortSignal>>,
    }
    impl Default for ReadFile {
        fn default() -> Self {
            Self { path: PathOrFileDescriptor::default(), encoding: Encoding::Utf8, offset: 0, max_size: None, limit_size_for_javascript: false, flag: FileSystemFlags::R, signal: None }
        }
    }
    impl ReadFile {
        pub fn deinit(&self) {
            self.path.deinit();
            if let Some(signal) = &self.signal { signal.pending_activity_unref(); signal.unref(); }
        }
        pub fn deinit_and_unprotect(&self) {
            self.path.deinit_and_unprotect();
            if let Some(signal) = &self.signal { signal.pending_activity_unref(); signal.unref(); }
        }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<ReadFile> {
            let path = PathOrFileDescriptor::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or a file descriptor"))?;
            let mut encoding = Encoding::Buffer;
            let mut flag = FileSystemFlags::R;
            let mut abort_signal: Option<webcore::RefPtr<AbortSignal>> = None;
            // TODO(port): errdefer cleanup of abort_signal on later failures
            if let Some(arg) = arguments.next() {
                arguments.eat();
                if arg.is_string() {
                    encoding = Encoding::assert(arg, ctx, encoding)?;
                } else if arg.is_object() {
                    encoding = get_encoding(arg, ctx, encoding)?;
                    if let Some(flag_) = arg.get_truthy(ctx, "flag")? {
                        flag = FileSystemFlags::from_js(ctx, flag_)?.ok_or_else(|| { path.deinit(); ctx.throw_invalid_arguments("Invalid flag") })?;
                    }
                    if let Some(value) = arg.get_truthy(ctx, "signal")? {
                        if let Some(signal) = AbortSignal::from_js(value) {
                            abort_signal = Some(signal.ref_());
                            signal.pending_activity_ref();
                        } else {
                            path.deinit();
                            return Err(ctx.throw_invalid_argument_type_value("signal", "AbortSignal", value));
                        }
                    }
                }
            }
            Ok(ReadFile { path, encoding, flag, limit_size_for_javascript: true, signal: abort_signal, ..Default::default() })
        }
        pub fn aborted(&self) -> bool {
            if let Some(signal) = &self.signal { return signal.aborted(); }
            false
        }
    }

    pub struct WriteFile {
        pub encoding: Encoding,
        pub flag: FileSystemFlags,
        pub mode: Mode,
        pub file: PathOrFileDescriptor,
        pub flush: bool,
        /// Encoded at the time of construction.
        pub data: StringOrBuffer,
        pub dirfd: FD,
        pub signal: Option<webcore::RefPtr<AbortSignal>>,
    }
    impl WriteFile {
        pub fn deinit(&self) {
            self.file.deinit();
            self.data.deinit();
            if let Some(signal) = &self.signal { signal.pending_activity_unref(); signal.unref(); }
        }
        pub fn to_thread_safe(&mut self) { self.file.to_thread_safe(); self.data.to_thread_safe(); }
        pub fn deinit_and_unprotect(&mut self) {
            self.file.deinit_and_unprotect();
            self.data.deinit_and_unprotect();
            if let Some(signal) = &self.signal { signal.pending_activity_unref(); signal.unref(); }
        }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<WriteFile> {
            let path = PathOrFileDescriptor::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or a file descriptor"))?;
            let data_value = arguments.next_eat().ok_or_else(|| { path.deinit(); ctx.throw_invalid_arguments("data is required") })?;
            let mut encoding = Encoding::Buffer;
            let mut flag = FileSystemFlags::W;
            let mut mode: Mode = DEFAULT_PERMISSION;
            let mut abort_signal: Option<webcore::RefPtr<AbortSignal>> = None;
            // TODO(port): errdefer cleanup of abort_signal
            let mut flush = false;
            if data_value.is_string() { encoding = Encoding::Utf8; }
            if let Some(arg) = arguments.next() {
                arguments.eat();
                if arg.is_string() {
                    encoding = Encoding::assert(arg, ctx, encoding)?;
                } else if arg.is_object() {
                    encoding = get_encoding(arg, ctx, encoding)?;
                    if let Some(flag_) = arg.get_truthy(ctx, "flag")? {
                        flag = FileSystemFlags::from_js(ctx, flag_)?.ok_or_else(|| { path.deinit(); ctx.throw_invalid_arguments("Invalid flag") })?;
                    }
                    if let Some(mode_) = arg.get_truthy(ctx, "mode")? {
                        mode = node::mode_from_js(ctx, mode_)?.unwrap_or(mode);
                    }
                    if let Some(value) = arg.get_truthy(ctx, "signal")? {
                        if let Some(signal) = AbortSignal::from_js(value) {
                            abort_signal = Some(signal.ref_());
                            signal.pending_activity_ref();
                        } else {
                            path.deinit();
                            return Err(ctx.throw_invalid_argument_type_value("signal", "AbortSignal", value));
                        }
                    }
                    if let Some(flush_) = arg.get_optional::<JSValue>(ctx, "flush")? {
                        if flush_.is_boolean() || flush_.is_undefined_or_null() {
                            flush = flush_ == JSValue::TRUE;
                        } else {
                            path.deinit();
                            return Err(ctx.throw_invalid_argument_type_value("flush", "boolean", flush_));
                        }
                    }
                }
            }
            // String objects not allowed (typeof new String("hi") === "object")
            // https://github.com/nodejs/node/blob/6f946c95b9da75c70e868637de8161bc8d048379/lib/internal/fs/utils.js#L916
            let allow_string_object = false;
            // the pattern in node_fs.zig is to call toThreadSafe after Arguments.*.fromJS
            let is_async = false;
            let data = StringOrBuffer::from_js_with_encoding_maybe_async(ctx, data_value, encoding, is_async, allow_string_object)?
                .ok_or_else(|| { path.deinit(); ctx.err_invalid_arg_type("The \"data\" argument must be of type string or an instance of Buffer, TypedArray, or DataView").throw() })?;
            Ok(WriteFile { file: path, encoding, flag, mode, data, dirfd: FD::cwd(), signal: abort_signal, flush })
        }
        pub fn aborted(&self) -> bool {
            if let Some(signal) = &self.signal { return signal.aborted(); }
            false
        }
    }

    pub type AppendFile = WriteFile;

    pub struct OpenDir {
        pub path: PathLike,
        pub encoding: Encoding,
        /// Number of directory entries that are buffered internally when reading from the directory. Higher values lead to better performance but higher memory usage. Default: 32
        pub buffer_size: c_int,
    }
    impl OpenDir {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<OpenDir> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut encoding = Encoding::Buffer;
            let mut buffer_size: c_int = 32;
            if let Some(arg) = arguments.next() {
                arguments.eat();
                if arg.is_string() {
                    encoding = Encoding::assert(arg, ctx, encoding).unwrap_or(encoding);
                } else if arg.is_object() {
                    // TODO(port): Zig calls getEncoding(arg, ctx) with 2 args here (bug?); preserve behavior
                    if let Ok(e) = get_encoding(arg, ctx, encoding) { encoding = e; }
                    if let Some(bs) = arg.get(ctx, "bufferSize")? {
                        buffer_size = bs.to_int32();
                        if buffer_size < 0 { path.deinit(); return Err(ctx.throw_invalid_arguments("bufferSize must be > 0")); }
                    }
                }
            }
            Ok(OpenDir { path, encoding, buffer_size })
        }
    }

    pub struct Exists { pub path: Option<PathLike> }
    impl Exists {
        pub fn deinit(&self) { if let Some(p) = &self.path { p.deinit(); } }
        pub fn to_thread_safe(&mut self) { if let Some(p) = &mut self.path { p.to_thread_safe(); } }
        pub fn deinit_and_unprotect(&mut self) { if let Some(p) = &mut self.path { p.deinit_and_unprotect(); } }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Exists> {
            Ok(Exists { path: PathLike::from_js(ctx, arguments)? })
        }
    }

    pub struct Access {
        pub path: PathLike,
        pub mode: FileSystemFlags,
    }
    impl Access {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Access> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut mode = FileSystemFlags::R;
            if let Some(arg) = arguments.next() {
                arguments.eat();
                mode = FileSystemFlags::from_js_number_only(ctx, arg, FileSystemFlags::Kind::Access)?;
            }
            Ok(Access { path, mode })
        }
    }

    pub struct FdataSync { pub fd: FD }
    impl FdataSync {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<FdataSync> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            Ok(FdataSync { fd })
        }
    }

    pub struct CopyFile {
        pub src: PathLike,
        pub dest: PathLike,
        pub mode: constants::Copyfile,
    }
    impl CopyFile {
        pub fn deinit(&self) { self.src.deinit(); self.dest.deinit(); }
        pub fn to_thread_safe(&mut self) { self.src.to_thread_safe(); self.dest.to_thread_safe(); }
        pub fn deinit_and_unprotect(&self) { self.src.deinit_and_unprotect(); self.dest.deinit_and_unprotect(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<CopyFile> {
            let src = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("src must be a string or TypedArray"))?;
            let dest = match PathLike::from_js(ctx, arguments)? {
                Some(p) => p,
                None => { src.deinit(); return Err(ctx.throw_invalid_arguments("dest must be a string or TypedArray")); }
            };
            let mut mode = constants::Copyfile::from_raw(0);
            if let Some(arg) = arguments.next() {
                arguments.eat();
                mode = constants::Copyfile::from_raw(FileSystemFlags::from_js_number_only(ctx, arg, FileSystemFlags::Kind::CopyFile)?.as_int() as u8);
            }
            Ok(CopyFile { src, dest, mode })
        }
    }

    #[derive(Copy, Clone)]
    pub struct CpFlags {
        pub mode: constants::Copyfile,
        pub recursive: bool,
        pub error_on_exist: bool,
        pub force: bool,
        pub deinit_paths: bool,
    }
    impl Default for CpFlags {
        fn default() -> Self { Self { mode: constants::Copyfile::from_raw(0), recursive: false, error_on_exist: false, force: false, deinit_paths: true } }
    }

    pub struct Cp {
        pub src: PathLike,
        pub dest: PathLike,
        pub flags: CpFlags,
    }
    impl Cp {
        pub fn deinit(&self) {
            if self.flags.deinit_paths { self.src.deinit(); self.dest.deinit(); }
        }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Cp> {
            let src = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("src must be a string or TypedArray"))?;
            let dest = match PathLike::from_js(ctx, arguments)? {
                Some(p) => p,
                None => { src.deinit(); return Err(ctx.throw_invalid_arguments("dest must be a string or TypedArray")); }
            };
            let mut recursive = false;
            let mut error_on_exist = false;
            let mut force = true;
            let mut mode: i32 = 0;
            if let Some(arg) = arguments.next() { arguments.eat(); recursive = arg.to_boolean(); }
            if let Some(arg) = arguments.next() { arguments.eat(); error_on_exist = arg.to_boolean(); }
            if let Some(arg) = arguments.next() { arguments.eat(); force = arg.to_boolean(); }
            if let Some(arg) = arguments.next() {
                arguments.eat();
                if arg.is_number() { mode = arg.coerce::<i32>(ctx)?; }
            }
            Ok(Cp { src, dest, flags: CpFlags {
                mode: constants::Copyfile::from_raw(mode as u8),
                recursive, error_on_exist, force, deinit_paths: true,
            } })
        }
    }

    pub struct WriteEv {
        pub fd: FD,
        pub buffers: Box<[ArrayBuffer]>,
        pub position: ReadPosition,
    }

    pub struct ReadEv {
        pub fd: FD,
        pub buffers: Box<[ArrayBuffer]>,
        pub position: ReadPosition,
    }

    pub type UnwatchFile = ();
    pub type Watch = super::Watcher::Arguments;
    pub type WatchFile = super::StatWatcher::Arguments;

    pub struct Fsync { pub fd: FD }
    impl Fsync {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Fsync> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            Ok(Fsync { fd })
        }
    }
}
pub use args as Arguments;
