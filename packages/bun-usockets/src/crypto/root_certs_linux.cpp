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

// The Linux system store for --use-system-ca / tls.getCACertificates('system'). Sources are a superset of both what
// Node's GetOpenSSLSystemCertificates reads ($SSL_CERT_FILE else the OpenSSL default file, and every regular file in
// $SSL_CERT_DIR else the OpenSSL default directory; a variable that is set but empty turns its source off) and the
// well-known distro bundle/directory paths earlier Bun releases read, so no layout loses a CA. Each file is read once
// per inode and each certificate reported once per DER encoding: distros alias these paths heavily.
namespace {

struct SystemCertLoader {
  STACK_OF(X509) *out;
  std::set<std::pair<dev_t, ino_t>> files_seen, dirs_seen;
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
    struct stat dst;
    if (fstat(dirfd(d), &dst) == 0 && !dirs_seen.emplace(dst.st_dev, dst.st_ino).second) {
      closedir(d);
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
  if (cert_file != nullptr) {
    if (cert_file[0] != '\0') loader.loadFile(cert_file);
  } else {
    loader.loadFile(X509_get_default_cert_file());
#ifndef __ANDROID__
    static const char *const kBundles[] = {
        "/etc/ssl/certs/ca-certificates.crt",                // Debian/Ubuntu/Gentoo/Arch/NixOS
        "/etc/pki/tls/certs/ca-bundle.crt",                  // Fedora/RHEL 6
        "/etc/ssl/ca-bundle.pem",                            // openSUSE
        "/etc/pki/tls/cert.pem",                             // Fedora/RHEL 7+
        "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem", // CentOS/RHEL 7+, Amazon Linux
        "/etc/ssl/cert.pem",                                 // Alpine, FreeBSD
        "/usr/local/etc/openssl/cert.pem",
        "/usr/local/share/ca-certificates/ca-certificates.crt",
    };
    for (const char *path : kBundles) loader.loadFile(path);
#endif
  }

  const char *cert_dir = getenv("SSL_CERT_DIR");
  if (cert_dir != nullptr) {
    // OpenSSL accepts several directories separated by ':' here.
    std::string dirs = cert_dir;
    size_t start = 0;
    while (start <= dirs.size()) {
      size_t end = dirs.find(':', start);
      if (end == std::string::npos) end = dirs.size();
      if (end > start) loader.loadDirectory(dirs.substr(start, end - start));
      start = end + 1;
    }
  } else {
#ifdef __ANDROID__
    // Android has no OpenSSL layout: mainline store (API 30+), base store, user-installed store.
    loader.loadDirectory("/apex/com.android.conscrypt/cacerts");
    loader.loadDirectory("/system/etc/security/cacerts");
    loader.loadDirectory("/data/misc/user/0/cacerts-added");
#else
    loader.loadDirectory(X509_get_default_cert_dir());
    static const char *const kDirs[] = {
        "/etc/ssl/certs",           "/etc/pki/tls/certs",           "/usr/share/ca-certificates",
        "/usr/local/share/certs",   "/etc/openssl/certs",           "/var/ssl/certs",
        "/usr/local/etc/openssl/certs", "/System/Library/OpenSSL/certs",
    };
    for (const char *dir : kDirs) loader.loadDirectory(dir);
#endif
  }
}

#endif // !__APPLE__
#endif // !_WIN32
