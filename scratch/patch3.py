p = "/Users/ciro/code/bun/.claude/worktrees/wave-tls/packages/bun-usockets/src/crypto/openssl.c"
src = open(p).read()
old = """  /* BoringSSL has no TLS half-close: once SSL_shutdown sends our
   * close_notify, SSL_read refuses to return any further application data
   * (SSL_R_PROTOCOL_IS_SHUTDOWN). Node (OpenSSL) keeps reading after sending
   * close_notify, and node:net/tls semantics depend on that: a write()+end()
   * server must still receive the reply the peer sends after processing our
   * data - under TLS 1.2 the server's handshake completes one flight before
   * the client's, so that ordering is the norm rather than the exception.
   *
   * Send the TLS-level close_notify only when the peer's close_notify has
   * already arrived (we will never need to read again). Otherwise do a TCP
   * half-close (FIN, keep reading): the peer sees EOF after our last record
   * and the connection tears down through the normal read-side path when its
   * close_notify / FIN arrives. */
  if (!SSL_in_init(s_ssl(s)) && !(SSL_get_shutdown(s_ssl(s)) & SSL_RECEIVED_SHUTDOWN)) {
    /* BoringSSL defers post-handshake writes (the TLS 1.3 NewSessionTicket
     * messages) until the first SSL_write or SSL_shutdown. We are not sending
     * close_notify here, so flush them explicitly before the FIN: a
     * zero-length write seals no application record but pushes the pending
     * handshake data through the BIO. Without this, a server that ends
     * without writing (the tls.Server((s) => s.end()) pattern) never delivers
     * its session tickets and clients cannot resume. */
    struct loop_ssl_data *flush_loop_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;
    flush_loop_data->ssl_read_input_length = 0;
    flush_loop_data->ssl_socket = s;
    char zero_buf = 0;
    SSL_write(s_ssl(s), &zero_buf, 0);
    us_internal_socket_raw_shutdown(s);
    return;
  }
"""
new = """  /* Half-close (node's end()): send close_notify, then FIN, and KEEP reading.
   * BoringSSL only refuses writes after SSL_shutdown (write_shutdown); reads
   * stay open until the peer's close_notify, and the data path reads with
   * SENT_SHUTDOWN set, so a TLS 1.2 write()+end() server still receives the
   * reply the peer sends after processing our data. A bare FIN here reads as
   * truncation ("unexpected eof") to compliant peers. */
  if (!SSL_in_init(s_ssl(s)) && !(SSL_get_shutdown(s_ssl(s)) & SSL_RECEIVED_SHUTDOWN)) {
    /* Flush deferred post-handshake writes (TLS 1.3 NewSessionTickets) with a
     * zero-length SSL_write FIRST: tls_flush refuses a pending flight once
     * write_shutdown is set, so tickets queued behind SSL_shutdown would fail
     * and clients could never resume. */
    struct loop_ssl_data *flush_loop_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;
    flush_loop_data->ssl_read_input_length = 0;
    flush_loop_data->ssl_socket = s;
    char zero_buf = 0;
    SSL_write(s_ssl(s), &zero_buf, 0);
    int ret = SSL_shutdown(s_ssl(s));
    if (ret < 0) {
      int err = SSL_get_error(s_ssl(s), ret);
      if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
        ERR_clear_error();
        s->ssl_fatal_error = 1;
      }
      /* WANT_WRITE (kernel buffer full): no retry path exists once
       * SENT_SHUTDOWN is set; fall through to the FIN like ssl_handle_shutdown. */
    }
    us_internal_socket_raw_shutdown(s);
    return;
  }
"""
assert src.count(old) == 1, f"match count = {src.count(old)}"
open(p, "w").write(src.replace(old, new))
print("patched us_internal_ssl_shutdown close_notify")
