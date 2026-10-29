use bun_wyhash::hash;

#[derive(Copy, Clone)]
pub struct HashedString<'a> {
    str: &'a [u8],
    pub(crate) hash: u32,
}

impl<'a> HashedString<'a> {
    pub const EMPTY: HashedString<'static> = HashedString { str: &[], hash: 0 };

    pub fn init(buf: &'a [u8]) -> HashedString<'a> {
        HashedString {
            str: buf,
            hash: hash(buf) as u32,
        }
    }

    pub fn init_no_hash(buf: &'a [u8]) -> HashedString<'a> {
        HashedString { str: buf, hash: 0 }
    }

    pub fn eql_bytes(&self, other: &[u8]) -> bool {
        self.str.len() == other.len() && (hash(other) as u32) == self.hash && self.str() == other
    }

    pub fn str(&self) -> &'a [u8] {
        self.str
    }
}
