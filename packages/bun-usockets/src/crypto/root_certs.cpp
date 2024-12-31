// MSVC doesn't support C11 stdatomic.h propertly yet.
// so we use C++ std::atomic instead.
#include "./root_certs.h"
#include "./internal/internal.h"
#include <atomic>
#include <openssl/pem.h>
#include <openssl/x509.h>
#include <string.h>
static const int root_certs_size = sizeof(root_certs) / sizeof(root_certs[0]);

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
    goto end;
  }

  x = PEM_read_bio_X509(in, NULL, us_no_password_callback, NULL);
  if (x == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_PEM_LIB);
    goto end;
  }

  // NOTE: PEM_read_bio_X509 allocates, so input BIO must be freed.
  BIO_free(in);
  return x;
end:
  X509_free(x);
  BIO_free(in);
  return NULL;
}

static X509 *
us_ssl_ctx_get_X509_without_callback_from_file(const char *filename) {
  X509 *x = NULL;
  BIO *in;

  ERR_clear_error(); // clear error stack for SSL_CTX_use_certificate()

  in = BIO_new(BIO_s_file());
  if (in == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_BUF_LIB);
    goto end;
  }

  if (BIO_read_filename(in, filename) <= 0) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_SYS_LIB);
    goto end;
  }

  x = PEM_read_bio_X509(in, NULL, us_no_password_callback, NULL);
  if (x == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_PEM_LIB);
    goto end;
  }
  return x;
end:
  X509_free(x);
  BIO_free(in);
  return NULL;
}

static void us_internal_init_root_certs(X509 *root_cert_instances[sizeof(root_certs) / sizeof(root_certs[0])], X509 *&root_extra_cert_instances) {
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
    const char *extra_cert = getenv("NODE_EXTRA_CA_CERTS");
    if (extra_cert) {
      size_t length = strlen(extra_cert);
      if (length > 0) {
        root_extra_cert_instances =
            us_ssl_ctx_get_X509_without_callback_from_file(extra_cert);
      }
    }
  }

  atomic_flag_clear_explicit(&root_cert_instances_lock,
                             std::memory_order_release);
}

extern "C" int us_internal_raw_root_certs(struct us_cert_string_t **out) {
  *out = root_certs;
  return root_certs_size;
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

  static X509 *root_cert_instances[sizeof(root_certs) / sizeof(root_certs[0])] = {
    NULL};
  static X509 *root_extra_cert_instances = NULL;

  us_internal_init_root_certs(root_cert_instances, root_extra_cert_instances);

  // load all root_cert_instances on the default ca store
  for (size_t i = 0; i < root_certs_size; i++) {
    X509 *cert = root_cert_instances[i];
    if (cert == NULL)
      continue;
    X509_up_ref(cert);
    X509_STORE_add_cert(store, cert);
  }

  if (root_extra_cert_instances) {
    X509_up_ref(root_extra_cert_instances);
    X509_STORE_add_cert(store, root_extra_cert_instances);
  }

  return store;
}
