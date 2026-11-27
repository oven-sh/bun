/// The values are the `errno` that JavaScript sees.
#[repr(i32)]
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
    ENOMEM = 15,
    EDESTRUCTION = 16,
    EBADSTR = 17,
    EBADFLAGS = 18,
    EBADHINTS = 20,
    ECANCELLED = 24,
    ESERVICE = 25,
    ENOSERVER = 26,
    /// `UV_EAI_AGAIN`
    #[allow(non_camel_case_types)]
    EAI_AGAIN = -3001,
}

impl Error {
    pub fn code(self) -> &'static str {
        match self {
            Error::ENODATA => "DNS_ENODATA",
            Error::ENOTFOUND | Error::EBADNAME => "DNS_ENOTFOUND",
            Error::EFORMERR => "DNS_EFORMERR",
            Error::ESERVFAIL => "DNS_ESERVFAIL",
            Error::ENOTIMP => "DNS_ENOTIMP",
            Error::EREFUSED => "DNS_EREFUSED",
            Error::EBADQUERY => "DNS_EBADQUERY",
            Error::EBADFAMILY => "DNS_EBADFAMILY",
            Error::EBADRESP => "DNS_EBADRESP",
            Error::ECONNREFUSED => "DNS_ECONNREFUSED",
            Error::ETIMEOUT => "DNS_ETIMEOUT",
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
