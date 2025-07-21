// MSVC doesn't support C11 stdatomic.h propertly yet.
// so we use C++ std::atomic instead.
#include "./root_certs.h"
#include "./root_certs_header.h"
#include "./internal/internal.h"
#include <atomic>
#include <string.h>
static const int root_certs_size = sizeof(root_certs) / sizeof(root_certs[0]);

extern "C" void BUN__warn__extra_ca_load_failed(const char* filename, const char* error_msg);
extern "C" void BUN__warn__system_ca_load_failed(const char* error_msg);

// macOS Security framework types and constants
#ifdef __APPLE__
typedef long CFIndex;
typedef unsigned char Boolean;
typedef int OSStatus;
typedef void* CFTypeRef;
typedef void* CFArrayRef;
typedef void* CFDataRef;
typedef void* CFStringRef;
typedef void* CFDictionaryRef;
typedef void* CFErrorRef;
typedef void* CFAllocatorRef;
typedef void* SecCertificateRef;
typedef void* SecTrustRef;
typedef void* SecPolicyRef;

// Trust settings domains
enum {
    kSecTrustSettingsDomainUser = 0,
    kSecTrustSettingsDomainAdmin = 1,
    kSecTrustSettingsDomainSystem = 2
};

// Trust results
enum {
    kSecTrustSettingsResultInvalid = 0,
    kSecTrustSettingsResultTrustRoot = 1,
    kSecTrustSettingsResultTrustAsRoot = 2,
    kSecTrustSettingsResultDeny = 3,
    kSecTrustSettingsResultUnspecified = 4
};

// CFNumber types
enum {
    kCFNumberSInt32Type = 3
};

// CFString encoding
enum {
    kCFStringEncodingUTF8 = 0x08000100
};

// Function pointers structure - matches Zig MacOSCAFunctions
struct MacOSCAFunctions {
    // Security framework functions
    OSStatus (*SecTrustCopyAnchorCertificates)(CFArrayRef* anchor_certs);
    CFDataRef (*SecCertificateCopyData)(SecCertificateRef cert_ref);
    OSStatus (*SecItemCopyMatching)(CFDictionaryRef query, CFTypeRef* result);
    OSStatus (*SecTrustSettingsCopyTrustSettings)(SecCertificateRef cert_ref, int domain);
    SecPolicyRef (*SecPolicyCreateSSL)(Boolean server, CFStringRef hostname);
    OSStatus (*SecTrustCreateWithCertificates)(CFTypeRef certificates, CFTypeRef policies, SecTrustRef* trust);
    Boolean (*SecTrustEvaluateWithError)(SecTrustRef trust, CFErrorRef* error);
    CFDictionaryRef (*SecPolicyCopyProperties)(SecPolicyRef policy);
    
    // CoreFoundation functions
    CFIndex (*CFArrayGetCount)(CFArrayRef array);
    CFTypeRef (*CFArrayGetValueAtIndex)(CFArrayRef array, CFIndex index);
    const unsigned char* (*CFDataGetBytePtr)(CFDataRef data);
    CFIndex (*CFDataGetLength)(CFDataRef data);
    void (*CFRelease)(CFTypeRef ref);
    CFDictionaryRef (*CFDictionaryCreate)(CFAllocatorRef allocator, CFTypeRef* keys, CFTypeRef* values, CFIndex num_values, void* key_callbacks, void* value_callbacks);
    CFStringRef (*CFStringCreateWithCString)(CFAllocatorRef allocator, const char* c_str, unsigned int encoding);
    CFArrayRef (*CFArrayCreate)(CFAllocatorRef allocator, CFTypeRef* values, CFIndex num_values, void* callbacks);
    CFTypeRef (*CFDictionaryGetValue)(CFDictionaryRef dictionary, CFTypeRef key);
    unsigned long (*CFGetTypeID)(CFTypeRef ref);
    unsigned long (*CFStringGetTypeID)(void);
    unsigned long (*CFNumberGetTypeID)(void);
    Boolean (*CFStringGetCString)(CFStringRef str, char* buffer, CFIndex buffer_size, unsigned int encoding);
    Boolean (*CFNumberGetValue)(CFTypeRef number, int type, void* value_ptr);
    
    // Constants
    CFStringRef* kSecClass;
    CFStringRef* kSecClassCertificate;
    CFStringRef* kSecMatchLimit;
    CFStringRef* kSecMatchLimitAll;
    CFStringRef* kSecReturnRef;
    CFStringRef* kCFBooleanTrue;
    CFStringRef* kSecTrustSettingsResult;
    CFStringRef* kSecTrustSettingsPolicy;
    CFStringRef* kSecTrustSettingsPolicyString;
    CFStringRef* kSecTrustSettingsApplication;
    CFStringRef* kSecPolicyOid;
    CFStringRef* kSecPolicyAppleSSL;
};

