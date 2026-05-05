//! MiniEventLoop: A lightweight event loop for non-JavaScript contexts
//!
//! This is a simplified version of jsc.EventLoop that provides event loop functionality
//! without requiring a JavaScript runtime. It enables code reuse between JavaScript-enabled
//! contexts (like `bun run`) and JavaScript-free contexts (like `bun build`, `bun install`,
//! and the Bun Shell).
//!
//! Key characteristics:
//! - Wraps the uSockets event loop, same as jsc.EventLoop
//! - Supports concurrent task execution via thread pools
//! - Provides file polling capabilities for watching filesystem changes
//! - Manages stdout/stderr streams without JavaScript bindings
//! - Handles environment variable loading and management
//!
//! Use cases:
//! - Build processes that need async I/O without JavaScript execution
//! - Package installation with concurrent network requests
//! - Shell command execution with proper I/O handling
//! - Any Bun subsystem that needs event-driven architecture without JS overhead

use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_aio::file_poll::{FilePoll, Store as FilePollStore};
use bun_collections::LinearFifo;
use bun_core::Output;
use bun_dotenv::{self as dotenv, Loader as DotEnvLoader};
use bun_paths::PathBuffer;
use bun_sys::{self as sys, Fd, Mode};
use bun_threading::UnboundedQueue;
use bun_uws::Loop as UwsLoop;

use crate::AnyTaskWithExtraContext;
// TODO(b0): EventLoopHandle arrives from move-in (was bun_jsc::EventLoopHandle).
use crate::EventLoopHandle;

/// The platform's native event loop type. Zig: `jsc.PlatformEventLoop`.
#[cfg(not(windows))]
pub type PlatformEventLoop = UwsLoop;
#[cfg(windows)]
pub type PlatformEventLoop = bun_sys::windows::libuv::Loop;

// ─── Upward hooks (CYCLEBREAK.md §Debug-hook / vtable) ──────────────────────
/// `unsafe fn(fd: Fd, is_atty: bool, mode: Mode) -> *mut ()`
/// — constructs a `webcore::blob::Store` for stdout/stderr. Registered by
/// `bun_runtime::init()`. Return value is an erased `*mut blob::Store` with
/// intrusive refcount; this crate only stores/forwards it.
pub static STDIO_BLOB_STORE_CTOR: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

/// `unsafe fn() -> *mut ()` — returns the thread's `*mut jsc::VirtualMachine`.
/// Backs `JsKind::get_vm()`. Registered by `bun_runtime::init()`.
pub static JS_VM_GET: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());
// ────────────────────────────────────────────────────────────────────────────

const PIPE_READ_BUFFER_SIZE: usize = 256 * 1024;
type PipeReadBuffer = [u8; PIPE_READ_BUFFER_SIZE];

/// Intrusive MPSC queue over `AnyTaskWithExtraContext` linked via its `.next` field.
// TODO(port): UnboundedQueue's intrusive `.next` field offset — Zig passes `.next` as a
// comptime field name; the Rust UnboundedQueue<T> must encode this via offset_of! or a trait.
pub type ConcurrentTaskQueue = UnboundedQueue<AnyTaskWithExtraContext>;

/// FIFO of raw task pointers (tasks are intrusive nodes; the queue does not own them).
type Queue = LinearFifo<*mut AnyTaskWithExtraContext>;

pub type Task = AnyTaskWithExtraContext;

