//! Valkey/Redis client — JSC bindings.
//!
//! B-2 un-gate: type surface for `ValkeyClient` (the protocol/state machine)
//! and `JSValkeyClient` (the `.classes.ts` wrapper). Full method bodies stay
//! gated in the Phase-A drafts — they need `bun_jsc` surface that doesn't
//! exist yet (`JSPromise.Strong`, `Error::REDIS_*`, `node::BlobOrStringOrBuffer`,
//! `webcore::AutoFlusher`, `codegen::JSRedisClient`).

use core::cell::Cell;
use core::ffi::c_void;

use bun_aio::KeepAlive;
use bun_collections::{LinearFifo, OffsetByteList};
use bun_collections::linear_fifo::DynamicBuffer;
use bun_uws::{self as uws, AnySocket, SocketGroup};
use bun_valkey::valkey_protocol as protocol;
use bun_valkey::valkey_protocol::RedisError;

use crate::jsc::{JSGlobalObject, JSValue, JsRef};

// ─── gated Phase-A drafts (preserved on disk, not compiled) ──────────────────

#[path = "valkey.rs"]
pub mod valkey_body; // ValkeyClient methods, DeferredFailure::run, fail/reject paths

#[path = "js_valkey.rs"]
pub mod js_valkey_body; // JSValkeyClient host fns, SocketHandler, constructor

#[path = "js_valkey_functions.rs"]
pub mod js_valkey_functions; // 200+ prototype methods (get/set/hget/…)

#[path = "ValkeyCommand.rs"]
pub mod valkey_command_body; // Command::serialize, Promise::resolve/reject

#[path = "index.rs"]
pub mod index;

// ─── compiling submodules ────────────────────────────────────────────────────
#[path = "ValkeyContext.rs"]
pub mod valkey_context;
pub use valkey_context::ValkeyContext;

#[path = "protocol_jsc.rs"]
pub mod protocol_jsc; // RESPValue → JSValue, RedisError → JS Error
pub use protocol_jsc::{resp_value_to_js, resp_value_to_js_with_options, valkey_error_to_js, ToJSOptions};

// ─── real type surface (B-2 struct/state un-gate) ────────────────────────────
// Method bodies remain in the gated drafts above — they need:
//   TODO(b2-blocked): bun_jsc::Error::REDIS_* / JSGlobalObject::err_redis_*
//   TODO(b2-blocked): bun_jsc::JSPromise::Strong (JSPromiseStrong)
//   TODO(b2-blocked): bun_jsc::node::BlobOrStringOrBuffer
//   TODO(b2-blocked): bun_jsc::webcore::AutoFlusher
//   TODO(b2-blocked): bun_jsc::codegen::JSRedisClient (cached-slot accessors)
//   TODO(b2-blocked): crate::server::server_config::SSLConfig (TLS::Custom)

// ── ValkeyCommand ────────────────────────────────────────────────────────────
pub mod valkey_command {
    use super::*;

    // Zig's `ValkeyCommand.zig` is a file-as-struct: it is both the namespace
    // *and* the `Command` type. `index.rs` re-exports it via
    // `super::valkey_command::ValkeyCommand`, so surface the module alias here
    // publicly (the parent's `pub use valkey_command as ValkeyCommand` only
    // reached this scope through the private `use super::*` glob).
    pub use super::ValkeyCommand;

    bitflags::bitflags! {
        #[repr(transparent)]
        #[derive(Clone, Copy, PartialEq, Eq)]
        pub struct Meta: u8 {
            const RETURN_AS_BOOL           = 1 << 0;
            const SUPPORTS_AUTO_PIPELINING = 1 << 1;
            const RETURN_AS_BUFFER         = 1 << 2;
            const SUBSCRIPTION_REQUEST     = 1 << 3;
        }
    }
    impl Default for Meta {
        fn default() -> Self {
            Meta::SUPPORTS_AUTO_PIPELINING
        }
    }

    /// Promise for a Valkey command.
    pub struct Promise {
        pub meta: Meta,
        // TODO(b2-blocked): jsc.JSPromise.Strong — erased until un-gated.
        pub promise: crate::jsc::Strong,
    }

    /// Command stored in offline queue when disconnected.
    pub struct Entry {
        pub serialized_data: Box<[u8]>,
        pub meta: Meta,
        pub promise: Promise,
    }

    pub struct PromisePair {
        pub meta: Meta,
        pub promise: Promise,
    }

    pub mod entry {
        pub type Queue = super::LinearFifo<super::Entry, super::DynamicBuffer<super::Entry>>;
    }
    pub mod promise_pair {
        pub type Queue =
            super::LinearFifo<super::PromisePair, super::DynamicBuffer<super::PromisePair>>;
    }
}
pub use valkey_command as ValkeyCommand;

// ── valkey (core client) ─────────────────────────────────────────────────────
pub mod valkey {
    use super::*;

    /// Connection flags to track Valkey client state.
    pub struct ConnectionFlags {
        pub is_authenticated: bool,
        pub is_manually_closed: bool,
        pub is_selecting_db_internal: bool,
        pub enable_offline_queue: bool,
        pub needs_to_open_socket: bool,
        pub enable_auto_reconnect: bool,
        pub is_reconnecting: bool,
        pub failed: bool,
        pub enable_auto_pipelining: bool,
        pub finalized: bool,
        pub connection_promise_returns_client: bool,
    }
    impl Default for ConnectionFlags {
        fn default() -> Self {
            Self {
                is_authenticated: false,
                is_manually_closed: false,
                is_selecting_db_internal: false,
                enable_offline_queue: true,
                needs_to_open_socket: true,
                enable_auto_reconnect: true,
                is_reconnecting: false,
                failed: false,
                enable_auto_pipelining: true,
                finalized: false,
                connection_promise_returns_client: false,
            }
        }
    }

