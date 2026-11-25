#include "root.h"

#if OS(DARWIN)

#include "OutPtr.h"
#include "Secrets.h"
#include <dlfcn.h>
#include <Security/Security.h>
#include <wtf/text/WTFString.h>
#include <wtf/Vector.h>
#include <wtf/NeverDestroyed.h>
#include <cstring>

namespace Bun {
namespace Secrets {

using namespace WTF;

template<typename T> using CFPtr = std::unique_ptr<std::remove_pointer_t<T>, void (*)(CFTypeRef)>;

class SecurityFramework {
public:
    void* handle;
    void* cf_handle;

    // Security framework constants
    CFStringRef kSecClass;
    CFStringRef kSecClassGenericPassword;
    CFStringRef kSecAttrService;
    CFStringRef kSecAttrAccount;
    CFStringRef kSecValueData;
    CFStringRef kSecReturnData;
    CFStringRef kSecAttrAccess;
    CFBooleanRef kCFBooleanTrue;
    CFAllocatorRef kCFAllocatorDefault;

    // Core Foundation function pointers
    void (*CFRelease)(CFTypeRef cf);
    CFStringRef (*CFStringCreateWithCString)(CFAllocatorRef alloc, const char* cStr, CFStringEncoding encoding);
    CFDataRef (*CFDataCreate)(CFAllocatorRef allocator, const UInt8* bytes, CFIndex length);
    const UInt8* (*CFDataGetBytePtr)(CFDataRef theData);
    CFIndex (*CFDataGetLength)(CFDataRef theData);
    CFMutableDictionaryRef (*CFDictionaryCreateMutable)(CFAllocatorRef allocator, CFIndex capacity,
        const CFDictionaryKeyCallBacks* keyCallBacks,
        const CFDictionaryValueCallBacks* valueCallBacks);
    void (*CFDictionaryAddValue)(CFMutableDictionaryRef theDict, const void* key, const void* value);
    CFDictionaryKeyCallBacks* kCFTypeDictionaryKeyCallBacks;
    CFDictionaryValueCallBacks* kCFTypeDictionaryValueCallBacks;

    // Security framework function pointers
    OSStatus (*SecItemAdd)(CFDictionaryRef attributes, CFTypeRef* result);
    OSStatus (*SecItemCopyMatching)(CFDictionaryRef query, CFTypeRef* result);
    OSStatus (*SecItemUpdate)(CFDictionaryRef query, CFDictionaryRef attributesToUpdate);
    OSStatus (*SecItemDelete)(CFDictionaryRef query);
    CFStringRef (*SecCopyErrorMessageString)(OSStatus status, void* reserved);
    OSStatus (*SecAccessCreate)(CFStringRef descriptor, CFArrayRef trustedList, SecAccessRef* accessRef);
    Boolean (*CFStringGetCString)(CFStringRef theString, char* buffer, CFIndex bufferSize, CFStringEncoding encoding);
    const char* (*CFStringGetCStringPtr)(CFStringRef theString, CFStringEncoding encoding);
    CFIndex (*CFStringGetLength)(CFStringRef theString);
    CFIndex (*CFStringGetMaximumSizeForEncoding)(CFIndex length, CFStringEncoding encoding);

    SecurityFramework()
        : handle(nullptr)
        , cf_handle(nullptr)
    {
    }

    template<typename T> CFPtr<T> adopt(T ref) const { return { ref, CFRelease }; }

    bool load()
    {
        if (handle && cf_handle) return true;

        cf_handle = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", RTLD_LAZY | RTLD_LOCAL);
        if (!cf_handle) {
            return false;
        }

        handle = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_LAZY | RTLD_LOCAL);
        if (!handle) {
            return false;
        }

        if (!load_constants() || !load_functions()) {
            return false;
        }

