use core::ffi::c_void;
use core::marker::PhantomData;

/// Logically a u49. Rust has no native u49, so we carry it in a u64 and mask.
pub(crate) type AddressableSize = u64;

/// `TaggedPtr::Tag` — logically u15, carried in u16. (Inherent assoc types are nightly; hoisted here.)
pub type TagType = u16;
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
impl From<Option<*mut c_void>> for TaggedPtr {
    #[inline]
    fn from(val: Option<*mut c_void>) -> Self {
        TaggedPtr(val.map_or(0, |p| p as usize as u64))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TaggedPointerUnion
// ─────────────────────────────────────────────────────────────────────────────
//
// Modeled with two traits:
//
//   - `TypeList`      : implemented for the tuple `(T1, T2, ...)`; carries the
//                       tag range.
//   - `UnionMember<L>`: implemented for each `Ti` against its list `L`; carries
//                       that type's tag value (1024 - index).
//
// Membership checks become a `T: UnionMember<Ts>` bound — the compile error is
// the trait-bound failure.
//
// Tag values are assigned as `1024 - i` for index `i`. We keep the raw u15
// and expose `tag()` as the integer (callers that need an enum can define one
// per instantiation).

/// Implemented for the tuple of types passed to `TaggedPtrUnion<(...)>`.
pub trait TypeList {
    /// `@intFromEnum(@field(Tag, @typeName(Types[Types.len - 1])))` = 1024 - (LEN-1)
    const MIN_TAG: TagType;
    /// `@intFromEnum(@field(Tag, @typeName(Types[0])))` = 1024
    const MAX_TAG: TagType = 1024;
}

/// `T: UnionMember<Ts>` ⇔ `T` is one of the types in the list `Ts`.
pub trait UnionMember<Ts: TypeList> {
    const TAG: TagType;
}

#[repr(transparent)]
pub struct TaggedPtrUnion<Ts: TypeList> {
    repr: TaggedPtr,
    _types: PhantomData<Ts>,
}

impl<Ts: TypeList> Clone for TaggedPtrUnion<Ts> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<Ts: TypeList> Copy for TaggedPtrUnion<Ts> {}

impl<Ts: TypeList> TaggedPtrUnion<Ts> {
    // pub type TagInt → use module-level TagType

    #[inline]
    pub fn get<Type: UnionMember<Ts>>(self) -> Option<*mut Type> {
        if self.is::<Type>() {
            Some(self.as_unchecked::<Type>())
        } else {
            None
        }
    }

    #[inline]
    pub fn tag(self) -> TagType {
        self.repr.data()
    }

    /// The tag constant for `Type`.
    #[inline]
    pub const fn case<Type: UnionMember<Ts>>() -> TagType {
        Type::TAG
    }

    /// unsafely cast a tagged pointer to a specific type, without checking that it's really that type
    // `as` is a Rust keyword, hence `as_unchecked`.
    #[inline]
    pub fn as_unchecked<Type: UnionMember<Ts>>(self) -> *mut Type {
        self.repr.get::<Type>()
    }

    #[inline]
    pub fn as_uintptr(self) -> AddressableSize {
        self.repr.ptr_bits()
    }

    #[inline]
    pub fn is<Type: UnionMember<Ts>>(self) -> bool {
        self.repr.data() == Type::TAG
    }

    #[inline]
    pub fn is_valid(self) -> bool {
        // switch (data) { MIN_TAG...MAX_TAG => true, else => false }
        let d = self.repr.data();
        d >= Ts::MIN_TAG && d <= Ts::MAX_TAG
    }

    #[inline]
    pub fn from(ptr: Option<*mut c_void>) -> Self {
        Self {
            repr: TaggedPtr::from(ptr),
            _types: PhantomData,
        }
    }

    #[inline]
    pub fn ptr(self) -> *mut c_void {
        self.repr.to()
    }

    #[inline]
    pub fn init<Type: UnionMember<Ts>>(ptr: *const Type) -> Self {
        // there will be a compiler error if the passed in type doesn't exist in the enum
        Self {
            repr: TaggedPtr::init(ptr, Type::TAG),
            _types: PhantomData,
        }
    }

    #[inline]
    pub fn is_null(self) -> bool {
        self.repr.ptr_bits() == 0
    }
}
