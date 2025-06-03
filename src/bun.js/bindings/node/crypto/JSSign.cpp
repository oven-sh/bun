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
#include "JSCryptoKey.h"
#include "NodeValidator.h"
#include "JSBuffer.h"
#include "CryptoUtil.h"
#include "BunString.h"
#include "JSVerify.h"
#include "CryptoAlgorithmRegistry.h"
#include "CryptoKeyRSA.h"
#include "KeyObject.h"

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
const JSC::ClassInfo JSSignPrototype::s_info = { "Sign"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSignPrototype) };
const JSC::ClassInfo JSSignConstructor::s_info = { "Sign"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSignConstructor) };

void JSSign::destroy(JSC::JSCell* cell)
{
    static_cast<JSSign*>(cell)->~JSSign();
}

JSSign::~JSSign()
{
}

JSSign::JSSign(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

void JSSign::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
}

JSSign* JSSign::create(JSC::VM& vm, JSC::Structure* structure)
{
    JSSign* sign = new (NotNull, JSC::allocateCell<JSSign>(vm)) JSSign(vm, structure);
    sign->finishCreation(vm);
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
    return WebCore::subspaceForImpl<JSSign, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSSign.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSSign = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSSign.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSSign = std::forward<decltype(space)>(space); });
}

// JSSignPrototype implementation

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
    if (!thisObject) [[unlikely]] {
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
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "Sign"_s, "update"_s);
        return JSValue::encode({});
    }

    JSValue wrappedSign = callFrame->argument(0);

    // Check that we have at least 1 argument (the data)
    if (callFrame->argumentCount() < 2) {
        throwVMError(globalObject, scope, "Sign.prototype.update requires at least 1 argument"_s);
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
        RETURN_IF_EXCEPTION(scope, {});

        JSValue buf = JSValue::decode(constructFromEncoding(globalObject, dataView, encoding));
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

        auto* view = jsDynamicCast<JSC::JSArrayBufferView*>(buf);

        updateWithBufferView(globalObject, thisObject, view);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

        return JSValue::encode(wrappedSign);
    }

    if (!data.isCell() || !JSC::isTypedArrayTypeIncludingDataView(data.asCell()->type())) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "data"_s, "string or an instance of Buffer, TypedArray, or DataView"_s, data);
    }

    // Handle ArrayBufferView input
    if (auto* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(data)) {

        updateWithBufferView(globalObject, thisObject, view);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

        return JSValue::encode(wrappedSign);
    }

    return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "data"_s, "string or an instance of Buffer, TypedArray, or DataView"_s, data);
}

JSUint8Array* signWithKey(JSC::JSGlobalObject* lexicalGlobalObject, JSSign* thisObject, const ncrypto::EVPKeyPointer& pkey, DSASigEnc dsa_sig_enc, int padding, std::optional<int> salt_len)
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
    if (dsa_sig_enc == DSASigEnc::P1363 && pkey.isSigVariant()) {
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

JSC_DEFINE_HOST_FUNCTION(jsSignProtoFuncSign, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    ncrypto::ClearErrorOnReturn clearError;

    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Get the JSSign object from thisValue and verify it's valid
    JSSign* thisObject = jsDynamicCast<JSSign*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
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
    int32_t padding = getPadding(lexicalGlobalObject, scope, options, {});
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    std::optional<int> saltLen = getSaltLength(lexicalGlobalObject, scope, options);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    // Get DSA signature encoding format
    DSASigEnc dsaSigEnc = getDSASigEnc(lexicalGlobalObject, scope, options);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    auto prepareResult = KeyObject::preparePrivateKey(lexicalGlobalObject, scope, options);
    RETURN_IF_EXCEPTION(scope, {});

    KeyObject keyObject;
    if (prepareResult.keyData) {
        keyObject = KeyObject::create(CryptoKeyType::Private, WTFMove(*prepareResult.keyData));
    } else {
        keyObject = KeyObject::getPublicOrPrivateKey(
            lexicalGlobalObject,
            scope,
            prepareResult.keyDataView,
            CryptoKeyType::Private,
            prepareResult.formatType,
            prepareResult.encodingType,
            prepareResult.cipher,
            WTFMove(prepareResult.passphrase));
        RETURN_IF_EXCEPTION(scope, {});
    }

    const ncrypto::EVPKeyPointer& keyPtr = keyObject.asymmetricKey();

    // Use the signWithKey function to perform the signing operation
    JSUint8Array* signature = signWithKey(lexicalGlobalObject, thisObject, keyPtr, dsaSigEnc, padding, saltLen);
    if (!signature) {
        return {};
    }

    // If output encoding is not buffer, convert the signature to the requested encoding
    if (outputEncoding != BufferEncodingType::buffer) {
        EncodedJSValue encodedSignature = jsBufferToString(lexicalGlobalObject, scope, signature, 0, signature->byteLength(), outputEncoding);
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
    if (zigGlobalObject->m_JSSignClassStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor Sign cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = JSC::InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->m_JSSignClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSC::JSValue::encode(JSSign::create(vm, structure));
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
