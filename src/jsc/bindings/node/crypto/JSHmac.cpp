#include "JSHmac.h"
#include "CryptoUtil.h"
#include "BunClientData.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/ThrowScope.h>
#include <openssl/evp.h>
#include <JavaScriptCore/Error.h>
#include "NodeValidator.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include "KeyObject.h"
#include "ZigGlobalObject.h"
#include "LazyTransform.h"

namespace Bun {

static JSC_DECLARE_HOST_FUNCTION(jsHmacProtoFuncUpdate);
static JSC_DECLARE_HOST_FUNCTION(jsHmacProtoFuncDigest);
static JSC_DECLARE_HOST_FUNCTION(jsHmacProtoFuncTransform);
static JSC_DECLARE_HOST_FUNCTION(jsHmacProtoFuncFlush);

// Enumerable, like the `Hmac.prototype.x = ...` assignments in Node's lib/internal/crypto/hash.js.
static const HashTableValue JSHmacPrototypeTableValues[] = {
    { "update"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHmacProtoFuncUpdate, 2 } },
    { "digest"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHmacProtoFuncDigest, 1 } },
    { "_readableState"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsLazyTransformStateGetter, jsLazyTransformStateSetter } },
    { "_writableState"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsLazyTransformStateGetter, jsLazyTransformStateSetter } },
    { "_transform"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHmacProtoFuncTransform, 3 } },
    { "_flush"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHmacProtoFuncFlush, 1 } },
};

const ClassInfo JSHmac::s_info = { "Hmac"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHmac) };
const ClassInfo JSHmacPrototype::s_info = { "Hmac"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHmacPrototype) };
const ClassInfo JSHmacConstructor::s_info = { "Hmac"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHmacConstructor) };

JSHmac::JSHmac(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

void JSHmac::destroy(JSC::JSCell* cell)
{
    static_cast<JSHmac*>(cell)->~JSHmac();
}

JSHmac::~JSHmac()
{
}

void JSHmac::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
}

template<typename Visitor>
void JSHmac::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSHmac* thisObject = uncheckedDowncast<JSHmac>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.reportExtraMemoryVisited(thisObject->m_sizeForGC);
}

DEFINE_VISIT_CHILDREN(JSHmac);

template<typename, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSHmac::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;

    return WebCore::subspaceForImpl<JSHmac, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSHmac, m_subspaceForJSHmac));
}

JSHmac* JSHmac::create(JSC::VM& vm, JSC::Structure* structure)
{
    JSHmac* instance = new (NotNull, JSC::allocateCell<JSHmac>(vm)) JSHmac(vm, structure);
    instance->finishCreation(vm);
    return instance;
}

void JSHmac::init(JSC::JSGlobalObject* globalObject, ThrowScope& scope, const StringView& algorithm, std::span<const uint8_t> keyData)
{
    // Get the digest algorithm from the algorithm name
    const EVP_MD* md = ncrypto::getDigestByName(algorithm);
    if (!md) {
        Bun::ERR::CRYPTO_INVALID_DIGEST(scope, globalObject, algorithm);
        return;
    }

    // Create the HMAC context
    m_ctx = ncrypto::HMACCtxPointer::New();

    // Initialize HMAC with the key and algorithm
    ncrypto::Buffer<const void> keyBuffer {
        .data = keyData.data(),
        .len = keyData.size(),
    };

    if (!m_ctx.init(keyBuffer, md)) {
        m_ctx.reset();
        throwCryptoError(globalObject, scope, ERR_get_error(), "Failed to initialize HMAC context"_s);
        return;
    }

    m_sizeForGC = sizeof(HMAC_CTX);
    globalObject->vm().heap.reportExtraMemoryAllocated(this, m_sizeForGC);
}

bool JSHmac::update(std::span<const uint8_t> input)
{
    // Update the HMAC with the data
    ncrypto::Buffer<const void> buffer {
        .data = input.data(),
        .len = input.size(),
    };

    return m_ctx.update(buffer);
}

void JSHmacPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    Bun::reifyStaticPropertyTable(vm, JSHmac::info(), JSHmacPrototypeTableValues, *this);
}

