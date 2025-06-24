#include "CryptoUtil.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <openssl/err.h>
#include "ErrorCode.h"
#include "ncrypto.h"
#include "BunString.h"
#include "JSBuffer.h"
#include "JSDOMConvertEnumeration.h"
#include "JSBufferEncodingType.h"
#include "JSCryptoKey.h"
#include "CryptoKeyRSA.h"
#include "JSVerify.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include "CryptoKeyRaw.h"
#include "JSKeyObject.h"

namespace Bun {

using namespace JSC;
using namespace ncrypto;

namespace ExternZigHash {
struct Hasher;

extern "C" Hasher* Bun__CryptoHasherExtern__getByName(Zig::GlobalObject* globalObject, const char* name, size_t nameLen);
Hasher* getByName(Zig::GlobalObject* globalObject, const StringView& name)
{
    auto utf8 = name.utf8();
    return Bun__CryptoHasherExtern__getByName(globalObject, utf8.data(), utf8.length());
}

extern "C" Hasher* Bun__CryptoHasherExtern__getFromOther(Zig::GlobalObject* global, Hasher* hasher);
Hasher* getFromOther(Zig::GlobalObject* globalObject, Hasher* hasher)
{
    return Bun__CryptoHasherExtern__getFromOther(globalObject, hasher);
}

extern "C" void Bun__CryptoHasherExtern__destroy(Hasher* hasher);
void destroy(Hasher* hasher)
{
    Bun__CryptoHasherExtern__destroy(hasher);
}

extern "C" bool Bun__CryptoHasherExtern__update(Hasher* hasher, const uint8_t* data, size_t len);
bool update(Hasher* hasher, std::span<const uint8_t> data)
{
    return Bun__CryptoHasherExtern__update(hasher, data.data(), data.size());
}

extern "C" uint32_t Bun__CryptoHasherExtern__digest(Hasher* hasher, Zig::GlobalObject* globalObject, uint8_t* out, size_t outLen);
uint32_t digest(Hasher* hasher, Zig::GlobalObject* globalObject, std::span<uint8_t> out)
{
    return Bun__CryptoHasherExtern__digest(hasher, globalObject, out.data(), out.size());
}

extern "C" uint32_t Bun__CryptoHasherExtern__getDigestSize(Hasher* hasher);
uint32_t getDigestSize(Hasher* hasher)
{
    return Bun__CryptoHasherExtern__getDigestSize(hasher);
}

}; // namespace ExternZigHash

namespace StringBytes {

// Identical to jsBufferToString, but `buffer` encoding will return an Buffer instead of a string
EncodedJSValue encode(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, std::span<const uint8_t> bytes, BufferEncodingType encoding)
{
    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    if (!bytes.size() and encoding != BufferEncodingType::buffer) [[unlikely]] {
        return JSValue::encode(jsEmptyString(vm));
    }

    switch (encoding) {
    case BufferEncodingType::buffer: {
        auto buffer = JSC::ArrayBuffer::tryCreateUninitialized(bytes.size(), 1);
        if (!buffer) {
            throwOutOfMemoryError(lexicalGlobalObject, scope);
        }

        memcpy(buffer->data(), bytes.data(), bytes.size());

        return JSValue::encode(JSC::JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTFMove(buffer), 0, bytes.size()));
    }
    default: {
        return jsBufferToStringFromBytes(lexicalGlobalObject, scope, bytes, encoding);
    }
    }
}

}

JSValue unsignedBigIntToBuffer(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, JSValue bigIntValue, ASCIILiteral name)
{
    ASSERT(bigIntValue.isBigInt());
    auto& vm = lexicalGlobalObject->vm();

    JSBigInt* bigInt = bigIntValue.asHeapBigInt();

    if (bigInt->sign()) {
        ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, name, ">= 0"_s, bigIntValue);
        return {};
    }

    WTF::String hex = bigInt->toString(lexicalGlobalObject, 16);
    RETURN_IF_EXCEPTION(scope, {});

    JSString* paddedHex = hex.length() % 2
        ? jsString(vm, tryMakeString('0', hex))
        : jsString(vm, hex);
    if (!paddedHex) [[unlikely]] {
        throwOutOfMemoryError(lexicalGlobalObject, scope);
        return {};
    }

    GCOwnedDataScope<WTF::StringView> paddedView = paddedHex->view(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue buffer = JSValue::decode(WebCore::constructFromEncoding(lexicalGlobalObject, paddedView, BufferEncodingType::hex));
    RELEASE_AND_RETURN(scope, buffer);
}

