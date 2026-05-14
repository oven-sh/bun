use core::cell::Cell;

bun_core::declare_scope!(RefCountedEnvStr, hidden);

pub struct RefCountedStr {
    pub(super) refcount: Cell<u32>,
    // PORT NOTE: Zig stored `[*]const u8` + `u32` len; Rust holds the owning
    // `Box<[u8]>` directly so `byte_slice`/`free_str` need no raw-parts rebuild.
    data: Box<[u8]>,
}

impl RefCountedStr {
    // PORT NOTE: Zig `init` takes a `[]const u8` whose backing storage was allocated
    // with `bun.default_allocator` and transfers ownership of it. In Rust we accept a
    // `Box<[u8]>` (global mimalloc) and store it directly.
    pub fn init(slice: Box<[u8]>) -> *mut RefCountedStr {
        bun_core::scoped_log!(RefCountedEnvStr, "init: {}", bstr::BStr::new(&*slice));
        // bun.handleOom(bun.default_allocator.create(...)) → Box::new (aborts on OOM)
        bun_core::heap::into_raw(Box::new(RefCountedStr {
            refcount: Cell::new(1),
            data: slice,
        }))
    }

    pub fn byte_slice(&self) -> &[u8] {
        &self.data
    }

    pub fn ref_(&self) {
        self.refcount.set(self.refcount.get() + 1);
    }

    // PORT NOTE: takes `*mut Self` because reaching refcount==0 deallocates the
    // `Box<Self>` that backs `this`; a `&self` borrow would dangle across that drop.
    pub unsafe fn deref(this: *mut RefCountedStr) {
        // SAFETY: caller guarantees `this` was produced by `init` and is still
        // live; on hitting 0, `this` is uniquely owned and Box-allocated.
        unsafe {
            let rc = &(*this).refcount;
            rc.set(rc.get() - 1);
            if rc.get() == 0 {
                Self::deinit(this);
            }
        }
    }

    // PORT NOTE: not `impl Drop` — this is the intrusive-rc self-destroy path
    // (`bun.default_allocator.destroy(this)`), which must deallocate the Box backing `self`.
    unsafe fn deinit(this: *mut RefCountedStr) {
        // SAFETY: refcount just reached 0; `this` is uniquely owned and was Box-allocated in `init`.
        unsafe {
            bun_core::scoped_log!(
                RefCountedEnvStr,
                "deinit: {}",
                bstr::BStr::new((*this).byte_slice())
            );
            (*this).free_str();
            drop(bun_core::heap::take(this));
        }
    }

    fn free_str(&mut self) {
        // Dropping the old `Box<[u8]>` returns its allocation; an empty box
        // owns no heap storage so the `len == 0` early-out is preserved.
        self.data = Box::default();
    }
}

impl Default for RefCountedStr {
    fn default() -> Self {
        Self {
            refcount: Cell::new(1),
            data: Box::default(),
        }
    }
}

// ported from: src/shell/RefCountedStr.zig
