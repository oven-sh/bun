//! Per-socket TLS transport selector. Implements docs/tls.md §1
//! (data flow / BIO plumbing / re-entrancy).

pub mod context;
pub mod sni;
pub mod state;

pub use state::{SslWindowGuard, TlsState};

/// BoringSSL `SSL`, from the pre-generated bssl-sys bindings (see
/// bssl_bindings/README.md and docs/tls.md PART 2).
pub use bssl_sys::SSL;

/// Lives on the `SocketHeader`. Spill + fatal-reason storage is LOOP-SHARED
/// (docs/design.md §TLS buffer ownership), owned via generation-checked `SocketRef` — the
/// slab's stable slot addresses are what delete relocation.
pub enum Transport {
    Plain,
    Tls(Box<TlsState>),
}
