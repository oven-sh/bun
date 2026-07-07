#ifdef __APPLE__

#include <dlfcn.h>
#include <CoreFoundation/CoreFoundation.h>
#include <atomic>
#include <openssl/x509.h>
#include <openssl/x509_vfy.h>
#include <stdio.h>

// Security framework types and constants - dynamically loaded
typedef struct OpaqueSecCertificateRef* SecCertificateRef;
typedef struct OpaqueSecTrustRef* SecTrustRef;
typedef struct OpaqueSecPolicyRef* SecPolicyRef;
typedef int32_t OSStatus;
typedef uint32_t SecTrustSettingsDomain;
typedef uint32_t SecTrustSettingsResult;

// Security framework constants
enum {
    errSecSuccess = 0,
    errSecItemNotFound = -25300,
};

// Trust settings domains
enum {
    kSecTrustSettingsDomainUser = 0,
    kSecTrustSettingsDomainAdmin = 1,
    kSecTrustSettingsDomainSystem = 2,
};

// Trust settings result values (SecTrustSettings.h)
enum {
    kSecTrustSettingsResultInvalid = 0,
    kSecTrustSettingsResultTrustRoot = 1,
    kSecTrustSettingsResultTrustAsRoot = 2,
    kSecTrustSettingsResultDeny = 3,
    kSecTrustSettingsResultUnspecified = 4,
};

// Trust status enumeration
enum class TrustStatus {
    TRUSTED,
    DISTRUSTED,
    UNSPECIFIED
};

// Dynamic Security framework loader
class SecurityFramework {
public:
    void* handle;
    void* cf_handle;

    // Core Foundation constants
    CFStringRef kSecClass;
    CFStringRef kSecClassCertificate;
    CFStringRef kSecMatchLimit;
    CFStringRef kSecMatchLimitAll;
    CFStringRef kSecReturnRef;
    CFBooleanRef kCFBooleanTrue;
    CFAllocatorRef kCFAllocatorDefault;
    CFArrayCallBacks* kCFTypeArrayCallBacks;
    CFDictionaryKeyCallBacks* kCFTypeDictionaryKeyCallBacks;
    CFDictionaryValueCallBacks* kCFTypeDictionaryValueCallBacks;

    // Trust settings dictionary keys.
    //
    // kSecTrustSettings{Policy,Application,PolicyString,Result} are *not*
    // exported as data symbols from Security.framework — SecTrustSettings.h
    // declares them as `#define ... CFSTR("...")` macros expanded at compile
    // time. Since this loader resolves symbols via dlsym, those four keys must
    // be constructed at runtime with CFStringCreateWithCString. kSecPolicyOid
    // and kSecPolicyAppleSSL *are* exported and can be dlsym'd as usual.
    CFStringRef kSecTrustSettingsApplication;
    CFStringRef kSecTrustSettingsPolicy;
    CFStringRef kSecTrustSettingsPolicyString;
    CFStringRef kSecTrustSettingsResult;
    CFStringRef kSecPolicyOid;
    CFStringRef kSecPolicyAppleSSL;

    // Core Foundation function pointers
    CFMutableArrayRef (*CFArrayCreateMutable)(CFAllocatorRef allocator, CFIndex capacity, const CFArrayCallBacks *callBacks);
    void (*CFArraySetValueAtIndex)(CFMutableArrayRef theArray, CFIndex idx, const void *value);
    const void* (*CFArrayGetValueAtIndex)(CFArrayRef theArray, CFIndex idx);
    CFIndex (*CFArrayGetCount)(CFArrayRef theArray);
    void (*CFRelease)(CFTypeRef cf);
    CFDictionaryRef (*CFDictionaryCreate)(CFAllocatorRef allocator, const void **keys, const void **values, CFIndex numValues, const CFDictionaryKeyCallBacks *keyCallBacks, const CFDictionaryValueCallBacks *valueCallBacks);
    Boolean (*CFDictionaryContainsKey)(CFDictionaryRef theDict, const void *key);
    const void* (*CFDictionaryGetValue)(CFDictionaryRef theDict, const void *key);
    Boolean (*CFNumberGetValue)(CFNumberRef number, CFNumberType theType, void *valuePtr);
    Boolean (*CFEqual)(CFTypeRef cf1, CFTypeRef cf2);
    CFStringRef (*CFStringCreateWithCString)(CFAllocatorRef alloc, const char *cStr, CFStringEncoding encoding);
    const UInt8* (*CFDataGetBytePtr)(CFDataRef theData);
    CFIndex (*CFDataGetLength)(CFDataRef theData);

