#ifndef _WIN32
#ifndef __APPLE__

#include "libusockets.h"
#include <stdint.h>
#include <openssl/err.h>
#include <openssl/x509.h>

// src/runtime/socket/system_certs.rs reads the store (environment, directories, files, PEM, duplicates) and hands each
// distinct certificate's DER encoding to the callback. Only the DER to X509 step needs BoringSSL.
extern "C" void Bun__forEachSystemCertificate(const char* default_cert_file, const char* default_cert_dir, void* ctx,
                                              bool (*add)(void* ctx, const uint8_t* der, size_t len));

// Returns false when the bytes are not a certificate, which ends the file they came from.
static bool us_push_system_certificate(void* ctx, const uint8_t* der, size_t len) {
  X509* cert = d2i_X509(NULL, &der, len);
  if (cert == NULL) {
    ERR_clear_error();
    return false;
  }
  if (!sk_X509_push(static_cast<STACK_OF(X509)*>(ctx), cert)) {
    X509_free(cert);
  }
  return true;
}

extern "C" void us_load_system_certificates_linux(STACK_OF(X509) **system_certs) {
  *system_certs = sk_X509_new_null();
  if (*system_certs == NULL) {
    return;
  }
  Bun__forEachSystemCertificate(X509_get_default_cert_file(), X509_get_default_cert_dir(), *system_certs,
                                us_push_system_certificate);
}

#endif // !__APPLE__
#endif // !_WIN32
