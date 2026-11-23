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
#include <time.h>
#include <atomic>
#include <utility>
#ifndef _WIN32
#include <pthread.h>
#endif

#ifdef LIBUS_USE_OPENSSL
#include <openssl/bio.h>
#include <openssl/dh.h>
#include <openssl/err.h>
#include <openssl/ssl.h>
#include <openssl/pkcs12.h>
#include <openssl/pool.h>
#elif LIBUS_USE_WOLFSSL
#include <wolfssl/openssl/bio.h>
#include <wolfssl/openssl/dh.h>
#include <wolfssl/openssl/err.h>
#include <wolfssl/openssl/ssl.h>
#include <wolfssl/options.h>
#endif

#include "./root_certs_header.h"
#include "./default_ciphers.h"
#include "./sni_tree.h"

using us_bio_ptr = us_unique_ptr<BIO, BIO_free>;
using us_crypto_buffer_ptr = us_unique_ptr<CRYPTO_BUFFER, CRYPTO_BUFFER_free>;
using us_x509_ptr = us_unique_ptr<X509, X509_free>;

extern "C" {

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

struct loop_ssl_data : us_allocated_t {
  char *ssl_read_input;
  us_unique_ptr<char, us_free> ssl_read_output;
  unsigned int ssl_read_input_length;
  unsigned int ssl_read_input_offset;

  struct us_socket_t *ssl_socket;
  us_unique_ptr<BIO_METHOD, BIO_meth_free> shared_biom;
  us_bio_ptr shared_rbio;
  us_bio_ptr shared_wbio;
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
  us_unique_ptr<char, us_free> ssl_write_batch;
  unsigned int ssl_write_batch_len;
  unsigned int ssl_write_batch_cap;
  int ssl_write_batching;
  /* The socket whose sealed records fill ssl_write_batch. The slot is shared
   * per-loop, so a flush must only ever deliver the batch to this socket, and
   * a batching region entered for another socket flushes these records to
   * their owner first (BIO_s_custom_write). Meaningful while
   * ssl_write_batch_len > 0. */
  struct us_socket_t *ssl_write_batch_owner;

  /* Connections whose spill (us_ssl_spill_t) holds the rest of a batch flush. While there is
   * one, no application write batches, so its spill takes at most the rest of one record. A
   * handshake flight is held whatever this says, with the first record written behind it, and
   * counts here if the kernel refuses it. */
  unsigned int ssl_batch_spills;

  /* Why ssl_raw_write ended a write side inside the running us_internal_ssl_writev or spill drain. */
  int ssl_send_error;

  /* us_socket_sni_resolve's answer; us_select_cert_cb takes it in the same re-drive. */
  us_ssl_ctx_ptr ssl_sni_resolved_ctx;
};

enum {
  HANDSHAKE_PENDING = 0,
  HANDSHAKE_COMPLETED = 1,
  HANDSHAKE_RENEGOTIATION_PENDING = 2,
};

/* No per-socket SSL struct: `s->ssl` IS the BoringSSL `SSL*`, and the 6 state
 * bits live in `us_socket_t`'s pointer-alignment padding (see internal.h). */
#define s_ssl(s) ((SSL *)(s)->ssl)

static std::atomic<long> ssl_ctx_live = 0;

long us_ssl_ctx_live_count(void) {
  return ssl_ctx_live;
}

/* ex_data indices, registered once at first SSL_CTX/SSL touch:
 *   - us_ctx_ex_idx (SSL_CTX): packed reneg {limit:u32,window:u32}; its
 *     free_func also decrements ssl_ctx_live so the counter tracks ACTUAL
 *     destruction (refcount→0), not every SSL_CTX_free.
 *   - us_ssl_rare_ex_idx (SSL): us_ssl_rare_t.
 *   - us_ssl_wrapper_ex_idx (SSL): the owner of an SSL that no us_socket_t drives.
 *
 * SSL_CTX creation runs from both the JS thread (SecureContext, Bun.connect/
 * listen) and the HTTP-client thread (HTTPContext.initWithOpts). A racy `<0`
 * check would let two threads each register the ctx_ex_idx free_func, double-
 * decrementing ssl_ctx_live forever after. (BoringSSL's CRYPTO_once is
 * internal-only, so use the platform primitive directly; root_certs.cpp does
 * the same via std::call_once.) */
static int us_ctx_ex_idx = -1;
static int us_ctx_cache_ex_idx = -1;
/* Marks an SSL_CTX whose verification store holds user-provided CAs (the
 * ca/caFile options or a later addCACert): the per-socket client attach must
 * not replace such a store with the process-shared default roots. */
static int us_ctx_user_ca_ex_idx = -1;
static int us_ssl_rare_ex_idx = -1;
/* (SSL) The SSLWrapper (src/uws/lib.rs) that owns this SSL. Not set on the SSL of a us_socket_t. */
static int us_ssl_wrapper_ex_idx = -1;
/* BIO type of the loop's shared BIO: tells a us_socket_t's SSL from an SSLWrapper's. */
static int us_ssl_bio_type = 0;
/* (SSL_CTX) packed client-certificate policy of a Bun.serve per-serverName
 * entry — see us_ssl_ctx_set_sni_policy. Absent on node:tls SecureContexts,
 * whose policy is server-level. */
static int us_ctx_sni_policy_ex_idx = -1;
/* Defined in Rust (src/uws_sys/SocketKind.rs) so the ordinal tracks the enum. */
extern const unsigned char BUN_SOCKET_KIND_BUN_SOCKET_TLS;
extern const unsigned char BUN_SOCKET_KIND_UWS_HTTP_TLS;
#ifdef _WIN32
static INIT_ONCE us_ex_idx_once = INIT_ONCE_STATIC_INIT;
#else
static pthread_once_t us_ex_idx_once = PTHREAD_ONCE_INIT;
#endif

#define US_RENEG_PACK(limit, window) ((void *)(uintptr_t)(((uint64_t)(limit) << 32) | (uint32_t)(window)))
#define US_RENEG_LIMIT(p)  ((uint32_t)((uint64_t)(uintptr_t)(p) >> 32))
#define US_RENEG_WINDOW(p) ((uint32_t)((uint64_t)(uintptr_t)(p)))

/* us_socket_t::ssl_sni_pending: an async SNICallback has the handshake suspended. */
enum {
  US_SNI_NONE = 0,
  US_SNI_WAITING = 1,
  US_SNI_RESOLVED = 2,
  US_SNI_ERROR = 3,
};

struct us_ssl_pending_event_t {
  struct us_ssl_pending_event_t *next;
  uint32_t length;
  unsigned char is_keylog;
  unsigned char data[];
};

static void us_ssl_pending_events_free(struct us_ssl_pending_event_t *events) {
  while (events) us_free(std::exchange(events, events->next));
}

/* Sealed ciphertext the kernel refused. SSL counts it as written, so it reaches this connection's
 * fd, in order, before any later record. Drained from the writable event, then freed. */
struct us_ssl_spill_t {
  unsigned int length, offset;
  /* Counted in loop_ssl_data::ssl_batch_spills. */
  unsigned char is_batch;
  char data[];
};

static void us_server_names_unref(struct us_server_names_t *names);
using us_server_names_ptr = us_unique_ptr<struct us_server_names_t, us_server_names_unref>;
static us_server_names_ptr us_server_names_ref(struct us_listen_socket_t *ls);

using us_session_sink_ptr = std::unique_ptr<void, void (*)(void *sink)>;

/* Allocated for an accepted socket, a node:tls socket's events, a client's first renegotiation, fetch's session sink, and a first spill. */
struct us_ssl_rare_t : us_allocated_t {
  /* Non-NULL exactly while us_socket_t::ssl_spilled is set. */
  us_unique_ptr<struct us_ssl_spill_t, us_free> spill;
  /* The accepting listen socket's names. */
  us_server_names_ptr server_names;
  /* Sessions and keylog lines parked inside SSL_read/SSL_do_handshake, in arrival order. */
  us_unique_ptr<struct us_ssl_pending_event_t, us_ssl_pending_events_free> pending_head;
  struct us_ssl_pending_event_t *pending_tail;
  us_session_sink_ptr session_sink{nullptr, nullptr};
  uint64_t reneg_window_start_ms;
  uint32_t reneg_count;
};

static void us_ctx_ex_free(void *parent, void *ptr, CRYPTO_EX_DATA *ad,
                           int index, long argl, void *argp) {
  (void)parent; (void)ptr; (void)ad; (void)index; (void)argl; (void)argp;
  ssl_ctx_live--;
}
static void us_ssl_rare_free(void *parent, void *ptr, CRYPTO_EX_DATA *ad,
                             int index, long argl, void *argp) {
  (void)parent; (void)ad; (void)index; (void)argl; (void)argp;
  delete (struct us_ssl_rare_t *)ptr;
}

/* Upper bounds for parked payloads: a serialized SSL_SESSION (i2d) and a
 * single keylog line. Anything larger is dropped at the parking site. */
#define US_SSL_PENDING_SESSION_MAX 65536
#define US_SSL_PENDING_KEYLOG_LINE_MAX 4096

/* Defined in src/uws/lib.rs. `wrapper` is what us_ssl_set_wrapper stored. */
extern int us_ssl_wrapper_server_identity(void *wrapper, SSL *ssl);
extern int us_ssl_wrapper_identity_checked(void *wrapper);
extern void us_ssl_wrapper_new_session(void *wrapper, SSL_SESSION *session);
extern void us_ssl_wrapper_keylog(void *wrapper, const char *line, size_t length);

static inline void *us_ssl_wrapper(const SSL *ssl) {
  return us_ssl_wrapper_ex_idx >= 0 ? SSL_get_ex_data(ssl, us_ssl_wrapper_ex_idx) : NULL;
}

static int us_ssl_is_socket(const SSL *ssl) {
  BIO *bio = SSL_get_wbio(ssl);
  return bio && BIO_method_type(bio) == us_ssl_bio_type;
}

/* The socket driving `ssl`: every BoringSSL callback runs inside one of its SSL_* calls. */
static struct us_socket_t *us_ssl_socket(const SSL *ssl) {
  if (!us_ssl_is_socket(ssl)) return NULL;
  struct us_socket_t *s = ((struct loop_ssl_data *)BIO_get_data(SSL_get_wbio(ssl)))->ssl_socket;
  return s && s->ssl == ssl ? s : NULL;
}

static inline struct us_ssl_rare_t *us_ssl_rare(const SSL *ssl);
static struct us_ssl_rare_t *us_ssl_rare_ensure(SSL *ssl);

static struct us_ssl_pending_event_t *ssl_park_event(struct us_socket_t *s, int is_keylog,
                                                     size_t length) {
  struct us_ssl_pending_event_t *event = (struct us_ssl_pending_event_t *)us_malloc(sizeof(*event) + length);
  if (!event) return NULL;
  event->next = NULL;
  event->length = (uint32_t)length;
  event->is_keylog = is_keylog ? 1 : 0;
  struct us_ssl_rare_t *rare = us_ssl_rare_ensure(s_ssl(s));
  if (rare->pending_tail) {
    rare->pending_tail->next = event;
  } else {
    rare->pending_head.reset(event);
  }
  rare->pending_tail = event;
  s->ssl_has_pending_events = 1;
  return event;
}

static void us_ssl_keylog_cb(const SSL *ssl, const char *line) {
  size_t line_len = strlen(line);
  if (line_len == 0 || line_len > US_SSL_PENDING_KEYLOG_LINE_MAX) {
    return;
  }
  void *wrapper = us_ssl_wrapper(ssl);
  if (wrapper) {
    us_ssl_wrapper_keylog(wrapper, line, line_len);
    return;
  }
  struct us_socket_t *s = us_ssl_socket(ssl);
  if (!s || us_socket_kind(s) != BUN_SOCKET_KIND_BUN_SOCKET_TLS) {
    return;
  }
  struct us_ssl_pending_event_t *event = ssl_park_event(s, 1, line_len + 1);
  if (!event) {
    return;
  }
  memcpy(event->data, line, line_len);
  /* Node appends the newline before it emits 'keylog'. */
  event->data[line_len] = '\n';
}

static int us_ssl_new_session_cb(SSL *ssl, SSL_SESSION *session) {
  void *wrapper = us_ssl_wrapper(ssl);
  if (wrapper) {
    us_ssl_wrapper_new_session(wrapper, session);
    return 0;
  }
  struct us_socket_t *s = us_ssl_socket(ssl);
  /* The owner takes its own reference if it keeps the session; 1 asks for a 'session' event. */
  if (!s || !us_dispatch_new_session(s, session)) {
    return 0;
  }
  int length = i2d_SSL_SESSION(session, NULL);
  if (length <= 0 || length > US_SSL_PENDING_SESSION_MAX) {
    return 0;
  }
  struct us_ssl_pending_event_t *event = ssl_park_event(s, 0, (size_t)length);
  if (!event) {
    return 0;
  }
  unsigned char *out = event->data;
  event->length = (uint32_t)i2d_SSL_SESSION(session, &out);
  return 0;
}

/* Runs JS, which may close the socket: call after the SSL_* call returned, then check ssl_gone(s). */
static void ssl_flush_pending_events(struct us_socket_t *s) {
  if (!s->ssl_has_pending_events) {
    return;
  }
  s->ssl_has_pending_events = 0;
  struct us_ssl_rare_t *rare = s->ssl ? us_ssl_rare(s_ssl(s)) : NULL;
  if (!rare) {
    return;
  }
  auto events = std::move(rare->pending_head);
  rare->pending_tail = NULL;
  /* Sessions first, then keylog lines. */
  for (int is_keylog = 0; is_keylog <= 1; is_keylog++) {
    for (struct us_ssl_pending_event_t *event = events.get(); event; event = event->next) {
      if (event->is_keylog != is_keylog || us_socket_is_closed(s) || !s->ssl) continue;
      if (is_keylog) {
        us_dispatch_keylog(s, event->data, (int)event->length);
      } else {
        us_dispatch_session(s, event->data, (int)event->length);
      }
    }
  }
}

/* Defined in `src/runtime/api/bun/SSLContextCache.rs`: tombstones the cache entry on
 * SSL_CTX refcount→0 so the per-VM weak SSL_CTX cache learns the pointer is
 * dead without holding a ref of its own. */
extern void bun_ssl_ctx_cache_on_free(void *parent, void *ptr, CRYPTO_EX_DATA *ad,
                                      int index, long argl, void *argp);

static void us_ex_idx_init(void) {
  us_ctx_ex_idx = SSL_CTX_get_ex_new_index(0, NULL, NULL, NULL, us_ctx_ex_free);
  us_ctx_cache_ex_idx = SSL_CTX_get_ex_new_index(0, NULL, NULL, NULL, bun_ssl_ctx_cache_on_free);
  us_ctx_user_ca_ex_idx = SSL_CTX_get_ex_new_index(0, NULL, NULL, NULL, NULL);
  us_ctx_sni_policy_ex_idx = SSL_CTX_get_ex_new_index(0, NULL, NULL, NULL, NULL);
  us_ssl_rare_ex_idx = SSL_get_ex_new_index(0, NULL, NULL, NULL, us_ssl_rare_free);
  us_ssl_wrapper_ex_idx = SSL_get_ex_new_index(0, NULL, NULL, NULL, NULL);
  us_ssl_bio_type = BIO_get_new_index() | BIO_TYPE_SOURCE_SINK;
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

static inline struct us_ssl_rare_t *us_ssl_rare(const SSL *ssl) {
  return us_ssl_rare_ex_idx >= 0 ? (struct us_ssl_rare_t *)SSL_get_ex_data(ssl, us_ssl_rare_ex_idx) : NULL;
}

static struct us_ssl_rare_t *us_ssl_rare_ensure(SSL *ssl) {
  us_ex_idx_ensure();
  struct us_ssl_rare_t *rare = (struct us_ssl_rare_t *)SSL_get_ex_data(ssl, us_ssl_rare_ex_idx);
  if (rare) return rare;
  rare = new us_ssl_rare_t();
  if (!SSL_set_ex_data(ssl, us_ssl_rare_ex_idx, rare)) Bun__outOfMemory();
  return rare;
}

void us_ssl_set_wrapper(SSL *ssl, void *wrapper) {
  us_ex_idx_ensure();
  if (!SSL_set_ex_data(ssl, us_ssl_wrapper_ex_idx, wrapper)) Bun__outOfMemory();
}

void *us_ssl_wrapper_from_verify(void *ctx) {
  SSL *ssl = (SSL *)X509_STORE_CTX_get_ex_data((X509_STORE_CTX *)ctx, SSL_get_ex_data_X509_STORE_CTX_idx());
  return ssl ? us_ssl_wrapper(ssl) : NULL;
}

/* `sink` lives until SSL_free, then `on_free(sink)` runs. Replaces the sink set before. */
void us_socket_set_session_sink(struct us_socket_t *s, void *sink, void (*on_free)(void *)) {
  us_session_sink_ptr session_sink{sink, on_free};
  if (s->ssl) us_ssl_rare_ensure(s_ssl(s))->session_sink = std::move(session_sink);
}

void *us_socket_session_sink(struct us_socket_t *s) {
  struct us_ssl_rare_t *rare = s->ssl ? us_ssl_rare(s_ssl(s)) : NULL;
  return rare ? rare->session_sink.get() : NULL;
}

/* socket.c — raw TCP FIN that does NOT re-enter the SSL layer. */
extern void us_internal_socket_raw_shutdown(struct us_socket_t *s);

static void ssl_update_handshake(struct us_socket_t *s, int fin_ends_handshake);
static int ssl_flush_write_batch(struct loop_ssl_data *loop_ssl_data, struct us_socket_t *s);
static void ssl_emit(struct loop_ssl_data *loop_ssl_data, struct us_socket_t *s, const char *data, unsigned int length, int is_batch);
static int us_ssl_inline_reject_tripped(struct us_socket_t *s);
static inline int ssl_gone(struct us_socket_t *s);
static int ssl_wants_eof_dispatch(struct us_socket_t *s);

/* ── BIO plumbing ─────────────────────────────────────────────────────────
 * The same shared mem-BIO pair is reused for every SSL* on a loop. The write
 * BIO never refuses a record: BoringSSL would hold it back, sealed and uncounted,
 * for a retry with the caller's next buffer. */

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
 * next BIO_write would otherwise land on that other socket's fd. The batching
 * flag is saved-and-zeroed so a write or close_notify for a different socket
 * inside the callback goes to that socket's fd via the per-record BIO path
 * instead of appending to the interrupted handshake's batch. */
int us_internal_ssl_loop_state_slots(void) { return US_SSL_LOOP_STATE_SLOTS; }

void us_internal_ssl_loop_state_save(void *ssl_ptr, void **out) {
  SSL *ssl = (SSL *)ssl_ptr;
  struct loop_ssl_data *d = (struct loop_ssl_data *)BIO_get_data(SSL_get_wbio(ssl));
  out[0] = d;
  out[1] = d ? (void *)d->ssl_socket : NULL;
  out[2] = d ? (void *)d->ssl_read_input : NULL;
  out[3] = d ? (void *)(uintptr_t)d->ssl_read_input_length : NULL;
  out[4] = d ? (void *)(uintptr_t)d->ssl_read_input_offset : NULL;
  out[5] = d ? (void *)(uintptr_t)d->ssl_write_batching : NULL;
  if (d) d->ssl_write_batching = 0;
}

void us_internal_ssl_loop_state_restore(void **saved) {
  struct loop_ssl_data *d = (struct loop_ssl_data *)saved[0];
  if (!d) return;
  d->ssl_socket = (struct us_socket_t *)saved[1];
  d->ssl_read_input = (char *)saved[2];
  d->ssl_read_input_length = (unsigned int)(uintptr_t)saved[3];
  d->ssl_read_input_offset = (unsigned int)(uintptr_t)saved[4];
  d->ssl_write_batching = (int)(uintptr_t)saved[5];
}

/* A send() that no retry can save loses sealed records: nothing may follow them, but what the peer sent is still read. */
static int ssl_raw_write(struct loop_ssl_data *loop_ssl_data, struct us_socket_t *s, const char *data, int length) {
  int send_error = 0;
  int written = us_internal_socket_raw_write(s, data, length, &send_error);
  if (send_error) {
    loop_ssl_data->ssl_send_error = send_error;
    s->ssl_send_rejected = 1;
    us_internal_socket_raw_shutdown(s);
    /* No write may close under its caller: us_internal_ssl_on_writable does. */
    us_internal_rearm_writable(s);
  }
  return written;
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

  /* Rejecting client whose chain verification failed: suppress the
   * post-verify flight so the peer never sees the handshake complete
   * (node's post-verify destroy cancels its queued Finished the same way). */
  if (loop_ssl_data->ssl_socket &&
      us_ssl_inline_reject_tripped(loop_ssl_data->ssl_socket)) {
    BIO_clear_retry_flags(bio);
    return length;
  }

  /* A JS callback wrote to this socket while another socket's flight is held. That flight stays: its owner can still refuse the peer. */
  int batch_is_foreign = loop_ssl_data->ssl_write_batch_len &&
                         loop_ssl_data->ssl_write_batch_owner != loop_ssl_data->ssl_socket;

  if ((loop_ssl_data->ssl_write_batching || loop_ssl_data->ssl_write_batch_len) && !batch_is_foreign) {
    /* Append the sealed record; the batch hits the kernel once, after
     * SSL_write returns. */
    unsigned int needed = loop_ssl_data->ssl_write_batch_len + (unsigned int)length;
    if (needed > loop_ssl_data->ssl_write_batch_cap) {
      unsigned int new_cap = loop_ssl_data->ssl_write_batch_cap ? loop_ssl_data->ssl_write_batch_cap : 65536;
      while (new_cap < needed) new_cap *= 2;
      if (!us_grow(loop_ssl_data->ssl_write_batch, new_cap)) {
        /* Earlier sealed records sit in the batch and SSL's sequence numbers have
         * already advanced past them; writing the current record first would break
         * wire order (bad_record_mac at the peer). Same as the spill OOM path: the
         * connection cannot stay coherent. */
        if (loop_ssl_data->ssl_socket)
          loop_ssl_data->ssl_socket->ssl_fatal_error = 1;
        BIO_clear_retry_flags(bio);
        return length;
      }
      loop_ssl_data->ssl_write_batch_cap = new_cap;
    }
    memcpy(loop_ssl_data->ssl_write_batch.get() + loop_ssl_data->ssl_write_batch_len, data, (size_t)length);
    loop_ssl_data->ssl_write_batch_len = needed;
    loop_ssl_data->ssl_write_batch_owner = loop_ssl_data->ssl_socket;
    /* Record by record, but this one leaves with the flight that was held for it: https://github.com/oven-sh/bun/issues/40653 */
    if (!loop_ssl_data->ssl_write_batching) ssl_flush_write_batch(loop_ssl_data, loop_ssl_data->ssl_socket);
    BIO_clear_retry_flags(bio);
    return length;
  }
  ssl_emit(loop_ssl_data, loop_ssl_data->ssl_socket, data, (unsigned int)length, 0);
  BIO_clear_retry_flags(bio);
  return length;
}

static int ssl_sent_close_notify(struct us_socket_t *s) {
  return (SSL_get_shutdown(s_ssl(s)) & SSL_SENT_SHUTDOWN) != 0;
}

static void ssl_discard_spill(struct loop_ssl_data *loop_ssl_data, struct us_socket_t *s) {
  if (!s->ssl_spilled) return;
  struct us_ssl_rare_t *rare = us_ssl_rare(s_ssl(s));
  loop_ssl_data->ssl_batch_spills -= rare->spill->is_batch;
  if (rare->spill->offset != rare->spill->length && !ssl_sent_close_notify(s)) s->ssl_spill_dropped = 1;
  rare->spill = NULL;
  s->ssl_spilled = 0;
}

/* Every sealed record of `s` leaves through here: to the kernel, or behind what the kernel refused. */
static void ssl_emit(struct loop_ssl_data *loop_ssl_data, struct us_socket_t *s,
                     const char *data, unsigned int length, int is_batch) {
  if (!s->ssl_spilled) {
    unsigned int written = (unsigned int)ssl_raw_write(loop_ssl_data, s, data, (int)length);
    /* Sealed after our FIN, it can never leave. */
    if (written == length || !us_internal_socket_can_raw_write(s)) return;
    data += written;
    length -= written;
  }
  struct us_ssl_rare_t *rare = us_ssl_rare_ensure(s_ssl(s));
  unsigned int held = rare->spill ? rare->spill->length : 0;
  if (!us_grow(rare->spill, sizeof(struct us_ssl_spill_t) + held + length)) {
    /* Out of memory with ciphertext in flight: the connection cannot stay
     * coherent (SSL already advanced its sequence numbers). Drop it. */
    s->ssl_fatal_error = 1;
    return;
  }
  struct us_ssl_spill_t *spill = rare->spill.get();
  if (!held) {
    spill->offset = 0;
    spill->is_batch = 0;
  }
  memcpy(spill->data + held, data, length);
  spill->length = held + length;
  if (is_batch && !spill->is_batch) {
    spill->is_batch = 1;
    loop_ssl_data->ssl_batch_spills++;
  }
  s->ssl_spilled = 1;
}

/* Flush the ciphertext batch to its socket in one write. Returns 1 when the
 * wire took everything, 0 when it did not: the rest is spilled, or dropped
 * when it can never be sent. */
static int ssl_flush_write_batch(struct loop_ssl_data *loop_ssl_data, struct us_socket_t *s) {
  unsigned int len = loop_ssl_data->ssl_write_batch_len;
  if (!len) return 1;
  if (loop_ssl_data->ssl_write_batch_owner != s) {
    /* Not this socket's records (SSL_write failed before sealing anything
     * while another socket's flight was held): leave them for their owner's
     * own flush point. */
    return 1;
  }
  loop_ssl_data->ssl_write_batch_len = 0;
  loop_ssl_data->ssl_write_batch_owner = NULL;
  ssl_emit(loop_ssl_data, s, loop_ssl_data->ssl_write_batch.get(), len, 1);
  return !s->ssl_spilled && us_internal_socket_can_raw_write(s);
}

/* Drop the batch slot when its owner dies without reaching a flush point
 * (error/RST teardown), or when a destroy from inside the handshake cancels
 * the held flight. The buffer itself is loop-owned and reused. */
static void ssl_release_batch(struct us_loop_t *loop, struct us_socket_t *s) {
  struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)loop->data.ssl_data;
  if (loop_ssl_data && loop_ssl_data->ssl_write_batch_owner == s) {
    loop_ssl_data->ssl_write_batch_len = 0;
    loop_ssl_data->ssl_write_batch_owner = NULL;
  }
}

/* Try to send the spill of `s`. Returns 1 when none is left (sent, or dropped
 * with the write side), 0 while ciphertext is still pending for this socket. */
static int ssl_drain_spill(struct loop_ssl_data *loop_ssl_data, struct us_socket_t *s) {
  if (!s->ssl_spilled) return 1;
  struct us_ssl_spill_t *spill = us_ssl_rare(s_ssl(s))->spill.get();
  spill->offset += (unsigned int)ssl_raw_write(loop_ssl_data, s, spill->data + spill->offset,
                                               (int)(spill->length - spill->offset));
  if (spill->offset != spill->length && us_internal_socket_can_raw_write(s)) return 0;
  ssl_discard_spill(loop_ssl_data, s);
  return 1;
}

/* The connection ends with ciphertext still spilled: give the kernel one last chance to take it. */
static void ssl_release_spill(struct us_loop_t *loop, struct us_socket_t *s) {
  struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)loop->data.ssl_data;
  ssl_drain_spill(loop_ssl_data, s);
  ssl_discard_spill(loop_ssl_data, s);
}

