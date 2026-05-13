use core::fmt;

use bun_base64::zig_base64::STANDARD_NO_PAD as base64;
use bun_core::strings;
use bun_sha_hmac::sha as Crypto;

// Digest lengths (bytes). Mirrors std.crypto.hash.* digest_length.
const SHA1_DIGEST_LEN: usize = 20;
const SHA256_DIGEST_LEN: usize = 32;
const SHA384_DIGEST_LEN: usize = 48;
const SHA512_DIGEST_LEN: usize = 64;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Integrity {
    pub tag: Tag,
    /// Possibly a [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) value initially
    /// We transform it though.
    pub value: [u8; DIGEST_BUF_LEN],
}
// SAFETY: `#[repr(C)]` with a `#[repr(transparent)] u8` tag + `[u8; 64]` →
// size 65, align 1, no padding bytes, `Copy + 'static`. Every byte initialized.
unsafe impl bytemuck::NoUninit for Integrity {}

impl Default for Integrity {
    fn default() -> Self {
        Self {
            tag: Tag::UNKNOWN,
            value: EMPTY_DIGEST_BUF,
        }
    }
}

const EMPTY_DIGEST_BUF: [u8; DIGEST_BUF_LEN] = [0u8; DIGEST_BUF_LEN];

pub const DIGEST_BUF_LEN: usize = {
    let mut m = SHA1_DIGEST_LEN;
    if SHA512_DIGEST_LEN > m {
        m = SHA512_DIGEST_LEN;
    }
    if SHA256_DIGEST_LEN > m {
        m = SHA256_DIGEST_LEN;
    }
    if SHA384_DIGEST_LEN > m {
        m = SHA384_DIGEST_LEN;
    }
    m
};

impl Integrity {
    // TODO(port): narrow error set (Zig: `!Integrity` inferred — only error.InvalidCharacter)
    pub fn parse_sha_sum(buf: &[u8]) -> Result<Integrity, bun_core::Error> {
        if buf.is_empty() {
            return Ok(Integrity {
                tag: Tag::UNKNOWN,
                ..Default::default()
            });
        }

        // e.g. "3cd0599b099384b815c10f7fa7df0092b62d534f"
        let mut integrity = Integrity {
            tag: Tag::SHA1,
            ..Default::default()
        };
        let end: usize = b"3cd0599b099384b815c10f7fa7df0092b62d534f"
            .len()
            .min(buf.len());
        if end % 2 != 0 {
            return Err(bun_core::err!("InvalidCharacter"));
        }
        let mut out_i: usize = 0;
        let mut i: usize = 0;

        // initializer should zero it out
        if cfg!(debug_assertions) {
            for c in integrity.value.iter() {
                debug_assert!(*c == 0);
            }
        }

        while i < end {
            // npm sha1 strings are always [0-9a-f]; canonical hex_pair_value
            // narrows the original over-broad b'g'..=b'z' acceptance.
            integrity.value[out_i] = bun_core::fmt::hex_pair_value(buf[i], buf[i + 1])
                .ok_or_else(|| bun_core::err!("InvalidCharacter"))?;
            out_i += 1;
            i += 2;
        }

        Ok(integrity)
    }

    pub fn parse(buf: &[u8]) -> Integrity {
        if buf.len() < b"sha256-".len() {
            return Integrity {
                tag: Tag::UNKNOWN,
                ..Default::default()
            };
        }

        let mut out: [u8; DIGEST_BUF_LEN] = EMPTY_DIGEST_BUF;
        let (tag, offset) = Tag::parse(buf);
        if tag == Tag::UNKNOWN {
            return Integrity {
                tag: Tag::UNKNOWN,
                ..Default::default()
            };
        }

        let expected_len = tag.digest_len();
        if expected_len == 0 {
            return Integrity {
                tag: Tag::UNKNOWN,
                ..Default::default()
            };
        }

        let input = {
            // std.mem.trimRight(u8, buf[offset..], "=")
            let s = &buf[offset..];
            let mut end = s.len();
            while end > 0 && s[end - 1] == b'=' {
                end -= 1;
            }
            &s[..end]
        };

        // Check if the base64 input would decode to more bytes than we can handle
        let Ok(decoded_size) = base64.decoder.calc_size_for_slice(input) else {
            return Integrity {
                tag: Tag::UNKNOWN,
                ..Default::default()
            };
        };

        if decoded_size > expected_len {
            return Integrity {
                tag: Tag::UNKNOWN,
                ..Default::default()
            };
        }

        if base64
            .decoder
            .decode(&mut out[0..expected_len], input)
            .is_err()
        {
            return Integrity {
                tag: Tag::UNKNOWN,
                ..Default::default()
            };
        }

        Integrity { value: out, tag }
    }

    pub fn slice(&self) -> &[u8] {
        &self.value[0..self.tag.digest_len()]
    }