WebCore::BufferEncodingType getEncodingDefaultBuffer(JSGlobalObject* globalObject, ThrowScope& scope, JSValue encodingValue)
{
    BufferEncodingType res = BufferEncodingType::buffer;
    if (encodingValue.isUndefinedOrNull() || !encodingValue.isString()) {
        return res;
    }

    WTF::String encodingString = encodingValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, res);

    if (encodingString == "buffer"_s) {
        return res;
    }

    return parseEnumerationFromView<BufferEncodingType>(encodingString).value_or(BufferEncodingType::buffer);
}

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

JSValue createCryptoError(JSC::JSGlobalObject* globalObject, ThrowScope& scope, uint32_t err, const char* message)
{
    JSC::VM& vm = globalObject->vm();

    // Format OpenSSL error message if err is provided
    char message_buffer[128] = { 0 };
    if (err != 0 || message == nullptr) {
        ERR_error_string_n(err, message_buffer, sizeof(message_buffer));
        message = message_buffer;
    }

    WTF::String errorMessage = WTF::String::fromUTF8(message);
    RETURN_IF_EXCEPTION(scope, {});

    // Create error object with the message
    JSC::JSObject* errorObject = createError(globalObject, errorMessage);
    RETURN_IF_EXCEPTION(scope, {});

    PutPropertySlot messageSlot(errorObject, false);
    errorObject->put(errorObject, globalObject, Identifier::fromString(vm, "message"_s), jsString(vm, errorMessage), messageSlot);
    RETURN_IF_EXCEPTION(scope, {});

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
            RETURN_IF_EXCEPTION(scope, {});
        }

        // Add function info if available
        if (func) {
            WTF::String funcString = WTF::String::fromUTF8(func);
            PutPropertySlot slot(errorObject, false);

            errorObject->put(errorObject, globalObject, Identifier::fromString(vm, "function"_s), jsString(vm, funcString), slot);
            RETURN_IF_EXCEPTION(scope, {});
        }

        // Add reason info if available
        if (reason) {
            WTF::String reasonString = WTF::String::fromUTF8(reason);
            PutPropertySlot reasonSlot(errorObject, false);

            errorObject->put(errorObject, globalObject, Identifier::fromString(vm, "reason"_s), jsString(vm, reasonString), reasonSlot);
            RETURN_IF_EXCEPTION(scope, {});

            // Convert reason to error code (e.g. "this error" -> "ERR_OSSL_THIS_ERROR")
            String upperReason = reasonString.convertToASCIIUppercase();
            String code = makeString("ERR_OSSL_"_s, upperReason);

            PutPropertySlot codeSlot(errorObject, false);
            errorObject->put(errorObject, globalObject, Identifier::fromString(vm, "code"_s), jsString(vm, code), codeSlot);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    // If there are multiple errors, add them to the error stack
    if (errorStack.size() > 0) {
        PutPropertySlot stackSlot(errorObject, false);
        auto arr = JSC::constructEmptyArray(globalObject, nullptr, errorStack.size());
        RETURN_IF_EXCEPTION(scope, {});
        for (int32_t i = 0; i < errorStack.size(); i++) {
            WTF::String error = errorStack.pop_back().value();
            arr->putDirectIndex(globalObject, i, jsString(vm, error));
        }
        errorObject->put(errorObject, globalObject, Identifier::fromString(vm, "opensslErrorStack"_s), arr, stackSlot);
        RETURN_IF_EXCEPTION(scope, {});
    }

    return errorObject;
}

extern "C" EncodedJSValue Bun__NodeCrypto__createCryptoError(JSC::JSGlobalObject* globalObject, uint32_t err, const char* message)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return JSValue::encode(createCryptoError(globalObject, scope, err, message));
}

