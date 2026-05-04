use bun_collections::{BabyList, BoundedArray};
use bun_str::ZStr;

pub type InlineStorage = BoundedArray<u8, 15>;

/// Represents data that can be either owned or temporary
pub enum Data {
    Owned(BabyList<u8>),
    // TODO(port): lifetime — `Temporary` borrows external bytes (see `substring`, which
    // returns a `Data` aliasing `self`). Stored as a raw fat pointer in Phase A; revisit
    // whether a `<'a>` on `Data` is acceptable in Phase B.
    Temporary(*const [u8]),
    InlineStorage(InlineStorage),
    Empty,
}

impl Data {
    pub const EMPTY: Data = Data::Empty;

    pub fn create(possibly_inline_bytes: &[u8]) -> Result<Data, bun_alloc::AllocError> {
        if possibly_inline_bytes.is_empty() {
            return Ok(Data::Empty);
        }

        if possibly_inline_bytes.len() <= 15 {
            let mut inline_storage = InlineStorage::default();
            // TODO(port): assumes `BoundedArray<u8, N>` exposes `buffer: [u8; N]` and `len` fields
            inline_storage.buffer[..possibly_inline_bytes.len()]
                .copy_from_slice(possibly_inline_bytes);
            inline_storage.len = possibly_inline_bytes.len() as _;
            return Ok(Data::InlineStorage(inline_storage));
        }
        Ok(Data::Owned(BabyList::from_owned_slice(Box::<[u8]>::from(
            possibly_inline_bytes,
        ))))
    }

    pub fn to_owned(self) -> Result<BabyList<u8>, bun_alloc::AllocError> {
        match self {
            Data::Owned(owned) => Ok(owned),
            Data::Temporary(temporary) => {
                // SAFETY: caller guarantees the borrowed slice is still valid (same as Zig)
                let slice = unsafe { &*temporary };
                Ok(BabyList::from_owned_slice(Box::<[u8]>::from(slice)))
            }
            Data::Empty => Ok(BabyList::empty()),
            Data::InlineStorage(inline_storage) => Ok(BabyList::from_owned_slice(
                Box::<[u8]>::from(inline_storage.as_slice()),
            )),
        }
    }

    /// Zero bytes before deinit
    /// Generally, for security reasons.
    pub fn zdeinit(&mut self) {
        match self {
            Data::Owned(owned) => {
                // Zero bytes before deinit
                // TODO(port): `bun.freeSensitive` — assumed `bun_alloc::free_sensitive`
                bun_alloc::free_sensitive(owned.slice_mut());
                owned.deinit();
            }
            Data::Temporary(_) => {}
            Data::Empty => {}
            Data::InlineStorage(_) => {}
        }
    }

    pub fn slice(&self) -> &[u8] {
        match self {
            Data::Owned(owned) => owned.slice(),
            // SAFETY: caller guarantees the borrowed slice is still valid (same as Zig)
            Data::Temporary(temporary) => unsafe { &**temporary },
            Data::Empty => b"",
            Data::InlineStorage(inline_storage) => inline_storage.as_slice(),
        }
    }

    pub fn substring(&self, start_index: usize, end_index: usize) -> Data {
        match self {
            Data::Owned(owned) => {
                Data::Temporary(&owned.slice()[start_index..end_index] as *const [u8])
            }
            Data::Temporary(temporary) => {
                // SAFETY: caller guarantees the borrowed slice is still valid (same as Zig)
                let s = unsafe { &**temporary };
                Data::Temporary(&s[start_index..end_index] as *const [u8])
            }
            Data::Empty => Data::Empty,
            Data::InlineStorage(inline_storage) => {
                Data::Temporary(&inline_storage.as_slice()[start_index..end_index] as *const [u8])
            }
        }
    }

    pub fn slice_z(&self) -> &ZStr {
        match self {
            Data::Owned(owned) => {
                // SAFETY: caller invariant — owned bytes are NUL-terminated at `len`
                unsafe { ZStr::from_raw(owned.slice().as_ptr(), owned.len() as usize) }
            }
            Data::Temporary(temporary) => {
                // SAFETY: caller invariant — borrowed bytes are NUL-terminated at `len`
                let s = unsafe { &**temporary };
                unsafe { ZStr::from_raw(s.as_ptr(), s.len()) }
            }
            Data::Empty => ZStr::EMPTY,
            Data::InlineStorage(inline_storage) => {
                let s = inline_storage.as_slice();
                // SAFETY: caller invariant — inline bytes are NUL-terminated at `len`
                unsafe { ZStr::from_raw(s.as_ptr(), s.len()) }
            }
        }
    }
}

impl Drop for Data {
    fn drop(&mut self) {
        match self {
            Data::Owned(owned) => owned.clear_and_free(),
            Data::Temporary(_) => {}
            Data::Empty => {}
            Data::InlineStorage(_) => {}
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/shared/Data.zig (94 lines)
//   confidence: medium
//   todos:      3
//   notes:      `Temporary` stored as raw `*const [u8]` (self-borrowing via `substring`); BabyList<u8>/BoundedArray API surface assumed; `bun.freeSensitive` mapped to `bun_alloc::free_sensitive`.
// ──────────────────────────────────────────────────────────────────────────
