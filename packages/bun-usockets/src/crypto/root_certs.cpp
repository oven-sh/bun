// MSVC doesn't support C11 stdatomic.h propertly yet.
// so we use C++ std::atomic instead.
#include "./root_certs.h"
#include "./root_certs_header.h"
#include "./internal/internal.h"
#include <atomic>
#include <string.h>
#ifdef __APPLE__
#include <Security/Security.h>
#endif

static const int root_certs_size = sizeof(root_certs) / sizeof(root_certs[0]);
extern "C" bool Bun__useSystemCA();
extern "C" void BUN__warn__extra_ca_load_failed(const char* filename, const char* error_msg);

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


// Indicates the trust status of a certificate.
enum class us_internal_trust_status {
  // Trust status is unknown / uninitialized.
  UNKNOWN,
  // Certificate inherits trust value from its issuer. If the certificate is the
  // root of the chain, this implies distrust.
  UNSPECIFIED,
  // Certificate is a trust anchor.
  TRUSTED,
  // Certificate is blocked / explicitly distrusted.
  DISTRUSTED
};

static bool us_internal_is_self_issued(X509* cert) {
  auto subject = X509_get_subject_name(cert);
  auto issuer = X509_get_issuer_name(cert);

  return X509_NAME_cmp(subject, issuer) == 0;
}


// The following code is loosely based on
// https://github.com/chromium/chromium/blob/54bd8e3/net/cert/internal/trust_store_mac.cc
// and
// https://github.com/chromium/chromium/blob/0192587/net/cert/internal/trust_store_win.cc
// Copyright 2015 The Chromium Authors
// Licensed under a BSD-style license
// See https://chromium.googlesource.com/chromium/src/+/HEAD/LICENSE for
// details.
#ifdef __APPLE__
static us_internal_trust_status us_internal_is_trust_dictionary_trusted_for_policy(CFDictionaryRef trust_dict,
                                              bool is_self_issued) {
  // Trust settings may be scoped to a single application
  // skip as this is not supported
  if (CFDictionaryContainsKey(trust_dict, kSecTrustSettingsApplication)) {
    return us_internal_trust_status::UNSPECIFIED;
  }

  // Trust settings may be scoped using policy-specific constraints. For
  // example, SSL trust settings might be scoped to a single hostname, or EAP
  // settings specific to a particular WiFi network.
  // As this is not presently supported, skip any policy-specific trust
  // settings.
  if (CFDictionaryContainsKey(trust_dict, kSecTrustSettingsPolicyString)) {
    return us_internal_trust_status::UNSPECIFIED;
  }

  // If the trust settings are scoped to a specific policy (via
  // kSecTrustSettingsPolicy), ensure that the policy is the same policy as
  // |kSecPolicyAppleSSL|. If there is no kSecTrustSettingsPolicy key, it's
  // considered a match for all policies.
  if (CFDictionaryContainsKey(trust_dict, kSecTrustSettingsPolicy)) {
    SecPolicyRef policy_ref = reinterpret_cast<SecPolicyRef>(const_cast<void*>(
        CFDictionaryGetValue(trust_dict, kSecTrustSettingsPolicy)));

    if (!policy_ref) {
      return us_internal_trust_status::UNSPECIFIED;
    }

    CFDictionaryRef policy_dict(SecPolicyCopyProperties(policy_ref));

    // kSecPolicyOid is guaranteed to be present in the policy dictionary.
    CFStringRef policy_oid = reinterpret_cast<CFStringRef>(
        const_cast<void*>(CFDictionaryGetValue(policy_dict, kSecPolicyOid)));

    if (!CFEqual(policy_oid, kSecPolicyAppleSSL)) {
      return us_internal_trust_status::UNSPECIFIED;
    }
  }

  int trust_settings_result = kSecTrustSettingsResultTrustRoot;
  if (CFDictionaryContainsKey(trust_dict, kSecTrustSettingsResult)) {
    CFNumberRef trust_settings_result_ref =
        reinterpret_cast<CFNumberRef>(const_cast<void*>(
            CFDictionaryGetValue(trust_dict, kSecTrustSettingsResult)));

    if (!trust_settings_result_ref ||
        !CFNumberGetValue(trust_settings_result_ref,
                          kCFNumberIntType,
                          &trust_settings_result)) {
      return us_internal_trust_status::UNSPECIFIED;
    }

    if (trust_settings_result == kSecTrustSettingsResultDeny) {
      return us_internal_trust_status::DISTRUSTED;
    }

    // This is a bit of a hack: if the cert is self-issued allow either
    // kSecTrustSettingsResultTrustRoot or kSecTrustSettingsResultTrustAsRoot on
    // the basis that SecTrustSetTrustSettings should not allow creating an
    // invalid trust record in the first place. (The spec is that
    // kSecTrustSettingsResultTrustRoot can only be applied to root(self-signed)
    // certs and kSecTrustSettingsResultTrustAsRoot is used for other certs.)
    // This hack avoids having to check the signature on the cert which is slow
    // if using the platform APIs, and may require supporting MD5 signature
    // algorithms on some older OSX versions or locally added roots, which is
    // undesirable in the built-in signature verifier.
    if (is_self_issued) {
      return trust_settings_result == kSecTrustSettingsResultTrustRoot ||
                     trust_settings_result == kSecTrustSettingsResultTrustAsRoot
                 ? us_internal_trust_status::TRUSTED
                 : us_internal_trust_status::UNSPECIFIED;
    }

    // kSecTrustSettingsResultTrustAsRoot can only be applied to non-root certs.
    return (trust_settings_result == kSecTrustSettingsResultTrustAsRoot)
               ? us_internal_trust_status::TRUSTED
               : us_internal_trust_status::UNSPECIFIED;
  }

  return us_internal_trust_status::UNSPECIFIED;
}

