// MSVC doesn't support C11 stdatomic.h propertly yet.
// so we use C++ std::atomic instead.
#include "./root_certs.h"
#include "./root_certs_header.h"
#include "./internal/internal.h"
#include <atomic>
#include <string.h>
static const int root_certs_size = sizeof(root_certs) / sizeof(root_certs[0]);

extern "C" void BUN__warn__extra_ca_load_failed(const char* filename, const char* error_msg);

// This callback is used to avoid the default passphrase callback in OpenSSL
// which will typically prompt for the passphrase. The prompting is designed
// for the OpenSSL CLI, but works poorly for this case because it involves
// synchronous interaction with the controlling terminal, something we never
// want, and use this function to avoid it.
int us_no_password_callback(char *buf, int size, int rwflag, void *u) {
  return 0;
}

static X509 *
us_ssl_ctx_get_X509_without_callback_from(struct us_cert_string_t content) {
  X509 *x = NULL;
  BIO *in;

  ERR_clear_error(); // clear error stack for SSL_CTX_use_certificate()

  in = BIO_new_mem_buf(content.str, content.len);
  if (in == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_BUF_LIB);
  } else {
    x = PEM_read_bio_X509(in, NULL, us_no_password_callback, NULL);
    if (x == NULL) {
      OPENSSL_PUT_ERROR(SSL, ERR_R_PEM_LIB);
    }

    // NOTE: PEM_read_bio_X509 allocates, so input BIO must be freed.
    BIO_free(in);
  }
  return x;
}

static STACK_OF(X509) *us_ssl_ctx_load_all_certs_from_file(const char *filename) {
  BIO *in = NULL;
  STACK_OF(X509) *certs = NULL;
  X509 *x = NULL;
  unsigned long last_err;

  ERR_clear_error(); // clear error stack for SSL_CTX_use_certificate()

  in = BIO_new_file(filename, "r");
  if (in == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_SYS_LIB);
    goto end;
  }

  certs = sk_X509_new_null();
  if (certs == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_MALLOC_FAILURE);
    goto end;
  }

  while ((x = PEM_read_bio_X509(in, NULL, us_no_password_callback, NULL))) {
    if (!sk_X509_push(certs, x)) {
      OPENSSL_PUT_ERROR(SSL, ERR_R_MALLOC_FAILURE);
      X509_free(x);
      goto end;
    }
  }

  last_err = ERR_peek_last_error();
  // Ignore error if its EOF/no start line found.
  if (ERR_GET_LIB(last_err) == ERR_LIB_PEM && ERR_GET_REASON(last_err) == PEM_R_NO_START_LINE) {
    ERR_clear_error();
  } else {
    goto end;
  }

  if (sk_X509_num(certs) == 0) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_PEM_LIB);
    goto end;
  }

  BIO_free(in);
  return certs;

end:
  BIO_free(in);
  if (certs) {
    sk_X509_pop_free(certs, X509_free);
  }

  char error_msg[256];
  ERR_error_string_n(ERR_peek_last_error(), error_msg, sizeof(error_msg));
  BUN__warn__extra_ca_load_failed(filename, error_msg);
  ERR_clear_error();

  return NULL;
}

static void us_internal_init_root_certs(
    X509 *root_cert_instances[root_certs_size],
    STACK_OF(X509) *&root_extra_cert_instances) {
  static std::atomic_flag root_cert_instances_lock = ATOMIC_FLAG_INIT;
  static std::atomic_bool root_cert_instances_initialized = 0;

  if (std::atomic_load(&root_cert_instances_initialized) == 1)
    return;

  while (atomic_flag_test_and_set_explicit(&root_cert_instances_lock,
                                           std::memory_order_acquire))
    ;

  if (!atomic_exchange(&root_cert_instances_initialized, 1)) {
    for (size_t i = 0; i < root_certs_size; i++) {
      root_cert_instances[i] =
          us_ssl_ctx_get_X509_without_callback_from(root_certs[i]);
    }

    // get extra cert option from environment variable
    const char *extra_certs = getenv("NODE_EXTRA_CA_CERTS");
    if (extra_certs && extra_certs[0]) {
      root_extra_cert_instances = us_ssl_ctx_load_all_certs_from_file(extra_certs);
    }
  }

  atomic_flag_clear_explicit(&root_cert_instances_lock,
                             std::memory_order_release);
}

extern "C" int us_internal_raw_root_certs(struct us_cert_string_t **out) {
  *out = root_certs;
  return root_certs_size;
}

struct us_default_ca_certificates {
  X509 *root_cert_instances[root_certs_size];
  STACK_OF(X509) *root_extra_cert_instances;
};

us_default_ca_certificates* us_get_default_ca_certificates() {
  static us_default_ca_certificates default_ca_certificates = {{NULL}, NULL};

  us_internal_init_root_certs(default_ca_certificates.root_cert_instances, default_ca_certificates.root_extra_cert_instances);

  return &default_ca_certificates;
}

STACK_OF(X509) *us_get_root_extra_cert_instances() {
  return us_get_default_ca_certificates()->root_extra_cert_instances;
}

extern "C" X509_STORE *us_get_default_ca_store() {
  X509_STORE *store = X509_STORE_new();
  if (store == NULL) {
    return NULL;
  }

  if (!X509_STORE_set_default_paths(store)) {
    X509_STORE_free(store);
    return NULL;
  }

  us_default_ca_certificates *default_ca_certificates = us_get_default_ca_certificates();
  X509** root_cert_instances = default_ca_certificates->root_cert_instances;
  STACK_OF(X509) *root_extra_cert_instances = default_ca_certificates->root_extra_cert_instances;

  // load all root_cert_instances on the default ca store
  for (size_t i = 0; i < root_certs_size; i++) {
    X509 *cert = root_cert_instances[i];
    if (cert == NULL)
      continue;
    X509_up_ref(cert);
    X509_STORE_add_cert(store, cert);
  }

  if (root_extra_cert_instances) {
    for (int i = 0; i < sk_X509_num(root_extra_cert_instances); i++) {
      X509 *cert = sk_X509_value(root_extra_cert_instances, i);
      X509_up_ref(cert);
      X509_STORE_add_cert(store, cert);
    }
  }

  return store;
}
