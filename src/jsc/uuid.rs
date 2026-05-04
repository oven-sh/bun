// https://github.com/dmgk/zig-uuid

use core::fmt;
use core::sync::atomic::{AtomicU32, AtomicU64, Ordering};

use bun_str::strings;

#[derive(thiserror::Error, Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum UuidError {
    #[error("InvalidUUID")]
    InvalidUUID,
}
impl From<UuidError> for bun_core::Error {
    fn from(e: UuidError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

#[derive(Clone, Copy)]
pub struct UUID {
    pub bytes: [u8; 16],
}

impl UUID {
    pub fn init() -> UUID {
        let mut uuid = UUID { bytes: [0u8; 16] };

        bun_core::csprng(&mut uuid.bytes);
        // Version 4
        uuid.bytes[6] = (uuid.bytes[6] & 0x0f) | 0x40;
        // Variant 1
        uuid.bytes[8] = (uuid.bytes[8] & 0x3f) | 0x80;

        uuid
    }

    pub fn init_with(bytes: &[u8; 16]) -> UUID {
        let mut uuid = UUID { bytes: *bytes };

        uuid.bytes[6] = (uuid.bytes[6] & 0x0f) | 0x40;
        uuid.bytes[8] = (uuid.bytes[8] & 0x3f) | 0x80;

        uuid
    }

    pub const STRING_LENGTH: usize = 36;

    pub fn print(&self, buf: &mut [u8; 36]) {
        print_bytes(&self.bytes, buf);
    }

    pub fn parse(buf: &[u8]) -> Result<UUID, UuidError> {
        let mut uuid = UUID { bytes: [0u8; 16] };

        if buf.len() != 36 || buf[8] != b'-' || buf[13] != b'-' || buf[18] != b'-' || buf[23] != b'-' {
            return Err(UuidError::InvalidUUID);
        }

        // PERF(port): was `inline for` (comptime unroll) — profile in Phase B
        for (j, &i) in ENCODED_POS.iter().enumerate() {
            let hi = HEX_TO_NIBBLE[buf[i as usize + 0] as usize];
            let lo = HEX_TO_NIBBLE[buf[i as usize + 1] as usize];
            if hi == 0xff || lo == 0xff {
                return Err(UuidError::InvalidUUID);
            }
            uuid.bytes[j] = (hi << 4) | lo;
        }

        Ok(uuid)
    }

    // Zero UUID
    pub const ZERO: UUID = UUID { bytes: [0u8; 16] };

    // Convenience function to return a new v4 UUID.
    pub fn new_v4() -> UUID {
        UUID::init()
    }
}

// Indices in the UUID string representation for each byte.
const ENCODED_POS: [u8; 16] = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34];

// Hex to nibble mapping.
#[rustfmt::skip]
const HEX_TO_NIBBLE: [u8; 256] = [
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    0x08, 0x09, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
];

impl fmt::Display for UUID {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut buf = [0u8; 36];
        self.print(&mut buf);

        // SAFETY: print_bytes only writes ASCII hex digits and '-'
        f.write_str(unsafe { core::str::from_utf8_unchecked(&buf) })
    }
}

fn print_bytes(bytes: &[u8; 16], buf: &mut [u8; 36]) {
    const HEX: &[u8; 16] = b"0123456789abcdef";

    buf[8] = b'-';
    buf[13] = b'-';
    buf[18] = b'-';
    buf[23] = b'-';
    // PERF(port): was `inline for` (comptime unroll) — profile in Phase B
    for (j, &i) in ENCODED_POS.iter().enumerate() {
        buf[i as usize + 0] = HEX[(bytes[j] >> 4) as usize];
        buf[i as usize + 1] = HEX[(bytes[j] & 0x0f) as usize];
    }
}

/// # --- 48 ---   -- 4 --   - 12 -   -- 2 --   - 62 -
/// # unix_ts_ms | version | rand_a | variant | rand_b
#[derive(Clone, Copy)]
pub struct UUID7 {
    pub bytes: [u8; 16],
}

// TODO(port): bun.Mutex — verify bun_threading::Mutex has a const initializer
static UUID_V7_LOCK: bun_threading::Mutex = bun_threading::Mutex::new();
static UUID_V7_LAST_TIMESTAMP: AtomicU64 = AtomicU64::new(0);
static UUID_V7_COUNTER: AtomicU32 = AtomicU32::new(0);

impl UUID7 {
    fn get_count(timestamp: u64) -> u32 {
        let _guard = UUID_V7_LOCK.lock();
        if UUID_V7_LAST_TIMESTAMP.swap(timestamp, Ordering::Relaxed) != timestamp {
            UUID_V7_COUNTER.store(0, Ordering::Relaxed);
        }

        UUID_V7_COUNTER.fetch_add(1, Ordering::Relaxed) % 4096
    }

