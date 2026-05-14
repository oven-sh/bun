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

use bun_collections::linear_fifo::{DynamicBuffer, LinearFifo};
use bun_core::Output;
use bun_dotenv::{self as dotenv, Loader as DotEnvLoader};
use bun_io::file_poll::{FilePoll, Store as FilePollStore};
use bun_sys::{self as sys, Fd, Mode};
use bun_threading::UnboundedQueue;
use bun_uws::Loop as UwsLoop;

use crate::AnyTaskWithExtraContext::{AnyTaskWithExtraContext, New};
// MOVE-IN: EventLoopHandle relocated from bun_jsc — see AnyEventLoop.rs.
use crate::EventLoopHandle;

/// The platform's native event loop type. Zig: `jsc.PlatformEventLoop`.
#[cfg(not(windows))]
pub type PlatformEventLoop = UwsLoop;
#[cfg(windows)]
pub type PlatformEventLoop = bun_sys::windows::libuv::Loop;

// ─── Upward link-time externs (LAYERING) ────────────────────────────────────
// Zig has no crate split here — `MiniEventLoop` reached `Blob.Store` /
// `VirtualMachine.get()` directly. The bodies live in `bun_runtime` (which
// owns `webcore::Blob` / `jsc::VirtualMachine`) as `#[no_mangle]` Rust-ABI
// fns; the linker resolves them. No `AtomicPtr`, no init-order hazard.
unsafe extern "Rust" {
    /// Constructs a `webcore::blob::Store` for stdout/stderr/stdin (Zig
    /// rare_data.zig:551 inline `Blob.Store` ctor). Return value is an erased
    /// `*mut blob::Store` with intrusive refcount = 2; this crate only
    /// stores/forwards it. Defined in `bun_runtime::webcore::blob`.
    /// No caller-side preconditions (by-value args, allocates fresh).
    pub safe fn __bun_stdio_blob_store_new(fd: Fd, is_atty: bool, mode: Mode) -> *mut ();
    /// Returns the thread's `*mut jsc::VirtualMachine` (Zig:
    /// `jsc.VirtualMachine.get()`). Backs `JsKind::get_vm()`. Defined in
    /// `bun_runtime::jsc_hooks`. No caller-side preconditions (reads a
    /// thread-local; wrong-thread is a logic error, not UB).
    safe fn __bun_js_vm_get() -> *mut ();
}
// ────────────────────────────────────────────────────────────────────────────

pub const PIPE_READ_BUFFER_SIZE: usize = 256 * 1024;
pub type PipeReadBuffer = [u8; PIPE_READ_BUFFER_SIZE];

/// Intrusive MPSC queue over `AnyTaskWithExtraContext` linked via its `.next` field.
pub type ConcurrentTaskQueue = UnboundedQueue<AnyTaskWithExtraContext>;

// SAFETY: `next` is the sole intrusive link for `UnboundedQueue<AnyTaskWithExtraContext>`.
unsafe impl bun_threading::Linked for AnyTaskWithExtraContext {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
        // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
        unsafe { core::ptr::addr_of!((*item).next) }
    }
}

/// FIFO of raw task pointers (tasks are intrusive nodes; the queue does not own them).
/// Zig: `bun.LinearFifo(*AnyTaskWithExtraContext, .Dynamic)`.
type Queue = LinearFifo<*mut AnyTaskWithExtraContext, DynamicBuffer<*mut AnyTaskWithExtraContext>>;

pub type Task = AnyTaskWithExtraContext;