    // Security framework function pointers
    OSStatus (*SecItemCopyMatching)(CFDictionaryRef query, CFTypeRef *result);
    CFDataRef (*SecCertificateCopyData)(SecCertificateRef certificate);
    OSStatus (*SecTrustCreateWithCertificates)(CFArrayRef certificates, CFArrayRef policies, SecTrustRef *trust);
    SecPolicyRef (*SecPolicyCreateBasicX509)(void);
    CFDictionaryRef (*SecPolicyCopyProperties)(SecPolicyRef policyRef);
    Boolean (*SecTrustEvaluateWithError)(SecTrustRef trust, CFErrorRef *error);
    OSStatus (*SecTrustSetNetworkFetchAllowed)(SecTrustRef trust, Boolean allowFetch);
    OSStatus (*SecTrustSettingsCopyTrustSettings)(SecCertificateRef certRef, SecTrustSettingsDomain domain, CFArrayRef *trustSettings);

    SecurityFramework() : handle(nullptr), cf_handle(nullptr),
                         kSecClass(nullptr), kSecClassCertificate(nullptr),
                         kSecMatchLimit(nullptr), kSecMatchLimitAll(nullptr),
                         kSecReturnRef(nullptr), kCFBooleanTrue(nullptr),
                         kCFAllocatorDefault(nullptr), kCFTypeArrayCallBacks(nullptr),
                         kCFTypeDictionaryKeyCallBacks(nullptr), kCFTypeDictionaryValueCallBacks(nullptr),
                         kSecTrustSettingsApplication(nullptr), kSecTrustSettingsPolicy(nullptr),
                         kSecTrustSettingsPolicyString(nullptr), kSecTrustSettingsResult(nullptr),
                         kSecPolicyOid(nullptr), kSecPolicyAppleSSL(nullptr),
                         CFArrayCreateMutable(nullptr), CFArraySetValueAtIndex(nullptr),
                         CFArrayGetValueAtIndex(nullptr), CFArrayGetCount(nullptr), CFRelease(nullptr),
                         CFDictionaryCreate(nullptr), CFDictionaryContainsKey(nullptr),
                         CFDictionaryGetValue(nullptr), CFNumberGetValue(nullptr), CFEqual(nullptr),
                         CFStringCreateWithCString(nullptr), CFDataGetBytePtr(nullptr), CFDataGetLength(nullptr),
                         SecItemCopyMatching(nullptr), SecCertificateCopyData(nullptr),
                         SecTrustCreateWithCertificates(nullptr), SecPolicyCreateBasicX509(nullptr),
                         SecPolicyCopyProperties(nullptr), SecTrustEvaluateWithError(nullptr),
                         SecTrustSetNetworkFetchAllowed(nullptr), SecTrustSettingsCopyTrustSettings(nullptr) {}

    ~SecurityFramework() {
        // Release runtime-created CFStrings before tearing down CF.
        if (CFRelease) {
            if (kSecTrustSettingsApplication) CFRelease(kSecTrustSettingsApplication);
            if (kSecTrustSettingsPolicy) CFRelease(kSecTrustSettingsPolicy);
            if (kSecTrustSettingsPolicyString) CFRelease(kSecTrustSettingsPolicyString);
            if (kSecTrustSettingsResult) CFRelease(kSecTrustSettingsResult);
        }
        if (handle) {
            dlclose(handle);
        }
        if (cf_handle) {
            dlclose(cf_handle);
        }
    }

    bool load() {
        if (handle && cf_handle) return true; // Already loaded

        // Load CoreFoundation framework
        cf_handle = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", RTLD_LAZY | RTLD_LOCAL);
        if (!cf_handle) {
            fprintf(stderr, "Failed to load CoreFoundation framework: %s\n", dlerror());
            return false;
        }

        // Load Security framework
        handle = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_LAZY | RTLD_LOCAL);
        if (!handle) {
            fprintf(stderr, "Failed to load Security framework: %s\n", dlerror());
            dlclose(cf_handle);
            cf_handle = nullptr;
            return false;
        }

