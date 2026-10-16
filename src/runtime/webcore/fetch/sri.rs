//! The `integrity` option of `fetch()`: <https://w3c.github.io/webappsec-subresource-integrity/>.

use bun_base64::zig_base64::{STANDARD, STANDARD_NO_PAD};
use bun_core::String as BunString;
use bun_core::strings;
use bun_jsc::SystemError;
use bun_sha_hmac::sha;

use crate::webcore::body::ValueError as BodyValueError;

const MAX_DIGEST_LEN: usize = sha::SHA512::DIGEST;
/// The base64 digits of a SHA-512 digest, with padding.
const MAX_BASE64_LEN: usize = MAX_DIGEST_LEN.div_ceil(3) * 4;

/// A hash algorithm that integrity metadata can name. The order is the strength: the weakest is first.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Algorithm {
    Sha256,
    Sha384,
    Sha512,
}

impl Algorithm {
    const ALL: [Algorithm; 3] = [Algorithm::Sha256, Algorithm::Sha384, Algorithm::Sha512];

    fn named(name: &[u8]) -> Option<Algorithm> {
        Self::ALL.into_iter().find(|algorithm| {
            strings::eql_case_insensitive_ascii(name, algorithm.name().as_bytes(), true)
        })
    }

    fn name(self) -> &'static str {
        match self {
            Algorithm::Sha256 => "sha256",
            Algorithm::Sha384 => "sha384",
            Algorithm::Sha512 => "sha512",
        }
    }

    fn digest_len(self) -> usize {
        match self {
            Algorithm::Sha256 => sha::SHA256::DIGEST,
            Algorithm::Sha384 => sha::SHA384::DIGEST,
            Algorithm::Sha512 => sha::SHA512::DIGEST,
        }
    }

    /// The digest of `bytes`, in the first `digest_len()` bytes of the result.
    fn digest(self, bytes: &[u8]) -> [u8; MAX_DIGEST_LEN] {
        let mut out = [0u8; MAX_DIGEST_LEN];
        macro_rules! hash {
            ($Hasher:ty) => {{
                let mut digest = [0u8; <$Hasher>::DIGEST];
                let mut hasher = <$Hasher>::init();
                hasher.update(bytes);
                hasher.r#final(&mut digest);
                out[..digest.len()].copy_from_slice(&digest);
            }};
        }
        match self {
            Algorithm::Sha256 => hash!(sha::SHA256),
            Algorithm::Sha384 => hash!(sha::SHA384),
            Algorithm::Sha512 => hash!(sha::SHA512),
        }
        out
    }
}

/// Integrity metadata that is not the empty string, parsed: the digests of the strongest algorithm that it names.
pub(crate) struct Metadata {
    /// `None`: the metadata names no supported algorithm, so every body matches.
    algorithm: Option<Algorithm>,
    /// The values of `algorithm` that are one of its digests. With none of them, no body matches.
    digests: Vec<[u8; MAX_DIGEST_LEN]>,
}

/// Why a fetch with `integrity` does not give its caller a `Response`.
pub(crate) enum Failure {
    /// The body does not have a digest that the metadata lists. `digest` is the one that it has.
    Mismatch {
        algorithm: Algorithm,
        digest: [u8; MAX_DIGEST_LEN],
    },
    /// The strongest algorithm in the metadata has no value that is one of its digests.
    NoValidDigest(Algorithm),
    /// The response has no body: <https://fetch.spec.whatwg.org/#main-fetch>, step 22.
    NullBody,
    /// A kind of request whose whole response body fetch() does not have before the promise settles.
    Unsupported,
}