pub struct MiniEventLoop<'a> {
    pub tasks: Queue,
    pub concurrent_tasks: ConcurrentTaskQueue,
    // PORT NOTE: Zig `*uws.Loop` — raw pointer because the loop is C-owned
    // (created by `uws_get_loop`/`us_create_loop`) and outlives this struct.
    pub loop_: *mut UwsLoop,
    // PORT NOTE: `std.mem.Allocator param` field dropped — non-AST crate uses global mimalloc.
    pub file_polls_: Option<Box<FilePollStore>>,
    /// Zig: `env: ?*bun.DotEnv.Loader` — mutable; callers (shell spawn,
    /// `createNullDelimitedEnvMap`) write through it. Stored as `NonNull`
    /// (BACKREF) so [`EventLoopHandle::env`] can hand out a `*mut` with
    /// mutable provenance. `'a` is preserved via PhantomData below.
    pub env: Option<NonNull<DotEnvLoader<'a>>>,
    // PORT NOTE: Zig field is `[]const u8` with mixed provenance (literal "", borrowed `cwd`
    // param, or `allocator.dupe`). Never freed in `deinit`. Use Box<[u8]> and dupe on assign.
    pub top_level_dir: Box<[u8]>,
    // TODO(port): lifetime — opaque ctx assigned externally, only read/cleared here.
    pub after_event_loop_callback_ctx: Option<NonNull<c_void>>,
    pub after_event_loop_callback: Option<unsafe extern "C" fn(*mut c_void)>,
    pub pipe_read_buffer: Option<Box<PipeReadBuffer>>,
    // SAFETY: erased `*mut webcore::blob::Store` (tier-6). Constructed via
    // `__bun_stdio_blob_store_new`; intrusive-refcounted on the runtime side.
    // TODO(port): Blob.Store uses intrusive ref_count (constructed with ref_count=2);
    // LIFETIMES.tsv classifies as Arc but IntrusiveArc<BlobStore> may be required for FFI compat.
    pub stdout_store: Option<NonNull<()>>,
    pub stderr_store: Option<NonNull<()>>,
}

thread_local! {
    pub static GLOBAL_INITIALIZED: Cell<bool> = const { Cell::new(false) };
    // PORT NOTE: Zig `threadlocal var global: *MiniEventLoop = undefined;` — raw pointer
    // because the global is heap-allocated once (heap::alloc) and lives for the
    // thread's lifetime (a true thread-lifetime singleton; never freed in Zig either).
    pub static GLOBAL: Cell<*mut MiniEventLoop<'static>> = const { Cell::new(core::ptr::null_mut()) };
}

