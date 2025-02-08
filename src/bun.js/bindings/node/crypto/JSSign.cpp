#include "JSSign.h"
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

namespace NodeCryptoKeys {
enum class DSASigEnc {
    DER,
    P1363,
    Invalid,
};

}

namespace Bun {

using namespace JSC;

// Throws a crypto error with optional OpenSSL error details
void throwCryptoError(JSC::JSGlobalObject* globalObject, unsigned long err, const char* message = nullptr)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Format OpenSSL error message if err is provided
    char message_buffer[128] = { 0 };
    if (err != 0 || message == nullptr) {
        ERR_error_string_n(err, message_buffer, sizeof(message_buffer));
        message = message_buffer;
    }

    WTF::String errorMessage = WTF::String::fromUTF8(message);
    RETURN_IF_EXCEPTION(scope, void());

    // Create error object with the message
    JSC::JSObject* errorObject = JSC::constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, void());

    PutPropertySlot messageSlot(errorObject, false);
    errorObject->put(errorObject, globalObject, Identifier::fromString(vm, "message"_s), jsString(vm, errorMessage), messageSlot);
    RETURN_IF_EXCEPTION(scope, void());

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

    // Throw the decorated error
    throwException(globalObject, scope, errorObject);
}

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
        { JSC::HashTableValue::NativeFunctionType, jsSignProtoFuncSign, 7 } },
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

// Helper function to get integer option from JSObject
static std::optional<int32_t> getIntOption(JSC::JSGlobalObject* globalObject, JSValue options, WTF::ASCIILiteral name)
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

// Get padding value from options object
static int32_t getPadding(JSC::JSGlobalObject* globalObject, JSValue options, const ncrypto::EVPKeyPointer& pkey)
{
    auto padding = getIntOption(globalObject, options, "padding"_s);
    return padding.value_or(pkey.getDefaultSignPadding());
}

// Get salt length value from options object
static std::optional<int32_t> getSaltLength(JSC::JSGlobalObject* globalObject, JSValue options)
{
    return getIntOption(globalObject, options, "saltLength"_s);
}

