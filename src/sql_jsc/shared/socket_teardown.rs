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
    // usockets defers a fast shutdown once, behind ciphertext the kernel would not take; the
    // second one drops that ciphertext and closes with a FIN, so no reset discards sent bytes
    if !socket.is_closed() {
        socket.close(CloseCode::FastShutdown);
    }
}