/// Returns the thread-local `*mut MiniEventLoop` (Zig: `*MiniEventLoop`).
///
/// PORT NOTE (aliasing): Zig's `*T` aliases freely; returning `&'static mut`
/// here would let two calls (or `init_global` + `MiniKind::get_vm`) hold
/// overlapping `&mut` to the same allocation — UB. Return the raw pointer;
/// callers reborrow `&mut` for the scope they need.
pub fn init_global(
    env: Option<&'static mut DotEnvLoader<'static>>,
    cwd: Option<&[u8]>,
) -> *mut MiniEventLoop<'static> {
    if GLOBAL_INITIALIZED.with(|g| g.get()) {
        // Already initialized: hand back the stored raw pointer. No `&mut` is
        // materialized here (see fn doc — avoids aliased `&'static mut` UB).
        return GLOBAL.with(|g| g.get());
    }
    let loop_ = MiniEventLoop::init();
    // PORT NOTE: §Forbidden bans `Box::leak` for `&'static`; this is a
    // thread-lifetime singleton, so use `heap::alloc` (intrusive ownership)
    // and store the raw pointer in the thread-local — same as Zig
    // `bun.default_allocator.create` + `threadlocal var global: *MiniEventLoop`.
    let global_ptr: *mut MiniEventLoop<'static> = bun_core::heap::into_raw(Box::new(loop_));
    // SAFETY: `global_ptr` was just allocated via `heap::alloc`; this thread
    // holds the only reference for the duration of first-init. The `GLOBAL`
    // thread-local is NOT yet published (set below, after this `&mut` is dropped),
    // so neither `MiniKind::get_vm()` nor a re-entrant `init_global()` can observe
    // the pointer while this exclusive borrow is live. The `&mut` is scoped to
    // this function body — NOT `'static` — and ends before we publish/return the
    // raw ptr.
    let global = unsafe { &mut *global_ptr };

    // PORT NOTE: `InternalLoopData::set_parent_event_loop` (typed) lives in a
    // higher tier; the sys-level API is `set_parent_raw(tag, ptr)`. Tag 1 = JS,
    // tag 2 = mini (matches Zig `EventLoopHandle` discriminant + 1).
    {
        let (tag, ptr) = EventLoopHandle::init_mini(global_ptr).into_tag_ptr();
        // SAFETY: see `loop_ptr()` invariant.
        unsafe {
            (*global.loop_ptr())
                .internal_loop_data
                .set_parent_raw(tag, ptr)
        };
    }

    // PORT NOTE: Zig `bun.DotEnv.instance` is a `?*Loader` global. The Rust
    // port stores it as `AtomicPtr<Loader<'static>>`.
    global.env = env.map(NonNull::from).or_else(|| {
        NonNull::new(
            dotenv::INSTANCE
                .load(core::sync::atomic::Ordering::Acquire)
                .cast::<DotEnvLoader<'static>>(),
        )
    });
    if global.env.is_none() {
        // Thread-lifetime singletons (matches Zig `bun.default_allocator.create`).
        let map: *mut dotenv::Map = bun_core::heap::into_raw(Box::new(dotenv::Map::init()));
        // SAFETY: `map` lives for the thread (singleton); never freed (Zig parity).
        let loader =
            bun_core::heap::into_raw_nn(Box::new(DotEnvLoader::init(unsafe { &mut *map })));
        global.env = Some(loader);
    }

    // Set top_level_dir from provided cwd or get current working directory
    if let Some(dir) = cwd {
        // PORT NOTE: Zig borrowed `dir`; we dupe to keep Box<[u8]> ownership uniform.
        global.top_level_dir = Box::<[u8]>::from(dir);
    } else if global.top_level_dir.is_empty() {
        let mut buf = bun_paths::PathBuffer::uninit();
        match sys::getcwd(&mut buf[..]) {
            Ok(len) => {
                global.top_level_dir = Box::<[u8]>::from(&buf[..len]);
            }
            Err(_) => {
                global.top_level_dir = Box::default();
            }
        }
    }

    // Publish the thread-local pointer only AFTER the scoped `&mut *global_ptr`
    // above is no longer used — `MiniKind::get_vm()` reads `GLOBAL` without
    // checking `GLOBAL_INITIALIZED`, so publishing earlier would let a callee
    // re-derive a `&mut` aliasing `global` (UB). Nothing between the `&mut`
    // borrow and here reads `GLOBAL` (`EventLoopHandle::init_mini`/`into_tag_ptr`
    // only copy the pointer value).
    GLOBAL.with(|g| g.set(global_ptr));
    GLOBAL_INITIALIZED.with(|g| g.set(true));
    global_ptr
}

impl<'a> MiniEventLoop<'a> {
    /// Raw `*mut uws::Loop` (Zig: `this.loop`).
    ///
    /// This is the sole accessor for the `loop_` field. A `&mut UwsLoop`-
    /// returning accessor is intentionally **not** provided: `UwsLoop::tick()`
    /// fires FilePoll callbacks which re-enter this struct via the
    /// `EventLoopCtx` vtable (`platform_event_loop`) and via
    /// `EventLoopHandle::Mini` (e.g. `enqueue_task_concurrent` → `wakeup()`),
    /// so a held `&mut UwsLoop` across `.tick()` would alias. The loop is also
    /// a C-owned handle whose internals are mutated by uSockets itself. All
    /// access goes through the raw pointer instead.
    ///
    /// SAFETY (invariant): `self.loop_` is the live C-owned uws loop set in
    /// [`init`](Self::init) via `UwsLoop::get()`; never null, outlives `self`.
    #[inline]
    pub fn loop_ptr(&self) -> *mut UwsLoop {
        self.loop_
    }