    /// Compute a sha512 integrity hash from raw bytes (e.g. a downloaded tarball).
    pub fn for_bytes(bytes: &[u8]) -> Integrity {
        const LEN: usize = SHA512_DIGEST_LEN;
        let mut value: [u8; DIGEST_BUF_LEN] = EMPTY_DIGEST_BUF;
        Crypto::SHA512::hash(
            bytes,
            (&mut value[0..LEN])
                .try_into()
                .expect("infallible: size matches"),
            core::ptr::null_mut(),
        );
        Integrity {
            tag: Tag::SHA512,
            value,
        }
    }

    #[inline]
    pub fn verify(&self, bytes: &[u8]) -> bool {
        // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
        Self::verify_by_tag(self.tag, bytes, &self.value)
    }

    pub fn verify_by_tag(tag: Tag, bytes: &[u8], sum: &[u8]) -> bool {
        let mut digest: [u8; DIGEST_BUF_LEN] = [0u8; DIGEST_BUF_LEN];

        match tag {
            Tag::SHA1 => {
                const LEN: usize = SHA1_DIGEST_LEN;
                let ptr: &mut [u8; LEN] = (&mut digest[0..LEN])
                    .try_into()
                    .expect("infallible: size matches");
                Crypto::SHA1::hash(bytes, ptr, core::ptr::null_mut());
                strings::eql_long(ptr, &sum[0..LEN], true)
            }
            Tag::SHA512 => {
                const LEN: usize = SHA512_DIGEST_LEN;
                let ptr: &mut [u8; LEN] = (&mut digest[0..LEN])
                    .try_into()
                    .expect("infallible: size matches");
                Crypto::SHA512::hash(bytes, ptr, core::ptr::null_mut());
                strings::eql_long(ptr, &sum[0..LEN], true)
            }
            Tag::SHA256 => {
                const LEN: usize = SHA256_DIGEST_LEN;
                let ptr: &mut [u8; LEN] = (&mut digest[0..LEN])
                    .try_into()
                    .expect("infallible: size matches");
                Crypto::SHA256::hash(bytes, ptr, core::ptr::null_mut());
                strings::eql_long(ptr, &sum[0..LEN], true)
            }
            Tag::SHA384 => {
                const LEN: usize = SHA384_DIGEST_LEN;
                let ptr: &mut [u8; LEN] = (&mut digest[0..LEN])
                    .try_into()
                    .expect("infallible: size matches");
                Crypto::SHA384::hash(bytes, ptr, core::ptr::null_mut());
                strings::eql_long(ptr, &sum[0..LEN], true)
            }
            _ => false,
        }
    }
}

impl fmt::Display for Integrity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.tag {
            Tag::SHA1 => f.write_str("sha1-")?,
            Tag::SHA256 => f.write_str("sha256-")?,
            Tag::SHA384 => f.write_str("sha384-")?,
            Tag::SHA512 => f.write_str("sha512-")?,
            _ => return Ok(()),
        }

        let mut base64_buf = [0u8; 512];
        let bytes = self.slice();

        // SAFETY: base64 alphabet is pure ASCII.
        f.write_str(unsafe {
            core::str::from_utf8_unchecked(base64.encoder.encode(&mut base64_buf, bytes))
        })?;

        // consistentcy with yarn.lock
        match self.tag {
            Tag::SHA1 => f.write_str("="),
            _ => f.write_str("=="),
        }
    }
}

// PORT NOTE: Zig `enum(u8) { ..., _ }` is non-exhaustive (any u8 is a valid bit
// pattern, since this is read from on-disk lockfiles). A Rust `#[repr(u8)] enum`
// would be UB for unknown discriminants, so we use a transparent newtype with
// associated consts instead.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Tag(pub u8);
// SAFETY: `#[repr(transparent)]` newtype over `u8` — same layout as `u8`,
// no padding, `Copy + 'static`.
unsafe impl bytemuck::NoUninit for Tag {}

impl Tag {
    pub const UNKNOWN: Tag = Tag(0);
    /// "shasum" in the metadata
    pub const SHA1: Tag = Tag(1);
    /// The value is a [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) value
    pub const SHA256: Tag = Tag(2);
    /// The value is a [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) value
    pub const SHA384: Tag = Tag(3);
    /// The value is a [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) value
    pub const SHA512: Tag = Tag(4);

    #[inline]
    pub fn is_supported(self) -> bool {
        self.0 >= Tag::SHA1.0 && self.0 <= Tag::SHA512.0
    }

