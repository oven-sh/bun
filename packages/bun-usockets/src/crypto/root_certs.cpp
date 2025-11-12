// MSVC doesn't support C11 stdatomic.h propertly yet.
// so we use C++ std::atomic instead.
#include "./root_certs.h"
#include "./root_certs_header.h"
#include "./internal/internal.h"
#include <atomic>
#include <string.h>
#include "./default_ciphers.h"

// System-specific includes for certificate loading
#include "./root_certs_platform.h"
#ifdef _WIN32
#include <windows.h>
#include <wincrypt.h>
#else
// Linux/Unix includes
#include <dirent.h>
#include <stdio.h>
#include <limits.h>
#endif
static const int root_certs_size = sizeof(root_certs) / sizeof(root_certs[0]);

extern "C" void BUN__warn__extra_ca_load_failed(const char* filename, const char* error_msg);

// Forward declarations for platform-specific functions
// (Actual implementations are in platform-specific files)

// External variable from Zig CLI arguments
extern "C" bool Bun__Node__UseSystemCA;

// Helper function to check if system CA should be used
// Checks both CLI flag (--use-system-ca) and environment variable (NODE_USE_SYSTEM_CA=1)
static bool us_should_use_system_ca() {
  // Check CLI flag first
  if (Bun__Node__UseSystemCA) {
    return true;
  }
  
  // Check environment variable
  const char *use_system_ca = getenv("NODE_USE_SYSTEM_CA");
  return use_system_ca && strcmp(use_system_ca, "1") == 0;
}

// Platform-specific system certificate loading implementations are separated:
// - macOS: root_certs_darwin.cpp (Security framework with dynamic loading)
// - Windows: root_certs_windows.cpp (Windows CryptoAPI)
// - Linux/Unix: us_load_system_certificates_linux() below

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
    STACK_OF(X509) *&root_extra_cert_instances,
    STACK_OF(X509) *&root_system_cert_instances) {
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

    // load system certificates if NODE_USE_SYSTEM_CA=1
    if (us_should_use_system_ca()) {
#ifdef __APPLE__
      us_load_system_certificates_macos(&root_system_cert_instances);
#elif defined(_WIN32)
      us_load_system_certificates_windows(&root_system_cert_instances);
#else
      us_load_system_certificates_linux(&root_system_cert_instances);
#endif
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
  STACK_OF(X509) *root_system_cert_instances;
};

us_default_ca_certificates* us_get_default_ca_certificates() {
  static us_default_ca_certificates default_ca_certificates = {{NULL}, NULL, NULL};

  us_internal_init_root_certs(default_ca_certificates.root_cert_instances, 
                              default_ca_certificates.root_extra_cert_instances,
                              default_ca_certificates.root_system_cert_instances);

  return &default_ca_certificates;
}

STACK_OF(X509) *us_get_root_extra_cert_instances() {
  return us_get_default_ca_certificates()->root_extra_cert_instances;
}

STACK_OF(X509) *us_get_root_system_cert_instances() {
  // Ensure single-path initialization via us_internal_init_root_certs
  auto certs = us_get_default_ca_certificates();
  return certs->root_system_cert_instances;
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
  STACK_OF(X509) *root_system_cert_instances = default_ca_certificates->root_system_cert_instances;

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

  if (us_should_use_system_ca() && root_system_cert_instances) {
    for (int i = 0; i < sk_X509_num(root_system_cert_instances); i++) {
      X509 *cert = sk_X509_value(root_system_cert_instances, i);
      X509_up_ref(cert);
      X509_STORE_add_cert(store, cert);
    }
  }

  return store;
}
extern "C" const char *us_get_default_ciphers() {
  return DEFAULT_CIPHER_LIST;
}

// Platform-specific implementations for loading system certificates

#if defined(_WIN32)
// Windows implementation is split to avoid header conflicts:
// - root_certs_windows.cpp loads raw certificate data (uses Windows headers)
// - This file converts raw data to X509* (uses OpenSSL headers)

#include <vector>

struct RawCertificate {
  std::vector<unsigned char> data;
};

// Defined in root_certs_windows.cpp - loads raw certificate data
extern void us_load_system_certificates_windows_raw(
    std::vector<RawCertificate>& raw_certs);

// Convert raw Windows certificates to OpenSSL X509 format
void us_load_system_certificates_windows(STACK_OF(X509) **system_certs) {
  *system_certs = sk_X509_new_null();
  if (*system_certs == NULL) {
    return;
  }
  
  // Load raw certificates from Windows stores
  std::vector<RawCertificate> raw_certs;
  us_load_system_certificates_windows_raw(raw_certs);
  
  // Convert each raw certificate to X509
  for (const auto& raw_cert : raw_certs) {
    const unsigned char* data = raw_cert.data.data();
    X509* x509_cert = d2i_X509(NULL, &data, raw_cert.data.size());
    if (x509_cert != NULL) {
      sk_X509_push(*system_certs, x509_cert);
    }
  }
}

#else
// Linux and other Unix-like systems - implementation is in root_certs_linux.cpp
extern "C" void us_load_system_certificates_linux(STACK_OF(X509) **system_certs);
#endif