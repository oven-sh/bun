// MSVC doesn't support C11 stdatomic.h propertly yet.
// so we use C++ std::atomic instead.
#include "./root_certs.h"
#include "./root_certs_header.h"
#include "./internal/internal.h"
#include <atomic>
#include <string.h>
#include "./default_ciphers.h"

// System-specific includes for certificate loading
#ifdef _WIN32
#include <windows.h>
#include <wincrypt.h>
#elif defined(__APPLE__)
#include <dlfcn.h>
#include <CoreFoundation/CoreFoundation.h>
// Security framework types and constants - we'll load dynamically
typedef struct OpaqueSecCertificateRef* SecCertificateRef;
typedef struct OpaqueSecTrustRef* SecTrustRef;
typedef struct OpaqueSecPolicyRef* SecPolicyRef;
typedef int32_t OSStatus;
typedef uint32_t SecTrustSettingsDomain;

// Security framework constants (from Security/SecBase.h)
enum {
    errSecSuccess = 0,
    errSecItemNotFound = -25300,
};

// Trust settings domains (from Security/SecTrustSettings.h)  
enum {
    kSecTrustSettingsDomainUser = 0,
    kSecTrustSettingsDomainAdmin = 1,
    kSecTrustSettingsDomainSystem = 2,
};

// Trust result types (from Security/SecTrust.h)
enum {
    kSecTrustResultInvalid = 0,
    kSecTrustResultProceed = 1,
    kSecTrustResultDeny = 3,
    kSecTrustResultUnspecified = 4,
    kSecTrustResultRecoverableTrustFailure = 5,
    kSecTrustResultFatalTrustFailure = 6,
    kSecTrustResultOtherError = 7,
};

// Trust settings result (from Security/SecTrustSettings.h)
enum {
    kSecTrustSettingsResultInvalid = 0,
    kSecTrustSettingsResultTrustRoot = 1,
    kSecTrustSettingsResultTrustAsRoot = 2,
    kSecTrustSettingsResultDeny = 3,
    kSecTrustSettingsResultUnspecified = 4,
};

#else
// Linux/Unix includes
#include <dirent.h>
#include <stdio.h>
#include <limits.h>
#endif
static const int root_certs_size = sizeof(root_certs) / sizeof(root_certs[0]);

extern "C" void BUN__warn__extra_ca_load_failed(const char* filename, const char* error_msg);

// System certificate loading functions
static void us_load_system_certificates_linux(STACK_OF(X509) **system_certs);
static void us_load_system_certificates_macos(STACK_OF(X509) **system_certs);
static void us_load_system_certificates_windows(STACK_OF(X509) **system_certs);

// Helper function to check if NODE_USE_SYSTEM_CA is enabled
static bool us_should_use_system_ca() {
  const char *use_system_ca = getenv("NODE_USE_SYSTEM_CA");
  return use_system_ca && (strcmp(use_system_ca, "1") == 0 || strcmp(use_system_ca, "true") == 0);
}

#ifdef __APPLE__
// Dynamic Security framework loader
struct SecurityFramework {
  void* handle;
  
  // Core Foundation constants
  CFStringRef kSecClass;
  CFStringRef kSecClassCertificate;
  CFStringRef kSecMatchLimit;
  CFStringRef kSecMatchLimitAll;
  CFStringRef kSecReturnRef;
  CFBooleanRef kCFBooleanTrue;
  
  // Security framework function pointers
  OSStatus (*SecItemCopyMatching)(CFDictionaryRef query, CFTypeRef *result);
  CFDataRef (*SecCertificateCopyData)(SecCertificateRef certificate);
  OSStatus (*SecTrustCreateWithCertificates)(CFArrayRef certificates, CFArrayRef policies, SecTrustRef *trust);
  SecPolicyRef (*SecPolicyCreateSSL)(Boolean server, CFStringRef hostname);
  Boolean (*SecTrustEvaluateWithError)(SecTrustRef trust, CFErrorRef *error);
  OSStatus (*SecTrustSettingsCopyTrustSettings)(SecCertificateRef certRef, SecTrustSettingsDomain domain, CFArrayRef *trustSettings);
  
