/// Why a request failed. The numbers are c-ares's `ARES_E*`, which `node:dns` reports as `errno`.
#[repr(i32)]
#[allow(non_camel_case_types)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Error {
    ENODATA = 1,
    EFORMERR = 2,
    ESERVFAIL = 3,
    ENOTFOUND = 4,
    ENOTIMP = 5,
    EREFUSED = 6,
    EBADQUERY = 7,
    EBADNAME = 8,
    EBADFAMILY = 9,
    EBADRESP = 10,
    ECONNREFUSED = 11,
    ETIMEOUT = 12,
    EOF = 13,
    EFILE = 14,
    ENOMEM = 15,
    EDESTRUCTION = 16,
    EBADSTR = 17,
    EBADFLAGS = 18,
    ENONAME = 19,
    EBADHINTS = 20,
    ENOTINITIALIZED = 21,
    ELOADIPHLPAPI = 22,
    EADDRGETNETWORKPARAMS = 23,
    ECANCELLED = 24,
    ESERVICE = 25,
    ENOSERVER = 26,
    /// getaddrinfo(3)'s `EAI_AGAIN`, which no request of this crate fails with.
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
            Error::ENODATA | Error::ENONAME => Error::ENOTFOUND,
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
            Error::EOF => "DNS_EOF",
            Error::EFILE => "DNS_EFILE",
            Error::ENOMEM => "DNS_ENOMEM",
            Error::EDESTRUCTION => "DNS_EDESTRUCTION",
            Error::EBADSTR => "DNS_EBADSTR",
            Error::EBADFLAGS => "DNS_EBADFLAGS",
            Error::ENONAME => "DNS_ENOTFOUND",
            Error::EBADHINTS => "DNS_EBADHINTS",
            Error::ENOTINITIALIZED => "DNS_ENOTINITIALIZED",
            Error::ELOADIPHLPAPI => "DNS_ELOADIPHLPAPI",
            Error::EADDRGETNETWORKPARAMS => "DNS_EADDRGETNETWORKPARAMS",
            Error::ECANCELLED => "DNS_ECANCELLED",
            Error::ESERVICE => "DNS_ESERVICE",
            Error::ENOSERVER => "DNS_ENOSERVER",
            Error::EAI_AGAIN => "DNS_EAI_AGAIN",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Error::ENODATA => "No data record of requested type",
            Error::EFORMERR => "Malformed DNS query",
            Error::ESERVFAIL => "Server failed to complete the DNS operation",
            Error::ENOTFOUND => "Domain name not found",
            Error::ENOTIMP => "DNS resolver does not implement requested operation",
            Error::EREFUSED => "DNS operation refused",
            Error::EBADQUERY => "Misformatted DNS query",
            Error::EBADNAME => "Misformatted domain name",
            Error::EBADFAMILY => "Misformatted DNS query (family)",
            Error::EBADRESP => "Misformatted DNS reply",
            Error::ECONNREFUSED => "Could not contact DNS servers",
            Error::ETIMEOUT => "Timeout while contacting DNS servers",
            Error::EOF => "End of file",
            Error::EFILE => "Error reading file",
            Error::ENOMEM => "Out of memory",
            Error::EDESTRUCTION => "Channel is being destroyed",
            Error::EBADSTR => "Misformatted string",
            Error::EBADFLAGS => "Illegal flags specified",
            Error::ENONAME => "Given hostname is not numeric",
            Error::EBADHINTS => "Illegal hints flags specified",
            Error::ENOTINITIALIZED => "Library initialization not yet performed",
            Error::ELOADIPHLPAPI => "ELOADIPHLPAPI TODO WHAT DOES THIS MEAN",
            Error::EADDRGETNETWORKPARAMS => "EADDRGETNETWORKPARAMS",
            Error::ECANCELLED => "DNS query cancelled",
            Error::ESERVICE => "Service not available",
            Error::ENOSERVER => "No DNS servers were configured",
            Error::EAI_AGAIN => "Temporary failure in name resolution",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
