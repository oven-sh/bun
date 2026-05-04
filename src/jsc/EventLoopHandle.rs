use core::ffi::c_char;

use bun_aio::FilePoll;
use bun_uws::Loop;

use crate::{
    AnyEventLoop, AnyTaskWithExtraContext, ConcurrentTask, EventLoop, EventLoopKind,
    JSGlobalObject, MiniEventLoop, VirtualMachine,
};

/// A non-owning reference to either the JS event loop or the mini event loop.
#[derive(Clone, Copy)]
pub enum EventLoopHandle<'a> {
    Js(&'a EventLoop),
    Mini(&'a MiniEventLoop),
}

impl<'a> EventLoopHandle<'a> {
    pub fn global_object(self) -> Option<&'a JSGlobalObject> {
        match self {
            Self::Js(js) => Some(js.global),
            Self::Mini(_) => None,
        }
    }

    pub fn stdout(self) -> &'a bun_runtime::webcore::blob::Store {
        match self {
            Self::Js(js) => js.virtual_machine.rare_data().stdout(),
            Self::Mini(mini) => mini.stdout(),
        }
    }

    pub fn bun_vm(self) -> Option<&'a VirtualMachine> {
        if let Self::Js(js) = self {
            return Some(js.virtual_machine);
        }

        None
    }

    pub fn stderr(self) -> &'a bun_runtime::webcore::blob::Store {
        match self {
            Self::Js(js) => js.virtual_machine.rare_data().stderr(),
            Self::Mini(mini) => mini.stderr(),
        }
    }

    // TODO(port): Zig `cast(comptime tag: EventLoopKind) tag.Type()` used @field/@tagName
    // reflection to return a type dependent on a const param. Rust cannot express a
    // return type varying by const generic without nightly. Callers should match on the
    // enum directly.
    pub fn cast_js(self) -> &'a EventLoop {
        match self {
            Self::Js(js) => js,
            Self::Mini(_) => unreachable!(),
        }
    }
    pub fn cast_mini(self) -> &'a MiniEventLoop {
        match self {
            Self::Mini(mini) => mini,
            Self::Js(_) => unreachable!(),
        }
    }

    pub fn enter(self) {
        match self {
            Self::Js(js) => js.enter(),
            Self::Mini(_) => {}
        }
    }

    pub fn exit(self) {
        match self {
            Self::Js(js) => js.exit(),
            Self::Mini(_) => {}
        }
    }

    pub fn init<T: Into<EventLoopHandle<'a>>>(context: T) -> EventLoopHandle<'a> {
        // Zig switched on @TypeOf(context); Rust dispatches via From impls below.
        context.into()
    }

    pub fn file_polls(self) -> &'a bun_aio::file_poll::Store {
        match self {
            Self::Js(js) => js.virtual_machine.rare_data().file_polls(js.virtual_machine),
            Self::Mini(mini) => mini.file_polls(),
        }
    }

    pub fn put_file_poll(&self, poll: &mut FilePoll) {
        match *self {
            Self::Js(js) => js
                .virtual_machine
                .rare_data()
                .file_polls(js.virtual_machine)
                .put(
                    poll,
                    js.virtual_machine,
                    poll.flags.contains(bun_aio::file_poll::Flags::WasEverRegistered),
                ),
            Self::Mini(mini) => mini.file_polls().put(
                poll,
                mini,
                poll.flags.contains(bun_aio::file_poll::Flags::WasEverRegistered),
            ),
        }
    }

    pub fn enqueue_task_concurrent(self, context: EventLoopTaskPtr<'_>) {
        match self {
            Self::Js(js) => {
                // SAFETY: caller constructed `context` with the `.js` field when `self` is `Js`.
                js.enqueue_task_concurrent(unsafe { context.js });
            }
            Self::Mini(mini) => {
                // SAFETY: caller constructed `context` with the `.mini` field when `self` is `Mini`.
                mini.enqueue_task_concurrent(unsafe { context.mini });
            }
        }
    }

    pub fn loop_(self) -> &'a Loop {
        match self {
            Self::Js(js) => js.usockets_loop(),
            Self::Mini(mini) => mini.loop_,
        }
    }

    pub fn pipe_read_buffer(self) -> &'a mut [u8] {
        match self {
            Self::Js(js) => js.pipe_read_buffer(),
            Self::Mini(mini) => mini.pipe_read_buffer(),
        }
    }

    #[inline]
    pub fn platform_event_loop(self) -> &'a Loop {
        self.loop_()
    }

    pub fn ref_(self) {
        self.loop_().ref_();
    }

    pub fn unref(self) {
        self.loop_().unref();
    }

    #[inline]
    pub fn create_null_delimited_env_map(
        self,
    ) -> Result<Box<[Option<*const c_char>]>, bun_core::Error> {
        // TODO(port): narrow error set
        // TODO(port): return type `[:null]?[*:0]const u8` — verify exact Rust shape in bun_dotenv
        match self {
            Self::Js(js) => js
                .virtual_machine
                .transpiler
                .env
                .map
                .create_null_delimited_env_map(),
            Self::Mini(mini) => mini.env.as_ref().unwrap().map.create_null_delimited_env_map(),
        }
    }

    #[inline]
    pub fn allocator(self) -> &'a dyn bun_alloc::Allocator {
        // PERF(port): non-AST crate — callers likely don't need this once allocator
        // params are deleted; kept for structural parity.
        match self {
            Self::Js(js) => js.virtual_machine.allocator,
            Self::Mini(mini) => mini.allocator,
        }
    }

    #[inline]
    pub fn top_level_dir(self) -> &'a [u8] {
        match self {
            Self::Js(js) => js.virtual_machine.transpiler.fs.top_level_dir,
            Self::Mini(mini) => mini.top_level_dir,
        }
    }

    #[inline]
    pub fn env(self) -> &'a bun_dotenv::Loader {
        match self {
            Self::Js(js) => js.virtual_machine.transpiler.env,
            Self::Mini(mini) => mini.env.as_ref().unwrap(),
        }
    }
}

