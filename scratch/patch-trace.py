p = "/Users/ciro/code/bun/.claude/worktrees/wave-tls/packages/bun-usockets/src/crypto/openssl.c"
src = open(p).read()

anchor = "int us_internal_ssl_write(struct us_socket_t *s, const char *data, int length) {\n"
trace_write = anchor + '  fprintf(stderr, "[TRACE %p srv=%d] ssl_write len=%d closed=%d shut=%d\\n", (void*)s, s->ssl&&s_ssl(s)?SSL_is_server(s_ssl(s)):-1, length, us_socket_is_closed(s), us_internal_ssl_is_shut_down(s));\n'
assert src.count(anchor) == 1
src = src.replace(anchor, trace_write)

anchor2 = "void us_internal_ssl_shutdown(struct us_socket_t *s) {\n"
trace2 = anchor2 + '  fprintf(stderr, "[TRACE %p srv=%d] ssl_shutdown closed=%d shut=%d\\n", (void*)s, s->ssl&&s_ssl(s)?SSL_is_server(s_ssl(s)):-1, us_socket_is_closed(s), us_internal_ssl_is_shut_down(s));\n'
assert src.count(anchor2) == 1
src = src.replace(anchor2, trace2)

anchor3 = "struct us_socket_t *us_internal_ssl_close(struct us_socket_t *s, int code, void *reason) {\n"
trace3 = anchor3 + '  fprintf(stderr, "[TRACE %p srv=%d] ssl_close code=%d\\n", (void*)s, s->ssl&&s_ssl(s)?SSL_is_server(s_ssl(s)):-1, code);\n'
assert src.count(anchor3) == 1
src = src.replace(anchor3, trace3)

anchor4 = "        } else if (err == SSL_ERROR_ZERO_RETURN) {\n"
trace4 = anchor4 + '          fprintf(stderr, "[TRACE %p srv=%d] ZERO_RETURN\\n", (void*)s, SSL_is_server(s_ssl(s)));\n'
assert src.count(anchor4) == 1
src = src.replace(anchor4, trace4)

anchor5 = "struct us_socket_t *us_internal_ssl_on_writable(struct us_socket_t *s) {\n"
trace5 = anchor5 + '  fprintf(stderr, "[TRACE %p srv=%d] on_writable\\n", (void*)s, s->ssl&&s_ssl(s)?SSL_is_server(s_ssl(s)):-1);\n'
assert src.count(anchor5) == 1
src = src.replace(anchor5, trace5)

anchor6 = "struct us_socket_t *us_internal_ssl_on_end(struct us_socket_t *s) {\n"
trace6 = anchor6 + '  fprintf(stderr, "[TRACE %p srv=%d] on_end\\n", (void*)s, s->ssl&&s_ssl(s)?SSL_is_server(s_ssl(s)):-1);\n'
assert src.count(anchor6) == 1
src = src.replace(anchor6, trace6)

open(p, "w").write(src)
print("trace added")