void us_internal_ssl_socket_relocated(struct us_loop_t *loop, struct us_socket_t *old_s,
                                      struct us_socket_t *new_s) {
  struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)loop->data.ssl_data;
  if (!loop_ssl_data) return;
  if (loop_ssl_data->ssl_write_batch_owner == old_s) {
    loop_ssl_data->ssl_write_batch_owner = new_s;
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
  return (char *)us_malloc(LIBUS_RECV_BUFFER_LENGTH + LIBUS_RECV_BUFFER_PADDING * 2);
}

void us_internal_init_loop_ssl_data(struct us_loop_t *loop) {
  if (!loop->data.ssl_data) {
    struct loop_ssl_data *loop_ssl_data = new struct loop_ssl_data();
    loop_ssl_data->ssl_read_output.reset(ssl_alloc_read_output());
    if (!loop_ssl_data->ssl_read_output) Bun__outOfMemory();

    OPENSSL_init_ssl(0, NULL);

    us_ex_idx_ensure();
    loop_ssl_data->shared_biom.reset(BIO_meth_new(us_ssl_bio_type, "µS BIO"));
    if (!loop_ssl_data->shared_biom) Bun__outOfMemory();
    BIO_meth_set_create(loop_ssl_data->shared_biom.get(), BIO_s_custom_create);
    BIO_meth_set_write(loop_ssl_data->shared_biom.get(), BIO_s_custom_write);
    BIO_meth_set_read(loop_ssl_data->shared_biom.get(), BIO_s_custom_read);
    BIO_meth_set_ctrl(loop_ssl_data->shared_biom.get(), BIO_s_custom_ctrl);

    loop_ssl_data->shared_rbio.reset(BIO_new(loop_ssl_data->shared_biom.get()));
    loop_ssl_data->shared_wbio.reset(BIO_new(loop_ssl_data->shared_biom.get()));
    if (!loop_ssl_data->shared_rbio || !loop_ssl_data->shared_wbio) Bun__outOfMemory();
    BIO_set_data(loop_ssl_data->shared_rbio.get(), loop_ssl_data);
    BIO_set_data(loop_ssl_data->shared_wbio.get(), loop_ssl_data);

    loop->data.ssl_data = loop_ssl_data;
  }
}

void us_internal_free_loop_ssl_data(struct us_loop_t *loop) {
  /* us_internal_init_loop_ssl_data's guard reads this: leaving it dangling
   * would hand a freed loop_ssl_data back to the next TLS socket. */
  delete (struct loop_ssl_data *)std::exchange(loop->data.ssl_data, nullptr);
}

/* ── SSL_CTX construction ────────────────────────────────────────────────── */

static int us_ssl_ctx_use_privatekey_content(SSL_CTX *ctx, const char *content, int type) {
  int reason_code;
  us_unique_ptr<EVP_PKEY, EVP_PKEY_free> pkey;
  if (content == NULL) return 0;
  us_bio_ptr in{BIO_new_mem_buf(content, strlen(content))};
  if (in == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_BUF_LIB);
    return 0;
  }

  if (type == SSL_FILETYPE_PEM) {
    reason_code = ERR_R_PEM_LIB;
    pkey.reset(PEM_read_bio_PrivateKey(in.get(), NULL, SSL_CTX_get_default_passwd_cb(ctx),
                                       SSL_CTX_get_default_passwd_cb_userdata(ctx)));
  } else if (type == SSL_FILETYPE_ASN1) {
    reason_code = ERR_R_ASN1_LIB;
    pkey.reset(d2i_PrivateKey_bio(in.get(), NULL));
  } else {
    OPENSSL_PUT_ERROR(SSL, SSL_R_BAD_SSL_FILETYPE);
    return 0;
  }

  if (pkey == NULL) {
    OPENSSL_PUT_ERROR(SSL, reason_code);
    return 0;
  }
  return SSL_CTX_use_PrivateKey(ctx, pkey.get());
}

/* The context's own cert store for mutation: the process-shared root store and
 * the still-empty SSL_CTX_new() store are first replaced by a private full
 * default-root copy, and the context is marked so the per-socket attach keeps
 * it. https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_context.cc#L1831 */