extern "C" MacOSCAFunctions* Bun__getMacOSCAFunctions();
#endif

extern "C" int Bun__useSystemCA();

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

#ifdef __APPLE__
// Helper function to check if trust settings indicate the certificate is trusted for SSL policy
static bool us_internal_is_trust_settings_trusted_for_policy(MacOSCAFunctions* ca_funcs, CFArrayRef trust_settings, SecPolicyRef ssl_policy) {
  if (!trust_settings || !ca_funcs) {
    // Empty trust settings means "use system defaults"
    return true;
  }
  
  CFIndex count = ca_funcs->CFArrayGetCount(trust_settings);
  if (count == 0) {
    // Empty trust settings array means "use system defaults"
    return true;
  }
  
  CFDictionaryRef ssl_policy_properties = ca_funcs->SecPolicyCopyProperties(ssl_policy);
  CFStringRef ssl_policy_oid = NULL;
  if (ssl_policy_properties && ca_funcs->kSecPolicyOid && *(ca_funcs->kSecPolicyOid)) {
    ssl_policy_oid = (CFStringRef)ca_funcs->CFDictionaryGetValue(ssl_policy_properties, *(ca_funcs->kSecPolicyOid));
  }
  
  bool is_trusted = true; // Default to trusted
  
  for (CFIndex i = 0; i < count; i++) {
    CFDictionaryRef trust_dict = (CFDictionaryRef)ca_funcs->CFArrayGetValueAtIndex(trust_settings, i);
    if (!trust_dict) continue;
    
    // Check if this trust setting applies to SSL policy
    if (ca_funcs->kSecTrustSettingsPolicy && *(ca_funcs->kSecTrustSettingsPolicy)) {
      CFTypeRef policy = ca_funcs->CFDictionaryGetValue(trust_dict, *(ca_funcs->kSecTrustSettingsPolicy));
      if (policy) {
        // If policy is specified, check if it matches SSL
        CFStringRef policy_string = NULL;
        if (ca_funcs->kSecTrustSettingsPolicyString && *(ca_funcs->kSecTrustSettingsPolicyString)) {
          policy_string = (CFStringRef)ca_funcs->CFDictionaryGetValue(trust_dict, *(ca_funcs->kSecTrustSettingsPolicyString));
        }
        
        bool policy_matches = false;
        if (policy_string && ssl_policy_oid) {
          char policy_str[256];
          char ssl_oid_str[256];
          if (ca_funcs->CFStringGetCString(policy_string, policy_str, sizeof(policy_str), kCFStringEncodingUTF8) &&
              ca_funcs->CFStringGetCString(ssl_policy_oid, ssl_oid_str, sizeof(ssl_oid_str), kCFStringEncodingUTF8)) {
            policy_matches = (strcmp(policy_str, ssl_oid_str) == 0);
          }
        }
        
        if (!policy_matches) {
          continue; // This trust setting doesn't apply to SSL
        }
      }
    }
    
    // Check if application is specified
    if (ca_funcs->kSecTrustSettingsApplication && *(ca_funcs->kSecTrustSettingsApplication)) {
      CFTypeRef application = ca_funcs->CFDictionaryGetValue(trust_dict, *(ca_funcs->kSecTrustSettingsApplication));
      if (application) {
        // If application is specified, this trust setting only applies to that app
        continue;
      }
    }
    
    // Get the trust result
    if (ca_funcs->kSecTrustSettingsResult && *(ca_funcs->kSecTrustSettingsResult)) {
      CFTypeRef result_ref = ca_funcs->CFDictionaryGetValue(trust_dict, *(ca_funcs->kSecTrustSettingsResult));
      if (result_ref) {
        if (ca_funcs->CFGetTypeID(result_ref) == ca_funcs->CFNumberGetTypeID()) {
          int result_value;
          if (ca_funcs->CFNumberGetValue(result_ref, kCFNumberSInt32Type, &result_value)) {
            switch (result_value) {
              case kSecTrustSettingsResultDeny:
                is_trusted = false;
                break;
              case kSecTrustSettingsResultTrustRoot:
              case kSecTrustSettingsResultTrustAsRoot:
                is_trusted = true;
                break;
              case kSecTrustSettingsResultUnspecified:
              default:
                // Use system default
                break;
            }
          }
        }
      }
    }
  }
  
  if (ssl_policy_properties) {
    ca_funcs->CFRelease(ssl_policy_properties);
  }
  
  return is_trusted;
}