impl Metadata {
    /// `None` for the empty string, which asks for no check.
    pub(crate) fn parse(metadata: &[u8]) -> Option<Box<Metadata>> {
        if metadata.is_empty() {
            return None;
        }
        let mut parsed = Metadata {
            algorithm: None,
            digests: Vec::new(),
        };
        for token in strings::tokenize_any(metadata, b" \t\n\x0C\r") {
            let expression = match strings::index_of_char_usize(token, b'?') {
                Some(options) => &token[..options],
                None => token,
            };
            let (name, value) =
                strings::split_once_char(expression, b'-').unwrap_or((expression, &[]));
            let Some(algorithm) = Algorithm::named(name) else {
                continue;
            };
            if parsed
                .algorithm
                .is_some_and(|strongest| algorithm < strongest)
            {
                continue;
            }
            if parsed.algorithm != Some(algorithm) {
                parsed.algorithm = Some(algorithm);
                parsed.digests.clear();
            }
            // A value that is not a digest of its algorithm adds nothing, but its algorithm still counts as named.
            if let Some(digest) = decode_digest(algorithm, value) {
                parsed.digests.push(digest);
            }
        }
        Some(Box::new(parsed))
    }

    /// Whether a body has to be hashed to know if the metadata allows it.
    pub(crate) fn names_algorithm(&self) -> bool {
        self.algorithm.is_some()
    }

    /// Whether `body` is what the metadata allows. The body is hashed once, and not at all when nothing can match it.
    pub(crate) fn check(&self, body: &[u8]) -> Result<(), Failure> {
        let Some(algorithm) = self.algorithm else {
            return Ok(());
        };
        if self.digests.is_empty() {
            return Err(Failure::NoValidDigest(algorithm));
        }
        let digest = algorithm.digest(body);
        let len = algorithm.digest_len();
        if self
            .digests
            .iter()
            .any(|expected| expected[..len] == digest[..len])
        {
            return Ok(());
        }
        Err(Failure::Mismatch { algorithm, digest })
    }
}

/// The bytes of `value` when it is the base64 or base64url form of one digest of `algorithm`, with or without padding.
fn decode_digest(algorithm: Algorithm, value: &[u8]) -> Option<[u8; MAX_DIGEST_LEN]> {
    let mut buffer = [0u8; MAX_BASE64_LEN];
    let standard = buffer.get_mut(..value.len())?;
    for (to, &from) in standard.iter_mut().zip(value) {
        *to = match from {
            b'-' => b'+',
            b'_' => b'/',
            other => other,
        };
    }
    let mut digits: &[u8] = standard;
    for _ in 0..2 {
        if let [rest @ .., b'='] = digits {
            digits = rest;
        }
    }
    let decoder = &STANDARD_NO_PAD.decoder;
    let len = algorithm.digest_len();
    if decoder.calc_size_for_slice(digits).ok()? != len {
        return None;
    }
    let mut digest = [0u8; MAX_DIGEST_LEN];
    decoder.decode(&mut digest[..len], digits).ok()?;
    Some(digest)
}

impl Failure {
    /// The `TypeError` that fetch() rejects with. `url` is the URL of the response, or of the request when there is none.
    pub(crate) fn into_error(self, url: BunString) -> BodyValueError {
        let message = match self {
            Failure::Mismatch { algorithm, digest } => {
                let mut base64 = [0u8; MAX_BASE64_LEN];
                let digest = STANDARD
                    .encoder
                    .encode(&mut base64, &digest[..algorithm.digest_len()]);
                BunString::create_format(format_args!(
                    "Integrity check failed: the response body has the digest \"{}-{}\", which is not in the 'integrity' option",
                    algorithm.name(),
                    bstr::BStr::new(digest),
                ))
            }
            Failure::NoValidDigest(algorithm) => BunString::create_format(format_args!(
                "Integrity check failed: the 'integrity' option has no valid {} digest",
                algorithm.name(),
            )),
            Failure::NullBody => BunString::static_(
                "Integrity check failed: a response without a body cannot match the 'integrity' option",
            ),
            Failure::Unsupported => BunString::static_(
                "Integrity check failed: fetch() cannot check the response to this kind of request against the 'integrity' option",
            ),
        };
        BodyValueError::SystemTypeError(SystemError {
            code: BunString::static_("IntegrityCheckFailed"),
            message,
            path: url,
            ..Default::default()
        })
    }
}
