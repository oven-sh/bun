#include "util.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <openssl/err.h>
#include "ErrorCode.h"
#include "ncrypto.h"
#include "BunString.h"
#include "JSBuffer.h"
#include "JSDOMConvertEnumeration.h"
#include "JSBufferEncodingType.h"
namespace Bun {

using namespace JSC;

std::optional<ncrypto::EVPKeyPointer> keyFromString(JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, const WTF::StringView& keyView, JSValue passphraseValue)
{
    ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig config;
    config.format = ncrypto::EVPKeyPointer::PKFormatType::PEM;

    config.passphrase = passphraseFromBufferSource(lexicalGlobalObject, scope, passphraseValue);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    UTF8View keyUtf8(keyView);

    auto keySpan = keyUtf8.span();

    ncrypto::Buffer<const unsigned char> ncryptoBuf {
        .data = reinterpret_cast<const unsigned char*>(keySpan.data()),
        .len = keySpan.size(),
    };
    auto res = ncrypto::EVPKeyPointer::TryParsePrivateKey(config, ncryptoBuf);
    if (res) {
        ncrypto::EVPKeyPointer keyPtr(WTFMove(res.value));
        return keyPtr;
    }

    if (res.error.value() == ncrypto::EVPKeyPointer::PKParseError::NEED_PASSPHRASE) {
        Bun::ERR::MISSING_PASSPHRASE(scope, lexicalGlobalObject, "Passphrase required for encrypted key"_s);
        return std::nullopt;
    }

    throwCryptoError(lexicalGlobalObject, scope, res.openssl_error.value_or(0), "Failed to read private key"_s);
    return std::nullopt;
}

ncrypto::EVPKeyPointer::PKFormatType parseKeyFormat(JSC::JSGlobalObject* globalObject, JSValue formatValue, WTF::ASCIILiteral optionName, std::optional<ncrypto::EVPKeyPointer::PKFormatType> defaultFormat)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    if (formatValue.isUndefined() && defaultFormat) {
        return defaultFormat.value();
    }

    if (!formatValue.isString()) {
        Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, optionName, formatValue);
        return {};
    }

    WTF::String formatStr = formatValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (formatStr == "pem"_s) {
        return ncrypto::EVPKeyPointer::PKFormatType::PEM;
    }

    if (formatStr == "der"_s) {
        return ncrypto::EVPKeyPointer::PKFormatType::DER;
    }

    if (formatStr == "jwk"_s) {
        return ncrypto::EVPKeyPointer::PKFormatType::JWK;
    }

    Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, optionName, formatValue);
    return {};
}

std::optional<ncrypto::EVPKeyPointer::PKEncodingType> parseKeyType(JSC::JSGlobalObject* globalObject, JSValue typeValue, bool required, WTF::StringView keyType, std::optional<bool> isPublic, WTF::ASCIILiteral optionName)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    if (typeValue.isUndefined() && !required) {
        return std::nullopt;
    }

    if (!typeValue.isString()) {
        Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, optionName, typeValue);
        return std::nullopt;
    }

    WTF::String typeStr = typeValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    if (typeStr == "pkcs1"_s) {
        if (keyType && keyType != "rsa"_s) {
            Bun::ERR::CRYPTO_INCOMPATIBLE_KEY_OPTIONS(scope, globalObject, "pkcs1"_s, "can only be used for RSA keys"_s);
            return std::nullopt;
        }
        return ncrypto::EVPKeyPointer::PKEncodingType::PKCS1;
    } else if (typeStr == "spki"_s && isPublic != false) {
        return ncrypto::EVPKeyPointer::PKEncodingType::SPKI;
    } else if (typeStr == "pkcs8"_s && isPublic != true) {
        return ncrypto::EVPKeyPointer::PKEncodingType::PKCS8;
    } else if (typeStr == "sec1"_s && isPublic != true) {
        if (keyType && keyType != "ec"_s) {
            Bun::ERR::CRYPTO_INCOMPATIBLE_KEY_OPTIONS(scope, globalObject, "sec1"_s, "can only be used for EC keys"_s);
            return std::nullopt;
        }
        return ncrypto::EVPKeyPointer::PKEncodingType::SEC1;
    }

    Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, optionName, typeValue);
    return std::nullopt;
}

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