// Check if a certificate is trusted for the SSL policy
static bool us_internal_is_certificate_trusted_for_policy(MacOSCAFunctions* ca_funcs, SecCertificateRef cert) {
  if (!ca_funcs || !cert) {
    return false;
  }
  
  // Create SSL policy
  SecPolicyRef ssl_policy = ca_funcs->SecPolicyCreateSSL(false, NULL); // Client SSL policy
  if (!ssl_policy) {
    return false;
  }
  
  bool is_trusted = false;
  
  // Check trust settings in user and admin domains
  for (int domain : {kSecTrustSettingsDomainUser, kSecTrustSettingsDomainAdmin}) {
    CFArrayRef trust_settings = NULL;
    OSStatus status = ca_funcs->SecTrustSettingsCopyTrustSettings(cert, domain);
    
    if (status == 0 && trust_settings) {
      if (us_internal_is_trust_settings_trusted_for_policy(ca_funcs, trust_settings, ssl_policy)) {
        is_trusted = true;
        ca_funcs->CFRelease(trust_settings);
        break;
      }
      ca_funcs->CFRelease(trust_settings);
    } else if (status == -25263) { // errSecItemNotFound
      // No explicit trust settings - use system default evaluation
      CFArrayRef cert_array = ca_funcs->CFArrayCreate(NULL, (CFTypeRef*)&cert, 1, NULL);
      if (cert_array) {
        SecTrustRef trust = NULL;
        CFArrayRef policies = ca_funcs->CFArrayCreate(NULL, (CFTypeRef*)&ssl_policy, 1, NULL);
        if (policies) {
          if (ca_funcs->SecTrustCreateWithCertificates(cert_array, policies, &trust) == 0) {
            CFErrorRef error = NULL;
            if (ca_funcs->SecTrustEvaluateWithError(trust, &error)) {
              is_trusted = true;
            }
            if (error) {
              ca_funcs->CFRelease(error);
            }
            ca_funcs->CFRelease(trust);
          }
          ca_funcs->CFRelease(policies);
        }
        ca_funcs->CFRelease(cert_array);
      }
      break;
    }
  }
  
  ca_funcs->CFRelease(ssl_policy);
  return is_trusted;
}

