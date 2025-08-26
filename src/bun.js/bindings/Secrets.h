#pragma once

#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <wtf/text/WTFString.h>
#include <wtf/Vector.h>
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

// Sync platform-specific implementations (used by threadpool)
// These use CString for thread safety - only called from threadpool
Error setPassword(const WTF::CString& service, const WTF::CString& name, WTF::CString&& password, bool allowUnrestrictedAccess = false);

// Use a WTF::Vector here so we can zero out the memory.
std::optional<WTF::Vector<uint8_t>> getPassword(const WTF::CString& service, const WTF::CString& name, Error& error);
bool deletePassword(const WTF::CString& service, const WTF::CString& name, Error& error);

} // namespace Secrets

// JS binding function
JSC::JSObject* createSecretsObject(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

} // namespace Bun
