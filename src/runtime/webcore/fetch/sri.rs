//! WHATWG Subresource Integrity metadata for `fetch(url, { integrity })`.
//!
//! <https://w3c.github.io/webappsec-subresource-integrity/#parse-metadata>

use bun_install::integrity::{Integrity, Tag};

/// The `TypeError` message for a subresource-integrity mismatch. Shared by
/// every response path that can fail the check (the `FetchTasklet` HTTP path
/// and the `data:` URL fast path) so the two are observably identical.
pub const MISMATCH_MESSAGE: &str = "Integrity check failed: the response body does not match the digest in the request's 'integrity' option";

/// The parsed `integrity` request option: the digests of the strongest
/// recognized algorithm group. Per spec, the response body matches when
/// *any* digest in that group matches.
pub struct IntegrityMetadata {
    digests: Vec<Integrity>,
}

impl IntegrityMetadata {
    /// Parse a whitespace-separated list of `<alg>-<base64>[?options]` tokens.
    ///
    /// Returns `None` when no token names a recognized SRI hash algorithm
    /// (sha256 / sha384 / sha512). The spec treats that set as empty, which
    /// means "no integrity", so the fetch proceeds unchecked.
    pub fn parse(metadata: &[u8]) -> Option<IntegrityMetadata> {
        let mut digests: Vec<Integrity> = Vec::new();
        let mut strongest = Tag::UNKNOWN;

        for token in metadata.split(|b: &u8| b.is_ascii_whitespace()) {
            // `?` introduces unrecognized option-expressions; strip them.
            let token = match token.iter().position(|&b| b == b'?') {
                Some(q) => &token[..q],
                None => token,
            };
            let Some(dash) = token.iter().position(|&b| b == b'-') else {
                continue;
            };

            // The algorithm token is case-insensitive. sha1 is deliberately
            // absent: SRI only recognizes sha256/sha384/sha512.
            let mut normalized = token.to_vec();
            normalized[..dash].make_ascii_lowercase();
            let tag = match &normalized[..dash] {
                b"sha256" => Tag::SHA256,
                b"sha384" => Tag::SHA384,
                b"sha512" => Tag::SHA512,
                _ => continue,
            };
            // SRI accepts both the standard and URL-safe base64 alphabets.
            for b in &mut normalized[dash + 1..] {
                match *b {
                    b'-' => *b = b'+',
                    b'_' => *b = b'/',
                    _ => {}
                }
            }

            // A recognized algorithm whose value fails to decode is still a
            // *present* entry per spec, not an absent one: it contributes to
            // the strongest-group selection and can never match the body.
            let mut parsed = Integrity::parse(&normalized);
            if parsed.tag != tag {
                parsed = Integrity {
                    tag,
                    ..Integrity::default()
                };
            }

            if tag.0 > strongest.0 {
                strongest = tag;
            }
            digests.push(parsed);
        }

        if strongest == Tag::UNKNOWN {
            return None;
        }
        digests.retain(|d| d.tag == strongest);
        Some(IntegrityMetadata { digests })
    }

    /// <https://w3c.github.io/webappsec-subresource-integrity/#does-response-match-metadatalist>
    pub fn matches(&self, bytes: &[u8]) -> bool {
        self.digests.iter().any(|d| d.verify(bytes))
    }
}