void throwCryptoError(JSC::JSGlobalObject* globalObject, ThrowScope& scope, uint32_t err, const char* message)
{
    JSValue errorObject = createCryptoError(globalObject, scope, err, message);
    RETURN_IF_EXCEPTION(scope, void());
    throwException(globalObject, scope, errorObject);
}

std::optional<int32_t> getIntOption(JSC::JSGlobalObject* globalObject, ThrowScope& scope, JSValue options, WTF::ASCIILiteral name)
{
    JSC::VM& vm = globalObject->vm();

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

int32_t getPadding(JSC::JSGlobalObject* globalObject, ThrowScope& scope, JSValue options, const ncrypto::EVPKeyPointer& pkey)
{
    auto padding = getIntOption(globalObject, scope, options, "padding"_s);
    return padding.value_or(pkey.getDefaultSignPadding());
}

std::optional<int32_t> getSaltLength(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSValue options)
{
    return getIntOption(globalObject, scope, options, "saltLength"_s);
}

DSASigEnc getDSASigEnc(JSC::JSGlobalObject* globalObject, ThrowScope& scope, JSValue options)
{
    if (!options.isObject() || options.asCell()->type() != JSC::JSType::FinalObjectType) {
        return DSASigEnc::DER;
    }

    JSValue dsaEncoding = options.get(globalObject, Identifier::fromString(globalObject->vm(), "dsaEncoding"_s));
    RETURN_IF_EXCEPTION(scope, {});

    if (dsaEncoding.isUndefined()) {
        return DSASigEnc::DER;
    }

    if (!dsaEncoding.isString()) {
        Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "options.dsaEncoding"_s, dsaEncoding);
        return {};
    }

    auto* dsaEncodingStr = dsaEncoding.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto dsaEncodingView = dsaEncodingStr->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (dsaEncodingView == "der"_s) {
        return DSASigEnc::DER;
    }

    if (dsaEncodingView == "ieee-p1363"_s) {
        return DSASigEnc::P1363;
    }

    Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "options.dsaEncoding"_s, dsaEncoding);
    return {};
}

bool convertP1363ToDER(const ncrypto::Buffer<const unsigned char>& p1363Sig,
    const ncrypto::EVPKeyPointer& pkey,
    WTF::Vector<uint8_t>& derBuffer)
{
    // Get the size of r and s components from the key
    auto bytesOfRS = pkey.getBytesOfRS();
    if (!bytesOfRS) {
        // If we can't get the bytes of RS, this is not a signature variant
        // that we can convert. Return false to indicate that the original
        // signature should be used.
        return false;
    }

    size_t bytesOfRSValue = bytesOfRS.value();

    // Check if the signature size is valid (should be 2 * bytesOfRS)
    if (p1363Sig.len != 2 * bytesOfRSValue) {
        // If the signature size doesn't match what we expect, return false
        // to indicate that the original signature should be used.
        return false;
    }

    // Create BignumPointers for r and s components
    ncrypto::BignumPointer r(p1363Sig.data, bytesOfRSValue);
    if (!r) {
        return false;
    }

    ncrypto::BignumPointer s(p1363Sig.data + bytesOfRSValue, bytesOfRSValue);
    if (!s) {
        return false;
    }

    // Create a new ECDSA_SIG structure and set r and s components
    auto asn1_sig = ncrypto::ECDSASigPointer::New();
    if (!asn1_sig) {
        return false;
    }

    if (!asn1_sig.setParams(WTFMove(r), WTFMove(s))) {
        return false;
    }

    // Encode the signature in DER format
    auto buf = asn1_sig.encode();
    if (buf.len < 0) {
        return false;
    }

    if (!derBuffer.tryAppend(std::span<uint8_t> { buf.data, buf.len })) {
        return false;
    }

    return true;
}

