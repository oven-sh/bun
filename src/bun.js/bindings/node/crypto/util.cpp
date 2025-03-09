#include "util.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <openssl/err.h>
#include "ErrorCode.h"
#include "ncrypto.h"
#include "BunString.h"
#include "JSBuffer.h"
#include "JSDOMConvertEnumeration.h"
#include "JSCryptoKey.h"
#include "CryptoKeyRSA.h"
#include "AsymmetricKeyValue.h"
#include "KeyObject.h"
#include "JSVerify.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include "CryptoKeyRaw.h"

namespace Bun {

using namespace JSC;

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

    if (UNLIKELY(!bytes.size() and encoding != BufferEncodingType::buffer)) {
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

        auto encoding = parseEnumeration<WebCore::BufferEncodingType>(*globalObject, encodingValue).value_or(WebCore::BufferEncodingType::utf8);
        RETURN_IF_EXCEPTION(scope, {});

        if (encoding == WebCore::BufferEncodingType::hex && dataString->length() % 2 != 0) {
            Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "encoding"_s, encodingValue, makeString("is invalid for data of length "_s, dataString->length()));
            return {};
        }

        JSValue buf = JSValue::decode(WebCore::constructFromEncoding(globalObject, dataString, encoding));
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

std::optional<ncrypto::EVPKeyPointer> preparePrivateKey(JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSValue maybeKey, std::optional<WebCore::CryptoAlgorithmIdentifier> algorithmIdentifier)
{
    ncrypto::ClearErrorOnReturn clearError;

    VM& vm = lexicalGlobalObject->vm();

    if (!maybeKey.isCell()) {
        Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key"_s, "ArrayBuffer, Buffer, TypedArray, DataView, string, KeyObject, or CryptoKey"_s, maybeKey);
        return std::nullopt;
    }

    auto optionsCell = maybeKey.asCell();
    auto optionsType = optionsCell->type();

    if (optionsCell->inherits<WebCore::JSCryptoKey>()) {
        auto* cryptoKey = jsCast<WebCore::JSCryptoKey*>(optionsCell);

        // convert it to a key object, then to EVPKeyPointer
        auto& key = cryptoKey->wrapped();

        if (algorithmIdentifier) {
            switch (key.keyClass()) {
            case CryptoKeyClass::RSA: {
                const auto& rsa = downcast<WebCore::CryptoKeyRSA>(key);
                CryptoAlgorithmIdentifier restrictHash;
                bool isRestricted = rsa.isRestrictedToHash(restrictHash);
                if (isRestricted && algorithmIdentifier.value() != restrictHash) {
                    JSC::throwTypeError(lexicalGlobalObject, scope, "digest not allowed"_s);
                    return std::nullopt;
                }
            }
            default:
                break;
            }
        }

        AsymmetricKeyValue keyValue(key);
        if (keyValue.key) {
            EVP_PKEY_up_ref(keyValue.key);
            ncrypto::EVPKeyPointer keyPtr(keyValue.key);
            return keyPtr;
        }

        throwCryptoOperationFailed(lexicalGlobalObject, scope);
        return std::nullopt;
    } else if (maybeKey.isObject()) {
        JSObject* optionsObj = optionsCell->getObject();
        const auto& names = WebCore::builtinNames(vm);

        if (auto val = optionsObj->getIfPropertyExists(lexicalGlobalObject, names.bunNativePtrPrivateName())) {
            if (val.isCell() && val.inherits<WebCore::JSCryptoKey>()) {
                auto* cryptoKey = jsCast<WebCore::JSCryptoKey*>(val.asCell());

                auto& key = cryptoKey->wrapped();

                if (algorithmIdentifier) {
                    switch (key.keyClass()) {
                    case CryptoKeyClass::RSA: {
                        const auto& rsa = downcast<WebCore::CryptoKeyRSA>(key);
                        CryptoAlgorithmIdentifier restrictHash;
                        bool isRestricted = rsa.isRestrictedToHash(restrictHash);
                        if (isRestricted && algorithmIdentifier.value() != restrictHash) {
                            JSC::throwTypeError(lexicalGlobalObject, scope, "digest not allowed"_s);
                            return std::nullopt;
                        }
                    }
                    default:
                        break;
                    }
                }

                AsymmetricKeyValue keyValue(key);
                if (keyValue.key) {
                    EVP_PKEY_up_ref(keyValue.key);
                    ncrypto::EVPKeyPointer keyPtr(keyValue.key);
                    return keyPtr;
                }
                throwCryptoOperationFailed(lexicalGlobalObject, scope);
                return std::nullopt;
            }
        } else if (optionsType >= Int8ArrayType && optionsType <= DataViewType) {
            auto dataBuf = KeyObject__GetBuffer(maybeKey);
            if (dataBuf.hasException()) {
                return std::nullopt;
            }

            ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig config;
            config.format = ncrypto::EVPKeyPointer::PKFormatType::PEM;

            auto buffer = dataBuf.releaseReturnValue();
            ncrypto::Buffer<const unsigned char> ncryptoBuf {
                .data = buffer.data(),
                .len = buffer.size(),
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

        JSValue key = optionsObj->get(lexicalGlobalObject, Identifier::fromString(vm, "key"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue encodingValue = optionsObj->get(lexicalGlobalObject, Identifier::fromString(vm, "encoding"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue passphrase = optionsObj->get(lexicalGlobalObject, Identifier::fromString(vm, "passphrase"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue formatValue = optionsObj->get(lexicalGlobalObject, Identifier::fromString(vm, "format"_s));
        RETURN_IF_EXCEPTION(scope, {});
        WTF::StringView formatStr = WTF::nullStringView();
        if (formatValue.isString()) {
            auto str = formatValue.toString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
            formatStr = str->view(lexicalGlobalObject);
        }

        if (!key.isCell()) {
            if (formatStr == "jwk"_s) {
                Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.key"_s, "object"_s, key);
            } else {
                Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.key"_s, "ArrayBuffer, Buffer, TypedArray, DataView, string, KeyObject, or CryptoKey"_s, key);
            }
            return std::nullopt;
        }

        String encodingString = encodingValue.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});

        auto keyCell = key.asCell();
        auto keyCellType = keyCell->type();
        if (keyCell->inherits<WebCore::JSCryptoKey>()) {
            auto* cryptoKey = jsCast<WebCore::JSCryptoKey*>(keyCell);
            auto& key = cryptoKey->wrapped();

            if (algorithmIdentifier) {
                switch (key.keyClass()) {
                case CryptoKeyClass::RSA: {
                    const auto& rsa = downcast<WebCore::CryptoKeyRSA>(key);
                    CryptoAlgorithmIdentifier restrictHash;
                    bool isRestricted = rsa.isRestrictedToHash(restrictHash);
                    if (isRestricted && algorithmIdentifier.value() != restrictHash) {
                        JSC::throwTypeError(lexicalGlobalObject, scope, "digest not allowed"_s);
                        return std::nullopt;
                    }
                }
                default:
                    break;
                }
            }

            AsymmetricKeyValue keyValue(key);
            if (keyValue.key) {
                EVP_PKEY_up_ref(keyValue.key);
                ncrypto::EVPKeyPointer keyPtr(keyValue.key);
                return keyPtr;
            }
            throwCryptoOperationFailed(lexicalGlobalObject, scope);
            return std::nullopt;
        } else if (key.isObject()) {
            JSObject* keyObj = key.getObject();
            if (auto keyVal = keyObj->getIfPropertyExists(lexicalGlobalObject, names.bunNativePtrPrivateName())) {
                if (keyVal.isCell() && keyVal.inherits<WebCore::JSCryptoKey>()) {
                    auto* cryptoKey = jsCast<WebCore::JSCryptoKey*>(keyVal.asCell());

                    auto& key = cryptoKey->wrapped();
                    AsymmetricKeyValue keyValue(key);
                    if (keyValue.key) {
                        EVP_PKEY_up_ref(keyValue.key);
                        ncrypto::EVPKeyPointer keyPtr(WTFMove(keyValue.key));
                        return keyPtr;
                    }
                    throwCryptoOperationFailed(lexicalGlobalObject, scope);
                    return std::nullopt;
                }
            } else if (keyCellType >= Int8ArrayType && keyCellType <= DataViewType) {
                auto dataBuf = KeyObject__GetBuffer(key);
                if (dataBuf.hasException()) {
                    return std::nullopt;
                }

                ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig config;
                config.format = parseKeyFormat(lexicalGlobalObject, formatValue, "options.format"_s, ncrypto::EVPKeyPointer::PKFormatType::PEM);

                config.passphrase = passphraseFromBufferSource(lexicalGlobalObject, scope, passphrase);
                RETURN_IF_EXCEPTION(scope, std::nullopt);

                // Get the type value from options
                JSValue typeValue = optionsObj->get(lexicalGlobalObject, Identifier::fromString(vm, "type"_s));
                RETURN_IF_EXCEPTION(scope, std::nullopt);

                // Parse key type for private key
                auto keyType = parseKeyType(lexicalGlobalObject, typeValue, config.format == ncrypto::EVPKeyPointer::PKFormatType::DER, WTF::nullStringView(), false, "options.type"_s);
                RETURN_IF_EXCEPTION(scope, std::nullopt);
                config.type = keyType.value_or(ncrypto::EVPKeyPointer::PKEncodingType::PKCS1);

                auto buffer = dataBuf.releaseReturnValue();
                ncrypto::Buffer<const unsigned char> ncryptoBuf {
                    .data = buffer.data(),
                    .len = buffer.size(),
                };

                auto res = ncrypto::EVPKeyPointer::TryParsePrivateKey(config, ncryptoBuf);
                if (!res) {
                    if (res.error.value() == ncrypto::EVPKeyPointer::PKParseError::NEED_PASSPHRASE) {
                        Bun::ERR::MISSING_PASSPHRASE(scope, lexicalGlobalObject, "Passphrase required for encrypted key"_s);
                        return std::nullopt;
                    }

                    throwCryptoError(lexicalGlobalObject, scope, res.openssl_error.value_or(0), "Failed to read private key"_s);
                    return std::nullopt;
                }

                ncrypto::EVPKeyPointer keyPtr(WTFMove(res.value));
                return keyPtr;
            } else if (formatStr == "jwk"_s) {
                bool isPublic = false;
                return getKeyObjectHandleFromJwk(lexicalGlobalObject, scope, key, isPublic);
            }
        } else if (formatStr == "jwk"_s) {
            bool isPublic = false;
            return getKeyObjectHandleFromJwk(lexicalGlobalObject, scope, key, isPublic);
        } else if (key.isString()) {
            WTF::String keyStr = key.toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            return keyFromString(lexicalGlobalObject, scope, keyStr, passphrase);
        }

        Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.key"_s, "ArrayBuffer, Buffer, TypedArray, DataView, string, KeyObject, or CryptoKey"_s, key);
        return std::nullopt;
    } else if (maybeKey.isString()) {
        WTF::String keyStr = maybeKey.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        return keyFromString(lexicalGlobalObject, scope, keyStr, jsUndefined());
    }

    Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key"_s, "ArrayBuffer, Buffer, TypedArray, DataView, string, KeyObject, or CryptoKey"_s, maybeKey);
    return std::nullopt;
}

// takes a key value and encoding value
// - if key is string, returns the key as a vector of bytes, using encoding if !isUndefined
// - if key is isAnyArrayBuffer, return the bytes
// - if !bufferOnly:
//   - if key is KeyObject with native crypto key, extract the key material
//   - if key is CryptoKey, ensure `type` is secret, then extract the key material
// - none matched, throw error for INVALID_ARG_TYPE
void prepareSecretKey(JSGlobalObject* globalObject, ThrowScope& scope, Vector<uint8_t>& out, JSValue key, JSValue encodingValue, bool bufferOnly)
{
    VM& vm = globalObject->vm();

    // Handle KeyObject (if not bufferOnly)
    if (!bufferOnly && key.isObject()) {
        JSObject* obj = key.getObject();
        auto& names = WebCore::builtinNames(vm);

        // Check for BunNativePtr on the object
        if (auto val = obj->getIfPropertyExists(globalObject, names.bunNativePtrPrivateName())) {
            if (auto* cryptoKey = jsDynamicCast<JSCryptoKey*>(val.asCell())) {

                JSValue typeValue = obj->get(globalObject, Identifier::fromString(vm, "type"_s));
                RETURN_IF_EXCEPTION(scope, );

                auto wrappedKey = cryptoKey->protectedWrapped();

                if (!typeValue.isString()) {
                    Bun::ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, typeValue, "secret"_s);
                    return;
                }

                WTF::String typeString = typeValue.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, );

                if (wrappedKey->type() != CryptoKeyType::Secret || typeString != "secret"_s) {
                    Bun::ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, typeValue, "secret"_s);
                    return;
                }

                auto keyData = getSymmetricKey(wrappedKey);

                if (UNLIKELY(!keyData)) {
                    Bun::ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, typeValue, "secret"_s);
                    return;
                }

                out.append(keyData.value());
                return;
            }
        }
    }

    // Handle string or buffer
    if (key.isString()) {
        JSString* keyString = key.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, );

        auto encoding = parseEnumeration<WebCore::BufferEncodingType>(*globalObject, encodingValue).value_or(WebCore::BufferEncodingType::utf8);
        RETURN_IF_EXCEPTION(scope, );
        if (encoding == WebCore::BufferEncodingType::buffer) {
            encoding = WebCore::BufferEncodingType::utf8;
        }

        // TODO(dylan-conway): add a way to do this with just the Vector. no need to create a buffer
        JSValue buffer = JSValue::decode(WebCore::constructFromEncoding(globalObject, keyString, encoding));
        auto* view = jsDynamicCast<JSC::JSArrayBufferView*>(buffer);
        out.append(std::span { reinterpret_cast<const uint8_t*>(view->vector()), view->byteLength() });
        return;
    }

    // Handle ArrayBuffer types
    if (auto* view = jsDynamicCast<JSC::JSArrayBufferView*>(key)) {
        out.append(std::span { reinterpret_cast<const uint8_t*>(view->vector()), view->byteLength() });
        return;
    }

    // If we got here, the key is not a valid type
    WTF::String expectedTypes = bufferOnly ? "ArrayBuffer, Buffer, TypedArray, DataView, or a string"_s : "ArrayBuffer, Buffer, TypedArray, DataView, string, CryptoKey, or KeyObject"_s;
    Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, expectedTypes, key);
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
