#pragma once

#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <wtf/Noncopyable.h>
#include <wtf/text/WTFString.h>
#include <wtf/Vector.h>
#include <atomic>
#include <span>
#include <optional>

namespace JSC {
class JSValue;
}

namespace Bun {

// Platform-agnostic secrets interface
namespace Secrets {

enum class ErrorType {
    None,
    NotFound,
    AccessDenied,
    PlatformError
};

struct Error {
    ErrorType type = ErrorType::None;
    WTF::String message;
    int code = 0;

    bool isError() const { return type != ErrorType::None; }

    JSC::JSValue toJS(JSC::VM& vm, JSC::JSGlobalObject* globalObject) const;
};

// One platform call's cancellation state. Lives in the job; `cancel()` runs
// on the JS thread (the deadline, VM teardown) while the pool thread may be
// inside the platform call.
//
// Linux: a GCancellable that libsecret's sync calls honor (a pending D-Bus
// call fails with G_IO_ERROR_CANCELLED, a keyring prompt is dismissed). The
// macOS Keychain and Windows Credential Manager calls cannot be interrupted,
// so there `cancel()` has nothing to do and the call finishes on its own.
class Cancellation {
    WTF_MAKE_NONCOPYABLE(Cancellation);

public:
    Cancellation() = default;

#if OS(LINUX) || OS(FREEBSD)
    ~Cancellation();

    // JS thread. Safe before, during, and after the platform call.
    void cancel();

    // Pool thread, right before the libsecret call: the GCancellable* to pass
    // to it (created here; null when libgio is not available).
    void* gcancellable();

private:
    std::atomic<void*> m_gcancellable { nullptr };
    std::atomic<bool> m_cancelRequested { false };
#else
    void cancel() {}
#endif
};

// Sync platform-specific implementations (used by threadpool)
// These use CString for thread safety - only called from threadpool
Error setPassword(const WTF::CString& service, const WTF::CString& name, WTF::CString&& password, bool allowUnrestrictedAccess, Cancellation& cancellation);

// Use a WTF::Vector here so we can zero out the memory.
std::optional<WTF::Vector<uint8_t>> getPassword(const WTF::CString& service, const WTF::CString& name, Error& error, Cancellation& cancellation);
bool deletePassword(const WTF::CString& service, const WTF::CString& name, Error& error, Cancellation& cancellation);

} // namespace Secrets

// JS binding function
JSC::JSObject* createSecretsObject(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

} // namespace Bun
