// ── GenericIndex ──────────────────────────────────────────────────────────
// Port of `bun.GenericIndex(backing_int, uid)` (bun.zig:3513). Zig used a
// distinct enum-per-uid for nominal typing; Rust gets that via a phantom
// marker. `MAX` is reserved as the "none" sentinel for `Optional`.
//
// NOTE on const-ness: hand-rolled monomorphic sites used `const fn init/get`.
// The generic impl cannot be `const fn` on stable (trait-bound `I::NULL_VALUE`
// comparison is not const-evaluable). Audited: zero call sites use `init`/`get`
// in const context, so dropping `const` is a no-op.
#[repr(transparent)]
pub struct GenericIndex<I, M = ()>(I, core::marker::PhantomData<M>);

impl<I: Copy, M> Clone for GenericIndex<I, M> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<I: Copy, M> Copy for GenericIndex<I, M> {}
impl<I: PartialEq, M> PartialEq for GenericIndex<I, M> {
    #[inline]
    fn eq(&self, o: &Self) -> bool {
        self.0 == o.0
    }
}
impl<I: Eq, M> Eq for GenericIndex<I, M> {}
impl<I: core::hash::Hash, M> core::hash::Hash for GenericIndex<I, M> {
    #[inline]
    fn hash<H: core::hash::Hasher>(&self, h: &mut H) {
        self.0.hash(h)
    }
}
impl<I: core::fmt::Display, M> core::fmt::Display for GenericIndex<I, M> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.0.fmt(f)
    }
}
impl<I: core::fmt::Debug, M> core::fmt::Debug for GenericIndex<I, M> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.0.fmt(f)
    }
}
/// `Default` = index 0 (matches the hand-rolled `#[derive(Default)]` newtypes
/// this replaced). NOT the `Optional::none` sentinel.
impl<I: Default, M> Default for GenericIndex<I, M> {
    #[inline]
    fn default() -> Self {
        Self(I::default(), core::marker::PhantomData)
    }
}

impl<I: GenericIndexInt, M> GenericIndex<I, M> {
    /// Prefer over a raw cast — asserts `int != MAX` (would alias `.none`).
    #[inline]
    pub fn init(int: I) -> Self {
        debug_assert!(
            int != I::NULL_VALUE,
            "GenericIndex::init: maxInt is reserved for Optional::none"
        );
        Self(int, core::marker::PhantomData)
    }
    #[inline]
    pub fn get(self) -> I {
        debug_assert!(
            self.0 != I::NULL_VALUE,
            "GenericIndex::get: corrupted (== none sentinel)"
        );
        self.0
    }
    /// `get()` widened to `usize` for slice indexing — covers the common
    /// `idx.get() as usize` site shape.
    #[inline]
    pub fn get_usize(self) -> usize {
        I::to_usize(self.get())
    }
    /// `init()` from a `usize` source (Vec length etc.). Debug-panics on
    /// truncation, mirroring Zig `@intCast`.
    #[inline]
    pub fn from_usize(n: usize) -> Self {
        Self::init(I::from_usize(n))
    }
    #[inline]
    pub fn to_optional(self) -> GenericIndexOptional<I, M> {
        GenericIndexOptional(self.0, core::marker::PhantomData)
    }
    #[inline]
    pub fn sort_fn_asc(_: (), a: &Self, b: &Self) -> bool {
        a.0 < b.0
    }
}
impl<I: GenericIndexInt, M> GenericIndexOptional<I, M> {
    #[inline]
    pub fn is_none(self) -> bool {
        self.0 == I::NULL_VALUE
    }
    #[inline]
    pub fn is_some(self) -> bool {
        !self.is_none()
    }
}

/// `GenericIndex::Optional` — `MAX` is `none`.
#[repr(transparent)]
pub struct GenericIndexOptional<I, M = ()>(I, core::marker::PhantomData<M>);
impl<I: Copy, M> Clone for GenericIndexOptional<I, M> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<I: Copy, M> Copy for GenericIndexOptional<I, M> {}
impl<I: PartialEq, M> PartialEq for GenericIndexOptional<I, M> {
    #[inline]
    fn eq(&self, o: &Self) -> bool {
        self.0 == o.0
    }
}
impl<I: Eq, M> Eq for GenericIndexOptional<I, M> {}
impl<I: core::fmt::Debug, M> core::fmt::Debug for GenericIndexOptional<I, M> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.0.fmt(f)
    }
}
impl<I: GenericIndexInt, M> GenericIndexOptional<I, M> {
    pub const NONE: Self = Self(I::NULL_VALUE, core::marker::PhantomData);
    #[inline]
    pub fn some(i: GenericIndex<I, M>) -> Self {
        i.to_optional()
    }
    /// Alias for `unwrap()` matching the local-newtype API that pre-existed in
    /// `bun_bundler::output_file::IndexOptional`.
    #[inline]
    pub fn get(self) -> Option<GenericIndex<I, M>> {
        self.unwrap()
    }
    #[inline]
    pub fn init(maybe: Option<I>) -> Self {
        match maybe {
            Some(i) => GenericIndex::<I, M>::init(i).to_optional(),
            None => Self::NONE,
        }
    }
    #[inline]
    pub fn unwrap(self) -> Option<GenericIndex<I, M>> {
        if self.0 == I::NULL_VALUE {
            None
        } else {
            Some(GenericIndex(self.0, core::marker::PhantomData))
        }
    }
    #[inline]
    pub fn unwrap_get(self) -> Option<I> {
        if self.0 == I::NULL_VALUE {
            None
        } else {
            Some(self.0)
        }
    }
}

