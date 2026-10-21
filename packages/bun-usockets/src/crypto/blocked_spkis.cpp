// Port of https://github.com/nodejs/node/blob/d9a3f3d150f7959f2d448d9a61aa11f5a75aa2b3/src/crypto/crypto_context.cc#L1399-L1604
#include "./root_certs_header.h"
#include <openssl/evp.h>
#include <openssl/ssl.h>
#include <array>
#include <mutex>
#include <string.h>
#include <vector>

using us_spki_hash = std::array<uint8_t, US_SPKI_HASH_LENGTH>;

// SHA-256 of the DER SubjectPublicKeyInfo (what i2d_X509_PUBKEY produces) of the keys no chain may hold, whatever the
// trust store says. The list is node's. Above each entry: fingerprint and subject of a certificate carrying the key.
static constexpr us_spki_hash us_blocked_spkis[] = {
    // 0164d7ceae5bb909c272af151ff44b1177ae9b47d9424b94f1d9558c30934d19
    // C=US, O=eMudhra Inc, CN=EM DV TLS CA - G3C
    {0x49, 0xdd, 0x35, 0x3d, 0xc2, 0xb9, 0x19, 0xa3, 0x77, 0x06, 0x45,
     0x11, 0x7d, 0x0e, 0x60, 0xc1, 0x61, 0x15, 0xe7, 0xd1, 0xbc, 0x25,
     0x9e, 0xef, 0xe7, 0x34, 0xb0, 0x0e, 0xa4, 0x34, 0xfe, 0x5f},
    // 432ec25f0d28de9006d97bf752f17bbb2cd41f669933fcb072d9a1148d0261f3
    // C=US, O=eMudhra Inc, CN=EM EV TLS CA - G3C
    {0x5c, 0x06, 0x60, 0xa2, 0xb1, 0x64, 0x91, 0x0d, 0x8f, 0xf5, 0x89,
     0xc1, 0x8e, 0x14, 0x55, 0x2e, 0x9e, 0x0e, 0xc2, 0x37, 0xdc, 0xef,
     0xe2, 0xcb, 0x73, 0x6d, 0x41, 0xa4, 0x81, 0x1f, 0x81, 0xa0},
    // cb6e15165ac802e9b3f993f16c25d41f4e81c21ebde71ae1b012ac00bf9c7c3f
    // C=US, O=eMudhra Inc, CN=EM OV TLS CA - G3C
    {0x63, 0xec, 0xef, 0xee, 0x43, 0x1d, 0x49, 0x52, 0x3b, 0xc1, 0x13,
     0x6c, 0x4e, 0x72, 0xd0, 0x20, 0x6a, 0x47, 0x70, 0x86, 0xca, 0xf6,
     0x06, 0xcd, 0x5c, 0xf0, 0x25, 0x68, 0x6c, 0x10, 0x9c, 0xf8},
    // 4b2460a466f95fd40113bcdcca2ceb29b3b093921de45474da7df48874c630b1
    // C=US, O=eMudhra Inc, CN=EM OV CS CA - G3C
    {0x92, 0xc0, 0x63, 0xd6, 0x7e, 0x8f, 0x14, 0xdb, 0x71, 0xd2, 0x88,
     0xe1, 0x12, 0x66, 0xff, 0xda, 0xf6, 0x9c, 0xbf, 0x11, 0x5f, 0x7b,
     0xab, 0x14, 0xf3, 0xbc, 0x2f, 0x68, 0xd2, 0x5e, 0x0e, 0x30},
    // 42c4accd12c4f59597925e1a08a7a90102608543809308d50ec427e118ba1493
    // C=NL, O=eMudhra BV, CN=EM DV TLS CA - G3B
    {0xeb, 0xed, 0x64, 0x75, 0xc2, 0xc2, 0xd8, 0x0f, 0xcb, 0x19, 0x9f,
     0x3f, 0xe8, 0xdd, 0x6e, 0x6b, 0x3c, 0xe6, 0x0b, 0x77, 0xeb, 0x15,
     0xd4, 0xe4, 0x2c, 0x3d, 0xec, 0x0c, 0x6f, 0x5b, 0x51, 0x05},
    // 9e39de2881273acc225a149c72ba3e0f51424963669ab633ee1dc7df5db067b4
    // C=NL, O=eMudhra BV, CN=EM OV CS CA - G3B
    {0xec, 0x4f, 0xfa, 0x1a, 0xd0, 0xac, 0x88, 0x08, 0x13, 0x14, 0xb7,
     0xaa, 0xff, 0xef, 0x6a, 0x91, 0xf9, 0x7c, 0xd5, 0x72, 0x91, 0xbb,
     0x5b, 0xa6, 0x86, 0xc5, 0x41, 0x5f, 0x5e, 0xb4, 0xf6, 0xb6},
    // 98b896625c0c230adeec3eb2cf6aad5001ecf9156a68644e82374ce5833bc25b
    // C=NL, O=eMudhra BV, CN=EM OV TLS CA - G3B
    {0x43, 0xbf, 0xfa, 0x19, 0xd6, 0xef, 0x65, 0x14, 0x51, 0xf6, 0x84,
     0x1e, 0x01, 0x99, 0x31, 0xe9, 0x6f, 0x6f, 0x2e, 0xae, 0xff, 0x28,
     0xab, 0x4b, 0x6f, 0x1c, 0xe4, 0x57, 0x6d, 0xe2, 0x71, 0x7b},
    // e7568fe6e12331f4fd7de61da4c7559d0f8eb192a218d4741a3ba75184333838
    // C=NL, O=eMudhra BV, CN=EM EV TLS CA - G3B
    {0xe0, 0x25, 0x4c, 0x7f, 0xcd, 0xc2, 0x65, 0xe2, 0xf0, 0xf8, 0xa4,
     0x28, 0xda, 0xbb, 0x75, 0xab, 0x4a, 0xe0, 0x39, 0xb4, 0x87, 0x2d,
     0x62, 0xf5, 0xee, 0x57, 0xf0, 0x87, 0x7d, 0x5a, 0x8a, 0x41},
};