  // Constructor/Destructor
  SecurityFramework() : handle(nullptr), 
                       kSecClass(nullptr), kSecClassCertificate(nullptr),
                       kSecMatchLimit(nullptr), kSecMatchLimitAll(nullptr),
                       kSecReturnRef(nullptr), kCFBooleanTrue(nullptr),
                       SecItemCopyMatching(nullptr), SecCertificateCopyData(nullptr),
                       SecTrustCreateWithCertificates(nullptr), SecPolicyCreateSSL(nullptr),
                       SecTrustEvaluateWithError(nullptr), SecTrustSettingsCopyTrustSettings(nullptr) {}
  
  ~SecurityFramework() {
    if (handle) {
      dlclose(handle);
    }
  }
  
  bool load() {
    if (handle) return true; // Already loaded
    
    handle = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_LAZY | RTLD_LOCAL);
    if (!handle) {
      fprintf(stderr, "Failed to load Security framework: %s\n", dlerror());
      return false;
    }
    
    // Load Core Foundation constants
    kSecClass = *(CFStringRef*)dlsym(handle, "kSecClass");
    kSecClassCertificate = *(CFStringRef*)dlsym(handle, "kSecClassCertificate");
    kSecMatchLimit = *(CFStringRef*)dlsym(handle, "kSecMatchLimit");
    kSecMatchLimitAll = *(CFStringRef*)dlsym(handle, "kSecMatchLimitAll");
    kSecReturnRef = *(CFStringRef*)dlsym(handle, "kSecReturnRef");
    
    // Load CoreFoundation constants from system
    void* cf_handle = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", RTLD_LAZY | RTLD_LOCAL);
    if (cf_handle) {
      kCFBooleanTrue = *(CFBooleanRef*)dlsym(cf_handle, "kCFBooleanTrue");
      dlclose(cf_handle);
    }
    
    // Load Security framework functions
    SecItemCopyMatching = (OSStatus (*)(CFDictionaryRef, CFTypeRef*))dlsym(handle, "SecItemCopyMatching");
    SecCertificateCopyData = (CFDataRef (*)(SecCertificateRef))dlsym(handle, "SecCertificateCopyData");
    SecTrustCreateWithCertificates = (OSStatus (*)(CFArrayRef, CFArrayRef, SecTrustRef*))dlsym(handle, "SecTrustCreateWithCertificates");
    SecPolicyCreateSSL = (SecPolicyRef (*)(Boolean, CFStringRef))dlsym(handle, "SecPolicyCreateSSL");
    SecTrustEvaluateWithError = (Boolean (*)(SecTrustRef, CFErrorRef*))dlsym(handle, "SecTrustEvaluateWithError");
    SecTrustSettingsCopyTrustSettings = (OSStatus (*)(SecCertificateRef, SecTrustSettingsDomain, CFArrayRef*))dlsym(handle, "SecTrustSettingsCopyTrustSettings");
    
    // Check that all required functions are loaded
    if (!kSecClass || !kSecClassCertificate || !kSecMatchLimit || 
        !kSecMatchLimitAll || !kSecReturnRef || !kCFBooleanTrue ||
        !SecItemCopyMatching || !SecCertificateCopyData ||
        !SecTrustCreateWithCertificates || !SecPolicyCreateSSL ||
        !SecTrustEvaluateWithError || !SecTrustSettingsCopyTrustSettings) {
      fprintf(stderr, "Failed to load required Security framework symbols\n");
      dlclose(handle);
      handle = nullptr;
      return false;
    }
    
    return true;
  }
};

// Global instance for dynamic loading
static SecurityFramework* g_security_framework = nullptr;

