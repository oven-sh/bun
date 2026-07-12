//! Closed-world socket dispatch tag. Discriminants FROZEN — identical to
//! `src/uws_sys/SocketKind.rs` (cabi-surface.md §3.8). Adoption families per
//! api.md §Strategy 3.

/// Stamped on the socket at creation; dispatch switches on it.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SocketKind {
    /// Reserved zero value — dispatch on it is crash-by-design.
    Invalid = 0,
    /// Dispatch reads `group->vtable->on_*` (uWS C++ per-App vtable, tests).
    Dynamic = 1,
    BunSocketTcp = 2,
    BunSocketTls = 3,
    /// ABI-reserved (frozen discriminant): nothing stamps this since P6 —
    /// accepted sockets are born `BunSocket*` and listener headers stay
    /// `Invalid`. Kept so `from_u8` stays total over the frozen 0..=22 range.
    BunListenerTcp = 4,
    /// ABI-reserved; see [`SocketKind::BunListenerTcp`].
    BunListenerTls = 5,
    HttpClient = 6,
    HttpClientTls = 7,
    WsClientUpgrade = 8,
    WsClientUpgradeTls = 9,
    WsClient = 10,
    WsClientTls = 11,
    Postgres = 12,
    PostgresTls = 13,
    Mysql = 14,
    MysqlTls = 15,
    Valkey = 16,
    ValkeyTls = 17,
    SpawnIpc = 18,
    UwsHttp = 19,
    UwsHttpTls = 20,
    UwsWs = 21,
    UwsWsTls = 22,
    /// `bun test --parallel` coordinator↔worker channel. Rust-only kind,
    /// appended after the frozen cabi range — never crosses the C boundary
    /// (`cabi::kind_from_c` still tops out at `UwsWsTls`).
    TestChannel = 23,
}

impl SocketKind {
    /// Checked conversion from a raw `u8` (an invalid discriminant in a
    /// `#[repr(u8)]` enum is immediate UB, so this stays an exhaustive match).
    #[inline]
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => SocketKind::Invalid,
            1 => SocketKind::Dynamic,
            2 => SocketKind::BunSocketTcp,
            3 => SocketKind::BunSocketTls,
            4 => SocketKind::BunListenerTcp,
            5 => SocketKind::BunListenerTls,
            6 => SocketKind::HttpClient,
            7 => SocketKind::HttpClientTls,
            8 => SocketKind::WsClientUpgrade,
            9 => SocketKind::WsClientUpgradeTls,
            10 => SocketKind::WsClient,
            11 => SocketKind::WsClientTls,
            12 => SocketKind::Postgres,
            13 => SocketKind::PostgresTls,
            14 => SocketKind::Mysql,
            15 => SocketKind::MysqlTls,
            16 => SocketKind::Valkey,
            17 => SocketKind::ValkeyTls,
            18 => SocketKind::SpawnIpc,
            19 => SocketKind::UwsHttp,
            20 => SocketKind::UwsHttpTls,
            21 => SocketKind::UwsWs,
            22 => SocketKind::UwsWsTls,
            23 => SocketKind::TestChannel,
            _ => unreachable!("invalid SocketKind discriminant {v}"),
        }
    }

    #[inline]
    pub const fn is_tls(self) -> bool {
        matches!(
            self,
            SocketKind::BunSocketTls
                | SocketKind::BunListenerTls
                | SocketKind::HttpClientTls
                | SocketKind::WsClientUpgradeTls
                | SocketKind::WsClientTls
                | SocketKind::PostgresTls
                | SocketKind::MysqlTls
                | SocketKind::ValkeyTls
                | SocketKind::UwsHttpTls
                | SocketKind::UwsWsTls
        )
    }

    /// Kinds whose handlers live in C++ (dispatch goes through the group
    /// vtable and `group->ext` is the templated `HttpContext<SSL>*`).
    #[inline]
    pub const fn is_uws(self) -> bool {
        matches!(
            self,
            SocketKind::UwsHttp | SocketKind::UwsHttpTls | SocketKind::UwsWs | SocketKind::UwsWsTls
        )
    }

}
