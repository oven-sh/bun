#include "util.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <openssl/err.h>
#include "ErrorCode.h"
#include "ncrypto.h"
#include "BunString.h"

namespace Bun {

using namespace JSC;

std::optional<ncrypto::DataPointer> passphraseFromBufferSource(JSC::JSGlobalObject* globalObject, ThrowScope& scope, JSValue input)
{
    if (input.isUndefinedOrNull()) {
        return std::nullopt;
    }

    if (input.isString()) {
        WTF::String passphraseStr = input.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        UTF8View utf8(passphraseStr);

        auto span = utf8.span();
        if (auto ptr = ncrypto::DataPointer::Alloc(span.size())) {
            memcpy(ptr.get(), span.data(), span.size());
            return WTFMove(ptr);
        }

        throwOutOfMemoryError(globalObject, scope);
        return std::nullopt;
    }

    if (auto* array = jsDynamicCast<JSC::JSUint8Array*>(input)) {
        if (array->isDetached()) {
            throwTypeError(globalObject, scope, "passphrase must not be detached"_s);
            return std::nullopt;
        }

        auto length = array->byteLength();
        if (auto ptr = ncrypto::DataPointer::Alloc(length)) {
            memcpy(ptr.get(), array->vector(), length);
            return WTFMove(ptr);
        }

        throwOutOfMemoryError(globalObject, scope);
        return std::nullopt;
    }

    throwTypeError(globalObject, scope, "passphrase must be a Buffer or string"_s);
    return std::nullopt;
}

// Throws a crypto error with optional OpenSSL error details
void throwCryptoError(JSC::JSGlobalObject* globalObject, ThrowScope& scope, unsigned long err, const char* message)
{
    JSC::VM& vm = globalObject->vm();

    // Format OpenSSL error message if err is provided
    char message_buffer[128] = { 0 };
    if (err != 0 || message == nullptr) {
        ERR_error_string_n(err, message_buffer, sizeof(message_buffer));
        message = message_buffer;
    }

    WTF::String errorMessage = WTF::String::fromUTF8(message);
    RETURN_IF_EXCEPTION(scope, void());

    // Create error object with the message
    JSC::JSObject* errorObject = createTypeError(globalObject);
    RETURN_IF_EXCEPTION(scope, void());

    PutPropertySlot messageSlot(errorObject, false);
    errorObject->put(errorObject, globalObject, Identifier::fromString(vm, "message"_s), jsString(vm, errorMessage), messageSlot);
    RETURN_IF_EXCEPTION(scope, void());

    ncrypto::CryptoErrorList errorStack;
    errorStack.capture();

    // If there's an OpenSSL error code, decorate the error object with additional info
    if (err != 0) {
        // Get library, function and reason strings from OpenSSL
        const char* lib = ERR_lib_error_string(err);
        const char* func = ERR_func_error_string(err);
        const char* reason = ERR_reason_error_string(err);

        // Add library info if available
        if (lib) {
            WTF::String libString = WTF::String::fromUTF8(lib);
            PutPropertySlot slot(errorObject, false);
            errorObject->put(errorObject, globalObject, Identifier::fromString(vm, "library"_s), jsString(vm, libString), slot);
            RETURN_IF_EXCEPTION(scope, void());
        }

        // Add function info if available
        if (func) {
            WTF::String funcString = WTF::String::fromUTF8(func);
            PutPropertySlot slot(errorObject, false);

            errorObject->put(errorObject, globalObject, Identifier::fromString(vm, "function"_s), jsString(vm, funcString), slot);
            RETURN_IF_EXCEPTION(scope, void());
        }

        // Add reason info if available
        if (reason) {
            WTF::String reasonString = WTF::String::fromUTF8(reason);
            PutPropertySlot reasonSlot(errorObject, false);

            errorObject->put(errorObject, globalObject, Identifier::fromString(vm, "reason"_s), jsString(vm, reasonString), reasonSlot);
            RETURN_IF_EXCEPTION(scope, void());

            // Convert reason to error code (e.g. "this error" -> "ERR_OSSL_THIS_ERROR")
            String upperReason = reasonString.convertToASCIIUppercase();
            String code = makeString("ERR_OSSL_"_s, upperReason);

            PutPropertySlot codeSlot(errorObject, false);
            errorObject->put(errorObject, globalObject, Identifier::fromString(vm, "code"_s), jsString(vm, code), codeSlot);
            RETURN_IF_EXCEPTION(scope, void());
        }
    }

    // If there are multiple errors, add them to the error stack
    if (errorStack.size() > 0) {
        PutPropertySlot stackSlot(errorObject, false);
        auto arr = JSC::constructEmptyArray(globalObject, nullptr, errorStack.size());
        RETURN_IF_EXCEPTION(scope, void());
        for (int32_t i = 0; i < errorStack.size(); i++) {
            WTF::String error = errorStack.pop_back().value();
            arr->putDirectIndex(globalObject, i, jsString(vm, error));
        }
        errorObject->put(errorObject, globalObject, Identifier::fromString(vm, "opensslErrorStack"_s), arr, stackSlot);
        RETURN_IF_EXCEPTION(scope, void());
    }

    // Throw the decorated error
    throwException(globalObject, scope, errorObject);
}
}
