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
#include "libusockets.h"
#include <string.h>
#include <stdatomic.h>

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

struct loop_ssl_data {
  char *ssl_read_input, *ssl_read_output;
  unsigned int ssl_read_input_length;
  unsigned int ssl_read_input_offset;

  struct us_socket_t *ssl_socket;
  BIO *shared_rbio;
  BIO *shared_wbio;
  BIO_METHOD *shared_biom;
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

/* ex_data indices, registered lazily at first use:
 *   - us_ctx_ex_idx (SSL_CTX): packed reneg {limit:u32,window:u32}; its
 *     free_func also decrements ssl_ctx_live so the counter tracks ACTUAL
 *     destruction (refcount→0), not every SSL_CTX_free.
 *   - us_sni_ex_idx (SSL_CTX): per-domain userdata (uWS HttpRouter*).
 *   - us_ssl_reneg_state_idx (SSL): per-connection reneg counter, malloc'd on
 *     first reneg attempt only — never on the hot path. */
static int us_ctx_ex_idx = -1;
static int us_sni_ex_idx = -1;
static int us_ssl_reneg_state_idx = -1;
/* Per-SSL: the accepting us_listen_socket_t*. The SSL_CTX is shared and can
 * outlive any one listener, so storing ls as the CTX-level servername_arg is a
 * UAF after listener close (and overwritten on multi-listen). */
static int us_ssl_listener_ex_idx = -1;

#define US_RENEG_PACK(limit, window) ((void *)(uintptr_t)(((uint64_t)(limit) << 32) | (uint32_t)(window)))
#define US_RENEG_LIMIT(p)  ((uint32_t)((uint64_t)(uintptr_t)(p) >> 32))
#define US_RENEG_WINDOW(p) ((uint32_t)((uint64_t)(uintptr_t)(p)))

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

static inline int us_ssl_ctx_ex_idx(void) {
  if (us_ctx_ex_idx < 0)
    us_ctx_ex_idx = SSL_CTX_get_ex_new_index(0, NULL, NULL, NULL, us_ctx_ex_free);
  return us_ctx_ex_idx;
}

static inline void us_reneg_policy(SSL *ssl, uint32_t *limit, uint32_t *window) {
  void *packed = us_ctx_ex_idx >= 0
      ? SSL_CTX_get_ex_data(SSL_get_SSL_CTX(ssl), us_ctx_ex_idx) : NULL;
  *limit = packed ? US_RENEG_LIMIT(packed) : 3;
  *window = packed ? US_RENEG_WINDOW(packed) : 600;
}

static inline struct us_ssl_reneg_state_t *us_reneg_state(SSL *ssl) {
  if (us_ssl_reneg_state_idx < 0)
    us_ssl_reneg_state_idx = SSL_get_ex_new_index(0, NULL, NULL, NULL, us_ssl_reneg_state_free);
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

static int BIO_s_custom_write(BIO *bio, const char *data, int length) {
  struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)BIO_get_data(bio);

  int written = us_socket_raw_write(loop_ssl_data->ssl_socket, data, length);

  BIO_clear_retry_flags(bio);
  if (!written) {
    BIO_set_retry_write(bio);
    return -1;
  }
  return written;
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

void us_internal_init_loop_ssl_data(struct us_loop_t *loop) {
  if (!loop->data.ssl_data) {
    struct loop_ssl_data *loop_ssl_data = us_calloc(1, sizeof(struct loop_ssl_data));
    loop_ssl_data->ssl_read_output =
        us_malloc(LIBUS_RECV_BUFFER_LENGTH + LIBUS_RECV_BUFFER_PADDING * 2);

    OPENSSL_init_ssl(0, NULL);

    loop_ssl_data->shared_biom = BIO_meth_new(BIO_TYPE_MEM, "µS BIO");
    BIO_meth_set_create(loop_ssl_data->shared_biom, BIO_s_custom_create);
    BIO_meth_set_write(loop_ssl_data->shared_biom, BIO_s_custom_write);
    BIO_meth_set_read(loop_ssl_data->shared_biom, BIO_s_custom_read);
    BIO_meth_set_ctrl(loop_ssl_data->shared_biom, BIO_s_custom_ctrl);

    loop_ssl_data->shared_rbio = BIO_new(loop_ssl_data->shared_biom);
    loop_ssl_data->shared_wbio = BIO_new(loop_ssl_data->shared_biom);
    BIO_set_data(loop_ssl_data->shared_rbio, loop_ssl_data);
    BIO_set_data(loop_ssl_data->shared_wbio, loop_ssl_data);

    loop->data.ssl_data = loop_ssl_data;
  }
}

void us_internal_free_loop_ssl_data(struct us_loop_t *loop) {
  struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)loop->data.ssl_data;
  if (loop_ssl_data) {
    us_free(loop_ssl_data->ssl_read_output);
    BIO_free(loop_ssl_data->shared_rbio);
    BIO_free(loop_ssl_data->shared_wbio);
    BIO_meth_free(loop_ssl_data->shared_biom);
    us_free(loop_ssl_data);
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
  return count > 0;
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
   * on_handshake. See SSL_verify_cb docs — returning 1 lets us defer the
   * decision to JS without aborting mid-handshake. */
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
  SSL_CTX_set_min_proto_version(ssl_context, TLS1_2_VERSION);

  if (options.ssl_prefer_low_memory_usage) {
    SSL_CTX_set_mode(ssl_context, SSL_MODE_RELEASE_BUFFERS);
  }

  if (options.passphrase) {
#ifdef _WIN32
    SSL_CTX_set_default_passwd_cb_userdata(ssl_context, (void *)_strdup(options.passphrase));
#else
    SSL_CTX_set_default_passwd_cb_userdata(ssl_context, (void *)strdup(options.passphrase));
#endif
    SSL_CTX_set_default_passwd_cb(ssl_context, passphrase_cb);
  }

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
  /* passwd_cb is only consulted by SSL_CTX_use_PrivateKey* above; the secret
   * is dead now. Dropping it here means SSL_CTX_free() is sufficient cleanup
   * everywhere downstream — no special "owner" path. */
  ssl_ctx_drop_passphrase(ssl_context);

  if (options.ca_file_name) {
    SSL_CTX_set_cert_store(ssl_context, us_get_default_ca_store());

    STACK_OF(X509_NAME) *ca_list = SSL_load_client_CA_file(options.ca_file_name);
    if (ca_list == NULL) {
      *err = CREATE_BUN_SOCKET_ERROR_LOAD_CA_FILE;
      ssl_ctx_build_fail(ssl_context);
      return NULL;
    }
    SSL_CTX_set_client_CA_list(ssl_context, ca_list);
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
    X509_STORE *cert_store = NULL;
    for (unsigned int i = 0; i < options.ca_count; i++) {
      if (cert_store == NULL) {
        cert_store = us_get_default_ca_store();
        SSL_CTX_set_cert_store(ssl_context, cert_store);
      }
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
  } else if (options.request_cert) {
    SSL_CTX_set_cert_store(ssl_context, us_get_default_ca_store());
    SSL_CTX_set_verify(ssl_context,
        options.reject_unauthorized ? (SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT)
                                    : SSL_VERIFY_PEER,
        us_verify_callback);
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
      unsigned long ssl_err = ERR_get_error();
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

  return ssl_context;
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
      SSL_set0_verify_cert_store(ssl, us_get_shared_default_ca_store());
    }
  } else {
    SSL_set_accept_state(ssl);
    SSL_set_renegotiate_mode(ssl, ssl_renegotiate_never);
    /* sni_cb recovers ls per-SSL — never via the shared SSL_CTX. */
    if (us_ssl_listener_ex_idx < 0)
      us_ssl_listener_ex_idx = SSL_get_ex_new_index(0, NULL, NULL, NULL, NULL);
    SSL_set_ex_data(ssl, us_ssl_listener_ex_idx, listener);
  }

  s->ssl = ssl;
  s->ssl_handshake_state = HANDSHAKE_PENDING;
  s->ssl_write_wants_read = 0;
  s->ssl_read_wants_write = 0;
  s->ssl_fatal_error = 0;
  s->ssl_is_server = is_client ? 0 : 1;
}

void us_internal_ssl_detach(struct us_socket_t *s) {
  if (s->ssl) {
    SSL_free(s_ssl(s));
    s->ssl = NULL;
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

/* The on_handshake callback runs JS which may us_socket_close(s) — that frees
 * s->ssl. Every caller MUST check ssl_gone(s) immediately after this returns
 * and bail before touching s->ssl again. */
static void ssl_trigger_handshake(struct us_socket_t *s, int success) {
  s->ssl_handshake_state = HANDSHAKE_COMPLETED;
  struct us_bun_verify_error_t verify_error = us_internal_ssl_verify_error(s);
  us_dispatch_handshake(s, success, verify_error);
}

static void ssl_trigger_handshake_econnreset(struct us_socket_t *s) {
  s->ssl_handshake_state = HANDSHAKE_COMPLETED;
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
  s->ssl_handshake_state = HANDSHAKE_RENEGOTIATION_PENDING;
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
        return force_fast_shutdown ? 1 : 0;
      }
      s->ssl_fatal_error = 1;
      return 1;
    }
    return ret == 1;
  }
  return 1;
}

struct us_socket_t *us_internal_ssl_close(struct us_socket_t *s, int code, void *reason) {
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