        return true;
    }

private:
    bool load_constants()
    {
        void* ptr = dlsym(handle, "kSecClass");
        if (!ptr) return false;
        kSecClass = *(CFStringRef*)ptr;

        ptr = dlsym(handle, "kSecClassGenericPassword");
        if (!ptr) return false;
        kSecClassGenericPassword = *(CFStringRef*)ptr;

        ptr = dlsym(handle, "kSecAttrService");
        if (!ptr) return false;
        kSecAttrService = *(CFStringRef*)ptr;

        ptr = dlsym(handle, "kSecAttrAccount");
        if (!ptr) return false;
        kSecAttrAccount = *(CFStringRef*)ptr;

        ptr = dlsym(handle, "kSecValueData");
        if (!ptr) return false;
        kSecValueData = *(CFStringRef*)ptr;

        ptr = dlsym(handle, "kSecReturnData");
        if (!ptr) return false;
        kSecReturnData = *(CFStringRef*)ptr;

        ptr = dlsym(handle, "kSecAttrAccess");
        if (!ptr) return false;
        kSecAttrAccess = *(CFStringRef*)ptr;

        ptr = dlsym(cf_handle, "kCFBooleanTrue");
        if (!ptr) return false;
        kCFBooleanTrue = *(CFBooleanRef*)ptr;

        ptr = dlsym(cf_handle, "kCFAllocatorDefault");
        if (!ptr) return false;
        kCFAllocatorDefault = *(CFAllocatorRef*)ptr;

        ptr = dlsym(cf_handle, "kCFTypeDictionaryKeyCallBacks");
        if (!ptr) return false;
        kCFTypeDictionaryKeyCallBacks = (CFDictionaryKeyCallBacks*)ptr;

        ptr = dlsym(cf_handle, "kCFTypeDictionaryValueCallBacks");
        if (!ptr) return false;
        kCFTypeDictionaryValueCallBacks = (CFDictionaryValueCallBacks*)ptr;

        return true;
    }

    bool load_functions()
    {
        CFRelease = (void (*)(CFTypeRef))dlsym(cf_handle, "CFRelease");
        CFStringCreateWithCString = (CFStringRef (*)(CFAllocatorRef, const char*, CFStringEncoding))dlsym(cf_handle, "CFStringCreateWithCString");
        CFDataCreate = (CFDataRef (*)(CFAllocatorRef, const UInt8*, CFIndex))dlsym(cf_handle, "CFDataCreate");
        CFDataGetBytePtr = (const UInt8* (*)(CFDataRef))dlsym(cf_handle, "CFDataGetBytePtr");
        CFDataGetLength = (CFIndex (*)(CFDataRef))dlsym(cf_handle, "CFDataGetLength");
        CFDictionaryCreateMutable = (CFMutableDictionaryRef (*)(CFAllocatorRef, CFIndex, const CFDictionaryKeyCallBacks*, const CFDictionaryValueCallBacks*))dlsym(cf_handle, "CFDictionaryCreateMutable");
        CFDictionaryAddValue = (void (*)(CFMutableDictionaryRef, const void*, const void*))dlsym(cf_handle, "CFDictionaryAddValue");
        CFStringGetCString = (Boolean (*)(CFStringRef, char*, CFIndex, CFStringEncoding))dlsym(cf_handle, "CFStringGetCString");
        CFStringGetCStringPtr = (const char* (*)(CFStringRef, CFStringEncoding))dlsym(cf_handle, "CFStringGetCStringPtr");
        CFStringGetLength = (CFIndex (*)(CFStringRef))dlsym(cf_handle, "CFStringGetLength");
        CFStringGetMaximumSizeForEncoding = (CFIndex (*)(CFIndex, CFStringEncoding))dlsym(cf_handle, "CFStringGetMaximumSizeForEncoding");

        SecItemAdd = (OSStatus (*)(CFDictionaryRef, CFTypeRef*))dlsym(handle, "SecItemAdd");
        SecItemCopyMatching = (OSStatus (*)(CFDictionaryRef, CFTypeRef*))dlsym(handle, "SecItemCopyMatching");
        SecItemUpdate = (OSStatus (*)(CFDictionaryRef, CFDictionaryRef))dlsym(handle, "SecItemUpdate");
        SecItemDelete = (OSStatus (*)(CFDictionaryRef))dlsym(handle, "SecItemDelete");
        SecCopyErrorMessageString = (CFStringRef (*)(OSStatus, void*))dlsym(handle, "SecCopyErrorMessageString");
        SecAccessCreate = (OSStatus (*)(CFStringRef, CFArrayRef, SecAccessRef*))dlsym(handle, "SecAccessCreate");

        return CFRelease && CFStringCreateWithCString && CFDataCreate && CFDataGetBytePtr && CFDataGetLength && CFDictionaryCreateMutable && CFDictionaryAddValue && SecItemAdd && SecItemCopyMatching && SecItemUpdate && SecItemDelete && SecCopyErrorMessageString && SecAccessCreate && CFStringGetCString && CFStringGetCStringPtr && CFStringGetLength && CFStringGetMaximumSizeForEncoding;
    }
};

static SecurityFramework* securityFramework()
{
    static LazyNeverDestroyed<SecurityFramework> framework;
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [&] {
        framework.construct();
        if (!framework->load()) {
            // Framework failed to load, but object is still constructed
        }
    });
    return framework->handle ? &framework.get() : nullptr;
}

