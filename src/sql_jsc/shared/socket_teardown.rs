//! Teardown of a database socket the client has given up on.

use bun_uws::{AnySocket, CloseCode};

/// Closes `socket` before this returns, whatever the peer does.
/// `CloseCode::Normal` on a TLS socket would wait for the peer's close_notify.
pub(crate) fn close_now(socket: &AnySocket) {
    // shutdown() before the handshake finished makes usockets report the handshake as failed
    if matches!(socket, AnySocket::SocketTls(_)) && socket.is_ssl_handshake_finished() {
        socket.shutdown();
    }
    socket.close(CloseCode::FastShutdown);
    // usockets defers a fast shutdown while ciphertext is stuck behind a full kernel buffer
    if !socket.is_closed() {
        socket.close(CloseCode::Failure);
    }
}
