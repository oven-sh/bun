#include "JSVerify.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSType.h"
#include "SubtleCrypto.h"
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
#include <openssl/bn.h>
#include <openssl/ecdsa.h>
#include "ncrypto.h"
#include "JSSign.h"
#include "JsonWebKey.h"
#include "CryptoKeyEC.h"
#include "CryptoKeyRSA.h"
#include "wtf/text/Base64.h"

// Forward declarations for functions defined in other files
namespace Bun {

using namespace JSC;

// Forward declarations for prototype functions
JSC_DECLARE_HOST_FUNCTION(jsVerifyProtoFuncInit);
JSC_DECLARE_HOST_FUNCTION(jsVerifyProtoFuncUpdate);
JSC_DECLARE_HOST_FUNCTION(jsVerifyProtoFuncVerify);
JSC_DECLARE_HOST_FUNCTION(jsVerifyOneShot);

// Constructor functions
JSC_DECLARE_HOST_FUNCTION(callVerify);
JSC_DECLARE_HOST_FUNCTION(constructVerify);

// Property table for Verify prototype
static const JSC::HashTableValue JSVerifyPrototypeTableValues[] = {
    { "init"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { JSC::HashTableValue::NativeFunctionType, jsVerifyProtoFuncInit, 1 } },
    { "update"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { JSC::HashTableValue::NativeFunctionType, jsVerifyProtoFuncUpdate, 2 } },
    { "verify"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { JSC::HashTableValue::NativeFunctionType, jsVerifyProtoFuncVerify, 3 } },
};

// JSVerify implementation
const JSC::ClassInfo JSVerify::s_info = { "Verify"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSVerify) };

JSVerify::JSVerify(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

void JSVerify::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
}

JSVerify* JSVerify::create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject)
{
    JSVerify* verify = new (NotNull, JSC::allocateCell<JSVerify>(vm)) JSVerify(vm, structure);
    verify->finishCreation(vm, globalObject);
    return verify;
}

JSC::Structure* JSVerify::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

template<typename CellType, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSVerify::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSVerify, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSVerify.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSVerify = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSVerify.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSVerify = std::forward<decltype(space)>(space); });
}

// JSVerifyPrototype implementation
const JSC::ClassInfo JSVerifyPrototype::s_info = { "Verify"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSVerifyPrototype) };

JSVerifyPrototype::JSVerifyPrototype(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

void JSVerifyPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSVerify::info(), JSVerifyPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSVerifyPrototype* JSVerifyPrototype::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    JSVerifyPrototype* prototype = new (NotNull, JSC::allocateCell<JSVerifyPrototype>(vm)) JSVerifyPrototype(vm, structure);
    prototype->finishCreation(vm);
    return prototype;
}

JSC::Structure* JSVerifyPrototype::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

// JSVerifyConstructor implementation
const JSC::ClassInfo JSVerifyConstructor::s_info = { "Verify"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSVerifyConstructor) };

JSVerifyConstructor::JSVerifyConstructor(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure, callVerify, constructVerify)
{
}

void JSVerifyConstructor::finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
{
    Base::finishCreation(vm, 1, "Verify"_s);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}

JSVerifyConstructor* JSVerifyConstructor::create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
{
    JSVerifyConstructor* constructor = new (NotNull, JSC::allocateCell<JSVerifyConstructor>(vm)) JSVerifyConstructor(vm, structure);
    constructor->finishCreation(vm, prototype);
    return constructor;
}

JSC::Structure* JSVerifyConstructor::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
}

