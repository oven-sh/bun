use core::ffi::c_void;
use core::marker::PhantomData;

/// Logically a u49. Rust has no native u49, so we carry it in a u64 and mask.
pub type AddressableSize = u64;

/// Zig: `packed struct(u64) { _ptr: u49, data: u15 }`
/// Packed-struct field order in Zig is LSB-first, so:
///   bits  0..49 → `_ptr`
///   bits 49..64 → `data`
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct TaggedPtr(u64);

impl TaggedPtr {
    /// Logically a u15.
    pub type Tag = u16;

    const ADDR_BITS: u32 = 49;
    const ADDR_MASK: u64 = (1u64 << Self::ADDR_BITS) - 1;
    const TAG_MASK: u16 = (1u16 << 15) - 1;

    #[inline]
    pub fn init<T>(ptr: *const T, data: Self::Tag) -> TaggedPtr {
        // Zig's `if (Ptr == @TypeOf(null))` branch is subsumed: a null `*const T`
        // yields address 0 below. The `@typeInfo(Ptr) != .pointer` compile error
        // is enforced by `*const T` in the signature.
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
    fn set_ptr_bits(&mut self, value: AddressableSize) {
        self.0 = (self.0 & !Self::ADDR_MASK) | (value & Self::ADDR_MASK);
    }

    #[inline]
    pub fn data(self) -> Self::Tag {
        (self.0 >> Self::ADDR_BITS) as Self::Tag
    }

    #[inline]
    pub fn get<Type>(self) -> *mut Type {
        // SAFETY: caller asserts the stored address points to a live `Type`.
        // @ptrFromInt(@intCast(this._ptr))
        self.ptr_bits() as usize as *mut Type
    }

    #[inline]
    pub fn to(self) -> *mut c_void {
        // @ptrFromInt(@bitCast(this)) — note: includes the tag bits in the high
        // word, matching Zig. This is intentional: round-tripping through
        // `*anyopaque` preserves the tag.
        self.0 as usize as *mut c_void
    }
}

// Zig `from(val: anytype)` dispatches on @TypeOf(val):
//   f64 | i64 | u64        => @bitCast(val)
//   ?*anyopaque|*anyopaque => @bitCast(@intFromPtr(val))
impl From<u64> for TaggedPtr {
    #[inline]
    fn from(val: u64) -> Self {
        TaggedPtr(val)
    }
}
impl From<i64> for TaggedPtr {
    #[inline]
    fn from(val: i64) -> Self {
        // SAFETY: same-size POD bitcast
        TaggedPtr(unsafe { core::mem::transmute::<i64, u64>(val) })
    }
}
impl From<f64> for TaggedPtr {
    #[inline]
    fn from(val: f64) -> Self {
        TaggedPtr(val.to_bits())
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
// Zig builds this with heavy comptime reflection: `@typeName`, `@Type` to mint
// an enum, `@hasField`/`@field` for membership checks, and `inline for` over a
// type tuple. None of that exists in Rust. We model it with two traits:
//
//   - `TypeList`      : implemented for the tuple `(T1, T2, ...)`; carries the
//                       variant count and the tag→name table.
//   - `UnionMember<L>`: implemented for each `Ti` against its list `L`; carries
//                       that type's tag value (1024 - index, matching Zig).
//
// `assert_type` / `@hasField` become a `T: UnionMember<Ts>` bound — the compile
// error is the trait-bound failure.
//
// Tag values are assigned exactly as Zig does: `1024 - i` for index `i`. Zig
// also reifies a non-exhaustive `enum(u15)` for the tag; we keep the raw u15
// and expose `tag()` as the integer (callers that need an enum can define one
// per instantiation).

/// Implemented for the tuple of types passed to `TaggedPtrUnion<(...)>`.
pub trait TypeList {
    const LEN: usize;
    /// `@intFromEnum(@field(Tag, @typeName(Types[Types.len - 1])))` = 1024 - (LEN-1)
    const MIN_TAG: TaggedPtr::Tag;
    /// `@intFromEnum(@field(Tag, @typeName(Types[0])))` = 1024
    const MAX_TAG: TaggedPtr::Tag = 1024;
    /// Runtime tag → `@typeName` of the variant, or `None` if not a member.
    fn type_name_from_tag(tag: TaggedPtr::Tag) -> Option<&'static str>;
}

/// `T: UnionMember<Ts>` ⇔ `T` is one of the types in the list `Ts`.
/// Replaces Zig's `assert_type` / `@hasField(Tag, @typeName(Type))`.
pub trait UnionMember<Ts: TypeList> {
    const TAG: TaggedPtr::Tag;
    const NAME: &'static str;
}

/// Generates `TypeList` for `($($T,)*)` and `UnionMember<($($T,)*)>` for each
/// `$T`, assigning tags `1024 - i` to match Zig's `TagTypeEnumWithTypeMap`.
// TODO(port): proc-macro — Zig uses `@typeName` for both the tag enum field
// name and the `name` string. `stringify!($T)` is the closest analogue but
// won't match Zig's fully-qualified `@typeName` output; Phase B should confirm
// no caller depends on the exact string.
#[macro_export]
macro_rules! impl_tagged_ptr_union {
    ($($T:ty),+ $(,)?) => {
        impl $crate::tagged_pointer::TypeList for ($($T,)+) {
            const LEN: usize = $crate::impl_tagged_ptr_union!(@count $($T),+);
            const MIN_TAG: $crate::tagged_pointer::TaggedPtr::Tag =
                1024 - (Self::LEN as $crate::tagged_pointer::TaggedPtr::Tag - 1);
            fn type_name_from_tag(
                tag: $crate::tagged_pointer::TaggedPtr::Tag,
            ) -> Option<&'static str> {
                $crate::impl_tagged_ptr_union!(@names tag, 0, $($T),+);
                None
            }
        }
        $crate::impl_tagged_ptr_union!(@members ($($T,)+), 0, $($T),+);
    };
    (@count $H:ty $(, $T:ty)*) => { 1usize $(+ $crate::impl_tagged_ptr_union!(@count $T))* };
    (@count) => { 0usize };
    (@names $tag:ident, $i:expr, $H:ty $(, $T:ty)*) => {
        if $tag == (1024 - $i) { return Some(::core::stringify!($H)); }
        $crate::impl_tagged_ptr_union!(@names $tag, $i + 1, $($T),*);
    };
    (@names $tag:ident, $i:expr,) => {};
    (@members $Ts:ty, $i:expr, $H:ty $(, $T:ty)*) => {
        impl $crate::tagged_pointer::UnionMember<$Ts> for $H {
            const TAG: $crate::tagged_pointer::TaggedPtr::Tag = 1024 - $i;
            const NAME: &'static str = ::core::stringify!($H);
        }
        $crate::impl_tagged_ptr_union!(@members $Ts, $i + 1, $($T),*);
    };
    (@members $Ts:ty, $i:expr,) => {};
}

#[repr(transparent)]
pub struct TaggedPtrUnion<Ts: TypeList> {
    pub repr: TaggedPtr,
    _types: PhantomData<Ts>,
}

impl<Ts: TypeList> Clone for TaggedPtrUnion<Ts> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<Ts: TypeList> Copy for TaggedPtrUnion<Ts> {}

impl<Ts: TypeList> TaggedPtrUnion<Ts> {
    pub type TagInt = TaggedPtr::Tag;

