use bun_aio::FilePoll;
use bun_uws::Loop as UwsLoop;

use crate::{AnyTaskWithExtraContext, MiniEventLoop};

/// Manual vtable for the JS-event-loop arm of `AnyEventLoop` (cold dispatch —
/// see PORTING.md §Dispatch). `bun_runtime` provides the static instance that
/// casts `owner` back to `*mut jsc::EventLoop` and forwards to the real methods.
// PERF(port): was inline switch
pub struct JsEventLoopVTable {
    pub iteration_number: unsafe fn(*mut ()) -> u64,
    pub file_polls: unsafe fn(*mut ()) -> *mut bun_aio::file_poll::Store,
    pub put_file_poll: unsafe fn(*mut (), *mut FilePoll, was_ever_registered: bool),
    pub uws_loop: unsafe fn(*mut ()) -> *mut UwsLoop,
    pub pipe_read_buffer: unsafe fn(*mut ()) -> *mut [u8],
    pub tick: unsafe fn(*mut ()),
    pub auto_tick: unsafe fn(*mut ()),
    pub auto_tick_active: unsafe fn(*mut ()),
}

/// Useful for code that may need an event loop and could be used from either JavaScript or directly without JavaScript.
/// Unlike jsc.EventLoopHandle, this owns the event loop when it's not a JavaScript event loop.
// PORT NOTE: Zig `union(EventLoopKind)` — variant order/discriminant must match `crate::EventLoopKind`.
pub enum AnyEventLoop<'a> {
    Js {
        // SAFETY: erased `*mut jsc::EventLoop` — runtime constructs this variant.
        owner: *mut (),
        vtable: &'static JsEventLoopVTable,
    },
    Mini(MiniEventLoop<'a>),
}

// PORT NOTE: Zig had `pub const Task = AnyTaskWithExtraContext;` as an associated decl.
// Inherent associated types are unstable in Rust, so expose at module level.
pub type Task = AnyTaskWithExtraContext;

impl<'a> AnyEventLoop<'a> {
    pub fn iteration_number(&self) -> u64 {
        match self {
            // SAFETY: vtable populated by runtime; owner is the erased EventLoop ptr.
            AnyEventLoop::Js { owner, vtable } => unsafe { (vtable.iteration_number)(*owner) },
            // TODO(port): `loop` is a Rust keyword; assumes MiniEventLoop port names the field `loop_`.
            AnyEventLoop::Mini(mini) => mini.loop_.iteration_number(),
        }
    }

    pub fn wakeup(&mut self) {
        self.r#loop().wakeup();
    }

    pub fn file_polls(&mut self) -> &mut bun_aio::file_poll::Store {
        match self {
            // SAFETY: vtable contract — returns a valid &mut Store owned by the VM.
            AnyEventLoop::Js { owner, vtable } => unsafe { &mut *(vtable.file_polls)(*owner) },
            AnyEventLoop::Mini(mini) => mini.file_polls(),
        }
    }

    pub fn put_file_poll(&mut self, poll: &mut FilePoll) {
        // TODO(port): `poll.flags.contains(.was_ever_registered)` — exact flag-set type/path TBD in bun_aio.
        let was_ever_registered = poll.flags.contains(bun_aio::file_poll::Flag::WasEverRegistered);
        match self {
            AnyEventLoop::Js { owner, vtable } => unsafe {
                (vtable.put_file_poll)(*owner, poll, was_ever_registered)
            },
            AnyEventLoop::Mini(mini) => {
                // PORT NOTE: reshaped for borrowck — Zig passed `&this.mini` while also holding
                // `this.mini.filePolls()` mutably; Phase B may need to split the borrow.
                let store = mini.file_polls();
                store.put(poll, mini, was_ever_registered);
            }
        }
    }

    // PORT NOTE: renamed via raw identifier — `loop` is a Rust keyword.
    pub fn r#loop(&mut self) -> &mut UwsLoop {
        match self {
            // SAFETY: vtable contract — returns a valid &mut UwsLoop owned by the VM.
            AnyEventLoop::Js { owner, vtable } => unsafe { &mut *(vtable.uws_loop)(*owner) },
            AnyEventLoop::Mini(mini) => mini.loop_,
        }
    }

    pub fn pipe_read_buffer(&mut self) -> &mut [u8] {
        match self {
            // SAFETY: vtable contract — returns a valid &mut [u8] owned by the VM.
            AnyEventLoop::Js { owner, vtable } => unsafe { &mut *(vtable.pipe_read_buffer)(*owner) },
            AnyEventLoop::Mini(mini) => mini.pipe_read_buffer(),
        }
    }

    pub fn init() -> AnyEventLoop<'a> {
        // PORT NOTE: Zig took `allocator: std.mem.Allocator`; dropped per §Allocators (non-AST crate).
        AnyEventLoop::Mini(MiniEventLoop::init())
    }

    pub fn tick<C: Copy>(&mut self, context: C, is_done: fn(C) -> bool) {
        match self {
            AnyEventLoop::Js { owner, vtable } => {
                while !is_done(context) {
                    // SAFETY: vtable contract.
                    unsafe {
                        (vtable.tick)(*owner);
                        (vtable.auto_tick)(*owner);
                    }
                }
            }
            AnyEventLoop::Mini(mini) => {
                // TODO(port): Zig used `@ptrCast(isDone)` to erase the fn-pointer type for
                // `mini.tick(context, *const fn(*anyopaque) bool)`. Phase B: decide whether
                // MiniEventLoop::tick is generic over C or takes an erased `*mut c_void` + fn ptr.
                mini.tick(context, is_done);
            }
        }
    }

    pub fn tick_once<C>(&mut self, context: C) {
        match self {
            AnyEventLoop::Js { owner, vtable } => {
                let _ = context;
                // SAFETY: vtable contract.
                unsafe {
                    (vtable.tick)(*owner);
                    (vtable.auto_tick_active)(*owner);
                }
            }
            AnyEventLoop::Mini(mini) => {
                mini.tick_without_idle(context);
            }
        }
    }

    pub fn enqueue_task_concurrent<Context, ParentContext>(
        &mut self,
        ctx: &mut Context,
        callback: fn(&mut Context, &mut ParentContext),
        // TODO(port): Zig param `comptime field: std.meta.FieldEnum(Context)` — struct-field
        // reflection has no Rust equivalent. Likely becomes `core::mem::offset_of!`-based or
        // the caller passes `&mut ctx.<field>` directly. See MiniEventLoop port.
    ) {
        match self {
            AnyEventLoop::Js { .. } => {
                bun_core::todo_panic!("AnyEventLoop.enqueueTaskConcurrent");
                // const TaskType = AnyTask.New(Context, Callback);
                // @field(ctx, field) = TaskType.init(ctx);
                // var concurrent = bun.default_allocator.create(ConcurrentTask) catch unreachable;
                // _ = concurrent.from(jsc.Task.init(&@field(ctx, field)));
                // concurrent.auto_delete = true;
                // this.virtual_machine.jsc.enqueueTaskConcurrent(concurrent);
            }
            AnyEventLoop::Mini(mini) => {
                // TODO(port): forward the `field` reflection param once its Rust shape is decided.
                mini.enqueue_task_concurrent_with_extra_ctx::<Context, ParentContext>(ctx, callback);
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/event_loop/AnyEventLoop.zig (123 lines)
//   confidence: medium
//   todos:      6
//   notes:      Js variant borrow may need &mut; `loop` keyword collision; FieldEnum reflection deferred.
// ──────────────────────────────────────────────────────────────────────────