/// Backing-integer bound for `GenericIndex` (replaces Zig's `comptime backing_int: type`).
pub trait GenericIndexInt: Copy + Eq + PartialOrd {
    const NULL_VALUE: Self;
    fn to_usize(self) -> usize;
    fn from_usize(n: usize) -> Self;
}
macro_rules! generic_index_int { ($($t:ty),*) => { $(
    impl GenericIndexInt for $t {
        const NULL_VALUE: Self = <$t>::MAX;
        #[inline] fn to_usize(self) -> usize { self as usize }
        #[inline] fn from_usize(n: usize) -> Self {
            debug_assert!(n as u128 <= <$t>::MAX as u128, "GenericIndex::from_usize: truncation");
            n as Self
        }
    }
)* } }
generic_index_int!(u8, u16, u32, u64, usize, i32, i64);

/// Generic-integer bound replacing Zig's `comptime T: type` + `@typeInfo(T).Int`
/// in `validateIntegerRange` / `validateBigIntRange` / `getInteger`
/// (src/jsc/JSGlobalObject.zig). Provides the small surface those callers need:
/// signedness, range as `i128`, and lossy/wrapping casts from the JSC numeric
/// carriers (i32 / f64 / i64 / u64).
pub trait Integer: Copy + Default {
    const SIGNED: bool;
    const MIN_I128: i128;
    const MAX_I128: i128;
    const ZERO: Self;
    fn from_i32(v: i32) -> Self;
    fn from_f64(v: f64) -> Self;
    fn from_i64(v: i64) -> Self;
    fn from_u64(v: u64) -> Self;
    fn to_f64(self) -> f64;
}
macro_rules! impl_integer {
    ($($t:ty: $signed:expr),* $(,)?) => { $(
        impl Integer for $t {
            const SIGNED: bool = $signed;
            const MIN_I128: i128 = <$t>::MIN as i128;
            const MAX_I128: i128 = <$t>::MAX as i128;
            const ZERO: Self = 0;
            #[inline] fn from_i32(v: i32) -> Self { v as Self }
            #[inline] fn from_f64(v: f64) -> Self { v as Self }
            #[inline] fn from_i64(v: i64) -> Self { v as Self }
            #[inline] fn from_u64(v: u64) -> Self { v as Self }
            #[inline] fn to_f64(self) -> f64 { self as f64 }
        }
    )* };
}
impl_integer!(
    i8: true, i16: true, i32: true, i64: true, isize: true,
    u8: false, u16: false, u32: false, u64: false, usize: false,
);

/// Primitive integers transcodable as native-endian raw bytes.
///
/// Replaces Zig's `comptime T: type` + `std.mem.readIntSliceNative` /
/// `std.mem.asBytes` / `@bitCast` reflection pattern with an explicit trait
/// bound. Shared by the peechy wire codec (`bun_analytics::SchemaInt`) and the
/// MySQL protocol reader (`bun_sql::ReadableInt`), which re-export this under
/// their local names.
pub trait NativeEndianInt: Copy + 'static {
    const SIZE: usize;
    /// Reinterpret `b[..SIZE]` as `Self` (native endian).
    fn from_ne_slice(b: &[u8]) -> Self;
    /// Write `self.to_ne_bytes()` into `out[..SIZE]`.
    fn encode_ne(self, out: &mut [u8]);
}

macro_rules! impl_native_endian_int {
    ($($t:ty),* $(,)?) => {$(
        impl NativeEndianInt for $t {
            const SIZE: usize = core::mem::size_of::<$t>();
            #[inline]
            fn from_ne_slice(b: &[u8]) -> Self {
                let mut a = [0u8; core::mem::size_of::<$t>()];
                a.copy_from_slice(&b[..core::mem::size_of::<$t>()]);
                <$t>::from_ne_bytes(a)
            }
            #[inline]
            fn encode_ne(self, out: &mut [u8]) {
                out[..core::mem::size_of::<$t>()].copy_from_slice(&self.to_ne_bytes());
            }
        }
    )*};
}
impl_native_endian_int!(u8, i8, u16, i16, u32, i32, u64, i64);
