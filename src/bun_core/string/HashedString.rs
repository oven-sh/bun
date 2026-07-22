use bun_wyhash::hash;

// Clone/Copy: bitwise OK — `ptr` borrows the caller-owned string passed to
// `init`; `HashedString` is a non-owning (ptr,len,hash) view.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct HashedString {
    ptr: *const u8,
    len: u32,
    hash: u32,
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

    pub fn eql_bytes(&self, other: &[u8]) -> bool {
        (self.len as usize) == other.len()
            && (hash(other) as u32) == self.hash
            && self.str() == other
    }

    fn str(&self) -> &[u8] {
        // SAFETY: ptr and len were set together from a valid slice in `init`/`init_no_hash`;
        // caller is responsible for keeping the backing buffer alive.
        unsafe { core::slice::from_raw_parts(self.ptr, self.len as usize) }
    }
}