pub struct MiniEventLoop<'a> {
    pub tasks: Queue,
    pub concurrent_tasks: ConcurrentTaskQueue,
    pub loop_: &'static UwsLoop,
    // PORT NOTE: `allocator: std.mem.Allocator` field dropped — non-AST crate uses global mimalloc.
    pub file_polls_: Option<Box<FilePollStore>>,
    pub env: Option<&'a DotEnvLoader>,
    // PORT NOTE: Zig field is `[]const u8` with mixed provenance (literal "", borrowed `cwd`
    // param, or `allocator.dupe`). Never freed in `deinit`. Use Box<[u8]> and dupe on assign.
    pub top_level_dir: Box<[u8]>,
    // TODO(port): lifetime — opaque ctx assigned externally, only read/cleared here.
    pub after_event_loop_callback_ctx: Option<NonNull<c_void>>,
    pub after_event_loop_callback: Option<unsafe extern "C" fn(*mut c_void)>,
    pub pipe_read_buffer: Option<Box<PipeReadBuffer>>,
    // SAFETY: erased `*mut webcore::blob::Store` (tier-6). Constructed via
    // `STDIO_BLOB_STORE_CTOR` hook; intrusive-refcounted on the runtime side.
    // TODO(port): Blob.Store uses intrusive ref_count (constructed with ref_count=2);
    // LIFETIMES.tsv classifies as Arc but IntrusiveArc<BlobStore> may be required for FFI compat.
    pub stdout_store: Option<NonNull<()>>,
    pub stderr_store: Option<NonNull<()>>,
}

thread_local! {
    pub static GLOBAL_INITIALIZED: Cell<bool> = const { Cell::new(false) };
    // PORT NOTE: Zig `threadlocal var global: *MiniEventLoop = undefined;` — raw pointer
    // because the global is leaked (Box::into_raw) and lives for the thread's lifetime.
    pub static GLOBAL: Cell<*mut MiniEventLoop<'static>> = const { Cell::new(core::ptr::null_mut()) };
}

pub fn init_global(
    env: Option<&'static DotEnvLoader>,
    cwd: Option<&[u8]>,
) -> &'static mut MiniEventLoop<'static> {
    if GLOBAL_INITIALIZED.with(|g| g.get()) {
        // SAFETY: GLOBAL was set on a previous call (GLOBAL_INITIALIZED gate).
        return unsafe { &mut *GLOBAL.with(|g| g.get()) };
    }
    let loop_ = MiniEventLoop::init();
    let global: &'static mut MiniEventLoop<'static> = Box::leak(Box::new(loop_));
    GLOBAL.with(|g| g.set(global as *mut _));

    global
        .loop_
        .internal_loop_data()
        .set_parent_event_loop(EventLoopHandle::init_mini(global));

    global.env = env.or_else(|| dotenv::instance()).or_else(|| {
        let map = Box::leak(Box::new(dotenv::Map::init()));
        let loader = Box::leak(Box::new(DotEnvLoader::init(map)));
        Some(&*loader)
    });

    // Set top_level_dir from provided cwd or get current working directory
    if let Some(dir) = cwd {
        // PORT NOTE: Zig borrowed `dir`; we dupe to keep Box<[u8]> ownership uniform.
        global.top_level_dir = Box::<[u8]>::from(dir);
    } else if global.top_level_dir.is_empty() {
        let mut buf = PathBuffer::uninit();
        match sys::getcwd(&mut buf) {
            sys::Result::Ok(p) => {
                global.top_level_dir = Box::<[u8]>::from(p);
            }
            sys::Result::Err(_) => {
                global.top_level_dir = Box::default();
            }
        }
    }

    GLOBAL_INITIALIZED.with(|g| g.set(true));
    global
}

