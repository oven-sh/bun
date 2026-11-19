use core::net::SocketAddr;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Addresses {
    pub local: SocketAddr,
    pub peer: SocketAddr,
}