  /* code==0 (clean) → send close_notify and DEFER the fd close until the peer
   * answers (peer's close_notify lands as ZERO_RETURN in on_data and re-enters
   * here with the bidirectional shutdown done). code!=0 (forced) → fast path. */
  int can_close = ssl_handle_shutdown(s, code != 0);
  if (can_close) {
    return us_internal_socket_close_raw(s, code, reason);
  }
  return s;
}
#define ssl_close us_internal_ssl_close

static void ssl_update_handshake(struct us_socket_t *s) {
    if (!s->ssl || s->ssl_handshake_state != HANDSHAKE_PENDING) return;

  if (us_socket_is_closed(s) || us_internal_ssl_is_shut_down(s) ||
      (s_ssl(s) && SSL_get_shutdown(s_ssl(s)) & SSL_RECEIVED_SHUTDOWN)) {
    ssl_trigger_handshake(s, 0);
    return;
  }

  int result = SSL_do_handshake(s_ssl(s));

  if (SSL_get_shutdown(s_ssl(s)) & SSL_RECEIVED_SHUTDOWN) {
    ssl_close(s, 0, NULL);
    return;
  }

  if (result <= 0) {
    int err = SSL_get_error(s_ssl(s), result);
    if (err != SSL_ERROR_WANT_READ && err != SSL_ERROR_WANT_WRITE) {
      if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
        ERR_clear_error();
        s->ssl_fatal_error = 1;
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

struct us_socket_t *us_internal_ssl_on_end(struct us_socket_t *s) {
  ssl_set_loop_data(s);
  /* TCP FIN under TLS is always treated as an answered shutdown. loop.c's
   * non-half-open path follows this with an unconditional us_socket_close, so
   * even if ssl_handle_shutdown deferred (close_notify sent, peer reply
   * impossible after FIN) the second ssl_close sees SENT_SHUTDOWN → raw-close. */
  return ssl_close(s, 0, NULL);
}

struct us_socket_t *us_internal_ssl_on_writable(struct us_socket_t *s) {
  ssl_set_loop_data(s);
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
  if (us_internal_ssl_is_shut_down(s)) return s;

  if (s->ssl_handshake_state == HANDSHAKE_COMPLETED) {
    s = us_dispatch_writable(s);
  }
  return s;
}

struct us_socket_t *us_internal_ssl_on_data(struct us_socket_t *s, char *data, int length) {
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
  if (us_internal_ssl_is_shut_down(s)) {
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
    int just_read = SSL_read(s_ssl(s),
                             loop_ssl_data->ssl_read_output + LIBUS_RECV_BUFFER_PADDING + read,
                             LIBUS_RECV_BUFFER_LENGTH - read);

    if (just_read <= 0) {
      int err = SSL_get_error(s_ssl(s), just_read);
      if (err != SSL_ERROR_WANT_READ && err != SSL_ERROR_WANT_WRITE) {
        if (err == SSL_ERROR_WANT_RENEGOTIATE) {
          if (ssl_renegotiate(s)) continue;
          if (ssl_gone(s)) return NULL;
          err = SSL_ERROR_SSL;
        } else if (err == SSL_ERROR_ZERO_RETURN) {
          /* Remote close_notify. Flush what we decrypted, then close. */
          if (read) {
            s = us_dispatch_data(s, loop_ssl_data->ssl_read_output + LIBUS_RECV_BUFFER_PADDING, read);
            if (!s || ssl_gone(s)) return NULL;
          }
          ssl_close(s, 0, NULL);
          return NULL;
        }

        if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
          ERR_clear_error();
          s->ssl_fatal_error = 1;
        }
        ssl_close(s, 0, NULL);
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
      s = us_dispatch_data(s, loop_ssl_data->ssl_read_output + LIBUS_RECV_BUFFER_PADDING, read);
      if (!s || ssl_gone(s)) return NULL;
      read = 0;
      goto restart;
    }
  }

  /* If the last SSL_write failed with WANT_READ and we've now read, give the
   * application a writable callback — but not if SSL_read just told us it
   * needs to write first (would recurse). Re-check s->ssl: any dispatch above may
   * have closed and freed s->ssl. */
  if (ssl_gone(s)) return NULL;
  if (s->ssl_write_wants_read && !s->ssl_read_wants_write) {
    s->ssl_write_wants_read = 0;
    s = us_internal_ssl_on_writable(s);
    if (!s || ssl_gone(s)) return NULL;
  }

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

    struct loop_ssl_data *loop_ssl_data = (struct loop_ssl_data *)s->group->loop->data.ssl_data;

  loop_ssl_data->ssl_read_input_length = 0;
  loop_ssl_data->ssl_socket = s;

  int written = SSL_write(s_ssl(s), data, length);
  if (written > 0) return written;

  int err = SSL_get_error(s_ssl(s), written);
  if (err == SSL_ERROR_WANT_READ) {
    s->ssl_write_wants_read = 1;
  } else if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
    ERR_clear_error();
    s->ssl_fatal_error = 1;
  }
  return 0;
}

void us_internal_ssl_shutdown(struct us_socket_t *s) {
  if (us_socket_is_closed(s) || us_internal_ssl_is_shut_down(s)) return;

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

void us_internal_ssl_handshake_abort(struct us_socket_t *s) {
  s->ssl_fatal_error = 1;
  ssl_close(s, 0, NULL);
}

/* ── Adopt-TLS (STARTTLS / Bun.connect upgrade) ──────────────────────────── */

struct us_socket_t *us_socket_adopt_tls(struct us_socket_t *s,
                                        struct us_socket_group_t *group,
                                        unsigned char kind, struct ssl_ctx_st *ssl_ctx,
                                        const char *sni, int old_ext_size,
                                        int ext_size) {
  if (us_socket_is_closed(s)) return NULL;

  struct us_socket_t *new_s = us_socket_adopt(s, group, kind, old_ext_size, ext_size);
  if (!new_s) return NULL;

  us_internal_ssl_attach(new_s, ssl_ctx, /*is_client*/1, sni, NULL);
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
  struct sni_node_t *node = (struct sni_node_t *)sni_find(ls->sni, hostname);
  if (!node) {
    if (!ls->on_server_name) return NULL;
    ls->on_server_name(ls, hostname);
    node = (struct sni_node_t *)sni_find(ls->sni, hostname);
  }
  return node;
}

static int sni_cb(SSL *ssl, int *al, void *arg) {
  (void)al; (void)arg;
  if (!ssl || us_ssl_listener_ex_idx < 0) return SSL_TLSEXT_ERR_NOACK;
  /* The listener is per-SSL (set at accept), not the CTX-level arg — the
   * SSL_CTX is shared and may outlive any one listener. */
  struct us_listen_socket_t *ls =
      (struct us_listen_socket_t *)SSL_get_ex_data(ssl, us_ssl_listener_ex_idx);
  if (!ls) return SSL_TLSEXT_ERR_OK;
  const char *hostname = SSL_get_servername(ssl, TLSEXT_NAMETYPE_host_name);
  if (hostname && hostname[0]) {
    struct sni_node_t *node = resolve_listener_ctx(ls, hostname);
    if (node) SSL_set_SSL_CTX(ssl, node->ctx);
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
  if (us_sni_ex_idx < 0)
    us_sni_ex_idx = SSL_CTX_get_ex_new_index(0, NULL, NULL, NULL, NULL);
  SSL_CTX_set_ex_data(ctx, us_sni_ex_idx, user);

  if (sni_add(ls->sni, hostname_pattern, node)) {
    sni_node_destructor(node);
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

void us_listen_socket_on_server_name(struct us_listen_socket_t *ls,
                                     void (*cb)(struct us_listen_socket_t *, const char *)) {
  ls->on_server_name = cb;
}

void *us_socket_server_name_userdata(struct us_socket_t *s) {
  if (!s->ssl || !s_ssl(s) || us_sni_ex_idx < 0) return NULL;
  return SSL_CTX_get_ex_data(SSL_get_SSL_CTX(s_ssl(s)), us_sni_ex_idx);
}

void *us_internal_ssl_sni_userdata(struct us_socket_t *s) {
  return us_socket_server_name_userdata(s);
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