// `init(anytype)` dispatch — one From impl per Zig @TypeOf arm.
impl<'a> From<&'a VirtualMachine> for EventLoopHandle<'a> {
    fn from(context: &'a VirtualMachine) -> Self {
        Self::Js(context.event_loop())
    }
}
impl<'a> From<&'a EventLoop> for EventLoopHandle<'a> {
    fn from(context: &'a EventLoop) -> Self {
        Self::Js(context)
    }
}
impl<'a> From<&'a MiniEventLoop> for EventLoopHandle<'a> {
    fn from(context: &'a MiniEventLoop) -> Self {
        Self::Mini(context)
    }
}
impl<'a> From<&'a AnyEventLoop> for EventLoopHandle<'a> {
    fn from(context: &'a AnyEventLoop) -> Self {
        match context {
            AnyEventLoop::Js(js) => Self::Js(js),
            AnyEventLoop::Mini(mini) => Self::Mini(mini),
        }
    }
}
// EventLoopHandle => context (identity) is covered by the blanket `From<T> for T`.

pub enum EventLoopTask {
    Js(ConcurrentTask),
    Mini(AnyTaskWithExtraContext),
}

impl EventLoopTask {
    pub fn init(kind: EventLoopKind) -> EventLoopTask {
        match kind {
            EventLoopKind::Js => Self::Js(ConcurrentTask::default()),
            EventLoopKind::Mini => Self::Mini(AnyTaskWithExtraContext::default()),
        }
    }

    pub fn from_event_loop(loop_: EventLoopHandle<'_>) -> EventLoopTask {
        match loop_ {
            EventLoopHandle::Js(_) => Self::Js(ConcurrentTask::default()),
            EventLoopHandle::Mini(_) => Self::Mini(AnyTaskWithExtraContext::default()),
        }
    }
}

/// Untagged union — the active field is determined by the receiving `EventLoopHandle`'s tag.
pub union EventLoopTaskPtr<'a> {
    pub js: &'a mut ConcurrentTask,
    pub mini: &'a mut AnyTaskWithExtraContext,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/EventLoopHandle.zig (180 lines)
//   confidence: medium
//   todos:      3
//   notes:      cast() split into cast_js/cast_mini; init() lowered to From impls; field-access chains (virtual_machine.rare_data() etc.) need verification against ported EventLoop/MiniEventLoop shapes.
// ──────────────────────────────────────────────────────────────────────────
