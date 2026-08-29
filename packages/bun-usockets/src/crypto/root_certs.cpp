#include "./root_certs.h"
#include "./root_certs_header.h"
#include "./internal/internal.h"
#include <mutex>
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
extern "C" int us_no_password_callback(char *buf, int size, int rwflag, void *u) {
  return 0;
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

// The bundled Mozilla roots, indexed by subject but not parsed: BoringSSL
// parses one the first time a chain names it (X509_LAZY_CERT_SET, oven-sh/boringssl).
X509_LAZY_CERT_SET *us_get_bundled_root_cert_set() {
  static X509_LAZY_CERT_SET *set = nullptr;
  static std::once_flag once;
  std::call_once(once, []() {
    set = X509_LAZY_CERT_SET_new_static(kBundledRootCerts, kBundledRootCertLens,
                                        BUNDLED_ROOT_CERT_COUNT);
  });
  return set;
}

extern "C" size_t us_bundled_root_certs_der(const uint8_t *const **out_certs,
                                           const size_t **out_lens) {
  *out_certs = kBundledRootCerts;
  *out_lens = kBundledRootCertLens;
  return BUNDLED_ROOT_CERT_COUNT;
}

// std::call_once, not a flag: concurrent Workers must block until the list is
// fully parsed rather than observe a half-built STACK_OF(X509).
STACK_OF(X509) *us_get_root_extra_cert_instances() {
  const char *extra_certs = getenv("NODE_EXTRA_CA_CERTS");
  if (!extra_certs || !extra_certs[0]) return nullptr;
  static STACK_OF(X509) *root_extra_cert_instances = nullptr;
  static std::once_flag once;
  std::call_once(once, [&]() {
    root_extra_cert_instances = us_ssl_ctx_load_all_certs_from_file(extra_certs);
  });
  return root_extra_cert_instances;
}

// Single source of truth for the OS trust store. Loaded on first demand,
// independent of --use-system-ca / NODE_USE_SYSTEM_CA, so that
// tls.getCACertificates('system') matches Node.js (which always reads the
// system store for 'system'). The flag still gates whether these are merged
// into the *default* store used for connections — see us_get_default_ca_store.
STACK_OF(X509) *us_get_root_system_cert_instances() {
  static STACK_OF(X509) *system_certs = nullptr;
  static std::once_flag once;
  std::call_once(once, []() {
#ifdef __APPLE__
    us_load_system_certificates_macos(&system_certs);
#elif defined(_WIN32)
    us_load_system_certificates_windows(&system_certs);
#else
    us_load_system_certificates_linux(&system_certs);
#endif
  });
  return system_certs;
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

  X509_LAZY_CERT_SET *bundled = us_get_bundled_root_cert_set();
  if (bundled == NULL || !X509_STORE_add_lazy_cert_set(store, bundled)) {
    X509_STORE_free(store);
    return NULL;
  }

  STACK_OF(X509) *root_extra_cert_instances = us_get_root_extra_cert_instances();
  if (root_extra_cert_instances) {
    for (int i = 0; i < sk_X509_num(root_extra_cert_instances); i++) {
      X509 *cert = sk_X509_value(root_extra_cert_instances, i);
      X509_up_ref(cert);
      X509_STORE_add_cert(store, cert);
    }
  }

  if (us_should_use_system_ca()) {
    STACK_OF(X509) *root_system_cert_instances = us_get_root_system_cert_instances();
    if (root_system_cert_instances) {
      for (int i = 0; i < sk_X509_num(root_system_cert_instances); i++) {
        X509 *cert = sk_X509_value(root_system_cert_instances, i);
        X509_up_ref(cert);
        X509_STORE_add_cert(store, cert);
      }
    }
  }

  return store;
}

// Process-wide immutable default store. Safe to share across SSL_CTXs that
// don't add per-config CAs (the user-`ca` path in build_raw populates the
// SSL_CTX's own private, initially-empty store instead), so roots parsed for
// one connection's chain are already there for the next.
extern "C" X509_STORE *us_get_shared_default_ca_store() {
  static X509_STORE *shared = nullptr;
  static std::once_flag once;
  std::call_once(once, []() { shared = us_get_default_ca_store(); });
  if (shared) X509_STORE_up_ref(shared);
  return shared;
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