JSC::JSArrayBufferView* getArrayBufferOrView(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral argName, BufferEncodingType encoding)
{
    if (value.isString()) {
        JSString* dataString = value.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        auto dataView = dataString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        encoding = encoding == BufferEncodingType::buffer ? BufferEncodingType::utf8 : encoding;
        JSValue buf = JSValue::decode(WebCore::constructFromEncoding(globalObject, dataView, encoding));
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

    return getArrayBufferOrView(globalObject, scope, value, argName, jsUndefined());
}

// maybe replace other getArrayBufferOrView
GCOwnedDataScope<std::span<const uint8_t>> getArrayBufferOrView2(JSGlobalObject* globalObject, ThrowScope& scope, JSValue dataValue, ASCIILiteral argName, JSValue encodingValue, bool arrayBufferViewOnly)
{
    using Return = GCOwnedDataScope<std::span<const uint8_t>>;

    if (auto* view = jsDynamicCast<JSArrayBufferView*>(dataValue)) {
        return { view, view->span() };
    }

    if (arrayBufferViewOnly) {
        ERR::INVALID_ARG_INSTANCE(scope, globalObject, argName, "Buffer, TypedArray, or DataView"_s, dataValue);
        return { nullptr, {} };
    };

    if (auto* arrayBuffer = jsDynamicCast<JSArrayBuffer*>(dataValue)) {
        return { arrayBuffer, arrayBuffer->impl()->span() };
    }

    if (dataValue.isString()) {
        auto* str = dataValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, Return(nullptr, {}));
        auto strView = str->view(globalObject);
        RETURN_IF_EXCEPTION(scope, Return(nullptr, {}));

        BufferEncodingType encoding = BufferEncodingType::utf8;
        if (encodingValue.isString()) {
            auto* encodingString = encodingValue.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, Return(nullptr, {}));
            auto encodingView = encodingString->view(globalObject);
            RETURN_IF_EXCEPTION(scope, Return(nullptr, {}));

            if (encodingView != "buffer"_s) {
                encoding = parseEnumerationFromView<BufferEncodingType>(encodingView).value_or(BufferEncodingType::utf8);
                RETURN_IF_EXCEPTION(scope, Return(nullptr, {}));
            }
        }

        JSValue buffer = JSValue::decode(WebCore::constructFromEncoding(globalObject, strView, encoding));
        RETURN_IF_EXCEPTION(scope, Return(nullptr, {}));

        if (auto* view = jsDynamicCast<JSArrayBufferView*>(buffer)) {
            return { view, view->span() };
        }
    }

    ERR::INVALID_ARG_TYPE(scope, globalObject, argName, "string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView"_s, dataValue);
    return Return(nullptr, {});
}

JSC::JSArrayBufferView* getArrayBufferOrView(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral argName, JSValue encodingValue, bool defaultBufferEncoding)
{
    if (value.isString()) {
        JSString* dataString = value.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        auto maybeEncoding = encodingValue.pureToBoolean() == TriState::True ? WebCore::parseEnumerationAllowBuffer(*globalObject, encodingValue) : std::optional<BufferEncodingType> { BufferEncodingType::utf8 };
        RETURN_IF_EXCEPTION(scope, {});

        if (!maybeEncoding && !defaultBufferEncoding) {
            ERR::UNKNOWN_ENCODING(scope, globalObject, encodingValue);
            return {};
        }

        auto encoding = maybeEncoding.has_value() ? maybeEncoding.value() : BufferEncodingType::buffer;

        if (encoding == BufferEncodingType::hex && dataString->length() % 2 != 0) {
            Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "encoding"_s, encodingValue, makeString("is invalid for data of length "_s, dataString->length()));
            return {};
        }

        auto dataView = dataString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        encoding = encoding == BufferEncodingType::buffer ? BufferEncodingType::utf8 : encoding;
        JSValue buf = JSValue::decode(WebCore::constructFromEncoding(globalObject, dataView, encoding));
        RETURN_IF_EXCEPTION(scope, {});

        auto* view = jsDynamicCast<JSC::JSArrayBufferView*>(buf);
        if (!view) {
            ERR::INVALID_ARG_TYPE_INSTANCE(scope, globalObject, argName, "string"_s, "Buffer, TypedArray, or DataView"_s, value);
            return {};
        }

        if (view->isDetached()) {
            throwTypeError(globalObject, scope, "Buffer is detached"_s);
            return {};
        }

        return view;
    }

    if (!value.isCell() || !JSC::isTypedArrayTypeIncludingDataView(value.asCell()->type())) {
        ERR::INVALID_ARG_TYPE_INSTANCE(scope, globalObject, argName, "string"_s, "Buffer, TypedArray, or DataView"_s, value);
        return {};
    }

    auto* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(value);
    if (!view) {
        ERR::INVALID_ARG_TYPE_INSTANCE(scope, globalObject, argName, "string"_s, "Buffer, TypedArray, or DataView"_s, value);
        return {};
    }

    if (view->isDetached()) {
        throwTypeError(globalObject, scope, "Buffer is detached"_s);
        return {};
    }

    return view;
}