// Function stubs for implementation later
JSC_DEFINE_HOST_FUNCTION(jsVerifyProtoFuncInit, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Get the JSVerify object from thisValue and verify it's valid
    JSVerify* thisObject = jsDynamicCast<JSVerify*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        Bun::throwThisTypeError(*globalObject, scope, "Verify"_s, "init"_s);
        return {};
    }

    // Check that we have at least 1 argument (the digest name)
    if (callFrame->argumentCount() < 1) {
        throwVMError(globalObject, scope, "Verify.prototype.init requires at least 1 argument"_s);
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

    // Store the initialized context in the JSVerify object
    thisObject->m_mdCtx = WTFMove(mdCtx);

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsVerifyProtoFuncUpdate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Get the JSVerify object from thisValue and verify it's valid
    JSVerify* thisObject = jsDynamicCast<JSVerify*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        Bun::throwThisTypeError(*globalObject, scope, "Verify"_s, "update"_s);
        return JSValue::encode({});
    }

    JSValue wrappedVerify = callFrame->argument(0);

    // Check that we have at least 1 argument (the data)
    if (callFrame->argumentCount() < 2) {
        throwVMError(globalObject, scope, "Verify.prototype.update requires at least 1 argument"_s);
        return JSValue::encode({});
    }

    // Get the data argument
    JSC::JSValue data = callFrame->argument(1);

    // if it's a string, using encoding for decode. if it's a buffer, just use the buffer
    if (data.isString()) {
        JSString* dataString = data.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

        JSValue encodingValue = callFrame->argument(2);
        auto encoding = parseEnumeration<BufferEncodingType>(*globalObject, encodingValue).value_or(BufferEncodingType::utf8);
        RETURN_IF_EXCEPTION(scope, {});

        if (encoding == BufferEncodingType::hex && dataString->length() % 2 != 0) {
            return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "encoding"_s, encodingValue, makeString("is invalid for data of length "_s, dataString->length()));
        }

        JSValue buf = JSValue::decode(constructFromEncoding(globalObject, dataString, encoding));
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

        auto* view = jsDynamicCast<JSC::JSArrayBufferView*>(buf);

        // Update the digest context with the buffer data
        if (view->isDetached()) {
            throwTypeError(globalObject, scope, "Buffer is detached"_s);
            return JSValue::encode({});
        }

        size_t byteLength = view->byteLength();
        if (byteLength > INT_MAX) {
            throwRangeError(globalObject, scope, "data is too long"_s);
            return JSValue::encode({});
        }

        auto buffer = ncrypto::Buffer<const void> {
            .data = view->vector(),
            .len = byteLength,
        };

        if (!thisObject->m_mdCtx.digestUpdate(buffer)) {
            throwCryptoError(globalObject, scope, ERR_get_error(), "Failed to update digest");
            return JSValue::encode({});
        }

        return JSValue::encode(wrappedVerify);
    }

    if (!data.isCell() || !JSC::isTypedArrayTypeIncludingDataView(data.asCell()->type())) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "data"_s, "string or an instance of Buffer, TypedArray, or DataView"_s, data);
    }

    // Handle ArrayBufferView input
    if (auto* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(data)) {
        if (view->isDetached()) {
            throwTypeError(globalObject, scope, "Buffer is detached"_s);
            return JSValue::encode({});
        }

        size_t byteLength = view->byteLength();
        if (byteLength > INT_MAX) {
            throwRangeError(globalObject, scope, "data is too long"_s);
            return JSValue::encode({});
        }

        auto buffer = ncrypto::Buffer<const void> {
            .data = view->vector(),
            .len = byteLength,
        };

        if (!thisObject->m_mdCtx.digestUpdate(buffer)) {
            throwCryptoError(globalObject, scope, ERR_get_error(), "Failed to update digest");
            return JSValue::encode({});
        }

        return JSValue::encode(wrappedVerify);
    }

    return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "data"_s, "string or an instance of Buffer, TypedArray, or DataView"_s, data);
}

std::optional<ncrypto::EVPKeyPointer> preparePublicOrPrivateKey(JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSValue maybeKey);
bool convertP1363ToDER(const ncrypto::Buffer<const unsigned char>& p1363Sig,
    const ncrypto::EVPKeyPointer& pkey,
    WTF::Vector<uint8_t>& derBuffer);

JSC_DEFINE_HOST_FUNCTION(jsVerifyProtoFuncVerify, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;

    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Get the JSVerify object from thisValue and verify it's valid
    JSVerify* thisObject = jsDynamicCast<JSVerify*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        Bun::throwThisTypeError(*globalObject, scope, "Verify"_s, "verify"_s);
        return JSValue::encode(jsBoolean(false));
    }

    // Check if the context is initialized
    if (!thisObject->m_mdCtx) {
        throwTypeError(globalObject, scope, "Verify.prototype.verify cannot be called before Verify.prototype.init"_s);
        return JSValue::encode(jsBoolean(false));
    }

    // This function receives two arguments: options and signature
    JSValue options = callFrame->argument(0);
    JSValue signatureValue = callFrame->argument(1);
    JSValue sigEncodingValue = callFrame->argument(2);

    JSC::JSArrayBufferView* signatureBuffer = getArrayBufferOrView(globalObject, scope, signatureValue, "signature"_s, sigEncodingValue);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsBoolean(false)));

    // Prepare the public or private key from options
    std::optional<ncrypto::EVPKeyPointer> maybeKeyPtr = preparePublicOrPrivateKey(globalObject, scope, options);
    ASSERT(!!scope.exception() == !maybeKeyPtr.has_value());
    if (!maybeKeyPtr) {
        return JSValue::encode({});
    }
    ncrypto::EVPKeyPointer keyPtr = WTFMove(maybeKeyPtr.value());

    // Get RSA padding mode and salt length if applicable
    int32_t padding = getPadding(globalObject, options, keyPtr);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsBoolean(false)));

    std::optional<int> saltLen = getSaltLength(globalObject, options);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsBoolean(false)));

    // Get DSA signature encoding format
    NodeCryptoKeys::DSASigEnc dsaSigEnc = getDSASigEnc(globalObject, options);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsBoolean(false)));

    // Get the signature buffer

    // Move mdCtx out of JSVerify object to finalize it
    ncrypto::EVPMDCtxPointer mdCtx = WTFMove(thisObject->m_mdCtx);

    // Validate DSA parameters
    if (!keyPtr.validateDsaParameters()) {
        throwTypeError(globalObject, scope, "Invalid DSA parameters"_s);
        return JSValue::encode(jsBoolean(false));
    }

    // Get the final digest
    auto data = mdCtx.digestFinal(mdCtx.getExpectedSize());
    if (!data) {
        throwTypeError(globalObject, scope, "Failed to finalize digest"_s);
        return JSValue::encode(jsBoolean(false));
    }

    // Create verification context
    auto pkctx = keyPtr.newCtx();
    if (!pkctx || pkctx.initForVerify() <= 0) {
        throwCryptoError(globalObject, scope, ERR_peek_error(), "Failed to initialize verification context"_s);
        return JSValue::encode(jsBoolean(false));
    }

    // Set RSA padding mode and salt length if applicable
    if (keyPtr.isRsaVariant()) {
        if (!ncrypto::EVPKeyCtxPointer::setRsaPadding(pkctx.get(), padding, saltLen)) {
            throwCryptoError(globalObject, scope, ERR_peek_error(), "Failed to set RSA padding"_s);
            return JSValue::encode(jsBoolean(false));
        }
    }

    // Set signature MD from the digest context
    if (!pkctx.setSignatureMd(mdCtx)) {
        throwCryptoError(globalObject, scope, ERR_peek_error(), "Failed to set signature message digest"_s);
        return JSValue::encode(jsBoolean(false));
    }

    // Handle P1363 format conversion for EC keys if needed
    ncrypto::Buffer<const unsigned char> sigBuf {
        .data = static_cast<const unsigned char*>(signatureBuffer->vector()),
        .len = signatureBuffer->byteLength(),
    };

    if (dsaSigEnc == NodeCryptoKeys::DSASigEnc::P1363 && keyPtr.isSigVariant()) {
        WTF::Vector<uint8_t> derBuffer;

        if (convertP1363ToDER(sigBuf, keyPtr, derBuffer)) {
            // Conversion succeeded, perform verification with the converted signature
            ncrypto::Buffer<const uint8_t> derSigBuf {
                .data = derBuffer.data(),
                .len = derBuffer.size(),
            };

            bool result = pkctx.verify(derSigBuf, data);
            return JSValue::encode(jsBoolean(result));
        }
        // If conversion failed, fall through to use the original signature
    }

    // Perform verification with the original signature
    bool result = pkctx.verify(sigBuf, data);
    return JSValue::encode(jsBoolean(result));
}

