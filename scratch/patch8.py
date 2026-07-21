p = "/Users/ciro/code/bun/.claude/worktrees/wave-tls/packages/bun-usockets/src/crypto/openssl.c"
src = open(p).read()

# remove traces
for t in [
  '  fprintf(stderr, "[TRACE %p srv=%d] ssl_write len=%d closed=%d shut=%d\\n", (void*)s, s->ssl&&s_ssl(s)?SSL_is_server(s_ssl(s)):-1, length, us_socket_is_closed(s), us_internal_ssl_is_shut_down(s));\n',
  '  fprintf(stderr, "[TRACE %p srv=%d] ssl_shutdown closed=%d shut=%d\\n", (void*)s, s->ssl&&s_ssl(s)?SSL_is_server(s_ssl(s)):-1, us_socket_is_closed(s), us_internal_ssl_is_shut_down(s));\n',
  '  fprintf(stderr, "[TRACE %p srv=%d] ssl_close code=%d\\n", (void*)s, s->ssl&&s_ssl(s)?SSL_is_server(s_ssl(s)):-1, code);\n',
  '          fprintf(stderr, "[TRACE %p srv=%d] ZERO_RETURN\\n", (void*)s, SSL_is_server(s_ssl(s)));\n',
  '  fprintf(stderr, "[TRACE %p srv=%d] on_writable\\n", (void*)s, s->ssl&&s_ssl(s)?SSL_is_server(s_ssl(s)):-1);\n',
  '  fprintf(stderr, "[TRACE %p srv=%d] on_end\\n", (void*)s, s->ssl&&s_ssl(s)?SSL_is_server(s_ssl(s)):-1);\n',
]:
  assert src.count(t) == 1, f"trace not found: {t[:40]}"
  src = src.replace(t, "")

old = """          ssl_flush_pending_session(s);
          ssl_flush_pending_keylog(s);
          if (ssl_gone(s)) return NULL;
          if (read) {
            s = us_dispatch_data(s, loop_ssl_data->ssl_read_output + LIBUS_RECV_BUFFER_PADDING, read);
            if (!s || ssl_gone(s)) return NULL;
          }
"""
new = """          ssl_flush_pending_session(s);
          ssl_flush_pending_keylog(s);
          if (ssl_gone(s)) return NULL;
          if (read) {
            s = us_dispatch_data(s, loop_ssl_data->ssl_read_output + LIBUS_RECV_BUFFER_PADDING, read);
            if (!s || ssl_gone(s)) return NULL;
          }
          if (s->ssl_write_wants_read && !s->ssl_read_wants_write) {
            s->ssl_write_wants_read = 0;
            /* A JS write parked on WANT_READ (written before the handshake
             * finished) can seal and flush now: close_notify only closed the
             * PEER's write side. When the peer's close_notify rides in the
             * same flight as its Finished, skipping this retry (the loop tail
             * below is never reached) destroys the parked write with the
             * socket. */
            s = us_internal_ssl_on_writable(s);
            if (!s || ssl_gone(s)) return NULL;
          }
"""
assert src.count(old) == 1, "ZERO_RETURN hunk not found"
src = src.replace(old, new)
open(p, "w").write(src)
print("patched ZERO_RETURN retry, traces removed")