// hmac.update(data[, inputEncoding]) minus the finalized / this checks. Throws on failure.
static void hmacUpdate(JSGlobalObject* globalObject, JSHmac* hmac, JSValue inputValue, JSValue encodingValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (inputValue.isString()) {
        JSString* inputString = inputValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, void());

        auto encoding = parseEnumeration<WebCore::BufferEncodingType>(*globalObject, encodingValue).value_or(WebCore::BufferEncodingType::utf8);
        RETURN_IF_EXCEPTION(scope, void());

        if (encoding == WebCore::BufferEncodingType::hex && inputString->length() % 2 != 0) {
            Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "encoding"_s, encodingValue, makeString("is invalid for data of length "_s, inputString->length()));
            return;
        }

        auto inputView = inputString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, void());

        JSValue converted = JSValue::decode(WebCore::constructFromEncoding(globalObject, inputView, encoding));
        RETURN_IF_EXCEPTION(scope, void());

        auto* convertedView = dynamicDowncast<JSC::JSArrayBufferView>(converted);
        if (!hmac->update(std::span { reinterpret_cast<const uint8_t*>(convertedView->vector()), convertedView->byteLength() })) {
            Bun::ERR::CRYPTO_HASH_UPDATE_FAILED(scope, globalObject);
        }
        return;
    }

    if (auto* view = dynamicDowncast<JSArrayBufferView>(inputValue)) {
        if (!hmac->update(std::span { reinterpret_cast<const uint8_t*>(view->vector()), view->byteLength() })) {
            Bun::ERR::CRYPTO_HASH_UPDATE_FAILED(scope, globalObject);
        }
        return;
    }

    Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "data"_s, "string or an instance of Buffer, TypedArray, or DataView"_s, inputValue);
}

JSC_DEFINE_HOST_FUNCTION(jsHmacProtoFuncUpdate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSHmac* hmac = dynamicDowncast<JSHmac>(thisValue);
    if (!hmac) [[unlikely]] {
        return Bun::ERR::INVALID_THIS(scope, globalObject, "Hmac"_s);
    }
    if (hmac->m_finalized) {
        return Bun::ERR::CRYPTO_HASH_FINALIZED(scope, globalObject);
    }

    hmacUpdate(globalObject, hmac, callFrame->argument(0), callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(thisValue);
}

// The HMAC as a Buffer/string. Finalizes the context; once finalized, returns an empty
// Buffer / string (as Node does) rather than throwing.
static EncodedJSValue hmacDigest(JSGlobalObject* lexicalGlobalObject, JSHmac* hmac, BufferEncodingType encoding)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    if (hmac->m_finalized) {
        if (encoding != BufferEncodingType::buffer)
            return JSValue::encode(jsEmptyString(vm));
        RELEASE_AND_RETURN(scope, JSValue::encode(JSC::JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), 0)));
    }

    unsigned char mdValue[EVP_MAX_MD_SIZE];
    ncrypto::Buffer<void> mdBuffer {
        .data = mdValue,
        .len = sizeof(mdValue),
    };

    if (hmac->m_ctx) {
        bool ok = hmac->m_ctx.digestInto(&mdBuffer);
        hmac->m_ctx.reset();
        hmac->m_sizeForGC = 0;
        if (!ok) {
            throwCryptoError(lexicalGlobalObject, scope, ERR_get_error(), "Failed to digest HMAC"_s);
            return {};
        }
    } else {
        mdBuffer.len = 0;
    }
    hmac->m_finalized = true;

    RELEASE_AND_RETURN(scope, StringBytes::encode(lexicalGlobalObject, scope, std::span<const uint8_t> { reinterpret_cast<const uint8_t*>(mdBuffer.data), mdBuffer.len }, encoding));
}

JSC_DEFINE_HOST_FUNCTION(jsHmacProtoFuncDigest, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHmac* hmac = dynamicDowncast<JSHmac>(callFrame->thisValue());
    if (!hmac) [[unlikely]] {
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "Hmac"_s);
    }

    JSC::JSValue encodingValue = callFrame->argument(0);
    BufferEncodingType encoding = BufferEncodingType::buffer;
    if (encodingValue.pureToBoolean() != TriState::False) {
        // this value must stringify
        // https://github.com/nodejs/node/blob/db00f9401882297e7e2e85c9e3ef042888074eaf/lib/internal/crypto/hash.js#L166
        WTF::String encodingString = encodingValue.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        encoding = parseEnumerationFromString<BufferEncodingType>(encodingString).value_or(BufferEncodingType::buffer);
    }

    RELEASE_AND_RETURN(scope, hmacDigest(lexicalGlobalObject, hmac, encoding));
}

// Transform hook: _transform(chunk, encoding, callback)
JSC_DEFINE_HOST_FUNCTION(jsHmacProtoFuncTransform, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHmac* hmac = dynamicDowncast<JSHmac>(callFrame->thisValue());
    if (!hmac) [[unlikely]] {
        return Bun::ERR::INVALID_THIS(scope, globalObject, "Hmac"_s);
    }
    if (hmac->m_finalized) {
        return Bun::ERR::CRYPTO_HASH_FINALIZED(scope, globalObject);
    }
    hmacUpdate(globalObject, hmac, callFrame->argument(0), callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});

    JSValue callback = callFrame->argument(2);
    auto callData = JSC::getCallData(callback);
    if (callData.type == CallData::Type::None) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "callback"_s, "function"_s, callback);
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::profiledCall(globalObject, ProfilingReason::API, callback, callData, jsUndefined(), ArgList())));
}