std::optional<int32_t> getIntOption(JSC::JSGlobalObject* globalObject, JSValue options, WTF::ASCIILiteral name)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue value = options.get(globalObject, JSC::Identifier::fromString(vm, name));
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    if (value.isUndefined())
        return std::nullopt;

    if (!value.isInt32()) {
        Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, makeString("options."_s, name), value);
        return std::nullopt;
    }

    return value.asInt32();
}

int32_t getPadding(JSC::JSGlobalObject* globalObject, JSValue options, const ncrypto::EVPKeyPointer& pkey)
{
    auto padding = getIntOption(globalObject, options, "padding"_s);
    return padding.value_or(pkey.getDefaultSignPadding());
}

std::optional<int32_t> getSaltLength(JSC::JSGlobalObject* globalObject, JSValue options)
{
    return getIntOption(globalObject, options, "saltLength"_s);
}

NodeCryptoKeys::DSASigEnc getDSASigEnc(JSC::JSGlobalObject* globalObject, JSValue options)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (!options.isObject() || options.asCell()->type() != JSC::JSType::FinalObjectType) {
        return NodeCryptoKeys::DSASigEnc::DER;
    }

    JSValue dsaEncoding = options.get(globalObject, Identifier::fromString(globalObject->vm(), "dsaEncoding"_s));
    RETURN_IF_EXCEPTION(scope, {});

    if (dsaEncoding.isUndefined()) {
        return NodeCryptoKeys::DSASigEnc::DER;
    }

    if (!dsaEncoding.isString()) {
        Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "options.dsaEncoding"_s, dsaEncoding);
        return {};
    }

    WTF::String dsaEncodingStr = dsaEncoding.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (dsaEncodingStr == "der"_s) {
        return NodeCryptoKeys::DSASigEnc::DER;
    }

    if (dsaEncodingStr == "ieee-p1363"_s) {
        return NodeCryptoKeys::DSASigEnc::P1363;
    }

    Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "options.dsaEncoding"_s, dsaEncoding);
    return {};
}

JSC::JSArrayBufferView* getArrayBufferOrView(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral argName, JSValue encodingValue)
{
    if (value.isString()) {
        JSString* dataString = value.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        auto encoding = WebCore::validateBufferEncoding<true>(*globalObject, encodingValue);
        RETURN_IF_EXCEPTION(scope, {});

        if (encoding == WebCore::BufferEncodingType::hex && dataString->length() % 2 != 0) {
            Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "encoding"_s, encodingValue, makeString("is invalid for data of length "_s, dataString->length()));
            return {};
        }

        JSValue buf = JSValue::decode(WebCore::constructFromEncoding(globalObject, dataString, *encoding));
        RETURN_IF_EXCEPTION(scope, {});

        auto* view = jsDynamicCast<JSC::JSArrayBufferView*>(buf);
        if (!view) {
            Bun::ERR::INVALID_ARG_INSTANCE(scope, globalObject, argName, "Buffer, TypedArray, or DataView"_s, value);
            return {};
        }

        if (view->isDetached()) {
            throwTypeError(globalObject, scope, "Buffer is detached"_s);
            return {};
        }

        return view;
    }

    if (!value.isCell() || !JSC::isTypedArrayTypeIncludingDataView(value.asCell()->type())) {
        Bun::ERR::INVALID_ARG_INSTANCE(scope, globalObject, argName, "Buffer, TypedArray, or DataView"_s, value);
        return {};
    }

    auto* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(value);
    if (!view) {
        Bun::ERR::INVALID_ARG_INSTANCE(scope, globalObject, argName, "Buffer, TypedArray, or DataView"_s, value);
        return {};
    }

    if (view->isDetached()) {
        throwTypeError(globalObject, scope, "Buffer is detached"_s);
        return {};
    }

    return view;
}
}