impl<'a> MiniEventLoop<'a> {
    #[inline]
    pub fn get_vm_impl(&mut self) -> &mut MiniEventLoop<'a> {
        self
    }

    pub fn throw_error(&mut self, err: sys::Error) {
        Output::pretty_errorln(format_args!("{}", err));
        Output::flush();
    }

    pub fn pipe_read_buffer(&mut self) -> &mut [u8] {
        if self.pipe_read_buffer.is_none() {
            // PERF(port): Zig used allocator.create([256*1024]u8); Box::new of large array may
            // blow the stack on debug builds — Phase B: use Box::new_uninit / boxed zeroed.
            self.pipe_read_buffer = Some(Box::new([0u8; PIPE_READ_BUFFER_SIZE]));
        }
        &mut self.pipe_read_buffer.as_mut().unwrap()[..]
    }

    pub fn on_after_event_loop(&mut self) {
        if let Some(cb) = self.after_event_loop_callback {
            let ctx = self.after_event_loop_callback_ctx;
            self.after_event_loop_callback = None;
            self.after_event_loop_callback_ctx = None;
            // SAFETY: `cb` is a C-ABI callback registered by the owner of `ctx`; the owner
            // guarantees `ctx` is valid until the callback fires (Zig invariant).
            unsafe { cb(ctx.map_or(core::ptr::null_mut(), |p| p.as_ptr())) };
        }
    }

    pub fn file_polls(&mut self) -> &mut FilePollStore {
        if self.file_polls_.is_none() {
            self.file_polls_ = Some(Box::new(FilePollStore::init()));
        }
        self.file_polls_.as_mut().unwrap()
    }

    pub fn init() -> MiniEventLoop<'a> {
        MiniEventLoop {
            tasks: Queue::init(),
            concurrent_tasks: ConcurrentTaskQueue::default(),
            loop_: UwsLoop::get(),
            file_polls_: None,
            env: None,
            top_level_dir: Box::default(),
            after_event_loop_callback_ctx: None,
            after_event_loop_callback: None,
            pipe_read_buffer: None,
            stdout_store: None,
            stderr_store: None,
        }
    }

    pub fn tick_concurrent_with_count(&mut self) -> usize {
        let mut concurrent = self.concurrent_tasks.pop_batch();
        let count = concurrent.count;
        if count == 0 {
            return 0;
        }

        let mut iter = concurrent.iterator();
        let start_count = self.tasks.count;
        if start_count == 0 {
            self.tasks.head = 0;
        }

        self.tasks
            .ensure_unused_capacity(count)
            .expect("unreachable");
        // PORT NOTE: reshaped for borrowck — Zig held `writable` (&mut into self.tasks) while
        // bumping `self.tasks.count` per-iteration (overlapping &mut). Fill the writable slice
        // first, track items written in a local, then commit the count after the borrow ends.
        let mut written: usize = 0;
        {
            let mut writable = self.tasks.writable_slice(0);
            while let Some(task) = iter.next() {
                writable[0] = task;
                writable = &mut writable[1..];
                written += 1;
                if writable.is_empty() {
                    break;
                }
            }
        }
        // TODO(port): LinearFifo Rust API may expose `.count` as method, not field.
        self.tasks.count += written;

        self.tasks.count - start_count
    }

    pub fn tick_once(&mut self, context: *mut c_void) {
        if self.tick_concurrent_with_count() == 0 && self.tasks.count == 0 {
            self.loop_.inc();
            self.loop_.tick();
            self.loop_.dec();
            // PORT NOTE: Zig `defer this.onAfterEventLoop()` was block-scoped to this `if`.
            self.on_after_event_loop();
        }

        while let Some(task) = self.tasks.read_item() {
            // SAFETY: tasks are pushed by enqueue_task* and remain valid until run() consumes them.
            unsafe { (*task).run(context) };
        }
    }

    pub fn tick_without_idle(&mut self, context: *mut c_void) {
        loop {
            let _ = self.tick_concurrent_with_count();
            while let Some(task) = self.tasks.read_item() {
                // SAFETY: see tick_once.
                unsafe { (*task).run(context) };
            }

            self.loop_.tick_without_idle();

            if self.tasks.count == 0 && self.tick_concurrent_with_count() == 0 {
                break;
            }
        }
        // PORT NOTE: Zig `defer this.onAfterEventLoop()` at fn scope; no early returns above.
        self.on_after_event_loop();
    }

    pub fn tick<F>(&mut self, context: *mut c_void, is_done: F)
    where
        F: Fn(*mut c_void) -> bool,
    {
        // PERF(port): Zig `comptime isDone: *const fn` monomorphized per callsite; generic `F`
        // here also monomorphizes — should match.
        while !is_done(context) {
            if self.tick_concurrent_with_count() == 0 && self.tasks.count == 0 {
                self.loop_.inc();
                self.loop_.tick();
                self.loop_.dec();
                // PORT NOTE: Zig `defer` was block-scoped to this `if`.
                self.on_after_event_loop();
            }

            while let Some(task) = self.tasks.read_item() {
                // SAFETY: see tick_once.
                unsafe { (*task).run(context) };
            }
        }
    }

    // TODO(port): Zig `enqueueTask` uses `comptime field: std.meta.FieldEnum(Context)` + `@field`
    // to in-place initialize an embedded task field on `ctx` via `Task.New(Context, Callback)`.
    // This is comptime reflection with no direct Rust equivalent. Phase B: either
    //   (a) require callers to pass `&mut ctx.field` directly, or
    //   (b) macro `enqueue_task!(loop, ctx, field, callback)` using `offset_of!`.
    pub fn enqueue_task<C>(
        &mut self,
        _ctx: &mut C,
        // callback: fn(&mut C),
        // field: <offset into C of AnyTaskWithExtraContext>,
    ) {
        // TODO(port): comptime @field reflection — see note above.
        unimplemented!("enqueue_task: requires macro for intrusive field init");
    }

    pub fn enqueue_task_concurrent(&mut self, task: *mut AnyTaskWithExtraContext) {
        self.concurrent_tasks.push(task);
        self.loop_.wakeup();
    }

    // TODO(port): same comptime-reflection problem as `enqueue_task` (uses `@field` +
    // `Task.New(Context, ParentContext, Callback)`). Phase B: macro.
    pub fn enqueue_task_concurrent_with_extra_ctx<C, P>(
        &mut self,
        _ctx: &mut C,
        // callback: fn(&mut C, &mut P),
        // field: <offset into C of AnyTaskWithExtraContext>,
    ) {
        // TODO(port): comptime @field reflection — see note above.
        unimplemented!("enqueue_task_concurrent_with_extra_ctx: requires macro for intrusive field init");
    }

    /// Returns an erased `*mut webcore::blob::Store`. Callers in tier-6 cast back.
    pub fn stderr(&mut self) -> *mut () {
        if self.stderr_store.is_none() {
            let mut mode: Mode = 0;
            let fd = Fd::from_uv(2);

            if let sys::Result::Ok(stat) = sys::fstat(fd) {
                mode = Mode::try_from(stat.mode).unwrap();
            }

            // TODO(port): Zig builds Blob.Store with intrusive `ref_count = 2` and
            // `.data = .file{ pathlike = .{ .fd }, is_atty, mode }`. Phase B must
            // reconcile with BlobStore's actual Rust refcount strategy.
            let ctor = STDIO_BLOB_STORE_CTOR.load(Ordering::Relaxed);
            debug_assert!(!ctor.is_null(), "STDIO_BLOB_STORE_CTOR not registered");
            // SAFETY: hook signature documented on `STDIO_BLOB_STORE_CTOR`.
            let ctor: unsafe fn(Fd, bool, Mode) -> *mut () = unsafe { core::mem::transmute(ctor) };
            let store = unsafe {
                ctor(
                    fd,
                    Output::stderr_descriptor_type() == Output::DescriptorType::Terminal,
                    mode,
                )
            };
            self.stderr_store = NonNull::new(store);
        }
        self.stderr_store.unwrap().as_ptr()
    }

    /// Returns an erased `*mut webcore::blob::Store`. Callers in tier-6 cast back.
    pub fn stdout(&mut self) -> *mut () {
        if self.stdout_store.is_none() {
            let mut mode: Mode = 0;
            let fd = Fd::stdout();

            if let sys::Result::Ok(stat) = sys::fstat(fd) {
                mode = Mode::try_from(stat.mode).unwrap();
            }

            let ctor = STDIO_BLOB_STORE_CTOR.load(Ordering::Relaxed);
            debug_assert!(!ctor.is_null(), "STDIO_BLOB_STORE_CTOR not registered");
            // SAFETY: hook signature documented on `STDIO_BLOB_STORE_CTOR`.
            let ctor: unsafe fn(Fd, bool, Mode) -> *mut () = unsafe { core::mem::transmute(ctor) };
            let store = unsafe {
                ctor(
                    fd,
                    Output::stdout_descriptor_type() == Output::DescriptorType::Terminal,
                    mode,
                )
            };
            self.stdout_store = NonNull::new(store);
        }
        self.stdout_store.unwrap().as_ptr()
    }
}