static SecurityFramework* get_security_framework() {
  if (!g_security_framework) {
    g_security_framework = new SecurityFramework();
    if (!g_security_framework->load()) {
      delete g_security_framework;
      g_security_framework = nullptr;
    }
  }
  return g_security_framework;
}

// Trust status enumeration (mirroring Node.js implementation)
enum class TrustStatus {
  TRUSTED,
  DISTRUSTED,
  UNSPECIFIED
};

// Helper function to determine if a certificate is self-issued
static bool is_certificate_self_issued(X509* cert) {
  X509_NAME* subject = X509_get_subject_name(cert);
  X509_NAME* issuer = X509_get_issuer_name(cert);
  
  if (!subject || !issuer) {
    return false;
  }
  
  return X509_NAME_cmp(subject, issuer) == 0;
}

// Validate certificate trust using Security framework
static bool is_certificate_trust_valid(SecCertificateRef cert_ref) {
  SecurityFramework* security = get_security_framework();
  if (!security) {
    return false;
  }
  
  SecTrustRef sec_trust = nullptr;
  CFMutableArrayRef subj_certs = CFArrayCreateMutable(nullptr, 1, &kCFTypeArrayCallBacks);
  CFArraySetValueAtIndex(subj_certs, 0, cert_ref);
  
  SecPolicyRef policy = security->SecPolicyCreateSSL(false, nullptr);
  CFArrayRef policies = CFArrayCreate(nullptr, (const void**)&policy, 1, &kCFTypeArrayCallBacks);
  OSStatus ortn = security->SecTrustCreateWithCertificates(subj_certs, policies, &sec_trust);
  CFRelease(policies);
  
  bool result = false;
  if (ortn == errSecSuccess) {
    result = security->SecTrustEvaluateWithError(sec_trust, nullptr);
  }
  
  // Clean up
  if (policy) CFRelease(policy);
  if (sec_trust) CFRelease(sec_trust);
  if (subj_certs) CFRelease(subj_certs);
  
  return result;
}

// Check trust settings for policy (simplified version of Node.js implementation)
static TrustStatus is_trust_settings_trusted_for_policy(CFArrayRef trust_settings, bool is_self_issued) {
  if (!trust_settings) {
    return TrustStatus::UNSPECIFIED;
  }
  
  // Empty trust settings array means "always trust this certificate"
  if (CFArrayGetCount(trust_settings) == 0) {
    return is_self_issued ? TrustStatus::TRUSTED : TrustStatus::UNSPECIFIED;
  }
  
  // For simplicity, we'll do basic checking here
  // A full implementation would parse the trust dictionary entries
  return TrustStatus::UNSPECIFIED;
}

// Check if certificate is trusted for server auth policy
static bool is_certificate_trusted_for_policy(X509* cert, SecCertificateRef cert_ref) {
  SecurityFramework* security = get_security_framework();
  if (!security) {
    return false;
  }
  
  bool is_self_issued = is_certificate_self_issued(cert);
  bool trust_evaluated = false;
  
  // Check user trust domain, then admin domain
  for (const auto& trust_domain : {kSecTrustSettingsDomainUser, kSecTrustSettingsDomainAdmin}) {
    CFArrayRef trust_settings = nullptr;
    OSStatus err = security->SecTrustSettingsCopyTrustSettings(cert_ref, trust_domain, &trust_settings);
    
    if (err != errSecSuccess && err != errSecItemNotFound) {
      fprintf(stderr, "Warning: failed to copy trust settings of system certificate: %d\n", err);
      continue;
    }
    
    if (err == errSecSuccess && trust_settings != nullptr) {
      TrustStatus result = is_trust_settings_trusted_for_policy(trust_settings, is_self_issued);
      CFRelease(trust_settings);
      
      if (result == TrustStatus::TRUSTED) {
        return true;
      } else if (result == TrustStatus::DISTRUSTED) {
        return false;
      }
    }
    
    // If no trust settings and we haven't evaluated trust yet, check trust validity
    if (trust_settings == nullptr && !trust_evaluated) {
      bool result = is_certificate_trust_valid(cert_ref);
      if (result) {
        return true;
      }
      trust_evaluated = true;
    }
  }
  
  return false;
}

