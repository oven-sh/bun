#include "JSSign.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSType.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "JSBufferEncodingType.h"
#include "KeyObject.h"
#include "JSCryptoKey.h"
#include "AsymmetricKeyValue.h"
#include "NodeValidator.h"
#include "JSBuffer.h"
#include "util.h"
#include "BunString.h"
#include "JSVerify.h"

namespace Bun {

using namespace JSC;

// Forward declarations for prototype functions
JSC_DECLARE_HOST_FUNCTION(jsSignProtoFuncInit);
JSC_DECLARE_HOST_FUNCTION(jsSignProtoFuncUpdate);
JSC_DECLARE_HOST_FUNCTION(jsSignProtoFuncSign);

// Constructor functions
JSC_DECLARE_HOST_FUNCTION(callSign);
JSC_DECLARE_HOST_FUNCTION(constructSign);

// Property table for Sign prototype
static const JSC::HashTableValue JSSignPrototypeTableValues[] = {
    { "init"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { JSC::HashTableValue::NativeFunctionType, jsSignProtoFuncInit, 1 } },
    { "update"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { JSC::HashTableValue::NativeFunctionType, jsSignProtoFuncUpdate, 2 } },
    { "sign"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { JSC::HashTableValue::NativeFunctionType, jsSignProtoFuncSign, 2 } },
};

// JSSign implementation
const JSC::ClassInfo JSSign::s_info = { "Sign"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSign) };

JSSign::JSSign(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

void JSSign::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
}

JSSign* JSSign::create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject)
{
    JSSign* sign = new (NotNull, JSC::allocateCell<JSSign>(vm)) JSSign(vm, structure);
    sign->finishCreation(vm, globalObject);
    return sign;
}

JSC::Structure* JSSign::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

template<typename CellType, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSSign::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<CellType, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSSign.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSSign = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSSign.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSSign = std::forward<decltype(space)>(space); });
}

// JSSignPrototype implementation
const JSC::ClassInfo JSSignPrototype::s_info = { "Sign"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSignPrototype) };

JSSignPrototype::JSSignPrototype(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

void JSSignPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSSign::info(), JSSignPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSSignPrototype* JSSignPrototype::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    JSSignPrototype* prototype = new (NotNull, JSC::allocateCell<JSSignPrototype>(vm)) JSSignPrototype(vm, structure);
    prototype->finishCreation(vm);
    return prototype;
}

JSC::Structure* JSSignPrototype::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    structure->setMayBePrototype(true);
    return structure;
}

// JSSignConstructor implementation
const JSC::ClassInfo JSSignConstructor::s_info = { "Sign"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSignConstructor) };

JSSignConstructor::JSSignConstructor(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure, callSign, constructSign)
{
}

void JSSignConstructor::finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
{
    Base::finishCreation(vm, 0, "Sign"_s);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}

JSSignConstructor* JSSignConstructor::create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
{
    JSSignConstructor* constructor = new (NotNull, JSC::allocateCell<JSSignConstructor>(vm)) JSSignConstructor(vm, structure);
    constructor->finishCreation(vm, prototype);
    return constructor;
}

JSC::Structure* JSSignConstructor::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
}

// Prototype function implementations
JSC_DEFINE_HOST_FUNCTION(jsSignProtoFuncInit, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Get the JSSign object from thisValue and verify it's valid
    JSSign* thisObject = jsDynamicCast<JSSign*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        Bun::throwThisTypeError(*globalObject, scope, "Sign"_s, "init"_s);
        return {};
    }

    // Check that we have at least 1 argument (the digest name)
    if (callFrame->argumentCount() < 1) {
        throwVMError(globalObject, scope, "Sign.prototype.init requires at least 1 argument"_s);
        return {};
    }

    // Verify the first argument is a string and extract it
    JSC::JSValue digestArg = callFrame->argument(0);
    if (!digestArg.isString()) {
        throwTypeError(globalObject, scope, "First argument must be a string specifying the hash function"_s);
        return {};
    }

    // Convert the digest name to a string_view
    WTF::String digestName = digestArg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Get the EVP_MD* for the digest using ncrypto helper
    auto* digest = ncrypto::getDigestByName(digestName);
    if (!digest) {
        return Bun::ERR::CRYPTO_INVALID_DIGEST(scope, globalObject, digestName);
    }

    // Create a new EVPMDCtxPointer using ncrypto's wrapper
    auto mdCtx = ncrypto::EVPMDCtxPointer::New();
    if (!mdCtx) {
        throwTypeError(globalObject, scope, "Failed to create message digest context"_s);
        return {};
    }

    // Initialize the digest context with proper error handling
    if (!mdCtx.digestInit(digest)) {
        throwTypeError(globalObject, scope, "Failed to initialize message digest"_s);
        return {};
    }

    // Store the initialized context in the JSSign object
    thisObject->m_mdCtx = WTFMove(mdCtx);

    return JSC::JSValue::encode(JSC::jsUndefined());
}

