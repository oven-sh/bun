#pragma once

#include <openssl/pem.h>
#include <openssl/sha.h>
#include <openssl/x509.h>

#ifdef __cplusplus
#define CPPDECL extern "C"

#include <array>
#include <vector>

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

using us_sha256_digest = std::array<uint8_t, SHA256_DIGEST_LENGTH>;

// SHA-256 of a DER certificate as X509_digest computes it. False when BoringSSL does not parse it.
bool us_x509_der_digest(const uint8_t *der, size_t len, us_sha256_digest &digest);

// The certificates the OS refuses at any position of a chain, by us_x509_der_digest, sorted. Null unless the OS trust
// store is in use (--use-system-ca, NODE_USE_SYSTEM_CA=1). Windows fills it from its Disallowed stores. No other
// platform fills it yet: macOS only drops a denied anchor when it loads the keychain (root_certs_darwin.cpp), so a
// denied bundled root, intermediate or leaf still verifies there, and the p11-kit blocklist of a Linux bundle is not
// read.
const std::vector<us_sha256_digest> *us_system_distrusted_certs();

#else
#define CPPDECL extern
#endif

CPPDECL X509_STORE *us_get_default_ca_store();
CPPDECL X509_STORE *us_get_shared_default_ca_store();

// blocked_spkis.cpp
// After X509_verify_cert: X509_V_OK, or the error of a chain that holds a blocked public key or a certificate the OS
// distrusts.
CPPDECL int us_x509_store_ctx_distrust_error(X509_STORE_CTX *ctx);
// `hash` is SHA256_DIGEST_LENGTH bytes.
CPPDECL void us_add_blocked_spki_for_testing(const uint8_t *hash);
CPPDECL void us_clear_blocked_spkis_for_testing();
// `der` is a DER certificate. It joins the certificates the OS distrusts, on every platform. 0 when it is not one.
CPPDECL int us_add_distrusted_cert_for_testing(const uint8_t *der, size_t len);
CPPDECL void us_clear_distrusted_certs_for_testing();
