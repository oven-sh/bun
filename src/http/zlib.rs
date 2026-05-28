use bun_core::MutableString;

// PORT NOTE: Zig used `bun.ObjectPool(MutableString, initMutableString, false, 4)` and
// recovered the node via `container_of`. `MutableString` is a foreign type so we
// cannot impl `ObjectPoolType` for it directly (orphan rule); a `#[repr(transparent)]`
// newtype lets us cast `*mut PooledMutableString` ↔ `*mut MutableString` at the API
// boundary.
mod buffer_pool {
    use super::*;
    use bun_collections::ObjectPoolType;

    #[repr(transparent)]
    pub(super) struct PooledMutableString(pub MutableString);

    impl ObjectPoolType for PooledMutableString {
        const INIT: Option<fn() -> Result<Self, bun_core::Error>> =
            Some(|| Ok(PooledMutableString(MutableString::init_empty())));
        #[inline]
        fn reset(&mut self) {
            self.0.reset();
        }
    }

    // Zig: `ObjectPool(MutableString, initMutableString, false, 4)` —
    // `threadsafe = false` ⇒ `global` storage mode.
    bun_collections::object_pool!(pub BufferPool: PooledMutableString, global, 4);

    pub fn get() -> *mut MutableString {
        // TODO(port): Zig returns `*MutableString` borrowed from a pool node; consider an RAII
        // guard so callers don't hand-pair get/put.
        // SAFETY: `first()` returns a valid `*mut PooledMutableString` whose data is initialized
        // (INIT is Some); #[repr(transparent)] makes the cast to `*mut MutableString` sound.
        BufferPool::first().cast::<MutableString>()
    }

    pub fn put(mutable: &mut MutableString) {
        mutable.reset();
        // SAFETY: `mutable` was returned by `get()`; `#[repr(transparent)]`
        // makes the `MutableString → PooledMutableString` reinterpret sound.
        // `release_value` recovers the parent node via `offset_of`.
        let pooled = unsafe { &mut *std::ptr::from_mut(mutable).cast::<PooledMutableString>() };
        BufferPool::release_value(pooled);
    }
}
pub use buffer_pool::{get, put};

// ported from: src/http/zlib.zig
