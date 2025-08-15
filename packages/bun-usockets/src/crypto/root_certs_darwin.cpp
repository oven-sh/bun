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
        
        // Load Security framework constants
        if (!load_constants()) {
            dlclose(handle);
            handle = nullptr;
            return false;
        }
        
        // Load Security framework functions
        if (!load_functions()) {
            dlclose(handle);
            handle = nullptr;
            return false;
        }
        
        return true;
    }

private:
    bool load_constants() {
        kSecClass = *(CFStringRef*)dlsym(handle, "kSecClass");
        kSecClassCertificate = *(CFStringRef*)dlsym(handle, "kSecClassCertificate");
        kSecMatchLimit = *(CFStringRef*)dlsym(handle, "kSecMatchLimit");
        kSecMatchLimitAll = *(CFStringRef*)dlsym(handle, "kSecMatchLimitAll");
        kSecReturnRef = *(CFStringRef*)dlsym(handle, "kSecReturnRef");
        
        // Load CoreFoundation constants
        void* cf_handle = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", RTLD_LAZY | RTLD_LOCAL);
        if (cf_handle) {
            kCFBooleanTrue = *(CFBooleanRef*)dlsym(cf_handle, "kCFBooleanTrue");
            dlclose(cf_handle);
        }
        
        return kSecClass && kSecClassCertificate && kSecMatchLimit && 
               kSecMatchLimitAll && kSecReturnRef && kCFBooleanTrue;
    }
    
    bool load_functions() {
        SecItemCopyMatching = (OSStatus (*)(CFDictionaryRef, CFTypeRef*))dlsym(handle, "SecItemCopyMatching");
        SecCertificateCopyData = (CFDataRef (*)(SecCertificateRef))dlsym(handle, "SecCertificateCopyData");
        SecTrustCreateWithCertificates = (OSStatus (*)(CFArrayRef, CFArrayRef, SecTrustRef*))dlsym(handle, "SecTrustCreateWithCertificates");
        SecPolicyCreateSSL = (SecPolicyRef (*)(Boolean, CFStringRef))dlsym(handle, "SecPolicyCreateSSL");
        SecTrustEvaluateWithError = (Boolean (*)(SecTrustRef, CFErrorRef*))dlsym(handle, "SecTrustEvaluateWithError");
        SecTrustSettingsCopyTrustSettings = (OSStatus (*)(SecCertificateRef, SecTrustSettingsDomain, CFArrayRef*))dlsym(handle, "SecTrustSettingsCopyTrustSettings");
        
        return SecItemCopyMatching && SecCertificateCopyData &&
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
    CFMutableArrayRef subj_certs = CFArrayCreateMutable(nullptr, 1, &kCFTypeArrayCallBacks);
    if (!subj_certs) return false;
    
    CFArraySetValueAtIndex(subj_certs, 0, cert_ref);
    
    SecPolicyRef policy = security->SecPolicyCreateSSL(false, nullptr);
    if (!policy) {
        CFRelease(subj_certs);
        return false;
    }
    
    CFArrayRef policies = CFArrayCreate(nullptr, (const void**)&policy, 1, &kCFTypeArrayCallBacks);
    if (!policies) {
        CFRelease(policy);
        CFRelease(subj_certs);
        return false;
    }
    
    SecTrustRef sec_trust = nullptr;
    OSStatus ortn = security->SecTrustCreateWithCertificates(subj_certs, policies, &sec_trust);
    
    bool result = false;
    if (ortn == errSecSuccess && sec_trust) {
        result = security->SecTrustEvaluateWithError(sec_trust, nullptr);
    }
    
    // Cleanup
    if (sec_trust) CFRelease(sec_trust);
    CFRelease(policies);
    CFRelease(policy);
    CFRelease(subj_certs);
    
    return result;
}

// Check trust settings for policy (simplified version)
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
static bool is_certificate_trusted_for_policy(SecurityFramework* security, X509* cert, SecCertificateRef cert_ref) {
    bool is_self_issued = is_certificate_self_issued(cert);
    bool trust_evaluated = false;
    
    // Check user trust domain, then admin domain
    for (const auto& trust_domain : {kSecTrustSettingsDomainUser, kSecTrustSettingsDomainAdmin}) {
        CFArrayRef trust_settings = nullptr;
        OSStatus err = security->SecTrustSettingsCopyTrustSettings(cert_ref, trust_domain, &trust_settings);
        
        if (err != errSecSuccess && err != errSecItemNotFound) {
            continue;
        }
        
        if (err == errSecSuccess && trust_settings) {
            TrustStatus result = is_trust_settings_trusted_for_policy(trust_settings, is_self_issued);
            CFRelease(trust_settings);
            
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

    if (!search) {
        return;
    }

    CFArrayRef certificates = nullptr;
    OSStatus status = security->SecItemCopyMatching(search, (CFTypeRef*)&certificates);
    CFRelease(search);

    if (status != errSecSuccess || !certificates) {
        return;
    }

    CFIndex count = CFArrayGetCount(certificates);
    
    for (CFIndex i = 0; i < count; ++i) {
        SecCertificateRef cert_ref = (SecCertificateRef)CFArrayGetValueAtIndex(certificates, i);
        if (!cert_ref) continue;
        
        // Get certificate data
        CFDataRef cert_data = security->SecCertificateCopyData(cert_ref);
        if (!cert_data) continue;
        
        // Convert to X509
        const unsigned char* data_ptr = CFDataGetBytePtr(cert_data);
        long data_len = CFDataGetLength(cert_data);
        X509* x509_cert = d2i_X509(nullptr, &data_ptr, data_len);
        CFRelease(cert_data);
        
        if (!x509_cert) continue;
        
        // Check if certificate is trusted for server authentication
        if (is_certificate_trusted_for_policy(security, x509_cert, cert_ref)) {
            sk_X509_push(*system_certs, x509_cert);
        } else {
            X509_free(x509_cert);
        }
    }
    
    CFRelease(certificates);
}

// Cleanup function for Security framework
extern "C" void us_cleanup_security_framework() {
    SecurityFramework* framework = g_security_framework.exchange(nullptr);
    if (framework) {
        delete framework;
    }
}

#endif // __APPLE__