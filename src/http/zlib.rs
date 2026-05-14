use bun_core::MutableString;
use bun_zlib::{ZlibError, ZlibReaderArrayList};

// PORT NOTE: Zig used `bun.ObjectPool(MutableString, initMutableString, false, 4)`.
// `MutableString` already has an `ObjectPoolType` impl in `bun_collections` (with
// `init2048`); a `#[repr(transparent)]` newtype gives this pool its own
// `init_empty` constructor without colliding.
mod buffer_pool {
    use super::*;
    use bun_collections::ObjectPoolType;

    #[repr(transparent)]
    pub struct PooledMutableString(pub MutableString);

    impl core::ops::Deref for PooledMutableString {
        type Target = MutableString;
        #[inline]
        fn deref(&self) -> &MutableString {
            &self.0
        }
    }
    impl core::ops::DerefMut for PooledMutableString {
        #[inline]
        fn deref_mut(&mut self) -> &mut MutableString {
            &mut self.0
        }
    }

    impl ObjectPoolType for PooledMutableString {
        #[inline]
        fn init() -> Self {
            PooledMutableString(MutableString::init_empty())
        }
        #[inline]
        fn reset(&mut self) {
            self.0.reset();
        }
    }

    // Zig: `ObjectPool(MutableString, initMutableString, false, 4)` —
    // `threadsafe = false` ⇒ `global` storage mode.
    bun_collections::object_pool!(pub BufferPool: PooledMutableString, global, 4);

    /// RAII guard derefing to a pooled `MutableString`; returned to the pool on
    /// `Drop`. (Currently no callers; kept for parity with the Zig API.)
    pub fn get() -> bun_collections::PoolGuard<PooledMutableString> {
        BufferPool::get()
    }
}
pub use buffer_pool::get;

pub fn decompress(compressed_data: &[u8], output: &mut MutableString) -> Result<(), ZlibError> {
    let mut reader = ZlibReaderArrayList::init_with_options_and_list_allocator(
        compressed_data,
        &mut output.list,
        bun_zlib::Options {
            window_bits: 15 + 32,
            ..Default::default()
        },
    )?;
    reader.read_all(true)?;
    Ok(())
}

// ported from: src/http/zlib.zig