    pub const NULL: Self = Self { repr: TaggedPtr(0), _types: PhantomData };

    pub fn clear(&mut self) {
        *self = Self::NULL;
    }

    // `typeFromTag(comptime the_tag) type` has no Rust equivalent (cannot
    // return a type from a const value). Callers must name the type directly.
    // TODO(port): if any callsite needs this, it becomes a trait associated type.

    pub fn type_name_from_tag(the_tag: Self::TagInt) -> Option<&'static str> {
        Ts::type_name_from_tag(the_tag)
    }

    pub fn type_name(self) -> Option<&'static str> {
        // Zig: @tagName(this.tag()) — on a non-exhaustive enum this is defined
        // for known fields. We return None for unknown tags to match the
        // optional return type the Zig caller sees.
        Ts::type_name_from_tag(self.repr.data())
    }

    #[inline]
    pub fn get<Type: UnionMember<Ts>>(self) -> Option<*mut Type> {
        if self.is::<Type>() { Some(self.as_unchecked::<Type>()) } else { None }
    }

    #[inline]
    pub fn tag(self) -> Self::TagInt {
        // Zig returns the reified enum; we return the raw integer.
        self.repr.data()
    }

    /// Zig `case(comptime Type) Tag` → the tag constant for `Type`.
    #[inline]
    pub const fn case<Type: UnionMember<Ts>>() -> Self::TagInt {
        Type::TAG
    }