// Load system certificates from macOS keychain using comprehensive trust evaluation
static STACK_OF(X509) *us_internal_init_system_certs_from_macos_keychain() {
  MacOSCAFunctions* ca_funcs = Bun__getMacOSCAFunctions();
  if (!ca_funcs) {
    BUN__warn__system_ca_load_failed("Could not load macOS Security framework");
    return NULL;
  }
  
  // Verify we have all required constants
  if (!ca_funcs->kSecClass || !*(ca_funcs->kSecClass) ||
      !ca_funcs->kSecClassCertificate || !*(ca_funcs->kSecClassCertificate) ||
      !ca_funcs->kSecMatchLimit || !*(ca_funcs->kSecMatchLimit) ||
      !ca_funcs->kSecMatchLimitAll || !*(ca_funcs->kSecMatchLimitAll) ||
      !ca_funcs->kSecReturnRef || !*(ca_funcs->kSecReturnRef) ||
      !ca_funcs->kCFBooleanTrue || !*(ca_funcs->kCFBooleanTrue)) {
    BUN__warn__system_ca_load_failed("Required Security framework constants not available");
    return NULL;
  }
  
  // Create query dictionary to get all certificates
  CFTypeRef keys[3] = {
    *(ca_funcs->kSecClass),
    *(ca_funcs->kSecMatchLimit),
    *(ca_funcs->kSecReturnRef)
  };
  CFTypeRef values[3] = {
    *(ca_funcs->kSecClassCertificate),
    *(ca_funcs->kSecMatchLimitAll),
    *(ca_funcs->kCFBooleanTrue)
  };
  
  CFDictionaryRef query = ca_funcs->CFDictionaryCreate(NULL, keys, values, 3, NULL, NULL);
  if (!query) {
    BUN__warn__system_ca_load_failed("Could not create certificate query");
    return NULL;
  }
  
  CFTypeRef result = NULL;
  OSStatus status = ca_funcs->SecItemCopyMatching(query, &result);
  ca_funcs->CFRelease(query);
  
  if (status != 0 || !result) {
    BUN__warn__system_ca_load_failed("Could not retrieve system certificates");
    return NULL;
  }
  
  CFArrayRef cert_array = (CFArrayRef)result;
  CFIndex cert_count = ca_funcs->CFArrayGetCount(cert_array);
  
  STACK_OF(X509) *stack = sk_X509_new_null();
  if (!stack) {
    ca_funcs->CFRelease(cert_array);
    BUN__warn__system_ca_load_failed("Could not create certificate stack");
    return NULL;
  }
  
  int loaded_count = 0;
  
  for (CFIndex i = 0; i < cert_count; i++) {
    SecCertificateRef cert_ref = (SecCertificateRef)ca_funcs->CFArrayGetValueAtIndex(cert_array, i);
    if (!cert_ref) continue;
    
    // Check if certificate is trusted for SSL
    if (!us_internal_is_certificate_trusted_for_policy(ca_funcs, cert_ref)) {
      continue;
    }
    
    // Get certificate data
    CFDataRef cert_data = ca_funcs->SecCertificateCopyData(cert_ref);
    if (!cert_data) continue;
    
    const unsigned char* data_ptr = ca_funcs->CFDataGetBytePtr(cert_data);
    CFIndex data_len = ca_funcs->CFDataGetLength(cert_data);
    
    if (data_len > 0) {
      const unsigned char* data_ptr_copy = data_ptr;
      X509* x509 = d2i_X509(NULL, &data_ptr_copy, (long)data_len);
      if (x509) {
        if (sk_X509_push(stack, x509)) {
          loaded_count++;
        } else {
          X509_free(x509);
        }
      }
    }
    
    ca_funcs->CFRelease(cert_data);
  }
  
  ca_funcs->CFRelease(cert_array);
  
  if (loaded_count == 0) {
    sk_X509_pop_free(stack, X509_free);
    BUN__warn__system_ca_load_failed("No trusted system certificates found");
    return NULL;
  }
  
  return stack;
}
#endif

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
    STACK_OF(X509) *&system_cert_instances) {
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

    // Load system certificates if enabled
    if (Bun__useSystemCA()) {
#ifdef __APPLE__
      system_cert_instances = us_internal_init_system_certs_from_macos_keychain();
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
  STACK_OF(X509) *system_cert_instances;
};

us_default_ca_certificates* us_get_default_ca_certificates() {
  static us_default_ca_certificates default_ca_certificates = {{NULL}, NULL, NULL};

  us_internal_init_root_certs(default_ca_certificates.root_cert_instances, 
                              default_ca_certificates.root_extra_cert_instances,
                              default_ca_certificates.system_cert_instances);

  return &default_ca_certificates;
}

STACK_OF(X509) *us_get_root_extra_cert_instances() {
  return us_get_default_ca_certificates()->root_extra_cert_instances;
}

STACK_OF(X509) *us_get_system_cert_instances() {
  return us_get_default_ca_certificates()->system_cert_instances;
}

extern "C" X509_STORE *us_get_default_ca_store() {
  X509_STORE *store = X509_STORE_new();
  if (store == NULL) {
    return NULL;
  }

  if (!X509_STORE_set_default_paths(store)) {
    X509_STORE_free(store);
    return NULL;
  }

  us_default_ca_certificates *default_ca_certificates = us_get_default_ca_certificates();
  X509** root_cert_instances = default_ca_certificates->root_cert_instances;
  STACK_OF(X509) *root_extra_cert_instances = default_ca_certificates->root_extra_cert_instances;
  STACK_OF(X509) *system_cert_instances = default_ca_certificates->system_cert_instances;

  // Node.js loads certificates in this order:
  // 1. Default root certs (bundled Mozilla certs)
  // 2. System certs (when --use-system-ca is enabled)
  // 3. Extra certs (NODE_EXTRA_CA_CERTS)

  // 1. Always load bundled root certificates first
  for (size_t i = 0; i < root_certs_size; i++) {
    X509 *cert = root_cert_instances[i];
    if (cert == NULL)
      continue;
    X509_up_ref(cert);
    X509_STORE_add_cert(store, cert);
  }

  // 2. Add system certificates when --use-system-ca flag is enabled
  if (Bun__useSystemCA() && system_cert_instances) {
    for (int i = 0; i < sk_X509_num(system_cert_instances); i++) {
      X509 *cert = sk_X509_value(system_cert_instances, i);
      X509_up_ref(cert);
      X509_STORE_add_cert(store, cert);
    }
  }

  // 3. Always include extra CAs from NODE_EXTRA_CA_CERTS last
  if (root_extra_cert_instances) {
    for (int i = 0; i < sk_X509_num(root_extra_cert_instances); i++) {
      X509 *cert = sk_X509_value(root_extra_cert_instances, i);
      X509_up_ref(cert);
      X509_STORE_add_cert(store, cert);
    }
  }

  return store;
}