JSC_DEFINE_HOST_FUNCTION(jsVerifyOneShot, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearError;

    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto argCount = callFrame->argumentCount();

    // Validate algorithm if provided
    JSValue algorithmValue = callFrame->argument(0);
    const EVP_MD* digest = nullptr;
    if (!algorithmValue.isUndefinedOrNull()) {
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
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "data"_s, "Buffer, TypedArray, or DataView"_s, dataValue);
    }

    // Get signature argument
    JSValue signatureValue = callFrame->argument(3);
    JSC::JSArrayBufferView* signatureView = getArrayBufferOrView(globalObject, scope, signatureValue, "signature"_s, jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});
    if (!signatureView) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "signature"_s, "Buffer, TypedArray, or DataView"_s, signatureValue);
    }

    // Get key argument
    JSValue keyValue = callFrame->argument(2);

    // Prepare the public or private key
    std::optional<ncrypto::EVPKeyPointer> maybeKeyPtr = preparePublicOrPrivateKey(globalObject, scope, keyValue);
    ASSERT(!!scope.exception() == !maybeKeyPtr.has_value());
    if (!maybeKeyPtr) {
        return {};
    }
    ncrypto::EVPKeyPointer keyPtr = WTFMove(maybeKeyPtr.value());

    // Get callback if provided
    JSValue callbackValue;
    bool hasCallback = false;
    if (argCount > 4) {
        callbackValue = callFrame->argument(4);
        if (!callbackValue.isUndefined()) {
            Bun::V::validateFunction(scope, globalObject, callbackValue, "callback"_s);
            RETURN_IF_EXCEPTION(scope, {});
            hasCallback = true;
        }
    }

    // Get RSA padding mode and salt length if applicable
    int32_t padding = getPadding(globalObject, keyValue, keyPtr);
    RETURN_IF_EXCEPTION(scope, {});

    std::optional<int> saltLen = getSaltLength(globalObject, keyValue);
    RETURN_IF_EXCEPTION(scope, {});

    // Get DSA signature encoding format
    NodeCryptoKeys::DSASigEnc dsaSigEnc = getDSASigEnc(globalObject, keyValue);
    RETURN_IF_EXCEPTION(scope, {});

    // Create data buffer
    ncrypto::Buffer<const uint8_t> dataBuf {
        .data = static_cast<const uint8_t*>(dataView->vector()),
        .len = dataView->byteLength()
    };

    // Create signature buffer
    ncrypto::Buffer<const uint8_t> sigBuf {
        .data = static_cast<const uint8_t*>(signatureView->vector()),
        .len = signatureView->byteLength()
    };

    // Create a new EVP_MD_CTX for verification
    auto mdCtx = ncrypto::EVPMDCtxPointer::New();
    if (!mdCtx) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to create message digest context"_s);
        return {};
    }

    // Initialize the context for verification with the key and digest
    auto ctx = mdCtx.verifyInit(keyPtr, digest);
    if (!ctx.has_value()) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to initialize verification context"_s);
        return {};
    }

    // Apply RSA options if needed
    if (keyPtr.isRsaVariant()) {
        if (!ncrypto::EVPKeyCtxPointer::setRsaPadding(ctx.value(), padding, saltLen)) {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to set RSA padding"_s);
            return {};
        }
    }

    // Handle P1363 format conversion if needed
    bool result = false;
    if (dsaSigEnc == NodeCryptoKeys::DSASigEnc::P1363 && keyPtr.isSigVariant()) {
        WTF::Vector<uint8_t> derBuffer;

        if (convertP1363ToDER(sigBuf, keyPtr, derBuffer)) {
            // Conversion succeeded, create a new buffer with the converted signature
            ncrypto::Buffer<const uint8_t> derSigBuf {
                .data = derBuffer.data(),
                .len = derBuffer.size(),
            };

            // Perform verification with the converted signature
            result = mdCtx.verify(dataBuf, derSigBuf);
        } else {
            // If conversion failed, try with the original signature
            result = mdCtx.verify(dataBuf, sigBuf);
        }
    } else {
        // Perform verification with the original signature
        result = mdCtx.verify(dataBuf, sigBuf);
    }

    // If we have a callback, call it with the result
    if (hasCallback) {
        JSC::MarkedArgumentBuffer args;
        args.append(jsNull());
        args.append(jsBoolean(result));
        ASSERT(!args.hasOverflowed());

        NakedPtr<JSC::Exception> returnedException = nullptr;
        JSC::CallData callData = JSC::getCallData(callbackValue);
        JSC::profiledCall(globalObject, JSC::ProfilingReason::API, callbackValue, callData, JSC::jsUndefined(), args, returnedException);
        RETURN_IF_EXCEPTION(scope, {});
        if (returnedException) {
            scope.throwException(globalObject, returnedException.get());
        }

        return JSValue::encode(jsUndefined());
    }

    // Otherwise, return the result directly
    return JSValue::encode(jsBoolean(result));
}

