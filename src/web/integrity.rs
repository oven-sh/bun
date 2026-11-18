//! https://w3c.github.io/webappsec-subresource-integrity/

use bun_core::strings;
use bun_sha_hmac::sha::evp;

use crate::Bytes;

crate::wire! {
    #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
    pub enum Algorithm {
        Sha256,
        Sha384,
        Sha512,
    }
}

crate::wire! {
    #[derive(Clone, PartialEq, Eq)]
    pub struct Hash {
        algorithm: Algorithm,
        /// In base64url, without padding.
        value: Bytes,
    }
}

pub(crate) fn is_base64_value(text: &[u8]) -> bool {
    let bare = text
        .strip_suffix(b"==")
        .or_else(|| text.strip_suffix(b"="))
        .unwrap_or(text);
    !bare.is_empty()
        && bare
            .iter()
            .all(|it| it.is_ascii_alphanumeric() || matches!(it, b'+' | b'/' | b'-' | b'_'))
}

impl Hash {
    /// `sha256-…`
    pub fn parse(text: &[u8]) -> Option<Hash> {
        let (name, value) =
            strings::split_once_char(text, b'-').filter(|it| is_base64_value(it.1))?;
        let algorithm = match &*name.to_ascii_lowercase() {
            b"sha256" => Algorithm::Sha256,
            b"sha384" => Algorithm::Sha384,
            b"sha512" => Algorithm::Sha512,
            _ => return None,
        };
        let url_safe = value.iter().filter_map(|it| match it {
            b'+' => Some(b'-'),
            b'/' => Some(b'_'),
            b'=' => None,
            _ => Some(*it),
        });
        Some(Hash {
            algorithm,
            value: url_safe.collect(),
        })
    }

    pub fn is_of(&self, bytes: &[u8]) -> bool {
        let (mut short, mut medium, mut long, mut encoded) = ([0; 32], [0; 48], [0; 64], [0; 88]);
        let digest: &[u8] = match self.algorithm {
            Algorithm::Sha256 => (evp::SHA256::hash(bytes, &mut short), &short).1,
            Algorithm::Sha384 => (evp::SHA384::hash(bytes, &mut medium), &medium).1,
            Algorithm::Sha512 => (evp::SHA512::hash(bytes, &mut long), &long).1,
        };
        let length = bun_base64::encode_url_safe(&mut encoded, digest);
        encoded[..length] == *self.value
    }
}

pub fn parse_metadata(metadata: &[u8]) -> Vec<Hash> {
    let without_options = |it| strings::split_once_char(it, b'?').map_or(it, |it| it.0);
    strings::tokenize_any(metadata, b"\t\n\x0c\r ")
        .map(|it| strings::trim_right(without_options(it), b"="))
        .filter_map(Hash::parse)
        .collect()
}

pub fn bytes_match_metadata(bytes: &[u8], metadata: &[u8]) -> bool {
    let hashes = parse_metadata(metadata);
    let Some(strongest) = hashes.iter().map(|it| it.algorithm).max() else {
        return true;
    };
    hashes
        .iter()
        .any(|it| it.algorithm == strongest && it.is_of(bytes))
}
