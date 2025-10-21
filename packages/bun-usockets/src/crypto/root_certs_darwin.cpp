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
    CFStringRef kSecMatchTrustedOnly;
    CFBooleanRef kCFBooleanTrue;
    CFAllocatorRef kCFAllocatorDefault;
    CFArrayCallBacks* kCFTypeArrayCallBacks;
    CFDictionaryKeyCallBacks* kCFTypeDictionaryKeyCallBacks;
    CFDictionaryValueCallBacks* kCFTypeDictionaryValueCallBacks;
    
    // Core Foundation function pointers
    CFMutableArrayRef (*CFArrayCreateMutable)(CFAllocatorRef allocator, CFIndex capacity, const CFArrayCallBacks *callBacks);
    CFArrayRef (*CFArrayCreate)(CFAllocatorRef allocator, const void **values, CFIndex numValues, const CFArrayCallBacks *callBacks);
    void (*CFArraySetValueAtIndex)(CFMutableArrayRef theArray, CFIndex idx, const void *value);
    const void* (*CFArrayGetValueAtIndex)(CFArrayRef theArray, CFIndex idx);
    CFIndex (*CFArrayGetCount)(CFArrayRef theArray);
    void (*CFRelease)(CFTypeRef cf);
    CFDictionaryRef (*CFDictionaryCreate)(CFAllocatorRef allocator, const void **keys, const void **values, CFIndex numValues, const CFDictionaryKeyCallBacks *keyCallBacks, const CFDictionaryValueCallBacks *valueCallBacks);
    const UInt8* (*CFDataGetBytePtr)(CFDataRef theData);
    CFIndex (*CFDataGetLength)(CFDataRef theData);
    
    // Security framework function pointers
    OSStatus (*SecItemCopyMatching)(CFDictionaryRef query, CFTypeRef *result);
    CFDataRef (*SecCertificateCopyData)(SecCertificateRef certificate);
    OSStatus (*SecTrustCreateWithCertificates)(CFArrayRef certificates, CFArrayRef policies, SecTrustRef *trust);
    SecPolicyRef (*SecPolicyCreateSSL)(Boolean server, CFStringRef hostname);
    Boolean (*SecTrustEvaluateWithError)(SecTrustRef trust, CFErrorRef *error);
    OSStatus (*SecTrustSettingsCopyTrustSettings)(SecCertificateRef certRef, SecTrustSettingsDomain domain, CFArrayRef *trustSettings);
    
    SecurityFramework() : handle(nullptr), cf_handle(nullptr),
                         kSecClass(nullptr), kSecClassCertificate(nullptr),
                         kSecMatchLimit(nullptr), kSecMatchLimitAll(nullptr),
                         kSecReturnRef(nullptr), kSecMatchTrustedOnly(nullptr), kCFBooleanTrue(nullptr),
                         kCFAllocatorDefault(nullptr), kCFTypeArrayCallBacks(nullptr),
                         kCFTypeDictionaryKeyCallBacks(nullptr), kCFTypeDictionaryValueCallBacks(nullptr),
                         CFArrayCreateMutable(nullptr), CFArrayCreate(nullptr),
                         CFArraySetValueAtIndex(nullptr), CFArrayGetValueAtIndex(nullptr),
                         CFArrayGetCount(nullptr), CFRelease(nullptr),
                         CFDictionaryCreate(nullptr), CFDataGetBytePtr(nullptr), CFDataGetLength(nullptr),
                         SecItemCopyMatching(nullptr), SecCertificateCopyData(nullptr),
                         SecTrustCreateWithCertificates(nullptr), SecPolicyCreateSSL(nullptr),
                         SecTrustEvaluateWithError(nullptr), SecTrustSettingsCopyTrustSettings(nullptr) {}
    
    ~SecurityFramework() {
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
        
        // Load constants and functions
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
        
        return true;
    }

