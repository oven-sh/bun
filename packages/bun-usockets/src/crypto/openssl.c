/*
 * Authored by Alex Hultman, 2018-2019.
 * Intellectual property of third-party.

 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// clang-format off
#if (defined(LIBUS_USE_OPENSSL) || defined(LIBUS_USE_WOLFSSL))

#include "internal/internal.h"
#include "internal/fault_inject.h"
#include "libusockets.h"
#include <string.h>
#include <limits.h>
#include <stdatomic.h>
#include <time.h>

/* These are in sni_tree.cpp */
void *sni_new();
void sni_free(void *sni, void (*cb)(void *));
int sni_add(void *sni, const char *hostname, void *user);
void *sni_remove(void *sni, const char *hostname);
void *sni_find(void *sni, const char *hostname);

#ifdef LIBUS_USE_OPENSSL
#include <openssl/bio.h>
#include <openssl/dh.h>
#include <openssl/err.h>
#include <openssl/ssl.h>
#include <openssl/pkcs12.h>
#elif LIBUS_USE_WOLFSSL
#include <wolfssl/openssl/bio.h>
#include <wolfssl/openssl/dh.h>
#include <wolfssl/openssl/err.h>
#include <wolfssl/openssl/ssl.h>
#include <wolfssl/options.h>
#endif

#include "./root_certs_header.h"
#include "./default_ciphers.h"

/* ──────────────────────────────────────────────────────────────────────────
 * Per-socket SSL model.
 *
 * SSL_CTX is owned externally (SecureContext / listener) and
 * never created here outside of us_ssl_ctx_from_options(). Each TLS socket carries a
 * heap-allocated us_ssl_socket_data_t at s->ssl, which owns one SSL* built
 * from a borrowed SSL_CTX. The loop dispatch path is:
 *
 *   loop.c readable → s->ssl ? us_internal_ssl_on_data : us_dispatch_data
 *
 * and us_internal_ssl_on_data decrypts then re-enters us_dispatch_data with
 * plaintext. Same shape for open/writable/close/end.
 * ────────────────────────────────────────────────────────────────────────── */

/* Capacity of the parked fatal-error reason (ERR_error_string_n output).
 * OpenSSL formats "error:...:reason" strings well under this; anything
 * longer is truncated by ERR_error_string_n itself (always NUL-terminated). */
#define US_SSL_FATAL_ERROR_REASON_MAX 256

struct loop_ssl_data {
  char *ssl_read_input, *ssl_read_output;
  unsigned int ssl_read_input_length;
  unsigned int ssl_read_input_offset;

  struct us_socket_t *ssl_socket;
  BIO *shared_rbio;
  BIO *shared_wbio;
  BIO_METHOD *shared_biom;
  /* The OpenSSL error string of the fatal SSL error that is about to close
   * the current socket (set in the SSL_ERROR_SSL branch immediately before
   * ssl_close, consumed by the handshake-failure dispatch inside that
   * ssl_close, cleared after use). Lets 'wrong version number' and friends
   * reach the JS 'tlsClientError' / client error the way Node reports them.
   * A longer reason is truncated: every writer goes through
   * ERR_error_string_n, which NUL-terminates and truncates to the buffer
   * size (OpenSSL's own error strings stay well under it). */
  char ssl_last_fatal_error[US_SSL_FATAL_ERROR_REASON_MAX];
  /* The socket that parked ssl_last_fatal_error. The scratch is per-loop, so
   * a reason parked by one socket must never be reported for another (a
   * server and a client in the same process share this loop). */
  void *ssl_last_fatal_error_owner;

  /* Ciphertext write batching: while one us_internal_ssl_write runs,
   * BIO_s_custom_write appends each sealed record here instead of issuing one
   * raw socket write per 16 KB record; the whole batch reaches the kernel in
   * a single write afterwards (node reaches the same shape via its memory
   * BIO drained with writev). Lazily allocated, reused across writes. */
  char *ssl_write_batch;
  unsigned int ssl_write_batch_len;
  unsigned int ssl_write_batch_cap;
  int ssl_write_batching;

  /* Single spill slot: ciphertext a partial batch flush could not deliver.
   * SSL believes these records were written, so they MUST reach this exact
   * socket's fd, in order, before any of its later records. Drained from the
   * owner's writable event; while the slot is occupied, other sockets write
   * through per record (the pre-batching path). */
  struct us_socket_t *ssl_spill_owner;
  char *ssl_spill;
  unsigned int ssl_spill_len;
  unsigned int ssl_spill_off;
};

enum {
  HANDSHAKE_PENDING = 0,
  HANDSHAKE_COMPLETED = 1,
  HANDSHAKE_RENEGOTIATION_PENDING = 2,
};

/* No per-socket SSL struct: `s->ssl` IS the BoringSSL `SSL*`, and the 6 state
 * bits live in `us_socket_t`'s pointer-alignment padding (see internal.h).
 * Per-connection reneg counters and SNI userdata, when needed at all, hang off
 * SSL ex_data so the common path (client connect, no reneg) does zero extra
 * allocation. */
#define s_ssl(s) ((SSL *)(s)->ssl)

/* SNI tree leaf — stored as the void* user in sni_tree.cpp. */
struct sni_node_t {
  SSL_CTX *ctx;
  void *user;
};

static _Atomic long ssl_ctx_live = 0;

long us_ssl_ctx_live_count(void) {
  return atomic_load(&ssl_ctx_live);
}

/* ex_data indices, registered once at first SSL_CTX/SSL touch:
 *   - us_ctx_ex_idx (SSL_CTX): packed reneg {limit:u32,window:u32}; its
 *     free_func also decrements ssl_ctx_live so the counter tracks ACTUAL
 *     destruction (refcount→0), not every SSL_CTX_free.
 *   - us_sni_ex_idx (SSL_CTX): per-domain userdata (uWS HttpRouter*).
 *   - us_ssl_reneg_state_idx (SSL): per-connection reneg counter, malloc'd on
 *     first reneg attempt only — never on the hot path.
 *   - us_ssl_listener_ex_idx (SSL): the accepting us_listen_socket_t*. The
 *     SSL_CTX is shared and can outlive any one listener, so storing ls as the
 *     CTX-level servername_arg is a UAF after listener close (and overwritten
 *     on multi-listen).
 *
 * SSL_CTX creation runs from both the JS thread (SecureContext, Bun.connect/
 * listen) and the HTTP-client thread (HTTPContext.initWithOpts). A racy `<0`
 * check would let two threads each register the ctx_ex_idx free_func, double-
 * decrementing ssl_ctx_live forever after. (BoringSSL's CRYPTO_once is
 * internal-only, so use the platform primitive directly; root_certs.cpp does
 * the same via std::call_once.) */
static int us_ctx_ex_idx = -1;
static int us_sni_ex_idx = -1;
static int us_ctx_cache_ex_idx = -1;
/* Marks an SSL_CTX whose verification store holds user-provided CAs (the
 * ca/caFile options or a later addCACert): the per-socket client attach must
 * not replace such a store with the process-shared default roots. */
static int us_ctx_user_ca_ex_idx = -1;
static int us_ssl_reneg_state_idx = -1;
/* Per-connection async-SNI suspension state (select_certificate_cb retry). */
static int us_ssl_sni_pending_idx = -1;
static int us_ssl_listener_ex_idx = -1;
/* Per-SSL socket-level SNI resolver (us_socket_sni_resolver_t), used when the
 * SSL has no listen socket behind it. */
static int us_ssl_socket_sni_ex_idx = -1;
/* Set (to a non-NULL marker) only on SSLs attached to a real us_socket_t via
 * us_internal_ssl_attach. The new-session callback uses it to ignore SSLs
 * owned by other engines (the JS-stream SSL wrapper used for TLS-over-duplex)
 * whose BIOs do not point at the loop's shared BIO data. */
static int us_ssl_is_socket_ex_idx = -1;
/* Defined in Rust (src/uws_sys/SocketKind.rs) so the ordinal tracks the enum. */
extern const unsigned char BUN_SOCKET_KIND_BUN_SOCKET_TLS;
extern const unsigned char BUN_SOCKET_KIND_UWS_HTTP_TLS;
/* Serialized resumable session parked by the new-session callback until the
 * SSL stack unwinds; freed with the SSL if never delivered. */
static int us_ssl_pending_session_idx = -1;
static int us_ssl_pending_keylog_idx = -1;
#ifdef _WIN32
static INIT_ONCE us_ex_idx_once = INIT_ONCE_STATIC_INIT;
#else
#include <pthread.h>
static pthread_once_t us_ex_idx_once = PTHREAD_ONCE_INIT;
#endif

#define US_RENEG_PACK(limit, window) ((void *)(uintptr_t)(((uint64_t)(limit) << 32) | (uint32_t)(window)))
#define US_RENEG_LIMIT(p)  ((uint32_t)((uint64_t)(uintptr_t)(p) >> 32))
#define US_RENEG_WINDOW(p) ((uint32_t)((uint64_t)(uintptr_t)(p)))

/* Async SNICallback suspension state, hung off the SSL via ex_data.
 * Allocated the first time a dynamic resolver answers "pending"; freed with
 * the SSL. The resolved ctx carries one reference owned by this struct until
 * select_cert_cb consumes it (SSL_set_SSL_CTX takes its own). */
struct us_ssl_sni_pending_t {
  /* 0 = none, 1 = waiting for the JS resolution, 2 = resolved, 3 = error */
  int state;
  struct ssl_ctx_st *resolved_ctx;
};

static void us_ssl_sni_pending_free(void *parent, void *ptr, CRYPTO_EX_DATA *ad,
                                    int index, long argl, void *argp) {
  (void)parent; (void)ad; (void)index; (void)argl; (void)argp;
  struct us_ssl_sni_pending_t *st = ptr;
  if (!st) return;
  if (st->resolved_ctx) SSL_CTX_free(st->resolved_ctx);
  us_free(st);
}

/* Holder for the socket-level SNI resolver. A struct rather than stashing the
 * function pointer straight into ex_data: converting a function pointer to
 * void* is not portable C. */
struct us_socket_sni_resolver_t {
  us_socket_server_name_cb cb;
};

static void us_socket_sni_resolver_free(void *parent, void *ptr, CRYPTO_EX_DATA *ad,
                                        int index, long argl, void *argp) {
  (void)parent; (void)ad; (void)index; (void)argl; (void)argp;
  if (ptr) us_free(ptr);
}

struct us_ssl_reneg_state_t {
  uint64_t window_start_ms;
  uint32_t count;
};

static void us_ctx_ex_free(void *parent, void *ptr, CRYPTO_EX_DATA *ad,
                           int index, long argl, void *argp) {
  (void)parent; (void)ptr; (void)ad; (void)index; (void)argl; (void)argp;
  atomic_fetch_sub(&ssl_ctx_live, 1);
}
static void us_ssl_reneg_state_free(void *parent, void *ptr, CRYPTO_EX_DATA *ad,
                                    int index, long argl, void *argp) {
  (void)parent; (void)ad; (void)index; (void)argl; (void)argp;
  us_free(ptr);
}

/* A new resumable session is ready (for TLS 1.3, the peer's NewSessionTicket
 * was just processed; SSL_get_session() right after the handshake only returns
 * an unresumable placeholder). This callback fires from inside
 * SSL_read/SSL_do_handshake, where running JS could free the SSL out from
 * under the caller - so it only serializes the session and parks it on the
 * connection. ssl_flush_pending_session() hands it to the socket's session
 * callback once the SSL stack has unwound. */
/* Upper bounds for parked payloads: a serialized SSL_SESSION (i2d) and a
 * single keylog line. Anything larger is dropped at the parking site. */
#define US_SSL_PENDING_SESSION_MAX 65536
#define US_SSL_PENDING_KEYLOG_LINE_MAX 4096

struct us_ssl_pending_session_t {
  struct us_ssl_pending_session_t *next;
  uint32_t length;
  unsigned char data[];
};
static void us_ssl_pending_session_free(void *parent, void *ptr, CRYPTO_EX_DATA *ad,
                                        int index, long argl, void *argp) {
  (void)parent; (void)ad; (void)index; (void)argl; (void)argp;
  struct us_ssl_pending_session_t *pending = ptr;
  while (pending) {
    struct us_ssl_pending_session_t *next = pending->next;
    us_free(pending);
    pending = next;
  }
}
/* NSS key-log lines are produced from inside SSL_do_handshake/SSL_read, so
 * they are parked on the SSL the same way new sessions are and delivered once
 * the read unwinds. The stored bytes already carry the trailing newline Node
 * appends before emitting 'keylog'. */
static void us_ssl_keylog_cb(const SSL *cssl, const char *line) {
  SSL *ssl = (SSL *)cssl;
  if (!SSL_get_ex_data(ssl, us_ssl_is_socket_ex_idx)) {
    return;
  }
  size_t line_len = strlen(line);
  if (line_len == 0 || line_len > US_SSL_PENDING_KEYLOG_LINE_MAX) {
    return;
  }
  struct us_ssl_pending_session_t *pending =
      us_malloc(sizeof(struct us_ssl_pending_session_t) + line_len + 1);
  if (!pending) {
    return;
  }
  memcpy(pending->data, line, line_len);
  pending->data[line_len] = '\n';
  pending->length = (uint32_t)(line_len + 1);
  pending->next = NULL;
  struct us_ssl_pending_session_t *head = SSL_get_ex_data(ssl, us_ssl_pending_keylog_idx);
  if (!head) {
    SSL_set_ex_data(ssl, us_ssl_pending_keylog_idx, pending);
  } else {
    while (head->next) head = head->next;
    head->next = pending;
  }
}

static void ssl_flush_pending_keylog(struct us_socket_t *s) {
  if (!s->ssl || us_socket_is_closed(s)) {
    return;
  }
  struct us_ssl_pending_session_t *pending =
      SSL_get_ex_data(s->ssl, us_ssl_pending_keylog_idx);
  if (!pending) {
    return;
  }
  SSL_set_ex_data(s->ssl, us_ssl_pending_keylog_idx, NULL);
  while (pending) {
    struct us_ssl_pending_session_t *next = pending->next;
    if (!us_socket_is_closed(s) && s->ssl) {
      us_dispatch_keylog(s, pending->data, (int)pending->length);
    }
    us_free(pending);
    pending = next;
  }
}

static int us_ssl_new_session_cb(SSL *ssl, SSL_SESSION *session) {
  /* Park only for consumers that will drain the queue: SSLs attached to a
   * real us_socket_t (flushed into us_dispatch_session once the read unwinds)
   * and SSLs whose owner opted in via us_ssl_enable_pending_events (the
   * Rust SSLWrapper behind TLS-over-duplex / named pipes, which polls
   * us_ssl_pop_pending_session after its reads). Everything else (fetch,
   * WebSocket tunnels) has no consumer - don't queue. */
  if (!SSL_get_ex_data(ssl, us_ssl_is_socket_ex_idx)) {
    return 0;
  }
  int length = i2d_SSL_SESSION(session, NULL);
  if (length <= 0 || length > US_SSL_PENDING_SESSION_MAX) {
    return 0;
  }
  struct us_ssl_pending_session_t *pending =
      us_malloc(sizeof(struct us_ssl_pending_session_t) + (size_t)length);
  if (!pending) {
    return 0;
  }
  unsigned char *out = pending->data;
  pending->length = (uint32_t)i2d_SSL_SESSION(session, &out);
  pending->next = NULL;
  /* Append: each NewSessionTicket is a distinct resumable session and gets
   * its own 'session' event, in arrival order. */
  struct us_ssl_pending_session_t *head = SSL_get_ex_data(ssl, us_ssl_pending_session_idx);
  if (!head) {
    SSL_set_ex_data(ssl, us_ssl_pending_session_idx, pending);
  } else {
    while (head->next) head = head->next;
    head->next = pending;
  }
  /* 0: we serialized a copy; the caller keeps ownership of `session`. */
  return 0;
}

/* Deliver a session parked by the new-session callback. Must only be called
 * once the SSL_read/SSL_do_handshake that parked it has returned; the JS it
 * runs may close the socket, so callers must check ssl_gone(s) afterwards. */