std::optional<std::span<const uint8_t>> getBuffer(JSC::JSValue maybeBuffer)
{
    if (auto* view = jsDynamicCast<JSArrayBufferView*>(maybeBuffer)) {
        if (view->isDetached()) {
            return std::nullopt;
        }

        return view->span();
    }

    if (auto* arrayBuffer = jsDynamicCast<JSArrayBuffer*>(maybeBuffer)) {
        auto* buffer = arrayBuffer->impl();
        if (buffer->isDetached()) {
            return std::nullopt;
        }

        return buffer->span();
    }

    return std::nullopt;
}

bool isStringOrBuffer(JSValue value)
{
    if (value.isString()) {
        return true;
    }

    if (jsDynamicCast<JSArrayBufferView*>(value)) {
        return true;
    }

    if (jsDynamicCast<JSArrayBuffer*>(value)) {
        return true;
    }

    return false;
}

String makeOptionString(WTF::StringView objName, const ASCIILiteral& optionName)
{
    return objName.isNull() ? makeString("options."_s, optionName) : makeString("options."_s, objName, '.', optionName);
}

ncrypto::EVPKeyPointer::PKFormatType parseKeyFormat(JSGlobalObject* globalObject, ThrowScope& scope, JSValue formatValue, std::optional<EVPKeyPointer::PKFormatType> defaultFormat, WTF::String optionName)
{
    if (formatValue.isUndefined() && defaultFormat) {
        return *defaultFormat;
    }

    if (formatValue.isString()) {
        JSString* formatString = formatValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        GCOwnedDataScope<WTF::StringView> formatView = formatString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        if (formatView == "pem"_s) {
            return EVPKeyPointer::PKFormatType::PEM;
        } else if (formatView == "der"_s) {
            return EVPKeyPointer::PKFormatType::DER;
        } else if (formatView == "jwk"_s) {
            return EVPKeyPointer::PKFormatType::JWK;
        }
    }

    ERR::INVALID_ARG_VALUE(scope, globalObject, optionName, formatValue);
    return {};
}

std::optional<EVPKeyPointer::PKEncodingType> parseKeyType(JSGlobalObject* globalObject, ThrowScope& scope, JSValue typeValue, bool required, JSValue keyTypeValue, std::optional<bool> isPublic, WTF::String optionName)
{
    if (typeValue.isUndefined() && !required) {
        return std::nullopt;
    }

    WTF::StringView keyTypeView = WTF::nullStringView();
    if (!keyTypeValue.isUndefined()) {
        keyTypeView = keyTypeValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
    }

    if (typeValue.isString()) {
        JSString* typeString = typeValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        GCOwnedDataScope<WTF::StringView> typeView = typeString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        if (typeView == "pkcs1"_s) {
            if (!keyTypeView.isNull() && keyTypeView != "rsa"_s) {
                ERR::CRYPTO_INCOMPATIBLE_KEY_OPTIONS(scope, globalObject, typeView, "can only be used for RSA keys"_s);
                return std::nullopt;
            }
            return EVPKeyPointer::PKEncodingType::PKCS1;
        }

        if (typeView == "spki"_s && (!isPublic || *isPublic != false)) {
            return EVPKeyPointer::PKEncodingType::SPKI;
        }

        if (typeView == "pkcs8"_s && (!isPublic || *isPublic != true)) {
            return EVPKeyPointer::PKEncodingType::PKCS8;
        }

        if (typeView == "sec1"_s && (!isPublic || *isPublic != true)) {
            if (!keyTypeView.isNull() && keyTypeView != "ec"_s) {
                ERR::CRYPTO_INCOMPATIBLE_KEY_OPTIONS(scope, globalObject, typeView, "can only be used for EC keys"_s);
                return std::nullopt;
            }
            return EVPKeyPointer::PKEncodingType::SEC1;
        }
    }

    ERR::INVALID_ARG_VALUE(scope, globalObject, optionName, typeValue);
    return std::nullopt;
}