// Transform hook: _flush(callback) — push the digest and finish.
JSC_DEFINE_HOST_FUNCTION(jsHmacProtoFuncFlush, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSHmac* hmac = dynamicDowncast<JSHmac>(thisValue);
    if (!hmac) [[unlikely]] {
        return Bun::ERR::INVALID_THIS(scope, globalObject, "Hmac"_s);
    }

    JSValue digest = JSValue::decode(hmacDigest(globalObject, hmac, BufferEncodingType::buffer));
    RETURN_IF_EXCEPTION(scope, {});

    JSValue push = hmac->get(globalObject, Identifier::fromString(vm, "push"_s));
    RETURN_IF_EXCEPTION(scope, {});
    auto pushCallData = JSC::getCallData(push);
    if (pushCallData.type == CallData::Type::None) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "this.push is not a function"_s);
    MarkedArgumentBuffer pushArgs;
    pushArgs.append(digest);
    JSC::profiledCall(globalObject, ProfilingReason::API, push, pushCallData, thisValue, pushArgs);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue callback = callFrame->argument(0);
    auto callData = JSC::getCallData(callback);
    if (callData.type == CallData::Type::None) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "callback"_s, "function"_s, callback);
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::profiledCall(globalObject, ProfilingReason::API, callback, callData, jsUndefined(), ArgList())));
}

// new Hmac(hmac, key[, options]) / Hmac(hmac, key[, options])
static EncodedJSValue constructOrCallHmac(JSGlobalObject* globalObject, CallFrame* callFrame, JSValue newTarget)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSHmacClassStructure.get(zigGlobalObject);
    if (newTarget && zigGlobalObject->m_JSHmacClassStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->m_JSHmacClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSValue algorithmValue = callFrame->argument(0);
    V::validateString(scope, globalObject, algorithmValue, "hmac"_s);
    RETURN_IF_EXCEPTION(scope, {});

    // Get encoding next before stringifying algorithm
    JSValue options = callFrame->argument(2);
    JSValue encodingValue = jsUndefined();
    if (options.isObject()) {
        encodingValue = options.get(globalObject, WebCore::builtinNames(vm).encodingPublicName());
        RETURN_IF_EXCEPTION(scope, {});

        if (!encodingValue.isUndefinedOrNull()) {
            V::validateString(scope, globalObject, encodingValue, "options.encoding"_s);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    WTF::String algorithm = algorithmValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue key = callFrame->argument(1);
    KeyObject keyObject = KeyObject::prepareSecretKey(globalObject, scope, key, encodingValue);
    RETURN_IF_EXCEPTION(scope, {});

    JSHmac* hmac = JSHmac::create(vm, structure);
    hmac->init(globalObject, scope, algorithm, keyObject.symmetricKey().span());
    RETURN_IF_EXCEPTION(scope, {});

    // Transform is constructed lazily (see LazyTransform.h); it reads `this._options` then.
    if (!options.isUndefined())
        hmac->putDirect(vm, Identifier::fromString(vm, "_options"_s), options);

    return JSC::JSValue::encode(hmac);
}

JSC_DEFINE_HOST_FUNCTION(constructHmac, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return constructOrCallHmac(globalObject, callFrame, callFrame->newTarget());
}

// Node's Hmac is a plain function: calling it without `new` constructs anyway.
JSC_DEFINE_HOST_FUNCTION(callHmac, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return constructOrCallHmac(globalObject, callFrame, JSValue());
}

JSC::Structure* JSHmacConstructor::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
}

void setupJSHmacClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    // class Hmac extends Transform (internal/streams/transform); see LazyTransform.h for the lazy part.
    JSObject* transform = transformConstructor(init.global);
    RELEASE_ASSERT(transform);
    JSValue transformPrototype = transform->getDirect(init.vm, init.vm.propertyNames->prototype);
    RELEASE_ASSERT(transformPrototype && transformPrototype.isObject());

    auto* prototypeStructure = JSHmacPrototype::createStructure(init.vm, init.global, transformPrototype);
    auto* prototype = JSHmacPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSHmacConstructor::createStructure(init.vm, init.global, transform);
    auto* constructor = JSHmacConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSHmac::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
