//! The errors of a request.

/// Why a request failed. The numbers are c-ares's `ARES_E*`, which `node:dns` reports as `errno`.
#[repr(i32)]
#[allow(non_camel_case_types)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, thiserror::Error)]
pub enum Error {
    #[error("No data record of requested type")]
    ENODATA = 1,
    #[error("Malformed DNS query")]
    EFORMERR = 2,
    #[error("Server failed to complete the DNS operation")]
    ESERVFAIL = 3,
    #[error("Domain name not found")]
    ENOTFOUND = 4,
    #[error("DNS resolver does not implement requested operation")]
    ENOTIMP = 5,
    #[error("DNS operation refused")]
    EREFUSED = 6,
    #[error("Misformatted DNS query")]
    EBADQUERY = 7,
    #[error("Misformatted domain name")]
    EBADNAME = 8,
    #[error("Misformatted DNS query (family)")]
    EBADFAMILY = 9,
    #[error("Misformatted DNS reply")]
    EBADRESP = 10,
    #[error("Could not contact DNS servers")]
    ECONNREFUSED = 11,
    #[error("Timeout while contacting DNS servers")]
    ETIMEOUT = 12,
    #[error("Error reading file")]
    EFILE = 14,
    #[error("Out of memory")]
    ENOMEM = 15,
    #[error("Channel is being destroyed")]
    EDESTRUCTION = 16,
    #[error("Misformatted string")]
    EBADSTR = 17,
    #[error("Illegal flags specified")]
    EBADFLAGS = 18,
    #[error("Illegal hints flags specified")]
    EBADHINTS = 20,
    #[error("DNS query cancelled")]
    ECANCELLED = 24,
    #[error("Service not available")]
    ESERVICE = 25,
    #[error("No DNS servers were configured")]
    ENOSERVER = 26,
    /// getaddrinfo(3)'s `EAI_AGAIN`, which no request of this crate fails with.
    #[error("Temporary failure in name resolution")]
    EAI_AGAIN = 27,
}

/// libuv's `UV_EAI_AGAIN`, the `errno` Node.js reports for getaddrinfo's `EAI_AGAIN`.
const UV_EAI_AGAIN: i32 = -3001;

impl Error {
    /// The JS-visible `errno`.
    pub fn errno(self) -> i32 {
        match self {
            Error::EAI_AGAIN => UV_EAI_AGAIN,
            _ => self as i32,
        }
    }

    /// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/errors.js#L807-L815
    pub fn as_node_reports_it(self) -> Error {
        match self {
            Error::ENODATA => Error::ENOTFOUND,
            other => other,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Error::ENODATA => "DNS_ENODATA",
            Error::EFORMERR => "DNS_EFORMERR",
            Error::ESERVFAIL => "DNS_ESERVFAIL",
            Error::ENOTFOUND => "DNS_ENOTFOUND",
            Error::ENOTIMP => "DNS_ENOTIMP",
            Error::EREFUSED => "DNS_EREFUSED",
            Error::EBADQUERY => "DNS_EBADQUERY",
            Error::EBADNAME => "DNS_ENOTFOUND",
            Error::EBADFAMILY => "DNS_EBADFAMILY",
            Error::EBADRESP => "DNS_EBADRESP",
            Error::ECONNREFUSED => "DNS_ECONNREFUSED",
            Error::ETIMEOUT => "DNS_ETIMEOUT",
            Error::EFILE => "DNS_EFILE",
            Error::ENOMEM => "DNS_ENOMEM",
            Error::EDESTRUCTION => "DNS_EDESTRUCTION",
            Error::EBADSTR => "DNS_EBADSTR",
            Error::EBADFLAGS => "DNS_EBADFLAGS",
            Error::EBADHINTS => "DNS_EBADHINTS",
            Error::ECANCELLED => "DNS_ECANCELLED",
            Error::ESERVICE => "DNS_ESERVICE",
            Error::ENOSERVER => "DNS_ENOSERVER",
            Error::EAI_AGAIN => "DNS_EAI_AGAIN",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