static void ssl_flush_pending_session(struct us_socket_t *s) {
  if (!s->ssl || us_socket_is_closed(s)) {
    return;
  }
  struct us_ssl_pending_session_t *pending =
      SSL_get_ex_data(s->ssl, us_ssl_pending_session_idx);
  if (!pending) {
    return;
  }
  SSL_set_ex_data(s->ssl, us_ssl_pending_session_idx, NULL);
  while (pending) {
    struct us_ssl_pending_session_t *next = pending->next;
    if (!us_socket_is_closed(s) && s->ssl) {
      us_dispatch_session(s, pending->data, (int)pending->length);
    }
    us_free(pending);
    pending = next;
  }
}

/* Defined in `src/runtime/api/bun/SSLContextCache.rs`: tombstones the cache entry on
 * SSL_CTX refcount→0 so the per-VM weak SSL_CTX cache learns the pointer is
 * dead without holding a ref of its own. */
extern void bun_ssl_ctx_cache_on_free(void *parent, void *ptr, CRYPTO_EX_DATA *ad,
                                      int index, long argl, void *argp);

static void us_ex_idx_init(void) {
  us_ctx_ex_idx = SSL_CTX_get_ex_new_index(0, NULL, NULL, NULL, us_ctx_ex_free);
  us_sni_ex_idx = SSL_CTX_get_ex_new_index(0, NULL, NULL, NULL, NULL);
  us_ctx_cache_ex_idx = SSL_CTX_get_ex_new_index(0, NULL, NULL, NULL, bun_ssl_ctx_cache_on_free);
  us_ctx_user_ca_ex_idx = SSL_CTX_get_ex_new_index(0, NULL, NULL, NULL, NULL);
  us_ssl_reneg_state_idx = SSL_get_ex_new_index(0, NULL, NULL, NULL, us_ssl_reneg_state_free);
  us_ssl_sni_pending_idx = SSL_get_ex_new_index(0, NULL, NULL, NULL, us_ssl_sni_pending_free);
  us_ssl_listener_ex_idx = SSL_get_ex_new_index(0, NULL, NULL, NULL, NULL);
  us_ssl_socket_sni_ex_idx =
      SSL_get_ex_new_index(0, NULL, NULL, NULL, us_socket_sni_resolver_free);
  us_ssl_is_socket_ex_idx = SSL_get_ex_new_index(0, NULL, NULL, NULL, NULL);
  us_ssl_pending_session_idx = SSL_get_ex_new_index(0, NULL, NULL, NULL, us_ssl_pending_session_free);
  us_ssl_pending_keylog_idx = SSL_get_ex_new_index(0, NULL, NULL, NULL, us_ssl_pending_session_free);
}

#ifdef _WIN32
static BOOL CALLBACK us_ex_idx_init_win(PINIT_ONCE o, PVOID p, PVOID *c) {
  (void)o; (void)p; (void)c;
  us_ex_idx_init();
  return TRUE;
}
#endif

static inline void us_ex_idx_ensure(void) {
#ifdef _WIN32
  InitOnceExecuteOnce(&us_ex_idx_once, us_ex_idx_init_win, NULL, NULL);
#else
  pthread_once(&us_ex_idx_once, us_ex_idx_init);
#endif
}

static inline int us_ssl_ctx_ex_idx(void) {
  us_ex_idx_ensure();
  return us_ctx_ex_idx;
}

/* TLS-over-duplex / named-pipe owners (the Rust SSLWrapper): opt this SSL
 * into the parked session/keylog queues so us_ssl_new_session_cb /
 * us_ssl_keylog_cb collect them. There is no us_socket_t to flush into
 * us_dispatch_*, so the wrapper drains the queues with
 * us_ssl_pop_pending_* once its SSL_read/SSL_do_handshake stack unwinds. */
void us_ssl_enable_pending_events(SSL *ssl) {
  us_ex_idx_ensure();
  SSL_set_ex_data(ssl, us_ssl_is_socket_ex_idx, (void *)1);
}

static int us_ssl_pop_pending(SSL *ssl, int idx, unsigned char *out, int out_cap) {
  if (idx < 0) return 0;
  struct us_ssl_pending_session_t *pending = SSL_get_ex_data(ssl, idx);
  if (!pending) return 0;
  SSL_set_ex_data(ssl, idx, pending->next);
  int len = (int)pending->length;
  if (len > out_cap) {
    /* The parking sites cap entries (64 KB sessions, 4 KB+1 keylog lines) and
     * callers pass buffers at least that large, so this is unreachable; drop
     * the entry rather than overflow. */
    len = 0;
  } else {
    memcpy(out, pending->data, (size_t)len);
  }
  us_free(pending);
  return len;
}

/* Pop the oldest parked session/keylog entry into `out` (cap `out_cap`).
 * Returns the byte length, or 0 when the queue is empty. Entries arrive in
 * parking order; each pop hands over exactly one entry. */
int us_ssl_pop_pending_session(SSL *ssl, unsigned char *out, int out_cap) {
  return us_ssl_pop_pending(ssl, us_ssl_pending_session_idx, out, out_cap);
}

int us_ssl_pop_pending_keylog(SSL *ssl, unsigned char *out, int out_cap) {
  return us_ssl_pop_pending(ssl, us_ssl_pending_keylog_idx, out, out_cap);
}

int us_ssl_ctx_cache_ex_idx(void) {
  us_ex_idx_ensure();
  return us_ctx_cache_ex_idx;
}

static inline void us_reneg_policy(SSL *ssl, uint32_t *limit, uint32_t *window) {
  void *packed = us_ctx_ex_idx >= 0
      ? SSL_CTX_get_ex_data(SSL_get_SSL_CTX(ssl), us_ctx_ex_idx) : NULL;
  *limit = packed ? US_RENEG_LIMIT(packed) : 3;
  *window = packed ? US_RENEG_WINDOW(packed) : 600;
}

static inline struct us_ssl_reneg_state_t *us_reneg_state(SSL *ssl) {
  us_ex_idx_ensure();
  struct us_ssl_reneg_state_t *st = SSL_get_ex_data(ssl, us_ssl_reneg_state_idx);
  if (!st) {
    st = us_calloc(1, sizeof(*st));
    SSL_set_ex_data(ssl, us_ssl_reneg_state_idx, st);
  }
  return st;
}

/* socket.c — raw TCP FIN that does NOT re-enter the SSL layer. */
extern void us_internal_socket_raw_shutdown(struct us_socket_t *s);

static void ssl_update_handshake(struct us_socket_t *s);

/* ── BIO plumbing ─────────────────────────────────────────────────────────
 * The same shared mem-BIO pair is reused for every SSL* on a loop. The write
 * BIO sends ciphertext straight to the wire via raw_write (which never
 * re-enters the SSL layer). */

int passphrase_cb(char *buf, int size, int rwflag, void *u) {
  /* No passphrase configured: behave like Node's PasswordCallback and try an
   * empty password, so an encrypted key fails with BAD_DECRYPT instead of
   * BoringSSL's default callback failing with BAD_PASSWORD_READ. */
  if (u == NULL) return 0;
  const char *passphrase = (const char *)u;
  size_t passphrase_length = strlen(passphrase);
  if (passphrase_length > (size_t)size) return -1;
  memcpy(buf, passphrase, passphrase_length);
  return (int)passphrase_length;
}

static int BIO_s_custom_create(BIO *bio) {
  BIO_set_init(bio, 1);
  return 1;
}

static long BIO_s_custom_ctrl(BIO *bio, int cmd, long num, void *user) {
  switch (cmd) {
  case BIO_CTRL_FLUSH:
    return 1;
  default:
    return 0;
  }
}

/* Save/restore the per-loop BIO routing state around a JS callback that runs
 * from inside SSL_do_handshake/SSL_read: user JS that writes to or destroys a
 * different TLS socket on the same loop re-points loop_ssl_data->ssl_socket
 * (and may consume the read-input window), and the interrupted handshake's
 * next BIO_write would otherwise land on that other socket's fd. */
void us_internal_ssl_loop_state_save(void *ssl_ptr, void **out) {
  SSL *ssl = (SSL *)ssl_ptr;
  struct loop_ssl_data *d = (struct loop_ssl_data *)BIO_get_data(SSL_get_wbio(ssl));
  out[0] = d;
  out[1] = d ? (void *)d->ssl_socket : NULL;
  out[2] = d ? (void *)d->ssl_read_input : NULL;
  out[3] = d ? (void *)(uintptr_t)d->ssl_read_input_length : NULL;
  out[4] = d ? (void *)(uintptr_t)d->ssl_read_input_offset : NULL;
}

void us_internal_ssl_loop_state_restore(void **saved) {
  struct loop_ssl_data *d = (struct loop_ssl_data *)saved[0];
  if (!d) return;
  d->ssl_socket = (struct us_socket_t *)saved[1];
  d->ssl_read_input = (char *)saved[2];
  d->ssl_read_input_length = (unsigned int)(uintptr_t)saved[3];
  d->ssl_read_input_offset = (unsigned int)(uintptr_t)saved[4];
}

static int BIO_s_custom_write(BIO *bio, const char *data, int length) {
  struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)BIO_get_data(bio);

  /* A callback run from inside SSL_do_handshake/SSL_read marked this socket
   * for deferred destruction (an SNI abort, or JS destroying the socket): the
   * connection is being dropped without a TLS-level goodbye, so swallow
   * whatever BoringSSL tries to flush (typically the fatal alert). The bytes
   * are reported as written so the SSL state machine completes its error
   * path instead of retrying. */
  if (loop_ssl_data->ssl_socket && loop_ssl_data->ssl_socket->ssl_pending_detach) {
    BIO_clear_retry_flags(bio);
    return length;
  }

  if (loop_ssl_data->ssl_write_batching) {
    /* Append the sealed record; the batch hits the kernel once, after
     * SSL_write returns. Reporting the full length keeps BoringSSL sealing
     * the next record instead of parking a partial one. */
    unsigned int needed = loop_ssl_data->ssl_write_batch_len + (unsigned int)length;
    if (needed > loop_ssl_data->ssl_write_batch_cap) {
      unsigned int new_cap = loop_ssl_data->ssl_write_batch_cap ? loop_ssl_data->ssl_write_batch_cap : 65536;
      while (new_cap < needed) new_cap *= 2;
      char *grown = us_realloc(loop_ssl_data->ssl_write_batch, new_cap);
      if (!grown) {
        /* Earlier sealed records sit in the batch and SSL's sequence numbers have
         * already advanced past them; writing the current record first would break
         * wire order (bad_record_mac at the peer). Same as the spill OOM path: the
         * connection cannot stay coherent. */
        if (loop_ssl_data->ssl_socket)
          loop_ssl_data->ssl_socket->ssl_fatal_error = 1;
        BIO_clear_retry_flags(bio);
        return length;
      }
      loop_ssl_data->ssl_write_batch = grown;
      loop_ssl_data->ssl_write_batch_cap = new_cap;
    }
    memcpy(loop_ssl_data->ssl_write_batch + loop_ssl_data->ssl_write_batch_len, data, (size_t)length);
    loop_ssl_data->ssl_write_batch_len = needed;
    BIO_clear_retry_flags(bio);
    return length;
  }
  int written = us_socket_raw_write(loop_ssl_data->ssl_socket, data, length);

  BIO_clear_retry_flags(bio);
  if (!written) {
    BIO_set_retry_write(bio);
    return -1;
  }
  return written;
}

/* Flush the ciphertext batch to its socket in one write. A partial write
 * spills the remainder into the loop's single spill slot - SSL already
 * counts those records as delivered, so they are drained (in order, to this
 * socket only) from its writable event. Returns 1 when the wire took
 * everything, 0 when a spill is now pending. */
static int ssl_flush_write_batch(struct loop_ssl_data *loop_ssl_data, struct us_socket_t *s) {
  unsigned int len = loop_ssl_data->ssl_write_batch_len;
  if (!len) return 1;
  loop_ssl_data->ssl_write_batch_len = 0;
  int written = us_socket_raw_write(s, loop_ssl_data->ssl_write_batch, (int)len);
  if (written < 0) written = 0;
  if ((unsigned int)written < len) {
    unsigned int remainder = len - (unsigned int)written;
    char *spill = us_malloc(remainder);
    if (!spill) {
      /* Out of memory with ciphertext in flight: the connection cannot stay
       * coherent (SSL already advanced its sequence numbers). Drop it. */
      s->ssl_fatal_error = 1;
      return 0;
    }
    memcpy(spill, loop_ssl_data->ssl_write_batch + written, remainder);
    loop_ssl_data->ssl_spill = spill;
    loop_ssl_data->ssl_spill_len = remainder;
    loop_ssl_data->ssl_spill_off = 0;
    loop_ssl_data->ssl_spill_owner = s;
    return 0;
  }
  return 1;
}

/* Try to drain the spill slot for `s`. Returns 1 when clear (or not ours),
 * 0 while ciphertext is still pending for this socket. */
static int ssl_drain_spill(struct loop_ssl_data *loop_ssl_data, struct us_socket_t *s) {
  if (loop_ssl_data->ssl_spill_owner != s) return 1;
  unsigned int pending = loop_ssl_data->ssl_spill_len - loop_ssl_data->ssl_spill_off;
  int written = us_socket_raw_write(s, loop_ssl_data->ssl_spill + loop_ssl_data->ssl_spill_off, (int)pending);
  if (written < 0) written = 0;
  loop_ssl_data->ssl_spill_off += (unsigned int)written;
  if (loop_ssl_data->ssl_spill_off == loop_ssl_data->ssl_spill_len) {
    us_free(loop_ssl_data->ssl_spill);
    loop_ssl_data->ssl_spill = NULL;
    loop_ssl_data->ssl_spill_len = 0;
    loop_ssl_data->ssl_spill_off = 0;
    loop_ssl_data->ssl_spill_owner = NULL;
    return 1;
  }
  return 0;
}

/* Release the spill slot when its owner dies (close path). */
static void ssl_release_spill(struct us_loop_t *loop, struct us_socket_t *s) {
  struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)loop->data.ssl_data;
  if (loop_ssl_data && loop_ssl_data->ssl_spill_owner == s) {
    /* Hard close with ciphertext still spilled: give the kernel one last
     * chance to take it (it usually can - the spill is bounded small). */
    ssl_drain_spill(loop_ssl_data, s);
  }
  if (loop_ssl_data && loop_ssl_data->ssl_spill_owner == s) {
    us_free(loop_ssl_data->ssl_spill);
    loop_ssl_data->ssl_spill = NULL;
    loop_ssl_data->ssl_spill_len = 0;
    loop_ssl_data->ssl_spill_off = 0;
    loop_ssl_data->ssl_spill_owner = NULL;
  }
}

void us_internal_ssl_socket_relocated(struct us_loop_t *loop, struct us_socket_t *old_s,
                                      struct us_socket_t *new_s) {
  struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)loop->data.ssl_data;
  if (!loop_ssl_data) return;
  if (loop_ssl_data->ssl_spill_owner == old_s) {
    loop_ssl_data->ssl_spill_owner = new_s;
  }
  if (loop_ssl_data->ssl_last_fatal_error_owner == (void *)old_s) {
    loop_ssl_data->ssl_last_fatal_error_owner = (void *)new_s;
  }
}

static int BIO_s_custom_read(BIO *bio, char *dst, int length) {
  struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)BIO_get_data(bio);

  BIO_clear_retry_flags(bio);
  if (!loop_ssl_data->ssl_read_input_length) {
    BIO_set_retry_read(bio);
    return -1;
  }

  if ((unsigned int)length > loop_ssl_data->ssl_read_input_length) {
    length = loop_ssl_data->ssl_read_input_length;
  }

  memcpy(dst, loop_ssl_data->ssl_read_input + loop_ssl_data->ssl_read_input_offset, length);

  loop_ssl_data->ssl_read_input_offset += length;
  loop_ssl_data->ssl_read_input_length -= length;
  return length;
}

static struct loop_ssl_data *ssl_set_loop_data(struct us_socket_t *s) {
  struct us_loop_t *loop = s->group->loop;
  struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)loop->data.ssl_data;

  loop_ssl_data->ssl_read_input_length = 0;
  loop_ssl_data->ssl_read_input_offset = 0;
  loop_ssl_data->ssl_socket = s;
  return loop_ssl_data;
}

/* The loop's shared TLS plaintext buffer. Split out so the fault injector can
 * fail this one allocation: a 512 KiB malloc only returns NULL where the OS
 * does not overcommit, which is the only place the crash was ever seen. */