impl<'a> Drop for MiniEventLoop<'a> {
    fn drop(&mut self) {
        // PORT NOTE: `tasks.deinit()` is implicit via Queue's Drop.
        debug_assert!(self.concurrent_tasks.is_empty());
    }
}

// ───────────────────────────── JsVM / MiniVM ─────────────────────────────

/// Manual vtable for the JS-VM arm of `AbstractVM` (cold dispatch — see
/// PORTING.md §Dispatch). `bun_runtime` provides the static instance.
// PERF(port): was inline switch
pub struct JsVmVTable {
    /// Returns erased `*mut jsc::EventLoop`.
    pub event_loop: unsafe fn(*mut ()) -> *mut (),
    pub file_polls: unsafe fn(*mut ()) -> *mut FilePollStore,
    pub platform_event_loop: unsafe fn(*mut ()) -> *mut PlatformEventLoop,
    pub inc_pending_unref: unsafe fn(*mut ()),
}

pub struct JsVM {
    // SAFETY: erased `*mut jsc::VirtualMachine`.
    pub vm: *mut (),
    pub vtable: &'static JsVmVTable,
}

impl JsVM {
    #[inline]
    pub fn init(vm: *mut (), vtable: &'static JsVmVTable) -> JsVM {
        JsVM { vm, vtable }
    }

