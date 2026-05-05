use core::ffi::c_void;
use std::sync::Once;

use bun_aio as Async;
use bun_alloc::Arena; // MimallocArena → bumpalo::Bump
use bun_core::{self, Output};
use bun_js_parser as js_ast;
use bun_logger as Logger;
use bun_threading::WorkPool;

use crate::BundleV2;

/// Used to keep the bundle thread from spinning on Windows
pub extern "C" fn timer_callback(_: *mut bun_sys::windows::libuv::Timer) {}

/// Originally, bake.DevServer required a separate bundling thread, but that was
/// later removed. The bundling thread's scheduling logic is generalized over
/// the completion structure.
///
/// CompletionStruct's interface:
///
/// - `configureBundler` is used to configure `Bundler`.
/// - `completeOnBundleThread` is used to tell the task that it is done.
pub struct BundleThread<C: CompletionStruct> {
    pub waker: Async::Waker,
    pub ready_event: bun_threading::ResetEvent, // TODO(port): std.Thread.ResetEvent equivalent
    // TODO(port): bun.UnboundedQueue is intrusive over `C.next`; encode field offset via trait/const
    pub queue: bun_collections::UnboundedQueue<C>,
    pub generation: bun_core::Generation,
}

/// Trait capturing the interface the Zig `CompletionStruct: type` parameter must satisfy.
// TODO(port): Zig used `anytype`-style duck typing; verify field/method set matches JSBundleCompletionTask
pub trait CompletionStruct: 'static {
    fn configure_bundler(
        &mut self,
        transpiler: &mut bun_bundler::Transpiler,
        bump: &Arena,
    ) -> Result<(), bun_core::Error>;
    fn complete_on_bundle_thread(&mut self);
    // Field accessors the Zig code touched directly:
    fn set_result(&mut self, result: crate::bundle_v2::BundleResult); // TODO(port): exact result enum type
    fn set_log(&mut self, log: Logger::Log);
    fn set_transpiler(&mut self, this: *mut BundleV2);
    fn plugins(&self) -> Option<*mut crate::bundle_v2::JSBundlerPlugin>; // TODO(port): lifetime
    fn config_files(&mut self) -> &mut crate::bundle_v2::FileMap; // TODO(port): exact type of completion.config.files
}

impl<C: CompletionStruct> BundleThread<C> {
    /// To initialize, put this somewhere in memory, and then call `spawn()`
    // TODO(port): Zig `uninitialized` left `waker` as `undefined`; using a zeroed/default placeholder.
    pub fn uninitialized() -> Self {
        Self {
            // SAFETY: waker is overwritten in thread_main before any use; ready_event.wait()
            // in spawn() blocks until that happens.
            waker: unsafe { core::mem::zeroed() },
            queue: bun_collections::UnboundedQueue::default(),
            generation: 0,
            ready_event: bun_threading::ResetEvent::default(),
        }
    }

    pub fn spawn(instance: &mut Self) -> Result<bun_threading::Thread, bun_core::Error> {
        // TODO(port): narrow error set
        let instance_ptr = instance as *mut Self;
        // SAFETY: instance outlives the thread (it's a leaked Box / static singleton).
        let thread = bun_threading::Thread::spawn(move || unsafe {
            Self::thread_main(&mut *instance_ptr)
        })?;
        instance.ready_event.wait();
        Ok(thread)
    }

    pub fn enqueue(instance: &mut Self, completion: *mut C) {
        instance.queue.push(completion);
        instance.waker.wake();
    }

    fn thread_main(instance: &mut Self) {
        Output::Source::configure_named_thread("Bundler");

        instance.waker = Async::Waker::init().unwrap_or_else(|_| panic!("Failed to create waker"));

        // Unblock the calling thread so it can continue.
        instance.ready_event.set();

        #[cfg(windows)]
        {
            // TODO(port): libuv Timer lives on stack for the lifetime of this never-returning fn
            let mut timer: bun_sys::windows::libuv::Timer =
                unsafe { core::mem::zeroed() }; // SAFETY: init() fully initializes before use
            timer.init(instance.waker.loop_.uv_loop);
            timer.start(u64::MAX, u64::MAX, timer_callback);
        }

        let mut has_bundled = false;
        loop {
            while let Some(completion) = instance.queue.pop() {
                // SAFETY: queue stores non-null *mut C pushed via enqueue(); owner keeps it alive
                // until complete_on_bundle_thread() signals completion.
                let completion = unsafe { &mut *completion };
                if let Err(err) = Self::generate_in_new_thread(completion, instance.generation) {
                    completion.set_result(crate::bundle_v2::BundleResult::Err(err));
                    completion.complete_on_bundle_thread();
                }
                has_bundled = true;
            }
            instance.generation = instance.generation.saturating_add(1);

            if has_bundled {
                bun_alloc::mi_collect(false); // TODO(port): move to bun_alloc_sys
                has_bundled = false;
            }

            let _ = instance.waker.wait();
        }
    }

