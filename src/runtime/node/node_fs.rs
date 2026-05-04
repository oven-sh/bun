// This file contains the underlying implementation for sync & async functions
// for interacting with the filesystem from JavaScript.
// The top-level functions assume the arguments are already validated

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::mem::offset_of;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use bun_aio::KeepAlive;
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
            // SAFETY: all-zero is a valid Maybe<R>; written before read
            result: unsafe { core::mem::zeroed() },
            global_object: global_object as *const _ as *mut _,
            // SAFETY: all-zero is a valid uv::fs_t (libuv POD)
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
        // SAFETY: req points to a live uv::fs_t passed by libuv; cleanup is the documented pair
        let _cleanup = scopeguard::guard((), |_| unsafe { uv::uv_fs_req_cleanup(req) });
        let mut node_fs = NodeFS::default();
        // TODO(port): dispatch to NodeFS::uv_<F>(&node_fs, this.args, req.result as i64)
        // SAFETY: req is the live libuv request passed to this callback
        this.result = NodeFS::uv_dispatch::<R, A, F>(&mut node_fs, &this.args, unsafe { (*req).result } as i64);
        if let Maybe::Err(err) = &mut this.result {
            *err = err.clone();
            core::hint::black_box(&node_fs);
        }
        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
        unsafe { &*this.global_object }.bun_vm().event_loop().enqueue_task(Task::init(this));
    }

    extern "C" fn uv_callbackreq(req: *mut uv::fs_t) {
        // Same as uv_callback but passes `req` to the dispatch fn (statfs needs req.ptr).
        // TODO(port): mirror node_fs.zig:276-288
        Self::uv_callback(req);
    }

    pub fn run_from_js_thread(&mut self) -> Result<(), bun_jsc::JSTerminated> {
        // SAFETY: self was Box::leak'd in create(); destroy() runs exactly once on scope exit
        let _deinit = scopeguard::guard(self as *mut Self, |p| unsafe { Self::destroy(p) });
        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
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

    /// SAFETY: `this` must be the pointer Box::leak'd in `create()`; called exactly once.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller guarantees `this` is a live Box-leaked allocation
        let this_ref = unsafe { &mut *this };
        if let Maybe::Err(err) = &mut this_ref.result {
            err.deinit();
        }
        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
        this_ref.r#ref.unref(unsafe { &*this_ref.global_object }.bun_vm());
        this_ref.args.deinit_and_unprotect();
        this_ref.promise.deinit();
        // SAFETY: paired with Box::leak in create()
        drop(unsafe { Box::from_raw(this) });
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
        // SAFETY: task points to Self.task; container_of via offset_of
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

        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
        unsafe { &*this.global_object }
            .bun_vm_concurrently()
            .event_loop()
            .enqueue_task_concurrent(ConcurrentTask::create_from(this));
    }

    pub fn run_from_js_thread(&mut self) -> Result<(), bun_jsc::JSTerminated> {
        // SAFETY: self was Box::leak'd in create(); destroy() runs exactly once on scope exit
        let _deinit = scopeguard::guard(self as *mut Self, |p| unsafe { Self::destroy(p) });
        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
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

    /// SAFETY: `this` must be the pointer Box::leak'd in `create()`; called exactly once.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller guarantees `this` is a live Box-leaked allocation
        let this_ref = unsafe { &mut *this };
        if let Maybe::Err(err) = &mut this_ref.result {
            err.deinit();
        }
        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
        this_ref.r#ref.unref(unsafe { &*this_ref.global_object }.bun_vm());
        this_ref.args.deinit_and_unprotect();
        this_ref.promise.deinit();
        // SAFETY: paired with Box::leak in create()
        drop(unsafe { Box::from_raw(this) });
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
    // PERF(port): was arena bulk-free — profile in Phase B
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
        // SAFETY: cp_task is set in create() and the parent outlives all subtasks (subtask_count refcount)
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

        // SAFETY: `this` was Box::leak'd in create(); destroyed exactly once here
        unsafe { Self::destroy(this as *mut Self) };
        // Must be the very last use of `parent`: when the count reaches
        // zero, runFromJSThread is enqueued and may destroy the parent.
        parent.on_subtask_done();
    }

    /// SAFETY: `this` must be the pointer Box::leak'd in `create()`; called exactly once.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller guarantees `this` is a live Box-leaked allocation
        let this_ref = unsafe { &mut *this };
        // There is only one path buffer for both paths. 2 extra bytes are the nulls at the end of each
        let total_len = this_ref.src.len() + this_ref.dest.len() + 2;
        // SAFETY: src.ptr is the start of a heap allocation of `total_len` OSPathChar
        unsafe {
            drop(Box::from_raw(core::slice::from_raw_parts_mut(
                this_ref.src.as_ptr() as *mut OSPathChar,
                total_len,
            )));
        }
        // SAFETY: paired with Box::leak in create()
        drop(unsafe { Box::from_raw(this) });
    }
}

impl<const IS_SHELL: bool> NewAsyncCpTask<IS_SHELL> {
    pub fn on_copy(&mut self, src: impl AsRef<[OSPathChar]>, dest: impl AsRef<[OSPathChar]>) {
        if !IS_SHELL { return; }
        // SAFETY: when IS_SHELL, shelltask is non-null and outlives this task
        unsafe { &mut *self.shelltask }.cp_on_copy(src, dest);
    }

    pub fn on_finish(&mut self, result: Maybe<()>) {
        if !IS_SHELL { return; }
        // SAFETY: when IS_SHELL, shelltask is non-null and outlives this task
        unsafe { &mut *self.shelltask }.cp_on_finish(result);
    }

    pub fn create(
        global_object: &JSGlobalObject,
        _binding: &mut Binding,
        cp_args: args::Cp,
        vm: &mut VirtualMachine,
    ) -> JSValue {
        let task = Self::create_with_shell_task(global_object, cp_args, vm, core::ptr::null_mut(), true);
        // SAFETY: create_with_shell_task returns a Box::leak'd pointer; valid until destroy()
        unsafe { &*task }.promise.value()
    }

    pub fn create_with_shell_task(
        global_object: &JSGlobalObject,
        cp_args: args::Cp,
        vm: &mut VirtualMachine,
        shelltask: *mut ShellCpTask,
        enable_promise: bool,
    ) -> *mut Self {
        let mut task = Box::new(Self {
            promise: if enable_promise { JSPromise::Strong::init(global_object) } else { JSPromise::Strong::default() },
            args: cp_args,
            has_result: AtomicBool::new(false),
            // SAFETY: all-zero is a valid Maybe<ret::Cp>; written before read
            result: unsafe { core::mem::zeroed() },
            evtloop: EventLoopHandle::Js(vm.event_loop),
            task: WorkPoolTask { callback: Self::work_pool_callback },
            r#ref: KeepAlive::default(),
            tracker: AsyncTaskTracker::init(vm),
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
        shelltask: *mut ShellCpTask,
    ) -> *mut Self {
        let mut task = Box::new(Self {
            promise: JSPromise::Strong::default(),
            args: cp_args,
            has_result: AtomicBool::new(false),
            // SAFETY: all-zero is a valid Maybe<ret::Cp>; written before read
            result: unsafe { core::mem::zeroed() },
            evtloop: EventLoopHandle::Mini(mini),
            task: WorkPoolTask { callback: Self::work_pool_callback },
            r#ref: KeepAlive::default(),
            tracker: AsyncTaskTracker { id: 0 },
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
            // SAFETY: shelltask is set by create_with_shell_task/create_mini and outlives this task
            unsafe { &mut *self.shelltask }.cp_on_finish(self.result);
            // SAFETY: self was Box::leak'd in create*(); destroyed exactly once here
            unsafe { Self::destroy(self as *mut Self) };
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

        // SAFETY: self was Box::leak'd in create*(); destroyed exactly once here
        unsafe { Self::destroy(self as *mut Self) };
        if success {
            promise.resolve(global_object, result)?;
        } else {
            promise.reject(global_object, result)?;
        }
        Ok(())
    }

    /// SAFETY: `this` must be the pointer returned by Box::leak in
    /// `create_with_shell_task()`/`create_mini()`; called exactly once.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller guarantees `this` is a live Box-leaked allocation
        let this_ref = unsafe { &mut *this };
        if let Maybe::Err(err) = &mut this_ref.result {
            err.deinit();
        }
        if !IS_SHELL { this_ref.r#ref.unref(this_ref.evtloop); }
        this_ref.args.deinit();
        this_ref.promise.deinit();
        // SAFETY: paired with Box::leak in create_with_shell_task()/create_mini()
        drop(unsafe { Box::from_raw(this) });
    }

    /// Directory scanning + clonefile will block this thread, then each individual file copy (what the sync version
    /// calls "_copySingleFileSync") will be dispatched as a separate task.
    pub fn cp_async(nodefs: &mut NodeFS, this: &mut Self) {
        // The directory-scan task holds one reference in `subtask_count`
        // (initialized to 1 in create*). Drop it on return. `runFromJSThread`
        // (which destroys `this`) is only enqueued once this reference and
        // every spawned SingleTask's reference have been dropped.
        // SAFETY: `this` is the live Box-leaked task; on_subtask_done only enqueues destruction
        // once every reference (including this one) has been dropped.
        let _done = scopeguard::guard(this as *mut Self, |p| unsafe { (*p).on_subtask_done() });
        // SAFETY: same pointer as above; valid for the duration of this fn
        let this = unsafe { &mut **_done };

        let args = &this.args;
        let mut src_buf = OSPathBuffer::uninit();
        let mut dest_buf = OSPathBuffer::uninit();
        let src = args.src.os_path(&mut src_buf);
        let dest = args.dest.os_path(&mut dest_buf);

        #[cfg(windows)]
        {
            // SAFETY: src is NUL-terminated (os_path); GetFileAttributesW is the Win32 FFI
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
            PathString::PathInt::try_from(src.len()).unwrap(),
            &mut dest_buf,
            PathString::PathInt::try_from(dest.len()).unwrap(),
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
                // SAFETY: src/dest are NUL-terminated; clonefile is the libc FFI
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
                    // SAFETY: raw[sd+1+cname.len()] == 0 written above
                    let src_z = unsafe { OSPathSliceZ::from_raw(raw.as_ptr(), sd + 1 + cname.len()) };
                    // SAFETY: raw[dest_off+dd+1+cname.len()] == 0 written above
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
        // SAFETY: `this` is the Box::leak'd subtask; basename was allocator.dupeZ'd in enqueue()
        let _cleanup = scopeguard::guard(this as *mut Self, |p| unsafe {
            // free duped basename + destroy self
            drop(Box::from_raw((*p).basename.slice_assume_z().as_ptr() as *mut u8));
            drop(Box::from_raw(p));
        });
        let mut buf = PathBuffer::uninit();
        // SAFETY: readdir_task (BACKREF) outlives subtask via subtask_count refcount
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
        // SAFETY: task points to Self.task; container_of via offset_of
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
                    // SAFETY: paired with Box::leak in write_results()
                    unsafe { drop(Box::from_raw(dest)) };
                }
                to_destroy = Some(val);
                // SAFETY: `val` came from the queue and is live until Box::from_raw above on the next iter
                self.result_list.append_from(&mut unsafe { &mut *val }.value);
            }
            if let Some(dest) = to_destroy {
                // SAFETY: paired with Box::leak in write_results()
                unsafe { drop(Box::from_raw(dest)) };
            }
        }

        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
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
            // SAFETY: `val` is a live queue node until freed below
            unsafe { &mut *val }.value.deinit();
            // SAFETY: paired with Box::leak in write_results()
            if let Some(dest) = to_destroy { unsafe { drop(Box::from_raw(dest)) }; }
            to_destroy = Some(val);
        }
        // SAFETY: paired with Box::leak in write_results()
        if let Some(dest) = to_destroy { unsafe { drop(Box::from_raw(dest)) }; }
        self.result_list_count.store(0, Ordering::Relaxed);
    }

    pub fn run_from_js_thread(&mut self) -> Result<(), bun_jsc::JSTerminated> {
        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
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

        // SAFETY: self was Box::leak'd in create(); destroyed exactly once here
        unsafe { Self::destroy(self as *mut Self) };
        if success {
            promise.resolve(global_object, result)?;
        } else {
            promise.reject(global_object, result)?;
        }
        Ok(())
    }

    /// SAFETY: `this` must be the pointer Box::leak'd in `create()`; called exactly once.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller guarantees `this` is a live Box-leaked allocation
        let this_ref = unsafe { &mut *this };
        debug_assert!(this_ref.root_fd == FD::INVALID); // should already have closed it
        if let Some(err) = &mut this_ref.pending_err { err.deinit(); }
        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
        this_ref.r#ref.unref(unsafe { &*this_ref.global_object }.bun_vm());
        this_ref.args.deinit();
        // TODO(port): free root_path slice
        this_ref.clear_result_list();
        this_ref.promise.deinit();
        // SAFETY: paired with Box::leak in create()
        drop(unsafe { Box::from_raw(this) });
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
            let len: Blob::SizeType = Blob::SizeType::try_from(
                node::validators::validate_integer(
                    ctx,
                    arguments.next().unwrap_or(JSValue::js_number(0)),
                    "len",
                    Some(i64::from(i52::MIN)),
                    Some(Blob::SizeType::MAX as i64),
                )?
                .max(0),
            )
            .unwrap();
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
                        retry_delay = c_uint::try_from(node::validators::validate_integer(ctx, delay, "options.retryDelay", Some(0), Some(c_uint::MAX as i64))?).unwrap();
                    }
                    if let Some(retries) = val.get(ctx, "maxRetries")? {
                        max_retries = u32::try_from(node::validators::validate_integer(ctx, retries, "options.maxRetries", Some(0), Some(u32::MAX as i64))?).unwrap();
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
                        args.offset = u64::try_from(node::validators::validate_integer(ctx, current, "offset", Some(0), Some(9007199254740991))?).unwrap();
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
                        args.length = u64::try_from(length).unwrap();
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
                u64::try_from(node::validators::validate_integer(ctx, offset_value, "offset", Some(0), Some(bun_jsc::MAX_SAFE_INTEGER))?).unwrap()
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
            if i64::try_from(offset).unwrap().saturating_add(length_int) > buf_len as i64 {
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
            let mut abort_signal = scopeguard::guard(None::<webcore::RefPtr<AbortSignal>>, |s| {
                if let Some(signal) = s { signal.pending_activity_unref(); signal.unref(); }
            });
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
                            *abort_signal = Some(signal.ref_());
                            signal.pending_activity_ref();
                        } else {
                            path.deinit();
                            return Err(ctx.throw_invalid_argument_type_value("signal", "AbortSignal", value));
                        }
                    }
                }
            }
            let abort_signal = scopeguard::ScopeGuard::into_inner(abort_signal);
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
            let mut abort_signal = scopeguard::guard(None::<webcore::RefPtr<AbortSignal>>, |s| {
                if let Some(signal) = s { signal.pending_activity_unref(); signal.unref(); }
            });
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