    /// Returns erased `*mut jsc::EventLoop` — tier-6 callers cast back.
    #[inline]
    pub fn loop_(&self) -> *mut () {
        // SAFETY: vtable contract.
        unsafe { (self.vtable.event_loop)(self.vm) }
    }

    #[inline]
    pub fn alloc_file_poll(&self) -> &mut FilePoll {
        // SAFETY: vtable contract — returns a valid &mut FilePollStore owned by the VM.
        unsafe { (*(self.vtable.file_polls)(self.vm)).get() }
    }

    #[inline]
    pub fn platform_event_loop(&self) -> &PlatformEventLoop {
        // SAFETY: vtable contract.
        unsafe { &*(self.vtable.platform_event_loop)(self.vm) }
    }

    #[inline]
    pub fn increment_pending_unref_counter(&self) {
        // Zig: `this.vm.pending_unref_counter +|= 1;`
        // SAFETY: vtable contract.
        unsafe { (self.vtable.inc_pending_unref)(self.vm) };
    }

    #[inline]
    pub fn file_polls(&self) -> &mut FilePollStore {
        // SAFETY: vtable contract.
        unsafe { &mut *(self.vtable.file_polls)(self.vm) }
    }
}

pub struct MiniVM<'a> {
    // PORT NOTE: LIFETIMES.tsv classifies this BORROW_PARAM `&'a`, but `file_polls()` /
    // `alloc_file_poll()` mutate the loop (lazy-init the store). Hold `&'a mut` instead of
    // casting `&T`→`&mut T` (UB, and forbidden by PORTING.md "no raw pointers to silence
    // borrowck"). Zig's `*MiniEventLoop` was always mutable.
    pub mini: &'a mut MiniEventLoop<'a>,
}

