#ifndef _WIN32
#ifndef __APPLE__

#include "libusockets.h"
#include "root_certs_platform.h"
#include <string.h>
#include <openssl/err.h>
#include <openssl/pem.h>
#include <openssl/x509.h>

#include <set>
#include <string>

// src/runtime/socket/system_certs.rs finds and reads the files of the Linux system store (environment, OpenSSL
// defaults, well-known distro paths, inode de-duplication) and hands each one's bytes here; this side keeps to what
// needs BoringSSL: PEM framing, one copy per certificate, DER to X509.
extern "C" void Bun__loadSystemCertificateFiles(const char *default_cert_file, const char *default_cert_dir, void *ctx,
                                                 void (*on_file)(void *ctx, const uint8_t *data, size_t len));

namespace {

struct SystemCertLoader {
  STACK_OF(X509) *out;
  std::set<std::string> ders_seen;

  // PEM_bytes_read_bio is PEM_read_bio_X509 without the ASN.1 parse: same name matching, skipping and header
  // handling, and like a PEM_read_bio_X509 loop a block that does not decode or parse ends the file.
  static void onFile(void *ctx, const uint8_t *data, size_t len) {
    SystemCertLoader *self = static_cast<SystemCertLoader *>(ctx);
    BIO *bio = BIO_new_mem_buf(data, len);
    if (bio == nullptr) return;
    for (;;) {
      uint8_t *der = nullptr;
      long der_len = 0;
      char *name = nullptr;
      if (!PEM_bytes_read_bio(&der, &der_len, &name, PEM_STRING_X509, bio, us_no_password_callback, nullptr)) {
        break;
      }
      OPENSSL_free(name);
      bool ok = true;
      if (self->ders_seen.emplace(reinterpret_cast<const char *>(der), static_cast<size_t>(der_len)).second) {
        const uint8_t *p = der;
        X509 *cert = d2i_X509(nullptr, &p, der_len);
        ok = cert != nullptr && (sk_X509_push(self->out, cert) || (X509_free(cert), false));
      }
      OPENSSL_free(der);
      if (!ok) break;
    }
    BIO_free(bio);
    ERR_clear_error();
  }
};

} // namespace

extern "C" void us_load_system_certificates_linux(STACK_OF(X509) **system_certs) {
  *system_certs = sk_X509_new_null();
  if (*system_certs == NULL) {
    return;
  }
  SystemCertLoader loader{*system_certs, {}};
  Bun__loadSystemCertificateFiles(X509_get_default_cert_file(), X509_get_default_cert_dir(), &loader,
                                  SystemCertLoader::onFile);
}

#endif // !__APPLE__
#endif // !_WIN32
