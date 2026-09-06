//! Teardown of a database socket the client has given up on: `close()`,
//! an idle or lifetime eviction, a connection timeout, a rejected
//! certificate, a protocol error.

use bun_uws::{AnySocket, CloseCode};

/// Closes `socket` before this returns, whatever the peer does.
///
/// `CloseCode::Normal` on a TLS socket keeps the fd until the peer answers
/// close_notify. This sends close_notify and closes the fd at once, like
/// libpq and the MySQL client library. `shutdown()` before the handshake
/// finished makes usockets report the handshake as failed, so it is
/// skipped. usockets defers `FastShutdown` while ciphertext is stuck behind
/// a full kernel buffer (a peer that stopped reading); that socket is reset.
pub(crate) fn close_now(socket: &AnySocket) {
    if matches!(socket, AnySocket::SocketTls(_)) && socket.is_ssl_handshake_finished() {
        socket.shutdown();
    }
    socket.close(CloseCode::FastShutdown);
    if !socket.is_closed() {
        socket.close(CloseCode::Failure);
    }
}