        // Load function pointers first — load_constants() needs
        // CFStringCreateWithCString to materialize the kSecTrustSettings* keys.
        if (!load_functions()) {
            if (handle) {
                dlclose(handle);
                handle = nullptr;
            }
            if (cf_handle) {
                dlclose(cf_handle);
                cf_handle = nullptr;
            }
            return false;
        }

        if (!load_constants()) {
            if (handle) {
                dlclose(handle);
                handle = nullptr;
            }
            if (cf_handle) {
                dlclose(cf_handle);
                cf_handle = nullptr;
            }
            return false;
        }

        return true;
    }

private:
    bool load_string_constant(void* lib, const char* name, CFStringRef* out) {
        void* ptr = dlsym(lib, name);
        if (!ptr) { fprintf(stderr, "DEBUG: %s not found\n", name); return false; }
        *out = *(CFStringRef*)ptr;
        return true;
    }

    // The kSecTrustSettings* dictionary keys are `#define ... CFSTR("...")`
    // macros in SecTrustSettings.h, not exported data symbols, so they must be
    // built at runtime instead of dlsym'd.
    bool make_string_constant(const char* str, CFStringRef* out) {
        *out = CFStringCreateWithCString(kCFAllocatorDefault, str, kCFStringEncodingASCII);
        if (!*out) { fprintf(stderr, "DEBUG: failed to create CFString %s\n", str); return false; }
        return true;
    }

    bool load_constants() {
        // Load Security framework constants
        if (!load_string_constant(handle, "kSecClass", &kSecClass)) return false;
        if (!load_string_constant(handle, "kSecClassCertificate", &kSecClassCertificate)) return false;
        if (!load_string_constant(handle, "kSecMatchLimit", &kSecMatchLimit)) return false;
        if (!load_string_constant(handle, "kSecMatchLimitAll", &kSecMatchLimitAll)) return false;
        if (!load_string_constant(handle, "kSecReturnRef", &kSecReturnRef)) return false;
        if (!load_string_constant(handle, "kSecPolicyOid", &kSecPolicyOid)) return false;
        if (!load_string_constant(handle, "kSecPolicyAppleSSL", &kSecPolicyAppleSSL)) return false;

        // Load CoreFoundation constants
        void* ptr = dlsym(cf_handle, "kCFBooleanTrue");
        if (!ptr) { fprintf(stderr, "DEBUG: kCFBooleanTrue not found\n"); return false; }
        kCFBooleanTrue = *(CFBooleanRef*)ptr;

        ptr = dlsym(cf_handle, "kCFAllocatorDefault");
        if (!ptr) { fprintf(stderr, "DEBUG: kCFAllocatorDefault not found\n"); return false; }
        kCFAllocatorDefault = *(CFAllocatorRef*)ptr;

        ptr = dlsym(cf_handle, "kCFTypeArrayCallBacks");
        if (!ptr) { fprintf(stderr, "DEBUG: kCFTypeArrayCallBacks not found\n"); return false; }
        kCFTypeArrayCallBacks = (CFArrayCallBacks*)ptr;

        ptr = dlsym(cf_handle, "kCFTypeDictionaryKeyCallBacks");
        if (!ptr) { fprintf(stderr, "DEBUG: kCFTypeDictionaryKeyCallBacks not found\n"); return false; }
        kCFTypeDictionaryKeyCallBacks = (CFDictionaryKeyCallBacks*)ptr;

        ptr = dlsym(cf_handle, "kCFTypeDictionaryValueCallBacks");
        if (!ptr) { fprintf(stderr, "DEBUG: kCFTypeDictionaryValueCallBacks not found\n"); return false; }
        kCFTypeDictionaryValueCallBacks = (CFDictionaryValueCallBacks*)ptr;

        // Trust settings dictionary keys (CFSTR macros, see make_string_constant).
        if (!make_string_constant("kSecTrustSettingsApplication", &kSecTrustSettingsApplication)) return false;
        if (!make_string_constant("kSecTrustSettingsPolicy", &kSecTrustSettingsPolicy)) return false;
        if (!make_string_constant("kSecTrustSettingsPolicyString", &kSecTrustSettingsPolicyString)) return false;
        if (!make_string_constant("kSecTrustSettingsResult", &kSecTrustSettingsResult)) return false;

        return true;
    }

    bool load_functions() {
        // Load CoreFoundation functions
        CFArrayCreateMutable = (CFMutableArrayRef (*)(CFAllocatorRef, CFIndex, const CFArrayCallBacks*))dlsym(cf_handle, "CFArrayCreateMutable");
        CFArraySetValueAtIndex = (void (*)(CFMutableArrayRef, CFIndex, const void*))dlsym(cf_handle, "CFArraySetValueAtIndex");
        CFArrayGetValueAtIndex = (const void* (*)(CFArrayRef, CFIndex))dlsym(cf_handle, "CFArrayGetValueAtIndex");
        CFArrayGetCount = (CFIndex (*)(CFArrayRef))dlsym(cf_handle, "CFArrayGetCount");
        CFRelease = (void (*)(CFTypeRef))dlsym(cf_handle, "CFRelease");
        CFDictionaryCreate = (CFDictionaryRef (*)(CFAllocatorRef, const void**, const void**, CFIndex, const CFDictionaryKeyCallBacks*, const CFDictionaryValueCallBacks*))dlsym(cf_handle, "CFDictionaryCreate");
        CFDictionaryContainsKey = (Boolean (*)(CFDictionaryRef, const void*))dlsym(cf_handle, "CFDictionaryContainsKey");
        CFDictionaryGetValue = (const void* (*)(CFDictionaryRef, const void*))dlsym(cf_handle, "CFDictionaryGetValue");
        CFNumberGetValue = (Boolean (*)(CFNumberRef, CFNumberType, void*))dlsym(cf_handle, "CFNumberGetValue");
        CFEqual = (Boolean (*)(CFTypeRef, CFTypeRef))dlsym(cf_handle, "CFEqual");
        CFStringCreateWithCString = (CFStringRef (*)(CFAllocatorRef, const char*, CFStringEncoding))dlsym(cf_handle, "CFStringCreateWithCString");
        CFDataGetBytePtr = (const UInt8* (*)(CFDataRef))dlsym(cf_handle, "CFDataGetBytePtr");
        CFDataGetLength = (CFIndex (*)(CFDataRef))dlsym(cf_handle, "CFDataGetLength");

        // Load Security framework functions
        SecItemCopyMatching = (OSStatus (*)(CFDictionaryRef, CFTypeRef*))dlsym(handle, "SecItemCopyMatching");
        SecCertificateCopyData = (CFDataRef (*)(SecCertificateRef))dlsym(handle, "SecCertificateCopyData");
        SecTrustCreateWithCertificates = (OSStatus (*)(CFArrayRef, CFArrayRef, SecTrustRef*))dlsym(handle, "SecTrustCreateWithCertificates");
        SecPolicyCreateBasicX509 = (SecPolicyRef (*)(void))dlsym(handle, "SecPolicyCreateBasicX509");
        SecPolicyCopyProperties = (CFDictionaryRef (*)(SecPolicyRef))dlsym(handle, "SecPolicyCopyProperties");
        SecTrustEvaluateWithError = (Boolean (*)(SecTrustRef, CFErrorRef*))dlsym(handle, "SecTrustEvaluateWithError");
        // Optional: present since macOS 10.9, used purely as a perf hint.
        SecTrustSetNetworkFetchAllowed = (OSStatus (*)(SecTrustRef, Boolean))dlsym(handle, "SecTrustSetNetworkFetchAllowed");
        SecTrustSettingsCopyTrustSettings = (OSStatus (*)(SecCertificateRef, SecTrustSettingsDomain, CFArrayRef*))dlsym(handle, "SecTrustSettingsCopyTrustSettings");

        return CFArrayCreateMutable && CFArraySetValueAtIndex &&
               CFArrayGetValueAtIndex && CFArrayGetCount && CFRelease &&
               CFDictionaryCreate && CFDictionaryContainsKey && CFDictionaryGetValue &&
               CFNumberGetValue && CFEqual && CFStringCreateWithCString &&
               CFDataGetBytePtr && CFDataGetLength &&
               SecItemCopyMatching && SecCertificateCopyData &&
               SecTrustCreateWithCertificates && SecPolicyCreateBasicX509 &&
               SecPolicyCopyProperties && SecTrustEvaluateWithError &&
               SecTrustSettingsCopyTrustSettings;
    }
};

