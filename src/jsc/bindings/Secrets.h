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

// One platform call's cancellation state. `cancel()` runs on the JS thread (the
// deadline, VM teardown) while the pool thread may be inside the call. Linux
// wraps a GCancellable, which libsecret honors (D-Bus calls fail with
// G_IO_ERROR_CANCELLED, a prompt is dismissed). Keychain and Credential Manager
// calls cannot be interrupted, so there `cancel()` only marks the job, and a
// job that has not started yet skips the call.
class Cancellation {
    WTF_MAKE_NONCOPYABLE(Cancellation);

public:
    Cancellation() = default;

    // Pool thread, before the platform call: a cancel already arrived.
    bool requested() const { return m_cancelRequested.load(); }

#if OS(LINUX) || OS(FREEBSD)
    ~Cancellation();

    // JS thread. Safe before, during, and after the platform call.
    void cancel();

    // Pool thread, before the libsecret call: the GCancellable* to pass to it.
    void* gcancellable();

private:
    std::atomic<void*> m_gcancellable { nullptr };
#else
    void cancel() { m_cancelRequested.store(true); }

private:
#endif
    std::atomic<bool> m_cancelRequested { false };
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