// Cleanup function for Security framework
static void cleanup_security_framework() {
  if (g_security_framework) {
    delete g_security_framework;
    g_security_framework = nullptr;
  }
}

// Use atexit to ensure cleanup on process exit
static void __attribute__((constructor)) init_security_framework_cleanup() {
  atexit(cleanup_security_framework);
}
#endif

// This callback is used to avoid the default passphrase callback in OpenSSL
// which will typically prompt for the passphrase. The prompting is designed
// for the OpenSSL CLI, but works poorly for this case because it involves
// synchronous interaction with the controlling terminal, something we never
// want, and use this function to avoid it.
int us_no_password_callback(char *buf, int size, int rwflag, void *u) {
  return 0;
}

static X509 *
us_ssl_ctx_get_X509_without_callback_from(struct us_cert_string_t content) {
  X509 *x = NULL;
  BIO *in;

  ERR_clear_error(); // clear error stack for SSL_CTX_use_certificate()

  in = BIO_new_mem_buf(content.str, content.len);
  if (in == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_BUF_LIB);
  } else {
    x = PEM_read_bio_X509(in, NULL, us_no_password_callback, NULL);
    if (x == NULL) {
      OPENSSL_PUT_ERROR(SSL, ERR_R_PEM_LIB);
    }

    // NOTE: PEM_read_bio_X509 allocates, so input BIO must be freed.
    BIO_free(in);
  }
  return x;
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

static void us_internal_init_root_certs(
    X509 *root_cert_instances[root_certs_size],
    STACK_OF(X509) *&root_extra_cert_instances,
    STACK_OF(X509) *&root_system_cert_instances) {
  static std::atomic_flag root_cert_instances_lock = ATOMIC_FLAG_INIT;
  static std::atomic_bool root_cert_instances_initialized = 0;

  if (std::atomic_load(&root_cert_instances_initialized) == 1)
    return;

  while (atomic_flag_test_and_set_explicit(&root_cert_instances_lock,
                                           std::memory_order_acquire))
    ;

  if (!atomic_exchange(&root_cert_instances_initialized, 1)) {
    for (size_t i = 0; i < root_certs_size; i++) {
      root_cert_instances[i] =
          us_ssl_ctx_get_X509_without_callback_from(root_certs[i]);
    }

    // get extra cert option from environment variable
    const char *extra_certs = getenv("NODE_EXTRA_CA_CERTS");
    if (extra_certs && extra_certs[0]) {
      root_extra_cert_instances = us_ssl_ctx_load_all_certs_from_file(extra_certs);
    }

    // load system certificates if NODE_USE_SYSTEM_CA=1
    if (us_should_use_system_ca()) {
#ifdef __APPLE__
      us_load_system_certificates_macos(&root_system_cert_instances);
#elif defined(_WIN32)
      us_load_system_certificates_windows(&root_system_cert_instances);
#else
      us_load_system_certificates_linux(&root_system_cert_instances);
#endif
    }
  }

  atomic_flag_clear_explicit(&root_cert_instances_lock,
                             std::memory_order_release);
}

extern "C" int us_internal_raw_root_certs(struct us_cert_string_t **out) {
  *out = root_certs;
  return root_certs_size;
}

struct us_default_ca_certificates {
  X509 *root_cert_instances[root_certs_size];
  STACK_OF(X509) *root_extra_cert_instances;
  STACK_OF(X509) *root_system_cert_instances;
};

us_default_ca_certificates* us_get_default_ca_certificates() {
  static us_default_ca_certificates default_ca_certificates = {{NULL}, NULL, NULL};

  us_internal_init_root_certs(default_ca_certificates.root_cert_instances, 
                              default_ca_certificates.root_extra_cert_instances,
                              default_ca_certificates.root_system_cert_instances);

  return &default_ca_certificates;
}

