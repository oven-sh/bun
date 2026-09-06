//! Teardown of a database socket the client has given up on: `close()`,
//! an idle or lifetime eviction, a connection timeout, a rejected
//! certificate, a protocol error.
//!
//! `CloseCode::Normal` on a TLS socket sends close_notify and then keeps the
//! fd, and with it the close callback, until the peer answers. A peer that
//! holds its side open (a proxy or load balancer, a partition at shutdown,
//! the server whose certificate was just rejected) then decides when the
//! pool's `close()` settles and when the process can exit. libpq and the
//! MySQL client library send close_notify and close the fd at once.

use bun_uws::{AnySocket, CloseCode};

/// Closes `socket` before this returns, whatever the peer does.
///
/// A TLS socket whose handshake completed sends its close_notify through
/// `shutdown()` first. Before the handshake there is no session to notify,
/// and a shut-down socket makes usockets report the unfinished handshake as
/// failed with no reason. The fd then closes with `FastShutdown`, a FIN. On
/// plain TCP that equals `Normal`. usockets still defers a fast shutdown
/// while ciphertext is stuck behind a full kernel buffer, which only a peer
/// that stopped reading produces. That socket is reset instead.
pub(crate) fn close_now(socket: &AnySocket) {
    if matches!(socket, AnySocket::SocketTls(_)) && socket.is_ssl_handshake_finished() {
        socket.shutdown();
    }
    socket.close(CloseCode::FastShutdown);
    if !socket.is_closed() {
        socket.close(CloseCode::Failure);
    }
}