// The test-only list is process-wide and handshakes run on several threads, so every access takes the mutex.
static std::mutex &us_blocked_spkis_for_testing_mutex() {
  static std::mutex mutex;
  return mutex;
}

static std::vector<us_spki_hash> &us_blocked_spkis_for_testing() {
  static std::vector<us_spki_hash> list;
  return list;
}

static bool us_is_blocked_spki_for_testing(const us_spki_hash &digest) {
  std::lock_guard<std::mutex> lock(us_blocked_spkis_for_testing_mutex());
  for (const us_spki_hash &blocked : us_blocked_spkis_for_testing()) {
    if (digest == blocked) return true;
  }
  return false;
}

enum class us_spki_check { allowed, blocked, error };

// A failure to encode or hash is an error, not allowed, so that it cannot slip a certificate past the check.
static us_spki_check us_check_spki(X509 *cert) {
  uint8_t *spki = nullptr;
  int spki_len = i2d_X509_PUBKEY(X509_get_X509_PUBKEY(cert), &spki);
  if (spki_len <= 0) return us_spki_check::error;
  us_spki_hash digest;
  unsigned int digest_len = 0;
  int ok = EVP_Digest(spki, static_cast<size_t>(spki_len), digest.data(), &digest_len, EVP_sha256(), nullptr);
  OPENSSL_free(spki);
  if (ok != 1 || digest_len != digest.size()) return us_spki_check::error;
  for (const us_spki_hash &blocked : us_blocked_spkis) {
    if (digest == blocked) return us_spki_check::blocked;
  }
  if (us_is_blocked_spki_for_testing(digest)) return us_spki_check::blocked;
  return us_spki_check::allowed;
}

static us_spki_check us_check_spkis(const STACK_OF(X509) *certs) {
  for (size_t i = 0; i < sk_X509_num(certs); i++) {
    us_spki_check result = us_check_spki(sk_X509_value(certs, i));
    if (result != us_spki_check::allowed) return result;
  }
  return us_spki_check::allowed;
}

// The built chain is always checked. When verification did not fully succeed (the per-certificate callbacks continue
// past errors so that JS can apply rejectUnauthorized), so are the leaf and everything the peer sent: a blocked key
// takes precedence over the original error. The per-certificate callback decides whether the handshake continues.
int us_verify_cert_chain(X509_STORE_CTX *ctx) {
  int ok = X509_verify_cert(ctx) > 0 ? 1 : 0;
  const bool verified = ok == 1 && X509_STORE_CTX_get_error(ctx) == X509_V_OK;

  us_spki_check result = us_check_spkis(X509_STORE_CTX_get0_chain(ctx));
  if (result == us_spki_check::allowed && !verified) {
    result = us_check_spki(X509_STORE_CTX_get0_cert(ctx));
    if (result == us_spki_check::allowed) result = us_check_spkis(X509_STORE_CTX_get0_untrusted(ctx));
  }
  if (result == us_spki_check::allowed) return ok;

  X509_STORE_CTX_set_error(ctx, result == us_spki_check::blocked ? X509_V_ERR_CERT_REVOKED : X509_V_ERR_UNSPECIFIED);
  SSL *ssl = static_cast<SSL *>(X509_STORE_CTX_get_ex_data(ctx, SSL_get_ex_data_X509_STORE_CTX_idx()));
  auto verify_cb = ssl != nullptr ? SSL_get_verify_callback(ssl) : nullptr;
  if (verify_cb == nullptr) return 0;
  return verify_cb(0, ctx) ? 1 : 0;
}

static int us_verify_cert_chain_cb(X509_STORE_CTX *ctx, void *) {
  return us_verify_cert_chain(ctx);
}

void us_ssl_ctx_install_cert_verify_callback(SSL_CTX *ctx) {
  SSL_CTX_set_cert_verify_callback(ctx, us_verify_cert_chain_cb, nullptr);
}

void us_add_blocked_spki_for_testing(const uint8_t *hash) {
  us_spki_hash entry;
  memcpy(entry.data(), hash, entry.size());
  std::lock_guard<std::mutex> lock(us_blocked_spkis_for_testing_mutex());
  us_blocked_spkis_for_testing().push_back(entry);
}

void us_clear_blocked_spkis_for_testing() {
  std::lock_guard<std::mutex> lock(us_blocked_spkis_for_testing_mutex());
  us_blocked_spkis_for_testing().clear();
}
