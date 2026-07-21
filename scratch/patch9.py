p = "/Users/ciro/code/bun/.claude/worktrees/wave-tls/packages/bun-usockets/src/crypto/openssl.c"
src = open(p).read()

# (d) close deferral: named constant + record the original close code for the resume.
old = """  if ((code == LIBUS_SOCKET_CLOSE_CODE_FAST_SHUTDOWN || code == 0) && !reason
      && !s->ssl_close_after_spill && !s->ssl_fatal_error && !us_socket_is_closed(s)) {
    struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;
    if (loop_ssl_data && !ssl_drain_spill(loop_ssl_data, s)) {
      s->ssl_close_after_spill = 1;
      return s;
    }
  }
"""
new = """  if ((code == LIBUS_SOCKET_CLOSE_CODE_FAST_SHUTDOWN || code == LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN)
      && !reason
      && !s->ssl_close_after_spill && !s->ssl_fatal_error && !us_socket_is_closed(s)) {
    struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;
    if (loop_ssl_data && !ssl_drain_spill(loop_ssl_data, s)) {
      s->ssl_close_after_spill = 1;
      /* Resume with the SAME code: a graceful close must not come back as a
       * forceful FAST_SHUTDOWN (on_close would see an abortive teardown). */
      s->ssl_pending_close_code = (unsigned char) code;
      return s;
    }
  }
"""
assert src.count(old) == 1, "close-defer hunk"
src = src.replace(old, new)

# (d2) on_writable resume uses the recorded code.
old = """    if (s->ssl_close_after_spill) {
      s->ssl_close_after_spill = 0;
      return us_internal_ssl_close(s, LIBUS_SOCKET_CLOSE_CODE_FAST_SHUTDOWN, NULL);
    }
"""
new = """    if (s->ssl_close_after_spill) {
      s->ssl_close_after_spill = 0;
      return us_internal_ssl_close(s, s->ssl_pending_close_code, NULL);
    }
"""
assert src.count(old) == 1, "close-resume hunk"
src = src.replace(old, new)

# (c) on_writable gate: ssl_gone + fatal; keep the old suppression for uWS HTTP kinds.
old = """  /* A half-close in either direction must not swallow write completions:
   * bytes spilled before end() drained just above and node still delivers
   * their callbacks. Only a truly dead socket skips the dispatch. */
  if (!s->ssl || !s_ssl(s) || s->ssl_fatal_error) {
    return s;
  }
"""
new = """  if (ssl_gone(s) || s->ssl_fatal_error) return s;
  /* uWS HTTP sockets keep the pre-existing SENT_SHUTDOWN suppression: their
   * onWritable clears the teardown timeout armed at shutdown. node sockets
   * still get write-completion dispatch after a half-close in either
   * direction. */
  if (ssl_wants_eof_dispatch(s) && us_internal_ssl_is_shut_down(s)) return s;
"""
assert src.count(old) == 1, "gate hunk"
src = src.replace(old, new)

# (a) helper: retry a parked pre-handshake write. Insert before us_internal_ssl_on_end.
old = """struct us_socket_t *us_internal_ssl_on_end(struct us_socket_t *s) {
"""
new = """/* Retry a JS write parked on WANT_READ (written before the handshake
 * finished). No-op while this socket's spill is undrained: the flag is kept
 * so the retry happens after on_writable drains it. */
static struct us_socket_t *ssl_retry_parked_write(struct us_socket_t *s) {
  if (!s->ssl_write_wants_read || s->ssl_read_wants_write) return s;
  struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;
  if (loop_ssl_data && loop_ssl_data->ssl_spill_owner == s) return s;
  s->ssl_write_wants_read = 0;
  return us_internal_ssl_on_writable(s);
}

struct us_socket_t *us_internal_ssl_on_end(struct us_socket_t *s) {
"""
assert src.count(old) == 1, "helper insertion"
src = src.replace(old, new)

# (e) on_end: do not defeat a spill-deferred close.
old = """  s = ssl_close(s, 0, NULL);
  if (s && !us_socket_is_closed(s)) {
    s = us_internal_socket_close_raw(s, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, NULL);
  }
  return s;
}
"""
new = """  s = ssl_close(s, 0, NULL);
  if (s && !us_socket_is_closed(s) && !s->ssl_close_after_spill) {
    s = us_internal_socket_close_raw(s, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, NULL);
  }
  return s;
}
"""
assert src.count(old) == 1, "on_end hunk"
src = src.replace(old, new)

# (b) ZERO_RETURN: use the helper; return the live socket if the close deferred.
old = """          if (s->ssl_write_wants_read && !s->ssl_read_wants_write) {
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
new = """          /* close_notify only closed the PEER's write side; when it rides in
           * the same flight as its Finished, the loop tail below is never
           * reached and a parked write would be destroyed with the socket. */
          s = ssl_retry_parked_write(s);
          if (!s || ssl_gone(s)) return NULL;
"""
assert src.count(old) == 1, "zero-return retry hunk"
src = src.replace(old, new)

old = """          ssl_close(s, 0, NULL);
          return NULL;
        }
"""
new = """          s = ssl_close(s, 0, NULL);
          if (!s || ssl_gone(s)) return NULL;
          /* Spill-deferred close: the socket is still live; report it so the
           * caller's bookkeeping does not treat it as destroyed. */
          return s;
        }
"""
assert src.count(old) == 1, "zero-return close hunk"
src = src.replace(old, new)

# (a2) tail retry uses the helper.
old = """  if (ssl_gone(s)) return NULL;
  if (s->ssl_write_wants_read && !s->ssl_read_wants_write) {
    s->ssl_write_wants_read = 0;
    s = us_internal_ssl_on_writable(s);
    if (!s || ssl_gone(s)) return NULL;
  }
"""
new = """  if (ssl_gone(s)) return NULL;
  s = ssl_retry_parked_write(s);
  if (!s || ssl_gone(s)) return NULL;
"""
assert src.count(old) == 1, "tail retry hunk"
src = src.replace(old, new)

# (f) half-close branch: drop the redundant zero-write, reuse ssl_handle_shutdown.
old = """    /* Flush deferred post-handshake writes (TLS 1.3 NewSessionTickets) with a
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
new = """    /* ssl_handle_shutdown sends the close_notify (BoringSSL's do_tls_write
     * prepends any pending TLS 1.3 NewSessionTicket flight to the alert, so
     * tickets are still delivered) and owns the error handling. */
    ssl_handle_shutdown(s, 0);
    us_internal_socket_raw_shutdown(s);
    return;
  }
"""
assert src.count(old) == 1, "half-close hunk"
src = src.replace(old, new)

open(p, "w").write(src)
print("patch9 applied")
