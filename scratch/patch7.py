p = "/Users/ciro/code/bun/.claude/worktrees/wave-tls/packages/bun-usockets/src/crypto/openssl.c"
src = open(p).read()

# 1. Gate: only a truly dead socket (no ssl / fatal) skips writable dispatch.
old1 = """  /* Our own half-close (SENT_SHUTDOWN, node's end()) must not swallow write
   * completions: bytes spilled before end() drained just above and node still
   * delivers their callbacks. Only a dead socket skips the dispatch. */
  if (!s->ssl || !s_ssl(s) || s->ssl_fatal_error ||
      (SSL_get_shutdown(s_ssl(s)) & SSL_RECEIVED_SHUTDOWN)) {
    return s;
  }
"""
new1 = """  /* A half-close in either direction must not swallow write completions:
   * bytes spilled before end() drained just above and node still delivers
   * their callbacks. Only a truly dead socket skips the dispatch. */
  if (!s->ssl || !s_ssl(s) || s->ssl_fatal_error) {
    return s;
  }
"""
assert src.count(old1) == 1, "gate hunk not found"
src = src.replace(old1, new1)

# 2. Extend the spill-deferral in us_internal_ssl_close to graceful closes.
old2 = """  /* node's `_handle.close()` (FAST_SHUTDOWN, no reason) must not cut off spilled
   * ciphertext already reported as written: SSL sealed it, so it can only be
   * delivered, never re-sent. Mirror ssl_shutdown_after_spill; defer at most once. */
  if (code == LIBUS_SOCKET_CLOSE_CODE_FAST_SHUTDOWN && !reason
      && !s->ssl_close_after_spill && !s->ssl_fatal_error && !us_socket_is_closed(s)) {"""
new2 = """  /* Neither node's `_handle.close()` (FAST_SHUTDOWN, no reason) nor a graceful
   * close (code 0: peer close_notify / end-completion) may cut off spilled
   * ciphertext already reported as written: SSL sealed it, so it can only be
   * delivered, never re-sent. Mirror ssl_shutdown_after_spill; defer at most once. */
  if ((code == LIBUS_SOCKET_CLOSE_CODE_FAST_SHUTDOWN || code == 0) && !reason
      && !s->ssl_close_after_spill && !s->ssl_fatal_error && !us_socket_is_closed(s)) {"""
assert src.count(old2) == 1, "close hunk not found"
src = src.replace(old2, new2)

open(p, "w").write(src)
print("patched gate + graceful spill deferral")
