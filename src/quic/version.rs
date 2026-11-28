//! What differs between the versions of QUIC (RFC 9001 §5, RFC 9369 §3).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Version {
    Draft29,
    V1,
    V2,
}

pub(crate) struct Labels {
    pub(crate) key: &'static str,
    pub(crate) iv: &'static str,
    pub(crate) header_protection: &'static str,
    pub(crate) key_update: &'static str,
}

impl Version {
    pub const fn number(self) -> u32 {
        match self {
            Self::Draft29 => 0xff00_001d,
            Self::V1 => 1,
            Self::V2 => 0x6b33_43cf,
        }
    }

    pub fn from_number(number: u32) -> Option<Self> {
        [Self::V1, Self::V2, Self::Draft29]
            .into_iter()
            .find(|version| version.number() == number)
    }

    /// As a list of one element (RFC 7301 §3.1).
    pub const fn http3_alpn(self) -> &'static [u8] {
        match self {
            Self::Draft29 => b"\x05h3-29",
            Self::V1 | Self::V2 => b"\x02h3",
        }
    }

    /// RFC 9369 §4.
    pub(crate) fn is_compatible_with(self, other: Self) -> bool {
        (self == Self::Draft29) == (other == Self::Draft29)
    }

    pub(crate) const fn initial_salt(self) -> &'static [u8; 20] {
        match self {
            Self::Draft29 => {
                b"\xaf\xbf\xec\x28\x99\x93\xd2\x4c\x9e\x97\x86\xf1\x9c\x61\x11\xe0\x43\x90\xa8\x99"
            }
            Self::V1 => {
                b"\x38\x76\x2c\xf7\xf5\x59\x34\xb3\x4d\x17\x9a\xe6\xa4\xc8\x0c\xad\xcc\xbb\x7f\x0a"
            }
            Self::V2 => {
                b"\x0d\xed\xe3\xde\xf7\x00\xa6\xdb\x81\x93\x81\xbe\x6e\x26\x9d\xcb\xf9\xbd\x2e\xd9"
            }
        }
    }

    pub(crate) const fn retry_key(self) -> &'static [u8; 16] {
        match self {
            Self::Draft29 => b"\xcc\xce\x18\x7e\xd0\x9a\x09\xd0\x57\x28\x15\x5a\x6c\xb9\x6b\xe1",
            Self::V1 => b"\xbe\x0c\x69\x0b\x9f\x66\x57\x5a\x1d\x76\x6b\x54\xe3\x68\xc8\x4e",
            Self::V2 => b"\x8f\xb4\xb0\x1b\x56\xac\x48\xe2\x60\xfb\xcb\xce\xad\x7c\xcc\x92",
        }
    }

    pub(crate) const fn retry_nonce(self) -> &'static [u8; 12] {
        match self {
            Self::Draft29 => b"\xe5\x49\x30\xf9\x7f\x21\x36\xf0\x53\x0a\x8c\x1c",
            Self::V1 => b"\x46\x15\x99\xd3\x5d\x63\x2b\xf2\x23\x98\x25\xbb",
            Self::V2 => b"\xd8\x69\x69\xbc\x2d\x7c\x6d\x99\x90\xef\xb0\x4a",
        }
    }

    pub(crate) const fn labels(self) -> &'static Labels {
        match self {
            Self::Draft29 | Self::V1 => &Labels {
                key: "quic key",
                iv: "quic iv",
                header_protection: "quic hp",
                key_update: "quic ku",
            },
            Self::V2 => &Labels {
                key: "quicv2 key",
                iv: "quicv2 iv",
                header_protection: "quicv2 hp",
                key_update: "quicv2 ku",
            },
        }
    }

    /// What is added to the type of a long header, modulo 4.
    pub(crate) const fn long_type_offset(self) -> u8 {
        match self {
            Self::Draft29 | Self::V1 => 0,
            Self::V2 => 1,
        }
    }
}