static char *ssl_alloc_read_output(void) {
#if defined(LIBUS_SOCKET_FAULT_INJECTION) && LIBUS_SOCKET_FAULT_INJECTION
  ssize_t injected = 0;
  int unused = 0;
  if (US_FAULT_CHECK(US_FAULT_SSL_LOOP_BUFFER, -1, injected, unused)) return NULL;
#endif
  return us_malloc(LIBUS_RECV_BUFFER_LENGTH + LIBUS_RECV_BUFFER_PADDING * 2);
}

void us_internal_init_loop_ssl_data(struct us_loop_t *loop) {
  if (!loop->data.ssl_data) {
    struct loop_ssl_data *loop_ssl_data = us_calloc(1, sizeof(struct loop_ssl_data));
    if (!loop_ssl_data) Bun__outOfMemory();
    loop_ssl_data->ssl_read_output = ssl_alloc_read_output();
    if (!loop_ssl_data->ssl_read_output) Bun__outOfMemory();

    OPENSSL_init_ssl(0, NULL);

    loop_ssl_data->shared_biom = BIO_meth_new(BIO_TYPE_MEM, "µS BIO");
    if (!loop_ssl_data->shared_biom) Bun__outOfMemory();
    BIO_meth_set_create(loop_ssl_data->shared_biom, BIO_s_custom_create);
    BIO_meth_set_write(loop_ssl_data->shared_biom, BIO_s_custom_write);
    BIO_meth_set_read(loop_ssl_data->shared_biom, BIO_s_custom_read);
    BIO_meth_set_ctrl(loop_ssl_data->shared_biom, BIO_s_custom_ctrl);

    loop_ssl_data->shared_rbio = BIO_new(loop_ssl_data->shared_biom);
    loop_ssl_data->shared_wbio = BIO_new(loop_ssl_data->shared_biom);
    if (!loop_ssl_data->shared_rbio || !loop_ssl_data->shared_wbio) Bun__outOfMemory();
    BIO_set_data(loop_ssl_data->shared_rbio, loop_ssl_data);
    BIO_set_data(loop_ssl_data->shared_wbio, loop_ssl_data);

    loop->data.ssl_data = loop_ssl_data;
  }
}

void us_internal_free_loop_ssl_data(struct us_loop_t *loop) {
  struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)loop->data.ssl_data;
  if (loop_ssl_data) {
    us_free(loop_ssl_data->ssl_read_output);
    us_free(loop_ssl_data->ssl_write_batch);
    us_free(loop_ssl_data->ssl_spill);
    BIO_free(loop_ssl_data->shared_rbio);
    BIO_free(loop_ssl_data->shared_wbio);
    BIO_meth_free(loop_ssl_data->shared_biom);
    us_free(loop_ssl_data);
    /* us_internal_init_loop_ssl_data's guard reads this: leaving it dangling
     * would hand a freed loop_ssl_data back to the next TLS socket. */
    loop->data.ssl_data = NULL;
  }
}

/* ── SSL_CTX construction ────────────────────────────────────────────────── */

static int us_ssl_ctx_use_privatekey_content(SSL_CTX *ctx, const char *content, int type) {
  int reason_code, ret = 0;
  BIO *in;
  EVP_PKEY *pkey = NULL;
  if (content == NULL) return 0;
  in = BIO_new_mem_buf(content, strlen(content));
  if (in == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_BUF_LIB);
    goto end;
  }

  if (type == SSL_FILETYPE_PEM) {
    reason_code = ERR_R_PEM_LIB;
    pkey = PEM_read_bio_PrivateKey(in, NULL, SSL_CTX_get_default_passwd_cb(ctx),
                                   SSL_CTX_get_default_passwd_cb_userdata(ctx));
  } else if (type == SSL_FILETYPE_ASN1) {
    reason_code = ERR_R_ASN1_LIB;
    pkey = d2i_PrivateKey_bio(in, NULL);
  } else {
    OPENSSL_PUT_ERROR(SSL, SSL_R_BAD_SSL_FILETYPE);
    goto end;
  }

  if (pkey == NULL) {
    OPENSSL_PUT_ERROR(SSL, reason_code);
    goto end;
  }
  ret = SSL_CTX_use_PrivateKey(ctx, pkey);
  EVP_PKEY_free(pkey);
end:
  BIO_free(in);
  return ret;
}

/* The context's own cert store for mutation: the process-shared root store and
 * the still-empty SSL_CTX_new() store are first replaced by a private full
 * default-root copy, and the context is marked so the per-socket attach keeps
 * it. https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_context.cc#L1831 */
static X509_STORE *us_ssl_ctx_get_own_cert_store(SSL_CTX *ctx) {
  X509_STORE *store = SSL_CTX_get_cert_store(ctx);
  /* us_get_shared_default_ca_store() up-refs before returning, so release
   * the reference taken just for this comparison. */
  X509_STORE *shared = us_get_shared_default_ca_store();
  int store_is_shared = store != NULL && store == shared;
  X509_STORE_free(shared);
  us_ex_idx_ensure();
  int store_is_empty = 0;
  if (store != NULL && !store_is_shared) {
    const STACK_OF(X509_OBJECT) *objs = X509_STORE_get0_objects(store);
    store_is_empty = objs == NULL || sk_X509_OBJECT_num(objs) == 0;
  }
  /* A user `ca` can legitimately add zero certificates (a key PEM is ignored,
   * like Node), leaving an intentionally-empty pin set: only a context with
   * no `ca` configured at all may be seeded with the default roots here. */
  int user_ca = SSL_CTX_get_ex_data(ctx, us_ctx_user_ca_ex_idx) != NULL;
  if (store == NULL || store_is_shared || (store_is_empty && !user_ca)) {
    X509_STORE *own = us_get_default_ca_store();
    if (own == NULL) {
      return NULL;
    }
    SSL_CTX_set_cert_store(ctx, own);
    store = own;
  }
  /* Without this marker us_internal_ssl_attach() would hand client sockets
   * the shared default roots, discarding the store configured here. */
  SSL_CTX_set_ex_data(ctx, us_ctx_user_ca_ex_idx, (void *)1);
  return store;
}

static int add_ca_cert_to_ctx_store(SSL_CTX *ctx, const char *content, X509_STORE *store) {
  X509 *x = NULL;
  ERR_clear_error();
  int count = 0;
  if (content == NULL) return 0;
  BIO *in = BIO_new_mem_buf(content, strlen(content));
  if (in == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_BUF_LIB);
    goto end;
  }

  while ((x = PEM_read_bio_X509(in, NULL, SSL_CTX_get_default_passwd_cb(ctx),
                                SSL_CTX_get_default_passwd_cb_userdata(ctx)))) {
    X509_STORE_add_cert(store, x);
    if (!SSL_CTX_add_client_CA(ctx, x)) {
      X509_free(x);
      BIO_free(in);
      return 0;
    }
    count++;
    X509_free(x);
  }
end:
  BIO_free(in);
  if (count == 0) {
    /* The PEM loop terminates with PEM_R_NO_START_LINE once there are no
     * (more) CERTIFICATE blocks. A PEM document that contains no
     * certificates at all - Node's test suite passes a private key here - is
     * ignored the way Node ignores it rather than failing the whole context.
     * Content that is not PEM at all, or a malformed certificate block, is
     * still an error. */
    unsigned long pem_err = ERR_peek_last_error();
    if ((pem_err == 0 || (ERR_GET_LIB(pem_err) == ERR_LIB_PEM &&
                          ERR_GET_REASON(pem_err) == PEM_R_NO_START_LINE)) &&
        strstr(content, "-----BEGIN ") != NULL) {
      ERR_clear_error();
      return 1;
    }
    return 0;
  }
  ERR_clear_error();
  return 1;
}

static int us_ssl_ctx_use_certificate_chain(SSL_CTX *ctx, const char *content) {
  BIO *in;
  int ret = 0;
  X509 *x = NULL;

  ERR_clear_error();
  if (content == NULL) return 0;
  in = BIO_new_mem_buf(content, strlen(content));
  if (in == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_BUF_LIB);
    goto end;
  }

  x = PEM_read_bio_X509_AUX(in, NULL, SSL_CTX_get_default_passwd_cb(ctx),
                            SSL_CTX_get_default_passwd_cb_userdata(ctx));
  if (x == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_PEM_LIB);
    goto end;
  }

  ret = SSL_CTX_use_certificate(ctx, x);
  if (ERR_peek_error() != 0) ret = 0;

  if (ret) {
    X509 *ca;
    int r;
    uint32_t err;

    SSL_CTX_clear_chain_certs(ctx);
    while ((ca = PEM_read_bio_X509(
                in, NULL, SSL_CTX_get_default_passwd_cb(ctx),
                SSL_CTX_get_default_passwd_cb_userdata(ctx))) != NULL) {
      r = SSL_CTX_add0_chain_cert(ctx, ca);
      if (!r) {
        X509_free(ca);
        ret = 0;
        goto end;
      }
    }
    err = ERR_peek_last_error();
    if (ERR_GET_LIB(err) == ERR_LIB_PEM &&
        ERR_GET_REASON(err) == PEM_R_NO_START_LINE) {
      ERR_clear_error();
    } else {
      ret = 0;
    }
  }
end:
  X509_free(x);
  BIO_free(in);
  return ret;
}

static int us_verify_callback(int preverify_ok, X509_STORE_CTX *ctx) {
  /* Always continue; the user inspects via us_socket_verify_error after
   * on_handshake. Returning 1 defers the decision to JS without aborting
   * mid-handshake - the same model as Node (crypto_tls.cc VerifyCallback). */
  return 1;
}

/* Drop the strdup'd passphrase. Called as soon as private-key load completes
 * (the only consumer of the passwd_cb), so the secret never outlives ctx
 * construction and SSL_CTX_free() is sufficient on every later path. Also
 * called on the build-error path before SSL_CTX_free. */
static void ssl_ctx_drop_passphrase(SSL_CTX *ctx) {
  void *password = SSL_CTX_get_default_passwd_cb_userdata(ctx);
  if (password) {
    us_free(password);
    SSL_CTX_set_default_passwd_cb_userdata(ctx, NULL);
  }
}

static void ssl_ctx_build_fail(SSL_CTX *ctx) {
  ssl_ctx_drop_passphrase(ctx);
  /* ex_data slot already set right after SSL_CTX_new, so the free_func will
   * decrement ssl_ctx_live on this SSL_CTX_free. */
  SSL_CTX_free(ctx);
}

/* Exported for quic.c (lsquic configures ALPN/transport-params on the SSL_CTX
 * directly) and as the body of us_ssl_ctx_from_options. */
