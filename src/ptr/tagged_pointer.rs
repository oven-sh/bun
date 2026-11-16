use core::ffi::c_void;

/// Logically a u49. Rust has no native u49, so we carry it in a u64 and mask.
pub(crate) type AddressableSize = u64;

/// `TaggedPtr::Tag` — logically u15, carried in u16. (Inherent assoc types are nightly; hoisted here.)
pub(crate) type TagType = u16;
/// Bit layout:
///   bits  0..49 → `_ptr`
///   bits 49..64 → `data`
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct TaggedPtr(u64);

impl TaggedPtr {
    /// Logically a u15.
    // pub type Tag = u16; → hoisted to module-level TagType (inherent assoc types are nightly-only)

    const ADDR_BITS: u32 = 49;
    const ADDR_MASK: u64 = (1u64 << Self::ADDR_BITS) - 1;
    const TAG_MASK: u16 = (1u16 << 15) - 1;

    #[inline]
    pub fn init<T>(ptr: *const T, data: TagType) -> TaggedPtr {
        // A null `*const T` yields address 0 below.
        let address = ptr as usize;
        TaggedPtr(
            (address as u64 & Self::ADDR_MASK) // @truncate to u49
                | ((data as u64 & Self::TAG_MASK as u64) << Self::ADDR_BITS),
        )
    }

    #[inline]
    fn ptr_bits(self) -> AddressableSize {
        self.0 & Self::ADDR_MASK
    }

    #[inline]
    pub fn data(self) -> TagType {
        (self.0 >> Self::ADDR_BITS) as TagType
    }

    #[inline]
    pub fn get<Type>(self) -> *mut Type {
        // SAFETY: caller asserts the stored address points to a live `Type`.
        self.ptr_bits() as usize as *mut Type
    }

    #[inline]
    pub fn to(self) -> *mut c_void {
        // Note: includes the tag bits in the high word. This is intentional:
        // round-tripping through `*anyopaque` preserves the tag.
        self.0 as usize as *mut c_void
    }
}

impl From<u64> for TaggedPtr {
    #[inline]
    fn from(val: u64) -> Self {
        TaggedPtr(val)
    }
}
impl From<*mut c_void> for TaggedPtr {
    #[inline]
    fn from(val: *mut c_void) -> Self {
        TaggedPtr(val as usize as u64)
    }
}