void parseKeyFormatAndType(JSGlobalObject* globalObject, ThrowScope& scope, JSObject* enc, JSValue keyTypeValue, std::optional<bool> isPublic, bool isInput, WTF::StringView objName, EVPKeyPointer::PrivateKeyEncodingConfig& config)
{
    VM& vm = globalObject->vm();

    JSValue formatValue = enc->get(globalObject, Identifier::fromString(vm, "format"_s));
    RETURN_IF_EXCEPTION(scope, );
    JSValue typeValue = enc->get(globalObject, Identifier::fromString(vm, "type"_s));
    RETURN_IF_EXCEPTION(scope, );

    config.format = parseKeyFormat(globalObject, scope, formatValue, isInput ? std::optional { EVPKeyPointer::PKFormatType::PEM } : std::nullopt, makeOptionString(objName, "format"_s));
    RETURN_IF_EXCEPTION(scope, );

    bool isRequired = (!isInput || config.format == EVPKeyPointer::PKFormatType::DER) && config.format != EVPKeyPointer::PKFormatType::JWK;
    std::optional<EVPKeyPointer::PKEncodingType> maybeKeyType = parseKeyType(globalObject, scope, typeValue, isRequired, keyTypeValue, isPublic, makeOptionString(objName, "type"_s));
    RETURN_IF_EXCEPTION(scope, );

    if (maybeKeyType) {
        config.type = *maybeKeyType;
    }
}

void parseKeyEncoding(JSGlobalObject* globalObject, ThrowScope& scope, JSObject* enc, JSValue keyTypeValue, std::optional<bool> isPublic, WTF::StringView objName, EVPKeyPointer::PrivateKeyEncodingConfig& config)
{
    VM& vm = globalObject->vm();

    bool isInput = keyTypeValue.isUndefined();

    parseKeyFormatAndType(globalObject, scope, enc, keyTypeValue, isPublic, isInput, objName, config);
    RETURN_IF_EXCEPTION(scope, );

    JSValue encodingValue = jsUndefined();
    JSValue passphraseValue = jsUndefined();
    JSValue cipherValue = jsUndefined();

    if (!isPublic || *isPublic != true) {
        cipherValue = enc->get(globalObject, Identifier::fromString(vm, "cipher"_s));
        RETURN_IF_EXCEPTION(scope, );
        passphraseValue = enc->get(globalObject, Identifier::fromString(vm, "passphrase"_s));
        RETURN_IF_EXCEPTION(scope, );
        encodingValue = enc->get(globalObject, Identifier::fromString(vm, "encoding"_s));
        RETURN_IF_EXCEPTION(scope, );

        if (!isInput) {
            if (!cipherValue.isUndefinedOrNull()) {
                if (!cipherValue.isString()) {
                    ERR::INVALID_ARG_VALUE(scope, globalObject, makeOptionString(objName, "cipher"_s), cipherValue);
                    return;
                }
                if (config.format == EVPKeyPointer::PKFormatType::DER && (config.type == EVPKeyPointer::PKEncodingType::PKCS1 || config.type == EVPKeyPointer::PKEncodingType::SEC1)) {
                    ERR::CRYPTO_INCOMPATIBLE_KEY_OPTIONS(scope, globalObject, EVPKeyPointer::EncodingName(config.type), "does not support encryption"_s);
                    return;
                }
            } else if (!passphraseValue.isUndefined()) {
                ERR::INVALID_ARG_VALUE(scope, globalObject, makeOptionString(objName, "cipher"_s), cipherValue);
                return;
            }
        }

        if ((isInput && !passphraseValue.isUndefined() && !isStringOrBuffer(passphraseValue)) || (!isInput && !cipherValue.isUndefinedOrNull() && !isStringOrBuffer(passphraseValue))) {
            ERR::INVALID_ARG_VALUE(scope, globalObject, makeOptionString(objName, "passphrase"_s), passphraseValue);
            return;
        }
    }

    if (!passphraseValue.isUndefined()) {
        JSArrayBufferView* passphraseView = getArrayBufferOrView(globalObject, scope, passphraseValue, "key.passphrase"_s, encodingValue);
        RETURN_IF_EXCEPTION(scope, );
        config.passphrase = DataPointer::FromSpan(passphraseView->span());
    }

    if (config.output_key_object) {
        if (!isInput) {
        }
    } else {
        if (!isInput) {
            if (cipherValue.isString()) {
                JSString* cipherString = cipherValue.toString(globalObject);
                RETURN_IF_EXCEPTION(scope, );
                GCOwnedDataScope<WTF::StringView> cipherView = cipherString->view(globalObject);
                RETURN_IF_EXCEPTION(scope, );
                config.cipher = getCipherByName(cipherView);
                if (config.cipher == nullptr) {
                    ERR::CRYPTO_UNKNOWN_CIPHER(scope, globalObject, cipherView);
                    return;
                }
            } else {
                config.cipher = nullptr;
            }
        }
    }
}