SSL_CTX *us_ssl_ctx_build_raw(struct us_bun_socket_context_options_t options,
                              enum create_bun_socket_error_t *err) {
  ERR_clear_error();

  SSL_CTX *ssl_context = SSL_CTX_new(TLS_method());
  atomic_fetch_add(&ssl_ctx_live, 1);
  /* Register the live-count free_func first thing so every exit (including
   * build_fail) balances. The packed reneg policy reuses the same slot. */
  SSL_CTX_set_ex_data(ssl_context, us_ssl_ctx_ex_idx(), NULL);

  /* Default options we rely on — changing these breaks the BIO logic. */
  SSL_CTX_set_read_ahead(ssl_context, 1);
  SSL_CTX_set_mode(ssl_context, SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER);
  /* BoringSSL ships with SSL_MODE_NO_AUTO_CHAIN set; Node clears it so a
   * leaf-only `cert` presents the intermediates found in the context's store
   * (crypto_context.cc#L1640). It only runs when the configured chain is 1. */
  SSL_CTX_clear_mode(ssl_context, SSL_MODE_NO_AUTO_CHAIN);
  /* Honor explicit minVersion/maxVersion (Node's secureProtocol/min/maxVersion);
   * default to a TLS1.2 floor when no minimum is requested. */
  SSL_CTX_set_min_proto_version(ssl_context, options.ssl_min_version ? options.ssl_min_version : TLS1_2_VERSION);
  if (options.ssl_max_version) {
    SSL_CTX_set_max_proto_version(ssl_context, options.ssl_max_version);
  }

  if (options.ssl_prefer_low_memory_usage) {
    SSL_CTX_set_mode(ssl_context, SSL_MODE_RELEASE_BUFFERS);
  }

  if (options.passphrase) {
    SSL_CTX_set_default_passwd_cb_userdata(ssl_context, (void *)us_strdup(options.passphrase));
  }
  /* Installed unconditionally: with no userdata it supplies an empty password
   * (see passphrase_cb), matching Node's key-decryption error shape. */
  SSL_CTX_set_default_passwd_cb(ssl_context, passphrase_cb);

  /* Multiple identities (e.g. an RSA and an EC pair, the way Node accepts
   * arrays of key/cert or several pfx entries) must be loaded pair-wise:
   * loading every certificate first and then every key makes BoringSSL check
   * each key against the last certificate loaded and fail with
   * KEY_TYPE_MISMATCH on a mixed configuration. With pair-wise loading the
   * later identity replaces the earlier one in the legacy slot, which is the
   * documented BoringSSL behaviour the adapted tests expect. */
  int interleave_identities = !options.cert_file_name && !options.key_file_name &&
                              options.cert && options.key &&
                              options.cert_count == options.key_count &&
                              options.cert_count > 1;
  if (interleave_identities) {
    for (unsigned int i = 0; i < options.cert_count; i++) {
      if (us_ssl_ctx_use_certificate_chain(ssl_context, options.cert[i]) != 1 ||
          us_ssl_ctx_use_privatekey_content(ssl_context, options.key[i], SSL_FILETYPE_PEM) != 1) {
        ssl_ctx_build_fail(ssl_context);
        return NULL;
      }
    }
  } else {
    if (options.cert_file_name) {
      if (SSL_CTX_use_certificate_chain_file(ssl_context, options.cert_file_name) != 1) {
        ssl_ctx_build_fail(ssl_context);
        return NULL;
      }
    } else if (options.cert && options.cert_count > 0) {
      for (unsigned int i = 0; i < options.cert_count; i++) {
        if (us_ssl_ctx_use_certificate_chain(ssl_context, options.cert[i]) != 1) {
          ssl_ctx_build_fail(ssl_context);
          return NULL;
        }
      }
    }

    if (options.key_file_name) {
      if (SSL_CTX_use_PrivateKey_file(ssl_context, options.key_file_name, SSL_FILETYPE_PEM) != 1) {
        ssl_ctx_build_fail(ssl_context);
        return NULL;
      }
    } else if (options.key && options.key_count > 0) {
      for (unsigned int i = 0; i < options.key_count; i++) {
        if (us_ssl_ctx_use_privatekey_content(ssl_context, options.key[i], SSL_FILETYPE_PEM) != 1) {
          ssl_ctx_build_fail(ssl_context);
          return NULL;
        }
      }
    }
  }
  /* passwd_cb is only consulted by SSL_CTX_use_PrivateKey* above; the secret
   * is dead now. Dropping it here means SSL_CTX_free() is sufficient cleanup
   * everywhere downstream — no special "owner" path. */
  ssl_ctx_drop_passphrase(ssl_context);

  if (options.ca_file_name) {
    /* An explicit CA replaces the default trust store (Node.js semantics):
     * chains must validate exclusively against the supplied CAs. The SSL_CTX
     * already owns a fresh, empty X509_STORE from SSL_CTX_new(), so
     * SSL_CTX_load_verify_locations below populates only the user's CAs. */
    STACK_OF(X509_NAME) *ca_list = SSL_load_client_CA_file(options.ca_file_name);
    if (ca_list == NULL) {
      *err = CREATE_BUN_SOCKET_ERROR_LOAD_CA_FILE;
      ssl_ctx_build_fail(ssl_context);
      return NULL;
    }
    SSL_CTX_set_client_CA_list(ssl_context, ca_list);
    us_ex_idx_ensure();
    SSL_CTX_set_ex_data(ssl_context, us_ctx_user_ca_ex_idx, (void *)1);
    if (SSL_CTX_load_verify_locations(ssl_context, options.ca_file_name, NULL) != 1) {
      *err = CREATE_BUN_SOCKET_ERROR_INVALID_CA_FILE;
      ssl_ctx_build_fail(ssl_context);
      return NULL;
    }
    SSL_CTX_set_verify(ssl_context,
        options.reject_unauthorized ? (SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT)
                                    : SSL_VERIFY_PEER,
        us_verify_callback);

  } else if (options.ca && options.ca_count > 0) {
    us_ex_idx_ensure();
    SSL_CTX_set_ex_data(ssl_context, us_ctx_user_ca_ex_idx, (void *)1);
    /* As above: user CAs only, into the SSL_CTX's own initially-empty store —
     * otherwise a server doing mTLS with `ca: [internalCA]` would also accept
     * any client certificate that chains to a public root. */
    X509_STORE *cert_store = SSL_CTX_get_cert_store(ssl_context);
    for (unsigned int i = 0; i < options.ca_count; i++) {
      if (!add_ca_cert_to_ctx_store(ssl_context, options.ca[i], cert_store)) {
        *err = CREATE_BUN_SOCKET_ERROR_INVALID_CA;
        ssl_ctx_build_fail(ssl_context);
        return NULL;
      }
      ERR_clear_error();
      SSL_CTX_set_verify(ssl_context,
          options.reject_unauthorized ? (SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT)
                                      : SSL_VERIFY_PEER,
          us_verify_callback);
    }
  } else {
    /* No user CA: seed the shared default root store, like Node's
     * addRootCerts() when `ca` is absent - the handshake-time auto-chain and
     * (for requestCert) client verification both read it. The getter up-refs,
     * so set_cert_store owns exactly one reference per context. */
    SSL_CTX_set_cert_store(ssl_context, us_get_shared_default_ca_store());
    if (options.request_cert) {
      SSL_CTX_set_verify(ssl_context,
          options.reject_unauthorized ? (SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT)
                                      : SSL_VERIFY_PEER,
          us_verify_callback);
    }
  }

  if (options.dh_params_file_name) {
    DH *dh_2048 = NULL;
    FILE *paramfile = fopen(options.dh_params_file_name, "r");
    if (paramfile) {
      dh_2048 = PEM_read_DHparams(paramfile, NULL, NULL, NULL);
      fclose(paramfile);
    } else {
      ssl_ctx_build_fail(ssl_context);
      return NULL;
    }
    if (dh_2048 == NULL) {
      ssl_ctx_build_fail(ssl_context);
      return NULL;
    }
    const long set_tmp_dh = SSL_CTX_set_tmp_dh(ssl_context, dh_2048);
    DH_free(dh_2048);
    if (set_tmp_dh != 1) {
      ssl_ctx_build_fail(ssl_context);
      return NULL;
    }
    if (!SSL_CTX_set_cipher_list(ssl_context, DEFAULT_CIPHER_LIST)) {
      ssl_ctx_build_fail(ssl_context);
      return NULL;
    }
  }

  if (options.ssl_ciphers) {
    if (!SSL_CTX_set_cipher_list(ssl_context, options.ssl_ciphers)) {
      /* Peek, don't consume: the caller decomposes the queued reason
       * (NO_CIPHER_MATCH, INVALID_COMMAND) into the JS error. */
      unsigned long ssl_err = ERR_peek_error();
      if (!(strlen(options.ssl_ciphers) == 0 && ERR_GET_REASON(ssl_err) == SSL_R_NO_CIPHER_MATCH)) {
        *err = CREATE_BUN_SOCKET_ERROR_INVALID_CIPHERS;
        ssl_ctx_build_fail(ssl_context);
        return NULL;
      }
      ERR_clear_error();
    }
  }

  if (options.secure_options) {
    SSL_CTX_set_options(ssl_context, options.secure_options);
  }

  if (options.crl && options.crl_count > 0) {
    /* Mirrors Node's SecureContext::AddCRL: each PEM CRL is added to the
     * context's OWN store (never the process-shared default root store) and
     * CRL checking is enabled for the whole chain. */
    X509_STORE *crl_store = us_ssl_ctx_get_own_cert_store(ssl_context);
    if (!crl_store) {
      *err = CREATE_BUN_SOCKET_ERROR_INVALID_CRL;
      ssl_ctx_build_fail(ssl_context);
      return NULL;
    }
    for (unsigned int i = 0; i < options.crl_count; i++) {
      BIO *crl_bio = BIO_new_mem_buf(options.crl[i], -1);
      if (!crl_bio) {
        *err = CREATE_BUN_SOCKET_ERROR_INVALID_CRL;
        ssl_ctx_build_fail(ssl_context);
        return NULL;
      }
      X509_CRL *crl = PEM_read_bio_X509_CRL(crl_bio, NULL, NULL, NULL);
      BIO_free(crl_bio);
      if (!crl) {
        *err = CREATE_BUN_SOCKET_ERROR_INVALID_CRL;
        ssl_ctx_build_fail(ssl_context);
        return NULL;
      }
      int added = X509_STORE_add_crl(crl_store, crl);
      X509_CRL_free(crl);
      if (!added) {
        *err = CREATE_BUN_SOCKET_ERROR_INVALID_CRL;
        ssl_ctx_build_fail(ssl_context);
        return NULL;
      }
    }
    X509_STORE_set_flags(crl_store,
                         X509_V_FLAG_CRL_CHECK | X509_V_FLAG_CRL_CHECK_ALL);
  }

  if (options.session_timeout > 0) {
    SSL_CTX_set_timeout(ssl_context, options.session_timeout);
  }

  if (options.allow_partial_trust_chain) {
    /* Mirrors Node's SecureContext::SetAllowPartialTrustChain, which also
     * flags only the context's own store. A store that cannot be prepared
     * fails context creation: the user explicitly asked for the option. */
    X509_STORE *partial_store = us_ssl_ctx_get_own_cert_store(ssl_context);
    if (!partial_store) {
      ssl_ctx_build_fail(ssl_context);
      return NULL;
    }
    X509_STORE_set_flags(partial_store, X509_V_FLAG_PARTIAL_CHAIN);
  }

  if (options.sigalgs) {
    if (!SSL_CTX_set1_sigalgs_list(ssl_context, options.sigalgs)) {
      ssl_ctx_build_fail(ssl_context);
      return NULL;
    }
  }

  /* Surface resumable sessions through the new-session callback the way Node
   * does: for TLS 1.3 the resumable session only exists once the peer's
   * NewSessionTicket arrives, and BoringSSL only exposes it here. NO_INTERNAL
   * keeps BoringSSL from also caching it. */
  SSL_CTX_set_session_cache_mode(ssl_context, SSL_SESS_CACHE_CLIENT |
                                                  SSL_SESS_CACHE_SERVER |
                                                  SSL_SESS_CACHE_NO_INTERNAL |
                                                  SSL_SESS_CACHE_NO_AUTO_CLEAR);
  SSL_CTX_sess_set_new_cb(ssl_context, us_ssl_new_session_cb);
  SSL_CTX_set_keylog_callback(ssl_context, us_ssl_keylog_cb);
  return ssl_context;
}

/* node:tls `secureContext.context.addCACert(pem)`: append the certificates in
 * `content` to this context's trust store. Returns 0 when the content is not
 * a PEM document or contains a malformed certificate. */
int us_ssl_ctx_add_ca_cert(SSL_CTX *ctx, const char *content) {
  if (!ctx || !content) {
    return 0;
  }
  /* addCACert must EXTEND the default trust set the way Node does: the
   * own-store helper replaces a shared or still-empty store with a private
   * full default-root copy before the user's CA is appended. */
  X509_STORE *store = us_ssl_ctx_get_own_cert_store(ctx);
  if (!store) {
    return 0;
  }
  /* A CA added after the context was built (pfx extras, addCACert) lands in
   * the store the handshake-time auto-chain walks, so a leaf-only cert picks
   * the intermediate up with no eager re-walk. */
  return add_ca_cert_to_ctx_store(ctx, content, store);
}

/* node:tls `pfx` support: parse a PKCS#12 blob and hand back PEM-encoded
 * key / certificate / extra-chain strings the regular key/cert/ca options can
 * consume. Returns 1 on success; the three out-strings are libc malloc'd (not
 * us_malloc) because the Rust caller releases them with libc free(). On
 * failure returns 0 and sets *err_reason to a static tag: "parse" (not
 * PKCS#12), "mac" (bad passphrase / corrupt), "key" (no private key),
 * "cert" (no certificate). */
static int pem_from_bio(BIO *bio, char **out, size_t *out_len) {
  char *mem = NULL;
  long n = BIO_get_mem_data(bio, &mem);
  if (n <= 0 || !mem) return 0;
  char *copy = (char *)malloc((size_t)n + 1);
  if (!copy) return 0;
  memcpy(copy, mem, (size_t)n);
  copy[n] = 0;
  *out = copy;
  *out_len = (size_t)n;
  return 1;
}

int us_ssl_parse_pkcs12(const char *data, size_t len, const char *pass,
                        char **out_key, size_t *out_key_len,
                        char **out_cert, size_t *out_cert_len,
                        char **out_ca, size_t *out_ca_len,
                        const char **err_reason) {
  *out_key = *out_cert = *out_ca = NULL;
  *out_key_len = *out_cert_len = *out_ca_len = 0;
  *err_reason = NULL;
  int ok = 0;
  EVP_PKEY *pkey = NULL;
  X509 *cert = NULL;
  STACK_OF(X509) *extra = NULL;
  PKCS12 *p12 = NULL;
  BIO *kb = NULL, *cb = NULL, *ab = NULL;
  if (len > INT_MAX) {
    /* BIO_new_mem_buf takes an int; a negative value would mean
     * "treat as a NUL-terminated string", silently misparsing the blob. */
    *err_reason = "parse";
    return 0;
  }
  BIO *in = BIO_new_mem_buf(data, (int)len);
  if (!in) {
    *err_reason = "parse";
    return 0;
  }
  p12 = d2i_PKCS12_bio(in, NULL);
  BIO_free(in);
  if (!p12) {
    *err_reason = "parse";
    ERR_clear_error();
    return 0;
  }
  if (!PKCS12_parse(p12, pass ? pass : "", &pkey, &cert, &extra)) {
    *err_reason = "mac";
    ERR_clear_error();
    goto done;
  }
  if (!pkey) {
    *err_reason = "key";
    goto done;
  }
  if (!cert) {
    *err_reason = "cert";
    goto done;
  }
  kb = BIO_new(BIO_s_mem());
  cb = BIO_new(BIO_s_mem());
  if (!kb || !cb || !PEM_write_bio_PrivateKey(kb, pkey, NULL, NULL, 0, NULL, NULL) ||
      !PEM_write_bio_X509(cb, cert) || !pem_from_bio(kb, out_key, out_key_len) ||
      !pem_from_bio(cb, out_cert, out_cert_len)) {
    *err_reason = "parse";
    goto done;
  }
  if (extra && sk_X509_num(extra) > 0) {
    ab = BIO_new(BIO_s_mem());
    if (ab) {
      for (size_t i = 0; i < sk_X509_num(extra); i++) {
        PEM_write_bio_X509(ab, sk_X509_value(extra, i));
      }
      pem_from_bio(ab, out_ca, out_ca_len);
    }
  }
  ok = 1;
done:
  if (!ok) {
    free(*out_key);
    free(*out_cert);
    free(*out_ca);
    *out_key = *out_cert = *out_ca = NULL;
  }
  if (kb) BIO_free(kb);
  if (cb) BIO_free(cb);
  if (ab) BIO_free(ab);
  if (pkey) EVP_PKEY_free(pkey);
  if (cert) X509_free(cert);
  if (extra) sk_X509_pop_free(extra, X509_free);
  if (p12) PKCS12_free(p12);
  ERR_clear_error();
  return ok;
}

SSL_CTX *us_ssl_ctx_from_options(struct us_bun_socket_context_options_t options,
                                 enum create_bun_socket_error_t *err) {
  SSL_CTX *ctx = us_ssl_ctx_build_raw(options, err);
  if (!ctx) return NULL;

  /* SecureContext is mode-neutral (Node lets one back both tls.connect and
   * tls.createServer), so we can't bake client-vs-server into the CTX. CTX
   * verify_mode comes purely from options (ca/request_cert/reject_unauthorized)
   * in build_raw — for a server that decides whether CertificateRequest is
   * sent, so we MUST NOT force VERIFY_PEER here. The per-SSL client override
   * (verify mode + trust store) lives in us_internal_ssl_attach. */

  /* Reneg policy is the only Bun-specific config BoringSSL has nowhere to
   * store. Packed into one ex_data slot (no malloc; the void* IS the value)
   * so it dies with the SSL_CTX refcount. The slot was already registered in
   * build_raw for the live counter; this just overwrites its NULL value. */
  if (options.client_renegotiation_limit || options.client_renegotiation_window) {
    SSL_CTX_set_ex_data(ctx, us_ssl_ctx_ex_idx(),
        US_RENEG_PACK(options.client_renegotiation_limit,
                      options.client_renegotiation_window));
  }

  return ctx;
}

/* SSL_CTX's own refcount IS the refcount; SSL_new() takes one more per socket
 * internally, so a socket outlives its SecureContext without help from us.
 * Exported so context.c / socket.c stay free of OpenSSL headers. */
void us_internal_ssl_ctx_up_ref(SSL_CTX *p) {
  if (p) SSL_CTX_up_ref(p);
}
void us_internal_ssl_ctx_unref(SSL_CTX *p) {
  if (p) SSL_CTX_free(p);
}

/* ── Per-socket SSL attach/detach ────────────────────────────────────────── */

void us_internal_ssl_attach(struct us_socket_t *s, SSL_CTX *ctx,
                            int is_client, const char *sni,
                            struct us_listen_socket_t *listener) {
  us_internal_init_loop_ssl_data(s->group->loop);
  struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;

  SSL *ssl = SSL_new(ctx);
  /* Only Bun.connect / node:tls sockets surface the 'session' event; tagging
   * just those keeps the new-session callback a no-op for every other TLS
   * consumer (fetch, Bun.serve, postgres, websockets) instead of serializing
   * a session per handshake that the dispatch then discards. */
  /* The listener's own kind is always 0; the kind it assigns to accepted
   * sockets lives in accept_kind and may not have been copied onto `s` yet
   * when its SSL is initialized. */
  if (ssl && (us_socket_kind(s) == BUN_SOCKET_KIND_BUN_SOCKET_TLS ||
              (listener && listener->accept_kind == BUN_SOCKET_KIND_BUN_SOCKET_TLS))) {
    /* The very first TLS attach in a process can be a client connection, and
     * nothing on that path has registered the ex_data indices yet - using the
     * still--1 index would make CRYPTO_set_ex_data grow its slot array toward
     * (size_t)-1. */
    us_ex_idx_ensure();
    SSL_set_ex_data(ssl, us_ssl_is_socket_ex_idx, (void *)1);
  }
  SSL_set_bio(ssl, loop_ssl_data->shared_rbio, loop_ssl_data->shared_wbio);
  BIO_up_ref(loop_ssl_data->shared_rbio);
  BIO_up_ref(loop_ssl_data->shared_wbio);

  /* renegotiation: ssl_renegotiate_explicit lets us bound it on the client
   * (issues #6197/#5363); never on the server (DoS vector). */
  if (is_client) {
    SSL_set_renegotiate_mode(ssl, ssl_renegotiate_explicit);
    SSL_set_connect_state(ssl);
    if (sni) SSL_set_tlsext_host_name(ssl, sni);
    /* The CTX is mode-neutral and may have verify_mode == NONE (no
     * ca/requestCert in options). Clients must always run verification so
     * verify_error is populated for the JS rejectUnauthorized check — but
     * setting VERIFY_PEER on the CTX would make a server using the same
     * SecureContext send CertificateRequest. SSL_set_verify scopes the mode to
     * this socket; SSL_set0_verify_cert_store gives it the process-shared root
     * bundle without touching the CTX (servers using the same CTX never pay
     * the ~150-root build). us_verify_callback returns 1 so the handshake
     * never aborts here — JS reads verify_error and decides. */
    if (SSL_CTX_get_verify_mode(ctx) == SSL_VERIFY_NONE) {
      SSL_set_verify(ssl, SSL_VERIFY_PEER, us_verify_callback);
      us_ex_idx_ensure();
      if (!SSL_CTX_get_ex_data(ctx, us_ctx_user_ca_ex_idx)) {
        /* Default context: give this socket the process-shared root bundle.
         * A context whose store holds user-provided CAs (ca/caFile options or
         * addCACert) keeps using its own store - overriding it here would
         * hide those CAs from chain verification. */
        X509_STORE *roots = us_get_shared_default_ca_store();
        if (roots) SSL_set0_verify_cert_store(ssl, roots);
      }
    }
  } else {
    SSL_set_accept_state(ssl);
    SSL_set_renegotiate_mode(ssl, ssl_renegotiate_never);
    /* sni_cb recovers ls per-SSL — never via the shared SSL_CTX. */
    us_ex_idx_ensure();
    SSL_set_ex_data(ssl, us_ssl_listener_ex_idx, listener);
  }

  s->ssl = ssl;
  s->ssl_handshake_state = HANDSHAKE_PENDING;
  s->ssl_write_wants_read = 0;
  s->ssl_read_wants_write = 0;
  s->ssl_fatal_error = 0;
  s->ssl_raw_tap = 0;
  s->ssl_shutdown_after_spill = 0;
  s->ssl_close_after_spill = 0;
  s->ssl_end_delivered = 0;
  s->ssl_in_use = 0;
  s->ssl_pending_detach = 0;
  s->ssl_pending_close_code = 0;
  s->ssl_is_server = is_client ? 0 : 1;
}