    /// unsafely cast a tagged pointer to a specific type, without checking that it's really that type
    // PORT NOTE: Zig name is `as`, which is a Rust keyword.
    #[inline]
    pub fn as_unchecked<Type: UnionMember<Ts>>(self) -> *mut Type {
        self.repr.get::<Type>()
    }

    #[inline]
    pub fn set_uintptr(&mut self, value: AddressableSize) {
        self.repr.set_ptr_bits(value);
    }

    #[inline]
    pub fn as_uintptr(self) -> AddressableSize {
        self.repr.ptr_bits()
    }

    #[inline]
    pub fn is<Type: UnionMember<Ts>>(self) -> bool {
        self.repr.data() == Type::TAG
    }

    pub fn set<Type: UnionMember<Ts>>(&mut self, ptr: *const Type) {
        *self = Self::init(ptr);
    }

    #[inline]
    pub fn is_valid_ptr(ptr: Option<*mut c_void>) -> bool {
        Self::from(ptr).is_valid()
    }

    #[inline]
    pub fn is_valid(self) -> bool {
        // switch (data) { MIN_TAG...MAX_TAG => true, else => false }
        let d = self.repr.data();
        d >= Ts::MIN_TAG && d <= Ts::MAX_TAG
    }

    #[inline]
    pub fn from(ptr: Option<*mut c_void>) -> Self {
        Self { repr: TaggedPtr::from(ptr), _types: PhantomData }
    }

    #[inline]
    pub fn ptr(self) -> *mut c_void {
        self.repr.to()
    }

    #[inline]
    pub fn ptr_unsafe(self) -> *mut c_void {
        // @setRuntimeSafety(false) is a no-op in Rust release; keep the fn for
        // API parity.
        self.repr.to()
    }

    #[inline]
    pub fn init<Type: UnionMember<Ts>>(ptr: *const Type) -> Self {
        // Zig splits `init` (infers Type via std.meta.Child) and `initWithType`.
        // In Rust the generic param IS the inferred child type, so both collapse.
        Self::init_with_type::<Type>(ptr)
    }

    #[inline]
    pub fn init_with_type<Type: UnionMember<Ts>>(ptr: *const Type) -> Self {
        // there will be a compiler error if the passed in type doesn't exist in the enum
        Self { repr: TaggedPtr::init(ptr, Type::TAG), _types: PhantomData }
    }

    #[inline]
    pub fn is_null(self) -> bool {
        self.repr.ptr_bits() == 0
    }

    // TODO(port): `call(comptime fn_name, args, comptime Ret)` dispatches by
    // tag and invokes `@field(entry.ty, fn_name)` reflectively. Rust cannot
    // look up a method by string at compile time. Port pattern: define a trait
    // with the target method, bound every `Ti: TheTrait`, and have callers
    // `match self.tag()` (or use a per-instantiation `dispatch!` macro). Each
    // callsite of `.call(...)` needs to be rewritten in Phase B.
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ptr/tagged_pointer.zig (238 lines)
//   confidence: medium
//   todos:      3
//   notes:      comptime type-tuple reflection replaced by TypeList/UnionMember traits + impl_tagged_ptr_union! macro; `call()` left unported (needs per-callsite trait dispatch); inherent assoc type `pub type Tag` requires nightly or hoist to module level in Phase B
// ──────────────────────────────────────────────────────────────────────────
