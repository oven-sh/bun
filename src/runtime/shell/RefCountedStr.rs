use core::cell::Cell;
use core::ptr;

bun_core::declare_scope!(RefCountedEnvStr, hidden);

pub struct RefCountedStr {
    pub(super) refcount: Cell<u32>,
    len: u32,
    ptr: *const u8,
}

impl RefCountedStr {
    // PORT NOTE: Zig `init` takes a `[]const u8` whose backing storage was allocated
    // with `bun.default_allocator` and transfers ownership of it. In Rust we accept a
    // `Box<[u8]>` (global mimalloc) and decompose it into raw ptr+len to match field layout.
    pub fn init(slice: Box<[u8]>) -> *mut RefCountedStr {
        bun_core::scoped_log!(RefCountedEnvStr, "init: {}", bstr::BStr::new(&*slice));
        let len = u32::try_from(slice.len()).expect("int cast");
        let ptr = bun_core::heap::leak(slice).cast::<u8>().cast_const();
        // bun.handleOom(bun.default_allocator.create(...)) → Box::new (aborts on OOM)
        bun_core::heap::leak(Box::new(RefCountedStr {
            refcount: Cell::new(1),
            len,
            ptr,
        }))
    }

    pub fn byte_slice(&self) -> &[u8] {
        if self.len == 0 {
            return b"";
        }
        // SAFETY: `ptr` points to `len` bytes owned by this struct (set in `init`,
        // freed only in `free_str` when refcount hits 0).
        unsafe { core::slice::from_raw_parts(self.ptr, self.len as usize) }
    }

    pub fn ref_(&self) {
        self.refcount.set(self.refcount.get() + 1);
    }

    // PORT NOTE: takes `*mut Self` because reaching refcount==0 deallocates the
    // `Box<Self>` that backs `this`; a `&self` borrow would dangle across that drop.
    pub unsafe fn deref(this: *mut RefCountedStr) {
        // SAFETY: caller guarantees `this` was produced by `init` and is still live.
        let rc = unsafe { &(*this).refcount };
        rc.set(rc.get() - 1);
        if rc.get() == 0 {
            // SAFETY: refcount reached 0; `this` is uniquely owned and Box-allocated by `init`.
            unsafe { Self::deinit(this) };
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
        if self.len == 0 {
            return;
        }
        // SAFETY: `ptr`/`len` were produced from `Box::<[u8]>::into_raw` in `init`;
        // reconstructing the Box here returns ownership to the global allocator.
        unsafe {
            drop(bun_core::heap::take(ptr::slice_from_raw_parts_mut(
                self.ptr.cast_mut(),
                self.len as usize,
            )));
        }
        self.ptr = ptr::null();
        self.len = 0;
    }
}

impl Default for RefCountedStr {
    fn default() -> Self {
        Self {
            refcount: Cell::new(1),
            len: 0,
            ptr: ptr::null(),
        }
    }
}

// ported from: src/shell/RefCountedStr.zig