static us_internal_trust_status us_internal_is_trust_settings_trusted_for_policy(CFArrayRef trust_settings,
                                            bool is_self_issued) {
  // The trust_settings parameter can return a valid but empty CFArrayRef.
  // This empty trust-settings array means “always trust this certificate”
  // with an overall trust setting for the certificate of
  // kSecTrustSettingsResultTrustRoot
  if (CFArrayGetCount(trust_settings) == 0) {
    return is_self_issued ? us_internal_trust_status::TRUSTED : us_internal_trust_status::UNSPECIFIED;
  }

  for (CFIndex i = 0; i < CFArrayGetCount(trust_settings); ++i) {
    CFDictionaryRef trust_dict = reinterpret_cast<CFDictionaryRef>(
        const_cast<void*>(CFArrayGetValueAtIndex(trust_settings, i)));

    auto trust =
        us_internal_is_trust_dictionary_trusted_for_policy(trust_dict, is_self_issued);

    if (trust == us_internal_trust_status::DISTRUSTED || trust == us_internal_trust_status::TRUSTED) {
      return trust;
    }
  }
  return us_internal_trust_status::UNSPECIFIED;
}

static bool us_internal_is_certificate_trust_valid(SecCertificateRef ref) {
  SecTrustRef sec_trust = nullptr;
  CFMutableArrayRef subj_certs =
      CFArrayCreateMutable(nullptr, 1, &kCFTypeArrayCallBacks);
  CFArraySetValueAtIndex(subj_certs, 0, ref);

  SecPolicyRef policy = SecPolicyCreateSSL(false, nullptr);
  OSStatus ortn =
      SecTrustCreateWithCertificates(subj_certs, policy, &sec_trust);
  bool result = false;
  if (ortn) {
    /* should never happen */
  } else {
    result = SecTrustEvaluateWithError(sec_trust, nullptr);
  }

  if (policy) {
    CFRelease(policy);
  }
  if (sec_trust) {
    CFRelease(sec_trust);
  }
  if (subj_certs) {
    CFRelease(subj_certs);
  }
  return result;
}


static bool us_internal_is_certificate_trusted_for_policy(X509* cert, SecCertificateRef ref) {
  OSStatus err;

  bool trust_evaluated = false;
  bool is_self_issued = us_internal_is_self_issued(cert);

  // Evaluate user trust domain, then admin. User settings can override
  // admin (and both override the system domain, but we don't check that).
  for (const auto& trust_domain :
       {kSecTrustSettingsDomainUser, kSecTrustSettingsDomainAdmin}) {
    CFArrayRef trust_settings = nullptr;
    err = SecTrustSettingsCopyTrustSettings(ref, trust_domain, &trust_settings);

    if (err != errSecSuccess && err != errSecItemNotFound) {
      fprintf(stderr,
              "ERROR: failed to copy trust settings of system certificate%d\n",
              err);
      continue;
    }

    if (err == errSecSuccess && trust_settings != nullptr) {
      auto result =
          us_internal_is_trust_settings_trusted_for_policy(trust_settings, is_self_issued);
      if (result != us_internal_trust_status::UNSPECIFIED) {
        CFRelease(trust_settings);
        return result == us_internal_trust_status::TRUSTED;
      }
    }

    // An empty trust settings array isn’t the same as no trust settings,
    // where the trust_settings parameter returns NULL.
    // No trust-settings array means
    // “this certificate must be verifiable using a known trusted certificate”.
    if (trust_settings == nullptr && !trust_evaluated) {
      bool result = us_internal_is_certificate_trust_valid(ref);
      if (result) {
        return true;
      }
      // no point re-evaluating this in the admin domain
      trust_evaluated = true;
    } else if (trust_settings) {
      CFRelease(trust_settings);
    }
  }
  return false;
}