void parsePublicKeyEncoding(JSGlobalObject* globalObject, ThrowScope& scope, JSObject* enc, JSValue keyTypeValue, WTF::StringView objName, EVPKeyPointer::PublicKeyEncodingConfig& config)
{
    EVPKeyPointer::PrivateKeyEncodingConfig dummyConfig = {};
    parseKeyEncoding(globalObject, scope, enc, keyTypeValue, keyTypeValue.pureToBoolean() != TriState::False ? std::optional<bool>(true) : std::nullopt, objName, dummyConfig);
    RETURN_IF_EXCEPTION(scope, );

    // using private config because it's a super set of public config
    config.format = dummyConfig.format;
    config.type = dummyConfig.type;
    config.output_key_object = dummyConfig.output_key_object;
}

void parsePrivateKeyEncoding(JSGlobalObject* globalObject, ThrowScope& scope, JSObject* enc, JSValue keyTypeValue, WTF::StringView objName, EVPKeyPointer::PrivateKeyEncodingConfig& config)
{
    parseKeyEncoding(globalObject, scope, enc, keyTypeValue, false, objName, config);
}

bool isArrayBufferOrView(JSValue value)
{
    if (value.isCell()) {
        auto type = value.asCell()->type();
        if (type >= Int8ArrayType && type <= DataViewType) {
            return true;
        }
        if (type == ArrayBufferType) {
            return true;
        }
    }

    return false;
}

bool isKeyValidForCurve(const EC_GROUP* group, const ncrypto::BignumPointer& privateKey)
{
    if (!group || !privateKey)
        return false;

    // Private keys must be in the range [1, n-1]
    // where n is the order of the curve
    if (privateKey < ncrypto::BignumPointer::One())
        return false;

    auto order = ncrypto::BignumPointer::New();
    if (!order)
        return false;

    if (!EC_GROUP_get_order(group, order.get(), nullptr))
        return false;

    return privateKey < order;
}

ByteSource::ByteSource(ByteSource&& other) noexcept
    : data_(other.data_)
    , allocated_data_(other.allocated_data_)
    , size_(other.size_)
{
    other.allocated_data_ = nullptr;
}

ByteSource::~ByteSource()
{
    OPENSSL_clear_free(allocated_data_, size_);
}

std::span<const uint8_t> ByteSource::span() const
{
    return { reinterpret_cast<const uint8_t*>(data_), size_ };
}

ByteSource& ByteSource::operator=(ByteSource&& other) noexcept
{
    if (&other != this) {
        OPENSSL_clear_free(allocated_data_, size_);
        data_ = other.data_;
        allocated_data_ = other.allocated_data_;
        other.allocated_data_ = nullptr;
        size_ = other.size_;
    }
    return *this;
}

ByteSource ByteSource::fromBIO(const ncrypto::BIOPointer& bio)
{
    ASSERT(bio);
    BUF_MEM* bptr = bio;
    auto out = ncrypto::DataPointer::Alloc(bptr->length);
    memcpy(out.get(), bptr->data, bptr->length);
    return ByteSource::allocated(out.release());
}

ByteSource ByteSource::allocated(void* data, size_t size)
{
    return ByteSource(data, data, size);
}

ByteSource ByteSource::foreign(const void* data, size_t size)
{
    return ByteSource(data, nullptr, size);
}

}
