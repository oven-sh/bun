use bun_wyhash::hash;

#[repr(C)]
#[derive(Copy, Clone)]
pub struct HashedString {
    pub ptr: *const u8,
    pub len: u32,
    pub hash: u32,
}

impl HashedString {
    pub const EMPTY: HashedString = HashedString {
        ptr: 0xDEADBEEF as *const u8,
        len: 0,
        hash: 0,
    };

    pub fn init(buf: &[u8]) -> HashedString {
        HashedString {
            ptr: buf.as_ptr(),
            len: buf.len() as u32,
            hash: hash(buf) as u32,
        }
    }

    pub fn init_no_hash(buf: &[u8]) -> HashedString {
        HashedString {
            ptr: buf.as_ptr(),
            len: buf.len() as u32,
            hash: 0,
        }
    }

    // TODO(port): Zig `eql` took `other: anytype` and switched on `@TypeOf(other)`:
    //   - HashedString / *HashedString / *const HashedString → compare hash/ptr/len
    //   - else (slice-like with .len and indexing)           → rehash bytes and compare
    // Rust has no type-switch; split into `eql` (HashedString) and `eql_bytes` (&[u8]).
    pub fn eql(&self, other: &HashedString) -> bool {
        ((self.hash.max(other.hash) > 0 && self.hash == other.hash) || (self.ptr == other.ptr))
            && self.len == other.len
    }

    pub fn eql_bytes(&self, other: &[u8]) -> bool {
        (self.len as usize) == other.len() && (hash(other) as u32) == self.hash
    }

    pub fn str(&self) -> &[u8] {
        // SAFETY: ptr and len were set together from a valid slice in `init`/`init_no_hash`;
        // caller is responsible for keeping the backing buffer alive (same invariant as Zig).
        unsafe { core::slice::from_raw_parts(self.ptr, self.len as usize) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/string/HashedString.zig (44 lines)
//   confidence: high
//   todos:      1
//   notes:      anytype eql split into eql/eql_bytes; raw *const u8 kept (caller owns buf lifetime)
// ──────────────────────────────────────────────────────────────────────────
