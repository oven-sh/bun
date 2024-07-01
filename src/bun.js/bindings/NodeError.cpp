#include "root.h"

#include "BunClientData.h"
#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/JSCJSValue.h"

#include <cstdint>

#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ErrorInstance.h>
#include "headers-handwritten.h"
#include "BunBuiltinNames.h"

/// https://nodejs.org/api/errors.html#nodejs-error-codes
namespace Bun {
using namespace JSC;

enum class ErrorKind : uint8_t {
    Error = 0,
    TypeError = 1,
    RangeError = 2,
};

extern "C" JSC::EncodedJSValue Bun__createErrorInstanceWithKind(
    JSC::JSGlobalObject* globalObject,
    ErrorKind kind,
    const BunString* code,
    const BunString* message)
{
    auto& vm = globalObject->vm();
    JSC::JSObject* error = nullptr;

    switch (kind) {
    case ErrorKind::Error: {
        error = createError(globalObject, message->toWTFString());
        break;
    }
    case ErrorKind::TypeError: {
        error = createTypeError(globalObject, message->toWTFString());
        break;
    }
    case ErrorKind::RangeError: {
        error = createRangeError(globalObject, message->toWTFString());
        break;
    }
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }

    if (code) {
        ASSERT(!code->isEmpty());
        auto* codeStr = JSC::jsString(vm, code->toWTFString());
        error->putDirect(vm, WebCore::builtinNames(vm).codePublicName(), JSC::JSValue(codeStr));
    }

    return JSC::JSValue::encode(error);
}
}