    /// Raw pointer to the `DotEnv::Loader` backref (Zig: `this.env.?`).
    ///
    /// Returns `None` until [`init_global`] populates it. Neither a `&`- nor
    /// a `&mut`-returning accessor is provided: the loader may be shared via
    /// the process-global `dotenv::INSTANCE` (and `Transpiler::env`), and
    /// other safe paths (`GlobalMini::create_null_delimited_env_map`,
    /// `EventLoopHandle::create_null_delimited_env_map`, `interpreter.rs`)
    /// materialize `&mut DotEnvLoader` from the same allocation via raw deref.
    /// Handing out a long-lived `&DotEnvLoader` here would let safe code hold
    /// it across one of those `&mut` paths → aliased `&`/`&mut` UB. Callers
    /// deref the returned `NonNull` for a tightly-scoped borrow under their
    /// own SAFETY contract instead (mirrors [`loop_ptr`](Self::loop_ptr)).
    ///
    /// SAFETY (invariant): when `Some`, points to a thread-/process-lifetime
    /// loader set in `init_global` that outlives `self` (never freed — Zig
    /// parity).
    #[inline]
    pub fn env_ptr(&self) -> Option<NonNull<DotEnvLoader<'a>>> {
        self.env
    }

    #[inline]
    pub fn get_vm_impl(&mut self) -> &mut MiniEventLoop<'a> {
        self
    }

    pub fn throw_error(&mut self, err: sys::Error) {
        bun_core::pretty_errorln!("{}", err);
        Output::flush();
    }

    pub fn pipe_read_buffer(&mut self) -> &mut [u8] {
        // `boxed_zeroed` avoids the 256 KiB stack temporary `Box::new([0u8; N])`
        // would create in debug builds.
        &mut self
            .pipe_read_buffer
            .get_or_insert_with(bun_core::boxed_zeroed::<PipeReadBuffer>)[..]
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

    /// Raw-pointer variant of [`file_polls`] for re-entrant callers.
    ///
    /// The `mini_ctx` vtable shim (`file_polls`) is reached
    /// via `EventLoopCtx` from inside FilePoll callbacks fired by
    /// `UwsLoop::tick()`, which is itself invoked from
    /// `tick`/`tick_once`/`tick_without_idle` while those methods hold
    /// `&mut self`. Re-deriving a second `&mut MiniEventLoop` from the stored
    /// `owner` raw ptr there is aliased-`&mut` UB under Stacked Borrows. This
    /// accessor lazy-inits the store via `addr_of_mut!` on the field only,
    /// never materializing a `&mut Self`.
    ///
    /// # Safety
    /// `this` must point to a live `MiniEventLoop`. Caller must not hold a
    /// live `&mut` to `file_polls_` itself across this call. (Not eligible for
    /// `unsafe-fn-narrow`: every unsafe op below derefs the caller-supplied
    /// `this`; the body cannot discharge that precondition.)
    pub unsafe fn file_polls_raw(this: *mut Self) -> *mut FilePollStore {
        unsafe {
            let slot = core::ptr::addr_of_mut!((*this).file_polls_);
            if (*slot).is_none() {
                slot.write(Some(Box::new(FilePollStore::init())));
            }
            // SAFETY: ensured `Some` just above; `Box` deref yields a stable
            // heap address independent of `*this`.
            match &mut *slot {
                Some(b) => &raw mut **b,
                None => core::hint::unreachable_unchecked(),
            }
        }
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
        let concurrent = self.concurrent_tasks.pop_batch();
        let count = concurrent.count;
        if count == 0 {
            return 0;
        }

        let mut iter = concurrent.iterator();
        let start_count = self.tasks.readable_length();
        // Zig resets `self.tasks.head = 0` when `start_count == 0` so
        // `writableSlice(0)` spans the whole buffer. That reset is
        // load-bearing: `ensure_unused_capacity` early-returns without
        // realigning when capacity is already sufficient, and
        // `writable_slice(0)` only yields the first contiguous segment
        // `buf[head+count..]` — so an empty fifo with `head > 0` would yield a
        // short slice and the loop would `break` early, silently dropping
        // tasks already popped from `concurrent`. Use `writable_with_size`,
        // which realigns when the contiguous slice is too short, so the
        // returned slice is always `>= count` long.
        //
        // PORT NOTE: reshaped for borrowck — Zig held `writable` (&mut into self.tasks) while
        // bumping `self.tasks.count` per-iteration (overlapping &mut). Fill the writable slice
        // first, track items written in a local, then commit via `update()` after the borrow ends.
        let mut written: usize = 0;
        {
            let mut writable = self.tasks.writable_with_size(count).expect("unreachable");
            loop {
                let task = iter.next();
                if task.is_null() {
                    break;
                }
                writable[0] = task;
                writable = &mut writable[1..];
                written += 1;
                if writable.is_empty() {
                    break;
                }
            }
        }
        self.tasks.update(written);

        self.tasks.readable_length() - start_count
    }

    #[inline]
    pub fn tick_once(&mut self, context: *mut c_void) {
        if self.tick_concurrent_with_count() == 0 && self.tasks.readable_length() == 0 {
            // SAFETY: see `loop_ptr()` invariant.
            unsafe {
                (*self.loop_ptr()).inc();
                (*self.loop_ptr()).tick();
                (*self.loop_ptr()).dec();
            }
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

            // SAFETY: see `loop_ptr()` invariant.
            unsafe { (*self.loop_ptr()).tick_without_idle() };

            if self.tasks.readable_length() == 0 && self.tick_concurrent_with_count() == 0 {
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
        // here also monomorphizes — should match. `tick_once` is `#[inline]` so codegen is
        // identical to the previously hand-inlined body.
        while !is_done(context) {
            self.tick_once(context);
        }
    }

    /// Zig: `enqueueTask(comptime Context, ctx, comptime Callback, comptime field)`.
    ///
    /// `comptime field: std.meta.FieldEnum(Context)` + `@field(ctx, name)` is replaced
    /// per PORTING.md (§reflection) with a caller-supplied `field_offset =
    /// core::mem::offset_of!(C, <field>)` into the embedded `AnyTaskWithExtraContext`.
    ///
    /// PORT NOTE: the Zig body is dead code — it calls `Task.New(Context, Callback)`
    /// (wrong arity; `New` takes 3 type args) and `this.enqueueJSCTask(...)` (no such
    /// decl). Zig's lazy analysis lets this compile because no caller exists. The
    /// faithful port writes to `self.tasks` (the local non-concurrent FIFO), which is
    /// the only plausible target for a `*JSCTask` push on a MiniEventLoop.
    pub fn enqueue_task<C>(
        &mut self,
        ctx: *mut C,
        callback: fn(*mut C, *mut ()),
        field_offset: usize,
    ) {
        // SAFETY: caller contract — `field_offset == offset_of!(C, <field>)` where
        // `<field>: AnyTaskWithExtraContext`, and `ctx` is live for the task's duration.
        let task = unsafe {
            ctx.cast::<u8>()
                .add(field_offset)
                .cast::<AnyTaskWithExtraContext>()
        };
        // Zig: `@field(ctx, name) = TaskType.init(ctx);`
        // SAFETY: `task` points at a properly aligned `AnyTaskWithExtraContext` field of `*ctx`.
        unsafe { task.write(New::<C, ()>::init(ctx, callback)) };
        // Zig: `this.enqueueJSCTask(&@field(ctx, name))` — see PORT NOTE above.
        self.tasks.write_item(task).expect("unreachable");
    }

    pub fn enqueue_task_concurrent(&mut self, task: *mut AnyTaskWithExtraContext) {
        self.concurrent_tasks.push(task);
        // SAFETY: see `loop_ptr()` invariant.
        unsafe { (*self.loop_ptr()).wakeup() };
    }

    /// Zig: `enqueueTaskConcurrentWithExtraCtx(comptime Context, comptime ParentContext,
    /// ctx, comptime Callback, comptime field)`.
    ///
    /// `comptime field: std.meta.FieldEnum(Context)` + `@field(ctx, name)` is replaced
    /// per PORTING.md (§reflection) with a caller-supplied `field_offset =
    /// core::mem::offset_of!(C, <field>)` into the embedded `AnyTaskWithExtraContext`.
    pub fn enqueue_task_concurrent_with_extra_ctx<C, P>(
        &mut self,
        ctx: *mut C,
        callback: fn(*mut C, *mut P),
        field_offset: usize,
    ) {
        // Zig: jsc.markBinding(@src()) — debug-only source marker; no Rust equivalent needed.
        // SAFETY: caller contract — `field_offset == offset_of!(C, <field>)` where
        // `<field>: AnyTaskWithExtraContext`, and `ctx` outlives the queued task
        // (intrusive node; ownership stays with caller).
        let task = unsafe {
            ctx.cast::<u8>()
                .add(field_offset)
                .cast::<AnyTaskWithExtraContext>()
        };
        // Zig: `@field(ctx, name) = TaskType.init(ctx);`
        // SAFETY: `task` points at a properly aligned `AnyTaskWithExtraContext` field of `*ctx`.
        unsafe { task.write(New::<C, P>::init(ctx, callback)) };

        self.concurrent_tasks.push(task);

        // SAFETY: see `loop_ptr()` invariant.
        unsafe { (*self.loop_ptr()).wakeup() };
    }

    /// Lazy-init helper shared by [`stderr`]/[`stdout`]: `fstat → __bun_stdio_blob_store_new → cache`.
    /// Zig builds Blob.Store with intrusive `ref_count = 2` and
    /// `.data = .file{ pathlike = .{ .fd }, is_atty, mode }`.
    #[inline]
    fn lazy_stdio_store(slot: &mut Option<NonNull<()>>, fd: Fd, is_atty: bool) -> *mut () {
        if slot.is_none() {
            let mut mode: Mode = 0;
            if let Ok(stat) = sys::fstat(fd) {
                mode = stat.st_mode as Mode;
            }
            let store = __bun_stdio_blob_store_new(fd, is_atty, mode);
            *slot = NonNull::new(store);
        }
        slot.unwrap().as_ptr()
    }

    /// Returns an erased `*mut webcore::blob::Store`. Callers in tier-6 cast back.
    pub fn stderr(&mut self) -> *mut () {
        // NB: spec (MiniEventLoop.zig:243) deliberately uses `FD.fromUV(2)` here, not
        // `Fd::stderr()` — Windows uv-fd vs native-handle distinction. Do not "tidy".
        Self::lazy_stdio_store(
            &mut self.stderr_store,
            Fd::from_uv(2),
            Output::stderr_descriptor_type() == Output::OutputStreamDescriptor::Terminal,
        )
    }

    /// Returns an erased `*mut webcore::blob::Store`. Callers in tier-6 cast back.
    pub fn stdout(&mut self) -> *mut () {
        Self::lazy_stdio_store(
            &mut self.stdout_store,
            Fd::stdout(),
            Output::stdout_descriptor_type() == Output::OutputStreamDescriptor::Terminal,
        )
    }
}

// ───────────── EventLoopCtx adapter (bun_io cycle-break) ─────────────────
// `bun_io::file_poll::Store::put` and friends take an erased `EventLoopCtx`
// instead of naming `MiniEventLoop`/`VirtualMachine` directly. This crate owns
// `MiniEventLoop`, so the Mini-side vtable lives here. The Js-side vtable lives
// in `bun_runtime` (it must name `jsc::VirtualMachine`).

bun_io::link_impl_EventLoopCtx! {
    Mini for MiniEventLoop<'static> => |this| {
        platform_event_loop_ptr() => (*this).loop_ptr(),
        // `file_polls_raw` to avoid aliased `&mut MiniEventLoop` while `tick*`
        // holds `&mut self` across the re-entrant `UwsLoop::tick()` that
        // reaches this body.
        file_polls_ptr()  => MiniEventLoop::file_polls_raw(this),
        // Mini has no pending_unref_counter; the upstream deliberately panics.
        increment_pending_unref_counter() => panic!("FIXME TODO"),
        // `KeepAlive::{,un}refConcurrently` is JS-VM-only (statically rejected
        // on Mini upstream); preserve that invariant rather than racily
        // mutating uws counters off-thread.
        ref_concurrently()   => unreachable!("KeepAlive::refConcurrently is JS-VM-only"),
        unref_concurrently() => unreachable!("KeepAlive::unrefConcurrently is JS-VM-only"),
        after_event_loop_callback() => (*this).after_event_loop_callback,
        set_after_event_loop_callback(cb, ctx) => {
            (*this).after_event_loop_callback = cb;
            (*this).after_event_loop_callback_ctx = NonNull::new(ctx);
        },
        pipe_read_buffer() => core::ptr::from_mut::<[u8]>((*this).pipe_read_buffer()),
    }
}

impl<'a> MiniEventLoop<'a> {
    #[inline]
    pub fn as_event_loop_ctx(this: *mut MiniEventLoop<'a>) -> bun_io::EventLoopCtx {
        // SAFETY: `this` is the live per-thread MiniEventLoop singleton; it
        // outlives every `EventLoopCtx` derived from it.
        unsafe { bun_io::EventLoopCtx::new(bun_io::EventLoopCtxKind::Mini, this) }
    }
}

impl<'a> Drop for MiniEventLoop<'a> {
    fn drop(&mut self) {
        // PORT NOTE: `tasks.deinit()` is implicit via Queue's Drop.
        debug_assert!(self.concurrent_tasks.is_empty());
    }
}

// ───────────────────────────── MiniVM ─────────────────────────────

pub struct MiniVM<'a> {
    // PORT NOTE: LIFETIMES.tsv classifies this BORROW_PARAM `&'a`, but `file_polls()`
    // mutates the loop (lazy-inits the store). Hold `&'a mut` instead of
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
    pub fn platform_event_loop(&self) -> *mut PlatformEventLoop {
        bun_io::uws_to_native(self.mini.loop_ptr())
    }

    #[inline]
    pub fn increment_pending_unref_counter(&self) {
        // Zig spec body: `_ = this; @panic("FIXME TODO");` — MiniEventLoop has no
        // pending_unref_counter (only `jsc.VirtualMachine` does). This is the REAL
        // ported body, not a stub.
        let _ = self;
        panic!("FIXME TODO");
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
        __bun_js_vm_get()
    }
}

impl EventLoopKindT for MiniKind {
    type Loop = MiniEventLoop<'static>;
    // PORT NOTE (aliasing): Zig `refType() = *MiniEventLoop` is a freely-aliasing
    // pointer. Returning `&'static mut` would let two `get_vm()` calls (or
    // `get_vm()` + `init_global()`) hold overlapping `&mut` — UB. Return the raw
    // pointer (matches `JsKind::Ref = *mut ()`); callers reborrow scoped `&mut`.
    type Ref = *mut MiniEventLoop<'static>;
    fn get_vm() -> Self::Ref {
        // Caller must have called `init_global()` first (Zig invariant: `global`
        // is set). No `&mut` materialized here — raw-ptr-only access.
        GLOBAL.with(|g| g.get())
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

// ported from: src/event_loop/MiniEventLoop.zig