// Global instance for dynamic loading
static std::atomic<SecurityFramework*> g_security_framework{nullptr};

static SecurityFramework* get_security_framework() {
    SecurityFramework* framework = g_security_framework.load();
    if (!framework) {
        SecurityFramework* new_framework = new SecurityFramework();
        if (new_framework->load()) {
            SecurityFramework* expected = nullptr;
            if (g_security_framework.compare_exchange_strong(expected, new_framework)) {
                framework = new_framework;
            } else {
                delete new_framework;
                framework = expected;
            }
        } else {
            delete new_framework;
            framework = nullptr;
        }
    }
    return framework;
}

// Helper function to determine if a certificate is self-issued
static bool is_certificate_self_issued(X509* cert) {
    X509_NAME* subject = X509_get_subject_name(cert);
    X509_NAME* issuer = X509_get_issuer_name(cert);

    return subject && issuer && X509_NAME_cmp(subject, issuer) == 0;
}

// Validate that a certificate without explicit trust settings still chains to
// a trusted anchor. Used only as a fallback when SecTrustSettingsCopyTrustSettings
// resolves to UNSPECIFIED in every domain. This is enumeration, not connection-time
// validation, so:
//
//  - Use SecPolicyCreateBasicX509 (not SecPolicyCreateSSL): the SSL policy makes
//    trustd attempt OCSP/CRL/AIA fetches per cert. On managed Macs running a
//    NetworkExtension content filter, every denied flow still pays per-flow
//    crypto-signing overhead, turning enumeration into a multi-second startup
//    stall. BasicX509 builds the chain without touching the network. EKU/server-auth
//    is enforced by OpenSSL at handshake time against the resulting trust store.
//
//  - SecTrustSetNetworkFetchAllowed(false): also skip AIA fetches for missing
//    intermediates. We're only interested in whether *this* cert is a trust anchor,
//    not in completing an arbitrary chain.
static bool is_certificate_trust_valid(SecurityFramework* security, SecCertificateRef cert_ref) {
    CFMutableArrayRef subj_certs = security->CFArrayCreateMutable(nullptr, 1, security->kCFTypeArrayCallBacks);
    if (!subj_certs) return false;

    security->CFArraySetValueAtIndex(subj_certs, 0, cert_ref);

    SecPolicyRef policy = security->SecPolicyCreateBasicX509();
    if (!policy) {
        security->CFRelease(subj_certs);
        return false;
    }

    SecTrustRef sec_trust = nullptr;
    // SecTrustCreateWithCertificates accepts a single SecPolicyRef in place of
    // an array (matches Node.js's IsCertificateTrustValid).
    OSStatus ortn = security->SecTrustCreateWithCertificates(subj_certs, (CFArrayRef)policy, &sec_trust);

    bool result = false;
    if (ortn == errSecSuccess && sec_trust) {
        if (security->SecTrustSetNetworkFetchAllowed) {
            security->SecTrustSetNetworkFetchAllowed(sec_trust, false);
        }
        result = security->SecTrustEvaluateWithError(sec_trust, nullptr);
    }

    // Cleanup
    if (sec_trust) security->CFRelease(sec_trust);
    security->CFRelease(policy);
    security->CFRelease(subj_certs);

    return result;
}

