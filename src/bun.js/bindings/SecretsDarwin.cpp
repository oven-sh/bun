#include "root.h"

#if OS(DARWIN)

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
        CFStringCreateWithCString = (CFStringRef(*)(CFAllocatorRef, const char*, CFStringEncoding))dlsym(cf_handle, "CFStringCreateWithCString");
        CFDataCreate = (CFDataRef(*)(CFAllocatorRef, const UInt8*, CFIndex))dlsym(cf_handle, "CFDataCreate");
        CFDataGetBytePtr = (const UInt8* (*)(CFDataRef))dlsym(cf_handle, "CFDataGetBytePtr");
        CFDataGetLength = (CFIndex(*)(CFDataRef))dlsym(cf_handle, "CFDataGetLength");
        CFDictionaryCreateMutable = (CFMutableDictionaryRef(*)(CFAllocatorRef, CFIndex, const CFDictionaryKeyCallBacks*, const CFDictionaryValueCallBacks*))dlsym(cf_handle, "CFDictionaryCreateMutable");
        CFDictionaryAddValue = (void (*)(CFMutableDictionaryRef, const void*, const void*))dlsym(cf_handle, "CFDictionaryAddValue");
        CFStringGetCString = (Boolean(*)(CFStringRef, char*, CFIndex, CFStringEncoding))dlsym(cf_handle, "CFStringGetCString");
        CFStringGetCStringPtr = (const char* (*)(CFStringRef, CFStringEncoding))dlsym(cf_handle, "CFStringGetCStringPtr");
        CFStringGetLength = (CFIndex(*)(CFStringRef))dlsym(cf_handle, "CFStringGetLength");
        CFStringGetMaximumSizeForEncoding = (CFIndex(*)(CFIndex, CFStringEncoding))dlsym(cf_handle, "CFStringGetMaximumSizeForEncoding");

        SecItemAdd = (OSStatus(*)(CFDictionaryRef, CFTypeRef*))dlsym(handle, "SecItemAdd");
        SecItemCopyMatching = (OSStatus(*)(CFDictionaryRef, CFTypeRef*))dlsym(handle, "SecItemCopyMatching");
        SecItemUpdate = (OSStatus(*)(CFDictionaryRef, CFDictionaryRef))dlsym(handle, "SecItemUpdate");
        SecItemDelete = (OSStatus(*)(CFDictionaryRef))dlsym(handle, "SecItemDelete");
        SecCopyErrorMessageString = (CFStringRef(*)(OSStatus, void*))dlsym(handle, "SecCopyErrorMessageString");
        SecAccessCreate = (OSStatus(*)(CFStringRef, CFArrayRef, SecAccessRef*))dlsym(handle, "SecAccessCreate");

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

class ScopedCFRef {
public:
    explicit ScopedCFRef(CFTypeRef ref)
        : _ref(ref)
    {
    }
    ~ScopedCFRef()
    {
        if (_ref && securityFramework()) {
            securityFramework()->CFRelease(_ref);
        }
    }

    ScopedCFRef(ScopedCFRef&& other) noexcept
        : _ref(other._ref)
    {
        other._ref = nullptr;
    }

    ScopedCFRef(const ScopedCFRef&) = delete;
    ScopedCFRef& operator=(const ScopedCFRef&) = delete;

    CFTypeRef get() const { return _ref; }
    operator bool() const { return _ref != nullptr; }

private:
    CFTypeRef _ref;
};

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

    CFStringRef errorMessage = framework->SecCopyErrorMessageString(status, NULL);
    String errorString;

    if (errorMessage) {
        errorString = CFStringToWTFString(errorMessage);
        framework->CFRelease(errorMessage);
    }

    return errorString;
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

static ScopedCFRef createQuery(const CString& service, const CString& name)
{
    auto* framework = securityFramework();
    if (!framework) return ScopedCFRef(nullptr);

    ScopedCFRef cfServiceName(framework->CFStringCreateWithCString(
        framework->kCFAllocatorDefault, service.data(), kCFStringEncodingUTF8));
    ScopedCFRef cfUser(framework->CFStringCreateWithCString(
        framework->kCFAllocatorDefault, name.data(), kCFStringEncodingUTF8));

    if (!cfServiceName || !cfUser) return ScopedCFRef(nullptr);

    CFMutableDictionaryRef query = framework->CFDictionaryCreateMutable(
        framework->kCFAllocatorDefault, 0,
        framework->kCFTypeDictionaryKeyCallBacks,
        framework->kCFTypeDictionaryValueCallBacks);

    if (!query) return ScopedCFRef(nullptr);

    framework->CFDictionaryAddValue(query, framework->kSecClass, framework->kSecClassGenericPassword);
    framework->CFDictionaryAddValue(query, framework->kSecAttrAccount, cfUser.get());
    framework->CFDictionaryAddValue(query, framework->kSecAttrService, cfServiceName.get());

    return ScopedCFRef(query);
}

