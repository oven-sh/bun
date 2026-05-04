use core::marker::PhantomData;

/// Trait covering the Zig `@typeInfo(Key)` switch in `IdentityContext.hash`:
/// `.@"enum" => @intFromEnum(key)`, `.int => key`, `else => @compileError(...)`.
/// Implement for any int (`self as u64`) or `#[repr(uN)]` enum (`self as uN as u64`).
// TODO(port): blanket-impl for all primitive ints + derive for `#[repr(uN)]` enums in Phase B.
pub trait IdentityHash: Copy + Eq {
    fn identity_hash(self) -> u64;
}

#[derive(Default, Clone, Copy)]
pub struct IdentityContext<Key>(PhantomData<Key>);

impl<Key: IdentityHash> IdentityContext<Key> {
    pub fn hash(&self, key: Key) -> u64 {
        // Zig: switch (comptime @typeInfo(Key)) { .@"enum" => @intFromEnum(key), .int => key, else => @compileError }
        key.identity_hash()
    }

    pub fn eql(&self, a: Key, b: Key) -> bool {
        a == b
    }
}

/// When storing hashes as keys in a hash table, we don't want to hash the hashes or else we increase the chance of collisions. This is also marginally faster since it means hashing less stuff.
/// `ArrayIdentityContext` and `IdentityContext` are distinct because ArrayHashMap expects u32 hashes but HashMap expects u64 hashes.
#[derive(Default, Clone, Copy)]
pub struct ArrayIdentityContext;

impl ArrayIdentityContext {
    pub fn hash(&self, key: u32) -> u32 {
        key
    }

    pub fn eql(&self, a: u32, b: u32, _: usize) -> bool {
        a == b
    }
}

#[derive(Default, Clone, Copy)]
pub struct ArrayIdentityContextU64;

impl ArrayIdentityContextU64 {
    pub fn hash(&self, key: u64) -> u32 {
        key as u32
    }

    pub fn eql(&self, a: u64, b: u64, _: usize) -> bool {
        a == b
    }
}

// Mirror Zig's `ArrayIdentityContext.U64` nesting as an associated type alias.
impl ArrayIdentityContext {
    pub type U64 = ArrayIdentityContextU64;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/collections/identity_context.zig (37 lines)
//   confidence: medium
//   todos:      1
//   notes:      @typeInfo dispatch mapped to IdentityHash trait; inherent assoc type (U64) needs nightly or flatten in Phase B
// ──────────────────────────────────────────────────────────────────────────