// ──────────────────────────────────────────────────────────────────────────
// Return types
// ──────────────────────────────────────────────────────────────────────────

pub enum StatOrNotFound {
    Stats(Stats),
    NotFound,
}
impl StatOrNotFound {
    pub fn to_js(&mut self, global_object: &JSGlobalObject) -> JSValue {
        match self {
            StatOrNotFound::Stats(s) => s.to_js(global_object),
            StatOrNotFound::NotFound => JSValue::UNDEFINED,
        }
    }
    pub fn to_js_newly_created(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            StatOrNotFound::Stats(s) => s.to_js_newly_created(global_object),
            StatOrNotFound::NotFound => Ok(JSValue::UNDEFINED),
        }
    }
}

pub enum StringOrUndefined {
    String(BunString),
    None,
}
impl StringOrUndefined {
    pub fn to_js(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            StringOrUndefined::String(s) => s.transfer_to_js(global_object),
            StringOrUndefined::None => Ok(JSValue::UNDEFINED),
        }
    }
}

/// For use in `Return`'s definitions to act as `void` while returning `null` to JavaScript
pub struct Null;
impl Null {
    pub fn to_js(&self, _: &JSGlobalObject) -> JSValue { JSValue::NULL }
}

pub mod ret {
    use super::*;

    pub type Access = Null;
    pub type AppendFile = ();
    pub type Close = ();
    pub type CopyFile = ();
    pub type Cp = ();
    pub type Exists = bool;
    pub type Fchmod = ();
    pub type Chmod = ();
    pub type Fchown = ();
    pub type Fdatasync = ();
    pub type Fstat = Stats;
    pub type Rm = ();
    pub type Fsync = ();
    pub type Ftruncate = ();
    pub type Futimes = ();
    pub type Lchmod = ();
    pub type Lchown = ();
    pub type Link = ();
    pub type Lstat = StatOrNotFound;
    pub type Mkdir = StringOrUndefined;
    pub type Mkdtemp = ZigString;
    pub type Open = FD;
    pub type WriteFile = ();
    pub type Readv = Read;
    pub type StatFS = node::StatFS;

    pub struct Read { pub bytes_read: u64 /* u52 */ }
    impl Read {
        pub fn to_js(&self, _: &JSGlobalObject) -> JSValue { JSValue::js_number_from_uint64(self.bytes_read) }
    }

    pub struct ReadPromise {
        pub bytes_read: u64,
        pub buffer_val: JSValue,
    }
    impl ReadPromise {
        const FIELD_BYTES_READ: ZigString = ZigString::init_static(b"bytesRead");
        const FIELD_BUFFER: ZigString = ZigString::init_static(b"buffer");
        pub fn to_js(&self, ctx: &JSGlobalObject) -> JsResult<JSValue> {
            let _unprotect = scopeguard::guard(self.buffer_val, |v| if !v.is_empty_or_undefined_or_null() { v.unprotect() });
            JSValue::create_object_2(
                ctx,
                &Self::FIELD_BYTES_READ,
                &Self::FIELD_BUFFER,
                JSValue::js_number_from_uint64(self.bytes_read.min((1u64 << 52) - 1)),
                self.buffer_val,
            )
        }
    }

    pub struct WritePromise {
        pub bytes_written: u64,
        pub buffer: StringOrBuffer,
        pub buffer_val: JSValue,
    }
    impl WritePromise {
        const FIELD_BYTES_WRITTEN: ZigString = ZigString::init_static(b"bytesWritten");
        const FIELD_BUFFER: ZigString = ZigString::init_static(b"buffer");
        // Excited for the issue that's like "cannot read file bigger than 2 GB"
        pub fn to_js(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
            let _unprotect = scopeguard::guard(self.buffer_val, |v| if !v.is_empty_or_undefined_or_null() { v.unprotect() });
            JSValue::create_object_2(
                global_object,
                &Self::FIELD_BYTES_WRITTEN,
                &Self::FIELD_BUFFER,
                JSValue::js_number_from_uint64(self.bytes_written.min((1u64 << 52) - 1)),
                if matches!(self.buffer, StringOrBuffer::Buffer(_)) { self.buffer_val } else { self.buffer.to_js(global_object) },
            )
        }
    }

    pub struct Write { pub bytes_written: u64 /* u52 */ }
    impl Write {
        // Excited for the issue that's like "cannot read file bigger than 2 GB"
        pub fn to_js(&self, _: &JSGlobalObject) -> JSValue { JSValue::js_number_from_uint64(self.bytes_written) }
    }

    #[derive(Copy, Clone, PartialEq, Eq)]
    pub enum ReaddirTag { WithFileTypes, Buffers, Files }

    pub enum Readdir {
        WithFileTypes(Box<[Dirent]>),
        Buffers(Box<[Buffer]>),
        Files(Box<[BunString]>),
    }
    impl Readdir {
        pub fn to_js(self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
            match self {
                Readdir::WithFileTypes(items) => {
                    let array = JSValue::create_empty_array(global_object, items.len())?;
                    let mut previous_jsstring: Option<*mut bun_jsc::JSString> = None;
                    for (i, item) in items.iter().enumerate() {
                        let res = item.to_js_newly_created(global_object, &mut previous_jsstring)?;
                        array.put_index(global_object, i as u32, res)?;
                    }
                    // items dropped here (auto free)
                    Ok(array)
                }
                Readdir::Buffers(items) => {
                    let v = JSValue::from_any(global_object, &items[..]);
                    drop(items);
                    v
                }
                Readdir::Files(items) => {
                    // automatically freed
                    JSValue::from_any(global_object, &items[..])
                }
            }
        }
    }

    pub type ReadFile = StringOrBuffer;

    pub enum ReadFileWithOptions {
        String(Box<[u8]>),
        TranscodedString(BunString),
        Buffer(Buffer),
        NullTerminated(Box<ZStr>), // [:0]const u8 owned
    }

    pub type Readlink = StringOrBuffer;
    pub type Realpath = StringOrBuffer;
    pub type RealpathNative = Realpath;
    pub type Rename = ();
    pub type Rmdir = ();
    pub type Stat = StatOrNotFound;
    pub type Symlink = ();
    pub type Truncate = ();
    pub type Unlink = ();
    pub type UnwatchFile = ();
    pub type Watch = JSValue;
    pub type WatchFile = JSValue;
    pub type Utimes = ();
    pub type Chown = ();
    pub type Lutimes = ();
    pub type Writev = Write;
}
pub use ret as Return;

// ──────────────────────────────────────────────────────────────────────────
// NodeFS — Bun's implementation of the Node.js "fs" module
// https://nodejs.org/api/fs.html
// https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/node/fs.d.ts
// ──────────────────────────────────────────────────────────────────────────

pub struct NodeFS {
    /// Buffer to store a temporary file path that might appear in a returned error message.
    ///
    /// We want to avoid allocating a new path buffer for every error message so that jsc can clone + GC it.
    /// That means a stack-allocated buffer won't suffice. Instead, we re-use
    /// the heap allocated buffer on the NodeFS struct
    pub sync_error_buf: PathBuffer, // align(@alignOf(u16))
    pub vm: Option<NonNull<VirtualMachine>>,
}

impl Default for NodeFS {
    fn default() -> Self { Self { sync_error_buf: PathBuffer::uninit(), vm: None } }
}

impl NodeFS {
    pub type ReturnType = ret;

    pub fn access(&mut self, args: &args::Access, _: Flavor) -> Maybe<ret::Access> {
        let path: OSPathSliceZ = if args.path.slice().is_empty() {
            paths::os_path_literal!("")
        } else {
            args.path.os_path_kernel32(&mut self.sync_error_buf)
        };
        match Syscall::access(path, args.mode.as_int()) {
            Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(_) => Maybe::Ok(Null),
        }
    }

    pub fn append_file(&mut self, args: &args::AppendFile, _: Flavor) -> Maybe<ret::AppendFile> {
        let mut data = args.data.slice();
        match &args.file {
            PathOrFileDescriptor::Fd(fd) => {
                while !data.is_empty() {
                    let written = match Syscall::write(*fd, data) {
                        Maybe::Ok(result) => result,
                        Maybe::Err(err) => return Maybe::Err(err),
                    };
                    data = &data[written..];
                }
                Maybe::SUCCESS
            }
            PathOrFileDescriptor::Path(path_) => {
                let path = path_.slice_z(&mut self.sync_error_buf);
                let fd = match Syscall::open(path, FileSystemFlags::A.as_int(), args.mode) {
                    Maybe::Ok(result) => result,
                    Maybe::Err(err) => return Maybe::Err(err),
                };
                let _close = scopeguard::guard(fd, |fd| fd.close());
                while !data.is_empty() {
                    let written = match Syscall::write(fd, data) {
                        Maybe::Ok(result) => result,
                        Maybe::Err(err) => return Maybe::Err(err),
                    };
                    data = &data[written..];
                }
                Maybe::SUCCESS
            }
        }
    }

    pub fn close(&mut self, args: &args::Close, _: Flavor) -> Maybe<ret::Close> {
        if let Some(err) = args.fd.close_allowing_bad_file_descriptor(None) {
            Maybe::Err(err)
        } else {
            Maybe::SUCCESS
        }
    }

    pub fn uv_close(&mut self, args: &args::Close, rc: i64) -> Maybe<ret::Close> {
        if rc < 0 {
            return Maybe::Err(sys::Error { errno: (-rc) as _, syscall: sys::Tag::close, fd: args.fd, from_libuv: true, ..Default::default() });
        }
        Maybe::SUCCESS
    }

    // since we use a 64 KB stack buffer, we should not let this function get inlined
    #[inline(never)]
    pub fn copy_file_using_read_write_loop(
        src: &ZStr, dest: &ZStr, src_fd: FD, dest_fd: FD, stat_size: usize, wrote: &mut u64,
    ) -> Maybe<ret::CopyFile> {
        let mut stack_buf = [0u8; 64 * 1024];
        let mut buf_to_free: Vec<u8> = Vec::new();
        let mut buf: &mut [u8] = &mut stack_buf;

        'maybe_allocate_large_temp_buf: {
            if stat_size > stack_buf.len() * 16 {
                // Don't allocate more than 8 MB at a time
                let clamped_size: usize = stat_size.min(8 * 1024 * 1024);
                let Ok(()) = (|| { buf_to_free.try_reserve_exact(clamped_size)?; buf_to_free.resize(clamped_size, 0); Ok::<(), std::collections::TryReserveError>(()) })()
                    else { break 'maybe_allocate_large_temp_buf };
                buf = &mut buf_to_free[..];
            }
        }
        // buf_to_free dropped at scope exit

        let mut remain = stat_size.max(0) as u64;
        'toplevel: while remain > 0 {
            let amt = match Syscall::read(src_fd, &mut buf[..(buf.len() as u64).min(remain) as usize]) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => return Maybe::Err(if !src.is_empty() { err.with_path(src) } else { err }),
            };
            // 0 == EOF
            if amt == 0 { break 'toplevel; }
            *wrote += amt as u64;
            remain = remain.saturating_sub(amt as u64);

            let mut slice = &buf[..amt];
            while !slice.is_empty() {
                let written = match Syscall::write(dest_fd, slice) {
                    Maybe::Ok(result) => result,
                    Maybe::Err(err) => return Maybe::Err(if !dest.is_empty() { err.with_path(dest) } else { err }),
                };
                if written == 0 { break 'toplevel; }
                slice = &slice[written..];
            }
        }
        if remain == 0 {
            'outer: loop {
                let amt = match Syscall::read(src_fd, buf) {
                    Maybe::Ok(result) => result,
                    Maybe::Err(err) => return Maybe::Err(if !src.is_empty() { err.with_path(src) } else { err }),
                };
                // we don't know the size
                // so we just go forever until we get an EOF
                if amt == 0 { break; }
                *wrote += amt as u64;

                let mut slice = &buf[..amt];
                while !slice.is_empty() {
                    let written = match Syscall::write(dest_fd, slice) {
                        Maybe::Ok(result) => result,
                        Maybe::Err(err) => return Maybe::Err(if !dest.is_empty() { err.with_path(dest) } else { err }),
                    };
                    slice = &slice[written..];
                    if written == 0 { break 'outer; }
                }
            }
        }

        Maybe::SUCCESS
    }

    // copy_file_range() is frequently not supported across devices, such as tmpfs.
    // This is relevant for `bun install`
    // However, sendfile() is supported across devices.
    // Only on Linux. There are constraints though. It cannot be used if the file type does not support
    #[inline(never)]
    pub fn copy_file_using_sendfile_on_linux_with_read_write_fallback(
        src: &ZStr, dest: &ZStr, src_fd: FD, dest_fd: FD, stat_size: usize, wrote: &mut u64,
    ) -> Maybe<ret::CopyFile> {
        loop {
            let amt = match sys::sendfile(src_fd, dest_fd, i32::MAX as usize - 1) {
                Maybe::Err(_) => {
                    return Self::copy_file_using_read_write_loop(src, dest, src_fd, dest_fd, stat_size, wrote);
                }
                Maybe::Ok(amount) => amount,
            };
            *wrote += amt as u64;
            if amt == 0 { break; }
        }
        Maybe::SUCCESS
    }