static X509_STORE *us_ssl_ctx_get_own_cert_store(SSL_CTX *ctx) {
  X509_STORE *store = SSL_CTX_get_cert_store(ctx);
  us_unique_ptr<X509_STORE, X509_STORE_free> shared{us_get_shared_default_ca_store()};
  int store_is_shared = store != NULL && store == shared.get();
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

/* The `ca` option: every CERTIFICATE block of `content` as DER into `certs`. User-supplied certificates are validated
 * with a full parse here so a bad one fails the context rather than a later handshake; the parsed object is dropped and
 * the store keeps the DER lazily. Returns the number appended, or -1 for content that is not PEM or whose first
 * certificate block does not decode or parse. As with a PEM_read_bio_X509 loop, a PEM document with no certificates
 * (Node's tests pass a private key) counts as zero, and blocks after one that fails are ignored. */
static int us_collect_ca_pem(SSL_CTX *ctx, const char *content, STACK_OF(CRYPTO_BUFFER) *certs) {
  if (content == NULL) return 0;
  ERR_clear_error();
  us_bio_ptr in{BIO_new_mem_buf(content, strlen(content))};
  if (in == NULL) return -1;
  int count = 0;
  for (;;) {
    uint8_t *out = NULL;
    long der_len = 0;
    if (!PEM_bytes_read_bio(&out, &der_len, NULL, PEM_STRING_X509, in.get(), SSL_CTX_get_default_passwd_cb(ctx),
                            SSL_CTX_get_default_passwd_cb_userdata(ctx))) {
      break;
    }
    us_unique_ptr<uint8_t, OPENSSL_free> der{out};
    us_crypto_buffer_ptr buf{CRYPTO_BUFFER_new(der.get(), der_len, NULL)};
    if (buf == NULL || !us_x509_ptr{X509_parse_from_buffer(buf.get())} || !sk_CRYPTO_BUFFER_push(certs, buf.get())) {
      if (count == 0) count = -1;
      break;
    }
    buf.release();
    count++;
  }
  if (count == 0) {
    unsigned long pem_err = ERR_peek_last_error();
    if (!((pem_err == 0 || (ERR_GET_LIB(pem_err) == ERR_LIB_PEM && ERR_GET_REASON(pem_err) == PEM_R_NO_START_LINE)) &&
          strstr(content, "-----BEGIN ") != NULL)) {
      count = -1;
    }
  }
  ERR_clear_error();
  return count;
}

static void us_crypto_buffer_stack_free(STACK_OF(CRYPTO_BUFFER) *buffers) {
  sk_CRYPTO_BUFFER_pop_free(buffers, CRYPTO_BUFFER_free);
}
using us_crypto_buffer_stack_ptr = us_unique_ptr<STACK_OF(CRYPTO_BUFFER), us_crypto_buffer_stack_free>;

static int us_crypto_buffer_cmp(const CRYPTO_BUFFER *const *a, const CRYPTO_BUFFER *const *b) {
  size_t al = CRYPTO_BUFFER_len(*a), bl = CRYPTO_BUFFER_len(*b);
  if (al != bl) return al < bl ? -1 : 1;
  return memcmp(CRYPTO_BUFFER_data(*a), CRYPTO_BUFFER_data(*b), al);
}

/* Trusts the DER certificates in `certs` (duplicates dropped) through one lazily-parsed set on `store`, and makes their
 * subjects the context's client-CA list, as X509_STORE_add_cert + SSL_CTX_add_client_CA per parsed certificate did. */
static int us_install_ca_buffers(SSL_CTX *ctx, X509_STORE *store, STACK_OF(CRYPTO_BUFFER) *certs) {
  sk_CRYPTO_BUFFER_set_cmp_func(certs, us_crypto_buffer_cmp);
  sk_CRYPTO_BUFFER_sort_and_dedup(certs, CRYPTO_BUFFER_free);
  size_t n = sk_CRYPTO_BUFFER_num(certs);
  if (n == 0) return 1;
  us_unique_ptr<CRYPTO_BUFFER *[], free> bufs{(CRYPTO_BUFFER **)malloc(n * sizeof(CRYPTO_BUFFER *))};
  if (bufs == NULL) return 0;
  for (size_t i = 0; i < n; i++) bufs[i] = sk_CRYPTO_BUFFER_value(certs, i);
  us_unique_ptr<X509_LAZY_CERT_SET, X509_LAZY_CERT_SET_free> set{X509_LAZY_CERT_SET_new(bufs.get(), n)};
  us_crypto_buffer_stack_ptr names{sk_CRYPTO_BUFFER_new_null()};
  if (set == NULL || names == NULL || !X509_STORE_add_lazy_cert_set(store, set.get())) return 0;
  for (size_t i = 0; i < n; i++) {
    const uint8_t *subject;
    size_t subject_len;
    if (!X509_LAZY_CERT_SET_get0_subject(set.get(), i, &subject, &subject_len)) return 0;
    us_crypto_buffer_ptr name{CRYPTO_BUFFER_new(subject, subject_len, NULL)};
    if (name == NULL || !sk_CRYPTO_BUFFER_push(names.get(), name.get())) return 0;
    name.release();
  }
  SSL_CTX_set0_client_CAs(ctx, names.release());
  return 1;
}

static int add_ca_cert_to_ctx_store(SSL_CTX *ctx, const char *content, X509_STORE *store) {
  ERR_clear_error();
  int count = 0;
  if (content == NULL) return 0;
  us_bio_ptr in{BIO_new_mem_buf(content, strlen(content))};
  if (in == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_BUF_LIB);
    return 0;
  }

  while (us_x509_ptr x{PEM_read_bio_X509(in.get(), NULL, SSL_CTX_get_default_passwd_cb(ctx),
                                         SSL_CTX_get_default_passwd_cb_userdata(ctx))}) {
    X509_STORE_add_cert(store, x.get());
    if (!SSL_CTX_add_client_CA(ctx, x.get())) return 0;
    count++;
  }
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
  ERR_clear_error();
  if (content == NULL) return 0;
  us_bio_ptr in{BIO_new_mem_buf(content, strlen(content))};
  if (in == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_BUF_LIB);
    return 0;
  }

  us_x509_ptr x{PEM_read_bio_X509_AUX(in.get(), NULL, SSL_CTX_get_default_passwd_cb(ctx),
                                      SSL_CTX_get_default_passwd_cb_userdata(ctx))};
  if (x == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_PEM_LIB);
    return 0;
  }

  int ret = SSL_CTX_use_certificate(ctx, x.get());
  if (ERR_peek_error() != 0) ret = 0;

  if (ret) {
    SSL_CTX_clear_chain_certs(ctx);
    while (us_x509_ptr ca{PEM_read_bio_X509(
                in.get(), NULL, SSL_CTX_get_default_passwd_cb(ctx),
                SSL_CTX_get_default_passwd_cb_userdata(ctx))}) {
      if (!SSL_CTX_add0_chain_cert(ctx, ca.get())) return 0;
      ca.release();
    }
    uint32_t err = ERR_peek_last_error();
    if (ERR_GET_LIB(err) == ERR_LIB_PEM &&
        ERR_GET_REASON(err) == PEM_R_NO_START_LINE) {
      ERR_clear_error();
    } else {
      ret = 0;
    }
  }
  return ret;
}

/* BoringSSL's ssl_auto_chain_if_needed, which at handshake time completes the legacy slot but no credential. */
static int us_ssl_ctx_auto_chain(SSL_CTX *ctx) {
  if (sk_CRYPTO_BUFFER_num(SSL_CTX_get0_chain(ctx)) != 1) return 1;
  us_unique_ptr<X509_STORE_CTX, X509_STORE_CTX_free> walk{X509_STORE_CTX_new()};
  if (walk == NULL ||
      !X509_STORE_CTX_init(walk.get(), SSL_CTX_get_cert_store(ctx), SSL_CTX_get0_certificate(ctx), NULL)) {
    return 0;
  }
  X509_verify_cert(walk.get());
  ERR_clear_error();
  us_x509_stack_ptr chain{X509_STORE_CTX_get1_chain(walk.get())};
  if (chain == NULL) return 0;
  us_x509_ptr leaf{sk_X509_shift(chain.get())};
  return SSL_CTX_set1_chain(ctx, chain.get());
}

using us_ssl_credential_ptr = us_unique_ptr<SSL_CREDENTIAL, SSL_CREDENTIAL_free>;

static us_ssl_credential_ptr us_ssl_ctx_copy_legacy_identity(SSL_CTX *ctx) {
  const STACK_OF(CRYPTO_BUFFER) *chain = SSL_CTX_get0_chain(ctx);
  size_t count = sk_CRYPTO_BUFFER_num(chain);
  us_unique_ptr<CRYPTO_BUFFER *[], us_free> certs{(CRYPTO_BUFFER **)us_calloc(count, sizeof(CRYPTO_BUFFER *))};
  if (certs == NULL) return NULL;
  for (size_t i = 0; i < count; i++) certs[i] = sk_CRYPTO_BUFFER_value(chain, i);
  us_ssl_credential_ptr identity{SSL_CREDENTIAL_new_x509()};
  if (identity != NULL && (!SSL_CREDENTIAL_set1_cert_chain(identity.get(), certs.get(), count) ||
                           !SSL_CREDENTIAL_set1_private_key(identity.get(), SSL_CTX_get0_privatekey(ctx)))) {
    return NULL;
  }
  return identity;
}

/* One identity per key type, as in OpenSSL: the last certificate of a type wins, with whichever key fits it. */
static int us_ssl_ctx_use_identities(SSL_CTX *ctx, const char *const *cert, unsigned int cert_count,
                                     const char *const *key, unsigned int key_count) {
  /* In OpenSSL's order of preference: BoringSSL serves the first usable credential. */
  enum { TYPE_ECDSA, TYPE_EDDSA, TYPE_RSA, KEY_TYPES };
  const char *leaf[KEY_TYPES] = {NULL};
  us_ssl_credential_ptr identity[KEY_TYPES];
  int ok = 1;
  for (unsigned int i = 0; i < cert_count; i++) {
    if (us_ssl_ctx_use_certificate_chain(ctx, cert[i]) != 1) return 0;
    int id = EVP_PKEY_id(X509_get0_pubkey(SSL_CTX_get0_certificate(ctx)));
    leaf[id == EVP_PKEY_EC ? TYPE_ECDSA : id == EVP_PKEY_ED25519 ? TYPE_EDDSA : TYPE_RSA] = cert[i];
  }
  /* Least preferred first: the legacy slot, which getCertificate() reads, is left holding the most preferred. */
  for (int type = KEY_TYPES; ok && type-- > 0;) {
    if (leaf[type] == NULL) continue;
    ok = us_ssl_ctx_use_certificate_chain(ctx, leaf[type]) == 1;
    int has_key = 0, mismatched = 0;
    for (unsigned int i = 0; ok && i < key_count; i++) {
      if (us_ssl_ctx_use_privatekey_content(ctx, key[i], SSL_FILETYPE_PEM) == 1) {
        has_key = 1;
        continue;
      }
      uint32_t err = ERR_peek_last_error();
      int reason = ERR_GET_LIB(err) == ERR_LIB_X509 ? ERR_GET_REASON(err) : 0;
      mismatched |= reason == X509_R_KEY_VALUES_MISMATCH;
      ok = reason == X509_R_KEY_TYPE_MISMATCH || reason == X509_R_KEY_VALUES_MISMATCH;
      if (ok) ERR_clear_error();
    }
    if (ok && has_key) {
      ok = us_ssl_ctx_auto_chain(ctx) && (identity[type] = us_ssl_ctx_copy_legacy_identity(ctx)) != NULL;
    } else if (ok && mismatched) {
      OPENSSL_PUT_ERROR(X509, X509_R_KEY_VALUES_MISMATCH);
      ok = 0;
    }
  }
  for (int type = 0; ok && type < KEY_TYPES; type++) {
    if (identity[type] != NULL) ok = SSL_CTX_add1_credential(ctx, identity[type].get());
  }
  return ok;
}

static int us_verify_callback(int preverify_ok, X509_STORE_CTX *ctx) {
  /* Always continue; the user inspects via us_socket_verify_error after
   * on_handshake. Returning 1 defers the decision to JS without aborting
   * mid-handshake - the same model as Node (crypto_tls.cc VerifyCallback). */
  return 1;
}

/* Rejecting client: keep walking (so the final verdict matches node's
 * ssl.verifyError()) but remember the failure; the BIO hook and the
 * handshake drive then keep the Finished off the wire and fail the socket. */
static int us_inline_reject_verify_callback(int preverify_ok, X509_STORE_CTX *ctx) {
  if (!preverify_ok) {
    SSL *ssl = (SSL *)X509_STORE_CTX_get_ex_data(ctx, SSL_get_ex_data_X509_STORE_CTX_idx());
    struct us_socket_t *s = ssl ? us_ssl_socket(ssl) : NULL;
    if (s) s->ssl_verify_failed = 1;
  }
  return 1;
}

/* Whether this socket is a rejecting client whose chain verification failed:
 * from that point on its handshake output is suppressed and the handshake is
 * reported as failed. */
static int us_ssl_inline_reject_tripped(struct us_socket_t *s) {
  if (!s->ssl || s->ssl_handshake_state == HANDSHAKE_COMPLETED) return 0;
  if (!s->ssl_inline_reject || !s->ssl_verify_failed) return 0;
  /* Only the final verdict rejects: an alternate chain can recover a per-depth failure. */
  return SSL_get_verify_result(s_ssl(s)) != X509_V_OK;
}

/* What the owner of a client says about the name on the server's certificate. */
enum {
  US_IDENTITY_REJECTED = 0,
  US_IDENTITY_ACCEPTED = 1,
  /* The owner does not check the name natively: its JS decides after the handshake. */
  US_IDENTITY_UNCHECKED = 2,
};

/* The syntax check of OpenSSL's cn2dnsid: whether a common name reads as a host name of two or more labels.
 * https://github.com/nodejs/node/blob/v26.12.1/deps/openssl/openssl/crypto/x509/v3_ncons.c#L341 */
static int us_looks_like_dns_name(const unsigned char *in, int len) {
  int is_dns_name = 0;
  for (int i = 0; i < len; i++) {
    unsigned char c = in[i];
    if (OPENSSL_isalnum(c) || c == '_') continue;
    if (i == 0 || i == len - 1) return 0;
    if (c == '-') continue;
    if (c != '.' || in[i + 1] == '.' || in[i - 1] == '-' || in[i + 1] == '-') return 0;
    is_dns_name = 1;
  }
  return is_dns_name;
}

/* OpenSSL's nc_dns. */
static int us_dns_name_is_within(const unsigned char *name, int len, const ASN1_IA5STRING *base) {
  if (base->length == 0) return 1;
  if (len < base->length) return 0;
  name += len - base->length;
  if (len > base->length && base->data[0] != '.' && name[-1] != '.') return 0;
  return OPENSSL_strncasecmp((const char *)name, (const char *)base->data, base->length) == 0;
}

/* OpenSSL's nc_match for a DNS name. BoringSSL's strips a trailing dot and refuses an explicit minimum of 0. */
static int us_name_constraints_check_dns_name(const NAME_CONSTRAINTS *nc, const unsigned char *name, int len) {
  enum { UNCONSTRAINED, NOT_PERMITTED, PERMITTED } match = UNCONSTRAINED;
  for (size_t i = 0; i < sk_GENERAL_SUBTREE_num(nc->permittedSubtrees); i++) {
    const GENERAL_SUBTREE *sub = sk_GENERAL_SUBTREE_value(nc->permittedSubtrees, i);
    if (sub->base->type != GEN_DNS) continue;
    if (sub->maximum || ASN1_INTEGER_get(sub->minimum) != 0) return X509_V_ERR_SUBTREE_MINMAX;
    if (match != PERMITTED) match = us_dns_name_is_within(name, len, sub->base->d.dNSName) ? PERMITTED : NOT_PERMITTED;
  }
  if (match == NOT_PERMITTED) return X509_V_ERR_PERMITTED_VIOLATION;
  for (size_t i = 0; i < sk_GENERAL_SUBTREE_num(nc->excludedSubtrees); i++) {
    const GENERAL_SUBTREE *sub = sk_GENERAL_SUBTREE_value(nc->excludedSubtrees, i);
    if (sub->base->type != GEN_DNS) continue;
    if (sub->maximum || ASN1_INTEGER_get(sub->minimum) != 0) return X509_V_ERR_SUBTREE_MINMAX;
    if (us_dns_name_is_within(name, len, sub->base->d.dNSName)) return X509_V_ERR_EXCLUDED_VIOLATION;
  }
  return X509_V_OK;
}

/* OpenSSL's NAME_CONSTRAINTS_check_CN. BoringSSL looks at common names only when there is no subjectAltName at all. */
static int us_name_constraints_check_cn(X509 *leaf, const NAME_CONSTRAINTS *nc) {
  const X509_NAME *subject = X509_get_subject_name(leaf);
  int error = X509_V_OK;
  for (int i = -1; error == X509_V_OK && (i = X509_NAME_get_index_by_NID(subject, NID_commonName, i)) >= 0;) {
    unsigned char *out = NULL;
    int len = ASN1_STRING_to_UTF8(&out, X509_NAME_ENTRY_get_data(X509_NAME_get_entry(subject, i)));
    /* OpenSSL's check_name_constraints gives up here, which its X509_verify_cert reports as unspecified. */
    if (len < 0) return X509_V_ERR_UNSPECIFIED;
    us_unique_ptr<unsigned char[], OPENSSL_free> common_name{out};
    while (len > 0 && common_name[len - 1] == '\0') len--;
    if (len > 0 && memchr(common_name.get(), 0, len)) {
      error = X509_V_ERR_UNSUPPORTED_NAME_SYNTAX;
    } else if (us_looks_like_dns_name(common_name.get(), len)) {
      error = us_name_constraints_check_dns_name(nc, common_name.get(), len);
    }
  }
  return error;
}

/* OpenSSL's has_san_id(cert, GEN_DNS). */
static int us_x509_has_dns_name(X509 *cert) {
  us_unique_ptr<GENERAL_NAMES, GENERAL_NAMES_free> names{
      (GENERAL_NAMES *)X509_get_ext_d2i(cert, NID_subject_alt_name, NULL, NULL)};
  int has_dns_name = 0;
  for (size_t i = 0; i < sk_GENERAL_NAME_num(names.get()) && !has_dns_name; i++) {
    has_dns_name = sk_GENERAL_NAME_value(names.get(), i)->type == GEN_DNS;
  }
  return has_dns_name;
}

/* When the leaf's subjectAltName lists no DNS name, its common names are checked against the chain's constraints on DNS
 * names, as in OpenSSL's check_name_constraints. The nearest failing CA decides the error, as with node's callback. */
static int us_x509_store_ctx_common_name_error(X509_STORE_CTX *ctx) {
  STACK_OF(X509) *chain = X509_STORE_CTX_get0_chain(ctx);
  X509 *leaf = sk_X509_value(chain, 0);
  int error = X509_V_OK;
  for (size_t i = 1; i < sk_X509_num(chain) && error == X509_V_OK; i++) {
    us_unique_ptr<NAME_CONSTRAINTS, NAME_CONSTRAINTS_free> nc{
        (NAME_CONSTRAINTS *)X509_get_ext_d2i(sk_X509_value(chain, i), NID_name_constraints, NULL, NULL)};
    if (nc && !us_x509_has_dns_name(leaf)) error = us_name_constraints_check_cn(leaf, nc.get());
  }
  return error;
}

/* What X509_verify_cert does not look for, a blocked public key (blocked_spkis.cpp) and
 * us_x509_store_ctx_common_name_error, is reported the way it reports its own errors: to the SSL's verify callback,
 * which says whether to go on. Without one, as in quic.cpp and node:quic, this returns 0 as it would. */
static int us_x509_verify_chain(X509_STORE_CTX *ctx) {
  int ok = X509_verify_cert(ctx);
  int error = us_x509_store_ctx_blocked_key_error(ctx);
  if (error == X509_V_OK && ok) error = us_x509_store_ctx_common_name_error(ctx);
  if (error == X509_V_OK) return ok;
  X509_STORE_CTX_set_error(ctx, error);
  SSL *ssl = (SSL *)X509_STORE_CTX_get_ex_data(ctx, SSL_get_ex_data_X509_STORE_CTX_idx());
  int (*verify_callback)(int, X509_STORE_CTX *) = ssl ? SSL_get_verify_callback(ssl) : NULL;
  return verify_callback ? verify_callback(0, ctx) : 0;
}

static int us_x509_verify_chain_cb(X509_STORE_CTX *ctx, void *arg) {
  (void)arg;
  return us_x509_verify_chain(ctx);
}

/* For node:quic, which builds its own SSL_CTX. */
void us_ssl_ctx_reject_blocked_keys(SSL_CTX *ctx) {
  SSL_CTX_set_cert_verify_callback(ctx, us_x509_verify_chain_cb, NULL);
}