STACK_OF(X509) *us_get_root_extra_cert_instances() {
  return us_get_default_ca_certificates()->root_extra_cert_instances;
}

extern "C" X509_STORE *us_get_default_ca_store() {
  X509_STORE *store = X509_STORE_new();
  if (store == NULL) {
    return NULL;
  }

  // Only load system default paths when NODE_USE_SYSTEM_CA=1
  // Otherwise, rely on bundled certificates only (like Node.js behavior)
  if (us_should_use_system_ca()) {
    if (!X509_STORE_set_default_paths(store)) {
      X509_STORE_free(store);
      return NULL;
    }
  }

  us_default_ca_certificates *default_ca_certificates = us_get_default_ca_certificates();
  X509** root_cert_instances = default_ca_certificates->root_cert_instances;
  STACK_OF(X509) *root_extra_cert_instances = default_ca_certificates->root_extra_cert_instances;
  STACK_OF(X509) *root_system_cert_instances = default_ca_certificates->root_system_cert_instances;

  // load all root_cert_instances on the default ca store
  for (size_t i = 0; i < root_certs_size; i++) {
    X509 *cert = root_cert_instances[i];
    if (cert == NULL)
      continue;
    X509_up_ref(cert);
    X509_STORE_add_cert(store, cert);
  }

  if (root_extra_cert_instances) {
    for (int i = 0; i < sk_X509_num(root_extra_cert_instances); i++) {
      X509 *cert = sk_X509_value(root_extra_cert_instances, i);
      X509_up_ref(cert);
      X509_STORE_add_cert(store, cert);
    }
  }

  if (root_system_cert_instances) {
    for (int i = 0; i < sk_X509_num(root_system_cert_instances); i++) {
      X509 *cert = sk_X509_value(root_system_cert_instances, i);
      X509_up_ref(cert);
      X509_STORE_add_cert(store, cert);
    }
  }

  return store;
}
extern "C" const char *us_get_default_ciphers() {
  return DEFAULT_CIPHER_LIST;
}

// Platform-specific implementations for loading system certificates
#ifdef __APPLE__
static void us_load_system_certificates_macos(STACK_OF(X509) **system_certs) {
  *system_certs = sk_X509_new_null();
  if (*system_certs == NULL) {
    return;
  }

  SecurityFramework* security = get_security_framework();
  if (!security) {
    fprintf(stderr, "Warning: Unable to load Security framework, skipping system certificates\n");
    return;
  }

  // Create search dictionary for certificates
  CFTypeRef search_keys[] = {
    security->kSecClass, 
    security->kSecMatchLimit, 
    security->kSecReturnRef
  };
  CFTypeRef search_values[] = {
    security->kSecClassCertificate, 
    security->kSecMatchLimitAll, 
    security->kCFBooleanTrue
  };
  
  CFDictionaryRef search = CFDictionaryCreate(
    kCFAllocatorDefault,
    search_keys,
    search_values,
    3,
    &kCFTypeDictionaryKeyCallBacks,
    &kCFTypeDictionaryValueCallBacks
  );

  CFArrayRef certificates = nullptr;
  OSStatus status = security->SecItemCopyMatching(search, (CFTypeRef*)&certificates);
  CFRelease(search);

  if (status != errSecSuccess) {
    fprintf(stderr, "Warning: SecItemCopyMatching failed with status %d\n", status);
    return;
  }

  if (!certificates) {
    fprintf(stderr, "Warning: No certificates found in keychain\n");
    return;
  }

  CFIndex count = CFArrayGetCount(certificates);
  
  for (CFIndex i = 0; i < count; ++i) {
    SecCertificateRef cert_ref = (SecCertificateRef)CFArrayGetValueAtIndex(certificates, i);
    
    // Get certificate data
    CFDataRef cert_data = security->SecCertificateCopyData(cert_ref);
    if (!cert_data) {
      fprintf(stderr, "Warning: SecCertificateCopyData failed for certificate %ld\n", i);
      continue;
    }
    
    // Convert to X509
    const unsigned char* data_ptr = CFDataGetBytePtr(cert_data);
    long data_len = CFDataGetLength(cert_data);
    X509* x509_cert = d2i_X509(nullptr, &data_ptr, data_len);
    CFRelease(cert_data);
    
    if (!x509_cert) {
      fprintf(stderr, "Warning: Failed to parse certificate %ld as X509\n", i);
      continue;
    }
    
    // Check if certificate is trusted for server authentication
    if (is_certificate_trusted_for_policy(x509_cert, cert_ref)) {
      sk_X509_push(*system_certs, x509_cert);
    } else {
      X509_free(x509_cert);
    }
  }
  
  CFRelease(certificates);
}