void updateWithBufferView(JSGlobalObject* globalObject, JSSign* sign, JSC::JSArrayBufferView* bufferView)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    if (bufferView->isDetached()) {
        throwTypeError(globalObject, scope, "Buffer is detached"_s);
        return;
    }

    size_t byteLength = bufferView->byteLength();
    if (byteLength > INT_MAX) {
        throwRangeError(globalObject, scope, "data is too long"_s);
        return;
    }

    auto buffer = ncrypto::Buffer<const void> {
        .data = bufferView->vector(),
        .len = byteLength,
    };

    if (!sign->m_mdCtx.digestUpdate(buffer)) {
        throwCryptoError(globalObject, scope, ERR_get_error(), "Failed to update digest");
        return;
    }
}

JSC_DEFINE_HOST_FUNCTION(jsSignProtoFuncUpdate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Get the JSSign object from thisValue and verify it's valid
    JSSign* thisObject = jsDynamicCast<JSSign*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        Bun::throwThisTypeError(*globalObject, scope, "Sign"_s, "update"_s);
        return JSValue::encode({});
    }

    // Check that we have at least 1 argument (the data)
    if (callFrame->argumentCount() < 1) {
        throwVMError(globalObject, scope, "Sign.prototype.update requires at least 1 argument"_s);
        return JSValue::encode({});
    }

    // Get the data argument
    JSC::JSValue data = callFrame->argument(0);

    // if it's a string, using encoding for decode. if it's a buffer, just use the buffer
    if (data.isString()) {
        JSString* dataString = data.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

        JSValue encodingValue = callFrame->argument(1);
        auto encoding = parseEnumeration<BufferEncodingType>(*globalObject, encodingValue).value_or(BufferEncodingType::utf8);
        RETURN_IF_EXCEPTION(scope, {});

        if (encoding == BufferEncodingType::hex && dataString->length() % 2 != 0) {
            return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "encoding"_s, encodingValue, makeString("is invalid for data of length "_s, dataString->length()));
        }

        JSValue buf = JSValue::decode(constructFromEncoding(globalObject, dataString, encoding));
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

        auto* view = jsDynamicCast<JSC::JSArrayBufferView*>(buf);

        updateWithBufferView(globalObject, thisObject, view);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

        return JSValue::encode(callFrame->thisValue());
    }

    if (!data.isCell() || !JSC::isTypedArrayTypeIncludingDataView(data.asCell()->type())) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "data"_s, "string or an instance of Buffer, TypedArray, or DataView"_s, data);
    }

    // Handle ArrayBufferView input
    if (auto* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(data)) {

        updateWithBufferView(globalObject, thisObject, view);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

        return JSValue::encode(callFrame->thisValue());
    }

    return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "data"_s, "string or an instance of Buffer, TypedArray, or DataView"_s, data);
}