Error setPassword(const CString& service, const CString& name, CString&& password, bool allowUnrestrictedAccess)
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

    ScopedCFRef cfPassword(framework->CFDataCreate(
        framework->kCFAllocatorDefault,
        reinterpret_cast<const UInt8*>(password.data()),
        password.length()));

    ScopedCFRef query = createQuery(service, name);
    if (!query || !cfPassword) {
        err.type = ErrorType::PlatformError;
        err.message = "Failed to create query or password data"_s;
        return err;
    }

    framework->CFDictionaryAddValue((CFMutableDictionaryRef)query.get(),
        framework->kSecValueData, cfPassword.get());

    // For headless CI environments (like MacStadium), optionally create an access object
    // that allows all applications to access this keychain item without user interaction
    SecAccessRef accessRef = nullptr;
    if (allowUnrestrictedAccess) {
        ScopedCFRef accessDescription(framework->CFStringCreateWithCString(
            framework->kCFAllocatorDefault, "Bun secrets access", kCFStringEncodingUTF8));

        if (accessDescription) {
            OSStatus accessStatus = framework->SecAccessCreate(
                (CFStringRef)accessDescription.get(),
                nullptr, // trustedList - nullptr means all applications have access
                &accessRef);

            if (accessStatus == errSecSuccess && accessRef) {
                framework->CFDictionaryAddValue((CFMutableDictionaryRef)query.get(),
                    framework->kSecAttrAccess, accessRef);
            } else {
                // If access creation failed, that's not necessarily a fatal error
                // but we should continue without the access control
                accessRef = nullptr;
            }
        }
    }

    OSStatus status = framework->SecItemAdd((CFDictionaryRef)query.get(), NULL);

    // Clean up accessRef if it was created
    if (accessRef) {
        framework->CFRelease(accessRef);
    }

    if (status == errSecDuplicateItem) {
        // Password exists -- update it
        ScopedCFRef attributesToUpdate(framework->CFDictionaryCreateMutable(
            framework->kCFAllocatorDefault, 0,
            framework->kCFTypeDictionaryKeyCallBacks,
            framework->kCFTypeDictionaryValueCallBacks));

        if (!attributesToUpdate) {
            err.type = ErrorType::PlatformError;
            err.message = "Failed to create update dictionary"_s;
            return err;
        }

        framework->CFDictionaryAddValue((CFMutableDictionaryRef)attributesToUpdate.get(),
            framework->kSecValueData, cfPassword.get());
        status = framework->SecItemUpdate((CFDictionaryRef)query.get(),
            (CFDictionaryRef)attributesToUpdate.get());
    }

    updateError(err, status);
    return err;
}

std::optional<WTF::Vector<uint8_t>> getPassword(const CString& service, const CString& name, Error& err)
{
    err = Error {};

    auto* framework = securityFramework();
    if (!framework) {
        err.type = ErrorType::PlatformError;
        err.message = "Security framework not available"_s;
        return std::nullopt;
    }

    ScopedCFRef query = createQuery(service, name);
    if (!query) {
        err.type = ErrorType::PlatformError;
        err.message = "Failed to create query"_s;
        return std::nullopt;
    }

    framework->CFDictionaryAddValue((CFMutableDictionaryRef)query.get(),
        framework->kSecReturnData, framework->kCFBooleanTrue);

    CFTypeRef result = nullptr;
    OSStatus status = framework->SecItemCopyMatching((CFDictionaryRef)query.get(), &result);

    if (status == errSecSuccess && result) {
        ScopedCFRef cfPassword(result);
        CFDataRef passwordData = (CFDataRef)cfPassword.get();
        const UInt8* bytes = framework->CFDataGetBytePtr(passwordData);
        CFIndex length = framework->CFDataGetLength(passwordData);

        return WTF::Vector<uint8_t>(std::span<const char>(reinterpret_cast<const char*>(bytes), length));
    }

    updateError(err, status);
    return std::nullopt;
}

bool deletePassword(const CString& service, const CString& name, Error& err)
{
    err = Error {};

    auto* framework = securityFramework();
    if (!framework) {
        err.type = ErrorType::PlatformError;
        err.message = "Security framework not available"_s;
        return false;
    }

    ScopedCFRef query = createQuery(service, name);
    if (!query) {
        err.type = ErrorType::PlatformError;
        err.message = "Failed to create query"_s;
        return false;
    }

    OSStatus status = framework->SecItemDelete((CFDictionaryRef)query.get());

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
