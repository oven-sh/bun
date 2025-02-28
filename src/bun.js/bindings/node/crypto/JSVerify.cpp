#include "JSVerify.h"
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
#include <openssl/bn.h>
#include <openssl/ecdsa.h>
#include "ncrypto.h"
#include "JSSign.h"

// Forward declarations for functions defined in other files
namespace Bun {

using namespace JSC;

// Forward declarations for prototype functions
JSC_DECLARE_HOST_FUNCTION(jsVerifyProtoFuncInit);
JSC_DECLARE_HOST_FUNCTION(jsVerifyProtoFuncUpdate);
JSC_DECLARE_HOST_FUNCTION(jsVerifyProtoFuncVerify);

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
    return WebCore::subspaceForImpl<CellType, WebCore::UseCustomHeapCellType::No>(
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

    // Check that we have at least 1 argument (the data)
    if (callFrame->argumentCount() < 1) {
        throwVMError(globalObject, scope, "Verify.prototype.update requires at least 1 argument"_s);
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

        return JSValue::encode(callFrame->thisValue());
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

        return JSValue::encode(callFrame->thisValue());
    }

    return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "data"_s, "string or an instance of Buffer, TypedArray, or DataView"_s, data);
}

std::optional<ncrypto::EVPKeyPointer> preparePublicOrPrivateKey(JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSValue maybeKey);
JSC::JSArrayBufferView* getArrayBufferOrView(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral argName, JSValue encodingValue);
bool convertP1363ToDER(const ncrypto::Buffer<const unsigned char>& p1363Sig, unsigned char* derBuffer, size_t derMaxSize, size_t bytesOfRS, size_t* derLen);

JSC_DEFINE_HOST_FUNCTION(jsVerifyProtoFuncVerify, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
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

    // Prepare the public or private key from options
    std::optional<ncrypto::EVPKeyPointer> maybeKeyPtr = preparePublicOrPrivateKey(globalObject, scope, options);
    ASSERT(!!scope.exception() == !maybeKeyPtr.has_value());
    if (!maybeKeyPtr) {
        return JSValue::encode(jsBoolean(false));
    }
    ncrypto::EVPKeyPointer keyPtr = WTFMove(maybeKeyPtr.value());

    // Get RSA padding mode and salt length if applicable
    int32_t padding = getPadding(globalObject, options, keyPtr);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsBoolean(false)));

    std::optional<int> saltLen = getSaltLength(globalObject, options);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsBoolean(false)));

    // For RSA-PSS verification, if no salt length is specified, use -1 (auto-detect)
    if (!saltLen.has_value() && padding == RSA_PKCS1_PSS_PADDING) {
        saltLen = -1; // Auto-detect for verification
    }

    // Get DSA signature encoding format
    NodeCryptoKeys::DSASigEnc dsaSigEnc = getDSASigEnc(globalObject, options);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsBoolean(false)));

    // Get the signature buffer
    JSC::JSArrayBufferView* signatureBuffer = getArrayBufferOrView(globalObject, scope, signatureValue, "signature"_s, sigEncodingValue);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsBoolean(false)));

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
        .data = static_cast<const unsigned char*>(signatureBuffer->span().data()),
        .len = signatureBuffer->span().size(),
    };

    if (dsaSigEnc == NodeCryptoKeys::DSASigEnc::P1363 && keyPtr.isSigVariant()) {
        auto bytesOfRS = keyPtr.getBytesOfRS();
        if (!bytesOfRS) {
            throwTypeError(globalObject, scope, "Failed to get signature size"_s);
            return JSValue::encode(jsBoolean(false));
        }

        size_t derMaxSize = 2 + 2 * (2 + bytesOfRS.value());
        auto derBuffer = std::make_unique<unsigned char[]>(derMaxSize);
        if (!derBuffer) {
            throwTypeError(globalObject, scope, "Failed to allocate DER buffer"_s);
            return JSValue::encode(jsBoolean(false));
        }

        size_t derLen = 0;
        if (!convertP1363ToDER(sigBuf, derBuffer.get(), derMaxSize, bytesOfRS.value(), &derLen)) {
            throwTypeError(globalObject, scope, "Failed to convert signature format"_s);
            return JSValue::encode(jsBoolean(false));
        }

        // Perform verification with the converted signature
        ncrypto::Buffer<const unsigned char> derSigBuf {
            .data = derBuffer.get(),
            .len = derLen
        };

        bool result = pkctx.verify(derSigBuf, data);
        return JSValue::encode(jsBoolean(result));
    }

    // Perform verification with the original signature
    bool result = pkctx.verify(sigBuf, data);
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