    pub fn copy_file(&mut self, args: &args::CopyFile, _: Flavor) -> Maybe<ret::CopyFile> {
        match self.copy_file_inner(args) {
            Maybe::Ok(_) => Maybe::SUCCESS,
            Maybe::Err(err) => Maybe::Err(sys::Error {
                errno: err.errno,
                syscall: sys::Tag::copyfile,
                path: args.src.slice().into(),
                dest: args.dest.slice().into(),
                ..Default::default()
            }),
        }
    }

    /// https://github.com/libuv/libuv/pull/2233
    /// https://github.com/pnpm/pnpm/issues/2761
    /// https://github.com/libuv/libuv/pull/2578
    /// https://github.com/nodejs/node/issues/34624
    fn copy_file_inner(&mut self, args: &args::CopyFile) -> Maybe<ret::CopyFile> {
        // TODO: do we need to fchown?
        #[cfg(target_os = "macos")]
        {
            let mut src_buf = PathBuffer::uninit();
            let mut dest_buf = PathBuffer::uninit();
            let src = args.src.slice_z(&mut src_buf);
            let dest = args.dest.slice_z(&mut dest_buf);

            if args.mode.is_force_clone() {
                // https://www.manpagez.com/man/2/clonefile/
                // SAFETY: src/dest are NUL-terminated; clonefile is the libc FFI
                return Maybe::<ret::CopyFile>::errno_sys_p(unsafe { bun_sys::c::clonefile(src.as_ptr(), dest.as_ptr(), 0) }, sys::Tag::copyfile, src)
                    .unwrap_or(Maybe::SUCCESS);
            } else {
                let stat_ = match Syscall::stat(src) {
                    Maybe::Ok(result) => result,
                    Maybe::Err(err) => return Maybe::Err(err.with_path(src)),
                };

                if !sys::S::isreg(stat_.mode) {
                    return Maybe::Err(sys::Error { errno: SystemErrno::ENOTSUP as _, syscall: sys::Tag::copyfile, ..Default::default() });
                }

                // 64 KB is about the break-even point for clonefile() to be worth it
                // at least, on an M1 with an NVME SSD.
                if stat_.size > 128 * 1024 {
                    if !args.mode.shouldnt_overwrite() {
                        // clonefile() will fail if it already exists
                        let _ = Syscall::unlink(dest);
                    }
                    // SAFETY: src/dest are NUL-terminated; clonefile is the libc FFI
                    if Maybe::<ret::CopyFile>::errno_sys_p(unsafe { bun_sys::c::clonefile(src.as_ptr(), dest.as_ptr(), 0) }, sys::Tag::copyfile, src).is_none() {
                        let _ = Syscall::chmod(dest, stat_.mode);
                        return Maybe::SUCCESS;
                    }
                } else {
                    let src_fd = match Syscall::open(src, sys::O::RDONLY, 0o644) {
                        Maybe::Ok(result) => result,
                        Maybe::Err(err) => return Maybe::Err(err.with_path(args.src.slice())),
                    };
                    let _close_src = scopeguard::guard(src_fd, |fd| fd.close());

                    let mut flags: Mode = sys::O::CREAT | sys::O::WRONLY;
                    let mut wrote: usize = 0;
                    if args.mode.shouldnt_overwrite() { flags |= sys::O::EXCL; }

                    let dest_fd = match Syscall::open(dest, flags, DEFAULT_PERMISSION) {
                        Maybe::Ok(result) => result,
                        Maybe::Err(err) => return Maybe::Err(err.with_path(args.dest.slice())),
                    };
                    let _close_dest = scopeguard::guard((dest_fd, &mut wrote, stat_.mode), |(fd, w, m)| {
                        let _ = Syscall::ftruncate(fd, (*w as u64 & ((1u64 << 63) - 1)) as i64);
                        let _ = Syscall::fchmod(fd, m);
                        fd.close();
                    });

                    return Self::copy_file_using_read_write_loop(src, dest, src_fd, dest_fd, stat_.size.max(0) as usize, &mut wrote);
                }
            }

            // we fallback to copyfile() when the file is > 128 KB and clonefile fails
            // clonefile() isn't supported on all devices
            // nor is it supported across devices
            let mut mode: u32 = bun_sys::c::COPYFILE_ACL | bun_sys::c::COPYFILE_DATA;
            if args.mode.shouldnt_overwrite() { mode |= bun_sys::c::COPYFILE_EXCL; }
            // SAFETY: src/dest are NUL-terminated; copyfile(3) is the libc FFI
            return Maybe::<ret::CopyFile>::errno_sys_p(unsafe { bun_sys::c::copyfile(src.as_ptr(), dest.as_ptr(), core::ptr::null_mut(), mode) }, sys::Tag::copyfile, src)
                .unwrap_or(Maybe::SUCCESS);
        }

        #[cfg(target_os = "freebsd")]
        {
            // TODO(port): FreeBSD copyFileInner — see node_fs.zig:3639-3709. Logic preserved structurally below.
            let mut src_buf = PathBuffer::uninit();
            let mut dest_buf = PathBuffer::uninit();
            let src = args.src.slice_z(&mut src_buf);
            let dest = args.dest.slice_z(&mut dest_buf);
            if args.mode.is_force_clone() {
                return Maybe::Err(sys::Error { errno: SystemErrno::EOPNOTSUPP as _, syscall: sys::Tag::copyfile, ..Default::default() });
            }
            // ... (open src, fstat, open dest, same-inode check, ftruncate(0), copy_file_range loop, fallback)
            // TODO(port): full FreeBSD body
            let _ = (src, dest);
            return Maybe::<ret::CopyFile>::todo();
        }

        #[cfg(target_os = "linux")]
        {
            let mut src_buf = PathBuffer::uninit();
            let mut dest_buf = PathBuffer::uninit();
            let src = args.src.slice_z(&mut src_buf);
            let dest = args.dest.slice_z(&mut dest_buf);

            let src_fd = match Syscall::open(src, sys::O::RDONLY, 0o644) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => return Maybe::Err(err),
            };
            let _close_src = scopeguard::guard(src_fd, |fd| fd.close());

            let stat_ = match Syscall::fstat(src_fd) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => return Maybe::Err(err),
            };

            if !sys::S::isreg(stat_.mode) {
                return Maybe::Err(sys::Error { errno: SystemErrno::ENOTSUP as _, syscall: sys::Tag::copyfile, ..Default::default() });
            }

            let mut flags: i32 = sys::O::CREAT | sys::O::WRONLY;
            let mut wrote: usize = 0;
            if args.mode.shouldnt_overwrite() { flags |= sys::O::EXCL; }