JSUint8Array* signWithKey(JSC::JSGlobalObject* lexicalGlobalObject, JSSign* thisObject, const ncrypto::EVPKeyPointer& pkey, NodeCryptoKeys::DSASigEnc dsa_sig_enc, int padding, std::optional<int> salt_len)
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Check if the context is initialized
    if (!thisObject->m_mdCtx) {
        throwTypeError(lexicalGlobalObject, scope, "Sign.prototype.sign cannot be called before Sign.prototype.init"_s);
        return nullptr;
    }

    // Move mdCtx out of JSSign object
    ncrypto::EVPMDCtxPointer mdCtx = WTFMove(thisObject->m_mdCtx);

    // Validate DSA parameters
    if (!pkey.validateDsaParameters()) {
        throwTypeError(lexicalGlobalObject, scope, "Invalid DSA parameters"_s);
        return nullptr;
    }

    // Get the final digest
    auto data = mdCtx.digestFinal(mdCtx.getExpectedSize());
    if (!data) {
        throwTypeError(lexicalGlobalObject, scope, "Failed to finalize digest"_s);
        return nullptr;
    }

    // Create signing context
    auto pkctx = pkey.newCtx();
    if (!pkctx || pkctx.initForSign() <= 0) {
        throwCryptoError(lexicalGlobalObject, scope, ERR_peek_error(), "Failed to initialize signing context"_s);
        return nullptr;
    }

    // Set RSA padding mode and salt length if applicable
    if (pkey.isRsaVariant()) {
        if (!ncrypto::EVPKeyCtxPointer::setRsaPadding(pkctx.get(), padding, salt_len)) {
            throwCryptoError(lexicalGlobalObject, scope, ERR_peek_error(), "Failed to set RSA padding"_s);
            return nullptr;
        }
    }

    // Set signature MD from the digest context
    if (!pkctx.setSignatureMd(mdCtx)) {
        throwCryptoError(lexicalGlobalObject, scope, ERR_peek_error(), "Failed to set signature message digest"_s);
        return nullptr;
    }

    // Create buffer for signature
    auto sigBuffer = JSC::ArrayBuffer::tryCreate(pkey.size(), 1);
    if (!sigBuffer) {
        throwTypeError(lexicalGlobalObject, scope, "Failed to allocate signature buffer"_s);
        return nullptr;
    }

    // Perform signing operation
    ncrypto::Buffer<unsigned char> sigBuf {
        .data = static_cast<unsigned char*>(sigBuffer->data()),
        .len = pkey.size()
    };

    if (!pkctx.signInto(data, &sigBuf)) {
        throwTypeError(lexicalGlobalObject, scope, "Failed to create signature"_s);
        return nullptr;
    }

    // Convert to P1363 format if requested for EC keys
    if (dsa_sig_enc == NodeCryptoKeys::DSASigEnc::P1363 && pkey.isSigVariant()) {
        auto p1363Size = pkey.getBytesOfRS().value_or(0) * 2;
        if (p1363Size > 0) {
            auto p1363Buffer = JSC::ArrayBuffer::tryCreate(p1363Size, 1);
            if (!p1363Buffer) {
                throwTypeError(lexicalGlobalObject, scope, "Failed to allocate P1363 buffer"_s);
                return nullptr;
            }

            ncrypto::Buffer<const unsigned char> derSig {
                .data = static_cast<const unsigned char*>(sigBuffer->data()),
                .len = sigBuf.len
            };

            if (!ncrypto::extractP1363(derSig, static_cast<unsigned char*>(p1363Buffer->data()), p1363Size / 2)) {
                throwTypeError(lexicalGlobalObject, scope, "Failed to convert signature format"_s);
                return nullptr;
            }

            sigBuffer = p1363Buffer;
        }
    }

    // Create and return JSUint8Array
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    return JSC::JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTFMove(sigBuffer), 0, sigBuf.len);
}

std::optional<ncrypto::EVPKeyPointer> preparePrivateKey(JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSValue maybeKey)
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