// Helper function to get a buffer from a signature value with optional encoding
JSC::JSArrayBufferView* getArrayBufferOrView(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral argName, JSValue encodingValue)
{
    if (value.isString()) {
        JSString* dataString = value.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        auto encoding = parseEnumeration<BufferEncodingType>(*globalObject, encodingValue).value_or(BufferEncodingType::utf8);
        RETURN_IF_EXCEPTION(scope, {});

        if (encoding == BufferEncodingType::hex && dataString->length() % 2 != 0) {
            Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "encoding"_s, encodingValue, makeString("is invalid for data of length "_s, dataString->length()));
            return {};
        }

        JSValue buf = JSValue::decode(constructFromEncoding(globalObject, dataString, encoding));
        RETURN_IF_EXCEPTION(scope, {});

        auto* view = jsDynamicCast<JSC::JSArrayBufferView*>(buf);
        if (!view) {
            Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, argName, "string or an instance of Buffer, TypedArray, or DataView"_s, value);
            return {};
        }

        if (view->isDetached()) {
            throwTypeError(globalObject, scope, "Buffer is detached"_s);
            return {};
        }

        return view;
    }

    if (!value.isCell() || !JSC::isTypedArrayTypeIncludingDataView(value.asCell()->type())) {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, argName, "string or an instance of Buffer, TypedArray, or DataView"_s, value);
        return {};
    }

    auto* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(value);
    if (!view) {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, argName, "string or an instance of Buffer, TypedArray, or DataView"_s, value);
        return {};
    }

    if (view->isDetached()) {
        throwTypeError(globalObject, scope, "Buffer is detached"_s);
        return {};
    }

    return view;
}

// Helper function to get padding from options
int32_t getPadding(JSGlobalObject* globalObject, JSValue options, const ncrypto::EVPKeyPointer& pkey)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    int32_t padding = pkey.getDefaultSignPadding();

    if (options.isObject()) {
        JSObject* optionsObj = options.getObject();
        JSValue paddingValue = optionsObj->get(globalObject, Identifier::fromString(globalObject->vm(), "padding"_s));
        RETURN_IF_EXCEPTION(scope, padding);

        if (!paddingValue.isUndefined() && paddingValue.isNumber()) {
            padding = paddingValue.asInt32();
            RETURN_IF_EXCEPTION(scope, padding);
        }
    }

    return padding;
}

// Helper function to get salt length from options
std::optional<int> getSaltLength(JSGlobalObject* globalObject, JSValue options)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    std::optional<int> saltLen;

    if (options.isObject()) {
        JSObject* optionsObj = options.getObject();
        JSValue saltLenValue = optionsObj->get(globalObject, Identifier::fromString(globalObject->vm(), "saltLength"_s));
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        if (!saltLenValue.isUndefined() && saltLenValue.isNumber()) {
            saltLen = saltLenValue.asInt32();
            RETURN_IF_EXCEPTION(scope, std::nullopt);
        }
    }

    return saltLen;
}

// Helper function to get DSA signature encoding from options
NodeCryptoKeys::DSASigEnc getDSASigEnc(JSGlobalObject* globalObject, JSValue options)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    NodeCryptoKeys::DSASigEnc dsaSigEnc = NodeCryptoKeys::DSASigEnc::DER;

    if (options.isObject()) {
        JSObject* optionsObj = options.getObject();
        JSValue dsaSigEncValue = optionsObj->get(globalObject, Identifier::fromString(globalObject->vm(), "dsaEncoding"_s));
        RETURN_IF_EXCEPTION(scope, dsaSigEnc);

        if (!dsaSigEncValue.isUndefined()) {
            if (dsaSigEncValue.isString()) {
                JSString* dsaSigEncString = dsaSigEncValue.toString(globalObject);
                RETURN_IF_EXCEPTION(scope, dsaSigEnc);

                WTF::StringView dsaSigEncView = dsaSigEncString->view(globalObject);
                if (dsaSigEncView == "der"_s) {
                    dsaSigEnc = NodeCryptoKeys::DSASigEnc::DER;
                } else if (dsaSigEncView == "ieee-p1363"_s) {
                    dsaSigEnc = NodeCryptoKeys::DSASigEnc::P1363;
                } else {
                    dsaSigEnc = NodeCryptoKeys::DSASigEnc::Invalid;
                }
            } else if (dsaSigEncValue.isNumber()) {
                int32_t value = dsaSigEncValue.asInt32();
                RETURN_IF_EXCEPTION(scope, dsaSigEnc);

                if (value == 0) {
                    dsaSigEnc = NodeCryptoKeys::DSASigEnc::DER;
                } else if (value == 1) {
                    dsaSigEnc = NodeCryptoKeys::DSASigEnc::P1363;
                } else {
                    dsaSigEnc = NodeCryptoKeys::DSASigEnc::Invalid;
                }
            }
        }
    }

    return dsaSigEnc;
}

