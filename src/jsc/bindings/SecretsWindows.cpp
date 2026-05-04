#include "root.h"

#if OS(WINDOWS)

#include "Secrets.h"
#include <wtf/text/WTFString.h>
#include <wtf/NeverDestroyed.h>
#include <windows.h>
#include <wincred.h>

namespace Bun {
namespace Secrets {

using namespace WTF;

class CredentialFramework {
public:
    void* handle;

    // Function pointers
    BOOL(WINAPI* CredWriteW)(PCREDENTIALW Credential, DWORD Flags);
    BOOL(WINAPI* CredReadW)(LPCWSTR TargetName, DWORD Type, DWORD Flags, PCREDENTIALW* Credential);
    BOOL(WINAPI* CredDeleteW)(LPCWSTR TargetName, DWORD Type, DWORD Flags);
    VOID(WINAPI* CredFree)(PVOID Buffer);

    CredentialFramework()
        : handle(nullptr)
    {
    }

    bool load()
    {
        if (handle) return true;

        // Load advapi32.dll which contains the Credential Manager API
        handle = LoadLibraryW(L"advapi32.dll");
        if (!handle) {
            return false;
        }

        CredWriteW = (BOOL(WINAPI*)(PCREDENTIALW, DWORD))GetProcAddress((HMODULE)handle, "CredWriteW");
        CredReadW = (BOOL(WINAPI*)(LPCWSTR, DWORD, DWORD, PCREDENTIALW*))GetProcAddress((HMODULE)handle, "CredReadW");
        CredDeleteW = (BOOL(WINAPI*)(LPCWSTR, DWORD, DWORD))GetProcAddress((HMODULE)handle, "CredDeleteW");
        CredFree = (VOID(WINAPI*)(PVOID))GetProcAddress((HMODULE)handle, "CredFree");

        return CredWriteW && CredReadW && CredDeleteW && CredFree;
    }
};

static CredentialFramework* credentialFramework()
{
    static LazyNeverDestroyed<CredentialFramework> framework;
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [&] {
        framework.construct();
        if (!framework->load()) {
            // Framework failed to load, but object is still constructed
        }
    });
    return framework->handle ? &framework.get() : nullptr;
}

// Convert CString to Windows wide string
static std::vector<wchar_t> cstringToWideChar(const CString& str)
{
    if (!str.data()) {
        return std::vector<wchar_t>(1, L'\0');
    }

    int wideLength = MultiByteToWideChar(CP_UTF8, 0, str.data(), -1, nullptr, 0);
    if (wideLength == 0) {
        return std::vector<wchar_t>(1, L'\0');
    }

    std::vector<wchar_t> result(wideLength);
    MultiByteToWideChar(CP_UTF8, 0, str.data(), -1, result.data(), wideLength);
    return result;
}

// Convert Windows wide string to WTF::String
static String wideCharToString(const wchar_t* wide)
{
    if (!wide) {
        return String();
    }

    int utf8Length = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
    if (utf8Length == 0) {
        return String();
    }

    std::vector<char> buffer(utf8Length);
    WideCharToMultiByte(CP_UTF8, 0, wide, -1, buffer.data(), utf8Length, nullptr, nullptr);
    return String::fromUTF8(buffer.data());
}

static String getWindowsErrorMessage(DWORD errorCode)
{
    wchar_t* errorBuffer = nullptr;
    FormatMessageW(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr,
        errorCode,
        MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
        (LPWSTR)&errorBuffer,
        0,
        nullptr);

    String errorMessage;
    if (errorBuffer) {
        errorMessage = wideCharToString(errorBuffer);
        LocalFree(errorBuffer);
    }

    return errorMessage;
}

static void updateError(Error& err, DWORD errorCode)
{
    if (errorCode == ERROR_SUCCESS) {
        err = Error {};
        return;
    }

    err.message = getWindowsErrorMessage(errorCode);
    err.code = errorCode;

    if (errorCode == ERROR_NOT_FOUND) {
        err.type = ErrorType::NotFound;
    } else if (errorCode == ERROR_ACCESS_DENIED) {
        err.type = ErrorType::AccessDenied;
    } else {
        err.type = ErrorType::PlatformError;
    }
}

Error setPassword(const CString& service, const CString& name, CString&& password, bool allowUnrestrictedAccess)
{
    Error err;

    auto* framework = credentialFramework();
    if (!framework) {
        err.type = ErrorType::PlatformError;
        err.message = "Credential Manager not available"_s;
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

    // Create target name as "service/name"
    String targetName = makeString(String::fromUTF8(service.data()), "/"_s, String::fromUTF8(name.data()));
    auto targetNameUtf8 = targetName.utf8();
    auto targetNameWide = cstringToWideChar(targetNameUtf8);
    auto nameNameWide = cstringToWideChar(name);

    CREDENTIALW cred = { 0 };
    cred.Type = CRED_TYPE_GENERIC;
    cred.TargetName = targetNameWide.data();
    cred.UserName = nameNameWide.data();
    cred.CredentialBlobSize = password.length();
    cred.CredentialBlob = (LPBYTE)password.data();
    cred.Persist = CRED_PERSIST_ENTERPRISE;

    if (!framework->CredWriteW(&cred, 0)) {
        updateError(err, GetLastError());
    }

    // Best-effort scrub of plaintext from memory.
    if (password.length())
        SecureZeroMemory(const_cast<char*>(password.data()), password.length());

    return err;
}

std::optional<WTF::Vector<uint8_t>> getPassword(const CString& service, const CString& name, Error& err)
{
    err = Error {};

    auto* framework = credentialFramework();
    if (!framework) {
        err.type = ErrorType::PlatformError;
        err.message = "Credential Manager not available"_s;
        return std::nullopt;
    }

    String targetName = makeString(String::fromUTF8(service.data()), "/"_s, String::fromUTF8(name.data()));
    auto targetNameUtf8 = targetName.utf8();
    auto targetNameWide = cstringToWideChar(targetNameUtf8);

    PCREDENTIALW cred = nullptr;
    if (!framework->CredReadW(targetNameWide.data(), CRED_TYPE_GENERIC, 0, &cred)) {
        DWORD errorCode = GetLastError();
        updateError(err, errorCode);
        return std::nullopt;
    }

    // Convert credential blob to CString for thread safety
    std::optional<WTF::Vector<uint8_t>> result;
    if (cred->CredentialBlob && cred->CredentialBlobSize > 0) {
        result = WTF::Vector<uint8_t>(std::span<const char>(
            reinterpret_cast<const char*>(cred->CredentialBlob),
            cred->CredentialBlobSize));
    }

    framework->CredFree(cred);

    return result;
}

bool deletePassword(const CString& service, const CString& name, Error& err)
{
    err = Error {};

    auto* framework = credentialFramework();
    if (!framework) {
        err.type = ErrorType::PlatformError;
        err.message = "Credential Manager not available"_s;
        return false;
    }

    String targetName = makeString(String::fromUTF8(service.data()), "/"_s, String::fromUTF8(name.data()));
    auto targetNameUtf8 = targetName.utf8();
    auto targetNameWide = cstringToWideChar(targetNameUtf8);

    if (!framework->CredDeleteW(targetNameWide.data(), CRED_TYPE_GENERIC, 0)) {
        DWORD errorCode = GetLastError();
        updateError(err, errorCode);

        if (errorCode == ERROR_NOT_FOUND) {
            return false;
        }

        return false;
    }

    return true;
}

} // namespace Secrets
} // namespace Bun

#endif // OS(WINDOWS)