JSC_DEFINE_HOST_FUNCTION(jsSignProtoFuncSign, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearError;

    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Get the JSSign object from thisValue and verify it's valid
    JSSign* thisObject = jsDynamicCast<JSSign*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        Bun::throwThisTypeError(*lexicalGlobalObject, scope, "Sign"_s, "sign"_s);
        return {};
    }

    // This function receives two arguments: options and encoding
    JSValue options = callFrame->argument(0);

    bool optionsBool = options.toBoolean(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    // https://github.com/nodejs/node/blob/1b2d2f7e682268228b1352cba7389db01614812a/lib/internal/crypto/sig.js#L116
    if (!optionsBool) {
        return Bun::ERR::CRYPTO_SIGN_KEY_REQUIRED(scope, lexicalGlobalObject);
    }

    if (!options.isCell()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key"_s, "ArrayBuffer, Buffer, TypedArray, DataView, string, KeyObject, or CryptoKey"_s, options);
    }

    JSValue outputEncodingValue = callFrame->argument(1);
    auto outputEncoding = parseEnumeration<BufferEncodingType>(*lexicalGlobalObject, outputEncodingValue).value_or(BufferEncodingType::buffer);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    // Get RSA padding mode and salt length if applicable
    int32_t padding = getPadding(lexicalGlobalObject, options, {});
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    std::optional<int> saltLen = getSaltLength(lexicalGlobalObject, options);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    // Get DSA signature encoding format
    NodeCryptoKeys::DSASigEnc dsaSigEnc = getDSASigEnc(lexicalGlobalObject, options);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    // Get key argument
    std::optional<ncrypto::EVPKeyPointer> maybeKeyPtr = preparePrivateKey(lexicalGlobalObject, scope, options);
    ASSERT(!!scope.exception() == !maybeKeyPtr.has_value());
    if (!maybeKeyPtr) {
        return {};
    }
    ncrypto::EVPKeyPointer keyPtr = WTFMove(maybeKeyPtr.value());

    // Check if key has type property
    JSValue typeValue = options.get(lexicalGlobalObject, Identifier::fromString(vm, "type"_s));
    RETURN_IF_EXCEPTION(scope, {});

    // Parse key type for private key if provided
    std::optional<ncrypto::EVPKeyPointer::PKEncodingType> keyType;
    if (!typeValue.isUndefined() && !typeValue.isNull()) {
        keyType = parseKeyType(lexicalGlobalObject, typeValue, false, WTF::nullStringView(), false, "key.type"_s);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Use the signWithKey function to perform the signing operation
    JSUint8Array* signature = signWithKey(lexicalGlobalObject, thisObject, keyPtr, dsaSigEnc, padding, saltLen);
    if (!signature) {
        return {};
    }

    // If output encoding is not buffer, convert the signature to the requested encoding
    if (outputEncoding != BufferEncodingType::buffer) {
        EncodedJSValue encodedSignature = jsBufferToString(vm, lexicalGlobalObject, signature, 0, signature->byteLength(), outputEncoding);
        RETURN_IF_EXCEPTION(scope, {});
        return encodedSignature;
    }

    return JSValue::encode(signature);
}

// Constructor function implementations
JSC_DEFINE_HOST_FUNCTION(callSign, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwTypeError(globalObject, scope, "Sign constructor cannot be called as a function"_s);
    return JSValue::encode({});
}

JSC_DEFINE_HOST_FUNCTION(constructSign, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSSignClassStructure.get(zigGlobalObject);

    JSC::JSValue newTarget = callFrame->newTarget();
    if (UNLIKELY(zigGlobalObject->m_JSSignClassStructure.constructor(zigGlobalObject) != newTarget)) {
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor Sign cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = JSC::InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->m_JSSignClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSC::JSValue::encode(JSSign::create(vm, structure, globalObject));
}

JSC_DEFINE_HOST_FUNCTION(jsSignOneShot, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearError;

    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto argCount = callFrame->argumentCount();

    // Validate algorithm if provided
    JSValue algorithmValue = callFrame->argument(0);
    const EVP_MD* digest = nullptr;
    if (!algorithmValue.isNull()) {
        Bun::V::validateString(scope, globalObject, algorithmValue, "algorithm"_s);
        RETURN_IF_EXCEPTION(scope, {});

        WTF::String algorithmName = algorithmValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        digest = ncrypto::getDigestByName(algorithmName);
        if (!digest) {
            return Bun::ERR::CRYPTO_INVALID_DIGEST(scope, globalObject, algorithmName);
        }
    }

    // Get data argument
    JSValue dataValue = callFrame->argument(1);
    JSC::JSArrayBufferView* dataView = getArrayBufferOrView(globalObject, scope, dataValue, "data"_s, jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});
    if (!dataView) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "data must be a Buffer, TypedArray, or DataView"_s);
        return {};
    }

    // Get key argument
    JSValue keyValue = callFrame->argument(2);

    std::optional<int> saltLen = getSaltLength(globalObject, keyValue);
    RETURN_IF_EXCEPTION(scope, {});

    // Get DSA signature encoding format
    NodeCryptoKeys::DSASigEnc dsaSigEnc = getDSASigEnc(globalObject, keyValue);
    RETURN_IF_EXCEPTION(scope, {});

    // Prepare the private key
    std::optional<ncrypto::EVPKeyPointer> maybeKeyPtr = preparePrivateKey(globalObject, scope, keyValue);
    ASSERT(!!scope.exception() == !maybeKeyPtr.has_value());
    if (!maybeKeyPtr) {
        return {};
    }
    ncrypto::EVPKeyPointer keyPtr = WTFMove(maybeKeyPtr.value());

    // Get callback if provided
    JSValue callbackValue;
    bool hasCallback = false;
    if (argCount > 3) {
        callbackValue = callFrame->argument(3);
        if (!callbackValue.isUndefined()) {
            Bun::V::validateFunction(scope, globalObject, callbackValue, "callback"_s);
            RETURN_IF_EXCEPTION(scope, {});
            hasCallback = true;
        }
    }

    // Get RSA padding mode and salt length if applicable
    int32_t padding = getPadding(globalObject, keyValue, keyPtr);
    RETURN_IF_EXCEPTION(scope, {});

    // Create data buffer
    ncrypto::Buffer<const unsigned char> dataBuf {
        .data = reinterpret_cast<const unsigned char*>(dataView->vector()),
        .len = dataView->byteLength()
    };

    // Create a new EVP_MD_CTX for signing
    auto mdCtx = ncrypto::EVPMDCtxPointer::New();
    if (!mdCtx) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to create message digest context"_s);
        return {};
    }

    // Initialize the context for signing with the key and digest
    auto ctx = mdCtx.signInit(keyPtr, digest);
    if (!ctx.has_value()) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to initialize signing context"_s);
        return {};
    }

    // Apply RSA options if needed
    if (keyPtr.isRsaVariant()) {
        if (!ncrypto::EVPKeyCtxPointer::setRsaPadding(ctx.value(), padding, saltLen)) {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to set RSA padding"_s);
            return {};
        }
    }

    RefPtr<JSC::ArrayBuffer> sigBuffer = nullptr;
    if (keyPtr.isOneShotVariant()) {
        auto data = mdCtx.signOneShot(dataBuf);
        if (!data) {
            throwCryptoError(globalObject, scope, ERR_get_error(), "Failed to create signature"_s);
            return {};
        }

        sigBuffer = JSC::ArrayBuffer::tryCreate(data.size(), 1);
        if (!sigBuffer) {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to allocate signature buffer"_s);
            return {};
        }

        memcpy(sigBuffer->data(), data.get(), data.size());

    } else {
        auto signatureData = mdCtx.sign(dataBuf);
        if (!signatureData) {
            throwCryptoError(globalObject, scope, ERR_get_error(), "Failed to create signature"_s);
            return {};
        }

        // Convert to P1363 format if requested for EC keys
        if (dsaSigEnc == NodeCryptoKeys::DSASigEnc::P1363 && keyPtr.isSigVariant() && keyPtr.getBytesOfRS().value_or(0) * 2 > 0) {
            auto p1363Size = keyPtr.getBytesOfRS().value_or(0) * 2;
            sigBuffer = JSC::ArrayBuffer::tryCreate(p1363Size, 1);
            if (!sigBuffer) {
                Bun::throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to allocate P1363 buffer"_s);
                return {};
            }

            ncrypto::Buffer<const unsigned char> derSig {
                .data = reinterpret_cast<const unsigned char*>(signatureData.get()),
                .len = signatureData.size()
            };

            if (!ncrypto::extractP1363(derSig, static_cast<unsigned char*>(sigBuffer->data()), p1363Size / 2)) {
                Bun::throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to convert signature format"_s);
                return {};
            }
        } else {
            sigBuffer = JSC::ArrayBuffer::tryCreate(signatureData.size(), 1);
            if (!sigBuffer) {
                Bun::throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to allocate signature buffer"_s);
                return {};
            }

            memcpy(sigBuffer->data(), signatureData.get(), signatureData.size());
        }
    }
    ASSERT(sigBuffer);

    // Create JSUint8Array from the signature buffer
    auto* globalObj = defaultGlobalObject(globalObject);
    auto* signature = JSC::JSUint8Array::create(globalObject, globalObj->JSBufferSubclassStructure(), WTFMove(sigBuffer), 0, sigBuffer->byteLength());

    // If we have a callback, call it with the signature
    if (hasCallback) {
        JSC::MarkedArgumentBuffer args;
        args.append(jsNull());
        args.append(signature);
        ASSERT(!args.hasOverflowed());

        NakedPtr<JSC::Exception> returnedException = nullptr;
        JSC::profiledCall(globalObject, JSC::ProfilingReason::API, callbackValue, JSC::getCallData(callbackValue), JSC::jsUndefined(), args, returnedException);
        RETURN_IF_EXCEPTION(scope, {});
        if (returnedException) {
            scope.throwException(globalObject, returnedException.get());
        }

        return JSValue::encode(jsUndefined());
    }

    // Otherwise, return the signature directly
    return JSValue::encode(signature);
}

void setupJSSignClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSSignPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSSignPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSSignConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSSignConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSSign::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