// Helper function to convert P1363 format to DER format
// namespace ncrypto {
// bool convertP1363ToDER(const Buffer<const unsigned char>& p1363Sig, unsigned char* derBuffer, size_t derMaxSize, size_t bytesOfRS, size_t* derLen)
// {
//     // Check if the signature has the correct length for P1363 format
//     if (p1363Sig.len != 2 * bytesOfRS) {
//         return false;
//     }

//     // Create a new ECDSA_SIG structure
//     ECDSA_SIG* sig = ECDSA_SIG_new();
//     if (!sig) {
//         return false;
//     }

//     // Create a BN_CTX for temporary BIGNUM calculations
//     BN_CTX* ctx = BN_CTX_new();
//     if (!ctx) {
//         ECDSA_SIG_free(sig);
//         return false;
//     }

//     // Extract r and s values from the P1363 format
//     BIGNUM* r = BN_CTX_get(ctx);
//     BIGNUM* s = BN_CTX_get(ctx);

//     if (!r || !s) {
//         ECDSA_SIG_free(sig);
//         BN_CTX_free(ctx);
//         return false;
//     }

//     // Convert the first half of the signature to r
//     if (BN_bin2bn(p1363Sig.data, bytesOfRS, r) == nullptr) {
//         ECDSA_SIG_free(sig);
//         BN_CTX_free(ctx);
//         return false;
//     }

//     // Convert the second half of the signature to s
//     if (BN_bin2bn(p1363Sig.data + bytesOfRS, bytesOfRS, s) == nullptr) {
//         ECDSA_SIG_free(sig);
//         BN_CTX_free(ctx);
//         return false;
//     }

//     // Set the r and s components in the ECDSA_SIG structure
//     if (ECDSA_SIG_set0(sig, BN_dup(r), BN_dup(s)) != 1) {
//         ECDSA_SIG_free(sig);
//         BN_CTX_free(ctx);
//         return false;
//     }

//     // Convert the ECDSA_SIG to DER format
//     int len = i2d_ECDSA_SIG(sig, &derBuffer);
//     if (len <= 0 || static_cast<size_t>(len) > derMaxSize) {
//         ECDSA_SIG_free(sig);
//         BN_CTX_free(ctx);
//         return false;
//     }

//     *derLen = static_cast<size_t>(len);

//     ECDSA_SIG_free(sig);
//     BN_CTX_free(ctx);
//     return true;
// }
// }

// Helper function to convert P1363 format to DER format
bool convertP1363ToDER(const ncrypto::Buffer<const unsigned char>& p1363Sig, unsigned char* derBuffer, size_t derMaxSize, size_t bytesOfRS, size_t* derLen)
{
    // Check if the signature has the correct length for P1363 format
    if (p1363Sig.len != 2 * bytesOfRS) {
        return false;
    }

    // Create a new ECDSA_SIG structure
    ECDSA_SIG* sig = ECDSA_SIG_new();
    if (!sig) {
        return false;
    }

    // Create a BN_CTX for temporary BIGNUM calculations
    BN_CTX* ctx = BN_CTX_new();
    if (!ctx) {
        ECDSA_SIG_free(sig);
        return false;
    }

    // Extract r and s values from the P1363 format
    BIGNUM* r = BN_CTX_get(ctx);
    BIGNUM* s = BN_CTX_get(ctx);

    if (!r || !s) {
        ECDSA_SIG_free(sig);
        BN_CTX_free(ctx);
        return false;
    }

    // Convert the first half of the signature to r
    if (BN_bin2bn(p1363Sig.data, bytesOfRS, r) == nullptr) {
        ECDSA_SIG_free(sig);
        BN_CTX_free(ctx);
        return false;
    }

    // Convert the second half of the signature to s
    if (BN_bin2bn(p1363Sig.data + bytesOfRS, bytesOfRS, s) == nullptr) {
        ECDSA_SIG_free(sig);
        BN_CTX_free(ctx);
        return false;
    }

    // Set the r and s components in the ECDSA_SIG structure
    if (ECDSA_SIG_set0(sig, BN_dup(r), BN_dup(s)) != 1) {
        ECDSA_SIG_free(sig);
        BN_CTX_free(ctx);
        return false;
    }

    // Convert the ECDSA_SIG to DER format
    int len = i2d_ECDSA_SIG(sig, &derBuffer);
    if (len <= 0 || static_cast<size_t>(len) > derMaxSize) {
        ECDSA_SIG_free(sig);
        BN_CTX_free(ctx);
        return false;
    }

    *derLen = static_cast<size_t>(len);

    ECDSA_SIG_free(sig);
    BN_CTX_free(ctx);
    return true;
}