    pub fn parse(buf: &[u8]) -> (Tag, usize) {
        // PORT NOTE: Zig used strings.ExactSizeMatcher(8); a byte-slice match is
        // equivalent and const-propagated.
        let Some(i) = strings::index_of_char(&buf[0..buf.len().min(7)], b'-') else {
            return (Tag::UNKNOWN, 0);
        };
        let i = i as usize;

        if buf.len() <= i + 1 {
            return (Tag::UNKNOWN, 0);
        }

        match &buf[0..i] {
            b"sha1" => (Tag::SHA1, i + 1),
            b"sha256" => (Tag::SHA256, i + 1),
            b"sha384" => (Tag::SHA384, i + 1),
            b"sha512" => (Tag::SHA512, i + 1),
            _ => (Tag::UNKNOWN, 0),
        }
    }

    #[inline]
    pub fn digest_len(self) -> usize {
        match self {
            Tag::SHA1 => SHA1_DIGEST_LEN,
            Tag::SHA512 => SHA512_DIGEST_LEN,
            Tag::SHA256 => SHA256_DIGEST_LEN,
            Tag::SHA384 => SHA384_DIGEST_LEN,
            _ => 0,
        }
    }
}

/// Incremental hasher used by the streaming tarball extractor. Bytes are
/// fed as they arrive from the network so integrity can be verified
/// without ever holding the full tarball in memory.
///
/// When `expected.tag` is a supported algorithm we hash with that
/// algorithm so `verify()` can compare against the lockfile value. When
/// there is no expected value yet (first install of a GitHub/remote
/// tarball) we default to SHA-512 to match `for_bytes`.
pub struct Streaming {
    pub expected: Integrity,
    pub hasher: Hasher,
}

pub enum Hasher {
    None,
    Sha1(Crypto::SHA1),
    Sha256(Crypto::SHA256),
    Sha384(Crypto::SHA384),
    Sha512(Crypto::SHA512),
}

impl Streaming {
    pub fn init(expected: Integrity, compute_if_missing: bool) -> Streaming {
        Streaming {
            expected,
            hasher: match expected.tag {
                Tag::SHA1 => Hasher::Sha1(Crypto::SHA1::init()),
                Tag::SHA256 => Hasher::Sha256(Crypto::SHA256::init()),
                Tag::SHA384 => Hasher::Sha384(Crypto::SHA384::init()),
                Tag::SHA512 => Hasher::Sha512(Crypto::SHA512::init()),
                _ => {
                    if compute_if_missing {
                        Hasher::Sha512(Crypto::SHA512::init())
                    } else {
                        Hasher::None
                    }
                }
            },
        }
    }

    pub fn update(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        match &mut self.hasher {
            Hasher::None => {}
            Hasher::Sha1(h) => h.update(bytes),
            Hasher::Sha256(h) => h.update(bytes),
            Hasher::Sha384(h) => h.update(bytes),
            Hasher::Sha512(h) => h.update(bytes),
        }
    }

    pub fn final_(&mut self) -> Integrity {
        let mut out: [u8; DIGEST_BUF_LEN] = EMPTY_DIGEST_BUF;
        match &mut self.hasher {
            Hasher::None => Integrity::default(),
            Hasher::Sha1(h) => {
                h.r#final(
                    (&mut out[0..SHA1_DIGEST_LEN])
                        .try_into()
                        .expect("infallible: size matches"),
                );
                Integrity {
                    tag: Tag::SHA1,
                    value: out,
                }
            }
            Hasher::Sha256(h) => {
                h.r#final(
                    (&mut out[0..SHA256_DIGEST_LEN])
                        .try_into()
                        .expect("infallible: size matches"),
                );
                Integrity {
                    tag: Tag::SHA256,
                    value: out,
                }
            }
            Hasher::Sha384(h) => {
                h.r#final(
                    (&mut out[0..SHA384_DIGEST_LEN])
                        .try_into()
                        .expect("infallible: size matches"),
                );
                Integrity {
                    tag: Tag::SHA384,
                    value: out,
                }
            }
            Hasher::Sha512(h) => {
                h.r#final(
                    (&mut out[0..SHA512_DIGEST_LEN])
                        .try_into()
                        .expect("infallible: size matches"),
                );
                Integrity {
                    tag: Tag::SHA512,
                    value: out,
                }
            }
        }
    }

    /// Returns true if the computed digest matches `expected`, or if no
    /// expected value was supplied. Callers that need to persist the
    /// computed value should call `final_()` instead.
    pub fn verify(&mut self) -> bool {
        if !self.expected.tag.is_supported() {
            return true;
        }
        let computed = self.final_();
        if computed.tag != self.expected.tag {
            return false;
        }
        let len = self.expected.tag.digest_len();
        strings::eql_long(&computed.value[0..len], &self.expected.value[0..len], true)
    }
}

// Zig had a `comptime` block asserting Integrity::default().value is all-zero.
const _: () = {
    let buf = EMPTY_DIGEST_BUF;
    let mut i = 0;
    while i < DIGEST_BUF_LEN {
        assert!(buf[i] == 0, "Integrity buffer is not zeroed");
        i += 1;
    }
};

// ported from: src/install/integrity.zig
