//! Where a client connects.

use bstr::BStr;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sys::SystemErrno;
use bun_uws::{self as uws, AnySocket, SocketGroup, SocketKind, SslCtx};

/// Valkey protocol types (standalone, TLS, Unix socket)
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum Protocol {
    Standalone,
    StandaloneUnix,
    StandaloneTls,
    StandaloneTlsUnix,
}

bun_core::comptime_string_map! {
    pub(crate) static PROTOCOL_MAP: Protocol = {
        b"valkey" => Protocol::Standalone,
        b"valkeys" => Protocol::StandaloneTls,
        b"valkey+tls" => Protocol::StandaloneTls,
        b"valkey+unix" => Protocol::StandaloneUnix,
        b"valkey+tls+unix" => Protocol::StandaloneTlsUnix,
        b"redis" => Protocol::Standalone,
        b"rediss" => Protocol::StandaloneTls,
        b"redis+tls" => Protocol::StandaloneTls,
        b"redis+unix" => Protocol::StandaloneUnix,
        b"redis+tls+unix" => Protocol::StandaloneTlsUnix,
    };
}

impl Protocol {
    // `static` items are not allowed in `impl` blocks, so the map lives at
    // module level; this keeps the `Protocol::MAP` path for call sites.
    pub(crate) const MAP: &'static __ComptimeStringMap_PROTOCOL_MAP = &PROTOCOL_MAP;

    pub(crate) fn is_tls(self) -> bool {
        matches!(self, Protocol::StandaloneTls | Protocol::StandaloneTlsUnix)
    }
}

#[derive(Default, Clone)]
pub(crate) enum TLS {
    #[default]
    None,
    Enabled,
    Custom(Box<bun_http::ssl_config::Builder>),
}

impl TLS {
    pub(crate) fn reject_unauthorized(&self, vm: &VirtualMachine) -> bool {
        match self {
            TLS::Custom(given) => given.reject_unauthorized != Some(false),
            TLS::Enabled => vm.get_tls_reject_unauthorized(),
            _ => false,
        }
    }

    /// `tls.serverName`: replaces the URL host as SNI and as the name the certificate must match.
    pub(crate) fn server_name(&self) -> Option<&[u8]> {
        match self {
            TLS::Custom(given) => given.server_name_bytes().filter(|name| !name.is_empty()),
            _ => None,
        }
    }
}

/// Where the URL is from.
#[derive(Copy, Clone)]
pub(crate) enum Origin {
    Given,
    DefaultForUnset,
    DefaultForEmptyRedisUrl,
    DefaultForEmptyValkeyUrl,
}

impl Origin {
    pub(crate) fn url_from_env(env: &bun_dotenv::Loader) -> (&[u8], Origin) {
        let origin = match env.get(b"REDIS_URL") {
            Some(url @ [_, ..]) => return (url, Origin::Given),
            redis_url => match (redis_url, env.get(b"VALKEY_URL")) {
                (_, Some(url @ [_, ..])) => return (url, Origin::Given),
                (Some(_), _) => Origin::DefaultForEmptyRedisUrl,
                (None, Some(_)) => Origin::DefaultForEmptyValkeyUrl,
                (None, None) => Origin::DefaultForUnset,
            },
        };
        (b"valkey://localhost:6379", origin)
    }

    /// Behind the address in an error.
    fn note(self) -> &'static str {
        match self {
            Origin::Given => "",
            Origin::DefaultForUnset => " (REDIS_URL is not set)",
            Origin::DefaultForEmptyRedisUrl => " (REDIS_URL is empty)",
            Origin::DefaultForEmptyValkeyUrl => " (VALKEY_URL is empty)",
        }
    }
}

#[derive(Clone)]
pub(crate) enum Address {
    Unix(Box<[u8]>),
    Host {
        host: Box<[u8]>,
        port: u16,
        origin: Origin,
    },
}

impl Address {
    /// In the words of `node:net`. `None` for a dial that was closed and did not fail.
    pub(crate) fn connect_error(&self, code: i32) -> Option<String> {
        let errno = match SystemErrno::init(i64::from(code))? {
            SystemErrno::SUCCESS | SystemErrno::ECANCELED => return None,
            // Windows: what uSockets' probe of a refused socket gets, and the number of the CRT's ECONNREFUSED.
            SystemErrno::ENOTCONN => SystemErrno::ECONNREFUSED,
            errno => errno,
        };
        Some(match self {
            Address::Unix(path) => format!("connect {errno} {}", BStr::new(path)),
            Address::Host { host, port, origin } => {
                let host = BStr::new(bun_core::ip_address::strip_ipv6_brackets(host));
                format!("connect {errno} {host}:{port}{}", origin.note())
            }
        })
    }

    pub(crate) fn lookup_error(&self, code: i32) -> Option<String> {
        let (Address::Unix(host) | Address::Host { host, .. }) = self;
        let code = bun_dns::getaddrinfo_error(code)?.code();
        let code = code.strip_prefix("DNS_").unwrap_or(code);
        Some(format!("getaddrinfo {code} {}", BStr::new(host)))
    }

    /// Open a TCP/TLS/Unix socket via
    /// `uws::Socket{TLS,TCP}::connect_*_group`.
    ///
    /// `Owner` is the userdata pointer stashed in the socket ext (the
    /// `JSValkeyClient` parent in practice — that's what `SocketHandler<SSL>`
    /// pulls back out on event dispatch). Generic so the caller controls the
    /// stored type; this fn only forwards it opaquely to `connect_*_group`.
    pub(crate) fn connect<Owner>(
        &self,
        owner: *mut Owner,
        group: &SocketGroup,
        ssl_ctx: Option<*mut SslCtx>,
        is_tls: bool,
    ) -> Result<AnySocket, crate::Error> {
        if is_tls {
            let kind = SocketKind::ValkeyTls;
            let sock = match self {
                Address::Unix(path) => {
                    uws::SocketTLS::connect_unix_group(group, kind, ssl_ctx, path, owner)?
                }
                Address::Host { host, port, .. } => uws::SocketTLS::connect_group(
                    group,
                    kind,
                    ssl_ctx,
                    host,
                    i32::from(*port),
                    owner,
                )?,
            };
            Ok(AnySocket::SocketTls(sock))
        } else {
            let kind = SocketKind::Valkey;
            let sock = match self {
                Address::Unix(path) => {
                    uws::SocketTCP::connect_unix_group(group, kind, ssl_ctx, path, owner)?
                }
                Address::Host { host, port, .. } => uws::SocketTCP::connect_group(
                    group,
                    kind,
                    ssl_ctx,
                    host,
                    i32::from(*port),
                    owner,
                )?,
            };
            Ok(AnySocket::SocketTcp(sock))
        }
    }
}
