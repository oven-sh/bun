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

namespace Bun {

static const HashTableValue JSHmacPrototypeTableValues[] = {
    { "update"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHmacProtoFuncUpdate, 1 } },
    { "digest"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHmacProtoFuncDigest, 1 } },
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

template<typename, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSHmac::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;

    return WebCore::subspaceForImpl<JSHmac, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSHmac.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSHmac = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSHmac.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSHmac = std::forward<decltype(space)>(space); });
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
    reifyStaticProperties(vm, JSHmac::info(), JSHmacPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSC_DEFINE_HOST_FUNCTION(jsHmacProtoFuncUpdate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Get the HMAC instance
    JSValue thisHmac = callFrame->thisValue();
    JSHmac* hmac = jsDynamicCast<JSHmac*>(thisHmac);

    // Check if the HMAC is already finalized
    if (hmac->m_finalized) {
        return Bun::ERR::CRYPTO_HASH_FINALIZED(scope, globalObject);
    }

    JSValue wrappedHmac = callFrame->argument(0);
    JSC::JSValue inputValue = callFrame->argument(1);
    JSValue encodingValue = callFrame->argument(2);

    // Process the inputValue
    if (inputValue.isString()) {
        // Handle string inputValue
        JSString* inputString = inputValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        auto encoding = parseEnumeration<WebCore::BufferEncodingType>(*globalObject, encodingValue).value_or(WebCore::BufferEncodingType::utf8);
        RETURN_IF_EXCEPTION(scope, {});

        // validateEncoding()
        if (encoding == WebCore::BufferEncodingType::hex && inputString->length() % 2 != 0) {
            return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "encoding"_s, encodingValue, makeString("is invalid for data of length "_s, inputString->length()));
        }

        auto inputView = inputString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        JSValue converted = JSValue::decode(WebCore::constructFromEncoding(globalObject, inputView, encoding));
        RETURN_IF_EXCEPTION(scope, {});

        auto* convertedView = jsDynamicCast<JSC::JSArrayBufferView*>(converted);

        if (!hmac->update(std::span { reinterpret_cast<const uint8_t*>(convertedView->vector()), convertedView->byteLength() })) {
            return Bun::ERR::CRYPTO_HASH_UPDATE_FAILED(scope, globalObject);
        }

        return JSValue::encode(wrappedHmac);
    } else if (auto* view = JSC::jsDynamicCast<JSArrayBufferView*>(inputValue)) {
        if (!hmac->update(std::span { reinterpret_cast<const uint8_t*>(view->vector()), view->byteLength() })) {
            return Bun::ERR::CRYPTO_HASH_UPDATE_FAILED(scope, globalObject);
        }

        return JSValue::encode(wrappedHmac);
    }

    return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "data"_s, "string or an instance of Buffer, TypedArray, or DataView"_s, inputValue);
}

JSC_DEFINE_HOST_FUNCTION(jsHmacProtoFuncDigest, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    // Get the HMAC instance
    JSHmac* hmac = jsDynamicCast<JSHmac*>(callFrame->thisValue());

    // Check if already finalized, return empty buffer if already finalized
    if (hmac->m_finalized) {
        auto* emptyBuffer = JSC::JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), 0);
        RETURN_IF_EXCEPTION(scope, {});

        // Handle encoding if provided
        JSC::JSValue encodingValue = callFrame->argument(0);

        auto encoding = parseEnumeration<BufferEncodingType>(*lexicalGlobalObject, encodingValue);
        RETURN_IF_EXCEPTION(scope, {});

        if (encoding.has_value() && encoding.value() != BufferEncodingType::buffer) {
            return JSValue::encode(jsEmptyString(vm));
        }

        return JSValue::encode(emptyBuffer);
    }

    // Handle encoding if provided
    JSC::JSValue encodingValue = callFrame->argument(0);

    BufferEncodingType encoding = BufferEncodingType::buffer;

    if (encodingValue.pureToBoolean() != TriState::False) {
        // this value must stringify
        // https://github.com/nodejs/node/blob/db00f9401882297e7e2e85c9e3ef042888074eaf/lib/internal/crypto/hash.js#L166
        WTF::String encodingString = encodingValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        encoding = parseEnumerationFromString<BufferEncodingType>(encodingString).value_or(BufferEncodingType::buffer);
        RETURN_IF_EXCEPTION(scope, {});
    }

    unsigned char mdValue[EVP_MAX_MD_SIZE];
    ncrypto::Buffer<void> mdBuffer {
        .data = mdValue,
        .len = sizeof(mdValue),
    };

    if (hmac->m_ctx) {
        if (!hmac->m_ctx.digestInto(&mdBuffer)) {
            hmac->m_ctx.reset();
            throwCryptoError(lexicalGlobalObject, scope, ERR_get_error(), "Failed to digest HMAC"_s);
            return {};
        }
        hmac->m_ctx.reset();
    }

    // We shouldn't set finalized if coming from _flush, but this
    // works because m_ctx is reset after digest
    hmac->m_finalized = true;

    RELEASE_AND_RETURN(scope, StringBytes::encode(lexicalGlobalObject, scope, std::span<const uint8_t> { reinterpret_cast<const uint8_t*>(mdBuffer.data), mdBuffer.len }, encoding));
}

JSC_DEFINE_HOST_FUNCTION(constructHmac, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSHmacClassStructure.get(zigGlobalObject);

    // Handle new target
    JSC::JSValue newTarget = callFrame->newTarget();
    if (zigGlobalObject->m_JSHmacClassStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor Hmac cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->m_JSHmacClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSHmac* hmac = JSHmac::create(vm, structure);

    // Check if we have initialization arguments
    JSValue algorithmValue = callFrame->argument(0);
    V::validateString(scope, globalObject, algorithmValue, "hmac"_s);
    RETURN_IF_EXCEPTION(scope, {});

    // Get encoding next before stringifying algorithm
    JSValue options = callFrame->argument(2);
    JSValue encodingValue = jsUndefined();
    if (options.isObject()) {
        encodingValue = options.get(globalObject, Identifier::fromString(vm, "encoding"_s));
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

    hmac->init(globalObject, scope, algorithm, keyObject.symmetricKey().span());
    RETURN_IF_EXCEPTION(scope, {});

    return JSC::JSValue::encode(hmac);
}

JSC_DEFINE_HOST_FUNCTION(callHmac, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    throwConstructorCannotBeCalledAsFunctionTypeError(globalObject, scope, "Hmac"_s);
    return JSC::encodedJSUndefined();
}

JSC::Structure* JSHmacConstructor::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
}

void setupJSHmacClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSHmacPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSHmacPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSHmacConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSHmacConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSHmac::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
