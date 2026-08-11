//! Environment strings need to be copied a lot
//! So we make them reference counted
//!
//! But sometimes we use strings that are statically allocated, or are allocated
//! with a predetermined lifetime (e.g. strings in the AST). In that case we
//! don't want to incur the cost of heap allocating them and refcounting them
//!
//! So environment strings can be ref counted or borrowed slices

use core::mem::size_of;
use core::ptr::NonNull;

use super::ref_counted_str::RefCountedStr;

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum EnvStr {
    /// Memory is managed elsewhere so don't dealloc it: the `init_slice`
    /// caller keeps the bytes alive for as long as the value is read.
    Slice(NonNull<[u8]>),

    /// Dealloced by reference counting: the value stands for one of the
    /// counted refs (taken by the constructors and `ref_`, released by
    /// `deref`), so the target is live for as long as the value is used.
    Refcounted(NonNull<RefCountedStr>),
}

// `Refcounted` is encoded in the null niche of the `Slice` data pointer, so the
// enum is exactly the fat pointer, with no discriminant word added.
const _: () = assert!(size_of::<EnvStr>() == size_of::<NonNull<[u8]>>());

impl EnvStr {
    /// What every constructor returns for an empty string.
    const EMPTY: EnvStr = EnvStr::Slice(NonNull::from_ref(&[]));

    #[inline]
    pub(crate) fn init_slice(str: &[u8]) -> EnvStr {
        if str.is_empty() {
            return Self::EMPTY;
        }

        EnvStr::Slice(NonNull::from(str))
    }

    /// Same thing as `init_ref_counted` except it duplicates the passed string
    pub(crate) fn dupe_ref_counted(old_str: &[u8]) -> EnvStr {
        if old_str.is_empty() {
            return Self::EMPTY;
        }

        // Global mimalloc aborts on OOM; ownership of the duplicated bytes
        // transfers to RefCountedStr.
        let str: Box<[u8]> = Box::<[u8]>::from(old_str);
        EnvStr::Refcounted(RefCountedStr::init(str))
    }

    /// Takes ownership of the backing allocation (hands the slice to
    /// `RefCountedStr` without copying). Use [`Self::dupe_ref_counted`] to
    /// copy a borrowed slice instead.
    pub(crate) fn init_ref_counted(str: Box<[u8]>) -> EnvStr {
        if str.is_empty() {
            return Self::EMPTY;
        }

        EnvStr::Refcounted(RefCountedStr::init(str))
    }

    pub(crate) fn slice(&self) -> &[u8] {
        // NOTE: the returned slice borrows either external memory (`Slice`) or the
        // RefCountedStr buffer. Tying the return lifetime to `&self` prevents the caller from
        // conjuring `&'static [u8]` (PORTING.md §Forbidden: lifetime-extension via raw-pointer
        // deref). `EnvStr` is still `Copy`, so this is a best-effort bound — the caller is
        // responsible for keeping the backing storage alive.
        match self {
            // SAFETY: `Slice` contract above; the borrow is tied to the value being read.
            EnvStr::Slice(str) => unsafe { str.as_ref() },
            EnvStr::Refcounted(refc) => ref_counted(refc).byte_slice(),
        }
    }

    pub(crate) fn memory_cost(self) -> usize {
        let (len, divisor) = match self {
            EnvStr::Slice(str) => (str.len(), 1),
            EnvStr::Refcounted(refc) => {
                let refc = ref_counted(&refc);
                (refc.byte_slice().len(), refc.refcount.get() as usize)
            }
        };
        if divisor == 0 {
            bun_core::hint::cold();
            return 0;
        }

        len / divisor
    }

    pub fn ref_(self) {
        if let EnvStr::Refcounted(refc) = self {
            ref_counted(&refc).ref_();
        }
    }

    pub fn deref(self) {
        if let EnvStr::Refcounted(refc) = self {
            // SAFETY: `Refcounted` contract above; this releases the ref the value holds.
            unsafe { RefCountedStr::deref(refc) };
        }
    }
}

impl Default for EnvStr {
    fn default() -> Self {
        Self::EMPTY
    }
}

#[inline]
fn ref_counted(refc: &NonNull<RefCountedStr>) -> &RefCountedStr {
    // SAFETY: `EnvStr::Refcounted` contract; the borrow is tied to the value holding the ref.
    unsafe { refc.as_ref() }
}