    pub fn init(timestamp: u64, random: &[u8; 8]) -> UUID7 {
        let count = Self::get_count(timestamp);

        let mut bytes = [0u8; 16];

        // First 6 bytes: timestamp in big-endian
        bytes[0] = (timestamp >> 40) as u8;
        bytes[1] = (timestamp >> 32) as u8;
        bytes[2] = (timestamp >> 24) as u8;
        bytes[3] = (timestamp >> 16) as u8;
        bytes[4] = (timestamp >> 8) as u8;
        bytes[5] = timestamp as u8;

        // Byte 6: Version 7 in high nibble, top 4 bits of counter in low nibble
        bytes[6] = (7u8 << 4) | (((count >> 8) & 0x0F) as u8);

        // Byte 7: Lower 8 bits of counter
        bytes[7] = count as u8;

        // Byte 8: Variant in top 2 bits, 6 bits of random
        bytes[8] = 0x80 | (random[0] & 0x3F);

        // Remaining 7 bytes: random
        bytes[9..16].copy_from_slice(&random[1..8]);

        UUID7 { bytes }
    }

    fn to_bytes(self) -> [u8; 16] {
        self.bytes
    }

    pub fn print(self, buf: &mut [u8; 36]) {
        print_bytes(&self.to_bytes(), buf);
    }

    pub fn to_uuid(self) -> UUID {
        let bytes: [u8; 16] = self.to_bytes();
        UUID { bytes }
    }
}

impl fmt::Display for UUID7 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.to_uuid().fmt(f)
    }
}

/// UUID v5 implementation using SHA-1 hashing
/// This is a name-based UUID that uses SHA-1 for hashing
#[derive(Clone, Copy)]
pub struct UUID5 {
    pub bytes: [u8; 16],
}

// PORT NOTE: Zig nested `pub const namespaces = struct { ... }` used as a namespace;
// Rust cannot nest a module inside an `impl`, so it lives adjacent to `UUID5`.
pub mod namespaces {
    use super::*;

    pub const DNS: &[u8; 16] = &[0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8];
    pub const URL: &[u8; 16] = &[0x6b, 0xa7, 0xb8, 0x11, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8];
    pub const OID: &[u8; 16] = &[0x6b, 0xa7, 0xb8, 0x12, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8];
    pub const X500: &[u8; 16] = &[0x6b, 0xa7, 0xb8, 0x14, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8];

    pub fn get(namespace: &[u8]) -> Option<&'static [u8; 16]> {
        if strings::eql_case_insensitive_ascii(namespace, b"dns", true) {
            Some(DNS)
        } else if strings::eql_case_insensitive_ascii(namespace, b"url", true) {
            Some(URL)
        } else if strings::eql_case_insensitive_ascii(namespace, b"oid", true) {
            Some(OID)
        } else if strings::eql_case_insensitive_ascii(namespace, b"x500", true) {
            Some(X500)
        } else {
            None
        }
    }
}

impl UUID5 {
    /// Generate a UUID v5 from a namespace UUID and name data
    pub fn init(namespace: &[u8; 16], name: &[u8]) -> UUID5 {
        let hash: [u8; 20] = {
            // TODO(port): verify bun_sha::SHA1 API (init/update/final) and that Drop replaces deinit
            let mut sha1_hasher = bun_sha::SHA1::init();

            sha1_hasher.update(namespace);
            sha1_hasher.update(name);

            let mut hash = [0u8; 20];
            sha1_hasher.final_(&mut hash);

            hash
        };

        // Take first 16 bytes of the hash
        let mut bytes: [u8; 16] = hash[0..16].try_into().unwrap();

        // Set version to 5 (bits 12-15 of time_hi_and_version)
        bytes[6] = (bytes[6] & 0x0F) | 0x50;

        // Set variant bits (bits 6-7 of clock_seq_hi_and_reserved)
        bytes[8] = (bytes[8] & 0x3F) | 0x80;

        UUID5 { bytes }
    }

    pub fn to_bytes(self) -> [u8; 16] {
        self.bytes
    }

    pub fn print(self, buf: &mut [u8; 36]) {
        print_bytes(&self.to_bytes(), buf);
    }

    pub fn to_uuid(self) -> UUID {
        let bytes: [u8; 16] = self.to_bytes();
        UUID { bytes }
    }
}

impl fmt::Display for UUID5 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.to_uuid().fmt(f)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/uuid.zig (270 lines)
//   confidence: medium
//   todos:      2
//   notes:      bun_core::csprng / bun_threading::Mutex / bun_sha::SHA1 crate paths assumed; logic is 1:1
// ──────────────────────────────────────────────────────────────────────────