static String CFStringToWTFString(CFStringRef cfstring)
{
    auto* framework = securityFramework();
    if (!framework) return String();

    const char* ccstr = framework->CFStringGetCStringPtr(cfstring, kCFStringEncodingUTF8);
    if (ccstr != nullptr) {
        return String::fromUTF8(ccstr);
    }

    auto utf16Pairs = framework->CFStringGetLength(cfstring);
    auto maxUtf8Bytes = framework->CFStringGetMaximumSizeForEncoding(utf16Pairs, kCFStringEncodingUTF8);

    Vector<char> cstr;
    cstr.grow(maxUtf8Bytes + 1);
    auto result = framework->CFStringGetCString(cfstring, cstr.begin(), cstr.size(), kCFStringEncodingUTF8);

    if (result) {
        // CFStringGetCString null-terminates the string, so we can use strlen
        // to get the actual length without trailing null bytes
        size_t actualLength = strlen(cstr.begin());
        return String::fromUTF8(std::span<const char>(cstr.begin(), actualLength));
    }
    return String();
}

static String errorStatusToString(OSStatus status)
{
    auto* framework = securityFramework();
    if (!framework) return "Security framework not loaded"_s;

    auto errorMessage = framework->adopt(framework->SecCopyErrorMessageString(status, NULL));
    return errorMessage ? CFStringToWTFString(errorMessage.get()) : String();
}

static void updateError(Error& err, OSStatus status)
{
    if (status == errSecSuccess) {
        err = Error {};
        return;
    }

    err.message = errorStatusToString(status);
    err.code = status;

    switch (status) {
    case errSecItemNotFound:
        err.type = ErrorType::NotFound;
        break;
    case errSecUserCanceled:
    case errSecAuthFailed:
    case errSecInteractionRequired:
    case errSecInteractionNotAllowed:
        err.type = ErrorType::AccessDenied;
        break;
    case errSecNotAvailable:
    case errSecReadOnlyAttr:
        err.type = ErrorType::AccessDenied;
        // Provide more helpful message for common CI permission issues
        if (err.message.isEmpty() || err.message.contains("Write permissions error")) {
            err.message = "Keychain access denied. In CI environments, use {allowUnrestrictedAccess: true} option."_s;
        }
        break;
    default:
        err.type = ErrorType::PlatformError;
    }
}

static CFPtr<CFMutableDictionaryRef> createQuery(SecurityFramework* framework, const UTF8CString& service, const UTF8CString& name)
{
    auto cfServiceName = framework->adopt(framework->CFStringCreateWithCString(
        framework->kCFAllocatorDefault, service.legacyCStringPointer(), kCFStringEncodingUTF8));
    auto cfUser = framework->adopt(framework->CFStringCreateWithCString(
        framework->kCFAllocatorDefault, name.legacyCStringPointer(), kCFStringEncodingUTF8));

    if (!cfServiceName || !cfUser) return framework->adopt<CFMutableDictionaryRef>(nullptr);

    auto query = framework->adopt(framework->CFDictionaryCreateMutable(
        framework->kCFAllocatorDefault, 0,
        framework->kCFTypeDictionaryKeyCallBacks,
        framework->kCFTypeDictionaryValueCallBacks));

    if (!query) return query;

    framework->CFDictionaryAddValue(query.get(), framework->kSecClass, framework->kSecClassGenericPassword);
    framework->CFDictionaryAddValue(query.get(), framework->kSecAttrAccount, cfUser.get());
    framework->CFDictionaryAddValue(query.get(), framework->kSecAttrService, cfServiceName.get());

    return query;
}

