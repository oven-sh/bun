use bun_wyhash::hash;

// `packed(4)`: 20 bytes, so `bun_router::pattern::Value` stays at 24.
#[repr(C, packed(4))]
#[derive(Copy, Clone)]
pub struct HashedString<'a> {
    buf: &'a [u8],
    pub(crate) hash: u32,
}
const _: () = assert!(size_of::<HashedString<'_>>() == 20);

impl<'a> HashedString<'a> {
    pub const EMPTY: Self = HashedString { buf: b"", hash: 0 };

    pub fn init(buf: &'a [u8]) -> Self {
        HashedString {
            buf,
            hash: hash(buf) as u32,
        }
    }

    pub fn init_no_hash(buf: &'a [u8]) -> Self {
        HashedString { buf, hash: 0 }
    }

    pub fn eql_bytes(&self, other: &[u8]) -> bool {
        self.buf.len() == other.len() && (hash(other) as u32) == self.hash && self.str() == other
    }

    pub fn str(&self) -> &'a [u8] {
        self.buf
    }
}