    /// This is called from `Bun.build` in JavaScript.
    fn generate_in_new_thread(
        completion: &mut C,
        generation: bun_core::Generation,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut heap = Arena::new(); // ThreadLocalArena.init()
        // `defer heap.deinit()` — Drop handles this.

        let bump = &heap;
        let ast_memory_allocator: &mut js_ast::ASTMemoryAllocator =
            bump.alloc(js_ast::ASTMemoryAllocator { allocator: bump });
        ast_memory_allocator.reset();
        ast_memory_allocator.push();

        let transpiler: &mut bun_bundler::Transpiler =
            bump.alloc(bun_bundler::Transpiler::default()); // TODO(port): Zig left this uninit until configure_bundler

        completion.configure_bundler(transpiler, bump)?;

        transpiler.resolver.generation = generation;

        let this: &mut BundleV2 = BundleV2::init(
            transpiler,
            None, // TODO: Kit
            bump,
            bun_event_loop::AnyEventLoop::init(),
            false,
            WorkPool::get(),
            &mut heap,
        )?;
        // PORT NOTE: reshaped for borrowck — `bump` borrows `heap` immutably while `&mut heap`
        // is passed last; Phase B may need to restructure BundleV2::init signature.

        this.plugins = completion.plugins();
        // Zig: switch (CompletionStruct) { BundleV2.JSBundleCompletionTask => completion, else => @compileError(...) }
        // TODO(port): compile-time type assertion that C == JSBundleCompletionTask; for now cast.
        this.completion = Some(completion as *mut C as *mut BundleV2::JSBundleCompletionTask);
        // Set the file_map pointer for in-memory file support
        this.file_map = if completion.config_files().map.count() > 0 {
            Some(completion.config_files() as *mut _)
        } else {
            None
        };
        completion.set_transpiler(this);

        // defer { ast_memory_allocator.pop(); this.deinitWithoutFreeingArena(); }
        let _defer = scopeguard::guard((), |_| {
            ast_memory_allocator.pop();
            this.deinit_without_freeing_arena();
        });
        // TODO(port): errdefer captures ≥2 disjoint &mut borrows (this.linker, this.transpiler.log,
        // completion); scopeguard cannot cleanly express this alongside the defer above.
        let _errdefer = scopeguard::guard((), |_| {
            // Wait for wait groups to finish. There still may be ongoing work.
            this.linker.source_maps.line_offset_wait_group.wait();
            this.linker.source_maps.quoted_contents_wait_group.wait();

            let mut out_log = Logger::Log::init();
            this.transpiler.log.append_to_with_recycled(&mut out_log, true);
            completion.set_log(out_log);
        });

        let value = this.run_from_js_in_new_thread(&transpiler.options.entry_points)?;
        completion.set_result(crate::bundle_v2::BundleResult::Value(value));

        // Disarm errdefer on success.
        scopeguard::ScopeGuard::into_inner(_errdefer);

        let mut out_log = Logger::Log::init();
        this.transpiler.log.append_to_with_recycled(&mut out_log, true);
        completion.set_log(out_log);
        completion.complete_on_bundle_thread();
        Ok(())
    }
}

/// Lazily-initialized singleton. This is used for `Bun.build` since the
/// bundle thread may not be needed.
// TODO(port): Zig had a per-monomorphization `singleton` struct with `static var instance`.
// Rust forbids generic statics; Phase B should instantiate this once for the concrete
// `JSBundleCompletionTask` type (the only valid `CompletionStruct` per the @compileError check).
pub mod singleton {
    use super::*;

    static ONCE: Once = Once::new();
    static mut INSTANCE: Option<*mut BundleThread<BundleV2::JSBundleCompletionTask>> = None;

    // Blocks the calling thread until the bun build thread is created.
    // std.once also blocks other callers of this function until the first caller is done.
    fn load_once_impl() {
        let bundle_thread = Box::into_raw(Box::new(BundleThread::uninitialized()));
        // SAFETY: only called once under ONCE.
        unsafe { INSTANCE = Some(bundle_thread) };

        // 2. Spawn the bun build thread.
        // SAFETY: bundle_thread is a leaked Box, valid for 'static.
        let os_thread = unsafe { &mut *bundle_thread }
            .spawn()
            .unwrap_or_else(|_| Output::panic("Failed to spawn bun build thread"));
        os_thread.detach();
    }

    pub fn get() -> &'static mut BundleThread<BundleV2::JSBundleCompletionTask> {
        ONCE.call_once(load_once_impl);
        // SAFETY: INSTANCE is Some after call_once; pointer is a leaked 'static Box.
        unsafe { &mut *INSTANCE.unwrap() }
    }

    pub fn enqueue(completion: *mut BundleV2::JSBundleCompletionTask) {
        get().enqueue(completion);
    }
}

pub use bun_js_parser::Ref;

pub use bun_js_parser::Index;

pub use crate::DeferredBatchTask;
pub use crate::ThreadPool;
pub use crate::ParseTask;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/BundleThread.zig (195 lines)
//   confidence: medium
//   todos:      13
//   notes:      generic-static singleton collapsed to concrete JSBundleCompletionTask; defer/errdefer overlap needs borrowck reshaping in Phase B
// ──────────────────────────────────────────────────────────────────────────