            let dest_fd = match Syscall::open(dest, flags, DEFAULT_PERMISSION) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => return Maybe::Err(err),
            };

            let mut size: usize = stat_.size.max(0) as usize;

            // https://manpages.debian.org/testing/manpages-dev/ioctl_ficlone.2.en.html
            if args.mode.is_force_clone() {
                if let Some(err) = Maybe::<ret::CopyFile>::errno_sys_p(sys::linux::ioctl_ficlone(dest_fd, src_fd), sys::Tag::ioctl_ficlone, dest) {
                    dest_fd.close();
                    // This is racey, but it's the best we can do
                    let _ = sys::unlink(dest);
                    return err;
                }
                let _ = Syscall::fchmod(dest_fd, stat_.mode);
                dest_fd.close();
                return Maybe::SUCCESS;
            }

            // If we know it's a regular file and ioctl_ficlone is available, attempt to use it.
            if sys::S::isreg(stat_.mode) && sys::can_use_ioctl_ficlone() {
                let rc = sys::linux::ioctl_ficlone(dest_fd, src_fd);
                if rc == 0 {
                    let _ = Syscall::fchmod(dest_fd, stat_.mode);
                    dest_fd.close();
                    return Maybe::SUCCESS;
                }
                // If this fails for any reason, we say it's disabled
                // We don't want to add the system call overhead of running this function on a lot of files that don't support it
                sys::disable_ioctl_ficlone();
            }

            let _close_dest = scopeguard::guard((dest_fd, stat_.mode), |(fd, m)| {
                // SAFETY: fd is a valid open dest_fd; ftruncate/fchmod are libc FFI
                let _ = unsafe { sys::linux::ftruncate(fd.cast(), (wrote as u64 & ((1u64 << 63) - 1)) as i64) };
                // SAFETY: same fd as above
                let _ = unsafe { sys::linux::fchmod(fd.cast(), m) };
                fd.close();
            });

            let mut off_in_copy: i64 = 0;
            let mut off_out_copy: i64 = 0;

            if !sys::can_use_copy_file_range_syscall() {
                return Self::copy_file_using_sendfile_on_linux_with_read_write_fallback(src, dest, src_fd, dest_fd, size, &mut (wrote as u64));
            }

            if size == 0 {
                // copy until EOF
                loop {
                    // Linux Kernel 5.3 or later
                    // Not supported in gVisor
                    // SAFETY: src_fd/dest_fd are valid open fds; copy_file_range is the libc FFI
                    let written = unsafe { sys::linux::copy_file_range(src_fd.cast(), &mut off_in_copy, dest_fd.cast(), &mut off_out_copy, sys::page_size(), 0) };
                    if let Some(err) = Maybe::<ret::CopyFile>::errno_sys_p(written, sys::Tag::copy_file_range, dest) {
                        match err.get_errno() {
                            E::INTR => continue,
                            E::XDEV | E::NOSYS | E::INVAL | E::OPNOTSUPP => {
                                if matches!(err.get_errno(), E::NOSYS | E::OPNOTSUPP) { sys::disable_copy_file_range_syscall(); }
                                return Self::copy_file_using_sendfile_on_linux_with_read_write_fallback(src, dest, src_fd, dest_fd, size, &mut (wrote as u64));
                            }
                            _ => return err,
                        }
                    }
                    // wrote zero bytes means EOF
                    if written == 0 { break; }
                    wrote = wrote.saturating_add(written as usize);
                }
            } else {
                while size > 0 {
                    // SAFETY: src_fd/dest_fd are valid open fds; copy_file_range is the libc FFI
                    let written = unsafe { sys::linux::copy_file_range(src_fd.cast(), &mut off_in_copy, dest_fd.cast(), &mut off_out_copy, size, 0) };
                    if let Some(err) = Maybe::<ret::CopyFile>::errno_sys_p(written, sys::Tag::copy_file_range, dest) {
                        match err.get_errno() {
                            E::INTR => continue,
                            E::XDEV | E::NOSYS | E::INVAL | E::OPNOTSUPP => {
                                if matches!(err.get_errno(), E::NOSYS | E::OPNOTSUPP) { sys::disable_copy_file_range_syscall(); }
                                return Self::copy_file_using_sendfile_on_linux_with_read_write_fallback(src, dest, src_fd, dest_fd, size, &mut (wrote as u64));
                            }
                            _ => return err,
                        }
                    }
                    if written == 0 { break; }
                    wrote = wrote.saturating_add(written as usize);
                    size = size.saturating_sub(written as usize);
                }
            }

            return Maybe::SUCCESS;
        }

        #[cfg(windows)]
        {
            let dest_buf = paths::os_path_buffer_pool().get();
            let src = strings::to_kernel32_path(bun_core::reinterpret_slice::<u16>(&mut self.sync_error_buf), args.src.slice());
            let dest = strings::to_kernel32_path(&mut *dest_buf, args.dest.slice());
            // SAFETY: src/dest are NUL-terminated wide paths; CopyFileW is the Win32 FFI
            if unsafe { windows::CopyFileW(src.as_ptr(), dest.as_ptr(), if args.mode.shouldnt_overwrite() { 1 } else { 0 }) } == windows::FALSE {
                if let Some(rest) = Maybe::<ret::CopyFile>::errno_sys_p(0, sys::Tag::copyfile, args.src.slice()) {
                    return Self::should_ignore_ebusy(&args.src, &args.dest, rest);
                }
            }
            return Maybe::SUCCESS;
        }

        #[allow(unreachable_code)]
        { unreachable!() }
    }

    pub fn exists(&mut self, args: &args::Exists, _: Flavor) -> Maybe<ret::Exists> {
        // NOTE: exists cannot return an error
        let Some(path) = &args.path else { return Maybe::Ok(false) };

        if let Some(graph) = bun_core::StandaloneModuleGraph::get() {
            if graph.find(path.slice()).is_some() {
                return Maybe::Ok(true);
            }
        }

        let slice = if path.slice().is_empty() {
            paths::os_path_literal!("")
        } else {
            path.os_path_kernel32(&mut self.sync_error_buf)
        };

        Maybe::Ok(sys::exists_os_path(slice, false))
    }

    pub fn chown(&mut self, args: &args::Chown, _: Flavor) -> Maybe<ret::Chown> {
        #[cfg(windows)]
        {
            return match Syscall::chown(args.path.slice_z(&mut self.sync_error_buf), args.uid, args.gid) {
                Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
                Maybe::Ok(res) => Maybe::Ok(res),
            };
        }
        let path = args.path.slice_z(&mut self.sync_error_buf);
        Syscall::chown(path, args.uid, args.gid)
    }

    pub fn chmod(&mut self, args: &args::Chmod, _: Flavor) -> Maybe<ret::Chmod> {
        let path = args.path.slice_z(&mut self.sync_error_buf);
        #[cfg(windows)]
        {
            return match Syscall::chmod(path, args.mode) {
                Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
                Maybe::Ok(res) => Maybe::Ok(res),
            };
        }
        match Syscall::chmod(path, args.mode) {
            Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(_) => Maybe::SUCCESS,
        }
    }

    pub fn fchmod(&mut self, args: &args::FChmod, _: Flavor) -> Maybe<ret::Fchmod> {
        Syscall::fchmod(args.fd, args.mode)
    }

    pub fn fchown(&mut self, args: &args::Fchown, _: Flavor) -> Maybe<ret::Fchown> {
        Syscall::fchown(args.fd, args.uid, args.gid)
    }

    pub fn fdatasync(&mut self, args: &args::FdataSync, _: Flavor) -> Maybe<ret::Fdatasync> {
        #[cfg(windows)]
        { return Syscall::fdatasync(args.fd); }
        // SAFETY: args.fd.native() is a valid open fd; fdatasync is the libc FFI
        Maybe::<ret::Fdatasync>::errno_sys_fd(unsafe { sys::system::fdatasync(args.fd.native()) }, sys::Tag::fdatasync, args.fd)
            .unwrap_or(Maybe::SUCCESS)
    }

    pub fn fstat(&mut self, args: &args::Fstat, _: Flavor) -> Maybe<ret::Fstat> {
        #[cfg(target_os = "linux")]
        if Syscall::SUPPORTS_STATX_ON_LINUX.load(Ordering::Relaxed) {
            return match Syscall::fstatx(args.fd, &Syscall::STATX_DEFAULT_MASK) {
                Maybe::Ok(result) => Maybe::Ok(Stats::init(&result, args.big_int)),
                Maybe::Err(err) => Maybe::Err(err),
            };
        }
        match Syscall::fstat(args.fd) {
            Maybe::Ok(result) => Maybe::Ok(Stats::init(&Syscall::PosixStat::init(&result), args.big_int)),
            Maybe::Err(err) => Maybe::Err(err),
        }
    }

    pub fn fsync(&mut self, args: &args::Fsync, _: Flavor) -> Maybe<ret::Fsync> {
        #[cfg(windows)]
        { return Syscall::fsync(args.fd); }
        Maybe::<ret::Fsync>::errno_sys(unsafe { sys::system::fsync(args.fd.native()) }, sys::Tag::fsync)
            .unwrap_or(Maybe::SUCCESS)
    }

    pub fn ftruncate(&mut self, args: &args::FTruncate, _: Flavor) -> Maybe<ret::Ftruncate> {
        Syscall::ftruncate(args.fd, args.len.unwrap_or(0))
    }

    pub fn futimes(&mut self, args: &args::Futimes, _: Flavor) -> Maybe<ret::Futimes> {
        #[cfg(windows)]
        {
            let mut req = uv::fs_t::UNINITIALIZED;
            let _d = scopeguard::guard(&mut req, |r| r.deinit());
            let rc = unsafe { uv::uv_fs_futime(uv::Loop::get(), &mut req, args.fd.uv(), args.atime, args.mtime, None) };
            return if let Some(e) = rc.errno() {
                Maybe::Err(sys::Error { errno: e, syscall: sys::Tag::futime, fd: args.fd, ..Default::default() })
            } else { Maybe::SUCCESS };
        }
        match Syscall::futimens(args.fd, args.atime, args.mtime) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(_) => Maybe::SUCCESS,
        }
    }

    pub fn lchmod(&mut self, args: &args::LCHmod, _: Flavor) -> Maybe<ret::Lchmod> {
        #[cfg(windows)]
        { return Maybe::<ret::Lchmod>::todo(); }
        #[cfg(target_os = "android")]
        {
            // bionic has no lchmod(); symlink modes are meaningless on Linux
            // anyway. Match glibc's stub behaviour.
            return Maybe::Err(sys::Error { errno: E::OPNOTSUPP as _, syscall: sys::Tag::lchmod, path: args.path.slice().into(), ..Default::default() });
        }
        let path = args.path.slice_z(&mut self.sync_error_buf);
        Maybe::<ret::Lchmod>::errno_sys_p(unsafe { bun_sys::c::lchmod(path.as_ptr(), args.mode as _) }, sys::Tag::lchmod, path)
            .unwrap_or(Maybe::SUCCESS)
    }

    pub fn lchown(&mut self, args: &args::LChown, _: Flavor) -> Maybe<ret::Lchown> {
        #[cfg(windows)]
        { return Maybe::<ret::Lchown>::todo(); }
        let path = args.path.slice_z(&mut self.sync_error_buf);
        Maybe::<ret::Lchown>::errno_sys_p(unsafe { bun_sys::c::lchown(path.as_ptr(), args.uid, args.gid) }, sys::Tag::lchown, path)
            .unwrap_or(Maybe::SUCCESS)
    }

    pub fn link(&mut self, args: &args::Link, _: Flavor) -> Maybe<ret::Link> {
        let mut to_buf = PathBuffer::uninit();
        let from = args.old_path.slice_z(&mut self.sync_error_buf);
        let to = args.new_path.slice_z(&mut to_buf);
        #[cfg(windows)]
        {
            return match Syscall::link(from, to) {
                Maybe::Err(err) => Maybe::Err(err.with_path_dest(args.old_path.slice(), args.new_path.slice())),
                Maybe::Ok(result) => Maybe::Ok(result),
            };
        }
        Maybe::<ret::Link>::errno_sys_pd(unsafe { sys::system::link(from.as_ptr(), to.as_ptr()) }, sys::Tag::link, args.old_path.slice(), args.new_path.slice())
            .unwrap_or(Maybe::SUCCESS)
    }

    pub fn lstat(&mut self, args: &args::Lstat, _: Flavor) -> Maybe<ret::Lstat> {
        #[cfg(target_os = "linux")]
        if Syscall::SUPPORTS_STATX_ON_LINUX.load(Ordering::Relaxed) {
            return match Syscall::lstatx(args.path.slice_z(&mut self.sync_error_buf), &Syscall::STATX_DEFAULT_MASK) {
                Maybe::Ok(result) => Maybe::Ok(StatOrNotFound::Stats(Stats::init(&result, args.big_int))),
                Maybe::Err(err) => {
                    if !args.throw_if_no_entry && err.get_errno() == E::NOENT {
                        return Maybe::Ok(StatOrNotFound::NotFound);
                    }
                    Maybe::Err(err.with_path(args.path.slice()))
                }
            };
        }
        match Syscall::lstat(args.path.slice_z(&mut self.sync_error_buf)) {
            Maybe::Ok(result) => Maybe::Ok(StatOrNotFound::Stats(Stats::init(&Syscall::PosixStat::init(&result), args.big_int))),
            Maybe::Err(err) => {
                if !args.throw_if_no_entry && err.get_errno() == E::NOENT {
                    return Maybe::Ok(StatOrNotFound::NotFound);
                }
                Maybe::Err(err.with_path(args.path.slice()))
            }
        }
    }

    pub fn mkdir(&mut self, args: &args::Mkdir, _: Flavor) -> Maybe<ret::Mkdir> {
        if args.path.slice().is_empty() {
            return Maybe::Err(sys::Error { errno: E::NOENT as _, syscall: sys::Tag::mkdir, path: b"".as_slice().into(), ..Default::default() });
        }
        if args.recursive { self.mkdir_recursive(args.clone()) } else { self.mkdir_non_recursive(args) }
    }

    // Node doesn't absolute the path so we don't have to either
    pub fn mkdir_non_recursive(&mut self, args: &args::Mkdir) -> Maybe<ret::Mkdir> {
        let path = args.path.slice_z(&mut self.sync_error_buf);
        match Syscall::mkdir(path, args.mode) {
            Maybe::Ok(_) => Maybe::Ok(StringOrUndefined::None),
            Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
        }
    }

    pub fn mkdir_recursive(&mut self, args: args::Mkdir) -> Maybe<ret::Mkdir> {
        self.mkdir_recursive_impl::<()>(args, ())
    }

    pub fn mkdir_recursive_impl<Ctx: MkdirCtx>(&mut self, args: args::Mkdir, ctx: Ctx) -> Maybe<ret::Mkdir> {
        let buf = paths::path_buffer_pool().get();
        let path = args.path.os_path_kernel32(&mut *buf);
        if args.always_return_none {
            self.mkdir_recursive_os_path_impl::<Ctx, false>(ctx, path, args.mode)
        } else {
            self.mkdir_recursive_os_path_impl::<Ctx, true>(ctx, path, args.mode)
        }
    }

    pub fn _is_sep(ch: OSPathChar) -> bool {
        if cfg!(windows) { ch == b'/' as OSPathChar || ch == b'\\' as OSPathChar } else { ch == b'/' as OSPathChar }
    }

    pub fn mkdir_recursive_os_path(&mut self, path: OSPathSliceZ, mode: Mode, return_path: bool) -> Maybe<ret::Mkdir> {
        // PERF(port): was comptime bool — runtime branch here
        if return_path {
            self.mkdir_recursive_os_path_impl::<(), true>((), path, mode)
        } else {
            self.mkdir_recursive_os_path_impl::<(), false>((), path, mode)
        }
    }

    pub fn mkdir_recursive_os_path_impl<Ctx: MkdirCtx, const RETURN_PATH: bool>(
        &mut self,
        ctx: Ctx,
        path: OSPathSliceZ,
        mode: Mode,
    ) -> Maybe<ret::Mkdir> {
        let len: u16 = path.len() as u16;

        // First, attempt to create the desired directory
        // If that fails, then walk back up the path until we have a match
        match Syscall::mkdir_os_path(path, mode) {
            Maybe::Err(err) => match err.get_errno() {
                // `mkpath_np` in macOS also checks for `EISDIR`.
                // it is unclear if macOS lies about if the existing item is
                // a directory or not, so it is checked.
                E::ISDIR | E::EXIST => {
                    return match sys::directory_exists_at(FD::INVALID, path) {
                        Maybe::Err(_) => Maybe::Err(sys::Error {
                            errno: err.errno, syscall: sys::Tag::mkdir,
                            path: self.os_path_into_sync_error_buf(strings::without_nt_prefix(path.as_slice())).into(),
                            ..Default::default()
                        }),
                        // if is a directory, OK. otherwise failure
                        Maybe::Ok(result) => if result {
                            Maybe::Ok(StringOrUndefined::None)
                        } else {
                            Maybe::Err(sys::Error {
                                errno: err.errno, syscall: sys::Tag::mkdir,
                                path: self.os_path_into_sync_error_buf(strings::without_nt_prefix(path.as_slice())).into(),
                                ..Default::default()
                            })
                        },
                    };
                }
                // continue
                E::NOENT => {
                    if len == 0 {
                        // no path to copy
                        return Maybe::Err(err);
                    }
                }
                _ => {
                    return Maybe::Err(err.with_path(self.os_path_into_sync_error_buf(&path.as_slice()[..len as usize])));
                }
            },
            Maybe::Ok(_) => {
                ctx.on_create_dir(path);
                if !RETURN_PATH { return Maybe::Ok(StringOrUndefined::None); }
                return Maybe::Ok(StringOrUndefined::String(BunString::create_from_os_path(path)));
            }
        }

        // SAFETY: sync_error_buf is align(u16); reinterpret as OSPathBuffer
        let working_mem: &mut OSPathBuffer = unsafe { &mut *(&mut self.sync_error_buf as *mut PathBuffer as *mut OSPathBuffer) };
        working_mem[..len as usize].copy_from_slice(&path.as_slice()[..len as usize]);

        let mut i: u16 = len - 1;

        // iterate backwards until creating the directory works successfully
        while i > 0 {
            if Self::_is_sep(path.as_slice()[i as usize]) {
                working_mem[i as usize] = 0;
                let parent = unsafe { OSPathSliceZ::from_raw(working_mem.as_ptr(), i as usize) };
                match Syscall::mkdir_os_path(parent, mode) {
                    Maybe::Err(err) => {
                        working_mem[i as usize] = paths::SEP as OSPathChar;
                        match err.get_errno() {
                            E::EXIST => {
                                // On Windows, this may happen if trying to mkdir replacing a file
                                #[cfg(windows)]
                                {
                                    if let Maybe::Ok(res) = sys::directory_exists_at(FD::INVALID, parent) {
                                        // is a directory. break.
                                        if !res {
                                            return Maybe::Err(sys::Error {
                                                errno: E::NOTDIR as _, syscall: sys::Tag::mkdir,
                                                path: self.os_path_into_sync_error_buf(strings::without_nt_prefix(&path.as_slice()[..len as usize])).into(),
                                                ..Default::default()
                                            });
                                        }
                                    }
                                }
                                // Handle race condition
                                break;
                            }
                            E::NOENT => { i -= 1; continue; }
                            _ => {
                                #[cfg(windows)]
                                let p = self.os_path_into_sync_error_buf_overlap(strings::without_nt_prefix(parent.as_slice()));
                                #[cfg(not(windows))]
                                let p = strings::without_nt_prefix(parent.as_slice());
                                return Maybe::Err(err.with_path(p));
                            }
                        }
                    }
                    Maybe::Ok(_) => {
                        ctx.on_create_dir(parent);
                        // We found a parent that worked
                        working_mem[i as usize] = paths::SEP as OSPathChar;
                        break;
                    }
                }
            }
            i -= 1;
        }
        let first_match: u16 = i;
        i += 1;
        // after we find one that works, we go forward _after_ the first working directory
        while i < len {
            if Self::_is_sep(path.as_slice()[i as usize]) {
                working_mem[i as usize] = 0;
                let parent = unsafe { OSPathSliceZ::from_raw(working_mem.as_ptr(), i as usize) };
                match Syscall::mkdir_os_path(parent, mode) {
                    Maybe::Err(err) => {
                        working_mem[i as usize] = paths::SEP as OSPathChar;
                        match err.get_errno() {
                            // handle the race condition
                            E::EXIST => {}
                            // NOENT shouldn't happen here
                            _ => return Maybe::Err(err.with_path(self.os_path_into_sync_error_buf(strings::without_nt_prefix(path.as_slice())))),
                        }
                    }
                    Maybe::Ok(_) => {
                        ctx.on_create_dir(parent);
                        working_mem[i as usize] = paths::SEP as OSPathChar;
                    }
                }
            }
            i += 1;
        }

        working_mem[len as usize] = 0;

        // Our final directory will not have a trailing separator
        // so we have to create it once again
        let final_ = unsafe { OSPathSliceZ::from_raw(working_mem.as_ptr(), len as usize) };
        match Syscall::mkdir_os_path(final_, mode) {
            Maybe::Err(err) => match err.get_errno() {
                E::EXIST => {}
                _ => return Maybe::Err(err.with_path(self.os_path_into_sync_error_buf(strings::without_nt_prefix(path.as_slice())))),
            },
            Maybe::Ok(_) => {}
        }

        ctx.on_create_dir(final_);
        if !RETURN_PATH { return Maybe::Ok(StringOrUndefined::None); }
        Maybe::Ok(StringOrUndefined::String(BunString::create_from_os_path(&working_mem[..first_match as usize])))
    }

    pub fn mkdtemp(&mut self, args: &args::MkdirTemp, _: Flavor) -> Maybe<ret::Mkdtemp> {
        let prefix_buf = &mut self.sync_error_buf;
        let prefix_slice = args.prefix.slice();
        let len = prefix_slice.len().min(prefix_buf.len().saturating_sub(7));
        if len > 0 {
            prefix_buf[..len].copy_from_slice(&prefix_slice[..len]);
        }
        prefix_buf[len..len + 6].copy_from_slice(b"XXXXXX");
        prefix_buf[len + 6] = 0;

        // The mkdtemp() function returns  a  pointer  to  the  modified  template
        // string  on  success, and NULL on failure, in which case errno is set to
        // indicate the error

        #[cfg(windows)]
        {
            let mut req = uv::fs_t::UNINITIALIZED;
            let _d = scopeguard::guard(&mut req, |r| r.deinit());
            let rc = unsafe { uv::uv_fs_mkdtemp(bun_aio::Loop::get(), &mut req, prefix_buf.as_ptr().cast(), None) };
            if let Some(errno) = rc.errno() {
                return Maybe::Err(sys::Error { errno, syscall: sys::Tag::mkdtemp, path: prefix_buf[..len + 6].into(), ..Default::default() });
            }
            return Maybe::Ok(ZigString::dupe_for_js(unsafe { bun_str::slice_to_nul(req.path) }).expect("oom"));
        }

        let rc = unsafe { bun_sys::c::mkdtemp(prefix_buf.as_mut_ptr().cast()) };
        if !rc.is_null() {
            return Maybe::Ok(ZigString::dupe_for_js(unsafe { core::ffi::CStr::from_ptr(rc) }.to_bytes()).expect("oom"));
        }

        // c.getErrno(rc) returns SUCCESS if rc is -1 so we call std.c._errno() directly
        let errno = unsafe { *bun_sys::c::__errno_location() };
        Maybe::Err(sys::Error {
            errno: errno as _,
            syscall: sys::Tag::mkdtemp,
            path: prefix_buf[..len + 6].into(),
            ..Default::default()
        })
    }

    pub fn open(&mut self, args: &args::Open, _: Flavor) -> Maybe<ret::Open> {
        let path = if cfg!(windows) && args.path.slice() == b"/dev/null" {
            ZStr::from_static(b"\\\\.\\NUL\0")
        } else {
            args.path.slice_z(&mut self.sync_error_buf)
        };
        match Syscall::open(path, args.flags.as_int(), args.mode) {
            Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(fd) => Maybe::Ok(fd),
        }
    }

    pub fn uv_open(&mut self, args: &args::Open, rc: i64) -> Maybe<ret::Open> {
        if rc < 0 {
            return Maybe::Err(sys::Error { errno: (-rc) as _, syscall: sys::Tag::open, path: args.path.slice().into(), from_libuv: true, ..Default::default() });
        }
        Maybe::Ok(FD::from_uv(rc as _))
    }

    pub fn uv_statfs(&mut self, args: &args::StatFS, req: &mut uv::fs_t, rc: i64) -> Maybe<ret::StatFS> {
        if rc < 0 {
            return Maybe::Err(sys::Error { errno: (-rc) as _, syscall: sys::Tag::open, path: args.path.slice().into(), from_libuv: true, ..Default::default() });
        }
        let statfs_ = unsafe { *req.ptr_as::<sys::StatFS>() };
        Maybe::Ok(ret::StatFS::init(&statfs_, args.big_int))
    }

    pub fn open_dir(&mut self, _: &args::OpenDir, _: Flavor) -> Maybe<()> {
        Maybe::todo()
    }

    fn read_inner(&mut self, args: &args::Read) -> Maybe<ret::Read> {
        debug_assert!(args.position.is_none());
        let mut buf = args.buffer.slice();
        let off = (args.offset as usize).min(buf.len());
        buf = &mut buf[off..];
        let l = (args.length as usize).min(buf.len());
        buf = &mut buf[..l];
        match Syscall::read(args.fd, buf) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(amt) => Maybe::Ok(ret::Read { bytes_read: amt as u64 }),
        }
    }

    fn pread_inner(&mut self, args: &args::Read) -> Maybe<ret::Read> {
        let mut buf = args.buffer.slice();
        let off = (args.offset as usize).min(buf.len());
        buf = &mut buf[off..];
        let l = (args.length as usize).min(buf.len());
        buf = &mut buf[..l];
        match Syscall::pread(args.fd, buf, args.position.unwrap()) {
            Maybe::Err(err) => Maybe::Err(sys::Error { errno: err.errno, fd: args.fd, syscall: sys::Tag::read, ..Default::default() }),
            Maybe::Ok(amt) => Maybe::Ok(ret::Read { bytes_read: amt as u64 }),
        }
    }

    pub fn read(&mut self, args: &args::Read, _: Flavor) -> Maybe<ret::Read> {
        let len1 = args.buffer.slice().len();
        let len2 = args.length;
        if len1 == 0 || len2 == 0 {
            return Maybe::Ok(ret::Read { bytes_read: 0 });
        }
        if args.position.is_some() { self.pread_inner(args) } else { self.read_inner(args) }
    }

    pub fn uv_read(&mut self, args: &args::Read, rc: i64) -> Maybe<ret::Read> {
        if rc < 0 {
            return Maybe::Err(sys::Error { errno: (-rc) as _, syscall: sys::Tag::read, fd: args.fd, from_libuv: true, ..Default::default() });
        }
        Maybe::Ok(ret::Read { bytes_read: rc as u64 })
    }

    pub fn uv_readv(&mut self, args: &args::Readv, rc: i64) -> Maybe<ret::Readv> {
        if rc < 0 {
            return Maybe::Err(sys::Error { errno: (-rc) as _, syscall: sys::Tag::readv, fd: args.fd, from_libuv: true, ..Default::default() });
        }
        Maybe::Ok(ret::Readv { bytes_read: rc as u64 })
    }

    pub fn readv(&mut self, args: &args::Readv, _: Flavor) -> Maybe<ret::Readv> {
        if args.buffers.buffers.is_empty() {
            return Maybe::Ok(ret::Readv { bytes_read: 0 });
        }
        if args.position.is_some() { self.preadv_inner(args) } else { self.readv_inner(args) }
    }

    pub fn writev(&mut self, args: &args::Writev, _: Flavor) -> Maybe<ret::Writev> {
        if args.buffers.buffers.is_empty() {
            return Maybe::Ok(ret::Writev { bytes_written: 0 });
        }
        if args.position.is_some() { self.pwritev_inner(args) } else { self.writev_inner(args) }
    }

    pub fn write(&mut self, args: &args::Write, _: Flavor) -> Maybe<ret::Write> {
        if args.position.is_some() { self.pwrite_inner(args) } else { self.write_inner(args) }
    }

    pub fn uv_write(&mut self, args: &args::Write, rc: i64) -> Maybe<ret::Write> {
        if rc < 0 {
            return Maybe::Err(sys::Error { errno: (-rc) as _, syscall: sys::Tag::write, fd: args.fd, from_libuv: true, ..Default::default() });
        }
        Maybe::Ok(ret::Write { bytes_written: rc as u64 })
    }

    pub fn uv_writev(&mut self, args: &args::Writev, rc: i64) -> Maybe<ret::Writev> {
        if rc < 0 {
            return Maybe::Err(sys::Error { errno: (-rc) as _, syscall: sys::Tag::writev, fd: args.fd, from_libuv: true, ..Default::default() });
        }
        Maybe::Ok(ret::Writev { bytes_written: rc as u64 })
    }

    fn write_inner(&mut self, args: &args::Write) -> Maybe<ret::Write> {
        let mut buf = args.buffer.slice();
        let off = (args.offset as usize).min(buf.len());
        buf = &buf[off..];
        let l = (args.length as usize).min(buf.len());
        buf = &buf[..l];
        match Syscall::write(args.fd, buf) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(amt) => Maybe::Ok(ret::Write { bytes_written: amt as u64 }),
        }
    }

    fn pwrite_inner(&mut self, args: &args::Write) -> Maybe<ret::Write> {
        let position = args.position.unwrap();
        let mut buf = args.buffer.slice();
        let off = (args.offset as usize).min(buf.len());
        buf = &buf[off..];
        let l = (args.length as usize).min(buf.len());
        buf = &buf[..l];
        match Syscall::pwrite(args.fd, buf, position) {
            Maybe::Err(err) => Maybe::Err(sys::Error { errno: err.errno, fd: args.fd, syscall: sys::Tag::write, ..Default::default() }),
            Maybe::Ok(amt) => Maybe::Ok(ret::Write { bytes_written: amt as u64 }),
        }
    }

    fn preadv_inner(&mut self, args: &args::Readv) -> Maybe<ret::Readv> {
        let position = args.position.unwrap();
        match Syscall::preadv(args.fd, args.buffers.buffers.as_slice(), position as i64) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(amt) => Maybe::Ok(ret::Readv { bytes_read: amt as u64 }),
        }
    }

    fn readv_inner(&mut self, args: &args::Readv) -> Maybe<ret::Readv> {
        match Syscall::readv(args.fd, args.buffers.buffers.as_slice()) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(amt) => Maybe::Ok(ret::Readv { bytes_read: amt as u64 }),
        }
    }

    fn pwritev_inner(&mut self, args: &args::Writev) -> Maybe<ret::Write> {
        let position = args.position.unwrap();
        match Syscall::pwritev(args.fd, args.buffers.buffers.as_slice(), position as i64) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(amt) => Maybe::Ok(ret::Write { bytes_written: amt as u64 }),
        }
    }

    fn writev_inner(&mut self, args: &args::Writev) -> Maybe<ret::Write> {
        match Syscall::writev(args.fd, args.buffers.buffers.as_slice()) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(amt) => Maybe::Ok(ret::Write { bytes_written: amt as u64 }),
        }
    }

    pub fn readdir(&mut self, args: &args::Readdir, flavor: Flavor) -> Maybe<ret::Readdir> {
        // PERF(port): `flavor` was comptime monomorphization — profile in Phase B
        if flavor != Flavor::Sync {
            if args.recursive {
                panic!("Assertion failure: this code path should never be reached.");
            }
        }
        // PERF(port): was comptime monomorphization on (recursive, tag)
        let maybe = match args.tag() {
            ret::ReaddirTag::Buffers => Self::readdir_inner::<Buffer>(&mut self.sync_error_buf, args, args.recursive, flavor),
            ret::ReaddirTag::WithFileTypes => Self::readdir_inner::<Dirent>(&mut self.sync_error_buf, args, args.recursive, flavor),
            ret::ReaddirTag::Files => Self::readdir_inner::<BunString>(&mut self.sync_error_buf, args, args.recursive, flavor),
        };
        match maybe {
            Maybe::Err(err) => Maybe::Err(sys::Error {
                syscall: sys::Tag::scandir, errno: err.errno, path: args.path.slice().into(), ..Default::default()
            }),
            Maybe::Ok(result) => Maybe::Ok(result),
        }
    }

    fn readdir_with_entries<T: ReaddirEntry>(
        args: &args::Readdir, fd: FD, basename: &ZStr, entries: &mut Vec<T>,
    ) -> Maybe<()> {
        // TODO(port): full body — iterates DirIterator, handles is_u16 (Windows UTF-16 path),
        // dirent_path caching, encoding transcode. See node_fs.zig:4561-4670.
        // Structure: iterate; on err deinit entries and return err.with_path; on each entry
        // append per ExpectedType (Dirent/Buffer/BunString) using encoding helper.
        let _ = (args, fd, basename, entries);
        // TODO(port): readdir_with_entries
        Maybe::SUCCESS
    }

    pub fn readdir_with_entries_recursive_async<T: ReaddirEntry>(
        buf: &mut PathBuffer, args: &args::Readdir, async_task: &mut AsyncReaddirRecursiveTask,
        basename: &ZStr, entries: &mut Vec<T>, is_root: bool,
    ) -> Maybe<()> {
        // TODO(port): full body — see node_fs.zig:4672-4827. openat root/subdir, iterate,
        // enqueue subtasks for dirs/symlinks/unknown(via lstatat), append entries per type.
        let _ = (buf, args, async_task, basename, entries, is_root);
        // TODO(port): readdir_with_entries_recursive_async
        Maybe::SUCCESS
    }

    fn readdir_with_entries_recursive_sync<T: ReaddirEntry>(
        buf: &mut PathBuffer, args: &args::Readdir, root_basename: &ZStr, entries: &mut Vec<T>,
    ) -> Maybe<()> {
        // TODO(port): full body — see node_fs.zig:4829-4988. LinearFifo of basenames,
        // PERF(port): was stack-fallback alloc for fifo+basenames.
        let _ = (buf, args, root_basename, entries);
        // TODO(port): readdir_with_entries_recursive_sync
        Maybe::SUCCESS
    }

    fn should_throw_out_of_memory_early_for_javascript(encoding: Encoding, size: usize, syscall: sys::Tag) -> Option<sys::Error> {
        // Strings & typed arrays max out at 4.7 GB.
        // But, it's **string length**
        // So you can load an 8 GB hex string, for example, it should be fine.
        let adjusted_size = match encoding {
            Encoding::Utf16le | Encoding::Ucs2 | Encoding::Utf8 => (size / 4).saturating_sub(1),
            Encoding::Hex => (size / 2).saturating_sub(1),
            Encoding::Base64 | Encoding::Base64url => (size / 3).saturating_sub(1),
            Encoding::Ascii | Encoding::Latin1 | Encoding::Buffer => size,
        };
        if adjusted_size > VirtualMachine::SYNTHETIC_ALLOCATION_LIMIT
            // If they do not have enough memory to open the file and they're on Linux, let's throw an error instead of dealing with the OOM killer.
            || (cfg!(target_os = "linux") && size as u64 >= bun_core::get_total_memory_size())
        {
            return Some(sys::Error::from_code(E::NOMEM, syscall));
        }
        None
    }

    fn readdir_inner<T: ReaddirEntry>(
        buf: &mut PathBuffer, args: &args::Readdir, recursive: bool, flavor: Flavor,
    ) -> Maybe<ret::Readdir> {
        let path = args.path.slice_z(buf);

        if recursive && flavor == Flavor::Sync {
            let mut buf_to_pass = PathBuffer::uninit();
            let mut entries: Vec<T> = Vec::new();
            return match Self::readdir_with_entries_recursive_sync::<T>(&mut buf_to_pass, args, path, &mut entries) {
                Maybe::Err(err) => {
                    for result in &mut entries { result.destroy_entry(); }
                    Maybe::Err(err)
                }
                Maybe::Ok(()) => Maybe::Ok(T::into_readdir(entries)),
            };
        }

        if recursive {
            panic!("This code path should never be reached. It should only go through readdirWithEntriesRecursiveAsync.");
        }

        let flags = sys::O::DIRECTORY | sys::O::RDONLY;
        #[cfg(not(windows))]
        let open_res = Syscall::open(path, flags, 0);
        #[cfg(windows)]
        let open_res = sys::open_dir_at_windows_a(FD::cwd(), path, sys::OpenDirOpts { iterable: true, read_only: true, ..Default::default() });
        let fd = match open_res {
            Maybe::Err(err) => return Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(fd_) => fd_,
        };
        let _close = scopeguard::guard(fd, |fd| fd.close());

        let mut entries: Vec<T> = Vec::new();
        match Self::readdir_with_entries::<T>(args, fd, path, &mut entries) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(()) => Maybe::Ok(T::into_readdir(entries)),
        }
    }

    #[derive(Copy, Clone, PartialEq, Eq)]
    pub enum StringType { Default, NullTerminated }

    pub fn read_file(&mut self, args: &args::ReadFile, flavor: Flavor) -> Maybe<ret::ReadFile> {
        // PERF(port): `flavor` was comptime monomorphization — profile in Phase B
        let result = self.read_file_with_options(args, flavor, StringType::Default);
        match result {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(result) => match result {
                ret::ReadFileWithOptions::Buffer(buffer) => Maybe::Ok(StringOrBuffer::Buffer(buffer)),
                ret::ReadFileWithOptions::TranscodedString(str) => {
                    if str.tag == BunString::Tag::Dead {
                        return Maybe::Err(sys::Error::from_code(E::NOMEM, sys::Tag::read).with_path_like(&args.path));
                    }
                    Maybe::Ok(StringOrBuffer::String(node::SliceWithUnderlyingString { underlying: str, ..Default::default() }))
                }
                ret::ReadFileWithOptions::String(s) => {
                    let str = node::SliceWithUnderlyingString::transcode_from_owned_slice(s, args.encoding);
                    if str.underlying.tag == BunString::Tag::Dead && str.utf8.is_empty() {
                        return Maybe::Err(sys::Error::from_code(E::NOMEM, sys::Tag::read).with_path_like(&args.path));
                    }
                    Maybe::Ok(StringOrBuffer::String(str))
                }
                _ => unreachable!(),
            },
        }
    }

    pub fn read_file_with_options(&mut self, args: &args::ReadFile, flavor: Flavor, string_type: StringType) -> Maybe<ret::ReadFileWithOptions> {
        // TODO(port): full body — see node_fs.zig:5121-5450. ~330 lines:
        // - resolve fd from path/fd (StandaloneModuleGraph fast-path)
        // - makeLibUVOwned, defer close if path
        // - 256KB pre-stat optimistic read (sync uses vm.rareData().pipeReadBuffer())
        // - if fully read: build Buffer/transcoded_string/null_terminated and return
        // - fstat, compute size with max_size clamp + null-term byte
        // - shouldThrowOutOfMemoryEarlyForJavaScript guard
        // - alloc Vec<u8>, copy pre-read, expand, two read loops (size-known vs unknown)
        // - finalize as Buffer/string/null_terminated
        // PERF(port): was comptime monomorphization on (flavor, string_type)
        let _ = (args, flavor, string_type);
        // TODO(port): read_file_with_options
        Maybe::<ret::ReadFileWithOptions>::ABORTED
    }

    pub fn write_file_with_path_buffer(pathbuf: &mut PathBuffer, args: &args::WriteFile) -> Maybe<ret::WriteFile> {
        let fd = match &args.file {
            PathOrFileDescriptor::Path(p) => {
                let path = p.slice_z_with_force_copy(pathbuf, true);
                match sys::openat(args.dirfd, path, args.flag.as_int(), args.mode) {
                    Maybe::Err(err) => return Maybe::Err(err.with_path(p.slice())),
                    Maybe::Ok(fd) => fd,
                }
            }
            PathOrFileDescriptor::Fd(fd) => *fd,
        };
        let _close = scopeguard::guard((fd, matches!(args.file, PathOrFileDescriptor::Path(_))), |(fd, is_path)| {
            if is_path { fd.close(); }
        });

        if args.aborted() { return Maybe::<ret::WriteFile>::ABORTED; }

        let mut buf = args.data.slice();
        let mut written: usize = 0;

        // Attempt to pre-allocate large files
        // Worthwhile after 6 MB at least on ext4 linux
        if sys::PREALLOCATE_SUPPORTED && buf.len() >= sys::PREALLOCATE_LENGTH {
            'preallocate: {
                let offset: usize = if matches!(args.file, PathOrFileDescriptor::Path(_)) {
                    // on mac, it's relatively positioned
                    0
                } else {
                    // on linux, it's absolutely positione
                    match Syscall::lseek(fd, 0, sys::linux::SEEK::CUR) {
                        Maybe::Err(_) => break 'preallocate,
                        Maybe::Ok(pos) => usize::try_from(pos).unwrap(),
                    }
                };
                let _ = sys::preallocate_file(
                    fd.cast(),
                    i64::try_from(offset).unwrap(),
                    i64::try_from(buf.len()).unwrap(),
                );
            }
        }

        while !buf.is_empty() {
            match sys::write(fd, buf) {
                Maybe::Err(err) => return Maybe::Err(err),
                Maybe::Ok(amt) => {
                    buf = &buf[amt..];
                    written += amt;
                    if amt == 0 { break; }
                }
            }
        }

        // https://github.com/oven-sh/bun/issues/2931
        // https://github.com/oven-sh/bun/issues/10222
        // Only truncate if we're not appending and writing to a path
        if (args.flag.as_int() & sys::O::APPEND) == 0 && !matches!(args.file, PathOrFileDescriptor::Fd(_)) {
            // If this errors, we silently ignore it.
            // Not all files are seekable (and thus, not all files can be truncated).
            #[cfg(windows)] { let _ = unsafe { windows::SetEndOfFile(fd.cast()) }; }
            #[cfg(not(windows))] { let _ = Syscall::ftruncate(fd, (written as u64 & ((1u64 << 63) - 1)) as i64); }
        }

        if args.flush {
            #[cfg(windows)] { let _ = unsafe { windows::kernel32::FlushFileBuffers(fd.cast()) }; }
            #[cfg(not(windows))] { let _ = unsafe { sys::system::fsync(fd.cast()) }; }
        }

        Maybe::SUCCESS
    }

    pub fn write_file(&mut self, args: &args::WriteFile, _: Flavor) -> Maybe<ret::WriteFile> {
        Self::write_file_with_path_buffer(&mut self.sync_error_buf, args)
    }

    pub fn readlink(&mut self, args: &args::Readlink, _: Flavor) -> Maybe<ret::Readlink> {
        let mut outbuf = PathBuffer::uninit();
        let inbuf = &mut self.sync_error_buf;
        let path = args.path.slice_z(inbuf);
        let link_path = match Syscall::readlink(path, &mut outbuf) {
            Maybe::Err(err) => return Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(result) => result,
        };
        Maybe::Ok(match args.encoding {
            Encoding::Buffer => StringOrBuffer::Buffer(Buffer::from_string(link_path).expect("unreachable")),
            _ => {
                if let PathLike::SliceWithUnderlyingString(s) = &args.path {
                    if strings::eql_long(s.slice(), link_path, true) {
                        return Maybe::Ok(StringOrBuffer::String(s.dupe_ref()));
                    }
                }
                StringOrBuffer::String(node::SliceWithUnderlyingString { utf8: Default::default(), underlying: BunString::clone_utf8(link_path) })
            }
        })
    }

    pub fn realpath_non_native(&mut self, args: &args::Realpath, _: Flavor) -> Maybe<ret::Realpath> {
        match self.realpath_inner(args, RealpathVariant::Emulated) {
            Maybe::Ok(res) => Maybe::Ok(res),
            Maybe::Err(err) => Maybe::Err(sys::Error { errno: err.errno, syscall: sys::Tag::lstat, path: args.path.slice().into(), ..Default::default() }),
        }
    }

    pub fn realpath(&mut self, args: &args::Realpath, _: Flavor) -> Maybe<ret::Realpath> {
        match self.realpath_inner(args, RealpathVariant::Native) {
            Maybe::Ok(res) => Maybe::Ok(res),
            Maybe::Err(err) => Maybe::Err(sys::Error { errno: err.errno, syscall: sys::Tag::realpath, path: args.path.slice().into(), ..Default::default() }),
        }
    }

    // For `fs.realpath`, Node.js uses `lstat`, exposing the native system call under
    // `fs.realpath.native`. In Bun, the system call is the default, but the error
    // code must be changed to make it seem like it is using lstat (tests expect this),
    // in addition, some more subtle things depend on the variant.
    pub fn realpath_inner(&mut self, args: &args::Realpath, variant: RealpathVariant) -> Maybe<ret::Realpath> {
        #[cfg(windows)]
        {
            let mut req = uv::fs_t::UNINITIALIZED;
            let _d = scopeguard::guard(&mut req, |r| r.deinit());
            let rc = unsafe { uv::uv_fs_realpath(bun_aio::Loop::get(), &mut req, args.path.slice_z(&mut self.sync_error_buf).as_ptr(), None) };
            if let Some(errno) = rc.errno() {
                return Maybe::Err(sys::Error { errno, syscall: sys::Tag::realpath, path: args.path.slice().into(), ..Default::default() });
            }
            let result_ptr: Option<*const c_char> = req.ptr_as::<Option<*const c_char>>();
            let Some(ptr) = result_ptr else {
                return Maybe::Err(sys::Error { errno: E::NOENT as _, syscall: sys::Tag::realpath, path: args.path.slice().into(), ..Default::default() });
            };
            let mut buf = unsafe { core::ffi::CStr::from_ptr(ptr) }.to_bytes();
            if variant == RealpathVariant::Emulated {
                // remove the trailing slash
                if buf.last() == Some(&b'\\') {
                    // SAFETY: req.path is mutable
                    unsafe { *(ptr as *mut u8).add(buf.len() - 1) = 0; }
                    buf = &buf[..buf.len() - 1];
                }
            }
            return Maybe::Ok(match args.encoding {
                Encoding::Buffer => StringOrBuffer::Buffer(Buffer::from_string(buf).expect("unreachable")),
                Encoding::Utf8 => {
                    if let PathLike::SliceWithUnderlyingString(s) = &args.path {
                        if strings::eql_long(s.slice(), buf, true) {
                            return Maybe::Ok(StringOrBuffer::String(s.dupe_ref()));
                        }
                    }
                    StringOrBuffer::String(node::SliceWithUnderlyingString { utf8: Default::default(), underlying: BunString::clone_utf8(buf) })
                }
                enc => StringOrBuffer::String(node::SliceWithUnderlyingString { utf8: Default::default(), underlying: webcore::encoding::to_bun_string(buf, enc) }),
            });
        }

        #[cfg(not(windows))]
        {
            let mut outbuf = PathBuffer::uninit();
            let inbuf = &mut self.sync_error_buf;
            debug_assert!(FileSystem::INSTANCE_LOADED.load(Ordering::Relaxed));

            let path_slice = args.path.slice();
            let parts = [FileSystem::instance().top_level_dir, path_slice];
            let path_ = FileSystem::instance().abs_buf(&parts, inbuf);
            inbuf[path_.len()] = 0;
            let path = unsafe { ZStr::from_raw(inbuf.as_ptr(), path_.len()) };

            #[cfg(target_os = "linux")]
            let flags = sys::O::PATH; // O_PATH is faster
            #[cfg(not(target_os = "linux"))]
            let flags = sys::O::RDONLY | sys::O::NONBLOCK | sys::O::NOCTTY;

            let fd = match sys::open(path, flags, 0) {
                Maybe::Err(err) => return Maybe::Err(err.with_path(path)),
                Maybe::Ok(fd_) => fd_,
            };
            let _close = scopeguard::guard(fd, |fd| fd.close());

            let buf = match Syscall::get_fd_path(fd, &mut outbuf) {
                Maybe::Err(err) => return Maybe::Err(err.with_path(path)),
                Maybe::Ok(buf_) => buf_,
            };

            let _ = variant;
            Maybe::Ok(match args.encoding {
                Encoding::Buffer => StringOrBuffer::Buffer(Buffer::from_string(buf).expect("unreachable")),
                Encoding::Utf8 => {
                    if let PathLike::SliceWithUnderlyingString(s) = &args.path {
                        if strings::eql_long(s.slice(), buf, true) {
                            return Maybe::Ok(StringOrBuffer::String(s.dupe_ref()));
                        }
                    }
                    StringOrBuffer::String(node::SliceWithUnderlyingString { utf8: Default::default(), underlying: BunString::clone_utf8(buf) })
                }
                enc => StringOrBuffer::String(node::SliceWithUnderlyingString { utf8: Default::default(), underlying: webcore::encoding::to_bun_string(buf, enc) }),
            })
        }
    }

    pub const realpath_native: fn(&mut NodeFS, &args::Realpath, Flavor) -> Maybe<ret::Realpath> = Self::realpath;

    pub fn rename(&mut self, args: &args::Rename, _: Flavor) -> Maybe<ret::Rename> {
        let from_buf = &mut self.sync_error_buf;
        let mut to_buf = PathBuffer::uninit();
        let from = args.old_path.slice_z(from_buf);
        let to = args.new_path.slice_z(&mut to_buf);
        match Syscall::rename(from, to) {
            Maybe::Ok(result) => Maybe::Ok(result),
            Maybe::Err(err) => Maybe::Err(err.with_path_dest(args.old_path.slice(), args.new_path.slice())),
        }
    }

    pub fn rmdir(&mut self, args: &args::RmDir, _: Flavor) -> Maybe<ret::Rmdir> {
        if args.recursive {
            if let Err(err) = zig_delete_tree(sys::Dir::cwd(), args.path.slice(), sys::FileKind::Directory) {
                let mut errno: E = map_anyerror_to_errno(err);
                if cfg!(windows) && errno == E::NOTDIR { errno = E::NOENT; }
                return Maybe::Err(sys::Error::from_code(errno, sys::Tag::rmdir));
            }
            return Maybe::SUCCESS;
        }
        #[cfg(windows)]
        {
            return match Syscall::rmdir(args.path.slice_z(&mut self.sync_error_buf)) {
                Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
                Maybe::Ok(result) => Maybe::Ok(result),
            };
        }
        // SAFETY: path is NUL-terminated by slice_z; rmdir(2) is the libc FFI
        Maybe::<ret::Rmdir>::errno_sys_p(unsafe { sys::system::rmdir(args.path.slice_z(&mut self.sync_error_buf).as_ptr()) }, sys::Tag::rmdir, args.path.slice())
            .unwrap_or(Maybe::SUCCESS)
    }

    pub fn rm(&mut self, args: &args::Rm, _: Flavor) -> Maybe<ret::Rm> {
        // We cannot use removefileat() on macOS because it does not handle write-protected files as expected.
        if args.recursive {
            if let Err(err) = zig_delete_tree(sys::Dir::cwd(), args.path.slice(), sys::FileKind::File) {
                let errno = if err == bun_core::err!("FileNotFound") {
                    if args.force { return Maybe::SUCCESS; }
                    E::NOENT
                } else {
                    map_anyerror_to_errno(err)
                };
                return Maybe::Err(sys::Error::from_code(errno, sys::Tag::rm).with_path(args.path.slice()));
            }
            return Maybe::SUCCESS;
        }

        let dest = args.path.slice_z(&mut self.sync_error_buf);
        // TODO(port): std.posix.unlinkZ/rmdirZ — using bun_sys equivalents
        if let Err(err1) = sys::unlink_z(dest) {
            // empircally, it seems to return AccessDenied when the
            // file is actually a directory on macOS.
            if args.recursive
                && (err1 == bun_core::err!("IsDir")
                    || err1 == bun_core::err!("NotDir")
                    || err1 == bun_core::err!("AccessDenied"))
            {
                if let Err(err2) = sys::rmdir_z(dest) {
                    let code = if err2 == bun_core::err!("FileNotFound") {
                        if args.force { return Maybe::SUCCESS; }
                        E::NOENT
                    } else {
                        map_anyerror_to_errno(err2)
                    };
                    return Maybe::Err(sys::Error::from_code(code, sys::Tag::rm).with_path(args.path.slice()));
                }
                return Maybe::SUCCESS;
            }
            let code = if err1 == bun_core::err!("FileNotFound") {
                if args.force { return Maybe::SUCCESS; }
                E::NOENT
            } else {
                map_anyerror_to_errno(err1)
            };
            return Maybe::Err(sys::Error::from_code(code, sys::Tag::rm).with_path(args.path.slice()));
        }
        Maybe::SUCCESS
    }

    pub fn statfs(&mut self, args: &args::StatFS, _: Flavor) -> Maybe<ret::StatFS> {
        match Syscall::statfs(args.path.slice_z(&mut self.sync_error_buf)) {
            Maybe::Ok(ref result) => Maybe::Ok(ret::StatFS::init(result, args.big_int)),
            Maybe::Err(err) => Maybe::Err(err),
        }
    }

    pub fn stat(&mut self, args: &args::Stat, _: Flavor) -> Maybe<ret::Stat> {
        let path = args.path.slice_z(&mut self.sync_error_buf);
        if let Some(graph) = bun_core::StandaloneModuleGraph::get() {
            if let Some(result) = graph.stat(path) {
                return Maybe::Ok(StatOrNotFound::Stats(Stats::init(&Syscall::PosixStat::init(&result), args.big_int)));
            }
        }
        #[cfg(target_os = "linux")]
        if Syscall::SUPPORTS_STATX_ON_LINUX.load(Ordering::Relaxed) {
            return match Syscall::statx(path, &Syscall::STATX_DEFAULT_MASK) {
                Maybe::Ok(result) => Maybe::Ok(StatOrNotFound::Stats(Stats::init(&result, args.big_int))),
                Maybe::Err(err) => {
                    if !args.throw_if_no_entry && err.get_errno() == E::NOENT {
                        return Maybe::Ok(StatOrNotFound::NotFound);
                    }
                    Maybe::Err(err.with_path(args.path.slice()))
                }
            };
        }
        match Syscall::stat(path) {
            Maybe::Ok(result) => Maybe::Ok(StatOrNotFound::Stats(Stats::init(&Syscall::PosixStat::init(&result), args.big_int))),
            Maybe::Err(err) => {
                if !args.throw_if_no_entry && err.get_errno() == E::NOENT {
                    return Maybe::Ok(StatOrNotFound::NotFound);
                }
                Maybe::Err(err.with_path(args.path.slice()))
            }
        }
    }

    pub fn symlink(&mut self, args: &args::Symlink, _: Flavor) -> Maybe<ret::Symlink> {
        let mut to_buf = PathBuffer::uninit();
        #[cfg(windows)]
        {
            // TODO(port): full Windows symlink body — see node_fs.zig:5943-6015.
            // - autodetect link_type via directoryExistsAt on resolved target
            // - preprocessSymlinkDestination (junction → abs+long-prefix, abs → long-prefix, all → backslashes)
            // - Syscall.symlinkUV with UV_FS_SYMLINK_DIR/JUNCTION
            let _ = &mut to_buf;
            return Maybe::<ret::Symlink>::todo(); // TODO(port): windows symlink
        }
        #[cfg(not(windows))]
        match Syscall::symlink(
            args.target_path.slice_z(&mut self.sync_error_buf),
            args.new_path.slice_z(&mut to_buf),
        ) {
            Maybe::Ok(result) => Maybe::Ok(result),
            Maybe::Err(err) => Maybe::Err(err.with_path_dest(args.target_path.slice(), args.new_path.slice())),
        }
    }

    fn truncate_inner(&mut self, path: &PathLike, len: u64, flags: i32) -> Maybe<ret::Truncate> {
        #[cfg(windows)]
        {
            let file = sys::open(path.slice_z(&mut self.sync_error_buf), sys::O::WRONLY | flags, 0o644);
            let Maybe::Ok(fd) = file else {
                let Maybe::Err(e) = file else { unreachable!() };
                return Maybe::Err(sys::Error { errno: e.errno, path: path.slice().into(), syscall: sys::Tag::truncate, ..Default::default() });
            };
            let _close = scopeguard::guard(fd, |fd| fd.close());
            return match Syscall::ftruncate(fd, i64::try_from(len).unwrap()) {
                Maybe::Ok(r) => Maybe::Ok(r),
                Maybe::Err(err) => Maybe::Err(err.with_path_and_syscall(path.slice(), sys::Tag::truncate)),
            };
        }
        let _ = flags;
        // SAFETY: path is NUL-terminated by slice_z; truncate(2) is the libc FFI
        Maybe::<ret::Truncate>::errno_sys_p(unsafe { bun_sys::c::truncate(path.slice_z(&mut self.sync_error_buf).as_ptr(), i64::try_from(len).unwrap()) }, sys::Tag::truncate, path.slice())
            .unwrap_or(Maybe::SUCCESS)
    }

    pub fn truncate(&mut self, args: &args::Truncate, _: Flavor) -> Maybe<ret::Truncate> {
        match &args.path {
            PathOrFileDescriptor::Fd(fd) => Syscall::ftruncate(*fd, i64::try_from(args.len).unwrap()),
            PathOrFileDescriptor::Path(p) => self.truncate_inner(p, args.len, args.flags),
        }
    }

    pub fn unlink(&mut self, args: &args::Unlink, _: Flavor) -> Maybe<ret::Unlink> {
        #[cfg(windows)]
        {
            return match Syscall::unlink(args.path.slice_z(&mut self.sync_error_buf)) {
                Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
                Maybe::Ok(result) => Maybe::Ok(result),
            };
        }
        // SAFETY: path is NUL-terminated by slice_z; unlink(2) is the libc FFI
        Maybe::<ret::Unlink>::errno_sys_p(unsafe { sys::system::unlink(args.path.slice_z(&mut self.sync_error_buf).as_ptr()) }, sys::Tag::unlink, args.path.slice())
            .unwrap_or(Maybe::SUCCESS)
    }

    pub fn watch_file(&mut self, args: &args::WatchFile, flavor: Flavor) -> Maybe<ret::WatchFile> {
        debug_assert!(flavor == Flavor::Sync);
        let watcher = match args.create_stat_watcher() {
            Ok(w) => w,
            Err(err) => {
                let mut buf = Vec::new();
                use std::io::Write as _;
                let _ = write!(&mut buf, "Failed to watch file {}", bun_core::fmt::QuotedFormatter { text: args.path.slice() });
                let _ = args.global_this.throw_value(bun_jsc::SystemError {
                    message: BunString::init(&buf),
                    code: BunString::init(err.name()),
                    path: BunString::init(args.path.slice()),
                    ..Default::default()
                }.to_error_instance(args.global_this));
                return Maybe::Ok(JSValue::UNDEFINED);
            }
        };
        Maybe::Ok(watcher)
    }

    pub fn unwatch_file(&mut self, _: &args::UnwatchFile, _: Flavor) -> Maybe<ret::UnwatchFile> {
        Maybe::<ret::UnwatchFile>::todo()
    }

    pub fn utimes(&mut self, args: &args::Utimes, _: Flavor) -> Maybe<ret::Utimes> {
        #[cfg(windows)]
        {
            let mut req = uv::fs_t::UNINITIALIZED;
            let _d = scopeguard::guard(&mut req, |r| r.deinit());
            let rc = unsafe { uv::uv_fs_utime(bun_aio::Loop::get(), &mut req, args.path.slice_z(&mut self.sync_error_buf).as_ptr(), args.atime, args.mtime, None) };
            return if let Some(errno) = rc.errno() {
                Maybe::Err(sys::Error { errno, syscall: sys::Tag::utime, path: args.path.slice().into(), ..Default::default() })
            } else { Maybe::SUCCESS };
        }
        match Syscall::utimens(args.path.slice_z(&mut self.sync_error_buf), args.atime, args.mtime) {
            Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(_) => Maybe::SUCCESS,
        }
    }

    pub fn lutimes(&mut self, args: &args::Lutimes, _: Flavor) -> Maybe<ret::Lutimes> {
        #[cfg(windows)]
        {
            let mut req = uv::fs_t::UNINITIALIZED;
            let _d = scopeguard::guard(&mut req, |r| r.deinit());
            let rc = unsafe { uv::uv_fs_lutime(bun_aio::Loop::get(), &mut req, args.path.slice_z(&mut self.sync_error_buf).as_ptr(), args.atime, args.mtime, None) };
            return if let Some(errno) = rc.errno() {
                Maybe::Err(sys::Error { errno, syscall: sys::Tag::utime, path: args.path.slice().into(), ..Default::default() })
            } else { Maybe::SUCCESS };
        }
        match Syscall::lutimes(args.path.slice_z(&mut self.sync_error_buf), args.atime, args.mtime) {
            Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(_) => Maybe::SUCCESS,
        }
    }

    pub fn watch(&mut self, args: &args::Watch, _: Flavor) -> Maybe<ret::Watch> {
        match args.create_fs_watcher() {
            Maybe::Ok(result) => Maybe::Ok(result.js_this),
            Maybe::Err(err) => Maybe::Err(err),
        }
    }

    /// This function is `cpSync`, but only if you pass `{ recursive: ..., force: ..., errorOnExist: ..., mode: ... }'
    /// The other options like `filter` use a JS fallback, see `src/js/internal/fs/cp.ts`
    pub fn cp(&mut self, args: &args::Cp, _: Flavor) -> Maybe<ret::Cp> {
        let mut src_buf = OSPathBuffer::uninit();
        let mut dest_buf = OSPathBuffer::uninit();
        let src = args.src.os_path(&mut src_buf);
        let dest = args.dest.os_path(&mut dest_buf);
        self.cp_sync_inner(
            &mut src_buf,
            PathString::PathInt::try_from(src.len()).unwrap(),
            &mut dest_buf,
            PathString::PathInt::try_from(dest.len()).unwrap(),
            args,
        )
    }

    pub fn os_path_into_sync_error_buf(&mut self, slice: &[OSPathChar]) -> &[u8] {
        #[cfg(windows)]
        { return strings::from_wpath(&mut self.sync_error_buf, slice); }
        #[cfg(not(windows))]
        {
            self.sync_error_buf[..slice.len()].copy_from_slice(slice);
            &self.sync_error_buf[..slice.len()]
        }
    }

    pub fn os_path_into_sync_error_buf_overlap(&mut self, slice: &[OSPathChar]) -> &[u8] {
        #[cfg(windows)]
        {
            let tmp = paths::os_path_buffer_pool().get();
            tmp[..slice.len()].copy_from_slice(slice);
            return strings::from_wpath(&mut self.sync_error_buf, &tmp[..slice.len()]);
        }
        #[cfg(not(windows))]
        { let _ = slice; &[] } // TODO(port): zig fn has no posix branch (returns void?)
    }

    fn cp_sync_inner(
        &mut self,
        src_buf: &mut OSPathBuffer, src_dir_len: PathString::PathInt,
        dest_buf: &mut OSPathBuffer, dest_dir_len: PathString::PathInt,
        args: &args::Cp,
    ) -> Maybe<ret::Cp> {
        // TODO(port): full body — see node_fs.zig:6191-6365. ~170 lines:
        // - stat/GetFileAttributesW src; if file → _copy_single_file_sync
        // - if !recursive → EISDIR
        // - mac: try clonefile, fall through on supported errors
        // - openat dir, mkdirRecursiveOSPath dest, iterate entries
        // - guard ENAMETOOLONG, recurse on dirs, _copy_single_file_sync on files
        let _ = (src_buf, src_dir_len, dest_buf, dest_dir_len, args);
        // TODO(port): cp_sync_inner
        Maybe::SUCCESS
    }

    /// On Windows, copying a file onto itself will return EBUSY, which is an
    /// unintuitive and cryptic error to return to the user for an operation
    /// that should seemingly be a no-op.
    ///
    /// So we check if the source and destination are the same file, and if they
    /// are, we return success.
    ///
    /// This is copied directly from libuv's implementation of `uv_fs_copyfile`
    /// for Windows:
    ///
    /// https://github.com/libuv/libuv/blob/497f3168d13ea9a92ad18c28e8282777ec2acf73/src/win/fs.c#L2069
    ///
    /// **This function does nothing on non-Windows platforms**.
    fn should_ignore_ebusy(src: &PathLike, dest: &PathLike, result: Maybe<ret::CopyFile>) -> Maybe<ret::CopyFile> {
        #[cfg(not(windows))] { let _ = (src, dest); return result; }
        #[cfg(windows)]
        {
            let Maybe::Err(ref e) = result else { return result };
            if e.get_errno() != E::BUSY { return result; }
            let mut buf = PathBuffer::uninit();
            let Maybe::Ok(statbuf) = Syscall::stat(src.slice_z(&mut buf)) else { return result };
            let Maybe::Ok(new_statbuf) = Syscall::stat(dest.slice_z(&mut buf)) else { return result };
            if statbuf.dev == new_statbuf.dev && statbuf.ino == new_statbuf.ino {
                return Maybe::SUCCESS;
            }
            result
        }
    }

    fn _cp_symlink(&mut self, src: &ZStr, dest: &ZStr) -> Maybe<ret::CopyFile> {
        let mut target_buf = PathBuffer::uninit();
        let link_target = match Syscall::readlink(src, &mut target_buf) {
            Maybe::Ok(result) => result,
            Maybe::Err(err) => {
                self.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                return Maybe::Err(err.with_path(&self.sync_error_buf[..src.len()]));
            }
        };
        if paths::is_absolute(link_target) {
            return Syscall::symlink(link_target, dest);
        }
        let mut cwd_buf = PathBuffer::uninit();
        let mut resolved_buf = PathBuffer::uninit();
        let src_dir = paths::dirname(src.as_bytes(), paths::Platform::Posix);
        let Ok(cwd) = sys::getcwd(&mut cwd_buf) else {
            // If we can't resolve cwd, preserve the link target as-is rather
            // than pointing the copied link back at the source path.
            return Syscall::symlink(link_target, dest);
        };
        let Some(resolved) = paths::join_abs_string_buf_checked(
            cwd, &mut resolved_buf[..resolved_buf.len() - 1], &[src_dir, link_target], paths::Platform::Posix,
        ) else {
            self.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
            return Maybe::Err(sys::Error { errno: E::NAMETOOLONG as _, syscall: sys::Tag::symlink, path: self.sync_error_buf[..src.len()].into(), ..Default::default() });
        };
        resolved_buf[resolved.len()] = 0;
        Syscall::symlink(unsafe { ZStr::from_raw(resolved_buf.as_ptr(), resolved.len()) }, dest)
    }

    /// This is `copyFile`, but it copies symlinks as-is
    pub fn _copy_single_file_sync(
        &mut self,
        src: OSPathSliceZ, dest: OSPathSliceZ, mode: constants::Copyfile,
        /// Stat on posix, file attributes on windows
        #[cfg(windows)] reuse_stat: Option<windows::DWORD>,
        #[cfg(not(windows))] reuse_stat: Option<sys::Stat>,
        args: &args::Cp,
    ) -> Maybe<ret::CopyFile> {
        // TODO(port): full body — see node_fs.zig:6455-6887. ~430 lines, 4 platform branches:
        // mac: clonefile/copyfile fast paths, fallback read/write, mkdir-parent-on-ENOENT
        // linux: open NOFOLLOW (ELOOP→_cpSymlink), fstat, ioctl_ficlone, copy_file_range loop, sendfile fallback
        // freebsd: open NOFOLLOW (EMLINK/ELOOP→_cpSymlink), same-inode check, copy_file_range, read/write fallback
        // windows: GetFileAttributesW, CopyFileW (mkdir-parent on PATH_NOT_FOUND), reparse-point→GetFinalPathName+CreateSymbolicLinkW
        let _ = (src, dest, mode, reuse_stat, args);
        // TODO(port): _copy_single_file_sync
        Maybe::<ret::CopyFile>::todo()
    }

    /// Directory scanning + clonefile will block this thread, then each individual file copy (what the sync version
    /// calls "_copySingleFileSync") will be dispatched as a separate task.
    pub fn cp_async(&mut self, task: &mut AsyncCpTask) {
        AsyncCpTask::cp_async(self, task);
    }

    // returns boolean `should_continue`
    fn _cp_async_directory(
        &mut self, args: args::CpFlags, task: &mut AsyncCpTask,
        src_buf: &mut OSPathBuffer, src_dir_len: PathString::PathInt,
        dest_buf: &mut OSPathBuffer, dest_dir_len: PathString::PathInt,
    ) -> bool {
        AsyncCpTask::_cp_async_directory(self, args, task, src_buf, src_dir_len, dest_buf, dest_dir_len)
    }

    // TODO(port): const-generic dispatch helpers — Phase B wires these
    pub fn dispatch<R, A, const F: NodeFSFunctionEnum>(&mut self, _args: &A, _flavor: Flavor) -> Maybe<R> {
        todo!("AsyncFSTask dispatch via NodeFSFunctionEnum")
    }
    #[cfg(windows)]
    pub fn uv_dispatch<R, A, const F: NodeFSFunctionEnum>(&mut self, _args: &A, _rc: i64) -> Maybe<R> {
        todo!("UVFSRequest dispatch via NodeFSFunctionEnum")
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum RealpathVariant { Native, Emulated }

/// Trait for `mkdirRecursiveImpl` Ctx parameter (`void` does nothing).
pub trait MkdirCtx {
    fn on_create_dir(&self, _path: OSPathSliceZ) {}
}
impl MkdirCtx for () {}

/// Trait abstracting over the three readdir entry types.
pub trait ReaddirEntry: Sized {
    fn destroy_entry(&mut self);
    fn into_readdir(v: Vec<Self>) -> ret::Readdir;
}
impl ReaddirEntry for BunString {
    fn destroy_entry(&mut self) { self.deref(); }
    fn into_readdir(v: Vec<Self>) -> ret::Readdir { ret::Readdir::Files(v.into_boxed_slice()) }
}
impl ReaddirEntry for Dirent {
    fn destroy_entry(&mut self) { self.deref(); }
    fn into_readdir(v: Vec<Self>) -> ret::Readdir { ret::Readdir::WithFileTypes(v.into_boxed_slice()) }
}
impl ReaddirEntry for Buffer {
    fn destroy_entry(&mut self) { self.destroy(); }
    fn into_readdir(v: Vec<Self>) -> ret::Readdir { ret::Readdir::Buffers(v.into_boxed_slice()) }
}

fn map_anyerror_to_errno(err: bun_core::Error) -> E {
    match err.name() {
        "AccessDenied" => E::PERM,
        "FileTooBig" => E::FBIG,
        "SymLinkLoop" => E::LOOP,
        "ProcessFdQuotaExceeded" => E::NFILE,
        "NameTooLong" => E::NAMETOOLONG,
        "SystemFdQuotaExceeded" => E::MFILE,
        "SystemResources" => E::NOMEM,
        "ReadOnlyFileSystem" => E::ROFS,
        "FileSystem" => E::IO,
        "FileBusy" | "DeviceBusy" => E::BUSY,
        "NotDir" => E::NOTDIR,
        "InvalidUtf8" | "InvalidWtf8" | "BadPathName" => E::INVAL,
        "FileNotFound" => E::NOENT,
        "IsDir" => E::ISDIR,
        _ => E::FAULT,
    }
}

fn throw_invalid_fd_error(global: &JSGlobalObject, value: JSValue) -> JsError {
    if value.is_number() {
        return global.err_out_of_range(format_args!(
            "The value of \"fd\" is out of range. It must be an integer. Received {}",
            bun_core::fmt::double(value.as_number())
        )).throw();
    }
    global.throw_invalid_argument_type_value("fd", "number", value)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__mkdirp(global_this: *mut JSGlobalObject, path: *const c_char) -> bool {
    // SAFETY: caller (C++) passes a valid JSGlobalObject*
    let global_this = unsafe { &*global_this };
    // SAFETY: caller passes a NUL-terminated C string
    let path_bytes = unsafe { core::ffi::CStr::from_ptr(path) }.to_bytes();
    !matches!(
        global_this.bun_vm().node_fs().mkdir_recursive(args::Mkdir {
            path: PathLike::String(PathString::init(path_bytes)),
            recursive: true,
            ..Default::default()
        }),
        Maybe::Err(_)
    )
}

// ──────────────────────────────────────────────────────────────────────────
// zigDeleteTree — copied from std.fs.Dir.deleteTree. Returns `FileNotFound`
// instead of ignoring it, which is required to match the behavior of Node.js's
// `fs.rm` { recursive: true, force: false }.
// ──────────────────────────────────────────────────────────────────────────

pub fn zig_delete_tree(self_: sys::Dir, sub_path: &[u8], kind_hint: sys::FileKind) -> Result<(), bun_core::Error> {
    // TODO(port): full body — see node_fs.zig:6931-7121. Uses std.fs.Dir which is
    // banned per PORTING.md (no std::fs); Phase B should re-implement on bun_sys::Dir.
    // Structure: explicit StackItem stack (cap 16), iterate entries, treat-as-dir loop,
    // close-then-delete-dir, retry-on-DirNotEmpty.
    let _ = (self_, sub_path, kind_hint);
    // TODO(port): zig_delete_tree
    Ok(())
}

fn zig_delete_tree_open_initial_subpath(self_: sys::Dir, sub_path: &[u8], kind_hint: sys::FileKind) -> Result<Option<sys::Dir>, bun_core::Error> {
    // TODO(port): see node_fs.zig:7123-7182
    let _ = (self_, sub_path, kind_hint);
    Ok(None)
}

fn zig_delete_tree_min_stack_size_with_kind_hint(self_: sys::Dir, sub_path: &[u8], kind_hint: sys::FileKind) -> Result<(), bun_core::Error> {
    // TODO(port): see node_fs.zig:7184-7298
    let _ = (self_, sub_path, kind_hint);
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// NodeFSFunctionEnum — std.meta.DeclEnum(NodeFS)
// ──────────────────────────────────────────────────────────────────────────
#[derive(Copy, Clone, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum NodeFSFunctionEnum {
    Access, AppendFile, Chmod, Chown, Close, CopyFile, Exists, Fchmod, Fchown,
    Fdatasync, Fstat, Fsync, Ftruncate, Futimes, Lchmod, Lchown, Link, Lstat,
    Lutimes, Mkdir, Mkdtemp, Open, Read, Readdir, ReadFile, Readlink, Readv,
    Realpath, RealpathNonNative, Rename, Rm, Rmdir, Stat, Statfs, Symlink,
    Truncate, Unlink, Utimes, Write, WriteFile, Writev,
}

// TODO(port): i52 marker type — Zig `i52` used for ReadPosition coercion bounds
#[allow(non_camel_case_types)]
struct i52;
impl i52 { const MIN: i64 = -(1i64 << 51); }

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_fs.zig (7344 lines)
//   confidence: low
//   todos:      52
//   notes:      Very large file. Full structure preserved; ~6 large bodies stubbed (read_file_with_options, _copy_single_file_sync, cp_sync_inner, readdir_with_entries{,_recursive_{sync,async}}, zig_delete_tree*, Windows UVFSRequest::create branches, Windows symlink). Const-generic dispatch (NodeFSFunctionEnum) needs Phase-B wiring. FreeBSD copyFileInner stubbed. errdefer cleanup in args::*::from_js partially inlined.
// ──────────────────────────────────────────────────────────────────────────
