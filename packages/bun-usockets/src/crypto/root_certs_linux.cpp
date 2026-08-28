#ifndef _WIN32
#ifndef __APPLE__

#include "libusockets.h"
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <algorithm>
#include <set>
#include <string>
#include <utility>
#include <vector>
#include <openssl/evp.h>
#include <openssl/x509.h>
#include <openssl/pem.h>

// The same sources as Node's --use-system-ca (GetOpenSSLSystemCertificates in src/crypto/crypto_context.cc): the file
// $SSL_CERT_FILE, else X509_get_default_cert_file() (/etc/ssl/cert.pem), and every regular file in $SSL_CERT_DIR, else
// X509_get_default_cert_dir() (/etc/ssl/certs). Both are always read, symbolic links are followed, names are not
// filtered, subdirectories are not entered. Distros alias these paths heavily (Debian's /etc/ssl/certs holds a <hash>.0
// and a <name>.pem link to every root plus the ca-certificates.crt bundle, so Node reports each root three times there),
// so a file is parsed once per inode and a certificate is kept once per SHA-256 fingerprint.
struct us_system_cert_loader {
  STACK_OF(X509)* certs;
  std::set<std::pair<dev_t, ino_t>> files_read;
  std::set<std::string> fingerprints;

  // Takes ownership of cert. Frees it when the same certificate is already on the stack.
  void add(X509* cert) {
    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int digest_len = 0;
    if (!X509_digest(cert, EVP_sha256(), digest, &digest_len) ||
        !fingerprints.insert(std::string(reinterpret_cast<const char*>(digest), digest_len)).second ||
        !sk_X509_push(certs, cert)) {
      X509_free(cert);
    }
  }
};

// Reads every PEM certificate in a regular file. Stops at the first block that is not a certificate, as Node does.
static void load_certs_from_file(us_system_cert_loader& loader, const char* path) {
  struct stat st;
  if (stat(path, &st) != 0 || !S_ISREG(st.st_mode)) {
    return;
  }
  if (!loader.files_read.insert(std::make_pair(st.st_dev, st.st_ino)).second) {
    return;
  }

  FILE* file = fopen(path, "r");
  if (!file) {
    return;
  }

  X509* cert;
  while ((cert = PEM_read_X509(file, NULL, NULL, NULL)) != NULL) {
    loader.add(cert);
  }
  ERR_clear_error();

  fclose(file);
}

// Reads every regular file in the directory, in name order (the order Node gets from uv_fs_scandir).
static void load_certs_from_directory(us_system_cert_loader& loader, const char* dir_path) {
  DIR* dir = opendir(dir_path);
  if (!dir) {
    return;
  }

  std::vector<std::string> names;
  struct dirent* entry;
  while ((entry = readdir(dir)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
      continue;
    }
    names.push_back(entry->d_name);
  }
  closedir(dir);

  std::sort(names.begin(), names.end());
  for (const std::string& name : names) {
    std::string filepath = std::string(dir_path) + "/" + name;
    load_certs_from_file(loader, filepath.c_str());
  }
}

extern "C" void us_load_system_certificates_linux(STACK_OF(X509) **system_certs) {
  *system_certs = sk_X509_new_null();
  if (*system_certs == NULL) {
    return;
  }
  us_system_cert_loader loader = { *system_certs, {}, {} };

  // A variable that is set but empty turns that source off, as it does in Node and OpenSSL.
  const char* cert_file = getenv(X509_get_default_cert_file_env());
  if (cert_file == NULL) {
    cert_file = X509_get_default_cert_file();
  }
  if (cert_file[0]) {
    load_certs_from_file(loader, cert_file);
  }

  const char* cert_dir = getenv(X509_get_default_cert_dir_env());
  if (cert_dir != NULL) {
    // OpenSSL accepts several directories separated by ':' here.
    char* dir_copy = us_strdup(cert_dir);
    if (dir_copy) {
      char* token = strtok(dir_copy, ":");
      while (token != NULL) {
        load_certs_from_directory(loader, token);
        token = strtok(NULL, ":");
      }
      us_free(dir_copy);
    }
    return;
  }

#ifdef __ANDROID__
  // Android has no OpenSSL layout. The system CAs are one hashed PEM file each in these directories.
  static const char* dir_paths[] = {
    "/apex/com.android.conscrypt/cacerts",  // API 30+ (mainline updatable)
    "/system/etc/security/cacerts",         // base system store
    "/data/misc/user/0/cacerts-added",      // user-installed
    NULL
  };
  for (const char** path = dir_paths; *path != NULL; path++) {
    load_certs_from_directory(loader, *path);
  }
#else
  load_certs_from_directory(loader, X509_get_default_cert_dir());
#endif
}

#endif // !__APPLE__
#endif // !_WIN32
