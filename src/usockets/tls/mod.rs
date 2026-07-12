//! Per-socket TLS transport selector. Implements tls-semantics.md §1
//! (data flow / BIO plumbing / re-entrancy).

pub mod context;
pub mod sni;
pub mod state;

pub use state::TlsState;

/// BoringSSL `SSL`, from the pre-generated bssl-sys bindings (api.md
/// CHANGES 1; see bssl_bindings/README.md).
pub use bssl_sys::SSL;

/// Lives on the `SocketHeader`. Spill + fatal-reason storage is PER-SOCKET
/// (inside `TlsState`) — this is what deletes relocation (api.md CHANGES 2).
pub enum Transport {
    Plain,
    Tls(Box<TlsState>),
}
