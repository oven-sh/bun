#pragma once

#include <openssl/pem.h>
#include <openssl/sha.h>
#include <openssl/ssl.h>
#include <openssl/x509.h>

#ifdef __cplusplus
#include "../libusockets.h"

#include <cstdlib>
#include <memory>

#define CPPDECL extern "C"

// bssl::UniquePtr, which BORINGSSL_NO_CXX (Windows) leaves out.
template <auto free_fn> struct us_deleter {
  void operator()(auto *ptr) const { free_fn(ptr); }
};
template <typename T, auto free_fn> using us_unique_ptr = std::unique_ptr<T, us_deleter<free_fn>>;

// Leaves `buffer` as it was when there is no memory.
template <typename T> bool us_grow(us_unique_ptr<T, us_free> &buffer, size_t size) {
  auto *grown = (decltype(buffer.get()))us_realloc(buffer.get(), size);
  if (!grown) return false;
  buffer.release();
  buffer.reset(grown);
  return true;
}

using us_ssl_ctx_ptr = us_unique_ptr<SSL_CTX, SSL_CTX_free>;

inline void us_x509_stack_free(STACK_OF(X509) *certs) { sk_X509_pop_free(certs, X509_free); }
using us_x509_stack_ptr = us_unique_ptr<STACK_OF(X509), us_x509_stack_free>;

STACK_OF(X509) *us_get_root_extra_cert_instances();
X509_LAZY_CERT_SET *us_get_bundled_root_cert_set();

// The OS trust store. Platforms that hand us DER (Linux and other Unix) index it lazily; those whose trust evaluation
// needs the parsed certificate (macOS) or that are not yet converted (Windows) hand back parsed X509s. Either may be
// null/empty.
struct us_system_certs_t {
  X509_LAZY_CERT_SET *lazy = nullptr;
  STACK_OF(X509) *parsed = nullptr;
};
const us_system_certs_t &us_get_root_system_certs();

// src/runtime/socket/cert_files.rs
typedef void (*us_on_cert_file)(void *ctx, const uint8_t *data, size_t len);
extern "C" int Bun__readCertificateFile(const char *path, void *ctx, us_on_cert_file on_file);

// ca_pem.cpp. The BIOs are read-only memory BIOs.

// Whether TRUSTED CERTIFICATE blocks, and what follows a certificate in its block, are read as by the _AUX functions.
enum class us_ca_trust { ignored, read };

struct us_pem_block {
  char *name = nullptr, *header = nullptr;
  uint8_t *data = nullptr;
  long len = 0;
  // What was left of the document ahead of the block.
  const uint8_t *text = nullptr;
  size_t text_len = 0;
  ~us_pem_block() {
    OPENSSL_free(name);
    OPENSSL_free(header);
    OPENSSL_free(data);
  }
  // PEM_read_bio, past the byte order mark that OpenSSL ignores ahead of a block.
  bool read(BIO *in);
  bool is(const char *label) const;
  bool is_plain_certificate() const;
  // With an empty passphrase, if it has a header.
  bool decrypt();
  // Fails for a certificate that BoringSSL is too strict for, which is malformed if OpenSSL does not read it either.
  // `out_der`, if not NULL, gets the encoding for an X509_LAZY_CERT_SET.
  X509 *parse_ca(us_ca_trust trust, CRYPTO_BUFFER **out_der, bool *out_malformed);
  // The same without the parse, so a malformed validity, key or extension goes unnoticed.
  size_t indexable_ca_len(bool *out_malformed);
  X509_CRL *parse_crl();
};

// A PEM_read_bio_X509 or PEM_read_bio_X509_AUX loop that ends where the one of OpenSSL does.
struct us_ca_reader {
  BIO *in;
  us_ca_trust trust;
  // A certificate that only OpenSSL reads.
  bool passed_over = false;
  X509 *next(CRYPTO_BUFFER **out_der = nullptr);
};

#else
#define CPPDECL extern
#endif

// us_ca_reader without trust settings and without the parse, for an X509_LAZY_CERT_SET. Release with OPENSSL_free.
CPPDECL uint8_t *us_pem_read_indexable_ca(BIO *in, size_t *out_len);
// `names`, if not NULL, asks clients for certificates from them. Returns 0 when there is no memory.
CPPDECL int us_x509_store_add_cas(X509_STORE *store, SSL_CTX *names, const char *pem, size_t len);
// Also turns CRL checking on. Returns 0 if there is no CRL, or a malformed block.
CPPDECL int us_x509_store_add_crls(X509_STORE *store, const char *pem, size_t len);

CPPDECL X509_STORE *us_get_default_ca_store();
CPPDECL X509_STORE *us_get_shared_default_ca_store();

// blocked_spkis.cpp
// After X509_verify_cert: X509_V_OK, or the error of a chain that holds a blocked public key.
CPPDECL int us_x509_store_ctx_blocked_key_error(X509_STORE_CTX *ctx);
// `hash` is SHA256_DIGEST_LENGTH bytes.
CPPDECL void us_add_blocked_spki_for_testing(const uint8_t *hash);
CPPDECL void us_clear_blocked_spkis_for_testing();
