//! This is AnyTask except it gives you two pointers instead of one.
//! Generally, prefer jsc.Task instead of this.

use core::ffi::c_void;
use core::marker::PhantomData;
use core::ptr::NonNull;

pub struct AnyTaskWithExtraContext {
    pub(crate) ctx: Option<NonNull<()>>,
    pub(crate) callback: fn(*mut (), *mut ()),
    /// Intrusive link for `UnboundedQueue(AnyTaskWithExtraContext, .next)` (MiniEventLoop).
    pub(crate) next: bun_threading::Link<AnyTaskWithExtraContext>,
}

impl Default for AnyTaskWithExtraContext {
    fn default() -> Self {
        Self {
            ctx: None,
            callback: |_, _| unreachable!("callback was undefined"),
            next: bun_threading::Link::new(),
        }
    }
}

impl AnyTaskWithExtraContext {
    /// Heap-allocates a wrapper around `ptr`, returns a pointer to the embedded
    /// `AnyTaskWithExtraContext`. When `run` fires, it calls `callback(ptr, extra)`
    /// and then frees the wrapper.
    pub fn from_callback_auto_deinit<T>(
        ptr: *mut T,
        callback: fn(*mut T, *mut c_void),
    ) -> *mut AnyTaskWithExtraContext {
        #[repr(C)]
        struct Wrapper<T> {
            any_task: AnyTaskWithExtraContext,
            // Raw on purpose: Wrapper is Box'd and escapes the call frame, so
            // a borrow lifetime cannot be expressed. Caller guarantees `ptr`
            // outlives the task.
            wrapped: *mut T,
            // Stable Rust has no const fn-pointer generics,
            // so the callback is stored here instead.
            callback: fn(*mut T, *mut c_void),
        }

        fn function<T>(this: *mut (), extra: *mut ()) {
            // SAFETY: `this` is the `ctx` we set below, which is the Box'd `Wrapper<T>`
            // pointer. `any_task` is the first field of a `#[repr(C)]` struct, so the
            // address is also valid as `*mut Wrapper<T>`.
            let that: Box<Wrapper<T>> = unsafe { bun_core::heap::take(this.cast::<Wrapper<T>>()) };
            // `defer bun.default_allocator.destroy(that)` — Box drops at end of scope.
            let ctx = that.wrapped;
            (that.callback)(ctx, extra.cast::<c_void>());
        }

        let task = bun_core::heap::into_raw(Box::new(Wrapper::<T> {
            any_task: AnyTaskWithExtraContext {
                callback: function::<T>,
                ctx: None, // patched below to point at the Box itself
                next: bun_threading::Link::new(),
            },
            wrapped: ptr,
            callback,
        }));
        // SAFETY: `task` was just produced by heap::alloc; valid and exclusive.
        unsafe {
            (*task).any_task.ctx = NonNull::new(task.cast::<()>());
            core::ptr::addr_of_mut!((*task).any_task)
        }
    }

    /// Initializes `self` in place to call `callback(of, extra)`.
    // The unit context means the callee is effectively `fn(*T)` only; mapped
    // to `*mut ()` to keep the two-arg stored ABI uniform.
    // Named `from` for historical reasons; not the `From` trait.
    pub fn from<T>(&mut self, of: *mut T, callback: fn(*mut T, *mut ())) -> *mut Self {
        *self = New::<T, ()>::init(of, callback);
        std::ptr::from_mut::<Self>(self)
    }

    pub(crate) fn run(&mut self, extra: *mut c_void) {
        let callback = self.callback;
        let ctx = self.ctx;
        // SAFETY: caller contract — `ctx` was set by `init`/`from*` to a live pointer.
        callback(ctx.expect("ctx is non-null").as_ptr(), extra.cast::<()>());
    }
}

/// Stable Rust cannot take a fn value as a const generic, so `Callback` moves to
/// a runtime argument on `init` and is type-erased (ABI-identical: both forms
/// are thin fn pointers taking two thin data pointers).
pub struct New<T, C>(PhantomData<(*mut T, *mut C)>);

impl<T, C> New<T, C> {
    pub fn init(ctx: *mut T, callback: fn(*mut T, *mut C)) -> AnyTaskWithExtraContext {
        AnyTaskWithExtraContext {
            // SAFETY: `fn(*mut T, *mut C)` and `fn(*mut (), *mut ())` have identical
            // ABI (single code pointer, two pointer-sized args).
            callback: unsafe {
                bun_ptr::cast_fn_ptr::<fn(*mut T, *mut C), fn(*mut (), *mut ())>(callback)
            },
            ctx: NonNull::new(ctx.cast::<()>()),
            next: bun_threading::Link::new(),
        }
    }
}