impl<'a> MiniVM<'a> {
    pub fn init(inner: &'a mut MiniEventLoop<'a>) -> MiniVM<'a> {
        MiniVM { mini: inner }
    }

    #[inline]
    pub fn loop_(&self) -> &MiniEventLoop<'a> {
        &*self.mini
    }

    #[inline]
    pub fn alloc_file_poll(&mut self) -> &mut FilePoll {
        self.mini.file_polls().get()
    }

    #[inline]
    pub fn platform_event_loop(&self) -> &PlatformEventLoop {
        #[cfg(windows)]
        {
            return self.mini.loop_.uv_loop();
        }
        #[cfg(not(windows))]
        {
            // On POSIX, `PlatformEventLoop` is `uws::Loop` (alias defined above).
            self.mini.loop_
        }
    }

    #[inline]
    pub fn increment_pending_unref_counter(&self) {
        let _ = self;
        unimplemented!("FIXME TODO");
    }

    #[inline]
    pub fn file_polls(&mut self) -> &mut FilePollStore {
        self.mini.file_polls()
    }
}

// ───────────────────────────── EventLoopKind ─────────────────────────────

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum EventLoopKind {
    Js,
    Mini,
}

// TODO(port): Zig `Type()` / `refType()` return `type` at comptime. Rust cannot return a type
// from a runtime enum value. Model as a trait with associated types instead:
pub trait EventLoopKindT {
    type Loop;
    type Ref;
    fn get_vm() -> Self::Ref;
}

pub struct JsKind;
pub struct MiniKind;

impl EventLoopKindT for JsKind {
    // SAFETY: erased `jsc::EventLoop` / `jsc::VirtualMachine` (tier-6).
    type Loop = *mut ();
    type Ref = *mut ();
    fn get_vm() -> Self::Ref {
        let hook = JS_VM_GET.load(Ordering::Relaxed);
        debug_assert!(!hook.is_null(), "JS_VM_GET not registered by bun_runtime::init()");
        // SAFETY: hook signature documented on `JS_VM_GET`.
        let f: unsafe fn() -> *mut () = unsafe { core::mem::transmute(hook) };
        unsafe { f() }
    }
}

impl EventLoopKindT for MiniKind {
    type Loop = MiniEventLoop<'static>;
    type Ref = &'static mut MiniEventLoop<'static>;
    fn get_vm() -> Self::Ref {
        // SAFETY: caller must have called init_global() first (Zig invariant: `global` is set).
        unsafe { &mut *GLOBAL.with(|g| g.get()) }
    }
}

// ───────────────────────────── AbstractVM ─────────────────────────────

/// Zig `AbstractVM(inner: anytype)` dispatches on `@TypeOf(inner)` to wrap either a
/// `*VirtualMachine` or a `*MiniEventLoop`. Rust models this as a trait implemented for both.
pub trait AbstractVM<'a> {
    type Wrapped;
    fn abstract_vm(self) -> Self::Wrapped;
}

// PORT NOTE (b0): `impl AbstractVM for &VirtualMachine` cannot live here
// without naming the tier-6 `VirtualMachine` type. The impl moves to
// `bun_runtime` (move-in pass), which constructs `JsVM { vm, vtable }`.

impl<'a> AbstractVM<'a> for &'a mut MiniEventLoop<'a> {
    type Wrapped = MiniVM<'a>;
    fn abstract_vm(self) -> MiniVM<'a> {
        MiniVM::init(self)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/event_loop/MiniEventLoop.zig (413 lines)
//   confidence: medium
//   todos:      13
//   notes:      enqueue_task* need macro for @field intrusive init; Blob.Store Arc-vs-intrusive-refcount mismatch; MiniVM holds &mut (deviates from LIFETIMES.tsv) so file_polls/alloc_file_poll can mutate
// ──────────────────────────────────────────────────────────────────────────