static NodeCryptoKeys::DSASigEnc getDSASigEnc(JSC::JSGlobalObject* globalObject, JSValue options)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (!options.isObject()) {
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
    JSString* digestName = digestArg.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Get the EVP_MD* for the digest using ncrypto helper
    auto* digest = ncrypto::getDigestByName(digestName->view(globalObject));
    if (!digest) {
        throwTypeError(globalObject, scope, "Unknown message digest"_s);
        return {};
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

JSC_DEFINE_HOST_FUNCTION(jsSignProtoFuncUpdate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Get the JSSign object from thisValue and verify it's valid
    JSSign* thisObject = jsDynamicCast<JSSign*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        Bun::throwThisTypeError(*globalObject, scope, "Sign"_s, "update"_s);
        return {};
    }

    // Check that we have at least 1 argument (the data)
    if (callFrame->argumentCount() < 1) {
        throwVMError(globalObject, scope, "Sign.prototype.update requires at least 1 argument"_s);
        return {};
    }

    // Get the data argument
    JSC::JSValue data = callFrame->argument(0);

    if (data.isString()) {
        Bun::V::validateString(scope, globalObject, data, "data"_s);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        Bun::V::validateArrayBufferView(scope, globalObject, data, "data"_s);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Get the optional encoding argument
    WebCore::BufferEncodingType encoding = WebCore::BufferEncodingType::utf8;
    // TODO(dylan-conway): handle encoding
    (void)encoding;

    if (callFrame->argumentCount() > 1) {
        JSC::JSValue encodingValue = callFrame->argument(1);
        if (!encodingValue.isUndefined()) {
            if (!encodingValue.isString()) {
                throwTypeError(globalObject, scope, "encoding must be a string"_s);
                return {};
            }
            std::optional<BufferEncodingType> encoded = parseEnumeration<BufferEncodingType>(*globalObject, encodingValue);
            if (!encoded) {
                throwTypeError(globalObject, scope, "Invalid encoding"_s);
                return {};
            }
            encoding = encoded.value();
        }
    }

    // Check if the context is initialized
    if (!thisObject->m_mdCtx) {
        throwTypeError(globalObject, scope, "Sign.prototype.update cannot be called before Sign.prototype.init"_s);
        return {};
    }

    // Handle string input
    if (data.isString()) {
        JSString* str = data.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        const auto view = str->view(globalObject);

        auto utf8 = view->utf8();

        // Convert string to bytes based on encoding
        auto buffer = ncrypto::Buffer<const void> {
            .data = utf8.data(),
            .len = utf8.length(),
        };
        if (!thisObject->m_mdCtx.digestUpdate(buffer)) {
            throwTypeError(globalObject, scope, "Failed to update digest"_s);
            return {};
        }
    }
    // Handle ArrayBufferView input
    else if (auto* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(data)) {
        if (UNLIKELY(view->isDetached())) {
            throwVMTypeError(globalObject, scope, "Buffer is detached"_s);
            return {};
        }

        size_t byteLength = view->byteLength();
        if (byteLength > INT_MAX) {
            throwTypeError(globalObject, scope, "data is too long"_s);
            return {};
        }

        auto buffer = ncrypto::Buffer<const void> {
            .data = view->vector(),
            .len = byteLength,
        };

        if (!thisObject->m_mdCtx.digestUpdate(buffer)) {
            throwTypeError(globalObject, scope, "Failed to update digest"_s);
            return {};
        }
    } else {
        throwTypeError(globalObject, scope, "data must be a string or ArrayBufferView"_s);
        return {};
    }

    // Return this for method chaining
    return JSC::JSValue::encode(callFrame->thisValue());
}

JSUint8Array* signBody(JSC::JSGlobalObject* lexicalGlobalObject, JSSign* thisObject, const ncrypto::EVPKeyPointer& pkey, NodeCryptoKeys::DSASigEnc dsa_sig_enc, int padding, std::optional<int> salt_len)
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Check if the context is initialized
    if (!thisObject->m_mdCtx) {
        throwTypeError(lexicalGlobalObject, scope, "Sign.prototype.sign cannot be called before Sign.prototype.init"_s);
        return {};
    }

    // Move mdCtx out of JSSign object
    auto mdCtx = WTFMove(thisObject->m_mdCtx);

    // Validate DSA parameters
    if (!pkey.validateDsaParameters()) {
        throwTypeError(lexicalGlobalObject, scope, "Invalid DSA parameters"_s);
        return {};
    }

    // Get the final digest
    auto data = mdCtx.digestFinal(mdCtx.getExpectedSize());
    if (!data) {
        throwTypeError(lexicalGlobalObject, scope, "Failed to finalize digest"_s);
        return {};
    }

    // Create signing context
    auto pkctx = pkey.newCtx();
    if (!pkctx || pkctx.initForSign() <= 0) {
        throwTypeError(lexicalGlobalObject, scope, "Failed to initialize signing context"_s);
        return {};
    }

    // Set RSA padding mode and salt length if applicable
    if (pkey.isRsaVariant()) {
        if (!ncrypto::EVPKeyCtxPointer::setRsaPadding(pkctx.get(), padding, salt_len)) {
            throwTypeError(lexicalGlobalObject, scope, "Failed to set RSA padding"_s);
            return {};
        }
    }

    // Set signature MD from the digest context
    if (!pkctx.setSignatureMd(mdCtx)) {
        throwTypeError(lexicalGlobalObject, scope, "Failed to set signature message digest"_s);
        return {};
    }

    // Create buffer for signature
    auto sigBuffer = JSC::ArrayBuffer::tryCreate(pkey.size(), 1);
    if (!sigBuffer) {
        throwTypeError(lexicalGlobalObject, scope, "Failed to allocate signature buffer"_s);
        return {};
    }

    // Perform signing operation
    ncrypto::Buffer<unsigned char> sigBuf {
        .data = static_cast<unsigned char*>(sigBuffer->data()),
        .len = pkey.size()
    };

    if (!pkctx.signInto(data, &sigBuf)) {
        throwTypeError(lexicalGlobalObject, scope, "Failed to create signature"_s);
        return {};
    }

    // Convert to P1363 format if requested for EC keys
    if (dsa_sig_enc == NodeCryptoKeys::DSASigEnc::P1363 && pkey.isSigVariant()) {
        auto p1363Size = pkey.getBytesOfRS().value_or(0) * 2;
        if (p1363Size > 0) {
            auto p1363Buffer = JSC::ArrayBuffer::tryCreate(p1363Size, 1);
            if (!p1363Buffer) {
                throwTypeError(lexicalGlobalObject, scope, "Failed to allocate P1363 buffer"_s);
                return {};
            }

            ncrypto::Buffer<const unsigned char> derSig {
                .data = static_cast<const unsigned char*>(sigBuffer->data()),
                .len = sigBuf.len
            };

            if (!ncrypto::extractP1363(derSig, static_cast<unsigned char*>(p1363Buffer->data()), p1363Size / 2)) {
                throwTypeError(lexicalGlobalObject, scope, "Failed to convert signature format"_s);
                return {};
            }

            sigBuffer = p1363Buffer;
        }
    }

    // Create and return JSUint8Array
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    return JSC::JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTFMove(sigBuffer), 0, sigBuf.len);
}

