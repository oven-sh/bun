use core::marker::PhantomData;

/// Trait for keys usable with `IdentityContext`.
/// Implement for any int (`self as u64`) or `#[repr(uN)]` enum (`self as uN as u64`).
pub trait IdentityHash: Copy + Eq {
    fn identity_hash(self) -> u64;
}

macro_rules! identity_hash_int {
    ($($t:ty),*) => { $(
        impl IdentityHash for $t {
            #[inline]
            fn identity_hash(self) -> u64 { self as u64 }
        }
    )* };
}
identity_hash_int!(u8, u16, u32, u64, usize, i8, i16, i32, i64, isize);

#[derive(Default, Clone, Copy)]
pub struct IdentityContext<Key>(PhantomData<Key>);

/// When storing hashes as keys in a hash table, we don't want to hash the hashes or else we increase the chance of collisions. This is also marginally faster since it means hashing less stuff.
/// `ArrayIdentityContext` and `IdentityContext` are distinct because ArrayHashMap expects u32 hashes but HashMap expects u64 hashes.
#[derive(Default, Clone, Copy)]
pub struct ArrayIdentityContext;

#[derive(Default, Clone, Copy)]
pub struct ArrayIdentityContextU64;

// Inherent assoc types are unstable, so expose this as a free path alias.
// Callers: `identity_context::U64`.
pub type U64 = ArrayIdentityContextU64;

impl crate::array_hash_map::ArrayHashContext<u32> for ArrayIdentityContext {
    #[inline]
    fn hash(&self, key: &u32) -> u32 {
        *key
    }
    #[inline]
    fn eql(&self, a: &u32, b: &u32, _b_index: usize) -> bool {
        a == b
    }
}

impl crate::array_hash_map::ArrayHashContext<u64> for ArrayIdentityContextU64 {
    #[inline]
    fn hash(&self, key: &u64) -> u32 {
        *key as u32
    }
    #[inline]
    fn eql(&self, a: &u64, b: &u64, _b_index: usize) -> bool {
        a == b
    }
}
