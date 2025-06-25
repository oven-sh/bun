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
#include "JSCryptoKey.h"
#include "NodeValidator.h"
#include "JSBuffer.h"
#include "CryptoUtil.h"
#include "BunString.h"
#include <openssl/bn.h>
#include <openssl/ecdsa.h>
#include "ncrypto.h"
#include "JSSign.h"
#include "JsonWebKey.h"
#include "CryptoKeyEC.h"
#include "CryptoKeyRSA.h"
#include "wtf/text/Base64.h"
#include "KeyObject.h"

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
const JSC::ClassInfo JSVerifyPrototype::s_info = { "Verify"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSVerifyPrototype) };
const JSC::ClassInfo JSVerifyConstructor::s_info = { "Verify"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSVerifyConstructor) };

void JSVerify::destroy(JSC::JSCell* cell)
{
    static_cast<JSVerify*>(cell)->~JSVerify();
}

JSVerify::~JSVerify()
{
}

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
    if (!thisObject) [[unlikely]] {
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
    if (!thisObject) [[unlikely]] {
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

        auto dataView = dataString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        JSValue buf = JSValue::decode(constructFromEncoding(globalObject, dataView, encoding));
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

JSC_DEFINE_HOST_FUNCTION(jsVerifyProtoFuncVerify, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;

    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Get the JSVerify object from thisValue and verify it's valid
    JSVerify* thisObject = jsDynamicCast<JSVerify*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "Verify"_s, "verify"_s);
        return JSValue::encode({});
    }

    // Check if the context is initialized
    if (!thisObject->m_mdCtx) {
        throwTypeError(globalObject, scope, "Verify.prototype.verify cannot be called before Verify.prototype.init"_s);
        return JSValue::encode({});
    }

    // This function receives two arguments: options and signature
    JSValue options = callFrame->argument(0);
    JSValue signatureValue = callFrame->argument(1);
    JSValue sigEncodingValue = callFrame->argument(2);

    JSC::JSArrayBufferView* signatureBuffer = getArrayBufferOrView(globalObject, scope, signatureValue, "signature"_s, sigEncodingValue);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    auto prepareResult = KeyObject::preparePublicOrPrivateKey(globalObject, scope, options);
    RETURN_IF_EXCEPTION(scope, {});

    KeyObject keyObject;
    if (prepareResult.keyData) {
        keyObject = KeyObject::create(CryptoKeyType::Public, WTFMove(*prepareResult.keyData));
    } else {
        keyObject = KeyObject::getPublicOrPrivateKey(
            globalObject,
            scope,
            prepareResult.keyDataView,
            CryptoKeyType::Public,
            prepareResult.formatType,
            prepareResult.encodingType,
            prepareResult.cipher,
            WTFMove(prepareResult.passphrase));
        RETURN_IF_EXCEPTION(scope, {});
    }

    const auto& keyPtr = keyObject.asymmetricKey();

    // Get RSA padding mode and salt length if applicable
    int32_t padding = getPadding(globalObject, scope, options, keyPtr);
    RETURN_IF_EXCEPTION(scope, {});

    std::optional<int> saltLen = getSaltLength(globalObject, scope, options);
    RETURN_IF_EXCEPTION(scope, {});

    // Get DSA signature encoding format
    DSASigEnc dsaSigEnc = getDSASigEnc(globalObject, scope, options);
    RETURN_IF_EXCEPTION(scope, {});

    // Move mdCtx out of JSVerify object to finalize it
    ncrypto::EVPMDCtxPointer mdCtx = WTFMove(thisObject->m_mdCtx);

    // Validate DSA parameters
    if (!keyPtr.validateDsaParameters()) {
        throwTypeError(globalObject, scope, "Invalid DSA parameters"_s);
        return JSValue::encode({});
    }

    // Get the final digest
    auto data = mdCtx.digestFinal(mdCtx.getExpectedSize());
    if (!data) {
        throwTypeError(globalObject, scope, "Failed to finalize digest"_s);
        return JSValue::encode({});
    }

    // Create verification context
    auto pkctx = keyPtr.newCtx();
    if (!pkctx || pkctx.initForVerify() <= 0) {
        throwCryptoError(globalObject, scope, ERR_peek_error(), "Failed to initialize verification context"_s);
        return JSValue::encode({});
    }

    // Set RSA padding mode and salt length if applicable
    if (keyPtr.isRsaVariant()) {
        if (!ncrypto::EVPKeyCtxPointer::setRsaPadding(pkctx.get(), padding, saltLen)) {
            throwCryptoError(globalObject, scope, ERR_peek_error(), "Failed to set RSA padding"_s);
            return JSValue::encode({});
        }
    }

    // Set signature MD from the digest context
    if (!pkctx.setSignatureMd(mdCtx)) {
        throwCryptoError(globalObject, scope, ERR_peek_error(), "Failed to set signature message digest"_s);
        return JSValue::encode({});
    }

    // Handle P1363 format conversion for EC keys if needed
    ncrypto::Buffer<const unsigned char> sigBuf {
        .data = static_cast<const unsigned char*>(signatureBuffer->vector()),
        .len = signatureBuffer->byteLength(),
    };

    if (dsaSigEnc == DSASigEnc::P1363 && keyPtr.isSigVariant()) {
        WTF::Vector<uint8_t> derBuffer;

        if (convertP1363ToDER(sigBuf, keyPtr, derBuffer)) {
            // Conversion succeeded, perform verification with the converted signature
            ncrypto::Buffer<const uint8_t> derSigBuf {
                .data = derBuffer.begin(),
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

} // namespace Bun