private:
    bool load_constants() {
        // Load Security framework constants
        void* ptr = dlsym(handle, "kSecClass");
        if (!ptr) { fprintf(stderr, "DEBUG: kSecClass not found\n"); return false; }
        kSecClass = *(CFStringRef*)ptr;
        
        ptr = dlsym(handle, "kSecClassCertificate");
        if (!ptr) { fprintf(stderr, "DEBUG: kSecClassCertificate not found\n"); return false; }
        kSecClassCertificate = *(CFStringRef*)ptr;
        
        ptr = dlsym(handle, "kSecMatchLimit");
        if (!ptr) { fprintf(stderr, "DEBUG: kSecMatchLimit not found\n"); return false; }
        kSecMatchLimit = *(CFStringRef*)ptr;
        
        ptr = dlsym(handle, "kSecMatchLimitAll");
        if (!ptr) { fprintf(stderr, "DEBUG: kSecMatchLimitAll not found\n"); return false; }
        kSecMatchLimitAll = *(CFStringRef*)ptr;
        
        ptr = dlsym(handle, "kSecReturnRef");
        if (!ptr) { fprintf(stderr, "DEBUG: kSecReturnRef not found\n"); return false; }
        kSecReturnRef = *(CFStringRef*)ptr;
        
        ptr = dlsym(handle, "kSecMatchTrustedOnly");
        if (!ptr) { fprintf(stderr, "DEBUG: kSecMatchTrustedOnly not found\n"); return false; }
        kSecMatchTrustedOnly = *(CFStringRef*)ptr;
        
        // Load CoreFoundation constants
        ptr = dlsym(cf_handle, "kCFBooleanTrue");
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
        
        return true;
    }
    
    bool load_functions() {
        // Load CoreFoundation functions
        CFArrayCreateMutable = (CFMutableArrayRef (*)(CFAllocatorRef, CFIndex, const CFArrayCallBacks*))dlsym(cf_handle, "CFArrayCreateMutable");
        CFArrayCreate = (CFArrayRef (*)(CFAllocatorRef, const void**, CFIndex, const CFArrayCallBacks*))dlsym(cf_handle, "CFArrayCreate");
        CFArraySetValueAtIndex = (void (*)(CFMutableArrayRef, CFIndex, const void*))dlsym(cf_handle, "CFArraySetValueAtIndex");
        CFArrayGetValueAtIndex = (const void* (*)(CFArrayRef, CFIndex))dlsym(cf_handle, "CFArrayGetValueAtIndex");
        CFArrayGetCount = (CFIndex (*)(CFArrayRef))dlsym(cf_handle, "CFArrayGetCount");
        CFRelease = (void (*)(CFTypeRef))dlsym(cf_handle, "CFRelease");
        CFDictionaryCreate = (CFDictionaryRef (*)(CFAllocatorRef, const void**, const void**, CFIndex, const CFDictionaryKeyCallBacks*, const CFDictionaryValueCallBacks*))dlsym(cf_handle, "CFDictionaryCreate");
        CFDataGetBytePtr = (const UInt8* (*)(CFDataRef))dlsym(cf_handle, "CFDataGetBytePtr");
        CFDataGetLength = (CFIndex (*)(CFDataRef))dlsym(cf_handle, "CFDataGetLength");
        
        // Load Security framework functions
        SecItemCopyMatching = (OSStatus (*)(CFDictionaryRef, CFTypeRef*))dlsym(handle, "SecItemCopyMatching");
        SecCertificateCopyData = (CFDataRef (*)(SecCertificateRef))dlsym(handle, "SecCertificateCopyData");
        SecTrustCreateWithCertificates = (OSStatus (*)(CFArrayRef, CFArrayRef, SecTrustRef*))dlsym(handle, "SecTrustCreateWithCertificates");
        SecPolicyCreateSSL = (SecPolicyRef (*)(Boolean, CFStringRef))dlsym(handle, "SecPolicyCreateSSL");
        SecTrustEvaluateWithError = (Boolean (*)(SecTrustRef, CFErrorRef*))dlsym(handle, "SecTrustEvaluateWithError");
        SecTrustSettingsCopyTrustSettings = (OSStatus (*)(SecCertificateRef, SecTrustSettingsDomain, CFArrayRef*))dlsym(handle, "SecTrustSettingsCopyTrustSettings");
        
        return CFArrayCreateMutable && CFArrayCreate && CFArraySetValueAtIndex &&
               CFArrayGetValueAtIndex && CFArrayGetCount && CFRelease &&
               CFDictionaryCreate && CFDataGetBytePtr && CFDataGetLength &&
               SecItemCopyMatching && SecCertificateCopyData &&
               SecTrustCreateWithCertificates && SecPolicyCreateSSL &&
               SecTrustEvaluateWithError && SecTrustSettingsCopyTrustSettings;
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

// Validate certificate trust using Security framework
static bool is_certificate_trust_valid(SecurityFramework* security, SecCertificateRef cert_ref) {
    CFMutableArrayRef subj_certs = security->CFArrayCreateMutable(nullptr, 1, security->kCFTypeArrayCallBacks);
    if (!subj_certs) return false;
    
    security->CFArraySetValueAtIndex(subj_certs, 0, cert_ref);
    
    SecPolicyRef policy = security->SecPolicyCreateSSL(true, nullptr);
    if (!policy) {
        security->CFRelease(subj_certs);
        return false;
    }
    
    CFArrayRef policies = security->CFArrayCreate(nullptr, (const void**)&policy, 1, security->kCFTypeArrayCallBacks);
    if (!policies) {
        security->CFRelease(policy);
        security->CFRelease(subj_certs);
        return false;
    }
    
    SecTrustRef sec_trust = nullptr;
    OSStatus ortn = security->SecTrustCreateWithCertificates(subj_certs, policies, &sec_trust);
    
    bool result = false;
    if (ortn == errSecSuccess && sec_trust) {
        result = security->SecTrustEvaluateWithError(sec_trust, nullptr);
    }
    
    // Cleanup
    if (sec_trust) security->CFRelease(sec_trust);
    security->CFRelease(policies);
    security->CFRelease(policy);
    security->CFRelease(subj_certs);
    
    return result;
}

// Check trust settings for policy (simplified version)
static TrustStatus is_trust_settings_trusted_for_policy(SecurityFramework* security, CFArrayRef trust_settings, bool is_self_issued) {
    if (!trust_settings) {
        return TrustStatus::UNSPECIFIED;
    }
    
    // Empty trust settings array means "always trust this certificate"
    if (security->CFArrayGetCount(trust_settings) == 0) {
        return is_self_issued ? TrustStatus::TRUSTED : TrustStatus::UNSPECIFIED;
    }
    
    // For simplicity, we'll do basic checking here
    // A full implementation would parse the trust dictionary entries
    return TrustStatus::UNSPECIFIED;
}

// Check if certificate is trusted for server auth policy
static bool is_certificate_trusted_for_policy(SecurityFramework* security, X509* cert, SecCertificateRef cert_ref) {
    bool is_self_issued = is_certificate_self_issued(cert);
    bool trust_evaluated = false;
    
    // Check user trust domain, then admin domain
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
            } else if (result == TrustStatus::DISTRUSTED) {
                return false;
            }
        }
        
        // If no trust settings and we haven't evaluated trust yet, check trust validity
        if (!trust_settings && !trust_evaluated) {
            if (is_certificate_trust_valid(security, cert_ref)) {
                return true;
            }
            trust_evaluated = true;
        }
    }
    
    return false;
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

    // Create search dictionary for certificates
    CFTypeRef search_keys[] = {
        security->kSecClass,
        security->kSecMatchLimit,
        security->kSecReturnRef,
        security->kSecMatchTrustedOnly,
    };
    CFTypeRef search_values[] = {
        security->kSecClassCertificate,
        security->kSecMatchLimitAll,
        security->kCFBooleanTrue,
        security->kCFBooleanTrue,
    };
    
    CFDictionaryRef search = security->CFDictionaryCreate(
        security->kCFAllocatorDefault,
        search_keys,
        search_values,
        4,
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