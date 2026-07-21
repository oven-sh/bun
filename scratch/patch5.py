p = "/Users/ciro/code/bun/.claude/worktrees/wave-tls/packages/bun-usockets/src/crypto/openssl.c"
src = open(p).read()
old = """  if (s->ssl_read_wants_write) {
    s->ssl_read_wants_write = 0;
    /* Re-enter the data path with an empty buffer; SSL_read will pull from
     * the kernel via the next readable event but this lets it flush any
     * pending decrypt that was blocked on a write. */
    s = us_internal_ssl_on_data(s, "", 0);
    if (!s || ssl_gone(s)) return s;
  }
  if (us_internal_ssl_is_shut_down(s)) return s;
"""
new = """  if (s->ssl_read_wants_write) {
    s->ssl_read_wants_write = 0;
    /* Re-enter the data path with an empty buffer; SSL_read will pull from
     * the kernel via the next readable event but this lets it flush any
     * pending decrypt that was blocked on a write. */
    s = us_internal_ssl_on_data(s, "", 0);
    if (!s || ssl_gone(s)) return s;
  }
  /* Our own half-close (SENT_SHUTDOWN, node's end()) must not swallow write
   * completions: bytes spilled before end() drained just above and node still
   * delivers their callbacks. Only a dead socket skips the dispatch. */
  if (!s->ssl || !s_ssl(s) || s->ssl_fatal_error ||
      (SSL_get_shutdown(s_ssl(s)) & SSL_RECEIVED_SHUTDOWN)) {
    return s;
  }
"""
assert src.count(old) == 1, f"match count = {src.count(old)}"
open(p, "w").write(src.replace(old, new))
print("patched on_writable gate")