void us_internal_ssl_detach(struct us_socket_t *s) {
  /* Error/RST teardowns (us_internal_socket_close_raw) reach here without going
   * through us_internal_ssl_close: release any spilled ciphertext this socket
   * owns or the loop-wide slot dangles (batching permanently disabled, and a
   * reused socket address would drain the dead socket's records). */
  ssl_release_spill(s->group->loop, s);
  if (s->ssl) {
    if (s->ssl_in_use) {
      /* SSL_do_handshake/SSL_read is on the stack (a JS callback run from
       * inside it destroyed the socket); freeing now would leave BoringSSL
       * working on freed memory when control returns. The driver frees it
       * when the call unwinds. */
      s->ssl_pending_detach = 1;
      return;
    }
    SSL_free(s_ssl(s));
    s->ssl = NULL;
    /* Same for a parked handshake reason: no dispatch can claim it now, and a
     * socket reusing this address would report it as its own failure. */
    struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;
    if (loop_ssl_data && loop_ssl_data->ssl_last_fatal_error_owner == (void *)s) {
      loop_ssl_data->ssl_last_fatal_error[0] = 0;
      loop_ssl_data->ssl_last_fatal_error_owner = NULL;
    }
  }
}

/* ── Verify error reporting ──────────────────────────────────────────────── */

const char *us_X509_error_code(long err) {
  const char *code = "UNSPECIFIED";
#define CASE_X509_ERR(CODE) case X509_V_ERR_##CODE: code = #CODE; break;
  switch (err) {
    CASE_X509_ERR(UNABLE_TO_GET_ISSUER_CERT)
    CASE_X509_ERR(UNABLE_TO_GET_CRL)
    CASE_X509_ERR(UNABLE_TO_DECRYPT_CERT_SIGNATURE)
    CASE_X509_ERR(UNABLE_TO_DECRYPT_CRL_SIGNATURE)
    CASE_X509_ERR(UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY)
    CASE_X509_ERR(CERT_SIGNATURE_FAILURE)
    CASE_X509_ERR(CRL_SIGNATURE_FAILURE)
    CASE_X509_ERR(CERT_NOT_YET_VALID)
    CASE_X509_ERR(CERT_HAS_EXPIRED)
    CASE_X509_ERR(CRL_NOT_YET_VALID)
    CASE_X509_ERR(CRL_HAS_EXPIRED)
    CASE_X509_ERR(ERROR_IN_CERT_NOT_BEFORE_FIELD)
    CASE_X509_ERR(ERROR_IN_CERT_NOT_AFTER_FIELD)
    CASE_X509_ERR(ERROR_IN_CRL_LAST_UPDATE_FIELD)
    CASE_X509_ERR(ERROR_IN_CRL_NEXT_UPDATE_FIELD)
    CASE_X509_ERR(OUT_OF_MEM)
    CASE_X509_ERR(DEPTH_ZERO_SELF_SIGNED_CERT)
    CASE_X509_ERR(SELF_SIGNED_CERT_IN_CHAIN)
    CASE_X509_ERR(UNABLE_TO_GET_ISSUER_CERT_LOCALLY)
    CASE_X509_ERR(UNABLE_TO_VERIFY_LEAF_SIGNATURE)
    CASE_X509_ERR(CERT_CHAIN_TOO_LONG)
    CASE_X509_ERR(CERT_REVOKED)
    CASE_X509_ERR(INVALID_CA)
    CASE_X509_ERR(PATH_LENGTH_EXCEEDED)
    CASE_X509_ERR(INVALID_PURPOSE)
    CASE_X509_ERR(CERT_UNTRUSTED)
    CASE_X509_ERR(CERT_REJECTED)
    CASE_X509_ERR(HOSTNAME_MISMATCH)
  }
#undef CASE_X509_ERR
  return code;
}

static long us_internal_verify_peer_certificate(const SSL *ssl, long def) {
  if (!ssl) return def;
  long err = def;
  X509 *peer_cert = SSL_get_peer_certificate(ssl);
  if (peer_cert) {
    X509_free(peer_cert);
    err = SSL_get_verify_result(ssl);
  } else {
    const SSL_CIPHER *curr_cipher = SSL_get_current_cipher(ssl);
    const SSL_SESSION *sess = SSL_get_session(ssl);
    if ((curr_cipher && SSL_CIPHER_get_auth_nid(curr_cipher) == NID_auth_psk) ||
        (sess && SSL_SESSION_get_protocol_version(sess) == TLS1_3_VERSION &&
         SSL_session_reused(ssl))) {
      return X509_V_OK;
    }
  }
  return err;
}

struct us_bun_verify_error_t us_ssl_socket_verify_error_from_ssl(SSL *ssl) {
  long x509_verify_error =
      us_internal_verify_peer_certificate(ssl, X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT);
  if (x509_verify_error == X509_V_OK)
    return (struct us_bun_verify_error_t){.error = 0, .code = NULL, .reason = NULL};
  const char *reason = X509_verify_cert_error_string(x509_verify_error);
  const char *code = us_X509_error_code(x509_verify_error);
  return (struct us_bun_verify_error_t){.error = x509_verify_error, .code = code, .reason = reason};
}

struct us_bun_verify_error_t us_internal_ssl_verify_error(struct us_socket_t *s) {
  if (!s->ssl || !s_ssl(s) || us_socket_is_closed(s) || us_internal_ssl_is_shut_down(s)) {
    return (struct us_bun_verify_error_t){.error = 0, .code = NULL, .reason = NULL};
  }
  return us_ssl_socket_verify_error_from_ssl(s_ssl(s));
}

/* ── Handshake state machine ─────────────────────────────────────────────── */

/* Park the fatal OpenSSL reason behind a failed SSL_* call where the
 * handshake-failure dispatch can find it, then drain the queue and mark the
 * socket fatal. Only parks while the handshake is unfinished: that dispatch is
 * the sole consumer, so a later reason would linger and be misreported as some
 * other socket's handshake failure. */
static void ssl_park_fatal_reason(struct us_socket_t *s) {
  struct loop_ssl_data *loop_ssl_data =
      (struct loop_ssl_data *) s->group->loop->data.ssl_data;
  if (loop_ssl_data && s->ssl_handshake_state != HANDSHAKE_COMPLETED) {
    /* The OLDEST queued entry is the root cause and is what node reports
     * (https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L860);
     * later entries wrap it or belong to another socket on this thread. */
    unsigned long ssl_queue_err = ERR_peek_error();
    if (ssl_queue_err != 0) {
      ERR_error_string_n(ssl_queue_err, loop_ssl_data->ssl_last_fatal_error,
                         sizeof(loop_ssl_data->ssl_last_fatal_error));
      loop_ssl_data->ssl_last_fatal_error_owner = s;
    }
  }
  ERR_clear_error();
  s->ssl_fatal_error = 1;
}

/* The on_handshake callback runs JS which may us_socket_close(s) — that frees
 * s->ssl. Every caller MUST check ssl_gone(s) immediately after this returns
 * and bail before touching s->ssl again. */
/* If a fatal handshake reason was parked by `s`, dispatch it as the EPROTO
 * failure for `s` and return 1; the per-loop scratch is copied to the stack
 * and cleared before the dispatch runs JS. Returns 0 when nothing was parked
 * for this socket. */
static int ssl_dispatch_parked_reason(struct us_socket_t *s) {
  struct loop_ssl_data *loop_ssl_data =
      (struct loop_ssl_data *) s->group->loop->data.ssl_data;
  if (!loop_ssl_data || !loop_ssl_data->ssl_last_fatal_error[0] ||
      loop_ssl_data->ssl_last_fatal_error_owner != (void *)s) {
    return 0;
  }
  char reason[sizeof(loop_ssl_data->ssl_last_fatal_error)];
  memcpy(reason, loop_ssl_data->ssl_last_fatal_error, sizeof(reason));
  loop_ssl_data->ssl_last_fatal_error[0] = 0;
  loop_ssl_data->ssl_last_fatal_error_owner = NULL;
  struct us_bun_verify_error_t verify_error = {
      .error = -71, .code = "EPROTO", .reason = reason};
  us_dispatch_handshake(s, 0, verify_error);
  return 1;
}

static void ssl_trigger_handshake(struct us_socket_t *s, int success) {
  s->ssl_handshake_state = HANDSHAKE_COMPLETED;
  /* A fatal SSL protocol error (wrong version number, bad record, ...) was
   * recorded just before this failure: report it instead of the X509 verify
   * result so Node's tlsClientError / client error carries the OpenSSL
   * reason string. */
  if (!success && ssl_dispatch_parked_reason(s)) {
    return;
  }
  struct us_bun_verify_error_t verify_error = us_internal_ssl_verify_error(s);
  us_dispatch_handshake(s, success, verify_error);
}

static void ssl_trigger_handshake_econnreset(struct us_socket_t *s) {
  s->ssl_handshake_state = HANDSHAKE_COMPLETED;
  /* A fatal SSL protocol error (wrong version number, bad record, ...) was
   * recorded just before this close: report it instead of the generic
   * disconnected-before-established message so Node's tlsClientError /
   * client error carries the OpenSSL reason. */
  if (ssl_dispatch_parked_reason(s)) {
    return;
  }
  struct us_bun_verify_error_t verify_error = {
      .error = -46, .code = "ECONNRESET",
      .reason = "Client network socket disconnected before secure TLS connection was established"};
  us_dispatch_handshake(s, 0, verify_error);
}

/* True once a re-entrant us_socket_close() has run inside a dispatch. Any
 * `s->ssl` is NULL at that point. */
static inline int ssl_gone(struct us_socket_t *s) {
  return us_socket_is_closed(s) || s->ssl == NULL;
}

static int ssl_renegotiate(struct us_socket_t *s) {
  /* Server-forced renegotiation (HelloRequest -> SSL_ERROR_WANT_RENEGOTIATE).
   * Enforce the per-context policy (default 3 per 600s, Node's
   * CLIENT_RENEG_LIMIT/CLIENT_RENEG_WINDOW) before re-entering a full
   * handshake — otherwise a malicious server can pin a core with
   * back-to-back renegotiations. limit == 0 disables renegotiation; window
   * == 0 means the per-connection counter never resets. Returning 0 makes
   * the caller treat this as SSL_ERROR_SSL and close the connection. */
  uint32_t limit, window;
  us_reneg_policy(s_ssl(s), &limit, &window);
  struct us_ssl_reneg_state_t *st = us_reneg_state(s_ssl(s));
  s->ssl_handshake_state = HANDSHAKE_RENEGOTIATION_PENDING;
  if (!st) {
    ssl_trigger_handshake(s, 0);
    return 0;
  }
  /* Wall-clock time can step backwards (NTP, manual adjustment); the
   * unsigned subtraction below would underflow and reset the window every
   * time. Only treat the window as elapsed when time has moved forward. */
  uint64_t now_ms = (uint64_t)time(NULL) * 1000;
  if (st->count == 0 ||
      (window && now_ms >= st->window_start_ms &&
       now_ms - st->window_start_ms >= (uint64_t)window * 1000)) {
    st->window_start_ms = now_ms;
    st->count = 0;
  }
  if (st->count >= limit) {
    ssl_trigger_handshake(s, 0);
    return 0;
  }
  st->count++;
  if (!SSL_renegotiate(s_ssl(s))) {
    ssl_trigger_handshake(s, 0);
    return 0;
  }
  return 1;
}

/* Returns 1 if shutdown is complete (or impossible) and the TCP socket may be
 * closed; 0 if we sent close_notify but must wait for the peer's. */
static int ssl_handle_shutdown(struct us_socket_t *s, int force_fast_shutdown) {
    if (!s->ssl || us_internal_ssl_is_shut_down(s) || s->ssl_fatal_error || !SSL_is_init_finished(s_ssl(s)))
    return 1;

  int state = SSL_get_shutdown(s_ssl(s));
  int sent_shutdown = state & SSL_SENT_SHUTDOWN;
  int received_shutdown = state & SSL_RECEIVED_SHUTDOWN;
  if (!sent_shutdown || !received_shutdown) {
    ssl_set_loop_data(s);
    int ret = SSL_shutdown(s_ssl(s));
    if (ret == 0 && force_fast_shutdown) ret = SSL_shutdown(s_ssl(s));
    if (ret < 0) {
      int err = SSL_get_error(s_ssl(s), ret);
      if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
        ERR_clear_error();
        s->ssl_fatal_error = 1;
        return 1;
      }
      if (err == SSL_ERROR_WANT_READ || err == SSL_ERROR_WANT_WRITE) {
        /* The close_notify could not be flushed (BIO write failed: kernel
         * buffer full or peer already gone). There is no retry path —
         * SSL_SENT_SHUTDOWN is already set, so on_writable/on_data
         * short-circuit through is_shut_down and never re-dispatch the
         * alert. Returning 0 here would keep s->ssl (and BoringSSL's
         * write_buffer holding the encoded alert) alive until the next
         * socket event, which may never arrive — observed as an LSan
         * leak in node-https-checkServerIdentity.test.ts when the child
         * exits right after server.close(). The deferred-close contract
         * documented in us_internal_ssl_close only applies to the
         * SSL_shutdown()==0 case where the alert *was* flushed; here it
         * never went out, so close now. */
        return 1;
      }
      s->ssl_fatal_error = 1;
      return 1;
    }
    return ret == 1;
  }
  return 1;
}