// Parse a single trust-settings dictionary entry. Mirrors Node.js's
// IsTrustDictionaryTrustedForPolicy (src/crypto/crypto_context.cc), itself
// loosely based on Chromium's net/cert/internal/trust_store_mac.cc.
static TrustStatus is_trust_dictionary_trusted_for_policy(SecurityFramework* security, CFDictionaryRef trust_dict, bool is_self_issued) {
    // Trust settings may be scoped to a single application — not supported, skip.
    if (security->CFDictionaryContainsKey(trust_dict, security->kSecTrustSettingsApplication)) {
        return TrustStatus::UNSPECIFIED;
    }

    // Trust settings may be scoped using policy-specific constraints
    // (e.g. SSL trust scoped to a hostname). Not supported, skip.
    if (security->CFDictionaryContainsKey(trust_dict, security->kSecTrustSettingsPolicyString)) {
        return TrustStatus::UNSPECIFIED;
    }

    // If scoped to a specific policy via kSecTrustSettingsPolicy, only honor
    // entries whose policy OID is kSecPolicyAppleSSL. Absent that key, the
    // entry applies to all policies.
    if (security->CFDictionaryContainsKey(trust_dict, security->kSecTrustSettingsPolicy)) {
        SecPolicyRef policy_ref = (SecPolicyRef)security->CFDictionaryGetValue(trust_dict, security->kSecTrustSettingsPolicy);
        if (!policy_ref) {
            return TrustStatus::UNSPECIFIED;
        }
        CFDictionaryRef policy_dict = security->SecPolicyCopyProperties(policy_ref);
        if (!policy_dict) {
            return TrustStatus::UNSPECIFIED;
        }
        CFStringRef policy_oid = (CFStringRef)security->CFDictionaryGetValue(policy_dict, security->kSecPolicyOid);
        bool is_ssl = policy_oid && security->CFEqual(policy_oid, security->kSecPolicyAppleSSL);
        security->CFRelease(policy_dict);
        if (!is_ssl) {
            return TrustStatus::UNSPECIFIED;
        }
    }

    // kSecTrustSettingsResult defaults to kSecTrustSettingsResultTrustRoot when
    // absent (per Apple's SecTrustSettings.h docs).
    int trust_settings_result = kSecTrustSettingsResultTrustRoot;
    if (security->CFDictionaryContainsKey(trust_dict, security->kSecTrustSettingsResult)) {
        CFNumberRef result_ref = (CFNumberRef)security->CFDictionaryGetValue(trust_dict, security->kSecTrustSettingsResult);
        if (!result_ref || !security->CFNumberGetValue(result_ref, kCFNumberIntType, &trust_settings_result)) {
            return TrustStatus::UNSPECIFIED;
        }
    }

    if (trust_settings_result == kSecTrustSettingsResultDeny) {
        return TrustStatus::DISTRUSTED;
    }

    // Allow either kSecTrustSettingsResultTrustRoot or kSecTrustSettingsResultTrustAsRoot
    // for self-issued certs (SecTrustSetTrustSettings shouldn't permit creating an
    // invalid trust record). For non-roots only TrustAsRoot applies.
    if (is_self_issued) {
        return (trust_settings_result == kSecTrustSettingsResultTrustRoot ||
                trust_settings_result == kSecTrustSettingsResultTrustAsRoot)
                   ? TrustStatus::TRUSTED
                   : TrustStatus::UNSPECIFIED;
    }
    return (trust_settings_result == kSecTrustSettingsResultTrustAsRoot)
               ? TrustStatus::TRUSTED
               : TrustStatus::UNSPECIFIED;
}