JSC_DEFINE_HOST_FUNCTION(callVerify, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    return JSValue::encode(JSVerify::create(vm, defaultGlobalObject(globalObject)->m_JSVerifyClassStructure.get(defaultGlobalObject(globalObject)), globalObject));
}

JSC_DEFINE_HOST_FUNCTION(constructVerify, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    return JSValue::encode(JSVerify::create(vm, defaultGlobalObject(globalObject)->m_JSVerifyClassStructure.get(defaultGlobalObject(globalObject)), globalObject));
}

void setupJSVerifyClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSVerifyPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSVerifyPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSVerifyConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSVerifyConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSVerify::createStructure(init.vm, init.global, prototype);

    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

std::optional<ncrypto::EVPKeyPointer> keyFromPublicString(JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, const WTF::StringView& keyView)
{
    ncrypto::EVPKeyPointer::PublicKeyEncodingConfig publicConfig;
    publicConfig.format = ncrypto::EVPKeyPointer::PKFormatType::PEM;

    UTF8View keyUtf8(keyView);
    auto keySpan = keyUtf8.span();

    ncrypto::Buffer<const unsigned char> ncryptoBuf {
        .data = reinterpret_cast<const unsigned char*>(keySpan.data()),
        .len = keySpan.size(),
    };

    auto publicRes = ncrypto::EVPKeyPointer::TryParsePublicKey(publicConfig, ncryptoBuf);
    if (publicRes) {
        ncrypto::EVPKeyPointer keyPtr(WTFMove(publicRes.value));
        return keyPtr;
    }

    if (publicRes.error.value() == ncrypto::EVPKeyPointer::PKParseError::NOT_RECOGNIZED) {
        ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig privateConfig;
        privateConfig.format = ncrypto::EVPKeyPointer::PKFormatType::PEM;
        auto privateRes = ncrypto::EVPKeyPointer::TryParsePrivateKey(privateConfig, ncryptoBuf);
        if (privateRes) {
            ncrypto::EVPKeyPointer keyPtr(WTFMove(privateRes.value));
            return keyPtr;
        }
    }

    throwCryptoError(lexicalGlobalObject, scope, publicRes.openssl_error.value_or(0), "Failed to read public key"_s);
    return std::nullopt;
}