struct us_socket_t *us_internal_ssl_close(struct us_socket_t *s, int code, void *reason) {
  if (s->ssl && s->ssl_in_use) {
    /* A JS callback running from inside SSL_do_handshake/SSL_read (ALPN, SNI,
     * keylog, ...) destroyed this socket. Reaching ssl_set_loop_data /
     * SSL_do_handshake here would re-enter BoringSSL on the same SSL* while
     * the outer ssl_run_handshake is still on the stack; defer to the SSL
     * driver's epilogue (the same protocol close_raw and ssl_detach honor),
     * releasing the spill now so the re-issued close cannot itself defer. */
    ssl_release_spill(s->group->loop, s);
    s->ssl_pending_detach = 1;
    s->ssl_pending_close_code = (unsigned char) code;
    return s;
  }
  /* Neither node's `_handle.close()` (FAST_SHUTDOWN, no reason) nor a graceful
   * close (code 0: peer close_notify / end-completion) may cut off spilled
   * ciphertext already reported as written: SSL sealed it, so it can only be
   * delivered, never re-sent. Mirror ssl_shutdown_after_spill; defer at most once. */
  if ((code == LIBUS_SOCKET_CLOSE_CODE_FAST_SHUTDOWN || code == LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN)
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
  ssl_release_spill(s->group->loop, s);
  /* SEMI_SOCKET never connected — SSL was attached eagerly on the fast-path
   * connect, but no bytes were ever exchanged. Firing on_handshake(0) here
   * lands in JS after onConnectError already tore down `this`/its handlers. */
  if (ssl_gone(s) || (us_internal_poll_type(&s->p) & POLL_TYPE_KIND_MASK) == POLL_TYPE_SEMI_SOCKET) {
    return us_internal_socket_close_raw(s, code, reason);
  }
  ssl_set_loop_data(s);
  ssl_update_handshake(s);
  if (ssl_gone(s)) return s;

  if (s->ssl_handshake_state != HANDSHAKE_COMPLETED) {
    /* Surface ECONNRESET-style handshake failure exactly once so callers
     * (fetch, sockets) don't each have to check on_close themselves. */
    ssl_trigger_handshake_econnreset(s);
    if (ssl_gone(s)) return s;
  }

  /* code != 0 (forceful — `_destroy()` / `_handle.close()` / abort): send
   * close_notify best-effort and raw-close now. The Zig destroy path detaches
   * + poll_ref.unref() right after, so deferring would orphan the us_socket_t.
   *
   * code == 0 (graceful — `end()` → markInactive → closeAndDetach(.normal)):
   * send close_notify and DEFER the fd close until the peer replies. The
   * graceful path keeps `poll_ref` held until onClose runs, so the loop stays
   * alive to receive the peer's close_notify/FIN; raw-closing here would let
   * the client resolve `close` before the server has even seen our Finished
   * under low-prio fan-out (connectionListener race). The actual raw-close
   * happens via on_end/ZERO_RETURN re-entering this function with
   * SSL_SENT_SHUTDOWN already set (ssl_handle_shutdown then returns 1). */
  if (ssl_handle_shutdown(s, code != 0)) {
    return us_internal_socket_close_raw(s, code, reason);
  }
  return s;
}
#define ssl_close us_internal_ssl_close

static void ssl_update_handshake(struct us_socket_t *s) {
  /* The OpenSSL error queue is per-thread and another socket's failure (a
   * server and a client commonly share this thread) may have left entries on
   * it; clear it before this socket's handshake step so any reason captured
   * below genuinely belongs to this socket's own failure. */
  ERR_clear_error();
    if (!s->ssl || s->ssl_handshake_state != HANDSHAKE_PENDING) return;

  /* SSL_read may have driven the handshake to completion before we got here
   * (TLS 1.3 server: client's Finished + close_notify in one segment lands as
   * ZERO_RETURN with init already finished). Report success based on what
   * BoringSSL actually negotiated, not on whether the peer happens to have
   * already closed — RECEIVED_SHUTDOWN after a completed handshake is a clean
   * close, not a handshake failure. */
  if (SSL_is_init_finished(s_ssl(s))) {
    ssl_trigger_handshake(s, 1);
    return;
  }

  if (us_socket_is_closed(s) || us_internal_ssl_is_shut_down(s) ||
      (s_ssl(s) && SSL_get_shutdown(s_ssl(s)) & SSL_RECEIVED_SHUTDOWN)) {
    ssl_trigger_handshake(s, 0);
    return;
  }

  unsigned char ssl_was_in_use = s->ssl_in_use;
  s->ssl_in_use = 1;
  int result = SSL_do_handshake(s_ssl(s));
  s->ssl_in_use = ssl_was_in_use;
  if (!ssl_was_in_use && s->ssl_pending_detach) {
    /* A callback run from inside the handshake destroyed this socket; perform
     * the deferred close now and do not touch the SSL again. */
    s->ssl_pending_detach = 0;
    us_socket_close(s, s->ssl_pending_close_code, NULL);
    return;
  }

  if (SSL_get_shutdown(s_ssl(s)) & SSL_RECEIVED_SHUTDOWN) {
    ssl_close(s, 0, NULL);
    return;
  }

  if (result <= 0) {
    int err = SSL_get_error(s_ssl(s), result);
    if (err == SSL_ERROR_PENDING_CERTIFICATE) {
      /* Suspended by an async SNICallback: stay in HANDSHAKE_PENDING with no
       * poll re-arm; us_socket_sni_resolve() re-drives the handshake when the
       * JS resolution arrives. */
      s->ssl_handshake_state = HANDSHAKE_PENDING;
      return;
    }
    if (err != SSL_ERROR_WANT_READ && err != SSL_ERROR_WANT_WRITE) {
      if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
        ssl_park_fatal_reason(s);
      }
      ssl_trigger_handshake(s, 0);
      return;
    }
    s->ssl_handshake_state = HANDSHAKE_PENDING;
    s->ssl_write_wants_read = 1;
    s->flags.last_write_failed = 1;
    return;
  }

  ssl_trigger_handshake(s, 1);
  if (ssl_gone(s)) return;
  s->ssl_write_wants_read = 1;
}

/* ── Event hooks (called from loop.c / socket.c when s->ssl != NULL) ────── */

struct us_socket_t *us_internal_ssl_on_open(struct us_socket_t *s, int is_client,
                                            char *ip, int ip_length) {
  ssl_set_loop_data(s);
  struct us_socket_t *result = us_dispatch_open(s, is_client, ip, ip_length);
  if (!result || ssl_gone(result)) return result;
  /* Kick the handshake immediately — some peers stall waiting for ClientHello. */
  ssl_set_loop_data(result);
  ssl_update_handshake(result);
  return result;
}

struct us_socket_t *us_internal_ssl_on_close(struct us_socket_t *s, int code, void *reason) {
  ssl_set_loop_data(s);
  struct us_socket_t *ret = us_dispatch_close(s, code, reason);
  /* Free SSL after on_close so user code can still inspect ALPN / cert. */
  us_internal_ssl_detach(s);
  return ret;
}

/* The EOF dispatch below is scoped to uWS HTTP server sockets: their
 * context's onEnd owns the EOF (premature-EOF clientError
 * HPE_INVALID_EOF_STATE, CONNECT/Upgrade half-open, pipeline drain after
 * FIN), and closing without dispatching silently skipped all of it for
 * node:https. Every other TLS socket kind predates the dispatch and
 * synthesizes its JS 'end' from the close event, so they keep the
 * historical force-close (dispatching for them strands sockets whose end
 * handler expects the transport to close underneath it). */
static int ssl_wants_eof_dispatch(struct us_socket_t *s) {
  return us_socket_kind(s) == BUN_SOCKET_KIND_UWS_HTTP_TLS;
}

/* Deliver the plaintext EOF to the user layer once, like the plain-TCP path
 * (loop.c dispatches us_dispatch_end for non-SSL sockets). Both TLS EOF
 * paths (peer close_notify -> ZERO_RETURN, and the raw TCP FIN that usually
 * follows it) route through here, so the bit keeps the end handler
 * single-shot. */
static struct us_socket_t *ssl_deliver_eof(struct us_socket_t *s) {
  if (s->ssl_end_delivered) {
    return s;
  }
  s->ssl_end_delivered = 1;
  return us_dispatch_end(s);
}

/* Retry a JS write parked on WANT_READ (written before the handshake
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
  ssl_set_loop_data(s);
  if (ssl_wants_eof_dispatch(s)) {
    /* Raw TCP FIN under TLS: the peer's write side is gone, so no
     * close_notify reply is ever coming. Record the TLS-level shutdown as
     * received so a later graceful close (an allow_half_open socket ending
     * its side after this EOF) completes immediately in ssl_handle_shutdown
     * instead of deferring for an alert that cannot arrive. */
    if (!ssl_gone(s)) {
      SSL_set_shutdown(s_ssl(s), SSL_get_shutdown(s_ssl(s)) | SSL_RECEIVED_SHUTDOWN);
    }
    s = ssl_deliver_eof(s);
    if (!s || us_socket_is_closed(s)) {
      return s;
    }
    if (s->flags.allow_half_open) {
      /* Keep the write side alive like the plain-TCP half-open branch in
       * loop.c: TCP permits writing after a received FIN, so queued
       * responses still flush and the app's own end() completes the
       * shutdown. */
      return s;
    }
  }
  /* TCP FIN with no half-open: send our close_notify best-effort and
   * raw-close now — deferring (the code==0 path in ssl_close) would wait
   * forever. */
  s = ssl_close(s, 0, NULL);
  if (s && !us_socket_is_closed(s) && !s->ssl_close_after_spill) {
    s = us_internal_socket_close_raw(s, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, NULL);
  }
  return s;
}

struct us_socket_t *us_internal_ssl_on_writable(struct us_socket_t *s) {
  ssl_set_loop_data(s);
  {
    struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;
    /* Ciphertext from a partial batch flush goes out before anything else;
     * while it is pending nothing new may be written for this socket. */
    if (loop_ssl_data && !ssl_drain_spill(loop_ssl_data, s)) {
      return s;
    }
    if (s->ssl_shutdown_after_spill) {
      s->ssl_shutdown_after_spill = 0;
      us_internal_ssl_shutdown(s);
      if (ssl_gone(s)) return s;
    }
    if (s->ssl_close_after_spill) {
      s->ssl_close_after_spill = 0;
      return us_internal_ssl_close(s, s->ssl_pending_close_code, NULL);
    }
  }
  ssl_update_handshake(s);
  if (ssl_gone(s)) return s;

  if (s->ssl_read_wants_write) {
    s->ssl_read_wants_write = 0;
    /* Re-enter the data path with an empty buffer; SSL_read will pull from
     * the kernel via the next readable event but this lets it flush any
     * pending decrypt that was blocked on a write. */
    s = us_internal_ssl_on_data(s, "", 0);
    if (!s || ssl_gone(s)) return s;
  }
  if (ssl_gone(s) || s->ssl_fatal_error) return s;
  /* uWS HTTP sockets keep the pre-existing SENT_SHUTDOWN suppression: their
   * onWritable clears the teardown timeout armed at shutdown. node sockets
   * still get write-completion dispatch after a half-close in either
   * direction. */
  if (ssl_wants_eof_dispatch(s) && us_internal_ssl_is_shut_down(s)) return s;

  if (s->ssl_handshake_state == HANDSHAKE_COMPLETED) {
    s = us_dispatch_writable(s);
  }
  return s;
}

struct us_socket_t *us_internal_ssl_on_data(struct us_socket_t *s, char *data, int length) {
  /* See ssl_update_handshake: start this socket's SSL processing with a clean
   * per-thread error queue so a captured reason cannot belong to another
   * socket on the same thread. */
  ERR_clear_error();
  /* An accepted node:tls socket's kind is only assigned after its SSL was
   * attached, so the is-a-bun-socket marker the session/keylog callbacks key
   * on may still be missing. Set it lazily before the SSL_read that will
   * fire those callbacks. */
  if (s->ssl && us_socket_kind(s) == BUN_SOCKET_KIND_BUN_SOCKET_TLS &&
      !SSL_get_ex_data(s->ssl, us_ssl_is_socket_ex_idx)) {
    us_ex_idx_ensure();
    SSL_set_ex_data(s->ssl, us_ssl_is_socket_ex_idx, (void *)1);
  }
  /* upgradeTLS [raw, _] half observes ciphertext before SSL_read consumes it.
   * Skip the empty-flush call from on_writable (length==0 → no real wire bytes). */
  if (s->ssl_raw_tap && length > 0) {
    s = us_dispatch_ssl_raw_tap(s, data, length);
    if (!s || us_socket_is_closed(s) || !s->ssl) return s;
  }

  struct loop_ssl_data *loop_ssl_data = ssl_set_loop_data(s);

  loop_ssl_data->ssl_read_input = data;
  loop_ssl_data->ssl_read_input_length = length;

  if (us_socket_is_closed(s)) return NULL;
  /* Neither SENT_SHUTDOWN (TLS half-close from `socket.shutdown()` / node:tls
   * `_final`) nor a sent FIN (POLL_TYPE_SOCKET_SHUT_DOWN) may skip the read
   * loop: a half-closed socket still reads. The peer may have application
   * data in flight that has to be delivered before its close_notify (handled
   * as ZERO_RETURN below) or FIN closes us - under TLS 1.2 this is the
   * NORMAL case for a write()+end() server, because the server finishes its
   * handshake (and ends) one flight before the client can reply. Only bail
   * when reading is genuinely impossible. */
  if (!s->ssl || !s_ssl(s) || s->ssl_fatal_error) {
    ssl_close(s, 0, NULL);
    return NULL;
  }

  /* DO NOT call ssl_update_handshake() before the SSL_read loop. SSL_read
   * drives the handshake itself; firing on_handshake here lets the JS callback
   * write() → ssl_set_loop_data() → clobber the BIO buffer that still holds
   * piggybacked application data. The on_writable tail-call below (gated on
   * ssl_write_wants_read, which on_open()'s update_handshake set) is what
   * pulls the server's handshake event through after each round-trip. */

  int read = 0;
restart:
  while (1) {
    unsigned char ssl_was_in_use = s->ssl_in_use;
    s->ssl_in_use = 1;
    int just_read = SSL_read(s_ssl(s),
                             loop_ssl_data->ssl_read_output + LIBUS_RECV_BUFFER_PADDING + read,
                             LIBUS_RECV_BUFFER_LENGTH - read);
    s->ssl_in_use = ssl_was_in_use;
    if (!ssl_was_in_use && s->ssl_pending_detach) {
      /* A callback run from inside this read destroyed the socket; perform
       * the deferred close now and stop processing. */
      s->ssl_pending_detach = 0;
      return us_socket_close(s, s->ssl_pending_close_code, NULL);
    }

    if (just_read <= 0) {
      int err = SSL_get_error(s_ssl(s), just_read);
      /* SSL_ERROR_PENDING_CERTIFICATE: the handshake is suspended waiting for
       * an async SNICallback (us_select_cert_cb returned retry). Treat it
       * like WANT_READ - stop the read loop, deliver whatever was decrypted,
       * and park the socket; us_socket_sni_resolve() re-drives the handshake
       * when the JS resolution arrives. */
      if (err != SSL_ERROR_WANT_READ && err != SSL_ERROR_WANT_WRITE &&
          err != SSL_ERROR_PENDING_CERTIFICATE) {
        if (err == SSL_ERROR_WANT_RENEGOTIATE) {
          if (ssl_renegotiate(s)) continue;
          if (ssl_gone(s)) return NULL;
          err = SSL_ERROR_SSL;
        } else if (err == SSL_ERROR_ZERO_RETURN) {
          /* Remote close_notify. A NewSessionTicket that rode in ahead of the
           * close_notify was parked by the new-session callback; deliver it
           * first (wire order - the ticket preceded these bytes, and Node's
           * NewSessionCallback runs before the data reaches JS), then the
           * decrypted data, then the EOF. */
          ssl_flush_pending_session(s);
          ssl_flush_pending_keylog(s);
          if (ssl_gone(s)) return NULL;
          if (read) {
            s = us_dispatch_data(s, loop_ssl_data->ssl_read_output + LIBUS_RECV_BUFFER_PADDING, read);
            if (!s || ssl_gone(s)) return NULL;
          }
          /* close_notify only closed the PEER's write side; when it rides in
           * the same flight as its Finished, the loop tail below is never
           * reached and a parked write would be destroyed with the socket. */
          s = ssl_retry_parked_write(s);
          if (!s || ssl_gone(s)) return NULL;
          /* TLS-level EOF: for uWS HTTP sockets, dispatch the user layer's
           * end handler like a TCP FIN would (see ssl_wants_eof_dispatch),
           * then honor half-open exactly like the plain-TCP eof branch in
           * loop.c. */
          if (ssl_wants_eof_dispatch(s)) {
            s = ssl_deliver_eof(s);
            if (!s || ssl_gone(s)) return NULL;
            if (s->flags.allow_half_open) {
              /* close_notify only ended the peer's write side; ours may
               * still flush queued bytes, and the app's own end() completes
               * the shutdown (ssl_handle_shutdown sees RECEIVED_SHUTDOWN and
               * finishes immediately). */
              return s;
            }
          }
          s = ssl_close(s, 0, NULL);
          if (!s || ssl_gone(s)) return NULL;
          /* Spill-deferred close: the socket is still live; report it so the
           * caller's bookkeeping does not treat it as destroyed. */
          return s;
        }

        if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
          ssl_park_fatal_reason(s);
        }
        ssl_close(s, 0, NULL);
        loop_ssl_data->ssl_last_fatal_error[0] = 0;
        return NULL;
      } else {
        if (err == SSL_ERROR_WANT_WRITE) s->ssl_read_wants_write = 1;

        /* If the BIO still has unread ciphertext at this point, the TLS
         * framing is broken — close. */
        if (loop_ssl_data->ssl_read_input_length) {
          return ssl_close(s, 0, NULL);
        }
        /* SSL_read drove the handshake to completion but returned no app
         * data (peer's Finished arrived alone). Fire on_handshake here —
         * deferring to the on_writable tail-call lets the low-prio queue
         * (SSL_in_init throttles to 5/tick) reorder the server's
         * secureConnection event past the client's close under fan-out
         * loads. The save/restore below makes this safe even if the JS
         * callback writes; with read==0 the buffer is empty anyway. */
        if (s->ssl_handshake_state == HANDSHAKE_PENDING && SSL_is_init_finished(s_ssl(s))) {
          ssl_trigger_handshake(s, 1);
          if (ssl_gone(s)) return NULL;
          loop_ssl_data->ssl_socket = s;
        }
        if (!read) break;

        /* Deliver any parked session/keylog payloads BEFORE the data: the
         * SSL_read that parked them has returned, the ticket preceded these
         * bytes on the wire (Node's NewSessionCallback also runs before the
         * data reaches JS), and the data dispatch may run JS that closes the
         * socket (an agent with keepAlive off destroys it as soon as the
         * response completes) - the tail flush below never runs then and the
         * parked session would be dropped. ssl_read_input_length is 0 here
         * (checked above), so JS writing from the session handler cannot
         * clobber pending ciphertext. */
        ssl_flush_pending_session(s);
        ssl_flush_pending_keylog(s);
        if (ssl_gone(s)) return NULL;
        s = us_dispatch_data(s, loop_ssl_data->ssl_read_output + LIBUS_RECV_BUFFER_PADDING, read);
        if (!s || ssl_gone(s)) return NULL;
        break;
      }
    } else if (s->ssl_handshake_state != HANDSHAKE_COMPLETED) {
      /* SSL_read returned application data with the handshake having
       * finished inside it. Fire on_handshake before delivering data so the
       * caller can inspect ALPN and re-tag the socket. The save/restore lets
       * the JS callback write() without clobbering the BIO buffer that may
       * still hold ciphertext for the next SSL_read. (PR #25946 gated this to
       * clients because the server-side fire reordered node:http2/grpc-js
       * session setup; the save/restore here is what was missing — those
       * suites are re-verified below.) */
      char *saved_input = loop_ssl_data->ssl_read_input;
      unsigned int saved_length = loop_ssl_data->ssl_read_input_length;
      unsigned int saved_offset = loop_ssl_data->ssl_read_input_offset;
      ssl_trigger_handshake(s, 1);
      if (ssl_gone(s)) return NULL;
      loop_ssl_data->ssl_read_input = saved_input;
      loop_ssl_data->ssl_read_input_length = saved_length;
      loop_ssl_data->ssl_read_input_offset = saved_offset;
      loop_ssl_data->ssl_socket = s;
    }