// Walk the trust-settings array for one domain. Mirrors Node.js's
// IsTrustSettingsTrustedForPolicy.
static TrustStatus is_trust_settings_trusted_for_policy(SecurityFramework* security, CFArrayRef trust_settings, bool is_self_issued) {
    if (!trust_settings) {
        return TrustStatus::UNSPECIFIED;
    }

    // An empty trust-settings array means "always trust this certificate"
    // with overall trust kSecTrustSettingsResultTrustRoot.
    CFIndex count = security->CFArrayGetCount(trust_settings);
    if (count == 0) {
        return is_self_issued ? TrustStatus::TRUSTED : TrustStatus::UNSPECIFIED;
    }

    for (CFIndex i = 0; i < count; ++i) {
        CFDictionaryRef trust_dict = (CFDictionaryRef)security->CFArrayGetValueAtIndex(trust_settings, i);
        if (!trust_dict) continue;
        TrustStatus result = is_trust_dictionary_trusted_for_policy(security, trust_dict, is_self_issued);
        if (result != TrustStatus::UNSPECIFIED) {
            return result;
        }
    }
    return TrustStatus::UNSPECIFIED;
}

// Decide whether a keychain certificate should be included as a trust anchor.
//
// Trust settings are checked across all three domains in override-priority
// order (user > admin > system). The expensive SecTrustEvaluateWithError
// fallback only runs for certs that have no decisive settings in *any* domain —
// SecTrustSettingsCopyTrustSettings is a cheap local lookup, so deferring trust
// evaluation until after every domain is consulted both avoids redundant XPC
// round-trips to securityd and respects an explicit Deny in a later domain.
static bool is_certificate_trusted_for_policy(SecurityFramework* security, X509* cert, SecCertificateRef cert_ref) {
    bool is_self_issued = is_certificate_self_issued(cert);

    for (const auto& trust_domain : {kSecTrustSettingsDomainUser, kSecTrustSettingsDomainAdmin, kSecTrustSettingsDomainSystem}) {
        CFArrayRef trust_settings = nullptr;
        OSStatus err = security->SecTrustSettingsCopyTrustSettings(cert_ref, trust_domain, &trust_settings);

        if (err != errSecSuccess && err != errSecItemNotFound) {
            continue;
        }

        if (err == errSecSuccess && trust_settings) {
            TrustStatus result = is_trust_settings_trusted_for_policy(security, trust_settings, is_self_issued);
            security->CFRelease(trust_settings);

            if (result == TrustStatus::TRUSTED) {
                return true;
            }
            if (result == TrustStatus::DISTRUSTED) {
                return false;
            }
        }
    }

    // No domain had decisive trust settings. Fall back to chain validation:
    // a cert without explicit settings is still a usable anchor if macOS
    // considers it valid.
    return is_certificate_trust_valid(security, cert_ref);
}