    #[derive(Copy, Clone, Eq, PartialEq)]
    pub enum Status {
        Disconnected,
        Connecting,
        Connected,
    }
    impl Status {
        #[inline]
        pub fn is_active(self) -> bool {
            matches!(self, Status::Connected | Status::Connecting)
        }
    }

    #[derive(Copy, Clone, Eq, PartialEq)]
    pub enum Protocol {
        Standalone,
        StandaloneUnix,
        StandaloneTls,
        StandaloneTlsUnix,
    }
    impl Protocol {
        pub const MAP: phf::Map<&'static [u8], Protocol> = phf::phf_map! {
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
        #[inline]
        pub fn is_tls(self) -> bool {
            matches!(self, Protocol::StandaloneTls | Protocol::StandaloneTlsUnix)
        }
        #[inline]
        pub fn is_unix(self) -> bool {
            matches!(self, Protocol::StandaloneUnix | Protocol::StandaloneTlsUnix)
        }
    }

    #[derive(Default)]
    pub enum TLS {
        #[default]
        None,
        Enabled,
        // TODO(b2-blocked): SSLConfig payload — erased until server_config is real.
        Custom(*mut c_void),
    }

    pub struct Options {
        pub idle_timeout_ms: u32,
        pub connection_timeout_ms: u32,
        pub enable_auto_reconnect: bool,
        pub max_retries: u32,
        pub enable_offline_queue: bool,
        pub enable_auto_pipelining: bool,
        pub enable_debug_logging: bool,
        pub tls: TLS,
    }
    impl Default for Options {
        fn default() -> Self {
            Self {
                idle_timeout_ms: 0,
                connection_timeout_ms: 10000,
                enable_auto_reconnect: true,
                max_retries: 20,
                enable_offline_queue: true,
                enable_auto_pipelining: true,
                enable_debug_logging: false,
                tls: TLS::None,
            }
        }
    }

    pub enum Address {
        // TODO(port): in Zig these slices borrow from `connection_strings`
        // (self-referential). Owned in Phase A.
        Unix(Box<[u8]>),
        Host { host: Box<[u8]>, port: u16 },
    }
    impl Address {
        pub fn hostname(&self) -> &[u8] {
            match self {
                Address::Unix(u) => u,
                Address::Host { host, .. } => host,
            }
        }
    }

    /// Core Valkey client implementation.
    pub struct ValkeyClient {
        pub socket: AnySocket,
        pub status: Status,

        pub write_buffer: OffsetByteList,
        pub read_buffer: OffsetByteList,

        /// In-flight commands, after the data has been written to the socket.
        pub in_flight: super::valkey_command::promise_pair::Queue,
        /// Commands waiting to be sent.
        pub queue: super::valkey_command::entry::Queue,

        pub password: Box<[u8]>,
        pub username: Box<[u8]>,
        pub database: u32,
        pub address: Address,
        pub protocol: Protocol,
        pub connection_strings: Box<[u8]>,

        pub tls: TLS,

        pub idle_timeout_interval_ms: u32,
        pub connection_timeout_ms: u32,
        pub retry_attempts: u32,
        pub max_retries: u32,

        pub flags: ConnectionFlags,

        // TODO(b2-blocked): bun_jsc::webcore::AutoFlusher — erased.
        pub auto_flusher: (),

        // TODO(port): lifetime — JSC_BORROW; raw ptr until &'static lands.
        pub vm: *mut c_void,
    }

    pub struct DeferredFailure {
        pub message: Box<[u8]>,
        pub err: RedisError,
        pub global_this: *const JSGlobalObject,
        pub in_flight: super::valkey_command::promise_pair::Queue,
        pub queue: super::valkey_command::entry::Queue,
    }
}
pub use valkey::{ValkeyClient, Status, Protocol, Options};

// ── js_valkey (JS wrapper) ───────────────────────────────────────────────────
pub mod js_valkey {
    use super::*;
    use crate::timer::EventLoopTimer;

    pub struct SubscriptionCtx {
        pub is_subscriber: bool,
        pub original_enable_offline_queue: bool,
        pub original_enable_auto_pipelining: bool,
    }

    /// Valkey client wrapper for JavaScript (`.classes.ts` payload of
    /// `JSRedisClient`). The `#[bun_jsc::JsClass]` derive on the gated draft
    /// generates `toJS`/`fromJS`/`fromJSDirect` and the cached-slot accessors.
    pub struct JSValkeyClient {
        pub client: super::valkey::ValkeyClient,
        pub global_object: *const JSGlobalObject,
        pub this_value: JsRef,
        pub poll_ref: KeepAlive,

        pub _subscription_ctx: SubscriptionCtx,
        /// `us_ssl_ctx_t` for `tls: { …custom CA… }`. `tls: true` borrows
        /// `RareData.defaultClientSslCtx()` instead; `tls: false` leaves null.
        // TODO(b2-blocked): bun_uws::SslCtx — erased until typed.
        pub _secure: Option<*mut c_void>,

        pub timer: EventLoopTimer,
        pub reconnect_timer: EventLoopTimer,
        pub ref_count: Cell<u32>,
    }

    /// `SocketHandler<SSL>` — uws dispatch vtable target. Methods gated.
    pub struct SocketHandler<const SSL: bool>;
}
pub use js_valkey::JSValkeyClient;