#elif defined(_WIN32)
static void us_load_system_certificates_windows(STACK_OF(X509) **system_certs) {
  *system_certs = sk_X509_new_null();
  if (*system_certs == NULL) {
    return;
  }

  // On Windows, load certificates from system certificate stores
  // This follows Node.js's ReadWindowsCertificates implementation
  
  HCERTSTORE cert_store = NULL;
  PCCERT_CONTEXT cert_context = NULL;
  
  // Try to open the ROOT certificate store
  cert_store = CertOpenSystemStore(0, L"ROOT");
  if (cert_store == NULL) {
    return;
  }
  
  // Enumerate certificates in the store
  while ((cert_context = CertEnumCertificatesInStore(cert_store, cert_context)) != NULL) {
    const unsigned char* cert_data = cert_context->pbCertEncoded;
    int cert_len = cert_context->cbCertEncoded;
    
    X509* x509_cert = d2i_X509(NULL, &cert_data, cert_len);
    if (x509_cert != NULL) {
      sk_X509_push(*system_certs, x509_cert);
    }
  }
  
  CertCloseStore(cert_store, 0);
}

#else
// Linux and other Unix-like systems
static void us_load_system_certificates_linux(STACK_OF(X509) **system_certs) {
  *system_certs = sk_X509_new_null();
  if (*system_certs == NULL) {
    return;
  }

  // Load certificates from standard Linux/Unix paths
  // This follows Node.js's GetOpenSSLSystemCertificates implementation
  
  const char* cert_file = getenv("SSL_CERT_FILE");
  if (!cert_file) {
    cert_file = "/etc/ssl/certs/ca-certificates.crt"; // Debian/Ubuntu default
  }
  
  const char* cert_dir = getenv("SSL_CERT_DIR");  
  if (!cert_dir) {
    cert_dir = "/etc/ssl/certs"; // Common Linux cert directory
  }
  
  // Try to load from certificate file first
  if (cert_file) {
    FILE *fp = fopen(cert_file, "r");
    if (fp) {
      X509 *cert;
      while ((cert = PEM_read_X509(fp, NULL, NULL, NULL)) != NULL) {
        sk_X509_push(*system_certs, cert);
      }
      fclose(fp);
    }
  }
  
  // If file loading didn't work or we want to supplement it, try directory
  if (cert_dir) {
    DIR *d = opendir(cert_dir);
    if (d) {
      struct dirent *entry;
      while ((entry = readdir(d)) != NULL) {
        if (entry->d_name[0] == '.') continue;
        
        char path[PATH_MAX];
        snprintf(path, sizeof(path), "%s/%s", cert_dir, entry->d_name);
        
        FILE *fp = fopen(path, "r");
        if (fp) {
          X509 *cert;
          while ((cert = PEM_read_X509(fp, NULL, NULL, NULL)) != NULL) {
            sk_X509_push(*system_certs, cert);
          }
          fclose(fp);
        }
      }
      closedir(d);
    }
  }
}
#endif