std::optional<ncrypto::EVPKeyPointer> preparePublicOrPrivateKey(JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSValue maybeKey)
{
    VM& vm = lexicalGlobalObject->vm();

    bool optionsBool = maybeKey.toBoolean(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    // Check if the key is provided
    if (!optionsBool) {
        Bun::ERR::CRYPTO_SIGN_KEY_REQUIRED(scope, lexicalGlobalObject);
        return std::nullopt;
    }

    if (!maybeKey.isCell()) {
        Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key"_s, "ArrayBuffer, Buffer, TypedArray, DataView, string, KeyObject, or CryptoKey"_s, maybeKey);
        return std::nullopt;
    }

    auto optionsCell = maybeKey.asCell();
    auto optionsType = optionsCell->type();

    // Handle CryptoKey directly
    if (optionsCell->inherits<WebCore::JSCryptoKey>()) {
        auto* cryptoKey = jsCast<WebCore::JSCryptoKey*>(optionsCell);

        // Convert it to a key object, then to EVPKeyPointer
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

        // Check for native pointer (CryptoKey)
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
            // Handle buffer input directly
            auto dataBuf = KeyObject__GetBuffer(maybeKey);
            if (dataBuf.hasException()) {
                return std::nullopt;
            }

            auto buffer = dataBuf.releaseReturnValue();
            ncrypto::Buffer<const unsigned char> ncryptoBuf {
                .data = buffer.data(),
                .len = buffer.size(),
            };

            // Try as public key first with default PEM format
            ncrypto::EVPKeyPointer::PublicKeyEncodingConfig pubConfig;
            pubConfig.format = ncrypto::EVPKeyPointer::PKFormatType::PEM;

            auto pubRes = ncrypto::EVPKeyPointer::TryParsePublicKey(pubConfig, ncryptoBuf);
            if (pubRes) {
                ncrypto::EVPKeyPointer keyPtr(WTFMove(pubRes.value));
                return keyPtr;
            }

            // If public key parsing fails, try as a private key
            ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig privConfig;
            privConfig.format = ncrypto::EVPKeyPointer::PKFormatType::PEM;

            auto privRes = ncrypto::EVPKeyPointer::TryParsePrivateKey(privConfig, ncryptoBuf);
            if (privRes) {
                ncrypto::EVPKeyPointer keyPtr(WTFMove(privRes.value));
                return keyPtr;
            }

            if (privRes.error.value() == ncrypto::EVPKeyPointer::PKParseError::NEED_PASSPHRASE) {
                Bun::ERR::MISSING_PASSPHRASE(scope, lexicalGlobalObject, "Passphrase required for encrypted key"_s);
                return std::nullopt;
            }

            throwCryptoError(lexicalGlobalObject, scope, privRes.openssl_error.value_or(0), "Failed to read key"_s);
            return std::nullopt;
        }

        // Handle options object with key property
        JSValue key = optionsObj->get(lexicalGlobalObject, Identifier::fromString(vm, "key"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue formatValue = optionsObj->get(lexicalGlobalObject, Identifier::fromString(vm, "format"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue typeValue = optionsObj->get(lexicalGlobalObject, Identifier::fromString(vm, "type"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue passphrase = optionsObj->get(lexicalGlobalObject, Identifier::fromString(vm, "passphrase"_s));
        RETURN_IF_EXCEPTION(scope, {});

        WTF::StringView formatStr = WTF::nullStringView();
        if (formatValue.isString()) {
            auto str = formatValue.toString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
            formatStr = str->view(lexicalGlobalObject);
        }

        if (!key.isCell()) {
            if (formatStr == "jwk"_s) {
                // Use our implementation of JWK key handling
                bool isPublic = true;
                return getKeyObjectHandleFromJwk(lexicalGlobalObject, scope, key, isPublic);
            } else {
                Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.key"_s, "ArrayBuffer, Buffer, TypedArray, DataView, string, KeyObject, or CryptoKey"_s, key);
            }
            return std::nullopt;
        }

        auto keyCell = key.asCell();
        auto keyCellType = keyCell->type();

        // Handle CryptoKey in key property
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
                // Handle buffer in key property
                auto dataBuf = KeyObject__GetBuffer(key);
                if (dataBuf.hasException()) {
                    return std::nullopt;
                }

                auto buffer = dataBuf.releaseReturnValue();
                ncrypto::Buffer<const unsigned char> ncryptoBuf {
                    .data = buffer.data(),
                    .len = buffer.size(),
                };

                // Parse format and type from options
                auto format = parseKeyFormat(lexicalGlobalObject, formatValue, "options.format"_s, ncrypto::EVPKeyPointer::PKFormatType::PEM);
                RETURN_IF_EXCEPTION(scope, std::nullopt);

                // If format is JWK, use our JWK implementation
                if (format == ncrypto::EVPKeyPointer::PKFormatType::JWK) {
                    bool isPublic = true;
                    return getKeyObjectHandleFromJwk(lexicalGlobalObject, scope, key, isPublic);
                }

                // Try as public key first
                ncrypto::EVPKeyPointer::PublicKeyEncodingConfig pubConfig;
                pubConfig.format = format;

                // Parse type for public key
                auto pubType = parseKeyType(lexicalGlobalObject, typeValue, format == ncrypto::EVPKeyPointer::PKFormatType::DER, WTF::nullStringView(), std::nullopt, "options.type"_s);
                RETURN_IF_EXCEPTION(scope, std::nullopt);

                if (pubType.has_value()) {
                    pubConfig.type = pubType.value();
                }

                auto pubRes = ncrypto::EVPKeyPointer::TryParsePublicKey(pubConfig, ncryptoBuf);
                if (pubRes) {
                    ncrypto::EVPKeyPointer keyPtr(WTFMove(pubRes.value));
                    return keyPtr;
                }

                // If public key parsing fails, try as a private key
                ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig privConfig;
                privConfig.format = format;

                // Parse type for private key
                auto privType = parseKeyType(lexicalGlobalObject, typeValue, format == ncrypto::EVPKeyPointer::PKFormatType::DER, WTF::nullStringView(), false, "options.type"_s);
                RETURN_IF_EXCEPTION(scope, std::nullopt);

                if (privType.has_value()) {
                    privConfig.type = privType.value();
                }

                privConfig.passphrase = passphraseFromBufferSource(lexicalGlobalObject, scope, passphrase);
                RETURN_IF_EXCEPTION(scope, std::nullopt);

                auto privRes = ncrypto::EVPKeyPointer::TryParsePrivateKey(privConfig, ncryptoBuf);
                if (privRes) {
                    ncrypto::EVPKeyPointer keyPtr(WTFMove(privRes.value));
                    return keyPtr;
                }

                if (privRes.error.value() == ncrypto::EVPKeyPointer::PKParseError::NEED_PASSPHRASE) {
                    Bun::ERR::MISSING_PASSPHRASE(scope, lexicalGlobalObject, "Passphrase required for encrypted key"_s);
                    return std::nullopt;
                }

                throwCryptoError(lexicalGlobalObject, scope, privRes.openssl_error.value_or(0), "Failed to read key"_s);
                return std::nullopt;
            } else if (formatStr == "jwk"_s) {
                // Use our implementation of JWK key handling
                bool isPublic = true;
                return getKeyObjectHandleFromJwk(lexicalGlobalObject, scope, key, isPublic);
            }
        } else if (key.isString()) {
            // Handle string key
            WTF::String keyStr = key.toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            // Parse format and type from options
            auto format = parseKeyFormat(lexicalGlobalObject, formatValue, "options.format"_s, ncrypto::EVPKeyPointer::PKFormatType::PEM);
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            // If format is JWK, use our JWK implementation
            if (format == ncrypto::EVPKeyPointer::PKFormatType::JWK) {
                bool isPublic = true;
                return getKeyObjectHandleFromJwk(lexicalGlobalObject, scope, key, isPublic);
            }

            // Try as public key first with specified format and type
            UTF8View keyUtf8(keyStr);
            auto keySpan = keyUtf8.span();

            ncrypto::Buffer<const unsigned char> ncryptoBuf {
                .data = reinterpret_cast<const unsigned char*>(keySpan.data()),
                .len = keySpan.size(),
            };

            // Try as public key first
            ncrypto::EVPKeyPointer::PublicKeyEncodingConfig pubConfig;
            pubConfig.format = format;

            // Parse type for public key
            auto pubType = parseKeyType(lexicalGlobalObject, typeValue, format == ncrypto::EVPKeyPointer::PKFormatType::DER, WTF::nullStringView(), std::nullopt, "options.type"_s);
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            if (pubType.has_value()) {
                pubConfig.type = pubType.value();
            }

            auto pubRes = ncrypto::EVPKeyPointer::TryParsePublicKey(pubConfig, ncryptoBuf);
            if (pubRes) {
                ncrypto::EVPKeyPointer keyPtr(WTFMove(pubRes.value));
                return keyPtr;
            }

            // If public key parsing fails, try as a private key
            ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig privConfig;
            privConfig.format = format;

            // Parse type for private key
            auto privType = parseKeyType(lexicalGlobalObject, typeValue, format == ncrypto::EVPKeyPointer::PKFormatType::DER, WTF::nullStringView(), false, "options.type"_s);
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            if (privType.has_value()) {
                privConfig.type = privType.value();
            }

            privConfig.passphrase = passphraseFromBufferSource(lexicalGlobalObject, scope, passphrase);
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            auto privRes = ncrypto::EVPKeyPointer::TryParsePrivateKey(privConfig, ncryptoBuf);
            if (privRes) {
                ncrypto::EVPKeyPointer keyPtr(WTFMove(privRes.value));
                return keyPtr;
            }

            if (privRes.error.value() == ncrypto::EVPKeyPointer::PKParseError::NEED_PASSPHRASE) {
                Bun::ERR::MISSING_PASSPHRASE(scope, lexicalGlobalObject, "Passphrase required for encrypted key"_s);
                return std::nullopt;
            }

            throwCryptoError(lexicalGlobalObject, scope, privRes.openssl_error.value_or(0), "Failed to read key"_s);
            return std::nullopt;
        }

        Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.key"_s, "ArrayBuffer, Buffer, TypedArray, DataView, string, KeyObject, or CryptoKey"_s, key);
        return std::nullopt;
    } else if (maybeKey.isString()) {
        // Handle string key directly
        WTF::String keyStr = maybeKey.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        // Try as public key first with default PEM format
        UTF8View keyUtf8(keyStr);
        auto keySpan = keyUtf8.span();

        ncrypto::Buffer<const unsigned char> ncryptoBuf {
            .data = reinterpret_cast<const unsigned char*>(keySpan.data()),
            .len = keySpan.size(),
        };

        // Try as public key first
        ncrypto::EVPKeyPointer::PublicKeyEncodingConfig pubConfig;
        pubConfig.format = ncrypto::EVPKeyPointer::PKFormatType::PEM;

        auto pubRes = ncrypto::EVPKeyPointer::TryParsePublicKey(pubConfig, ncryptoBuf);
        if (pubRes) {
            ncrypto::EVPKeyPointer keyPtr(WTFMove(pubRes.value));
            return keyPtr;
        }

        // If public key parsing fails, try as a private key
        ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig privConfig;
        privConfig.format = ncrypto::EVPKeyPointer::PKFormatType::PEM;

        auto privRes = ncrypto::EVPKeyPointer::TryParsePrivateKey(privConfig, ncryptoBuf);
        if (privRes) {
            ncrypto::EVPKeyPointer keyPtr(WTFMove(privRes.value));
            return keyPtr;
        }

        if (privRes.error.value() == ncrypto::EVPKeyPointer::PKParseError::NEED_PASSPHRASE) {
            Bun::ERR::MISSING_PASSPHRASE(scope, lexicalGlobalObject, "Passphrase required for encrypted key"_s);
            return std::nullopt;
        }

        throwCryptoError(lexicalGlobalObject, scope, privRes.openssl_error.value_or(0), "Failed to read key"_s);
        return std::nullopt;
    }

    Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key"_s, "ArrayBuffer, Buffer, TypedArray, DataView, string, KeyObject, or CryptoKey"_s, maybeKey);
    return std::nullopt;
}

// Implements the getKeyObjectHandleFromJwk function similar to Node.js implementation
std::optional<ncrypto::EVPKeyPointer> getKeyObjectHandleFromJwk(JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSValue key, bool isPublic)
{
    auto& vm = lexicalGlobalObject->vm();

    // Validate that key is an object
    Bun::V::validateObject(scope, lexicalGlobalObject, key, "key.key"_s);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    JSObject* keyObj = key.getObject();

    // Get and validate key.kty
    JSValue ktyValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "kty"_s));
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    if (!ktyValue.isString()) {
        Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.kty"_s, "string"_s, ktyValue);
        return std::nullopt;
    }

    WTF::String kty = ktyValue.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    // Validate kty is one of the supported types
    const WTF::Vector<ASCIILiteral> validKeyTypes = { "RSA"_s, "EC"_s, "OKP"_s };
    bool isValidType = false;
    for (const auto& validType : validKeyTypes) {
        if (kty == validType) {
            isValidType = true;
            break;
        }
    }

    if (!isValidType) {
        Bun::ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "key.kty"_s, "must be one of: "_s, ktyValue, validKeyTypes);
        return std::nullopt;
    }

    // Handle OKP keys
    if (kty == "OKP"_s) {
        // Get and validate key.crv
        JSValue crvValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "crv"_s));
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        if (!crvValue.isString()) {
            Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.crv"_s, "string"_s, crvValue);
            return std::nullopt;
        }

        WTF::String crv = crvValue.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        // Validate crv is one of the supported curves
        const WTF::Vector<WTF::ASCIILiteral> validCurves = { "Ed25519"_s, "Ed448"_s, "X25519"_s, "X448"_s };
        bool validCurve = false;
        for (const auto& validCurveType : validCurves) {
            if (crv == validCurveType) {
                validCurve = true;
                break;
            }
        }

        if (!validCurve) {
            Bun::ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "key.crv"_s, "must be one of: "_s, crvValue, validCurves);
            return std::nullopt;
        }

        // Get and validate key.x
        JSValue xValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "x"_s));
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        if (!xValue.isString()) {
            Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.x"_s, "string"_s, xValue);
            return std::nullopt;
        }

        WTF::String xStr = xValue.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        // For private keys, validate key.d
        WTF::String dStr;
        if (!isPublic) {
            JSValue dValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "d"_s));
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            if (!dValue.isString()) {
                Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.d"_s, "string"_s, dValue);
                return std::nullopt;
            }

            dStr = dValue.toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, std::nullopt);
        }

        // Convert base64 strings to binary data
        Vector<uint8_t> keyData;
        if (isPublic) {
            auto xData = WTF::base64Decode(xStr);
            // auto xData = WTF::base64Decode(xStr);
            if (!xData) {
                Bun::ERR::CRYPTO_INVALID_JWK(scope, lexicalGlobalObject);
                return std::nullopt;
            }
            keyData = WTFMove(*xData);
        } else {
            auto dData = WTF::base64Decode(dStr);
            if (!dData) {
                Bun::ERR::CRYPTO_INVALID_JWK(scope, lexicalGlobalObject);
                return std::nullopt;
            }
            keyData = WTFMove(*dData);
        }

        // Validate key length based on curve
        if ((crv == "Ed25519"_s || crv == "X25519"_s) && keyData.size() != 32) {
            Bun::ERR::CRYPTO_INVALID_JWK(scope, lexicalGlobalObject);
            return std::nullopt;
        } else if (crv == "Ed448"_s && keyData.size() != 57) {
            Bun::ERR::CRYPTO_INVALID_JWK(scope, lexicalGlobalObject);
            return std::nullopt;
        } else if (crv == "X448"_s && keyData.size() != 56) {
            Bun::ERR::CRYPTO_INVALID_JWK(scope, lexicalGlobalObject);
            return std::nullopt;
        }

        // Create the key
        int nid = 0;
        if (crv == "Ed25519"_s) {
            nid = EVP_PKEY_ED25519;
        } else if (crv == "Ed448"_s) {
            nid = EVP_PKEY_ED448;
        } else if (crv == "X25519"_s) {
            nid = EVP_PKEY_X25519;
        } else if (crv == "X448"_s) {
            nid = EVP_PKEY_X448;
        }

        ncrypto::Buffer<const unsigned char> buffer {
            .data = keyData.data(),
            .len = keyData.size(),
        };

        if (isPublic) {
            return ncrypto::EVPKeyPointer::NewRawPublic(nid, buffer);
        } else {
            return ncrypto::EVPKeyPointer::NewRawPrivate(nid, buffer);
        }
    }
    // Handle EC keys
    else if (kty == "EC"_s) {
        // Get and validate key.crv
        JSValue crvValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "crv"_s));
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        if (!crvValue.isString()) {
            Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.crv"_s, "string"_s, crvValue);
            return std::nullopt;
        }

        WTF::String crv = crvValue.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        // Validate crv is one of the supported curves
        const WTF::Vector<WTF::ASCIILiteral> validCurves = { "P-256"_s, "secp256k1"_s, "P-384"_s, "P-521"_s };
        bool validCurve = false;
        for (const auto& validCurveType : validCurves) {
            if (crv == validCurveType) {
                validCurve = true;
                break;
            }
        }

        if (!validCurve) {
            Bun::ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "key.crv"_s, "must be one of:"_s, crvValue, validCurves);
            return std::nullopt;
        }

        // Get and validate key.x and key.y
        JSValue xValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "x"_s));
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        if (!xValue.isString()) {
            Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.x"_s, "string"_s, xValue);
            return std::nullopt;
        }

        JSValue yValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "y"_s));
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        if (!yValue.isString()) {
            Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.y"_s, "string"_s, yValue);
            return std::nullopt;
        }

        // For private keys, validate key.d
        if (!isPublic) {
            JSValue dValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "d"_s));
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            if (!dValue.isString()) {
                Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.d"_s, "string"_s, dValue);
                return std::nullopt;
            }
        }

        // Convert to WebCrypto JsonWebKey and use existing implementation
        auto jwk = WebCore::JsonWebKey();
        jwk.kty = kty;
        jwk.crv = crv;
        jwk.x = xValue.toWTFString(lexicalGlobalObject);
        jwk.y = yValue.toWTFString(lexicalGlobalObject);

        if (!isPublic) {
            jwk.d = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "d"_s)).toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, std::nullopt);
        }

        // Use the WebCrypto implementation to import the key
        RefPtr<WebCore::CryptoKeyEC> result;
        if (isPublic) {
            result = WebCore::CryptoKeyEC::importJwk(WebCore::CryptoAlgorithmIdentifier::ECDSA, crv, WTFMove(jwk), true, WebCore::CryptoKeyUsageVerify);
        } else {
            result = WebCore::CryptoKeyEC::importJwk(WebCore::CryptoAlgorithmIdentifier::ECDSA, crv, WTFMove(jwk), true, WebCore::CryptoKeyUsageSign);
        }

        if (!result) {
            Bun::ERR::CRYPTO_INVALID_JWK(scope, lexicalGlobalObject);
            return std::nullopt;
        }

        // Convert CryptoKeyEC to EVPKeyPointer
        AsymmetricKeyValue keyValue(*result);
        if (!keyValue.key) {
            Bun::ERR::CRYPTO_INVALID_JWK(scope, lexicalGlobalObject);
            return std::nullopt;
        }

        EVP_PKEY_up_ref(keyValue.key);
        return ncrypto::EVPKeyPointer(keyValue.key);
    }
    // Handle RSA keys
    else if (kty == "RSA"_s) {
        // Get and validate key.n and key.e
        JSValue nValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "n"_s));
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        if (!nValue.isString()) {
            Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.n"_s, "string"_s, nValue);
            return std::nullopt;
        }

        JSValue eValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "e"_s));
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        if (!eValue.isString()) {
            Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.e"_s, "string"_s, eValue);
            return std::nullopt;
        }

        // For private keys, validate additional parameters
        if (!isPublic) {
            JSValue dValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "d"_s));
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            if (!dValue.isString()) {
                Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.d"_s, "string"_s, dValue);
                return std::nullopt;
            }

            JSValue pValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "p"_s));
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            if (!pValue.isString()) {
                Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.p"_s, "string"_s, pValue);
                return std::nullopt;
            }

            JSValue qValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "q"_s));
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            if (!qValue.isString()) {
                Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.q"_s, "string"_s, qValue);
                return std::nullopt;
            }

            JSValue dpValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "dp"_s));
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            if (!dpValue.isString()) {
                Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.dp"_s, "string"_s, dpValue);
                return std::nullopt;
            }

            JSValue dqValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "dq"_s));
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            if (!dqValue.isString()) {
                Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.dq"_s, "string"_s, dqValue);
                return std::nullopt;
            }

            JSValue qiValue = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "qi"_s));
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            if (!qiValue.isString()) {
                Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.qi"_s, "string"_s, qiValue);
                return std::nullopt;
            }
        }

        // Convert to WebCrypto JsonWebKey and use existing implementation
        auto jwk = WebCore::JsonWebKey();
        jwk.kty = kty;
        jwk.n = nValue.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        jwk.e = eValue.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        if (!isPublic) {
            jwk.d = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "d"_s)).toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, std::nullopt);
            jwk.p = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "p"_s)).toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, std::nullopt);
            jwk.q = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "q"_s)).toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, std::nullopt);
            jwk.dp = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "dp"_s)).toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, std::nullopt);
            jwk.dq = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "dq"_s)).toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, std::nullopt);
            jwk.qi = keyObj->get(lexicalGlobalObject, Identifier::fromString(vm, "qi"_s)).toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, std::nullopt);
        }

        // Use the WebCrypto implementation to import the key
        RefPtr<WebCore::CryptoKeyRSA> result;
        if (isPublic) {
            result = WebCore::CryptoKeyRSA::importJwk(WebCore::CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5, std::nullopt, WTFMove(jwk), true, WebCore::CryptoKeyUsageVerify);
        } else {
            result = WebCore::CryptoKeyRSA::importJwk(WebCore::CryptoAlgorithmIdentifier::RSASSA_PKCS1_v1_5, std::nullopt, WTFMove(jwk), true, WebCore::CryptoKeyUsageSign);
        }

        if (!result) {
            Bun::ERR::CRYPTO_INVALID_JWK(scope, lexicalGlobalObject);
            return std::nullopt;
        }

        // Convert CryptoKeyRSA to EVPKeyPointer
        AsymmetricKeyValue keyValue(*result);
        if (!keyValue.key) {
            Bun::ERR::CRYPTO_INVALID_JWK(scope, lexicalGlobalObject);
            return std::nullopt;
        }

        EVP_PKEY_up_ref(keyValue.key);
        return ncrypto::EVPKeyPointer(keyValue.key);
    }

    // Should never reach here due to earlier validation
    Bun::ERR::CRYPTO_INVALID_JWK(scope, lexicalGlobalObject);
    return std::nullopt;
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

    if (!asn1_sig.setParams(std::move(r), std::move(s))) {
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

} // namespace Bun