JSC_DEFINE_HOST_FUNCTION(jsSignProtoFuncSign, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
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
    JSValue encodingValue = callFrame->argument(1);

    if (!options.isCell()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key"_s, "ArrayBuffer, Buffer, TypedArray, DataView, string, KeyObject, or CryptoKey"_s, options);
    }

    std::optional<int> saltLen = getSaltLength(lexicalGlobalObject, options);
    RETURN_IF_EXCEPTION(scope, {});

    NodeCryptoKeys::DSASigEnc dsaSigEnc = getDSASigEnc(lexicalGlobalObject, options);
    RETURN_IF_EXCEPTION(scope, {});

    auto optionsCell = options.asCell();
    auto optionsType = optionsCell->type();

    if (optionsCell->inherits<WebCore::JSCryptoKey>()) {
        auto* cryptoKey = jsCast<WebCore::JSCryptoKey*>(optionsCell);

        // convert it to a key object, then to EVPKeyPointer
        auto& key = cryptoKey->wrapped();
        AsymmetricKeyValue keyValue(key);
        ncrypto::EVPKeyPointer keyPtr(keyValue.key);

        int32_t padding = getPadding(lexicalGlobalObject, options, keyPtr);
        RETURN_IF_EXCEPTION(scope, {});

        auto* resBuf = signBody(lexicalGlobalObject, thisObject, keyPtr, dsaSigEnc, padding, saltLen);
        RETURN_IF_EXCEPTION(scope, {});

        return JSValue::encode(resBuf);
    } else if (options.isObject()) {
        JSObject* optionsObj = optionsCell->getObject();
        const auto& names = WebCore::builtinNames(vm);

        if (auto val = optionsObj->getIfPropertyExists(lexicalGlobalObject, names.bunNativePtrPrivateName())) {
            if (val.isCell() && val.inherits<WebCore::JSCryptoKey>()) {
                auto* cryptoKey = jsCast<WebCore::JSCryptoKey*>(val.asCell());

                auto& key = cryptoKey->wrapped();
                AsymmetricKeyValue keyValue(key);
                ncrypto::EVPKeyPointer keyPtr(keyValue.key);

                // do thing
                int32_t padding = getPadding(lexicalGlobalObject, options, keyPtr);
                RETURN_IF_EXCEPTION(scope, {});

                auto* resBuf = signBody(lexicalGlobalObject, thisObject, keyPtr, dsaSigEnc, padding, saltLen);
                RETURN_IF_EXCEPTION(scope, {});

                return JSValue::encode(resBuf);
            }
        }

        auto key = optionsObj->getIfPropertyExists(lexicalGlobalObject, Identifier::fromString(vm, "key"_s));
        RETURN_IF_EXCEPTION(scope, {});
        auto encodingValue = optionsObj->getIfPropertyExists(lexicalGlobalObject, Identifier::fromString(vm, "encoding"_s));
        (void)encodingValue;
        RETURN_IF_EXCEPTION(scope, {});
        auto format = optionsObj->getIfPropertyExists(lexicalGlobalObject, Identifier::fromString(vm, "format"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (!key.isCell()) {
            return Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.key"_s, "ArrayBuffer, Buffer, TypedArray, DataView, string, KeyObject, or CryptoKey"_s, key);
        }

        auto keyCell = key.asCell();
        auto keyCellType = keyCell->type();
        if (keyCell->inherits<WebCore::JSCryptoKey>()) {
            auto* cryptoKey = jsCast<WebCore::JSCryptoKey*>(keyCell);
            auto& key = cryptoKey->wrapped();
            AsymmetricKeyValue keyValue(key);
            ncrypto::EVPKeyPointer keyPtr(keyValue.key);

            int32_t padding = getPadding(lexicalGlobalObject, options, keyPtr);
            RETURN_IF_EXCEPTION(scope, {});

            auto* resBuf = signBody(lexicalGlobalObject, thisObject, keyPtr, dsaSigEnc, padding, saltLen);
            RETURN_IF_EXCEPTION(scope, {});

            return JSValue::encode(resBuf);
        } else if (key.isObject()) {
            JSObject* keyObj = key.getObject();
            if (auto keyVal = keyObj->getIfPropertyExists(lexicalGlobalObject, names.bunNativePtrPrivateName())) {
                if (keyVal.isCell() && keyVal.inherits<WebCore::JSCryptoKey>()) {
                    auto* cryptoKey = jsCast<WebCore::JSCryptoKey*>(keyVal.asCell());

                    auto& key = cryptoKey->wrapped();
                    AsymmetricKeyValue keyValue(key);
                    ncrypto::EVPKeyPointer keyPtr(keyValue.key);

                    int32_t padding = getPadding(lexicalGlobalObject, options, keyPtr);
                    RETURN_IF_EXCEPTION(scope, {});

                    auto* resBuf = signBody(lexicalGlobalObject, thisObject, keyPtr, dsaSigEnc, padding, saltLen);
                    RETURN_IF_EXCEPTION(scope, {});

                    return JSValue::encode(resBuf);
                }
            }
        }
        if (format.isString()) {
            String formatStr = format.toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});

            if (formatStr == "jwk"_s) {
                // TODO(dylan-conway): JWK format
                // validateObject(key, "key.key");
                // getKeyObjectHandleFromJwk
                return JSValue::encode(jsUndefined());
            }
        }

        if (!key.isString() && !(keyCellType >= Int8ArrayType && keyCellType <= DataViewType)) {
            return Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.key"_s, "ArrayBuffer, Buffer, TypedArray, DataView, string, KeyObject, or CryptoKey"_s, key);
        }

        // kConsumePrivate
        bool isPublic = false;
        (void)isPublic;

    } else if (options.isString()) {
        ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig config;
        config.format = ncrypto::EVPKeyPointer::PKFormatType::PEM;

        auto str = optionsCell->getString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});

        auto strUtf8 = str.utf8();

        ncrypto::Buffer<const unsigned char> ncryptoBuf {
            .data = reinterpret_cast<const unsigned char*>(strUtf8.data()),
            .len = strUtf8.length(),
        };
        auto res = ncrypto::EVPKeyPointer::TryParsePrivateKey(config, ncryptoBuf);
        if (res) {
            ncrypto::EVPKeyPointer keyPtr(WTFMove(res.value));

            int32_t padding = getPadding(lexicalGlobalObject, options, keyPtr);
            RETURN_IF_EXCEPTION(scope, {});

            auto* resBuf = signBody(lexicalGlobalObject, thisObject, keyPtr, dsaSigEnc, padding, saltLen);
            RETURN_IF_EXCEPTION(scope, {});

            JSC::JSArrayBufferView* view = resBuf;

            if (!JSValue::equal(lexicalGlobalObject, encodingValue, jsString(vm, makeString("buffer"_s)))) {
                auto encoding = parseEnumeration<BufferEncodingType>(*lexicalGlobalObject, encodingValue);
                if (!encoding) {
                    return Bun::ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "encoding"_s, encodingValue);
                }
                return jsBufferToString(vm, lexicalGlobalObject, view, 0, view->byteLength(), encoding.value());
            }

            return JSValue::encode(resBuf);
        }

        if (res.error.value() == ncrypto::EVPKeyPointer::PKParseError::NEED_PASSPHRASE) {
            return Bun::ERR::MISSING_PASSPHRASE(scope, lexicalGlobalObject, "Passphrase required for encrypted key"_s);
        }

        throwCryptoError(lexicalGlobalObject, res.openssl_error.value_or(0), "Failed to read private key"_s);
        return JSValue::encode({});
    } else if (optionsType >= Int8ArrayType && optionsType <= DataViewType) {
        auto dataBuf = KeyObject__GetBuffer(options);
        if (dataBuf.hasException()) {
            return JSValue::encode({});
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

            int32_t padding = getPadding(lexicalGlobalObject, options, keyPtr);
            RETURN_IF_EXCEPTION(scope, {});

            auto* resBuf = signBody(lexicalGlobalObject, thisObject, keyPtr, dsaSigEnc, padding, saltLen);
            RETURN_IF_EXCEPTION(scope, {});

            return JSValue::encode(resBuf);
        }

        if (res.error.value() == ncrypto::EVPKeyPointer::PKParseError::NEED_PASSPHRASE) {
            return Bun::ERR::MISSING_PASSPHRASE(scope, lexicalGlobalObject, "Passphrase required for encrypted key"_s);
        }

        throwCryptoError(lexicalGlobalObject, res.openssl_error.value_or(0), "Failed to read private key"_s);
        return JSValue::encode({});
    }

    return Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key"_s, "ArrayBuffer, Buffer, TypedArray, DataView, string, KeyObject, or CryptoKey"_s, options);
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
