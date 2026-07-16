use core::fmt;

use bun_base64::zig_base64::STANDARD_NO_PAD as base64;
use bun_core::strings;
use bun_sha_hmac::sha as Crypto;

// Digest lengths (bytes).
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

pub(crate) const DIGEST_BUF_LEN: usize = {
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
    pub fn parse_sha_sum(buf: &[u8]) -> crate::Result<Integrity> {
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
        if !end.is_multiple_of(2) {
            return Err(crate::Error::InvalidCharacter);
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
                .ok_or(crate::Error::InvalidCharacter)?;
            out_i += 1;
            i += 2;
        }

        Ok(integrity)
    }

    pub fn parse(buf: &[u8]) -> Integrity {
        let mut strongest = Integrity::default();
        for entry in buf.split(|c: &u8| c.is_ascii_whitespace()) {
            let parsed = Self::parse_entry(entry);
            if parsed.tag.0 > strongest.tag.0 {
                strongest = parsed;
            }
        }
        strongest
    }

    /// True if the SSRI string carries more than one whitespace-separated
    /// entry, i.e. it may have alternate digests of the strongest algorithm.
    #[inline]
    pub fn is_multi_entry(buf: &[u8]) -> bool {
        buf.iter().any(|c| c.is_ascii_whitespace())
    }

    /// Like [`parse`], but also returns the other digests of the strongest
    /// algorithm present in a multi-entry SSRI string. W3C SRI §3.3.4 and
    /// npm's `ssri` pick the strongest algorithm and accept a match against
    /// *any* of its digests, so a tarball matching a non-first digest must
    /// still verify. The primary (first strongest) digest is returned in the
    /// `Integrity`; the remaining ones go into `IntegrityAlternates`.
    pub fn parse_with_alternates(buf: &[u8]) -> (Integrity, IntegrityAlternates) {
        let primary = Self::parse(buf);
        if primary.tag == Tag::UNKNOWN {
            return (primary, IntegrityAlternates::default());
        }
        let len = primary.tag.digest_len();
        let mut extras: Vec<[u8; DIGEST_BUF_LEN]> = Vec::new();
        for entry in buf.split(|c: &u8| c.is_ascii_whitespace()) {
            let parsed = Self::parse_entry(entry);
            if parsed.tag != primary.tag {
                continue;
            }
            // Skip the primary digest itself and any duplicate already stored.
            if strings::eql_long(&parsed.value[0..len], &primary.value[0..len], true) {
                continue;
            }
            if extras
                .iter()
                .any(|v| strings::eql_long(&v[0..len], &parsed.value[0..len], true))
            {
                continue;
            }
            extras.push(parsed.value);
        }
        let alternates = if extras.is_empty() {
            IntegrityAlternates::default()
        } else {
            IntegrityAlternates {
                tag: primary.tag,
                values: extras.into_boxed_slice(),
            }
        };
        (primary, alternates)
    }

    fn parse_entry(buf: &[u8]) -> Integrity {
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
            let mut s = &buf[offset..];
            if let Some(i) = strings::index_of_char(s, b'?') {
                s = &s[..i as usize];
            }
            // trim trailing '=' padding
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
        // SAFETY: engine is null (default).
        unsafe {
            Crypto::SHA512::hash(
                bytes,
                (&mut value[0..LEN])
                    .try_into()
                    .expect("infallible: size matches"),
                core::ptr::null_mut(),
            )
        };
        Integrity {
            tag: Tag::SHA512,
            value,
        }
    }

    #[inline]
    pub fn verify(&self, bytes: &[u8]) -> bool {
        Self::verify_by_tag(self.tag, bytes, &self.value)
    }

    /// True if `digest` (already computed with `self.tag`) equals this value.
    pub fn matches_digest(&self, digest: &[u8]) -> bool {
        let len = self.tag.digest_len();
        if len == 0 || digest.len() < len {
            return false;
        }
        strings::eql_long(&self.value[0..len], &digest[0..len], true)
    }

    /// Hash `bytes` with `tag`, writing the digest into the first
    /// `tag.digest_len()` bytes of the returned buffer (rest zero). Returns an
    /// all-zero buffer for unsupported tags.
    pub fn hash_by_tag(tag: Tag, bytes: &[u8]) -> [u8; DIGEST_BUF_LEN] {
        let mut digest: [u8; DIGEST_BUF_LEN] = EMPTY_DIGEST_BUF;
        match tag {
            Tag::SHA1 => {
                const LEN: usize = SHA1_DIGEST_LEN;
                let ptr: &mut [u8; LEN] = (&mut digest[0..LEN])
                    .try_into()
                    .expect("infallible: size matches");
                // SAFETY: engine is null (default).
                unsafe { Crypto::SHA1::hash(bytes, ptr, core::ptr::null_mut()) };
            }
            Tag::SHA512 => {
                const LEN: usize = SHA512_DIGEST_LEN;
                let ptr: &mut [u8; LEN] = (&mut digest[0..LEN])
                    .try_into()
                    .expect("infallible: size matches");
                // SAFETY: engine is null (default).
                unsafe { Crypto::SHA512::hash(bytes, ptr, core::ptr::null_mut()) };
            }
            Tag::SHA256 => {
                const LEN: usize = SHA256_DIGEST_LEN;
                let ptr: &mut [u8; LEN] = (&mut digest[0..LEN])
                    .try_into()
                    .expect("infallible: size matches");
                // SAFETY: engine is null (default).
                unsafe { Crypto::SHA256::hash(bytes, ptr, core::ptr::null_mut()) };
            }
            Tag::SHA384 => {
                const LEN: usize = SHA384_DIGEST_LEN;
                let ptr: &mut [u8; LEN] = (&mut digest[0..LEN])
                    .try_into()
                    .expect("infallible: size matches");
                // SAFETY: engine is null (default).
                unsafe { Crypto::SHA384::hash(bytes, ptr, core::ptr::null_mut()) };
            }
            _ => {}
        }
        digest
    }

    pub fn verify_by_tag(tag: Tag, bytes: &[u8], sum: &[u8]) -> bool {
        let len = tag.digest_len();
        if len == 0 {
            return false;
        }
        let digest = Self::hash_by_tag(tag, bytes);
        strings::eql_long(&digest[0..len], &sum[0..len], true)
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

/// Additional digests of the strongest algorithm found in a multi-entry SSRI
/// string (see [`Integrity::parse_with_alternates`]). The primary digest lives
/// in a companion [`Integrity`]; these are the others that must also be
/// accepted at verify time. The lockfile writer re-emits them next to the
/// primary so the multi-digest shape round-trips. Empty (no heap allocation)
/// in the common single-digest case.
#[derive(Clone)]
pub struct IntegrityAlternates {
    pub tag: Tag,
    pub values: Box<[[u8; DIGEST_BUF_LEN]]>,
}

impl Default for IntegrityAlternates {
    #[inline]
    fn default() -> Self {
        Self {
            tag: Tag::UNKNOWN,
            values: Box::default(),
        }
    }
}

impl IntegrityAlternates {
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// Iterate the stored alternate digests as `Integrity` values, for
    /// re-emitting them in the lockfile next to the primary.
    pub fn iter(&self) -> impl Iterator<Item = Integrity> + '_ {
        let tag = self.tag;
        self.values
            .iter()
            .map(move |value| Integrity { tag, value: *value })
    }

    /// True if `digest` (already computed with `tag`) equals any alternate.
    pub fn matches(&self, tag: Tag, digest: &[u8]) -> bool {
        if self.tag != tag || self.values.is_empty() {
            return false;
        }
        let len = tag.digest_len();
        if len == 0 || digest.len() < len {
            return false;
        }
        self.values
            .iter()
            .any(|v| strings::eql_long(&v[0..len], &digest[0..len], true))
    }
}

// Any u8 must be a valid bit pattern, since this is read from on-disk
// lockfiles. A `#[repr(u8)] enum` would be UB for unknown discriminants, so we
// use a transparent newtype with associated consts instead.
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
pub(crate) struct Streaming {
    pub expected: Integrity,
    /// Other accepted digests of `expected.tag` (SSRI any-match).
    pub alternates: IntegrityAlternates,
    pub hasher: Hasher,
}

pub(crate) enum Hasher {
    None,
    Sha1(Crypto::SHA1),
    Sha256(Crypto::SHA256),
    Sha384(Crypto::SHA384),
    Sha512(Crypto::SHA512),
}

impl Streaming {
    pub(crate) fn init(
        expected: &Integrity,
        alternates: &IntegrityAlternates,
        compute_if_missing: bool,
    ) -> Streaming {
        Streaming {
            expected: *expected,
            alternates: alternates.clone(),
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

    pub(crate) fn update(&mut self, bytes: &[u8]) {
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

    pub(crate) fn final_(&mut self) -> Integrity {
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
    pub(crate) fn verify(&mut self) -> bool {
        if !self.expected.tag.is_supported() {
            return true;
        }
        let computed = self.final_();
        if computed.tag != self.expected.tag {
            return false;
        }
        let len = self.expected.tag.digest_len();
        if strings::eql_long(&computed.value[0..len], &self.expected.value[0..len], true) {
            return true;
        }
        // SSRI any-match: accept any other digest of the strongest algorithm.
        self.alternates.matches(computed.tag, &computed.value)
    }
}

// Assert Integrity::default().value is all-zero.
const _: () = {
    let buf = EMPTY_DIGEST_BUF;
    let mut i = 0;
    while i < DIGEST_BUF_LEN {
        assert!(buf[i] == 0, "Integrity buffer is not zeroed");
        i += 1;
    }
};
