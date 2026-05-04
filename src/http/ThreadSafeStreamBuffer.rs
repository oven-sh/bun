use core::ffi::c_void;
use core::sync::atomic::AtomicU32;

use bun_io::StreamBuffer;
use bun_threading::Mutex;

pub struct ThreadSafeStreamBuffer {
    pub buffer: StreamBuffer,
    pub mutex: Mutex,
    /// Intrusive atomic refcount. Starts at 2: 1 for main thread and 1 for http thread.
    pub ref_count: AtomicU32,
    /// callback will be called passing the context for the http callback
    /// this is used to report when the buffer is drained and only if end chunk was not sent/reported
    pub callback: Option<Callback>,
}

pub struct Callback {
    pub callback: fn(*mut c_void),
    pub context: *mut c_void,
}

impl Callback {
    pub fn init<T>(callback: fn(*mut T), context: *mut T) -> Self {
        Self {
            // SAFETY: fn(*mut T) and fn(*mut c_void) have identical ABI; the
            // Zig side uses @ptrCast on a comptime fn param. `context` is only
            // ever passed back to this callback, which knows its real type.
            callback: unsafe { core::mem::transmute::<fn(*mut T), fn(*mut c_void)>(callback) },
            context: context as *mut c_void,
        }
    }

    pub fn call(&self) {
        (self.callback)(self.context);
    }
}

impl Default for ThreadSafeStreamBuffer {
    fn default() -> Self {
        Self {
            buffer: StreamBuffer::default(),
            mutex: Mutex::default(),
            // .initExactRefs(2) — 1 for main thread and 1 for http thread
            ref_count: AtomicU32::new(2),
            callback: None,
        }
    }
}

// `bun.ptr.ThreadSafeRefCount(@This(), "ref_count", deinit, .{})`
// → intrusive atomic refcount; ref/deref provided by IntrusiveArc over the
//   embedded `ref_count` field. `deref` drops + deallocates on 0.
pub type StreamBufferRef = bun_ptr::IntrusiveArc<ThreadSafeStreamBuffer>;
// TODO(port): wire `ref_count` field offset / destructor into IntrusiveArc impl

impl ThreadSafeStreamBuffer {
    /// `bun.TrivialNew(@This())` — heap-allocate with the given field values.
    /// Callers on both threads hold raw `*mut ThreadSafeStreamBuffer` and
    /// release via `deref()`, so return a raw pointer (Box::into_raw).
    pub fn new(init: Self) -> *mut Self {
        Box::into_raw(Box::new(init))
    }

    pub fn ref_(this: *mut Self) {
        // TODO(port): delegate to bun_ptr::IntrusiveArc::ref over `ref_count`
        // SAFETY: `this` is a live heap allocation produced by `new`.
        unsafe { (*this).ref_count.fetch_add(1, core::sync::atomic::Ordering::Relaxed) };
    }

    pub fn deref(this: *mut Self) {
        // TODO(port): delegate to bun_ptr::IntrusiveArc::deref (calls deinit on 0)
        // SAFETY: `this` is a live heap allocation produced by `new`.
        unsafe {
            if (*this).ref_count.fetch_sub(1, core::sync::atomic::Ordering::AcqRel) == 1 {
                drop(Box::from_raw(this));
            }
        }
    }

    pub fn acquire(&mut self) -> &mut StreamBuffer {
        self.mutex.lock();
        // PORT NOTE: reshaped for borrowck — Zig returns &this.buffer while the
        // mutex stays locked until `release()`. Phase B may want a guard type.
        &mut self.buffer
    }

    pub fn release(&mut self) {
        self.mutex.unlock();
    }

    /// Should only be called in the main thread and before scheduling it to the http thread
    pub fn set_drain_callback<T>(&mut self, callback: fn(*mut T), context: *mut T) {
        self.callback = Some(Callback::init(callback, context));
    }

    pub fn clear_drain_callback(&mut self) {
        self.callback = None;
    }

    /// This is exclusively called from the http thread.
    /// Buffer should be acquired before calling this.
    pub fn report_drain(&self) {
        if self.buffer.is_empty() {
            if let Some(callback) = &self.callback {
                callback.call();
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/ThreadSafeStreamBuffer.zig (61 lines)
//   confidence: medium
//   todos:      3
//   notes:      intrusive ThreadSafeRefCount stubbed pending bun_ptr::IntrusiveArc; acquire/release split-lock may want a guard in Phase B
// ──────────────────────────────────────────────────────────────────────────
