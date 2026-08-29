#ifndef _WIN32
#ifndef __APPLE__

#include "libusockets.h"
#include <dirent.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <openssl/err.h>
#include <openssl/pem.h>
#include <openssl/x509.h>

#include <algorithm>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "root_certs_platform.h"

// The Linux system store, read the way Node's --use-system-ca reads it (GetOpenSSLSystemCertificates in
// src/crypto/crypto_context.cc): $SSL_CERT_FILE, else X509_get_default_cert_file(); and every regular file in
// $SSL_CERT_DIR, else X509_get_default_cert_dir() — always both, and a variable that is set but empty turns its
// source off. Unlike Node, each file is read once per inode and each certificate is reported once: distros link every
// root two or three times under /etc/ssl/certs and repeat them all in the bundle.
namespace {

struct SystemCertLoader {
  STACK_OF(X509) *out;
  std::set<std::pair<dev_t, ino_t>> files_seen;
  std::set<std::string> ders_seen;

  // PEM_bytes_read_bio is PEM_read_bio_X509 without the ASN.1 parse: same name matching, skipping and header
  // handling. Deduplicating on the DER first means an aliased root is parsed once.
  void loadBio(BIO *bio) {
    for (;;) {
      uint8_t *data = nullptr;
      long len = 0;
      char *name = nullptr;
      if (!PEM_bytes_read_bio(&data, &len, &name, PEM_STRING_X509, bio, us_no_password_callback, nullptr)) {
        break;
      }
      OPENSSL_free(name);
      bool ok = true;
      if (ders_seen.emplace(reinterpret_cast<const char *>(data), static_cast<size_t>(len)).second) {
        const uint8_t *p = data;
        X509 *cert = d2i_X509(nullptr, &p, len);
        ok = cert != nullptr && (sk_X509_push(out, cert) || (X509_free(cert), false));
      }
      OPENSSL_free(data);
      if (!ok) {
        break;
      }
    }
    ERR_clear_error();
  }

  // No file-type check here, as in Node, so SSL_CERT_FILE may name a pipe.
  void loadFile(const char *path) {
    FILE *file = fopen(path, "re");
    if (file == nullptr) {
      return;
    }
    struct stat st;
    if (fstat(fileno(file), &st) == 0 && !files_seen.emplace(st.st_dev, st.st_ino).second) {
      fclose(file);
      return;
    }
    BIO *bio = BIO_new_fp(file, BIO_CLOSE);
    if (bio == nullptr) {
      fclose(file);
      return;
    }
    loadBio(bio);
    BIO_free(bio);
  }

  // Every regular file (after following links) directly in `dir`, in name order.
  void loadDirectory(const std::string &dir) {
    DIR *d = opendir(dir.c_str());
    if (d == nullptr) {
      return;
    }
    std::vector<std::string> names;
    while (struct dirent *entry = readdir(d)) {
      if (strcmp(entry->d_name, ".") != 0 && strcmp(entry->d_name, "..") != 0) {
        names.emplace_back(entry->d_name);
      }
    }
    closedir(d);
    std::sort(names.begin(), names.end());
    for (const std::string &name : names) {
      std::string path = dir + "/" + name;
      struct stat st;
      if (stat(path.c_str(), &st) != 0 || !S_ISREG(st.st_mode) || files_seen.count({st.st_dev, st.st_ino})) {
        continue;
      }
      loadFile(path.c_str());
    }
  }
};

} // namespace

extern "C" void us_load_system_certificates_linux(STACK_OF(X509) **system_certs) {
  *system_certs = sk_X509_new_null();
  if (*system_certs == NULL) {
    return;
  }
  SystemCertLoader loader{*system_certs, {}, {}};

  const char *cert_file = getenv("SSL_CERT_FILE");
  if (cert_file == nullptr) {
    cert_file = X509_get_default_cert_file();
  }
  if (cert_file[0] != '\0') {
    loader.loadFile(cert_file);
  }

  const char *cert_dir = getenv("SSL_CERT_DIR");
  if (cert_dir == nullptr) {
#ifdef __ANDROID__
    // Android has no OpenSSL layout: mainline store (API 30+), base store, user-installed store.
    loader.loadDirectory("/apex/com.android.conscrypt/cacerts");
    loader.loadDirectory("/system/etc/security/cacerts");
    loader.loadDirectory("/data/misc/user/0/cacerts-added");
#else
    loader.loadDirectory(X509_get_default_cert_dir());
#endif
  } else {
    // OpenSSL accepts several directories separated by ':' here.
    std::string dirs = cert_dir;
    size_t start = 0;
    while (start <= dirs.size()) {
      size_t end = dirs.find(':', start);
      if (end == std::string::npos) end = dirs.size();
      if (end > start) loader.loadDirectory(dirs.substr(start, end - start));
      start = end + 1;
    }
  }
}

#endif // !__APPLE__
#endif // !_WIN32