static STACK_OF(X509) *us_internal_init_system_certs_from_macos_keychain() {
  STACK_OF(X509) *certs = NULL;


  CFTypeRef search_keys[] = {kSecClass, kSecMatchLimit, kSecReturnRef};
  CFTypeRef search_values[] = {
      kSecClassCertificate, kSecMatchLimitAll, kCFBooleanTrue};
  CFDictionaryRef search = CFDictionaryCreate(kCFAllocatorDefault,
                                              search_keys,
                                              search_values,
                                              3,
                                              &kCFTypeDictionaryKeyCallBacks,
                                              &kCFTypeDictionaryValueCallBacks);

  CFArrayRef curr_anchors = nullptr;
  OSStatus ortn =
      SecItemCopyMatching(search, reinterpret_cast<CFTypeRef*>(&curr_anchors));
  CFRelease(search);

  if (ortn) {
    fprintf(stderr, "ERROR: SecItemCopyMatching failed %d\n", ortn);
  }

  CFIndex count = CFArrayGetCount(curr_anchors);

  for (int i = 0; i < count; ++i) {
    SecCertificateRef cert_ref = reinterpret_cast<SecCertificateRef>(
        const_cast<void*>(CFArrayGetValueAtIndex(curr_anchors, i)));

    CFDataRef der_data = SecCertificateCopyData(cert_ref);
    if (!der_data) {
      fprintf(stderr, "ERROR: SecCertificateCopyData failed\n");
      continue;
    }
    auto data_buffer_pointer = CFDataGetBytePtr(der_data);

    X509* cert =
        d2i_X509(nullptr, &data_buffer_pointer, CFDataGetLength(der_data));
    CFRelease(der_data);
    bool is_valid = us_internal_is_certificate_trusted_for_policy(cert, cert_ref);
    if (is_valid) {
      if(!certs) {
        certs = sk_X509_new_null();
      }
      if (!sk_X509_push(certs, cert)) {
        OPENSSL_PUT_ERROR(SSL, ERR_R_MALLOC_FAILURE);
        X509_free(cert);
        goto end;
      }
    }
  }
  CFRelease(curr_anchors);
  return certs;
end:
  if (certs) {
    sk_X509_pop_free(certs, X509_free);
  }

  char error_msg[256];
  ERR_error_string_n(ERR_peek_last_error(), error_msg, sizeof(error_msg));
  BUN__warn__extra_ca_load_failed("system", error_msg);
  ERR_clear_error();
  return NULL;
}

#endif
static STACK_OF(X509) *us_internal_init_system_certs() {
  #ifdef __APPLE__
  return us_internal_init_system_certs_from_macos_keychain();
  #endif


  return NULL;
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


    // When --system-ca flag is set, only use system CA store and skip embedded certificates
    if (Bun__useSystemCA()) {
      system_cert_instances = us_internal_init_system_certs();
    }
    // get extra cert option from environment variable
    const char *extra_certs = getenv("NODE_EXTRA_CA_CERTS");
    if (extra_certs && extra_certs[0]) {
      root_extra_cert_instances = us_ssl_ctx_load_all_certs_from_file(extra_certs);
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

  us_internal_init_root_certs(default_ca_certificates.root_cert_instances, default_ca_certificates.root_extra_cert_instances, default_ca_certificates.system_cert_instances);


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

  if (!X509_STORE_set_default_paths(store)) {
    X509_STORE_free(store);
    return NULL;
  }

  us_default_ca_certificates *default_ca_certificates = us_get_default_ca_certificates();
  X509** root_cert_instances = default_ca_certificates->root_cert_instances;
  STACK_OF(X509) *root_extra_cert_instances = default_ca_certificates->root_extra_cert_instances;
  STACK_OF(X509) *system_cert_instances = default_ca_certificates->system_cert_instances;
  // node.js loads in order:
  // 1. default root certs
  // 2. system certs
  // 3. extra certs

  // load all root_cert_instances on the default ca store
  for (size_t i = 0; i < root_certs_size; i++) {
    X509 *cert = root_cert_instances[i];
    if (cert == NULL)
      continue;
    X509_up_ref(cert);
    X509_STORE_add_cert(store, cert);
  }
  // load system certs if option is set
  if (system_cert_instances) {
    for (int i = 0; i < sk_X509_num(system_cert_instances); i++) {
      X509 *cert = sk_X509_value(system_cert_instances, i);
      X509_up_ref(cert);
      X509_STORE_add_cert(store, cert);
    }
  }
  // load extra certs 
  if (root_extra_cert_instances) {
    for (int i = 0; i < sk_X509_num(root_extra_cert_instances); i++) {
      X509 *cert = sk_X509_value(root_extra_cert_instances, i);
      X509_up_ref(cert);
      X509_STORE_add_cert(store, cert);
    }
  }

  return store;
}