/* A self-issued leaf that may not sign certificates is its own anchor when the store holds that very certificate (#44365). */
int us_x509_verify_cert(X509_STORE_CTX *ctx, int purpose) {
  X509 *leaf = X509_STORE_CTX_get0_cert(ctx);
  uint32_t flags = X509_get_extension_flags(leaf);
  if ((flags & EXFLAG_SI) && !(flags & EXFLAG_SS) && X509_check_purpose(leaf, purpose, 0) == 1) {
    us_x509_stack_ptr same_subject{X509_STORE_CTX_get1_certs(ctx, X509_get_subject_name(leaf))};
    for (size_t i = 0; i < sk_X509_num(same_subject.get()); i++) {
      if (X509_cmp(sk_X509_value(same_subject.get(), i), leaf) == 0) {
        X509_VERIFY_PARAM_set_flags(X509_STORE_CTX_get0_param(ctx), X509_V_FLAG_PARTIAL_CHAIN);
        break;
      }
    }
  }
  return us_x509_verify_chain(ctx);
}

/* Verifies the chain, then asks the owner of a client for the name: a wrong name is a verify error like any other. */
static int us_cert_verify_cb(X509_STORE_CTX *ctx, void *arg) {
  (void)arg;
  SSL *ssl = (SSL *)X509_STORE_CTX_get_ex_data(ctx, SSL_get_ex_data_X509_STORE_CTX_idx());
  int ok = us_x509_verify_cert(ctx, ssl && SSL_is_server(ssl) ? X509_PURPOSE_SSL_CLIENT : X509_PURPOSE_SSL_SERVER);
  if (!ssl) return ok;
  void *wrapper = us_ssl_wrapper(ssl);
  struct us_socket_t *s = wrapper ? NULL : us_ssl_socket(ssl);
  if (s) s->ssl_peer_chain_checked = 1;
  if (SSL_is_server(ssl) || X509_STORE_CTX_get_error(ctx) != X509_V_OK) return ok;
  int verdict = wrapper ? us_ssl_wrapper_server_identity(wrapper, ssl)
                : s     ? us_dispatch_server_identity(s, ssl)
                        : US_IDENTITY_UNCHECKED;
  if (verdict == US_IDENTITY_UNCHECKED) return ok;
  if (s) s->ssl_identity_checked = 1;
  if (verdict == US_IDENTITY_REJECTED) {
    if (s) s->ssl_verify_failed = 1;
    X509_STORE_CTX_set_error(ctx, X509_V_ERR_HOSTNAME_MISMATCH);
  }
  return ok;
}

int us_ssl_identity_checked(SSL *ssl) {
  void *wrapper = us_ssl_wrapper(ssl);
  if (wrapper) return us_ssl_wrapper_identity_checked(wrapper);
  struct us_socket_t *s = us_ssl_socket(ssl);
  return s && s->ssl_identity_checked;
}

/* A rejecting client refuses a bad chain inside the handshake, before its Certificate flight. */
void us_socket_set_inline_reject(struct us_socket_t *s) {
  if (!s->ssl || s->ssl_is_server || s->ssl_handshake_state == HANDSHAKE_COMPLETED) return;
  s->ssl_inline_reject = 1;
  SSL_set_verify(s_ssl(s), SSL_VERIFY_PEER, us_inline_reject_verify_callback);
}

/* node drops its pending output in destroy(): https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L1310-L1331 */
void us_socket_release_held_flight(struct us_socket_t *s) {
  if (!s->ssl || us_socket_is_closed(s)) return;
  struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;
  if (!loop_ssl_data || !loop_ssl_data->ssl_write_batch_len || loop_ssl_data->ssl_write_batch_owner != s) return;
  ssl_release_batch(s->group->loop, s);
  /* The peer never gets our Finished, so it cannot read a close_notify. */
  s->ssl_fatal_error = 1;
}

void us_socket_set_first_flight_before_fin(struct us_socket_t *s) {
  s->ssl_first_flight_before_fin = 1;
}

/* BoringSSL's kVerifySignatureAlgorithms (ssl/extensions.cc) plus the two it leaves out and Node.js accepts. */
int us_ssl_ctx_set_verify_signature_algorithms(SSL_CTX *ctx) {
  static const uint16_t algorithms[] = {
      SSL_SIGN_ECDSA_SECP256R1_SHA256, SSL_SIGN_RSA_PSS_RSAE_SHA256, SSL_SIGN_RSA_PKCS1_SHA256,
      SSL_SIGN_ECDSA_SECP384R1_SHA384, SSL_SIGN_RSA_PSS_RSAE_SHA384, SSL_SIGN_RSA_PKCS1_SHA384,
      SSL_SIGN_RSA_PSS_RSAE_SHA512,    SSL_SIGN_RSA_PKCS1_SHA512,    SSL_SIGN_ED25519,
      SSL_SIGN_ECDSA_SECP521R1_SHA512, SSL_SIGN_RSA_PKCS1_SHA1,
  };
  return SSL_CTX_set_verify_algorithm_prefs(ctx, algorithms, sizeof(algorithms) / sizeof(algorithms[0]));
}

/* Exported for quic.cpp (lsquic configures ALPN/transport-params on the SSL_CTX
 * directly) and as the body of us_ssl_ctx_from_options. */
SSL_CTX *us_ssl_ctx_build_raw(struct us_bun_socket_context_options_t options,
                              enum create_bun_socket_error_t *err) {
  ERR_clear_error();

  us_ssl_ctx_ptr ssl_context{SSL_CTX_new(TLS_method())};
  ssl_ctx_live++;
  /* An expired CA in a trust source (the OS store caches stale intermediates; a bundled root can outlive its notAfter in
   * an old binary; a user bundle can carry both generations) is treated as absent rather than left to shadow the
   * currently-valid certificate for the same issuer. */
  X509_VERIFY_PARAM_set_flags(SSL_CTX_get0_param(ssl_context.get()), X509_V_FLAG_IGNORE_EXPIRED_TRUST_ANCHORS);
  /* Register the live-count free_func first thing so every exit balances.
   * The packed reneg policy reuses the same slot. */
  SSL_CTX_set_ex_data(ssl_context.get(), us_ssl_ctx_ex_idx(), NULL);

  /* Default options we rely on — changing these breaks the BIO logic. */
  SSL_CTX_set_read_ahead(ssl_context.get(), 1);
  SSL_CTX_set_mode(ssl_context.get(), SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER);
  /* BoringSSL ships with SSL_MODE_NO_AUTO_CHAIN set; Node clears it so a
   * leaf-only `cert` presents the intermediates found in the context's store
   * (crypto_context.cc#L1640). It only runs when the configured chain is 1. */
  SSL_CTX_clear_mode(ssl_context.get(), SSL_MODE_NO_AUTO_CHAIN);
  /* Honor explicit minVersion/maxVersion (Node's secureProtocol/min/maxVersion);
   * default to a TLS1.2 floor when no minimum is requested. */
  SSL_CTX_set_min_proto_version(ssl_context.get(), options.ssl_min_version ? options.ssl_min_version : TLS1_2_VERSION);
  if (options.ssl_max_version) {
    SSL_CTX_set_max_proto_version(ssl_context.get(), options.ssl_max_version);
  }

  if (options.ssl_prefer_low_memory_usage) {
    SSL_CTX_set_mode(ssl_context.get(), SSL_MODE_RELEASE_BUFFERS);
  }

  SSL_CTX_set_default_passwd_cb_userdata(ssl_context.get(), (void *)options.passphrase);
  /* Installed unconditionally: with no userdata it supplies an empty password
   * (see passphrase_cb), matching Node's key-decryption error shape. */
  SSL_CTX_set_default_passwd_cb(ssl_context.get(), passphrase_cb);

  int several_identities = !options.cert_file_name && !options.key_file_name && options.cert && options.key &&
                           (options.cert_count > 1 || options.key_count > 1);
  if (!several_identities) {
    if (options.cert_file_name) {
      if (SSL_CTX_use_certificate_chain_file(ssl_context.get(), options.cert_file_name) != 1) {
        return NULL;
      }
    } else if (options.cert && options.cert_count > 0) {
      for (unsigned int i = 0; i < options.cert_count; i++) {
        if (us_ssl_ctx_use_certificate_chain(ssl_context.get(), options.cert[i]) != 1) {
          return NULL;
        }
      }
    }

    if (options.key_file_name) {
      if (SSL_CTX_use_PrivateKey_file(ssl_context.get(), options.key_file_name, SSL_FILETYPE_PEM) != 1) {
        return NULL;
      }
    } else if (options.key && options.key_count > 0) {
      for (unsigned int i = 0; i < options.key_count; i++) {
        if (us_ssl_ctx_use_privatekey_content(ssl_context.get(), options.key[i], SSL_FILETYPE_PEM) != 1) {
          return NULL;
        }
      }
    }
  }

  if (options.ca_file_name) {
    /* An explicit CA replaces the default trust store (Node.js semantics):
     * chains must validate exclusively against the supplied CAs. The SSL_CTX
     * already owns a fresh, empty X509_STORE from SSL_CTX_new(), so
     * SSL_CTX_load_verify_locations below populates only the user's CAs. */
    STACK_OF(X509_NAME) *ca_list = SSL_load_client_CA_file(options.ca_file_name);
    if (ca_list == NULL) {
      *err = CREATE_BUN_SOCKET_ERROR_LOAD_CA_FILE;
      return NULL;
    }
    SSL_CTX_set_client_CA_list(ssl_context.get(), ca_list);
    us_ex_idx_ensure();
    SSL_CTX_set_ex_data(ssl_context.get(), us_ctx_user_ca_ex_idx, (void *)1);
    if (SSL_CTX_load_verify_locations(ssl_context.get(), options.ca_file_name, NULL) != 1) {
      *err = CREATE_BUN_SOCKET_ERROR_INVALID_CA_FILE;
      return NULL;
    }
  } else if (options.ca && options.ca_count > 0) {
    us_ex_idx_ensure();
    SSL_CTX_set_ex_data(ssl_context.get(), us_ctx_user_ca_ex_idx, (void *)1);
    /* As above: user CAs only, into the SSL_CTX's own initially-empty store —
     * otherwise a server doing mTLS with `ca: [internalCA]` would also accept
     * any client certificate that chains to a public root. */
    X509_STORE *cert_store = SSL_CTX_get_cert_store(ssl_context.get());
    us_crypto_buffer_stack_ptr ca_certs{sk_CRYPTO_BUFFER_new_null()};
    for (unsigned int i = 0; ca_certs != NULL && i < options.ca_count; i++) {
      if (us_collect_ca_pem(ssl_context.get(), options.ca[i], ca_certs.get()) < 0) ca_certs = NULL;
    }
    if (ca_certs == NULL || !us_install_ca_buffers(ssl_context.get(), cert_store, ca_certs.get())) {
      *err = CREATE_BUN_SOCKET_ERROR_INVALID_CA;
      return NULL;
    }
    ERR_clear_error();
  } else {
    /* No user CA: seed the shared default root store, like Node's
     * addRootCerts() when `ca` is absent - the handshake-time auto-chain and
     * (for requestCert) client verification both read it. The getter up-refs,
     * so set_cert_store owns exactly one reference per context. */
    SSL_CTX_set_cert_store(ssl_context.get(), us_get_shared_default_ca_store());
  }

  /* After the store is filled: it completes their chains. */
  if (several_identities &&
      !us_ssl_ctx_use_identities(ssl_context.get(), options.cert, options.cert_count, options.key, options.key_count)) {
    return NULL;
  }
  /* The passphrase is borrowed for this call, and the context outlives it. */
  SSL_CTX_set_default_passwd_cb_userdata(ssl_context.get(), NULL);

  /* The callback is set at SSL_VERIFY_NONE too: lsquic's SNI switch calls SSL_set_verify(ssl, mode, NULL), which keeps it. */
  SSL_CTX_set_verify(ssl_context.get(),
      !options.request_cert         ? SSL_VERIFY_NONE
      : options.reject_unauthorized ? (SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT)
                                    : SSL_VERIFY_PEER,
      us_verify_callback);

  if (options.dh_params_file_name) {
    us_unique_ptr<FILE, fclose> paramfile{fopen(options.dh_params_file_name, "r")};
    if (!paramfile) {
      return NULL;
    }
    us_unique_ptr<DH, DH_free> dh_2048{PEM_read_DHparams(paramfile.get(), NULL, NULL, NULL)};
    if (dh_2048 == NULL) {
      return NULL;
    }
    if (SSL_CTX_set_tmp_dh(ssl_context.get(), dh_2048.get()) != 1) {
      return NULL;
    }
    if (!SSL_CTX_set_cipher_list(ssl_context.get(), DEFAULT_CIPHER_LIST)) {
      return NULL;
    }
  }

  if (options.ssl_ciphers) {
    if (!SSL_CTX_set_cipher_list(ssl_context.get(), options.ssl_ciphers)) {
      /* Peek, don't consume: the caller decomposes the queued reason
       * (NO_CIPHER_MATCH, INVALID_COMMAND) into the JS error. */
      unsigned long ssl_err = ERR_peek_error();
      if (!(strlen(options.ssl_ciphers) == 0 && ERR_GET_REASON(ssl_err) == SSL_R_NO_CIPHER_MATCH)) {
        *err = CREATE_BUN_SOCKET_ERROR_INVALID_CIPHERS;
        return NULL;
      }
      ERR_clear_error();
    }
  }

  if (options.secure_options) {
    SSL_CTX_set_options(ssl_context.get(), options.secure_options);
  }

  if (options.crl && options.crl_count > 0) {
    /* Mirrors Node's SecureContext::AddCRL: each PEM CRL is added to the
     * context's OWN store (never the process-shared default root store) and
     * CRL checking is enabled for the whole chain. */
    X509_STORE *crl_store = us_ssl_ctx_get_own_cert_store(ssl_context.get());
    if (!crl_store) {
      *err = CREATE_BUN_SOCKET_ERROR_INVALID_CRL;
      return NULL;
    }
    for (unsigned int i = 0; i < options.crl_count; i++) {
      us_bio_ptr crl_bio{BIO_new_mem_buf(options.crl[i], -1)};
      if (!crl_bio) {
        *err = CREATE_BUN_SOCKET_ERROR_INVALID_CRL;
        return NULL;
      }
      us_unique_ptr<X509_CRL, X509_CRL_free> crl{PEM_read_bio_X509_CRL(crl_bio.get(), NULL, NULL, NULL)};
      if (!crl) {
        *err = CREATE_BUN_SOCKET_ERROR_INVALID_CRL;
        return NULL;
      }
      if (!X509_STORE_add_crl(crl_store, crl.get())) {
        *err = CREATE_BUN_SOCKET_ERROR_INVALID_CRL;
        return NULL;
      }
    }
    X509_STORE_set_flags(crl_store,
                         X509_V_FLAG_CRL_CHECK | X509_V_FLAG_CRL_CHECK_ALL);
  }

  if (options.session_timeout > 0) {
    SSL_CTX_set_timeout(ssl_context.get(), options.session_timeout);
    SSL_CTX_set_session_psk_dhe_timeout(ssl_context.get(), options.session_timeout);
  }

  if (options.allow_partial_trust_chain) {
    /* Mirrors Node's SecureContext::SetAllowPartialTrustChain, which also
     * flags only the context's own store. A store that cannot be prepared
     * fails context creation: the user explicitly asked for the option. */
    X509_STORE *partial_store = us_ssl_ctx_get_own_cert_store(ssl_context.get());
    if (!partial_store) {
      return NULL;
    }
    X509_STORE_set_flags(partial_store, X509_V_FLAG_PARTIAL_CHAIN);
  }

  if (options.sigalgs ? !SSL_CTX_set1_sigalgs_list(ssl_context.get(), options.sigalgs)
                      : !us_ssl_ctx_set_verify_signature_algorithms(ssl_context.get())) {
    return NULL;
  }

  if (options.ecdh_curve) {
    if (!SSL_CTX_set1_groups_list(ssl_context.get(), options.ecdh_curve)) {
      *err = CREATE_BUN_SOCKET_ERROR_INVALID_ECDH_CURVE;
      return NULL;
    }
  }

  /* Surface resumable sessions through the new-session callback the way Node
   * does: for TLS 1.3 the resumable session only exists once the peer's
   * NewSessionTicket arrives, and BoringSSL only exposes it here. NO_INTERNAL
   * keeps BoringSSL from also caching it. */
  SSL_CTX_set_session_cache_mode(ssl_context.get(), SSL_SESS_CACHE_CLIENT |
                                                  SSL_SESS_CACHE_SERVER |
                                                  SSL_SESS_CACHE_NO_INTERNAL |
                                                  SSL_SESS_CACHE_NO_AUTO_CLEAR);
  SSL_CTX_sess_set_new_cb(ssl_context.get(), us_ssl_new_session_cb);
  SSL_CTX_set_keylog_callback(ssl_context.get(), us_ssl_keylog_cb);
  SSL_CTX_set_cert_verify_callback(ssl_context.get(), us_cert_verify_cb, NULL);
  return ssl_context.release();
}

/* Whether the context's store was configured from user CAs (ca / addCACert / pfx extras) rather than being the
 * empty SSL_CTX_new() store or the shared default roots. */
int us_ssl_ctx_has_user_ca(SSL_CTX *ctx) {
  us_ex_idx_ensure();
  return ctx != NULL && SSL_CTX_get_ex_data(ctx, us_ctx_user_ca_ex_idx) != NULL;
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
   * the store the handshake-time auto-chain walks, so a lone leaf-only cert
   * picks the intermediate up with no eager re-walk. */
  return add_ca_cert_to_ctx_store(ctx, content, store);
}

