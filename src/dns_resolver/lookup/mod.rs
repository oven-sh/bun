//! Requests that take more than one query: `getaddrinfo()`, `gethostbyaddr()` and `getnameinfo()`.

mod addr_info;
mod host;
mod search;
mod sort;

pub(crate) use addr_info::AddrInfoLookup;
pub(crate) use host::HostLookup;

use crate::record::Name;

/// What a `struct hostent` says of an address.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Host {
    pub name: Name,
    /// From DNS, every name of the address, `name` among them. From the hosts file, the names after `name`.
    pub aliases: Vec<Name>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NameInfo {
    pub node: Name,
    /// `None` for port 0.
    pub service: Option<Vec<u8>>,
}

fn ends_with_ignore_case(name: &[u8], suffix: &[u8]) -> bool {
    name.len()
        .checked_sub(suffix.len())
        .and_then(|start| name.get(start..))
        .is_some_and(|end| end.eq_ignore_ascii_case(suffix))
}

/// RFC 7686: these names are not for the DNS.
pub(crate) fn is_onion_domain(name: &[u8]) -> bool {
    ends_with_ignore_case(name, b".onion") || ends_with_ignore_case(name, b".onion.")
}

/// RFC 6761 section 6.3.
fn is_localhost(name: &[u8]) -> bool {
    name.eq_ignore_ascii_case(b"localhost") || ends_with_ignore_case(name, b".localhost")
}