    read += just_read;

    if (read == LIBUS_RECV_BUFFER_LENGTH) {
      char *saved_input = loop_ssl_data->ssl_read_input;
      unsigned int saved_length = loop_ssl_data->ssl_read_input_length;
      unsigned int saved_offset = loop_ssl_data->ssl_read_input_offset;
      /* Same flush-before-dispatch as the loop exit below; the save/restore
       * around this block protects the ciphertext still in the BIO from any
       * JS the session handler runs. */
      ssl_flush_pending_session(s);
      ssl_flush_pending_keylog(s);
      if (ssl_gone(s)) return NULL;
      s = us_dispatch_data(s, loop_ssl_data->ssl_read_output + LIBUS_RECV_BUFFER_PADDING, read);
      if (!s || ssl_gone(s)) return NULL;
      loop_ssl_data->ssl_read_input = saved_input;
      loop_ssl_data->ssl_read_input_length = saved_length;
      loop_ssl_data->ssl_read_input_offset = saved_offset;
      loop_ssl_data->ssl_socket = s;
      read = 0;
      goto restart;
    }
  }

  /* If the last SSL_write failed with WANT_READ and we've now read, give the
   * application a writable callback — but not if SSL_read just told us it
   * needs to write first (would recurse). Re-check s->ssl: any dispatch above may
   * have closed and freed s->ssl. */
  if (ssl_gone(s)) return NULL;
  s = ssl_retry_parked_write(s);
  if (!s || ssl_gone(s)) return NULL;

  /* The SSL_read loop above is fully unwound; deliver any session the
   * new-session callback parked while it ran. The JS this dispatches may
   * close the socket. */
  ssl_flush_pending_session(s);
  ssl_flush_pending_keylog(s);
  if (ssl_gone(s)) return NULL;

  return s;
}

/* Throttle reading for sockets still in TLS init — the kernel buffers for us
 * and the expensive crypto work is the first step, so deprioritising
 * mid-handshake sockets keeps fully-established ones responsive under load. */
int us_internal_ssl_is_low_prio(struct us_socket_t *s) {
  return SSL_in_init(s_ssl(s));
}

/* ── Socket-level accessors / write / shutdown ───────────────────────────── */

int us_internal_ssl_is_shut_down(struct us_socket_t *s) {
    /* Check the TCP poll-type directly; us_socket_is_shut_down() is TCP-level
   * and does not re-dispatch to SSL. */
  if (us_internal_poll_type(&s->p) == POLL_TYPE_SOCKET_SHUT_DOWN) return 1;
  return !s->ssl || !s_ssl(s) || (SSL_get_shutdown(s_ssl(s)) & SSL_SENT_SHUTDOWN) || s->ssl_fatal_error;
}

int us_internal_ssl_is_handshake_finished(struct us_socket_t *s) {
  if (!s->ssl || !s_ssl(s)) return 0;
  return SSL_is_init_finished(s_ssl(s));
}

int us_internal_ssl_handshake_callback_has_fired(struct us_socket_t *s) {
  return s->ssl && s->ssl_handshake_state == HANDSHAKE_COMPLETED;
}

void *us_internal_ssl_get_native_handle(struct us_socket_t *s) {
  return s->ssl ? s_ssl(s) : NULL;
}

int us_internal_ssl_write(struct us_socket_t *s, const char *data, int length) {
  if (us_socket_is_closed(s) || us_internal_ssl_is_shut_down(s) || length == 0) return 0;

  /* Fast-path connect attaches SSL eagerly on a SEMI_SOCKET (see
   * us_socket_group_connect_resolved_dns); on_open hasn't fired yet so
   * SNI/ALPN aren't on the SSL. SSL_write here would serialize the
   * ClientHello without them. Report 0 so the caller buffers; on_open →
   * ssl_update_handshake drains it. Mirrors the SEMI_SOCKET guard in
   * us_internal_ssl_close above. */
  if ((us_internal_poll_type(&s->p) & POLL_TYPE_KIND_MASK) == POLL_TYPE_SEMI_SOCKET) {
    return 0;
  }

    struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;

  /* Earlier batched records of ours must reach the wire before anything new:
   * SSL already counts them as written. While they cannot be delivered, the
   * caller buffers plaintext (return 0), bounding the in-flight ciphertext. */
  if (!ssl_drain_spill(loop_ssl_data, s)) {
    return 0;
  }

  loop_ssl_data->ssl_read_input_length = 0;
  loop_ssl_data->ssl_socket = s;

  /* Batch this write's records unless another socket's spill occupies the
   * slot (then write through per record, the pre-batching behavior).
   *
   * Plaintext is consumed in record-size slices and the batch flushes every
   * few records: the moment the wire blocks we STOP consuming, so the bytes
   * we report as written are honest up to one bounded spill. Reporting a
   * whole large write as consumed while its ciphertext sat in memory let the
   * layers above fire 'finish' and close before the data reached the wire. */
  int batching = (loop_ssl_data->ssl_spill_owner == NULL);
  loop_ssl_data->ssl_write_batching = batching;

  int total = 0;
  int last_ssl_written = 1;
  while (total < length) {
    int chunk = length - total;
    if (chunk > 16384) chunk = 16384;
    last_ssl_written = SSL_write(s_ssl(s), data + total, chunk);
    if (last_ssl_written <= 0) break;
    total += last_ssl_written;
    /* A batching allocation failure marks the socket fatal from inside the BIO;
     * stop sealing records for a connection that is being torn down. */
    if (s->ssl_fatal_error) break;
    if (batching && loop_ssl_data->ssl_write_batch_len >= 131072) {
      if (!ssl_flush_write_batch(loop_ssl_data, s)) break; /* wire blocked: stop consuming */
      if (s->ssl_fatal_error) break;
    }
  }
  loop_ssl_data->ssl_write_batching = 0;
  if (batching) {
    ssl_flush_write_batch(loop_ssl_data, s);
  }
  if (s->ssl_fatal_error) return 0;
  if (total > 0) return total;
  if (last_ssl_written <= 0) {
    int err = SSL_get_error(s_ssl(s), last_ssl_written);
    if (err == SSL_ERROR_WANT_READ) {
      s->ssl_write_wants_read = 1;
    } else if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
      /* SSL_write drives the handshake when it has not finished, so this is
       * where a handshake-configuration failure (impossible version window,
       * no shared cipher) surfaces for a caller that wrote before
       * 'secureConnect'. Park the reason: the handshake dispatch this failure
       * triggers reports it instead of a bare verification verdict. */
      ssl_park_fatal_reason(s);
    }
  }
  return 0;
}

void us_internal_ssl_shutdown(struct us_socket_t *s) {
  if (us_socket_is_closed(s) || us_internal_ssl_is_shut_down(s)) return;

  /* Spilled ciphertext is data the layers above already count as written;
   * a FIN/close_notify now would cut it off. Finish the shutdown from the
   * writable event once the spill drains. */
  {
    struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;
    if (loop_ssl_data && loop_ssl_data->ssl_spill_owner == s) {
      if (!ssl_drain_spill(loop_ssl_data, s)) {
        s->ssl_shutdown_after_spill = 1;
        return;
      }
    }
  }

  /* Half-close (node's end()): send close_notify, then FIN, and KEEP reading.
   * BoringSSL only refuses writes after SSL_shutdown (write_shutdown); reads
   * stay open until the peer's close_notify, and the data path reads with
   * SENT_SHUTDOWN set, so a TLS 1.2 write()+end() server still receives the
   * reply the peer sends after processing our data. A bare FIN here reads as
   * truncation ("unexpected eof") to compliant peers. */
  if (!SSL_in_init(s_ssl(s)) && !(SSL_get_shutdown(s_ssl(s)) & SSL_RECEIVED_SHUTDOWN)) {
    /* ssl_handle_shutdown sends the close_notify (BoringSSL's do_tls_write
     * prepends any pending TLS 1.3 NewSessionTicket flight to the alert, so
     * tickets are still delivered) and owns the error handling. */
    ssl_handle_shutdown(s, 0);
    us_internal_socket_raw_shutdown(s);
    return;
  }

    struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;
  loop_ssl_data->ssl_read_input_length = 0;
  loop_ssl_data->ssl_socket = s;

  int ret = SSL_shutdown(s_ssl(s));

  if (SSL_in_init(s_ssl(s)) || SSL_get_quiet_shutdown(s_ssl(s))) {
    us_internal_socket_raw_shutdown(s);
    return;
  }
  if (ret < 0) {
    int err = SSL_get_error(s_ssl(s), ret);
    if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
      ERR_clear_error();
      s->ssl_fatal_error = 1;
    }
    us_internal_socket_raw_shutdown(s);
  }
}

/* Resume a handshake suspended by an async SNICallback. `ctx` (may be NULL =
 * fall through to the default context) carries a reference that this call
 * consumes. `error` != 0 aborts the handshake instead. No-op when the socket
 * already closed/detached (the pending JS resolution outlived it). */
void us_socket_sni_resolve(struct us_socket_t *s, struct ssl_ctx_st *ctx, int error) {
  if (!s || us_socket_is_closed(s) || !s->ssl || !s_ssl(s)) {
    if (ctx) SSL_CTX_free(ctx);
    return;
  }
  if (us_ssl_sni_pending_idx < 0) {
    if (ctx) SSL_CTX_free(ctx);
    return;
  }
  struct us_ssl_sni_pending_t *pending = SSL_get_ex_data(s_ssl(s), us_ssl_sni_pending_idx);
  if (!pending || pending->state != 1) {
    /* Not actually suspended (late/duplicate resolution). */
    if (ctx) SSL_CTX_free(ctx);
    return;
  }
  if (error) {
    pending->state = 3;
    if (ctx) SSL_CTX_free(ctx);
    /* Match the synchronous abort path: the connection is dropped WITHOUT a
     * TLS alert (Node's behavior for SNICallback errors). Mark the socket for
     * the deferred close before re-driving the handshake, so the BIO swallows
     * the handshake_failure alert BoringSSL queues for select_cert_error and
     * the epilogue closes the socket; the client just sees the connection go
     * away ("disconnected before secure TLS connection was established"). */
    s->ssl_pending_detach = 1;
    s->ssl_pending_close_code = 0;
  } else {
    pending->state = 2;
    pending->resolved_ctx = ctx; /* may be NULL = default ctx */
  }
  /* Re-drive the handshake; select_cert_cb re-fires and consumes the state. */
  ssl_set_loop_data(s);
  ssl_update_handshake(s);
}

void us_internal_ssl_handshake_abort(struct us_socket_t *s) {
  s->ssl_fatal_error = 1;
  ssl_close(s, 0, NULL);
}

/* ── Adopt-TLS (STARTTLS / Bun.connect upgrade) ──────────────────────────── */

/* Feed bytes that were already read off the wire (e.g. a ClientHello consumed
 * by the plain-TCP layer before the socket was adopted into TLS) through the
 * same decrypt path as bytes arriving from the kernel. */
struct us_socket_t *us_socket_tls_feed(struct us_socket_t *s, const char *data, int length) {
  if (us_socket_is_closed(s) || !s->ssl || length <= 0) return s;
  return us_internal_ssl_on_data(s, (char *)data, length);
}

struct us_socket_t *us_socket_adopt_tls(struct us_socket_t *s,
                                        struct us_socket_group_t *group,
                                        unsigned char kind, struct ssl_ctx_st *ssl_ctx,
                                        const char *sni, int is_client, int request_cert,
                                        int reject_unauthorized, int old_ext_size,
                                        int ext_size) {
  if (us_socket_is_closed(s)) return NULL;

  struct us_socket_t *new_s = us_socket_adopt(s, group, kind, old_ext_size, ext_size);
  if (!new_s) return NULL;

  /* is_client=0 puts the SSL in accept state (server-side upgrade, e.g.
   * `new tls.TLSSocket(acceptedSocket, { isServer: true })`); there is no
   * listener for an adopted socket, so SNI resolves from the single ssl_ctx. */
  us_internal_ssl_attach(new_s, ssl_ctx, is_client, sni, NULL);
  if (!is_client && new_s->ssl) {
    /* Node's TLSWrap::SetVerifyMode runs unconditionally on server sockets:
     * !requestCert must force SSL_VERIFY_NONE, or a shared SSL_CTX built with
     * `ca` leaks its FAIL_IF_NO_PEER_CERT mode and rejects cert-less clients. */
    SSL_set_verify(new_s->ssl,
                   request_cert
                       ? SSL_VERIFY_PEER | (reject_unauthorized
                                                ? SSL_VERIFY_FAIL_IF_NO_PEER_CERT
                                                : 0)
                       : SSL_VERIFY_NONE,
                   us_verify_callback);
  }
  us_socket_resume(new_s);
  /* Do NOT kick the handshake or dispatch on_open here — the caller hasn't
   * repointed the ext slot yet, so any dispatch (open/handshake/close) would
   * land in the old (TCP) owner. Caller stashes ext, sets kind, fires its own
   * onOpen, then calls us_socket_start_tls_handshake() to send ClientHello. */
  return new_s;
}

void us_socket_start_tls_handshake(struct us_socket_t *s) {
  if (!s->ssl || us_socket_is_closed(s)) return;
  ssl_set_loop_data(s);
  ssl_update_handshake(s);
}

/* ── SNI on listen sockets ───────────────────────────────────────────────── */

static void sni_node_destructor(void *user) {
  struct sni_node_t *node = (struct sni_node_t *)user;
  if (!node) return;
  SSL_CTX_free(node->ctx);
  us_free(node);
}

static struct sni_node_t *resolve_listener_ctx(struct us_listen_socket_t *ls, const char *hostname) {
  if (!ls->sni) return NULL;
  return (struct sni_node_t *)sni_find(ls->sni, hostname);
}

