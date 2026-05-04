//! This is AnyTask except it gives you two pointers instead of one.
//! Generally, prefer jsc.Task instead of this.

use core::ffi::c_void;
use core::marker::PhantomData;
use core::ptr::NonNull;

pub struct AnyTaskWithExtraContext {
    pub ctx: Option<NonNull<()>>,
    pub callback: fn(*mut (), *mut ()),
    /// Intrusive link for `UnboundedQueue(AnyTaskWithExtraContext, .next)` (MiniEventLoop).
    pub next: *mut AnyTaskWithExtraContext,
}

impl Default for AnyTaskWithExtraContext {
    fn default() -> Self {
        // Zig: ctx/callback default to `undefined`, next defaults to `null`.
        Self {
            ctx: None,
            callback: |_, _| unreachable!("callback was undefined"),
            next: core::ptr::null_mut(),
        }
    }
}

impl AnyTaskWithExtraContext {
    /// Heap-allocates a wrapper around `ptr`, returns a pointer to the embedded
    /// `AnyTaskWithExtraContext`. When `run` fires, it calls `callback(ptr, extra)`
    /// and then frees the wrapper.
    ///
    /// Zig signature: `fn fromCallbackAutoDeinit(ptr: anytype, comptime fieldName: [:0]const u8) *AnyTaskWithExtraContext`
    /// where `fieldName` names a decl on `@TypeOf(ptr).*`. Rust cannot look up a
    /// method by comptime string, so callers pass the function directly.
    // TODO(port): Zig used `@field(Ptr, fieldName)` (comptime decl lookup by name).
    // Rust callers must pass the fn pointer; verify all call sites in Phase B.
    pub fn from_callback_auto_deinit<T>(
        ptr: *mut T,
        callback: fn(*mut T, *mut c_void),
    ) -> *mut AnyTaskWithExtraContext {
        #[repr(C)]
        struct Wrapper<T> {
            any_task: AnyTaskWithExtraContext,
            // TODO(port): LIFETIMES.tsv classifies this as BORROW_PARAM (&'a mut T),
            // but Wrapper is Box'd and escapes the call frame, so a borrow lifetime
            // cannot be expressed. Kept as raw; caller guarantees `ptr` outlives the task.
            wrapped: *mut T,
            // Extra field vs Zig: Zig monomorphized the callback into `Wrapper.function`
            // via `comptime fieldName`. Stable Rust has no const fn-pointer generics,
            // so we store it here instead.
            callback: fn(*mut T, *mut c_void),
        }

        fn function<T>(this: *mut (), extra: *mut ()) {
            // SAFETY: `this` is the `ctx` we set below, which is the Box'd `Wrapper<T>`
            // pointer. `any_task` is the first field of a `#[repr(C)]` struct, so the
            // address is also valid as `*mut Wrapper<T>`.
            let that: Box<Wrapper<T>> = unsafe { Box::from_raw(this.cast::<Wrapper<T>>()) };
            // `defer bun.default_allocator.destroy(that)` — Box drops at end of scope.
            let ctx = that.wrapped;
            (that.callback)(ctx, extra.cast::<c_void>());
        }

        let task = Box::into_raw(Box::new(Wrapper::<T> {
            any_task: AnyTaskWithExtraContext {
                callback: function::<T>,
                ctx: None, // patched below to point at the Box itself
                next: core::ptr::null_mut(),
            },
            wrapped: ptr,
            callback,
        }));
        // SAFETY: `task` was just produced by Box::into_raw; valid and exclusive.
        unsafe {
            (*task).any_task.ctx = NonNull::new(task.cast::<()>());
            core::ptr::addr_of_mut!((*task).any_task)
        }
    }

    /// Zig signature: `fn from(this: *@This(), of: anytype, comptime field: []const u8) *@This()`
    /// — initializes `this` in place to call `@TypeOf(of).field(of, extra)` with
    /// `ContextType = void`.
    // TODO(port): Zig used `@field(T, field)` comptime decl lookup; Rust callers
    // pass the fn pointer directly. Verify call sites in Phase B.
    // TODO(port): Zig passes `ContextType = void` (the unit type, NOT `anyopaque`);
    // `*void` is zero-bit so the callee is effectively `fn(*T)` only. Mapped here
    // to `*mut ()` — Phase B may want `fn(*mut T)` and to drop the second arg.
    // PORT NOTE: name kept as `from` to match Zig; not the `From` trait.
    pub fn from<T>(
        &mut self,
        of: *mut T,
        callback: fn(*mut T, *mut ()),
    ) -> *mut Self {
        *self = New::<T, ()>::init(of, callback);
        self as *mut Self
    }

    pub fn run(&mut self, extra: *mut c_void) {
        // Zig: @setRuntimeSafety(false) — no-op in Rust release; debug keeps the unwrap check.
        let callback = self.callback;
        let ctx = self.ctx;
        // SAFETY: caller contract — `ctx` was set by `init`/`from*` to a live pointer.
        callback(ctx.expect("ctx is non-null").as_ptr(), extra.cast::<()>());
    }
}

/// Zig: `fn New(comptime Type: type, comptime ContextType: type, comptime Callback: anytype) type`
///
/// Stable Rust cannot take a fn value as a const generic, so `Callback` moves to
/// a runtime argument on `init` and is type-erased via transmute (ABI-identical:
/// both forms are thin fn pointers taking two thin data pointers).
// TODO(port): if Phase B needs the zero-storage comptime form, switch to a
// `trait TaskCallback<C> { fn call(&mut self, extra: *mut C); }` bound on `T`.
pub struct New<T, C>(PhantomData<(*mut T, *mut C)>);

impl<T, C> New<T, C> {
    pub fn init(ctx: *mut T, callback: fn(*mut T, *mut C)) -> AnyTaskWithExtraContext {
        AnyTaskWithExtraContext {
            // SAFETY: `fn(*mut T, *mut C)` and `fn(*mut (), *mut ())` have identical
            // ABI (single code pointer, two pointer-sized args). This is the moral
            // equivalent of Zig's `wrap` thunk that `@ptrCast`/`@alignCast`s the args.
            callback: unsafe {
                core::mem::transmute::<fn(*mut T, *mut C), fn(*mut (), *mut ())>(callback)
            },
            ctx: NonNull::new(ctx.cast::<()>()),
            next: core::ptr::null_mut(),
        }
    }

    // TODO(port): Zig's `New(...).wrap(this: ?*anyopaque, extra: ?*anyopaque)` was
    // the type-erasing thunk stored in `.callback = wrap`. Because stable Rust
    // can't take `Callback` as a const generic, `init` transmutes the typed fn
    // pointer directly instead — so `wrap` is folded into that transmute and
    // intentionally omitted here. If Phase B switches to a `TaskCallback<C>`
    // trait bound on `T`, reintroduce `wrap` as the 2-arg stored thunk.
    // PERF(port): Zig used `@call(bun.callmod_inline, Callback, ...)` — profile in Phase B.
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/event_loop/AnyTaskWithExtraContext.zig (72 lines)
//   confidence: medium
//   todos:      6
//   notes:      comptime @field(T, name) decl-lookup replaced with explicit fn-pointer params; New's comptime Callback moved to init() arg via fn-ptr transmute (wrap thunk folded in); from() ContextType=void mapped to () not c_void — audit call sites in Phase B
// ──────────────────────────────────────────────────────────────────────────