std::optional<ncrypto::EVPKeyPointer> keyFromPublicString(JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, const WTF::StringView& keyView)
{
    ncrypto::EVPKeyPointer::PublicKeyEncodingConfig config;
    config.format = ncrypto::EVPKeyPointer::PKFormatType::PEM;

    UTF8View keyUtf8(keyView);
    auto keySpan = keyUtf8.span();

    ncrypto::Buffer<const unsigned char> ncryptoBuf {
        .data = reinterpret_cast<const unsigned char*>(keySpan.data()),
        .len = keySpan.size(),
    };

    auto res = ncrypto::EVPKeyPointer::TryParsePublicKey(config, ncryptoBuf);
    if (res) {
        ncrypto::EVPKeyPointer keyPtr(WTFMove(res.value));
        return keyPtr;
    }

    throwCryptoError(lexicalGlobalObject, scope, res.openssl_error.value_or(0), "Failed to read public key"_s);
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
            // Handle buffer input
            auto dataBuf = KeyObject__GetBuffer(maybeKey);
            if (dataBuf.hasException()) {
                return std::nullopt;
            }

            // Try to parse as a public key first
            ncrypto::EVPKeyPointer::PublicKeyEncodingConfig pubConfig;
            pubConfig.format = ncrypto::EVPKeyPointer::PKFormatType::PEM;

            auto buffer = dataBuf.releaseReturnValue();
            ncrypto::Buffer<const unsigned char> ncryptoBuf {
                .data = buffer.data(),
                .len = buffer.size(),
            };

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
                Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.key"_s, "object"_s, key);
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

                // Try as public key first
                ncrypto::EVPKeyPointer::PublicKeyEncodingConfig pubConfig;
                pubConfig.format = parseKeyFormat(lexicalGlobalObject, formatValue, "options.format"_s, ncrypto::EVPKeyPointer::PKFormatType::PEM);

                auto pubRes = ncrypto::EVPKeyPointer::TryParsePublicKey(pubConfig, ncryptoBuf);
                if (pubRes) {
                    ncrypto::EVPKeyPointer keyPtr(WTFMove(pubRes.value));
                    return keyPtr;
                }

                // If public key parsing fails, try as a private key
                ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig privConfig;
                privConfig.format = parseKeyFormat(lexicalGlobalObject, formatValue, "options.format"_s, ncrypto::EVPKeyPointer::PKFormatType::PEM);
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
                // JWK format is not implemented in this version
                Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.key"_s, "object for JWK format"_s, key);
                return std::nullopt;
            }
        } else if (key.isString()) {
            // Handle string key
            WTF::String keyStr = key.toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            // Try as public key first
            auto pubKeyPtr = keyFromPublicString(lexicalGlobalObject, scope, keyStr);
            if (pubKeyPtr) {
                return pubKeyPtr;
            }
            RETURN_IF_EXCEPTION(scope, std::nullopt);

            // If public key parsing fails, try as a private key
            return keyFromString(lexicalGlobalObject, scope, keyStr, passphrase);
        }

        Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key.key"_s, "ArrayBuffer, Buffer, TypedArray, DataView, string, KeyObject, or CryptoKey"_s, key);
        return std::nullopt;
    } else if (maybeKey.isString()) {
        // Handle string key directly
        WTF::String keyStr = maybeKey.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        // Try as public key first
        auto pubKeyPtr = keyFromPublicString(lexicalGlobalObject, scope, keyStr);
        if (pubKeyPtr) {
            return pubKeyPtr;
        }
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        // If public key parsing fails, try as a private key
        return keyFromString(lexicalGlobalObject, scope, keyStr, jsUndefined());
    }

    Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "key"_s, "ArrayBuffer, Buffer, TypedArray, DataView, string, KeyObject, or CryptoKey"_s, maybeKey);
    return std::nullopt;
}

} // namespace Bun
