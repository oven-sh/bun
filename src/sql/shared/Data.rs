use bun_collections::{BoundedArray, VecExt};
use bun_core::ZStr;
use bun_ptr::RawSlice;

pub type InlineStorage = BoundedArray<u8, 15>;

/// Represents data that can be either owned or temporary
pub enum Data {
    Owned(Vec<u8>),
    // TODO(port): lifetime — `Temporary` borrows external bytes (see `substring`, which
    // returns a `Data` aliasing `self`). Stored as a `RawSlice` (encapsulated fat
    // pointer; safe `.slice()` projection under the borrowed-backing-outlives-holder
    // invariant). Revisit whether a `<'a>` on `Data` is acceptable in Phase B.
    Temporary(RawSlice<u8>),
    InlineStorage(InlineStorage),
    Empty,
}

impl Default for Data {
    fn default() -> Self {
        Data::Empty
    }
}

impl Data {
    pub const EMPTY: Data = Data::Empty;

    #[inline]
    pub const fn empty() -> Data {
        Data::Empty
    }

    pub fn create(possibly_inline_bytes: &[u8]) -> Result<Data, bun_alloc::AllocError> {
        if possibly_inline_bytes.is_empty() {
            return Ok(Data::Empty);
        }

        if possibly_inline_bytes.len() <= 15 {
            // BoundedArray has private fields; build via from_slice (capacity is 15).
            let inline_storage =
                InlineStorage::from_slice(possibly_inline_bytes).expect("len <= 15 checked above");
            return Ok(Data::InlineStorage(inline_storage));
        }
        Ok(Data::Owned(possibly_inline_bytes.to_vec()))
    }

    pub fn to_owned(self) -> Result<Vec<u8>, bun_alloc::AllocError> {
        match self {
            Data::Owned(owned) => Ok(owned),
            Data::Temporary(temporary) => Ok(temporary.slice().to_vec()),
            Data::Empty => Ok(Vec::new()),
            Data::InlineStorage(inline_storage) => Ok(inline_storage.as_slice().to_vec()),
        }
    }

    /// Zero bytes before deinit
    /// Generally, for security reasons.
    pub fn zdeinit(&mut self) {
        match self {
            Data::Owned(owned) => {
                // Zero bytes before deinit — Zig `bun.freeSensitive`.
                let s = owned.slice_mut();
                // SAFETY: `s` is an exclusive `&mut [u8]`; `len` bytes valid for writes.
                unsafe { bun_alloc::secure_zero(s.as_mut_ptr(), s.len()) };
                owned.clear_and_free();
            }
            Data::Temporary(_) => {}
            Data::Empty => {}
            Data::InlineStorage(_) => {}
        }
        // After clear_and_free the Vec is already in an empty (cap=0) state,
        // so dropping it via the assignment below is a no-op — no double-free.
        *self = Data::Empty;
    }

    pub fn slice(&self) -> &[u8] {
        match self {
            Data::Owned(owned) => owned.slice(),
            Data::Temporary(temporary) => temporary.slice(),
            Data::Empty => b"",
            Data::InlineStorage(inline_storage) => inline_storage.as_slice(),
        }
    }

    pub fn substring(&self, start_index: usize, end_index: usize) -> Data {
        match self {
            Data::Owned(owned) => {
                Data::Temporary(RawSlice::new(&owned.slice()[start_index..end_index]))
            }
            Data::Temporary(temporary) => {
                Data::Temporary(RawSlice::new(&temporary.slice()[start_index..end_index]))
            }
            Data::Empty => Data::Empty,
            Data::InlineStorage(inline_storage) => Data::Temporary(RawSlice::new(
                &inline_storage.as_slice()[start_index..end_index],
            )),
        }
    }

    pub fn slice_z(&self) -> &ZStr {
        let s = self.slice();
        if s.is_empty() {
            return ZStr::EMPTY;
        }
        // SAFETY: caller invariant — bytes are NUL-terminated at `len`.
        unsafe { ZStr::from_raw(s.as_ptr(), s.len()) }
    }
}

// PORT NOTE: Zig `deinit` freed `Owned`'s buffer. In Rust, `Vec<T>: Drop`
// already frees on drop, so an explicit `impl Drop for Data` is redundant (and
// would prevent moving fields out in `to_owned`). The other variants own no heap.

// ported from: src/sql/shared/Data.zig
