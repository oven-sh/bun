// https://github.com/dmgk/zig-uuid

use core::fmt;
use core::sync::atomic::{AtomicU32, AtomicU64, Ordering};

use bun_core::strings;

#[derive(thiserror::Error, Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum UuidError {
    #[error("InvalidUUID")]
    InvalidUUID,
}

#[derive(Clone, Copy)]
pub struct UUID {
    pub bytes: [u8; 16],
}

impl UUID {
    pub fn init() -> UUID {
        let mut uuid = UUID { bytes: [0u8; 16] };

        bun_boringssl::rand_bytes(&mut uuid.bytes);
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

        if buf.len() != 36
            || buf[8] != b'-'
            || buf[13] != b'-'
            || buf[18] != b'-'
            || buf[23] != b'-'
        {
            return Err(UuidError::InvalidUUID);
        }

        for (j, &i) in ENCODED_POS.iter().enumerate() {
            uuid.bytes[j] = bun_core::fmt::hex_pair_value(buf[i as usize], buf[i as usize + 1])
                .ok_or(UuidError::InvalidUUID)?;
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

impl fmt::Display for UUID {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut buf = [0u8; 36];
        self.print(&mut buf);

        // SAFETY: print_bytes only writes ASCII hex digits and '-'
        f.write_str(unsafe { core::str::from_utf8_unchecked(&buf) })
    }
}

fn print_bytes(bytes: &[u8; 16], buf: &mut [u8; 36]) {
    buf[8] = b'-';
    buf[13] = b'-';
    buf[18] = b'-';
    buf[23] = b'-';
    for (j, &i) in ENCODED_POS.iter().enumerate() {
        let [hi, lo] = bun_core::fmt::hex_byte_lower(bytes[j]);
        buf[i as usize] = hi;
        buf[i as usize + 1] = lo;
    }
}

/// # --- 48 ---   -- 4 --   - 12 -   -- 2 --   - 62 -
/// # unix_ts_ms | version | rand_a | variant | rand_b
#[derive(Clone, Copy)]
pub struct UUID7 {
    pub bytes: [u8; 16],
}

// PORTING.md §Concurrency: `bun_threading::Guarded` has a `const fn new()` so
// it can back a `static` directly (no lazy init).
static UUID_V7_LOCK: bun_threading::Guarded<()> = bun_threading::Guarded::new(());
// State for the default (Date.now()) path, where the RFC 9562 §6.2 monotonic
// clamp applies.
static UUID_V7_LAST_TIMESTAMP: AtomicU64 = AtomicU64::new(0);
static UUID_V7_COUNTER: AtomicU32 = AtomicU32::new(0);
// Separate state for caller-supplied timestamps so an explicit call neither
// observes nor rebases the default path's monotonic state.
static UUID_V7_EXPLICIT_REQUESTED: AtomicU64 = AtomicU64::new(u64::MAX);
static UUID_V7_EXPLICIT_EMITTED: AtomicU64 = AtomicU64::new(0);
static UUID_V7_EXPLICIT_COUNTER: AtomicU32 = AtomicU32::new(0);

/// Where the `timestamp` passed to [`UUID7::init`] came from.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TimestampSource {
    /// Read from the generator's own clock. The RFC 9562 §6.2 monotonic clamp
    /// applies: the emitted timestamp never moves backward.
    Clock,
    /// Supplied by the caller. The value is encoded verbatim and does not
    /// touch the clock-path state.
    Explicit,
}

impl UUID7 {
    // Returns the (possibly adjusted) timestamp and the 12-bit rand_a counter.
    // RFC 9562 §6.2: on counter rollover, increment the timestamp rather than
    // wrapping the counter, so the output stays monotonic.
    fn next(timestamp: u64, seed: u16, source: TimestampSource) -> (u64, u32) {
        // The high bit of the 12-bit counter is reserved as a rollover guard so
        // a freshly seeded millisecond always has at least 2048 increments left.
        let seed = (seed & 0x07FF) as u32;

        let _guard = UUID_V7_LOCK.lock();

        let (mut ts, mut count) = match source {
            TimestampSource::Clock => {
                let last = UUID_V7_LAST_TIMESTAMP.load(Ordering::Relaxed);
                if timestamp > last {
                    (timestamp, seed)
                } else {
                    (last, UUID_V7_COUNTER.load(Ordering::Relaxed) + 1)
                }
            }
            TimestampSource::Explicit => {
                if timestamp != UUID_V7_EXPLICIT_REQUESTED.load(Ordering::Relaxed) {
                    (timestamp, seed)
                } else {
                    (
                        UUID_V7_EXPLICIT_EMITTED.load(Ordering::Relaxed),
                        UUID_V7_EXPLICIT_COUNTER.load(Ordering::Relaxed) + 1,
                    )
                }
            }
        };

        if count > 0x0FFF {
            ts = (ts + 1).min((1u64 << 48) - 1);
            count = seed;
        }

        match source {
            TimestampSource::Clock => {
                UUID_V7_LAST_TIMESTAMP.store(ts, Ordering::Relaxed);
                UUID_V7_COUNTER.store(count, Ordering::Relaxed);
            }
            TimestampSource::Explicit => {
                UUID_V7_EXPLICIT_REQUESTED.store(timestamp, Ordering::Relaxed);
                UUID_V7_EXPLICIT_EMITTED.store(ts, Ordering::Relaxed);
                UUID_V7_EXPLICIT_COUNTER.store(count, Ordering::Relaxed);
            }
        }

        (ts, count)
    }

    pub fn init(timestamp: u64, random: [u8; 10], source: TimestampSource) -> UUID7 {
        // random[0..8] supplies rand_b; random[8..10] seeds the rand_a counter
        // so the seeded counter value is independent of the visible random bits.
        let seed = u16::from_le_bytes([random[8], random[9]]);
        let (timestamp, count) = Self::next(timestamp, seed, source);

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

/// Well-known UUID v5 namespaces (RFC 4122 Appendix C).
pub mod namespaces {
    use super::*;

    pub(crate) const DNS: &[u8; 16] = &[
        0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30,
        0xc8,
    ];
    pub const URL: &[u8; 16] = &[
        0x6b, 0xa7, 0xb8, 0x11, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30,
        0xc8,
    ];
    pub(crate) const OID: &[u8; 16] = &[
        0x6b, 0xa7, 0xb8, 0x12, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30,
        0xc8,
    ];
    pub(crate) const X500: &[u8; 16] = &[
        0x6b, 0xa7, 0xb8, 0x14, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30,
        0xc8,
    ];

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
            let mut sha1_hasher = bun_sha_hmac::SHA1::init();
            sha1_hasher.update(namespace);
            sha1_hasher.update(name);
            let mut hash = [0u8; 20];
            sha1_hasher.r#final(&mut hash);
            hash
        };

        // Take first 16 bytes of the hash
        let mut bytes: [u8; 16] = hash[0..16].try_into().expect("infallible: size matches");

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