/* Extracts the host_name from the ClientHello's server_name extension.
 * Returns the length written to `out` (NUL-terminated), or 0 if absent /
 * malformed. BoringSSL does document SSL_get_servername as usable inside
 * select_certificate_cb (extract_sni runs before the callback), but every
 * caller here reads the raw ClientHello instead so the lookup depends only
 * on the early-callback contract, not on SSL* handshake state. */
static size_t us_client_hello_servername(const SSL_CLIENT_HELLO *hello, char *out, size_t out_len) {
  const uint8_t *ext;
  size_t ext_len;
  if (!SSL_early_callback_ctx_extension_get(hello, TLSEXT_TYPE_server_name, &ext, &ext_len)) {
    return 0;
  }
  /* server_name extension: u16 list_len, then entries of (u8 type, u16 len, bytes). */
  if (ext_len < 5) return 0;
  size_t list_len = ((size_t)ext[0] << 8) | ext[1];
  if (list_len + 2 != ext_len) return 0;
  const uint8_t *p = ext + 2;
  size_t remaining = list_len;
  while (remaining >= 3) {
    uint8_t type = p[0];
    size_t name_len = ((size_t)p[1] << 8) | p[2];
    if (name_len + 3 > remaining) return 0;
    if (type == TLSEXT_NAMETYPE_host_name) {
      if (name_len == 0 || name_len >= out_len) return 0;
      memcpy(out, p + 3, name_len);
      out[name_len] = 0;
      return name_len;
    }
    p += 3 + name_len;
    remaining -= 3 + name_len;
  }
  return 0;
}

/* The async-capable certificate selector. Registered (instead of relying on
 * sni_cb alone) on listener contexts that have a dynamic JS resolver, so an
 * SNICallback that cannot answer synchronously suspends the handshake
 * (ssl_select_cert_retry -> SSL_ERROR_PENDING_CERTIFICATE) instead of falling
 * through to the default context. us_socket_sni_resolve() resumes it. */
static enum ssl_select_cert_result_t us_select_cert_cb(const SSL_CLIENT_HELLO *hello) {
  SSL *ssl = hello->ssl;
  if (!ssl || us_ssl_listener_ex_idx < 0) return ssl_select_cert_success;

  /* A previous suspension being resumed: consume the stored result. */
  struct us_ssl_sni_pending_t *pending =
      us_ssl_sni_pending_idx >= 0 ? SSL_get_ex_data(ssl, us_ssl_sni_pending_idx) : NULL;
  if (pending && pending->state == 2) {
    pending->state = 0;
    if (pending->resolved_ctx) {
      SSL_set_SSL_CTX(ssl, pending->resolved_ctx);
      SSL_CTX_free(pending->resolved_ctx);
      pending->resolved_ctx = NULL;
      return ssl_select_cert_success;
    }
    /* The asynchronous resolution selected nothing (cb(null, null)): fall
     * through to the static SNI tree below, exactly like a synchronous
     * resolver returning null - the resume must not skip the tree fallback
     * the sync path gets. */
    struct us_listen_socket_t *resumed_ls =
        (struct us_listen_socket_t *)SSL_get_ex_data(ssl, us_ssl_listener_ex_idx);
    if (resumed_ls) {
      /* Read the servername from the raw ClientHello, same as the first-call
       * path below: that is the read the early-callback contract guarantees
       * (SSL_get_servername happens to be populated by the resume re-drive
       * today, but the raw parse does not depend on that). */
      char resumed_host[256];
      if (us_client_hello_servername(hello, resumed_host, sizeof(resumed_host))) {
        struct sni_node_t *resumed_node = resolve_listener_ctx(resumed_ls, resumed_host);
        if (resumed_node) {
          SSL_set_SSL_CTX(ssl, resumed_node->ctx);
        }
      }
    }
    return ssl_select_cert_success;
  }
  if (pending && pending->state == 3) {
    pending->state = 0;
    return ssl_select_cert_error;
  }
  if (pending && pending->state == 1) {
    /* Still waiting (a spurious re-drive); keep suspending. */
    return ssl_select_cert_retry;
  }

  struct us_listen_socket_t *ls =
      (struct us_listen_socket_t *)SSL_get_ex_data(ssl, us_ssl_listener_ex_idx);
  /* With no listener resolver, the SSL may still carry a socket-level one: a
   * server-side socket adopted into TLS with its own SNICallback. */
  const int no_listener_resolver = (!ls || !ls->on_server_name);
  struct us_socket_sni_resolver_t *socket_resolver = NULL;
  if (no_listener_resolver && us_ssl_socket_sni_ex_idx >= 0) {
    socket_resolver = SSL_get_ex_data(ssl, us_ssl_socket_sni_ex_idx);
  }
  if (no_listener_resolver && !(socket_resolver && socket_resolver->cb)) {
    return ssl_select_cert_success;
  }

  char hostname[256];
  if (!us_client_hello_servername(hello, hostname, sizeof(hostname))) {
    return ssl_select_cert_success;
  }

  /* The dynamic resolver (the user's SNICallback) runs FIRST, matching Node
   * where a user-provided SNICallback replaces the default SNI handling
   * entirely - including for the bind hostname, which Listener.rs always
   * registers in the static tree (so tree-first would shadow the callback
   * for the most-requested name and break per-connection cert rotation).
   * The static tree (bind hostname + addContext entries) is the fallback
   * when the resolver selects nothing, which is also the no-user-callback
   * path: the JS dispatch returns undefined immediately in that case. */

  /* The socket processing this ClientHello - the JS resolver needs it as the
   * resume handle for an asynchronous SNICallback. */
  struct loop_ssl_data *cb_lsd = (struct loop_ssl_data *)BIO_get_data(SSL_get_wbio(ssl));
  struct us_socket_t *cb_socket = cb_lsd ? cb_lsd->ssl_socket : NULL;

  void *saved_loop_state[5];
  us_internal_ssl_loop_state_save(ssl, saved_loop_state);
  int abort_handshake = 0;
  SSL_CTX *dyn =
      socket_resolver ? socket_resolver->cb(cb_socket, hostname, &abort_handshake)
                      : ls->on_server_name(ls, hostname, &abort_handshake, cb_socket);
  us_internal_ssl_loop_state_restore(saved_loop_state);

  if (abort_handshake == 1) {
    /* Error/invalid context: drop the connection without an alert (the
     * deferred-close + BIO-swallow path, same as sni_cb). */
    struct loop_ssl_data *lsd = (struct loop_ssl_data *)BIO_get_data(SSL_get_wbio(ssl));
    if (lsd && lsd->ssl_socket) {
      lsd->ssl_socket->ssl_pending_detach = 1;
      lsd->ssl_socket->ssl_pending_close_code = 0;
    }
    return ssl_select_cert_error;
  }
  if (abort_handshake == 2) {
    /* The JS resolver answered "pending": suspend until us_socket_sni_resolve. */
    if (us_ssl_sni_pending_idx >= 0) {
      if (!pending) {
        pending = us_calloc(1, sizeof(*pending));
        SSL_set_ex_data(ssl, us_ssl_sni_pending_idx, pending);
      }
      pending->state = 1;
    }
    return ssl_select_cert_retry;
  }
  if (dyn) {
    SSL_set_SSL_CTX(ssl, dyn);
    SSL_CTX_free(dyn);
    return ssl_select_cert_success;
  }

  /* No dynamic selection: fall back to the static SNI tree (the bind
   * hostname and addContext() entries). An adopted socket has no tree. */
  if (ls) {
    struct sni_node_t *node = resolve_listener_ctx(ls, hostname);
    if (node) {
      SSL_set_SSL_CTX(ssl, node->ctx);
    }
  }
  return ssl_select_cert_success;
}

static int sni_cb(SSL *ssl, int *al, void *arg) {
  (void)al; (void)arg;
  if (!ssl || us_ssl_listener_ex_idx < 0) return SSL_TLSEXT_ERR_NOACK;
  /* The listener is per-SSL (set at accept), not the CTX-level arg — the
   * SSL_CTX is shared and may outlive any one listener. */
  struct us_listen_socket_t *ls =
      (struct us_listen_socket_t *)SSL_get_ex_data(ssl, us_ssl_listener_ex_idx);
  if (!ls) return SSL_TLSEXT_ERR_OK;
  if (ls->on_server_name) {
    /* A dynamic resolver (user SNICallback) exists: us_select_cert_cb already
     * ran it - and the static-tree fallback - at the earlier
     * select-certificate stage. Consulting the tree again here would
     * OVERWRITE the resolver's per-connection selection with the tree entry
     * (the bind hostname is always registered there), undoing the
     * SNICallback-takes-precedence contract. */
    return SSL_TLSEXT_ERR_OK;
  }
  const char *hostname = SSL_get_servername(ssl, TLSEXT_NAMETYPE_host_name);
  if (hostname && hostname[0]) {
    /* Static SNI tree only (no dynamic resolver registered for this
     * listener). */
    struct sni_node_t *node = resolve_listener_ctx(ls, hostname);
    if (node) {
      SSL_set_SSL_CTX(ssl, node->ctx);
    }
  }
  return SSL_TLSEXT_ERR_OK;
}

int us_listen_socket_add_server_name(struct us_listen_socket_t *ls,
                                     const char *hostname_pattern,
                                     SSL_CTX *ctx, void *user) {
  SSL_CTX *default_ctx = ls->ssl_ctx;
  if (!default_ctx) return -1;

  if (!ls->sni) {
    ls->sni = sni_new();
    /* Idempotent across listeners sharing this SSL_CTX — the callback reads
     * the listener off the SSL, not the arg. */
    SSL_CTX_set_tlsext_servername_callback(default_ctx, sni_cb);
  }

  struct sni_node_t *node = us_malloc(sizeof(struct sni_node_t));
  node->ctx = ctx;
  node->user = user;
  SSL_CTX_up_ref(ctx);
  /* Stash userdata on the SSL_CTX too so per-socket lookup via
   * SSL_get_SSL_CTX works regardless of which ctx the SNI cb selected. */
  us_ex_idx_ensure();
  SSL_CTX_set_ex_data(ctx, us_sni_ex_idx, user);

  if (sni_add(ls->sni, hostname_pattern, node)) {
    /* Duplicate hostname — propagate so App.h's `if (result != 0)` rollback
     * (which frees the per-domain HttpRouter it just built) actually fires. */
    sni_node_destructor(node);
    return 1;
  }
  return 0;
}

void us_listen_socket_remove_server_name(struct us_listen_socket_t *ls,
                                         const char *hostname_pattern) {
  if (!ls->sni) return;
  struct sni_node_t *node = (struct sni_node_t *)sni_remove(ls->sni, hostname_pattern);
  sni_node_destructor(node);
}

void *us_listen_socket_find_server_name_userdata(struct us_listen_socket_t *ls,
                                                 const char *hostname_pattern) {
  if (!ls->sni) return NULL;
  struct sni_node_t *node = (struct sni_node_t *)sni_find(ls->sni, hostname_pattern);
  return node ? node->user : NULL;
}

/* Returns the SSL_CTX registered for `hostname_pattern` via
 * us_listen_socket_add_server_name, or NULL. Owned - the caller must release
 * the reference. The on_server_name resolvers return owned references (the
 * SNI dispatcher frees them after SSL_set_SSL_CTX takes its own), so the
 * tree's reference must not be handed out as a borrow. */
struct ssl_ctx_st *us_listen_socket_find_server_name_ctx(struct us_listen_socket_t *ls,
                                                         const char *hostname_pattern) {
  if (!ls->sni) return NULL;
  struct sni_node_t *node = (struct sni_node_t *)sni_find(ls->sni, hostname_pattern);
  if (!node || !node->ctx) return NULL;
  SSL_CTX_up_ref(node->ctx);
  return node->ctx;
}

void us_listen_socket_on_server_name(struct us_listen_socket_t *ls,
                                     struct ssl_ctx_st *(*cb)(struct us_listen_socket_t *, const char *, int *, struct us_socket_t *)) {
  ls->on_server_name = cb;
  /* The dynamic resolver may need to suspend the handshake (async
   * SNICallback); only the early select-certificate callback supports retry,
   * so register it on the listener's default context. The servername-stage
   * sni_cb stays registered for the static SNI tree (it is a no-op when the
   * early callback already installed a context). */
  if (ls->ssl_ctx) {
    SSL_CTX_set_select_certificate_cb(ls->ssl_ctx, us_select_cert_cb);
  }
}

/* Register a socket-level SNI resolver on an already-attached server-side SSL.
 * Must run after us_socket_adopt_tls and before the handshake is driven. */
void us_socket_on_server_name(struct us_socket_t *s, us_socket_server_name_cb cb) {
  if (!s || !cb || !s->ssl || !s_ssl(s)) return;
  us_ex_idx_ensure();
  if (us_ssl_socket_sni_ex_idx < 0) return;
  SSL *ssl = s_ssl(s);
  struct us_socket_sni_resolver_t *r =
      SSL_get_ex_data(ssl, us_ssl_socket_sni_ex_idx);
  if (!r) {
    r = us_calloc(1, sizeof(*r));
    if (!r) return;
    SSL_set_ex_data(ssl, us_ssl_socket_sni_ex_idx, r);
  }
  r->cb = cb;
  /* Only the early select-certificate stage supports retry, which an async
   * SNICallback needs. The CTX is a memoized SecureContext possibly shared
   * with a listener, and this install is permanent, so us_select_cert_cb must
   * stay a no-op on any SSL carrying neither resolver. */
  SSL_CTX *ctx = SSL_get_SSL_CTX(ssl);
  if (ctx) SSL_CTX_set_select_certificate_cb(ctx, us_select_cert_cb);
}

void *us_socket_server_name_userdata(struct us_socket_t *s) {
  if (!s->ssl || !s_ssl(s) || us_sni_ex_idx < 0) return NULL;
  return SSL_CTX_get_ex_data(SSL_get_SSL_CTX(s_ssl(s)), us_sni_ex_idx);
}

void *us_internal_ssl_sni_userdata(struct us_socket_t *s) {
  return us_socket_server_name_userdata(s);
}

const char *us_internal_ssl_sni_servername(struct us_socket_t *s) {
  if (!s->ssl || !s_ssl(s)) return NULL;
  return SSL_get_servername(s_ssl(s), TLSEXT_NAMETYPE_host_name);
}

void us_internal_listen_socket_ssl_free(struct us_listen_socket_t *ls) {
  /* Accepted sockets carry `ls` in per-SSL ex_data so sni_cb can reach the
   * listener's SNI tree. Those sockets may outlive the listener (server.close()
   * keeps existing connections per Node semantics), so wipe the back-ref now —
   * sni_cb returns OK on NULL. Walk only sockets accepted INTO this listener's
   * group; uWS apps with multiple listeners on one group are scoped by the
   * `== ls` check. */
  if (us_ssl_listener_ex_idx >= 0 && ls->accept_group) {
    for (struct us_socket_t *s = ls->accept_group->head_sockets; s; s = s->next) {
      if (s->ssl && SSL_get_ex_data((SSL *)s->ssl, us_ssl_listener_ex_idx) == ls) {
        SSL_set_ex_data((SSL *)s->ssl, us_ssl_listener_ex_idx, NULL);
      }
    }
    /* Mid-handshake sockets (SSL_in_init → low_prio) are *unlinked* from
     * head_sockets while parked in loop->data.low_prio_head, and they're
     * exactly the population that will run sni_cb on the next tick. Miss them
     * here and sni_cb dereferences `ls` after it's freed. Same group-filter as
     * close_all's drain. */
    for (struct us_socket_t *s = ls->accept_group->loop->data.low_prio_head; s; s = s->next) {
      if (s->group == ls->accept_group && s->ssl &&
          SSL_get_ex_data((SSL *)s->ssl, us_ssl_listener_ex_idx) == ls) {
        SSL_set_ex_data((SSL *)s->ssl, us_ssl_listener_ex_idx, NULL);
      }
    }
  }
  if (ls->ssl_ctx) {
    us_internal_ssl_ctx_unref(ls->ssl_ctx);
    ls->ssl_ctx = NULL;
  }
  if (ls->sni) {
    sni_free(ls->sni, sni_node_destructor);
    ls->sni = NULL;
  }
}

#endif