/* node:tls `pfx` support: parse a PKCS#12 blob and hand back PEM-encoded
 * key / certificate / extra-chain strings the regular key/cert/ca options can
 * consume. Returns 1 on success; the three out-strings are libc malloc'd (not
 * us_malloc) because the Rust caller releases them with libc free(), also after
 * a failure, which returns 0 and sets *err_reason to a static tag: "parse" (not
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
  if (len > INT_MAX) {
    /* BIO_new_mem_buf takes an int; a negative value would mean
     * "treat as a NUL-terminated string", silently misparsing the blob. */
    *err_reason = "parse";
    return 0;
  }
  us_bio_ptr in{BIO_new_mem_buf(data, (int)len)};
  if (!in) {
    *err_reason = "parse";
    return 0;
  }
  us_unique_ptr<PKCS12, PKCS12_free> p12{d2i_PKCS12_bio(in.get(), NULL)};
  if (!p12) {
    *err_reason = "parse";
    ERR_clear_error();
    return 0;
  }
  EVP_PKEY *parsed_pkey = NULL;
  X509 *parsed_cert = NULL;
  STACK_OF(X509) *parsed_extra = NULL;
  if (!PKCS12_parse(p12.get(), pass ? pass : "", &parsed_pkey, &parsed_cert, &parsed_extra)) {
    *err_reason = "mac";
    ERR_clear_error();
    return 0;
  }
  us_unique_ptr<EVP_PKEY, EVP_PKEY_free> pkey{parsed_pkey};
  us_x509_ptr cert{parsed_cert};
  us_x509_stack_ptr extra{parsed_extra};
  if (!pkey || !cert) {
    *err_reason = pkey ? "cert" : "key";
    ERR_clear_error();
    return 0;
  }
  us_bio_ptr kb{BIO_new(BIO_s_mem())};
  us_bio_ptr cb{BIO_new(BIO_s_mem())};
  if (!kb || !cb || !PEM_write_bio_PrivateKey(kb.get(), pkey.get(), NULL, NULL, 0, NULL, NULL) ||
      !PEM_write_bio_X509(cb.get(), cert.get()) || !pem_from_bio(kb.get(), out_key, out_key_len) ||
      !pem_from_bio(cb.get(), out_cert, out_cert_len)) {
    *err_reason = "parse";
    ERR_clear_error();
    return 0;
  }
  if (extra && sk_X509_num(extra.get()) > 0) {
    if (us_bio_ptr ab{BIO_new(BIO_s_mem())}) {
      for (size_t i = 0; i < sk_X509_num(extra.get()); i++) {
        PEM_write_bio_X509(ab.get(), sk_X509_value(extra.get(), i));
      }
      pem_from_bio(ab.get(), out_ca, out_ca_len);
    }
  }
  ERR_clear_error();
  return 1;
}