Error setPassword(const UTF8CString& service, const UTF8CString& name, UTF8CString&& password, bool allowUnrestrictedAccess, Persist)
{
    Error err;

    auto* framework = securityFramework();
    if (!framework) {
        err.type = ErrorType::PlatformError;
        err.message = "Security framework not available"_s;
        return err;
    }

    // Empty string means delete - call deletePassword instead
    if (password.length() == 0) {
        deletePassword(service, name, err);
        // Convert delete result to setPassword semantics
        // Delete errors (like NotFound) should not be propagated for empty string sets
        if (err.type == ErrorType::NotFound) {
            err = Error {}; // Clear the error - deleting non-existent is not an error for set("")
        }
        return err;
    }

    auto cfPassword = framework->adopt(framework->CFDataCreate(
        framework->kCFAllocatorDefault,
        reinterpret_cast<const UInt8*>(password.data()),
        password.length()));

    auto query = createQuery(framework, service, name);
    if (!query || !cfPassword) {
        err.type = ErrorType::PlatformError;
        err.message = "Failed to create query or password data"_s;
        return err;
    }

    framework->CFDictionaryAddValue(query.get(),
        framework->kSecValueData, cfPassword.get());

    // For headless CI environments (like MacStadium), optionally create an access object
    // that allows all applications to access this keychain item without user interaction
    if (allowUnrestrictedAccess) {
        auto accessDescription = framework->adopt(framework->CFStringCreateWithCString(
            framework->kCFAllocatorDefault, "Bun secrets access", kCFStringEncodingUTF8));

        if (accessDescription) {
            auto accessRef = framework->adopt<SecAccessRef>(nullptr);
            OSStatus accessStatus = framework->SecAccessCreate(
                accessDescription.get(),
                nullptr, // trustedList - nullptr means all applications have access
                outPtr(accessRef));

            // A failure is not fatal: continue without the access control.
            if (accessStatus == errSecSuccess && accessRef) {
                framework->CFDictionaryAddValue(query.get(),
                    framework->kSecAttrAccess, accessRef.get());
            }
        }
    }

    OSStatus status = framework->SecItemAdd(query.get(), NULL);

    if (status == errSecDuplicateItem) {
        // Password exists -- update it
        auto attributesToUpdate = framework->adopt(framework->CFDictionaryCreateMutable(
            framework->kCFAllocatorDefault, 0,
            framework->kCFTypeDictionaryKeyCallBacks,
            framework->kCFTypeDictionaryValueCallBacks));

        if (!attributesToUpdate) {
            err.type = ErrorType::PlatformError;
            err.message = "Failed to create update dictionary"_s;
            return err;
        }

        framework->CFDictionaryAddValue(attributesToUpdate.get(),
            framework->kSecValueData, cfPassword.get());
        status = framework->SecItemUpdate(query.get(),
            attributesToUpdate.get());
    }

    updateError(err, status);
    return err;
}

std::optional<WTF::Vector<uint8_t>> getPassword(const UTF8CString& service, const UTF8CString& name, Error& err)
{
    err = Error {};

    auto* framework = securityFramework();
    if (!framework) {
        err.type = ErrorType::PlatformError;
        err.message = "Security framework not available"_s;
        return std::nullopt;
    }

    auto query = createQuery(framework, service, name);
    if (!query) {
        err.type = ErrorType::PlatformError;
        err.message = "Failed to create query"_s;
        return std::nullopt;
    }

    framework->CFDictionaryAddValue(query.get(),
        framework->kSecReturnData, framework->kCFBooleanTrue);

    auto cfPassword = framework->adopt<CFTypeRef>(nullptr);
    OSStatus status = framework->SecItemCopyMatching(query.get(), outPtr(cfPassword));

    if (status == errSecSuccess && cfPassword) {
        CFDataRef passwordData = (CFDataRef)cfPassword.get();
        const UInt8* bytes = framework->CFDataGetBytePtr(passwordData);
        CFIndex length = framework->CFDataGetLength(passwordData);

        return WTF::Vector<uint8_t>(std::span<const char>(reinterpret_cast<const char*>(bytes), length));
    }

    updateError(err, status);
    return std::nullopt;
}

bool deletePassword(const UTF8CString& service, const UTF8CString& name, Error& err)
{
    err = Error {};

    auto* framework = securityFramework();
    if (!framework) {
        err.type = ErrorType::PlatformError;
        err.message = "Security framework not available"_s;
        return false;
    }

    auto query = createQuery(framework, service, name);
    if (!query) {
        err.type = ErrorType::PlatformError;
        err.message = "Failed to create query"_s;
        return false;
    }

    OSStatus status = framework->SecItemDelete(query.get());

    updateError(err, status);

    if (status == errSecSuccess) {
        return true;
    } else if (status == errSecItemNotFound) {
        return false;
    }

    return false;
}

} // namespace Secrets
} // namespace Bun

#endif // OS(DARWIN)