// Main function to load system certificates on macOS
extern "C" void us_load_system_certificates_macos(STACK_OF(X509) **system_certs) {
    *system_certs = sk_X509_new_null();
    if (!*system_certs) {
        return;
    }

    SecurityFramework* security = get_security_framework();
    if (!security) {
        return; // Fail silently
    }

    // Enumerate all certificates in the keychain. Trust filtering happens per
    // cert below — kSecMatchTrustedOnly is intentionally not used because it
    // forces trustd to evaluate every keychain cert with the default
    // (network-revocation-enabled) policy before we even start.
    CFTypeRef search_keys[] = {
        security->kSecClass,
        security->kSecMatchLimit,
        security->kSecReturnRef,
    };
    CFTypeRef search_values[] = {
        security->kSecClassCertificate,
        security->kSecMatchLimitAll,
        security->kCFBooleanTrue,
    };

    CFDictionaryRef search = security->CFDictionaryCreate(
        security->kCFAllocatorDefault,
        search_keys,
        search_values,
        3,
        security->kCFTypeDictionaryKeyCallBacks,
        security->kCFTypeDictionaryValueCallBacks
    );

    if (!search) {
        return;
    }

    CFArrayRef certificates = nullptr;
    OSStatus status = security->SecItemCopyMatching(search, (CFTypeRef*)&certificates);
    security->CFRelease(search);

    if (status != errSecSuccess || !certificates) {
        return;
    }

    CFIndex count = security->CFArrayGetCount(certificates);

    for (CFIndex i = 0; i < count; ++i) {
        SecCertificateRef cert_ref = (SecCertificateRef)security->CFArrayGetValueAtIndex(certificates, i);
        if (!cert_ref) continue;

        // Get certificate data
        CFDataRef cert_data = security->SecCertificateCopyData(cert_ref);
        if (!cert_data) continue;

        // Convert to X509
        const unsigned char* data_ptr = security->CFDataGetBytePtr(cert_data);
        long data_len = security->CFDataGetLength(cert_data);
        X509* x509_cert = d2i_X509(nullptr, &data_ptr, data_len);
        security->CFRelease(cert_data);

        if (!x509_cert) continue;

        // Only consider CA certificates
        if (X509_check_ca(x509_cert) == 1 &&
            is_certificate_trusted_for_policy(security, x509_cert, cert_ref)) {
            sk_X509_push(*system_certs, x509_cert);
        } else {
            X509_free(x509_cert);
        }
    }

    security->CFRelease(certificates);
}

// Cleanup function for Security framework
extern "C" void us_cleanup_security_framework() {
    SecurityFramework* framework = g_security_framework.exchange(nullptr);
    if (framework) {
        delete framework;
    }
}

#endif // __APPLE__
