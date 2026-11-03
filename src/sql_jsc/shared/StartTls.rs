use core::ptr::NonNull;

use bun_boringssl_sys::OwnedSslCtx;
use bun_jsc::rare_data::SocketGroups;
use bun_sql::shared::SSLMode;
use bun_uws::{self as uws, AnySocket, InternalSocket, SocketGroup, SocketKind, SocketTLS};

use crate::jsc::VirtualMachine;
use crate::jsc::api::server_config::SSLConfig;

pub(crate) enum StartTlsError {
    /// The socket is not a connected plain one.
    NotPlain,
    Failed,
}

/// https://github.com/porsager/postgres/blob/6ec85a432b17661ccacbdf7f765c651e88969d36/src/connection.js#L272-L279
pub(crate) fn verifies_certificate(tls_config: &SSLConfig, ssl_mode: SSLMode) -> bool {
    tls_config.reject_unauthorized() != 0
        && matches!(ssl_mode, SSLMode::VerifyCa | SSLMode::VerifyFull)
}

/// Turns the plain `socket` of `owner` into a TLS client socket and starts the handshake.
/// `store` puts the new socket in `owner` first: the handshake can call back into `owner`.
pub(crate) fn start_tls<T>(
    owner: *mut T,
    socket: AnySocket,
    (kind, group): (
        SocketKind,
        fn(&mut SocketGroups, *mut uws::Loop) -> &mut SocketGroup,
    ),
    secure: Option<&OwnedSslCtx>,
    tls_config: &SSLConfig,
    ssl_mode: SSLMode,
    store: impl FnOnce(AnySocket),
) -> Result<(), StartTlsError> {
    let AnySocket::SocketTcp(tcp) = socket else {
        return Err(StartTlsError::NotPlain);
    };
    let InternalSocket::Connected(raw) = tcp.socket else {
        return Err(StartTlsError::NotPlain);
    };
    // SAFETY: `raw` is a live connected socket in a group of its context's `SocketGroups`.
    let groups = unsafe { SocketGroups::of((*raw).group()) };
    // SAFETY: a live `SSL_CTX*`, made with the connection when its sslmode is not `disable`.
    let ssl_ctx = unsafe { &mut *secure.expect("sslmode asks for TLS").as_ptr() };
    // What the dispatch (uws_handlers.rs) reads from the slot. `Option<*mut T>` is twice the size.
    let ext_size = size_of::<Option<NonNull<T>>>() as i32;
    // SAFETY: `raw` is live. `adopt_tls` may move the socket.
    let Some(new_socket) = (unsafe { &mut *raw }).adopt_tls(
        group(groups, VirtualMachine::get().uws_loop()),
        kind,
        ssl_ctx,
        tls_config.sni(),
        true,  // is_client
        false, // request_cert (server-only)
        false, // reject_unauthorized (server-only; the client policy is set_inline_reject below)
        ext_size,
        ext_size,
    ) else {
        return Err(StartTlsError::Failed);
    };
    let new_socket = new_socket.as_ptr();
    // SAFETY: live, just returned by `adopt_tls` with an ext slot of `ext_size`.
    let sock = unsafe { &mut *new_socket };
    *sock.ext::<Option<NonNull<T>>>() = NonNull::new(owner);
    let tls = SocketTLS {
        socket: InternalSocket::Connected(new_socket),
    };
    if verifies_certificate(tls_config, ssl_mode) {
        tls.set_inline_reject();
    }
    store(AnySocket::SocketTls(tls));
    sock.start_tls_handshake();
    Ok(())
}
