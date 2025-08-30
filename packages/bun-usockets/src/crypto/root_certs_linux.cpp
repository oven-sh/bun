#ifndef _WIN32
#ifndef __APPLE__

#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <openssl/x509.h>
#include <openssl/x509_vfy.h>
#include <openssl/pem.h>

extern "C" void BUN__warn__extra_ca_load_failed(const char* filename, const char* error_msg);

// Helper function to load certificates from a directory
static void load_certs_from_directory(const char* dir_path, STACK_OF(X509)* cert_stack) {
  DIR* dir = opendir(dir_path);
  if (!dir) {
    return;
  }
  
  struct dirent* entry;
  while ((entry = readdir(dir)) != NULL) {
    // Skip . and ..
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
      continue;
    }
    
    // Check if file has .crt, .pem, or .cer extension
    const char* ext = strrchr(entry->d_name, '.');
    if (!ext || (strcmp(ext, ".crt") != 0 && strcmp(ext, ".pem") != 0 && strcmp(ext, ".cer") != 0)) {
      continue;
    }
    
    // Build full path
    char filepath[PATH_MAX];
    snprintf(filepath, sizeof(filepath), "%s/%s", dir_path, entry->d_name);
    
    // Try to load certificate
    FILE* file = fopen(filepath, "r");
    if (file) {
      X509* cert = PEM_read_X509(file, NULL, NULL, NULL);
      fclose(file);
      
      if (cert) {
        if (!sk_X509_push(cert_stack, cert)) {
          X509_free(cert);
        }
      }
    }
  }
  
  closedir(dir);
}

// Helper function to load certificates from a bundle file
static void load_certs_from_bundle(const char* bundle_path, STACK_OF(X509)* cert_stack) {
  FILE* file = fopen(bundle_path, "r");
  if (!file) {
    return;
  }
  
  X509* cert;
  while ((cert = PEM_read_X509(file, NULL, NULL, NULL)) != NULL) {
    if (!sk_X509_push(cert_stack, cert)) {
      X509_free(cert);
      break;
    }
  }
  ERR_clear_error();
  
  fclose(file);
}

// Main function to load system certificates on Linux and other Unix-like systems
extern "C" void us_load_system_certificates_linux(STACK_OF(X509) **system_certs) {
  *system_certs = sk_X509_new_null();
  if (*system_certs == NULL) {
    return;
  }

  // First check environment variables (same as Node.js and OpenSSL)
  const char* ssl_cert_file = getenv("SSL_CERT_FILE");
  const char* ssl_cert_dir = getenv("SSL_CERT_DIR");
  
  // If SSL_CERT_FILE is set, load from it
  if (ssl_cert_file && strlen(ssl_cert_file) > 0) {
    load_certs_from_bundle(ssl_cert_file, *system_certs);
  }
  
  // If SSL_CERT_DIR is set, load from each directory (colon-separated)
  if (ssl_cert_dir && strlen(ssl_cert_dir) > 0) {
    char* dir_copy = strdup(ssl_cert_dir);
    if (dir_copy) {
      char* token = strtok(dir_copy, ":");
      while (token != NULL) {
        // Skip empty tokens
        if (strlen(token) > 0) {
          load_certs_from_directory(token, *system_certs);
        }
        token = strtok(NULL, ":");
      }
      free(dir_copy);
    }
  }
  
  // If environment variables were set, use only those (even if they yield zero certs)
  if (ssl_cert_file || ssl_cert_dir) {
    return;
  }

  // Otherwise, load certificates from standard Linux/Unix paths
  // These are the common locations for system certificates
  
  // Common certificate bundle locations (single file with multiple certs)
  // These paths are based on common Linux distributions and OpenSSL defaults
  static const char* bundle_paths[] = {
    "/etc/ssl/certs/ca-certificates.crt",  // Debian/Ubuntu/Gentoo
    "/etc/pki/tls/certs/ca-bundle.crt",    // Fedora/RHEL 6
    "/etc/ssl/ca-bundle.pem",               // OpenSUSE
    "/etc/pki/tls/cert.pem",                // Fedora/RHEL 7+
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",  // CentOS/RHEL 7+
    "/etc/ssl/cert.pem",                    // Alpine Linux, macOS OpenSSL
    "/usr/local/etc/openssl/cert.pem",      // Homebrew OpenSSL on macOS
    "/usr/local/share/ca-certificates/ca-certificates.crt", // Custom CA installs
    NULL
  };
  
  // Common certificate directory locations (multiple files)
  // Note: OpenSSL expects hashed symlinks in directories (c_rehash format)
  static const char* dir_paths[] = {
    "/etc/ssl/certs",           // Common location (Debian/Ubuntu with hashed links)
    "/etc/pki/tls/certs",       // RHEL/Fedora
    "/usr/share/ca-certificates", // Debian/Ubuntu (original certs, not hashed)
    "/usr/local/share/certs",   // FreeBSD
    "/etc/openssl/certs",       // NetBSD  
    "/var/ssl/certs",           // AIX
    "/usr/local/etc/openssl/certs", // Homebrew OpenSSL on macOS
    "/System/Library/OpenSSL/certs", // macOS system OpenSSL (older versions)
    NULL
  };
  
  // Try loading from bundle files first
  for (const char** path = bundle_paths; *path != NULL; path++) {
    load_certs_from_bundle(*path, *system_certs);
  }
  
  // Then try loading from directories
  for (const char** path = dir_paths; *path != NULL; path++) {
    load_certs_from_directory(*path, *system_certs);
  }
  
  // Also check NODE_EXTRA_CA_CERTS environment variable
  const char* extra_ca_certs = getenv("NODE_EXTRA_CA_CERTS");
  if (extra_ca_certs && strlen(extra_ca_certs) > 0) {
    FILE* file = fopen(extra_ca_certs, "r");
    if (file) {
      X509* cert;
      while ((cert = PEM_read_X509(file, NULL, NULL, NULL)) != NULL) {
        sk_X509_push(*system_certs, cert);
      }
      fclose(file);
    } else {
      BUN__warn__extra_ca_load_failed(extra_ca_certs, "Failed to open file");
    }
  }
}

#endif // !__APPLE__
#endif // !_WIN32