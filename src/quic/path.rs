use core::net::SocketAddr;

/// RFC 9000 §8.1.
pub(crate) const AMPLIFICATION_FACTOR: usize = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Addresses {
    pub local: SocketAddr,
    pub peer: SocketAddr,
}

/// What an application names can lack it.
#[inline]
pub(crate) fn without_zone(address: SocketAddr) -> SocketAddr {
    SocketAddr::new(address.ip(), address.port())
}

/// For UDP services that answer whatever they get (RFC 9308 §8.1).
pub(crate) fn is_reserved_port(port: u16) -> bool {
    matches!(
        port,
        0 | 7
            | 17
            | 19
            | 53
            | 111
            | 123
            | 137
            | 138
            | 161
            | 389
            | 500
            | 1900
            | 3702
            | 5353
            | 5355
            | 11211
    )
}