SSL_CTX *us_ssl_ctx_from_options(struct us_bun_socket_context_options_t options,
                                 enum create_bun_socket_error_t *err) {
  SSL_CTX *ctx = us_ssl_ctx_build_raw(options, err);
  if (!ctx) return NULL;

  /* SecureContext is mode-neutral (Node lets one back both tls.connect and
   * tls.createServer), so we can't bake client-vs-server into the CTX. CTX
   * verify_mode comes purely from options (request_cert/reject_unauthorized)
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
 * Exported so context.cpp / socket.c stay free of OpenSSL headers. */
void us_internal_ssl_ctx_up_ref(SSL_CTX *p) {
  if (p) SSL_CTX_up_ref(p);
}
void us_internal_ssl_ctx_unref(SSL_CTX *p) {
  if (p) SSL_CTX_free(p);
}

/* ── HTTP/2 ALPN ─────────────────────────────────────────────────────────── */

static int us_alpn_select_h2(SSL *ssl, const unsigned char **out, unsigned char *outlen,
                             const unsigned char *in, unsigned int inlen, void *arg) {
  (void) ssl;
  int allow_http1 = arg != NULL;
  const unsigned char *http1 = NULL;
  for (unsigned int i = 0; i + 1 <= inlen;) {
    unsigned int len = in[i];
    if (i + 1 + len > inlen) break;
    const unsigned char *proto = &in[i + 1];
    if (len == 2 && proto[0] == 'h' && proto[1] == '2') {
      *out = proto;
      *outlen = 2;
      return SSL_TLSEXT_ERR_OK;
    }
    if (len == 8 && memcmp(proto, "http/1.1", 8) == 0) http1 = proto;
    i += 1 + len;
  }
  if (http1 && allow_http1) {
    *out = http1;
    *outlen = 8;
    return SSL_TLSEXT_ERR_OK;
  }
  /* The client offered ALPN but not h2 (this callback doesn't run at all for
   * a client that sends no ALPN extension; that one completes the handshake
   * and is answered at the HTTP layer). Proceed without ALPN when HTTP/1 is
   * allowed; otherwise refuse the handshake with no_application_protocol. */
  return allow_http1 ? SSL_TLSEXT_ERR_NOACK : SSL_TLSEXT_ERR_ALERT_FATAL;
}

void us_ssl_ctx_enable_http2_alpn(SSL_CTX *ctx, int allow_http1) {
  SSL_CTX_set_alpn_select_cb(ctx, us_alpn_select_h2, allow_http1 ? (void *) 1 : NULL);
}

int us_socket_alpn_is_h2(struct us_socket_t *s) {
  if (!s->ssl) return 0;
  const unsigned char *proto = NULL;
  unsigned int len = 0;
  SSL_get0_alpn_selected(s_ssl(s), &proto, &len);
  return len == 2 && proto[0] == 'h' && proto[1] == '2';
}

/* ── Per-socket SSL attach/detach ────────────────────────────────────────── */

/* A client verifies per SSL: raising the mode of the CTX would make a server that shares it send CertificateRequest. */
void us_internal_ssl_client_verify_defaults(SSL *ssl, SSL_CTX *ctx) {
  if (SSL_CTX_get_verify_mode(ctx) != SSL_VERIFY_NONE) return;
  SSL_set_verify(ssl, SSL_VERIFY_PEER, us_verify_callback);
  /* A store that holds user CAs (ca / caFile / addCACert) stays in place. */
  if (us_ssl_ctx_has_user_ca(ctx)) return;
  X509_STORE *roots = us_get_shared_default_ca_store();
  if (roots) SSL_set0_verify_cert_store(ssl, roots);
}

void us_internal_ssl_attach(struct us_socket_t *s, SSL_CTX *ctx,
                            int is_client, const char *sni,
                            struct us_listen_socket_t *listener) {
  us_internal_init_loop_ssl_data(s->group->loop);
  struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;

  SSL *ssl = SSL_new(ctx);
  SSL_set_bio(ssl, loop_ssl_data->shared_rbio.get(), loop_ssl_data->shared_wbio.get());
  BIO_up_ref(loop_ssl_data->shared_rbio.get());
  BIO_up_ref(loop_ssl_data->shared_wbio.get());

  /* renegotiation: ssl_renegotiate_explicit lets us bound it on the client
   * (issues #6197/#5363); never on the server (DoS vector). */
  if (is_client) {
    SSL_set_renegotiate_mode(ssl, ssl_renegotiate_explicit);
    SSL_set_connect_state(ssl);
    if (sni) SSL_set_tlsext_host_name(ssl, sni);
    /* The CTX's session id context partitions a server's sessions by context
     * configuration (create_ssl_context_with_digest). A client fails its
     * handshake when a resumed session's id differs from its own, so clients
     * keep none: a `session` stays usable under any client options. */
    SSL_set_session_id_context(ssl, NULL, 0);
    us_internal_ssl_client_verify_defaults(ssl, ctx);
  } else {
    SSL_set_accept_state(ssl);
    SSL_set_renegotiate_mode(ssl, ssl_renegotiate_never);
    /* sni_cb recovers the names per-SSL — never via the shared SSL_CTX. */
    if (listener) us_ssl_rare_ensure(ssl)->server_names = us_server_names_ref(listener);
  }

  s->ssl = ssl;
  s->ssl_handshake_state = HANDSHAKE_PENDING;
  s->ssl_write_wants_read = 0;
  s->ssl_write_parked = 0;
  s->ssl_fatal_error = 0;
  s->ssl_raw_tap = 0;
  s->ssl_spilled = 0;
  s->ssl_spill_dropped = 0;
  s->ssl_shutdown_after_spill = 0;
  s->ssl_close_after_spill = 0;
  s->ssl_end_delivered = 0;
  s->ssl_in_use = 0;
  s->ssl_pending_detach = 0;
  s->ssl_pending_close_code = 0;
  s->ssl_first_flight_before_fin = 0;
  s->ssl_shutdown_after_first_flight = 0;
  s->ssl_send_rejected = 0;
  s->ssl_is_server = is_client ? 0 : 1;
  s->ssl_inline_reject = 0;
  s->ssl_verify_failed = 0;
  s->ssl_identity_checked = 0;
  s->ssl_peer_chain_checked = 0;
  s->ssl_sni_pending = US_SNI_NONE;
  s->ssl_sni_resolver = 0;
  s->ssl_has_pending_events = 0;
}

void us_internal_ssl_detach(struct us_socket_t *s) {
  ssl_release_batch(s->group->loop, s);
  if (s->ssl) {
    /* Error/RST teardowns (us_internal_socket_close_raw) reach here without going
     * through us_internal_ssl_close: a batch spill left counted disables batching for good. */
    ssl_release_spill(s->group->loop, s);
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
  if (us_x509_ptr{SSL_get_peer_certificate(ssl)}) {
    err = SSL_get_verify_result(ssl);
  } else {
    const SSL_CIPHER *curr_cipher = SSL_get_current_cipher(ssl);
    if (curr_cipher && SSL_CIPHER_get_auth_nid(curr_cipher) == NID_auth_psk) {
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
  /* Only us_cert_verify_cb sets this one: no X509_VERIFY_PARAM here carries a host. */
  if (x509_verify_error == X509_V_ERR_HOSTNAME_MISMATCH) {
    return (struct us_bun_verify_error_t){
        .error = X509_V_ERR_HOSTNAME_MISMATCH,
        .code = "ERR_TLS_CERT_ALTNAME_INVALID",
        .reason = "Hostname/IP does not match certificate's altnames"};
  }
  const char *reason = X509_verify_cert_error_string(x509_verify_error);
  const char *code = us_X509_error_code(x509_verify_error);
  return (struct us_bun_verify_error_t){.error = (int)x509_verify_error, .code = code, .reason = reason};
}

/* A sent FIN, a sent close_notify or a fatal error says nothing about the
 * peer's certificate: on an open socket the SSL alone answers, like node's
 * TLSWrap::VerifyError
 * (https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L1840-L1853). */
struct us_bun_verify_error_t us_internal_ssl_verify_error(struct us_socket_t *s) {
  if (!s->ssl || !s_ssl(s) || us_socket_is_closed(s)) {
    return (struct us_bun_verify_error_t){.error = 0, .code = NULL, .reason = NULL};
  }
  return us_ssl_socket_verify_error_from_ssl(s_ssl(s));
}

/* After our own FIN a failed handshake reports the SSL's verdict only for a
 * chain that it checked: node:tls reads a failure with an X509 code as an
 * established session. */
static struct us_bun_verify_error_t ssl_failed_handshake_verify_error(struct us_socket_t *s) {
  if (us_internal_ssl_is_shut_down(s) && !s->ssl_peer_chain_checked) {
    return (struct us_bun_verify_error_t){.error = 0, .code = NULL, .reason = NULL};
  }
  return us_internal_ssl_verify_error(s);
}

/* ── Handshake state machine ─────────────────────────────────────────────── */

/* The oldest entry, like node (crypto_tls.cc#L860), but the SSL library's first: BoringSSL queues the cipher's BAD_DECRYPT ahead of node's name for a bad record. */
int us_ssl_take_error_reason(char *reason, size_t length) {
  uint32_t picked = ERR_peek_error();
  for (uint32_t queued; (queued = ERR_get_error()) != 0;) {
    if (ERR_GET_LIB(queued) == ERR_LIB_SSL) {
      picked = queued;
      break;
    }
  }
  ERR_clear_error();
  if (!picked) return 0;
  ERR_error_string_n(picked, reason, length);
  return 1;
}

/* Park the fatal OpenSSL reason behind a failed SSL_* call where the
 * handshake-failure dispatch can find it, then drain the queue and mark the
 * socket fatal. Only parks while the first handshake is unfinished: that dispatch is
 * the sole consumer, so a later reason would linger and be misreported as some
 * other socket's handshake failure. */
static void ssl_park_fatal_reason(struct us_socket_t *s) {
  struct loop_ssl_data *loop_ssl_data =
      (struct loop_ssl_data *) s->group->loop->data.ssl_data;
  if (loop_ssl_data && s->ssl_handshake_state == HANDSHAKE_PENDING &&
      us_ssl_take_error_reason(loop_ssl_data->ssl_last_fatal_error, sizeof(loop_ssl_data->ssl_last_fatal_error))) {
    loop_ssl_data->ssl_last_fatal_error_owner = s;
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
  /* Read before the state flip below turns tripped() off. */
  int inline_rejected = us_ssl_inline_reject_tripped(s);
  s->ssl_handshake_state = HANDSHAKE_COMPLETED;
  /* Inline rejection: the rejecting client's post-verify flight was
   * suppressed - the session must not be reported as established. */
  if (inline_rejected) {
    success = 0;
  }
  /* An inline-rejected handshake reports the X509 verdict node surfaces
   * through ssl.verifyError() (UNABLE_TO_VERIFY_LEAF_SIGNATURE, ...), not
   * the SSL protocol reason that may wrap it. */
  if (!success && inline_rejected && s->ssl && s_ssl(s)) {
    struct loop_ssl_data *loop_ssl_data =
        (struct loop_ssl_data *)s->group->loop->data.ssl_data;
    if (loop_ssl_data &&
        loop_ssl_data->ssl_last_fatal_error_owner == (void *)s) {
      loop_ssl_data->ssl_last_fatal_error[0] = 0;
      loop_ssl_data->ssl_last_fatal_error_owner = NULL;
    }
    /* The peer never derived the keys our Finished would have carried, so a
     * graceful close (code 0) must send a bare FIN, not a close_notify it
     * cannot read, and must not wait for a reply. Fatal also refuses writes. */
    s->ssl_fatal_error = 1;
    us_dispatch_handshake(s, 0, us_ssl_socket_verify_error_from_ssl(s_ssl(s)));
    /* Nothing else will tear this connection down (the peer is still waiting
     * for a Finished that will never come) - close unless JS already did. */
    if (!ssl_gone(s) && !us_socket_is_closed(s)) {
      us_socket_close(s, 0, NULL);
    }
    return;
  }
  /* A fatal SSL protocol error (wrong version number, bad record, ...) was
   * recorded just before this failure: report it instead of the X509 verify
   * result so Node's tlsClientError / client error carries the OpenSSL
   * reason string. */
  if (!success && ssl_dispatch_parked_reason(s)) {
    return;
  }
  /* A finished handshake reports the SSL's X509 verdict in every socket state. */
  struct us_bun_verify_error_t verify_error =
      success && s->ssl ? us_ssl_socket_verify_error_from_ssl(s_ssl(s))
                        : ssl_failed_handshake_verify_error(s);
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
  struct us_ssl_rare_t *st = us_ssl_rare_ensure(s_ssl(s));
  /* Wall-clock time can step backwards (NTP, manual adjustment); the
   * unsigned subtraction below would underflow and reset the window every
   * time. Only treat the window as elapsed when time has moved forward. */
  uint64_t now_ms = (uint64_t)time(NULL) * 1000;
  if (st->reneg_count == 0 ||
      (window && now_ms >= st->reneg_window_start_ms &&
       now_ms - st->reneg_window_start_ms >= (uint64_t)window * 1000)) {
    st->reneg_window_start_ms = now_ms;
    st->reneg_count = 0;
  }
  /* Over the limit BoringSSL refuses, so every refusal queues the same SSL_R_NO_RENEGOTIATION. */
  if (st->reneg_count >= limit) SSL_set_renegotiate_mode(s_ssl(s), ssl_renegotiate_never);
  st->reneg_count++;
  if (!SSL_renegotiate(s_ssl(s))) return 0;
  s->ssl_handshake_state = HANDSHAKE_RENEGOTIATION_PENDING;
  return 1;
}

/* Returns 1 if shutdown is complete (or impossible) and the TCP socket may be
 * closed; 0 if our close_notify is spilled, or if we must wait for the peer's. */
static int ssl_handle_shutdown(struct us_socket_t *s) {
    if (!s->ssl || us_internal_ssl_is_shut_down(s) || s->ssl_fatal_error || !SSL_is_init_finished(s_ssl(s)))
    return 1;

  int state = SSL_get_shutdown(s_ssl(s));
  int sent_shutdown = state & SSL_SENT_SHUTDOWN;
  int received_shutdown = state & SSL_RECEIVED_SHUTDOWN;
  if (!sent_shutdown || !received_shutdown) {
    ssl_set_loop_data(s);
    int ret = SSL_shutdown(s_ssl(s));
    if (ret < 0) {
      int err = SSL_get_error(s_ssl(s), ret);
      if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
        ERR_clear_error();
        s->ssl_fatal_error = 1;
        return 1;
      }
      if (err == SSL_ERROR_WANT_READ) return 1;
      s->ssl_fatal_error = 1;
      return 1;
    }
    return ret == 1 && !(s->ssl_spilled && ssl_wants_eof_dispatch(s));
  }
  return 1;
}

static void ssl_received_close_notify(struct us_socket_t *s) {
  SSL_set_shutdown(s_ssl(s), SSL_get_shutdown(s_ssl(s)) | SSL_RECEIVED_SHUTDOWN);
}

/* Seconds a close waits for the peer to take the spill (at most one flush unit, so 13 KB/s), then for the two close_notify: Bun.serve's default idleTimeout. */
#define US_SSL_CLOSE_AFTER_SPILL_TIMEOUT 10

/* The owner let go, so its timeouts are over and nobody else bounds the wait. */
static void ssl_bound_close(struct us_socket_t *s) {
  s->ssl_close_after_spill = 0;
  us_socket_timeout(s, US_SSL_CLOSE_AFTER_SPILL_TIMEOUT);
  us_socket_long_timeout(s, 0);
}

/* The close resumes with the same `code` from the writable event that drains the spill: a graceful
 * close must not come back as a forceful FAST_SHUTDOWN (on_close would see an abortive teardown). */
static void ssl_defer_close(struct us_socket_t *s, int code) {
  ssl_bound_close(s);
  s->ssl_close_after_spill = 1;
  s->ssl_pending_close_code = (unsigned char) code;
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
  {
    /* Ciphertext batched in this dispatch and still held (the handshake's
     * final flight, a fatal alert sealed by a failing SSL_read) goes to the
     * wire before the close_notify/FIN this teardown sends. A partial write
     * spills; the graceful-close deferral below then waits for the drain. */
    struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;
    if (loop_ssl_data && loop_ssl_data->ssl_write_batch_len &&
        loop_ssl_data->ssl_write_batch_owner == s && !us_socket_is_closed(s)) {
      /* A reset sends nothing more: terminate() in the handshake callback refuses the peer. */
      if (code == LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET) ssl_release_batch(s->group->loop, s);
      else ssl_flush_write_batch(loop_ssl_data, s);
    }
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
      ssl_defer_close(s, code);
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
  ssl_update_handshake(s, 1);
  if (ssl_gone(s)) return s;

  if (s->ssl_handshake_state == HANDSHAKE_PENDING) {
    /* Surface ECONNRESET-style handshake failure exactly once so callers
     * (fetch, sockets) don't each have to check on_close themselves. */
    ssl_trigger_handshake_econnreset(s);
    if (ssl_gone(s)) return s;
  }

  /* code == 2 (forceful — `_destroy()` / `_handle.close()`): raw-close now,
   * with no close_notify — a bare FIN, like node's destroy (crypto_tls.cc
   * only sends the alert from DoShutdown, the end() path). A destroy-time
   * alert would land in the peer's receive buffer ahead of the FIN, and a
   * peer whose stream is paused never reads it, which holds that stream's
   * 'end'/'close' back forever (node semantics). The destroy path also
   * detaches + poll_ref.unref() right after, so deferring would orphan the
   * us_socket_t.
   *
   * code == 1 (reset — terminate() / abort): no close_notify, only the RST,
   * like node's resetAndDestroy().
   *
   * code == 0 (graceful — `end()` → markInactive → closeAndDetach(.normal)):
   * send close_notify and DEFER the fd close until the peer replies. The
   * graceful path keeps `poll_ref` held until onClose runs, so the loop stays
   * alive to receive the peer's close_notify/FIN; raw-closing here would let
   * the client resolve `close` before the server has even seen our Finished
   * under low-prio fan-out (connectionListener race). The actual raw-close
   * happens via on_end/ZERO_RETURN re-entering this function with
   * SSL_SENT_SHUTDOWN already set (ssl_handle_shutdown then returns 1). */
  if (code != LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN || ssl_handle_shutdown(s)) {
    return us_internal_socket_close_raw(s, code, reason);
  }
  /* Only a read delivers the peer's reply, and the owner that paused let go with this close. */
  us_socket_resume(s);
  /* A close before the close_notify left, over unread input, is a reset: the kernel would drop what it had not sent yet. */
  if (s->ssl_spilled) ssl_defer_close(s, code);
  /* For a peer that does not answer, whatever else it sends (us_internal_ssl_on_timeout). */
  else ssl_bound_close(s);
  return s;
}
#define ssl_close us_internal_ssl_close

/* `fin_ends_handshake` is 0 only from the writable event, which the read path
 * re-enters while a handshake is in progress: the socket keeps reading after
 * our FIN or close_notify, and the peer's next flight can still complete that
 * handshake. For every other caller a half-closed socket's handshake is over. */
static void ssl_update_handshake(struct us_socket_t *s, int fin_ends_handshake) {
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

  if (us_socket_is_closed(s) || s->ssl_fatal_error ||
      (SSL_get_shutdown(s_ssl(s)) & SSL_RECEIVED_SHUTDOWN) ||
      (fin_ends_handshake && us_internal_ssl_is_shut_down(s))) {
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

  /* Inline rejection tripped during this drive: nothing more will arrive (a
   * TLS 1.2 client would otherwise wait forever for the server's Finished).
   * ssl_trigger_handshake reports the recorded X509 verdict and closes. */
  if (us_ssl_inline_reject_tripped(s)) {
    ssl_trigger_handshake(s, 0);
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
    if (err != SSL_ERROR_WANT_READ) {
      if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
        ssl_park_fatal_reason(s);
      }
      ssl_trigger_handshake(s, 0);
      return;
    }
    s->ssl_handshake_state = HANDSHAKE_PENDING;
    s->ssl_write_wants_read = 1;
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
  ssl_update_handshake(result, 1);
  if (ssl_gone(result)) return result;
  result->ssl_first_flight_before_fin = 0;
  if (result->ssl_shutdown_after_first_flight) {
    result->ssl_shutdown_after_first_flight = 0;
    us_internal_ssl_shutdown(result);
  }
  return result;
}

struct us_socket_t *us_internal_ssl_on_close(struct us_socket_t *s, int code, void *reason) {
  ssl_set_loop_data(s);
  struct us_socket_t *ret = us_dispatch_close(s, code, reason);
  /* Free SSL after on_close so user code can still inspect ALPN / cert. */
  us_internal_ssl_detach(s);
  return ret;
}

static int ssl_is_uws_http_tls(struct us_socket_t *s) {
  return us_socket_kind(s) == BUN_SOCKET_KIND_UWS_HTTP_TLS;
}

/* EOF dispatch only for kinds whose user layer consumes 'end' + honors
 * allow_half_open (uWS HTTP server: their context's onEnd owns the EOF;
 * Bun.connect/listen, which node:tls rides on). All other TLS kinds derive
 * EOF from close and keep the historical force-close (dispatching for them
 * strands sockets whose end handler expects the transport to close
 * underneath it). */
static int ssl_wants_eof_dispatch(struct us_socket_t *s) {
  unsigned char kind = us_socket_kind(s);
  if (kind == BUN_SOCKET_KIND_UWS_HTTP_TLS) {
    return 1;
  }
  /* Mid-handshake EOF keeps the force-close so JS surfaces it as a failed
   * handshake (ECONNRESET "socket hang up", like Node) not a clean 'end'. */
  return kind == BUN_SOCKET_KIND_BUN_SOCKET_TLS &&
         s->ssl_handshake_state == HANDSHAKE_COMPLETED;
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

static struct us_socket_t *ssl_on_writable(struct us_socket_t *s);

/* Retry a JS write parked on WANT_READ (written before the handshake
 * finished). No-op while this socket's spill is undrained: the flag is kept
 * so the retry happens after on_writable drains it. */
static struct us_socket_t *ssl_retry_parked_write(struct us_socket_t *s) {
  if (!s->ssl_write_wants_read || s->ssl_spilled) return s;
  s->ssl_write_wants_read = 0;
  /* Behind the close_notify there is no write to retry, and the owner would take the event for the end of its flush and close again. */
  if (SSL_get_shutdown(s_ssl(s)) & SSL_SENT_SHUTDOWN) return s;
  return ssl_on_writable(s);
}

struct us_socket_t *us_internal_ssl_on_end(struct us_socket_t *s) {
  ssl_set_loop_data(s);
  if (ssl_wants_eof_dispatch(s)) {
    /* Raw TCP FIN under TLS: the peer's write side is gone, so no
     * close_notify reply is ever coming. Record the TLS-level shutdown as
     * received so a later graceful close (an allow_half_open socket ending
     * its side after this EOF) completes immediately in ssl_handle_shutdown
     * instead of deferring for an alert that cannot arrive. */
    if (!ssl_gone(s)) ssl_received_close_notify(s);
    s = ssl_deliver_eof(s);
    if (!s || us_socket_is_closed(s)) {
      return s;
    }
    if (s->flags.allow_half_open &&
        (ssl_gone(s) || !(SSL_get_shutdown(s_ssl(s)) & SSL_SENT_SHUTDOWN))) {
      /* Keep the write side alive like the plain-TCP half-open branch in
       * loop.c: TCP permits writing after a received FIN, so queued
       * responses still flush and the app's own end() completes the
       * shutdown. With SENT_SHUTDOWN both directions are closed; fall
       * through so a deferred graceful close completes (mirrors the
       * ZERO_RETURN path; loop.c raw-closes this case first on the
       * epoll/kqueue backend, the libuv one reaches here). */
      return s;
    }
  }
  /* TCP FIN with no half-open: send our close_notify best-effort and
   * raw-close now — deferring (the code==0 path in ssl_close) would wait
   * forever. */
  if (!s->ssl_close_after_spill) s = ssl_close(s, 0, NULL);
  if (s && !us_socket_is_closed(s)) {
    if (s->ssl_close_after_spill && (s->flags.allow_half_open || ssl_wants_eof_dispatch(s))) {
      /* The close spill-deferred. When on_writable resumes it, the peer's
       * FIN above means its close_notify is never coming, so record the
       * shutdown as received now — otherwise ssl_handle_shutdown defers
       * for the missing alert and the socket hangs. */
      if (!ssl_gone(s)) ssl_received_close_notify(s);
    } else {
      s = us_internal_socket_close_raw(s, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, NULL);
    }
  }
  return s;
}

int us_internal_ssl_defer_end(struct us_socket_t *s) {
  if (!s->ssl_spilled || !ssl_wants_eof_dispatch(s)) return 0;
  if (!s->ssl_close_after_spill) {
    if (!ssl_sent_close_notify(s)) return 0;
    ssl_defer_close(s, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN);
  }
  ssl_received_close_notify(s);
  return 1;
}

/* A fatal socket neither sends nor receives, and no write may close under its caller: the writable event does. */
static struct us_socket_t *ssl_close_if_fatal(struct us_socket_t *s) {
  if (!s || ssl_gone(s) || !s->ssl_fatal_error) return s;
  return ssl_close(s, 0, NULL);
}

struct us_socket_t *us_internal_ssl_on_timeout(struct us_socket_t *s) {
  if (s->ssl_close_after_spill) {
    ssl_release_spill(s->group->loop, s);
    return us_internal_socket_close_raw(s, s->ssl_pending_close_code, NULL);
  }
  /* close_notify without the FIN, and no FIN held: the spill drained, and the graceful close now waits for the peer's reply. */
  if (ssl_sent_close_notify(s) && us_internal_socket_can_raw_write(s) && !s->ssl_shutdown_after_spill) {
    return us_internal_socket_close_raw(s, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, NULL);
  }
  return us_dispatch_timeout(s);
}

/* The read side delivers what the peer sent before it closes, unless the owner already let go. */
static struct us_socket_t *ssl_close_after_rejected_send(struct us_socket_t *s, int send_error) {
  if (!s->ssl_close_after_spill && us_socket_queued_input(s) == LIBUS_QUEUED_INPUT_DATA) return s;
  if (s->ssl_handshake_state == HANDSHAKE_PENDING) {
    ssl_set_loop_data(s);
    ssl_trigger_handshake_econnreset(s);
    if (ssl_gone(s)) return s;
  }
  /* The close_notify is sealed behind all that the owner wrote: only this reply to the peer's own was refused. */
  const int both_ended = SSL_SENT_SHUTDOWN | SSL_RECEIVED_SHUTDOWN;
  if ((SSL_get_shutdown(s_ssl(s)) & both_ended) == both_ended) {
    return us_internal_socket_close_raw(s, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, NULL);
  }
  return us_internal_socket_close_raw(s, send_error > 2 ? send_error : LIBUS_ECONNRESET, NULL);
}

struct us_socket_t *us_internal_ssl_on_end_after_rejected_send(struct us_socket_t *s) {
  return ssl_close_after_rejected_send(s, LIBUS_ECONNRESET);
}

struct us_socket_t *us_internal_ssl_on_writable(struct us_socket_t *s) {
  /* Past its FIN a socket polls for writable only when ssl_raw_write asked for this event. */
  if (!us_internal_socket_can_raw_write(s)) return ssl_close_after_rejected_send(s, LIBUS_ECONNRESET);
  s = ssl_on_writable(s);
  /* Asked for from inside this dispatch, that event never comes: loop.c drops the writable interest of a shut-down socket. */
  if (s && !ssl_gone(s) && s->ssl_send_rejected) return ssl_close_after_rejected_send(s, LIBUS_ECONNRESET);
  return s;
}

static struct us_socket_t *ssl_on_writable(struct us_socket_t *s) {
  struct loop_ssl_data *loop_ssl_data = ssl_set_loop_data(s);
  s = ssl_close_if_fatal(s);
  if (!s || ssl_gone(s)) return s;
  /* Ciphertext from a partial batch flush goes out before anything else;
   * while it is pending nothing new may be written for this socket. */
  loop_ssl_data->ssl_send_error = 0;
  if (!ssl_drain_spill(loop_ssl_data, s)) return s;
  if (loop_ssl_data->ssl_send_error) return ssl_close_after_rejected_send(s, loop_ssl_data->ssl_send_error);
  if (s->ssl_shutdown_after_spill) {
    s->ssl_shutdown_after_spill = 0;
    if (ssl_sent_close_notify(s)) us_internal_socket_raw_shutdown(s);
    else us_internal_ssl_shutdown(s);
    if (ssl_gone(s) || s->ssl_shutdown_after_spill) return s;
  }
  if (s->ssl_close_after_spill) {
    s->ssl_close_after_spill = 0;
    const int awaits_reply = s->ssl_pending_close_code == LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN &&
                             (SSL_get_shutdown(s_ssl(s)) & (SSL_SENT_SHUTDOWN | SSL_RECEIVED_SHUTDOWN)) == SSL_SENT_SHUTDOWN &&
                             us_internal_socket_can_raw_write(s);
    if (!awaits_reply) return us_internal_ssl_close(s, s->ssl_pending_close_code, NULL);
  }
  /* A graceful close awaits the peer's reply. Its owner would take the event for the end of its flush and close again. */
  if (ssl_sent_close_notify(s) && us_internal_socket_can_raw_write(s)) return s;
  ssl_update_handshake(s, 0);
  s = ssl_close_if_fatal(s);
  if (!s || ssl_gone(s)) return s;
  /* uWS HTTP sockets keep the pre-existing SENT_SHUTDOWN suppression: their
   * onWritable clears the teardown timeout armed at shutdown. node sockets
   * still get write-completion dispatch after a half-close in either
   * direction. */
  if (ssl_is_uws_http_tls(s) && us_internal_ssl_is_shut_down(s)) return s;

  if (s->ssl_handshake_state != HANDSHAKE_PENDING) {
    s->ssl_write_parked = 0;
    /* This is the retry that ssl_retry_parked_write owes. Kept, it would come behind the owner's end(), as a second close. */
    s->ssl_write_wants_read = 0;
    /* loop.c drops the writable interest of a shut-down socket after this dispatch. */
    s = ssl_close_if_fatal(us_dispatch_writable(s));
  }
  return s;
}

/* The flight that SSL_read sealed stays held across the report, so what the owner writes there leaves with it. NULL once `s` is gone. */
static struct us_socket_t *ssl_report_finished_handshake(struct us_socket_t *s, struct loop_ssl_data *loop_ssl_data,
                                                         int retry_parked_write) {
  if (s->ssl_handshake_state == HANDSHAKE_COMPLETED || !SSL_is_init_finished(s_ssl(s))) return s;
  char *saved_input = loop_ssl_data->ssl_read_input;
  unsigned int saved_length = loop_ssl_data->ssl_read_input_length;
  unsigned int saved_offset = loop_ssl_data->ssl_read_input_offset;
  ssl_trigger_handshake(s, 1);
  if (ssl_gone(s)) return NULL;
  /* node:https queues its request before the handshake. */
  if (retry_parked_write && s->ssl_write_parked) {
    s = ssl_retry_parked_write(s);
    if (!s || ssl_gone(s)) return NULL;
  }
  loop_ssl_data->ssl_read_input = saved_input;
  loop_ssl_data->ssl_read_input_length = saved_length;
  loop_ssl_data->ssl_read_input_offset = saved_offset;
  loop_ssl_data->ssl_socket = s;
  ssl_flush_write_batch(loop_ssl_data, s);
  return s;
}

/* What came before the failure goes first, like node's ClearOut. Whatever the owner does with the report, the connection closes here. */
static struct us_socket_t *ssl_fail_established_session(struct us_socket_t *s, struct loop_ssl_data *loop_ssl_data,
                                                        int read) {
  /* Taken now: the JS below can change the thread's queue. */
  char reason[US_SSL_FATAL_ERROR_REASON_MAX];
  int has_reason = us_ssl_take_error_reason(reason, sizeof(reason));
  s = ssl_report_finished_handshake(s, loop_ssl_data, 0);
  if (!s) return NULL;
  s->ssl_handshake_state = HANDSHAKE_COMPLETED;
  ssl_flush_pending_events(s);
  if (ssl_gone(s)) return NULL;
  if (read) {
    s = us_dispatch_data(s, loop_ssl_data->ssl_read_output.get() + LIBUS_RECV_BUFFER_PADDING, read);
    if (!s || ssl_gone(s)) return NULL;
  }
  s->ssl_fatal_error = 1;
  if (has_reason) {
    us_dispatch_handshake(s, 0, (struct us_bun_verify_error_t){.error = -71, .code = "EPROTO", .reason = reason});
    if (ssl_gone(s)) return NULL;
  }
  ssl_close(s, 0, NULL);
  return NULL;
}

struct us_socket_t *us_internal_ssl_on_data(struct us_socket_t *socket, char *data, int length) {
  /* The parameter is _Nonnull in release builds, and the helpers below return NULL for a socket that is gone. */
  struct us_socket_t *s = socket;
  /* See ssl_update_handshake: start this socket's SSL processing with a clean
   * per-thread error queue so a captured reason cannot belong to another
   * socket on the same thread. */
  ERR_clear_error();
  /* upgradeTLS [raw, _] half observes ciphertext before SSL_read consumes it. */
  if (s->ssl_raw_tap) {
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
    /* While the handshake is pending, SSL_read seals this side's outbound
     * flight (TLS 1.3 client Certificate/Finished, server Hello flight).
     * Batch those records instead of raw-writing each: when the handshake
     * completes in this read, the flight is HELD across the on_handshake
     * dispatch below, so a write the JS callback issues appends to it and
     * us_internal_ssl_write flushes flight + first application data in ONE
     * kernel write (one TCP segment). Two segments let a peer that tears
     * down right after the handshake (node's post-verify destroy, #40653)
     * close with the second segment unread, which turns its FIN teardown
     * into an RST and a bogus ECONNRESET at this side. Node's memory BIO
     * drained once per cycle has the same single-segment shape. Not gated
     * on ssl_batch_spills: a refusal in that dispatch must find the flight
     * held, and a flight the kernel refuses spills whole either way. */
    int hs_batching = s->ssl_handshake_state == HANDSHAKE_PENDING &&
                      !loop_ssl_data->ssl_write_batching;
    if (hs_batching) loop_ssl_data->ssl_write_batching = 1;
    unsigned char ssl_was_in_use = s->ssl_in_use;
    s->ssl_in_use = 1;
    int just_read = SSL_read(s_ssl(s),
                             loop_ssl_data->ssl_read_output.get() + LIBUS_RECV_BUFFER_PADDING + read,
                             LIBUS_RECV_BUFFER_LENGTH - read);
    s->ssl_in_use = ssl_was_in_use;
    if (hs_batching) {
      loop_ssl_data->ssl_write_batching = 0;
      if (s->ssl_pending_detach) {
        /* Destroyed from a callback inside the read: the flight is cancelled
         * with the connection (the BIO swallows post-detach records the same
         * way). */
        ssl_release_batch(s->group->loop, s);
      } else if (!(s->ssl && s->ssl_handshake_state == HANDSHAKE_PENDING &&
                   SSL_is_init_finished(s_ssl(s)))) {
        /* The handshake did not complete in this read (or already reported):
         * send this round's flight now so the peer can progress. */
        ssl_flush_write_batch(loop_ssl_data, s);
      }
      /* else: handshake just completed - hold the flight for the
       * on_handshake dispatch below. */
    }
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
      if (err != SSL_ERROR_WANT_READ && err != SSL_ERROR_PENDING_CERTIFICATE) {
        if (err == SSL_ERROR_WANT_RENEGOTIATE) {
          /* The HelloRequest can share a read with the server's Finished. */
          s = ssl_report_finished_handshake(s, loop_ssl_data, 0);
          if (!s) return NULL;
          if (ssl_renegotiate(s)) continue;
          /* After our own close_notify or FIN the request has no answer: that is the end of our close. */
          if (us_internal_ssl_is_shut_down(s)) ERR_clear_error();
          return ssl_fail_established_session(s, loop_ssl_data, read);
        } else if (err == SSL_ERROR_ZERO_RETURN) {
          /* The close_notify can share a read with the peer's Finished: the owner hears of the handshake before the close below. */
          s = ssl_report_finished_handshake(s, loop_ssl_data, 0);
          if (!s) return NULL;
          /* Remote close_notify. A NewSessionTicket that rode in ahead of the
           * close_notify was parked by the new-session callback; deliver it
           * first (wire order - the ticket preceded these bytes, and Node's
           * NewSessionCallback runs before the data reaches JS), then the
           * decrypted data, then the EOF. */
          ssl_flush_pending_events(s);
          if (ssl_gone(s)) return NULL;
          if (read) {
            s = us_dispatch_data(s, loop_ssl_data->ssl_read_output.get() + LIBUS_RECV_BUFFER_PADDING, read);
            if (!s || ssl_gone(s)) return NULL;
          }
          /* close_notify only closed the PEER's write side; when it rides in
           * the same flight as its Finished, the loop tail below is never
           * reached and a parked write would be destroyed with the socket. */
          s = ssl_retry_parked_write(s);
          if (!s || ssl_gone(s)) return NULL;
          if (s->ssl_close_after_spill) return s;
          /* TLS-level EOF: for uWS HTTP sockets, dispatch the user layer's
           * end handler like a TCP FIN would (see ssl_wants_eof_dispatch),
           * then honor half-open exactly like the plain-TCP eof branch in
           * loop.c. */
          if (ssl_wants_eof_dispatch(s)) {
            s = ssl_deliver_eof(s);
            if (!s || ssl_gone(s)) return NULL;
            if (s->flags.allow_half_open &&
                !(SSL_get_shutdown(s_ssl(s)) & SSL_SENT_SHUTDOWN)) {
              /* close_notify only ended the peer's write side; ours may
               * still flush queued bytes, and the app's own end() completes
               * the shutdown (ssl_handle_shutdown sees RECEIVED_SHUTDOWN and
               * finishes immediately). With SENT_SHUTDOWN both directions are
               * closed and nothing is left to hold open: fall through so the
               * deferred graceful close (code 0, no FIN sent) completes here
               * instead of waiting for a FIN that may never come. */
              return s;
            }
          }
          if (!s->ssl_close_after_spill) s = ssl_close(s, 0, NULL);
          if (!s || ssl_gone(s)) return NULL;
          /* Spill-deferred close: the socket is still live; report it so the
           * caller's bookkeeping does not treat it as destroyed. */
          return s;
        }

        if (s->ssl_handshake_state != HANDSHAKE_PENDING || SSL_is_init_finished(s_ssl(s))) {
          return ssl_fail_established_session(s, loop_ssl_data, read);
        }
        /* SSL_read's name for a close_notify in place of a handshake message: https://github.com/oven-sh/bun/issues/44517 */
        if (ERR_peek_error() == ERR_PACK(ERR_LIB_SSL, SSL_R_SSL_HANDSHAKE_FAILURE)) {
          ERR_clear_error();
          ssl_trigger_handshake_econnreset(s);
          if (ssl_gone(s)) return NULL;
        }
        if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
          ssl_park_fatal_reason(s);
        }
        ssl_close(s, 0, NULL);
        loop_ssl_data->ssl_last_fatal_error[0] = 0;
        return NULL;
      } else {
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
         * loads. */
        s = ssl_report_finished_handshake(s, loop_ssl_data, 1);
        if (!s) return NULL;
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
        ssl_flush_pending_events(s);
        if (ssl_gone(s)) return NULL;
        s = us_dispatch_data(s, loop_ssl_data->ssl_read_output.get() + LIBUS_RECV_BUFFER_PADDING, read);
        if (!s || ssl_gone(s)) return NULL;
        break;
      }
    } else {
      /* SSL_read returned application data with the handshake having
       * finished inside it. Fire on_handshake before delivering data so the
       * caller can inspect ALPN and re-tag the socket. No parked-write retry:
       * its writable dispatch would run before the data this read decrypted
       * reaches the caller. */
      s = ssl_report_finished_handshake(s, loop_ssl_data, 0);
      if (!s) return NULL;
    }

    read += just_read;

    if (read == LIBUS_RECV_BUFFER_LENGTH) {
      char *saved_input = loop_ssl_data->ssl_read_input;
      unsigned int saved_length = loop_ssl_data->ssl_read_input_length;
      unsigned int saved_offset = loop_ssl_data->ssl_read_input_offset;
      /* Same flush-before-dispatch as the loop exit below; the save/restore
       * around this block protects the ciphertext still in the BIO from any
       * JS the session handler runs. */
      ssl_flush_pending_events(s);
      if (ssl_gone(s)) return NULL;
      s = us_dispatch_data(s, loop_ssl_data->ssl_read_output.get() + LIBUS_RECV_BUFFER_PADDING, read);
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
   * application a writable callback. Re-check s->ssl: any dispatch above may
   * have closed and freed s->ssl. */
  if (ssl_gone(s)) return NULL;
  s = ssl_retry_parked_write(s);
  if (!s || ssl_gone(s)) return NULL;

  /* The SSL_read loop above is fully unwound; deliver any session the
   * new-session callback parked while it ran. The JS this dispatches may
   * close the socket. */
  ssl_flush_pending_events(s);
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

/* Ciphertext bytes already sealed for `s` and counted as written by
 * us_internal_ssl_write, still waiting on a writable event to reach the
 * kernel. uWS's AsyncSocket::hasFullyDrained() checks this so the HTTP
 * close-after-drain gates do not fire while the last batch is still in
 * userspace. */
unsigned int us_internal_ssl_spill_pending(struct us_socket_t *s) {
  if (!s->ssl_spilled || ssl_sent_close_notify(s)) return 0;
  struct us_ssl_spill_t *spill = us_ssl_rare(s_ssl(s))->spill.get();
  return spill->length - spill->offset;
}

int us_internal_ssl_write(struct us_socket_t *s, const char *data, int length) {
  struct us_iovec_t iov = {(void *)data, (size_t)length};
  return us_internal_ssl_writev(s, &iov, 1);
}

/* The records of every part share one batch, so they reach the kernel in one write. Returns the plaintext bytes taken, in order. */
int us_internal_ssl_writev(struct us_socket_t *s, const struct us_iovec_t *iov, int count) {
  while (count && iov->iov_len == 0) iov++, count--;
  if (us_socket_is_closed(s) || us_internal_ssl_is_shut_down(s) || count == 0) return 0;

  /* Fast-path connect attaches SSL eagerly on a SEMI_SOCKET (see
   * us_socket_group_connect_resolved_dns); on_open hasn't fired yet so
   * SNI/ALPN aren't on the SSL. SSL_write here would serialize the
   * ClientHello without them. Report 0 so the caller buffers; on_open →
   * ssl_update_handshake drains it. Mirrors the SEMI_SOCKET guard in
   * us_internal_ssl_close above. */
  if ((us_internal_poll_type(&s->p) & POLL_TYPE_KIND_MASK) == POLL_TYPE_SEMI_SOCKET) {
    s->ssl_write_parked = 1;
    return 0;
  }

  /* Called from inside SSL_read/SSL_do_handshake on this socket (an ALPN/SNI
   * callback writing): wait for the handshake, same as WANT_READ below. */
  if (s->ssl_in_use) {
    s->ssl_write_wants_read = 1;
    s->ssl_write_parked = 1;
    return 0;
  }

    struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;

  /* Earlier batched records of ours must reach the wire before anything new:
   * SSL already counts them as written. While they cannot be delivered, the
   * caller buffers plaintext (return 0), bounding the in-flight ciphertext. */
  loop_ssl_data->ssl_send_error = 0;
  if (!ssl_drain_spill(loop_ssl_data, s) || !us_internal_socket_can_raw_write(s)) {
    return 0;
  }

  loop_ssl_data->ssl_read_input_length = 0;
  loop_ssl_data->ssl_socket = s;

  /* Batch this write's records unless a connection on the loop still holds
   * the rest of a batch flush (then send record by record).
   *
   * Plaintext is consumed in record-size slices and the batch flushes every
   * few records: the moment the wire blocks we STOP consuming, so the bytes
   * we report as written are honest up to one bounded spill. Reporting a
   * whole large write as consumed while its ciphertext sat in memory let the
   * layers above fire 'finish' and close before the data reached the wire. */
  int outer_batching = loop_ssl_data->ssl_write_batching;
  int batching = (loop_ssl_data->ssl_batch_spills == 0);
  loop_ssl_data->ssl_write_batching = batching;

  int total = 0;
  int last_ssl_written = 1;
  size_t part_offset = 0;
  while (count) {
    if (part_offset == iov->iov_len) {
      iov++, count--, part_offset = 0;
      continue;
    }
    size_t part_left = iov->iov_len - part_offset;
    int chunk = part_left > 16384 ? 16384 : (int)part_left;
#if defined(LIBUS_SOCKET_FAULT_INJECTION) && LIBUS_SOCKET_FAULT_INJECTION
    ssize_t injected = 0;
    int unused = 0;
    if (US_FAULT_CHECK(US_FAULT_SSL_WRITE, us_poll_fd(&s->p), injected, unused)) {
      ERR_clear_error();
      ERR_put_error(ERR_LIB_SSL, 0, ERR_R_INTERNAL_ERROR, __FILE__, __LINE__);
      last_ssl_written = -1;
      break;
    }
#endif
    /* Same deferred-close protocol as the SSL_do_handshake/SSL_read drivers. */
    s->ssl_in_use = 1;
    last_ssl_written = SSL_write(s_ssl(s), (const char *)iov->iov_base + part_offset, chunk);
    s->ssl_in_use = 0;
    if (s->ssl_pending_detach) {
      /* Closed from inside the call: drop this write's records (and any held
       * flight of ours they extend) and close now. */
      loop_ssl_data->ssl_write_batching = outer_batching;
      ssl_release_batch(s->group->loop, s);
      s->ssl_pending_detach = 0;
      us_socket_close(s, s->ssl_pending_close_code, NULL);
      return 0;
    }
    if (last_ssl_written <= 0) break;
    total += last_ssl_written;
    part_offset += (size_t)last_ssl_written;
    /* A batching allocation failure marks the socket fatal from inside the BIO, a
     * rejected send() ends the write side: stop sealing records that cannot leave. */
    if (s->ssl_fatal_error || !us_internal_socket_can_raw_write(s)) break;
    if (s->ssl_spilled) break; /* wire blocked: stop consuming */
    if (batching && loop_ssl_data->ssl_write_batch_len >= 131072) {
      if (!ssl_flush_write_batch(loop_ssl_data, s)) break;
      if (s->ssl_fatal_error) break;
    }
  }
  loop_ssl_data->ssl_write_batching = outer_batching;
  if (batching) {
    ssl_flush_write_batch(loop_ssl_data, s);
  }
  if (!us_internal_socket_can_raw_write(s)) return 0;
  if (!s->ssl_fatal_error && last_ssl_written <= 0) {
    int err = SSL_get_error(s_ssl(s), last_ssl_written);
    if (err == SSL_ERROR_WANT_READ) {
      s->ssl_write_wants_read = 1;
      s->ssl_write_parked = 1;
    } else if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
      /* SSL_write drives the handshake when it has not finished, so this is
       * where a handshake-configuration failure (impossible version window,
       * no shared cipher) surfaces for a caller that wrote before
       * 'secureConnect'. Park the reason: the handshake dispatch this failure
       * triggers reports it instead of a bare verification verdict. */
      ssl_park_fatal_reason(s);
    }
  }
  if (!s->ssl_fatal_error) return total;
  s->flags.last_write_failed = 1;
  us_internal_rearm_writable(s);
  return 0;
}

int us_internal_ssl_fatal_write_error(struct us_socket_t *s) {
  /* Before the handshake is reported, its dispatch carries the failure. */
  if (!s->ssl || s->ssl_handshake_state != HANDSHAKE_COMPLETED) return 0;
  if (!us_internal_socket_can_raw_write(s)) {
    return ((struct loop_ssl_data *)s->group->loop->data.ssl_data)->ssl_send_error;
  }
  if (!s->ssl_fatal_error) return 0;
#ifdef _WIN32
  return -UV_EPROTO;
#else
  return EPROTO;
#endif
}

static void ssl_send_fin(struct us_socket_t *s) {
  if (s->ssl_spilled && !s->ssl_fatal_error) {
#ifdef _WIN32
    /* On Windows a reset drops what was not read yet, and a peer that answered and closed resets over a close_notify that comes late. */
    int room;
    bsd_socket_buffer_size(us_poll_fd(&s->p), 0, 1 << 30, &room);
#else
    s->ssl_shutdown_after_spill = 1;
    return;
#endif
  }
  ssl_release_spill(s->group->loop, s);
  us_internal_socket_raw_shutdown(s);
}

void us_internal_ssl_shutdown(struct us_socket_t *s) {
  if (us_socket_is_closed(s) || us_internal_ssl_is_shut_down(s)) return;
  if (s->ssl_first_flight_before_fin) {
    s->ssl_shutdown_after_first_flight = 1;
    return;
  }

  /* Spilled ciphertext is data the layers above already count as written;
   * a FIN/close_notify now would cut it off. Finish the shutdown from the
   * writable event once the spill drains. A held batch (an end() issued
   * from the on_handshake callback while the final flight is still parked)
   * is the same kind of debt: flush it first so the close_notify and FIN
   * below follow the flight, not precede it. */
  {
    struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;
    if (loop_ssl_data && loop_ssl_data->ssl_write_batch_len &&
        loop_ssl_data->ssl_write_batch_owner == s) {
      ssl_flush_write_batch(loop_ssl_data, s);
    }
    if (!ssl_drain_spill(loop_ssl_data, s)) {
      s->ssl_shutdown_after_spill = 1;
      return;
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
    ssl_handle_shutdown(s);
    ssl_send_fin(s);
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
  }
  /* RECEIVED_SHUTDOWN brought us here, so the TLS shutdown is complete; FIN the
   * TCP write side so the poll type becomes SHUT_DOWN and the loop's
   * is_shut_down eof branch can close once both halves are done. */
  ssl_send_fin(s);
}

/* Resume a handshake suspended by an async SNICallback. `owned_ctx` (may be NULL =
 * fall through to the default context) carries a reference that this call
 * consumes. `error` != 0 aborts the handshake instead. No-op when the socket
 * already closed/detached (the pending JS resolution outlived it). */
void us_socket_sni_resolve(struct us_socket_t *s, struct ssl_ctx_st *owned_ctx, int error) {
  us_ssl_ctx_ptr ctx{owned_ctx};
  if (!s || us_socket_is_closed(s) || !s->ssl || !s_ssl(s)) {
    return;
  }
  if (s->ssl_sni_pending != US_SNI_WAITING) {
    /* Not actually suspended (late/duplicate resolution). */
    return;
  }
  struct loop_ssl_data *loop_ssl_data = ssl_set_loop_data(s);
  us_ssl_ctx_ptr outer_ctx = std::move(loop_ssl_data->ssl_sni_resolved_ctx);
  if (error) {
    s->ssl_sni_pending = US_SNI_ERROR;
    /* Match the synchronous abort path: the connection is dropped WITHOUT a
     * TLS alert (Node's behavior for SNICallback errors). Mark the socket for
     * the deferred close before re-driving the handshake, so the BIO swallows
     * the handshake_failure alert BoringSSL queues for select_cert_error and
     * the epilogue closes the socket; the client just sees the connection go
     * away ("disconnected before secure TLS connection was established"). */
    s->ssl_pending_detach = 1;
    s->ssl_pending_close_code = 0;
  } else {
    s->ssl_sni_pending = US_SNI_RESOLVED;
    loop_ssl_data->ssl_sni_resolved_ctx = std::move(ctx); /* may be NULL = default ctx */
  }
  /* Re-drive the handshake; select_cert_cb re-fires and consumes the state. */
  ssl_update_handshake(s, 1);
  loop_ssl_data->ssl_sni_resolved_ctx = std::move(outer_ctx);
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
  /* us_socket_adopt() hands either of these back as it is. */
  if (us_socket_is_closed(s) || us_socket_is_shut_down(s)) return NULL;

  struct us_socket_t *new_s = us_socket_adopt(s, group, kind, old_ext_size, ext_size);
  if (!new_s) return NULL;

  /* is_client=0 puts the SSL in accept state (server-side upgrade, e.g.
   * `new tls.TLSSocket(acceptedSocket, { isServer: true })`); there is no
   * listener for an adopted socket, so SNI resolves from the single ssl_ctx. */
  us_internal_ssl_attach(new_s, ssl_ctx, is_client, sni, NULL);
  if (!is_client && new_s->ssl) {
    /* As in Node's TLSWrap::SetVerifyMode, the policy is this TLSSocket's, not the one the shared SSL_CTX was built with. */
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
  ssl_update_handshake(s, 1);
}

/* ── SNI on listen sockets ───────────────────────────────────────────────── */

/* A ClientHello can arrive after its listen socket closed: one reference for the listen socket, one per accepted SSL. */
struct us_server_names_t : us_allocated_t {
  unsigned int refs;
  /* NULL once the listen socket closed. */
  struct us_listen_socket_t *ls;
  /* NULL until the first name is added. */
  std::unique_ptr<sni_node<us_ssl_ctx_ptr>> tree;
  /* Returns the SSL_CTX to serve for `hostname` on the in-flight handshake only
   * (the caller does not cache it), or NULL to fall through to the tree. */
  struct ssl_ctx_st *(*on_server_name)(struct us_listen_socket_t *, const char *hostname, int *abort_handshake, struct us_socket_t *socket);
};

static struct us_server_names_t *us_listen_socket_server_names(struct us_listen_socket_t *ls) {
  if (!ls->server_names) {
    struct us_server_names_t *names = new us_server_names_t();
    names->refs = 1;
    names->ls = ls;
    ls->server_names = names;
  }
  return ls->server_names;
}

static us_server_names_ptr us_server_names_ref(struct us_listen_socket_t *ls) {
  struct us_server_names_t *names = us_listen_socket_server_names(ls);
  names->refs++;
  return us_server_names_ptr{names};
}

static void us_server_names_unref(struct us_server_names_t *names) {
  if (!--names->refs) delete names;
}

static SSL_CTX *us_server_names_find(struct us_server_names_t *names, const char *hostname) {
  if (!names || !names->tree) return NULL;
  const us_ssl_ctx_ptr *ctx = names->tree->find(hostname);
  return ctx ? ctx->get() : NULL;
}

#define US_SNI_POLICY_REQUEST_CERT ((uintptr_t)1)
#define US_SNI_POLICY_REJECT_UNAUTHORIZED ((uintptr_t)2)

static std::atomic<uint32_t> us_sni_sid_ctx_counter = 0;

/* Record the client-certificate policy of a per-serverName entry on its
 * SSL_CTX and give it a session-id context of its own: SSL_set_SSL_CTX copies
 * the certificate (with its sid_ctx) but not verify_mode, so the SNI switch
 * reapplies the policy per connection, and a session established under any
 * other context is never resumed under this one (a resumed handshake skips
 * client authentication entirely). */
void us_ssl_ctx_set_sni_policy(SSL_CTX *ctx, int request_cert, int reject_unauthorized) {
  if (!ctx) return;
  us_ex_idx_ensure();
  uintptr_t packed = (request_cert ? US_SNI_POLICY_REQUEST_CERT : 0) |
                     (reject_unauthorized ? US_SNI_POLICY_REJECT_UNAUTHORIZED : 0);
  SSL_CTX_set_ex_data(ctx, us_ctx_sni_policy_ex_idx, (void *)packed);
  uint32_t sid = ++us_sni_sid_ctx_counter;
  SSL_CTX_set_session_id_context(ctx, (const uint8_t *)&sid, sizeof(sid));
}

/* Every SNI context switch goes through here: SSL_set_SSL_CTX alone leaves
 * verify_mode as inherited from the default context at accept, so a
 * per-serverName entry's requestCert/rejectUnauthorized are added on top of
 * it (the connection's inherited requirement is kept). A context without a
 * recorded policy (node:tls SecureContext, whose policy is server-level)
 * leaves the connection's verify mode untouched.
 *
 * SSL_set_SSL_CTX also copies the context's session id context, which for
 * contexts built in Rust is the digest of their options
 * (create_ssl_context_with_digest). BoringSSL checks it after this switch, so
 * a session issued under other options is not resumed and the client is
 * authenticated again, against this context's CA. That refusal is deliberate
 * (RFC 6066 section 3; openssl/ssl.h: "partition session caches between SNI
 * hosts") and must not be relaxed for parity with another runtime. */
static void us_ssl_apply_selected_ctx(SSL *ssl, SSL_CTX *ctx) {
  SSL_set_SSL_CTX(ssl, ctx);
  if (us_ctx_sni_policy_ex_idx < 0) return;
  uintptr_t policy = (uintptr_t)SSL_CTX_get_ex_data(ctx, us_ctx_sni_policy_ex_idx);
  if (!(policy & US_SNI_POLICY_REQUEST_CERT)) return;
  int mode = SSL_get_verify_mode(ssl) | SSL_VERIFY_PEER;
  if (policy & US_SNI_POLICY_REJECT_UNAUTHORIZED) mode |= SSL_VERIFY_FAIL_IF_NO_PEER_CERT;
  SSL_set_verify(ssl, mode, us_verify_callback);
}

/* Whether the SNI-selected context of this connection demands closing on a
 * client-certificate verification error (requestCert && rejectUnauthorized
 * of the per-serverName entry). */
int us_ssl_ctx_reject_unauthorized(SSL_CTX *ctx) {
  if (!ctx || us_ctx_sni_policy_ex_idx < 0) return 0;
  uintptr_t packed = (uintptr_t)SSL_CTX_get_ex_data(ctx, us_ctx_sni_policy_ex_idx);
  return (packed & US_SNI_POLICY_REQUEST_CERT) &&
         (packed & US_SNI_POLICY_REJECT_UNAUTHORIZED);
}

int us_socket_server_name_reject_unauthorized(struct us_socket_t *s) {
  if (!s->ssl) return 0;
  return us_ssl_ctx_reject_unauthorized(SSL_get_SSL_CTX(s_ssl(s)));
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
  struct us_socket_t *s = ssl ? us_ssl_socket(ssl) : NULL;
  if (!s) return ssl_select_cert_success;
  struct us_ssl_rare_t *rare = us_ssl_rare(ssl);
  struct us_server_names_t *names = rare ? rare->server_names.get() : NULL;

  /* A previous suspension being resumed: consume the stored result. */
  if (s->ssl_sni_pending == US_SNI_RESOLVED) {
    s->ssl_sni_pending = US_SNI_NONE;
    struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)BIO_get_data(SSL_get_wbio(ssl));
    if (us_ssl_ctx_ptr resolved_ctx = std::move(loop_ssl_data->ssl_sni_resolved_ctx)) {
      us_ssl_apply_selected_ctx(ssl, resolved_ctx.get());
      return ssl_select_cert_success;
    }
    /* The asynchronous resolution selected nothing (cb(null, null)): fall
     * through to the static SNI tree below, exactly like a synchronous
     * resolver returning null - the resume must not skip the tree fallback
     * the sync path gets. */
    if (names) {
      /* Read the servername from the raw ClientHello, same as the first-call
       * path below: that is the read the early-callback contract guarantees
       * (SSL_get_servername happens to be populated by the resume re-drive
       * today, but the raw parse does not depend on that). */
      char resumed_host[256];
      if (us_client_hello_servername(hello, resumed_host, sizeof(resumed_host))) {
        SSL_CTX *resumed_ctx = us_server_names_find(names, resumed_host);
        if (resumed_ctx) {
          us_ssl_apply_selected_ctx(ssl, resumed_ctx);
        }
      }
    }
    return ssl_select_cert_success;
  }
  if (s->ssl_sni_pending == US_SNI_ERROR) {
    s->ssl_sni_pending = US_SNI_NONE;
    return ssl_select_cert_error;
  }
  if (s->ssl_sni_pending == US_SNI_WAITING) {
    /* Still waiting (a spurious re-drive); keep suspending. */
    return ssl_select_cert_retry;
  }

  /* With no listener resolver, the socket may still carry its own: a
   * server-side socket adopted into TLS with its own SNICallback. */
  const int no_listener_resolver = (!names || !names->on_server_name);
  if (no_listener_resolver && !s->ssl_sni_resolver) {
    return ssl_select_cert_success;
  }

  char hostname[256];
  if (!us_client_hello_servername(hello, hostname, sizeof(hostname))) {
    return ssl_select_cert_success;
  }

  /* The dynamic resolver (the user's SNICallback) runs FIRST, matching Node
   * where a user-provided SNICallback replaces the default SNI handling
   * entirely (tree-first would shadow the callback for every name that also
   * has an addContext entry). The static tree (addContext entries) is the
   * fallback when the resolver selects nothing, which is also the
   * no-user-callback path: the JS dispatch returns undefined immediately in
   * that case. */

  void *saved_loop_state[US_SSL_LOOP_STATE_SLOTS];
  us_internal_ssl_loop_state_save(ssl, saved_loop_state);
  int abort_handshake = 0;
  us_ssl_ctx_ptr dyn{
      no_listener_resolver ? us_dispatch_socket_server_name(s, hostname, &abort_handshake)
                           : names->on_server_name(names->ls, hostname, &abort_handshake, s)};
  us_internal_ssl_loop_state_restore(saved_loop_state);

  if (abort_handshake == 1) {
    /* Error/invalid context: drop the connection without an alert (the
     * deferred-close + BIO-swallow path, same as sni_cb). */
    s->ssl_pending_detach = 1;
    s->ssl_pending_close_code = 0;
    return ssl_select_cert_error;
  }
  if (abort_handshake == 2) {
    /* The JS resolver answered "pending": suspend until us_socket_sni_resolve. */
    s->ssl_sni_pending = US_SNI_WAITING;
    return ssl_select_cert_retry;
  }
  if (dyn) {
    us_ssl_apply_selected_ctx(ssl, dyn.get());
    return ssl_select_cert_success;
  }

  /* No dynamic selection: fall back to the static SNI tree (the
   * addContext() entries). An adopted socket has no tree. */
  SSL_CTX *ctx = us_server_names_find(names, hostname);
  if (ctx) {
    us_ssl_apply_selected_ctx(ssl, ctx);
  }
  return ssl_select_cert_success;
}

static int sni_cb(SSL *ssl, int *al, void *arg) {
  (void)al; (void)arg;
  if (!ssl) return SSL_TLSEXT_ERR_NOACK;
  /* The names are per-SSL (set at accept), not the CTX-level arg — the
   * SSL_CTX is shared and may outlive any one listener. */
  struct us_ssl_rare_t *rare = us_ssl_rare(ssl);
  struct us_server_names_t *names = rare ? rare->server_names.get() : NULL;
  if (!names) return SSL_TLSEXT_ERR_OK;
  if (names->on_server_name) {
    /* A dynamic resolver (user SNICallback) exists: us_select_cert_cb already
     * ran it - and the static-tree fallback - at the earlier
     * select-certificate stage. Consulting the tree again here would
     * OVERWRITE the resolver's per-connection selection with the tree entry,
     * undoing the SNICallback-takes-precedence contract. */
    return SSL_TLSEXT_ERR_OK;
  }
  const char *hostname = SSL_get_servername(ssl, TLSEXT_NAMETYPE_host_name);
  if (hostname && hostname[0]) {
    /* Static SNI tree only (no dynamic resolver registered for this
     * listener). */
    SSL_CTX *ctx = us_server_names_find(names, hostname);
    if (ctx) {
      us_ssl_apply_selected_ctx(ssl, ctx);
    }
  }
  return SSL_TLSEXT_ERR_OK;
}

void us_listen_socket_add_server_name(struct us_listen_socket_t *ls,
                                      const char *hostname_pattern,
                                      SSL_CTX *ctx) {
  SSL_CTX *default_ctx = ls->ssl_ctx;
  if (!default_ctx) return;

  struct us_server_names_t *names = us_listen_socket_server_names(ls);
  if (!names->tree) {
    names->tree = std::make_unique<sni_node<us_ssl_ctx_ptr>>();
    /* Idempotent across listeners sharing this SSL_CTX — the callback reads
     * the names off the SSL, not the arg. */
    SSL_CTX_set_tlsext_servername_callback(default_ctx, sni_cb);
  }

  SSL_CTX_up_ref(ctx);
  names->tree->add(hostname_pattern, us_ssl_ctx_ptr{ctx});
}

/* Returns the SSL_CTX registered for `hostname_pattern` via
 * us_listen_socket_add_server_name, or NULL. Owned - the caller must release
 * the reference. The on_server_name resolvers return owned references (the
 * SNI dispatcher frees them after SSL_set_SSL_CTX takes its own), so the
 * tree's reference must not be handed out as a borrow. */
struct ssl_ctx_st *us_listen_socket_find_server_name_ctx(struct us_listen_socket_t *ls,
                                                         const char *hostname_pattern) {
  SSL_CTX *ctx = us_server_names_find(ls->server_names, hostname_pattern);
  if (ctx) SSL_CTX_up_ref(ctx);
  return ctx;
}

void us_listen_socket_set_default_ssl_ctx(struct us_listen_socket_t *ls,
                                          SSL_CTX *ctx) {
  if (ls->ssl_ctx == ctx) return;
  SSL_CTX_up_ref(ctx);
  /* Carry over the listener-level callbacks registered on the old default. */
  struct us_server_names_t *names = ls->server_names;
  if (names && names->tree) {
    SSL_CTX_set_tlsext_servername_callback(ctx, sni_cb);
  }
  if (names && names->on_server_name) {
    SSL_CTX_set_select_certificate_cb(ctx, us_select_cert_cb);
  }
  if (ls->ssl_ctx) {
    us_internal_ssl_ctx_unref(ls->ssl_ctx);
  }
  ls->ssl_ctx = ctx;
}

void us_listen_socket_on_server_name(struct us_listen_socket_t *ls,
                                     struct ssl_ctx_st *(*cb)(struct us_listen_socket_t *, const char *, int *, struct us_socket_t *)) {
  if (!ls->ssl_ctx) return;
  us_listen_socket_server_names(ls)->on_server_name = cb;
  /* The dynamic resolver may need to suspend the handshake (async
   * SNICallback); only the early select-certificate callback supports retry,
   * so register it on the listener's default context. The servername-stage
   * sni_cb stays registered for the static SNI tree (it is a no-op when the
   * early callback already installed a context). */
  SSL_CTX_set_select_certificate_cb(ls->ssl_ctx, us_select_cert_cb);
}

/* Register a socket-level SNI resolver on an already-attached server-side SSL.
 * Must run after us_socket_adopt_tls and before the handshake is driven. */
void us_socket_on_server_name(struct us_socket_t *s) {
  if (!s || !s->ssl || !s_ssl(s)) return;
  SSL *ssl = s_ssl(s);
  s->ssl_sni_resolver = 1;
  /* Only the early select-certificate stage supports retry, which an async
   * SNICallback needs. The CTX is a memoized SecureContext possibly shared
   * with a listener, and this install is permanent, so us_select_cert_cb must
   * stay a no-op on any SSL carrying neither resolver. */
  SSL_CTX *ctx = SSL_get_SSL_CTX(ssl);
  if (ctx) SSL_CTX_set_select_certificate_cb(ctx, us_select_cert_cb);
}

const char *us_internal_ssl_sni_servername(struct us_socket_t *s) {
  if (!s->ssl || !s_ssl(s)) return NULL;
  return SSL_get_servername(s_ssl(s), TLSEXT_NAMETYPE_host_name);
}

void us_internal_listen_socket_ssl_free(struct us_listen_socket_t *ls) {
  if (ls->ssl_ctx) {
    us_internal_ssl_ctx_unref(ls->ssl_ctx);
    ls->ssl_ctx = NULL;
  }
  if (ls->server_names) {
    ls->server_names->ls = NULL;
    us_server_names_unref(ls->server_names);
    ls->server_names = NULL;
  }
}

}

#endif
