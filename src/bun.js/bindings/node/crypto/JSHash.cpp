#include "JSHash.h"
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

namespace Bun {

static const HashTableValue JSHashPrototypeTableValues[] = {
    { "update"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHashProtoFuncUpdate, 1 } },
    { "digest"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHashProtoFuncDigest, 1 } },
};

const ClassInfo JSHash::s_info = { "Hash"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHash) };
const ClassInfo JSHashPrototype::s_info = { "Hash"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHashPrototype) };
const ClassInfo JSHashConstructor::s_info = { "Hash"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHashConstructor) };

JSHash::JSHash(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

void JSHash::destroy(JSC::JSCell* cell)
{
    static_cast<JSHash*>(cell)->~JSHash();
}

JSHash::~JSHash()
{
    if (m_zigHasher) {
        ExternZigHash::destroy(m_zigHasher);
    }
}

void JSHash::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
}

template<typename, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSHash::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;

    return WebCore::subspaceForImpl<JSHash, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSHash.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSHash = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSHash.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSHash = std::forward<decltype(space)>(space); });
}

JSHash* JSHash::create(JSC::VM& vm, JSC::Structure* structure)
{
    JSHash* instance = new (NotNull, JSC::allocateCell<JSHash>(vm)) JSHash(vm, structure);
    instance->finishCreation(vm);
    return instance;
}

bool JSHash::init(JSC::JSGlobalObject* globalObject, ThrowScope& scope, const EVP_MD* md, std::optional<uint32_t> xofLen)
{
    // Create the digest context
    m_ctx = ncrypto::EVPMDCtxPointer::New();
    if (!m_ctx.digestInit(md)) {
        m_ctx.reset();
        return false;
    }

    // Set the digest length
    m_mdLen = m_ctx.getDigestSize();

    // Handle custom length for XOF hash functions (like SHAKE)
    if (xofLen.has_value() && xofLen.value() != m_mdLen) {
        // from node:
        // https://github.com/nodejs/node/blob/2a6f90813f4802def79f2df1bfe20e95df279abf/src/crypto/crypto_hash.cc#L346
        //
        // This is a little hack to cause createHash to fail when an incorrect
        // hashSize option was passed for a non-XOF hash function.
        if (!m_ctx.hasXofFlag()) {
            EVPerr(EVP_F_EVP_DIGESTFINALXOF, EVP_R_NOT_XOF_OR_INVALID_LENGTH);
            m_ctx.reset();
            return false;
        }
        m_mdLen = xofLen.value();
    }

    return true;
}

bool JSHash::initZig(JSGlobalObject* globalObject, ThrowScope& scope, ExternZigHash::Hasher* hasher, std::optional<uint32_t> xofLen)
{
    m_zigHasher = hasher;
    m_mdLen = ExternZigHash::getDigestSize(hasher);

    if (m_mdLen == 0) {
        return false;
    }

    if (xofLen.has_value()) {
        m_mdLen = xofLen.value();
    }

    return true;
}

bool JSHash::update(std::span<const uint8_t> input)
{
    if (m_ctx) {
        ncrypto::Buffer<const void> buffer {
            .data = input.data(),
            .len = input.size(),
        };

        return m_ctx.digestUpdate(buffer);
    }

    if (m_zigHasher) {
        return ExternZigHash::update(m_zigHasher, input);
    }

    return false;
}

void JSHashPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSHash::info(), JSHashPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSC_DEFINE_HOST_FUNCTION(jsHashProtoFuncUpdate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Get the Hash instance
    JSValue thisHash = callFrame->thisValue();
    JSHash* hash = jsDynamicCast<JSHash*>(thisHash);

    JSValue hashWrapper = callFrame->argument(0);

    // Check if the Hash is already finalized
    if (hash->m_finalized) {
        return Bun::ERR::CRYPTO_HASH_FINALIZED(scope, globalObject);
    }

    JSC::JSValue inputValue = callFrame->argument(1);
    JSValue encodingValue = callFrame->argument(2);

    // Process the inputValue
    if (inputValue.isString()) {
        // Handle string inputValue
        JSString* inputString = inputValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        auto encoding = parseEnumeration<WebCore::BufferEncodingType>(*globalObject, encodingValue).value_or(WebCore::BufferEncodingType::utf8);
        RETURN_IF_EXCEPTION(scope, {});

        // Validate encoding
        if (encoding == WebCore::BufferEncodingType::hex && inputString->length() % 2 != 0) {
            return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "encoding"_s, encodingValue, makeString("is invalid for data of length "_s, inputString->length()));
        }

        auto inputView = inputString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        JSValue converted = JSValue::decode(WebCore::constructFromEncoding(globalObject, inputView, encoding));
        RETURN_IF_EXCEPTION(scope, {});

        auto* convertedView = jsDynamicCast<JSC::JSArrayBufferView*>(converted);

        if (!hash->update(std::span { reinterpret_cast<const uint8_t*>(convertedView->vector()), convertedView->byteLength() })) {
            return Bun::ERR::CRYPTO_HASH_UPDATE_FAILED(scope, globalObject);
        }

        return JSValue::encode(hashWrapper);
    } else if (auto* view = JSC::jsDynamicCast<JSArrayBufferView*>(inputValue)) {
        if (!hash->update(std::span { reinterpret_cast<const uint8_t*>(view->vector()), view->byteLength() })) {
            return Bun::ERR::CRYPTO_HASH_UPDATE_FAILED(scope, globalObject);
        }

        return JSValue::encode(hashWrapper);
    }

    return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "data"_s, "string or an instance of Buffer, TypedArray, or DataView"_s, inputValue);
}

JSC_DEFINE_HOST_FUNCTION(jsHashProtoFuncDigest, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    // Get the Hash instance
    JSHash* hash = jsDynamicCast<JSHash*>(callFrame->thisValue());

    // Check if already finalized
    if (hash->m_finalized) {
        return Bun::ERR::CRYPTO_HASH_FINALIZED(scope, globalObject);
    }

    // Handle encoding if provided
    JSC::JSValue encodingValue = callFrame->argument(0);

    BufferEncodingType encoding = BufferEncodingType::buffer;
    if (encodingValue.pureToBoolean() != TriState::False) {
        // this value needs to stringify if truthy
        // https://github.com/nodejs/node/blob/2a6f90813f4802def79f2df1bfe20e95df279abf/lib/internal/crypto/hash.js#L130
        WTF::String encodingString = encodingValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        encoding = parseEnumerationFromString<BufferEncodingType>(encodingString).value_or(BufferEncodingType::buffer);
        RETURN_IF_EXCEPTION(scope, {});
    }

    bool finalized = true;
    JSValue setFinalizedValue = callFrame->argument(1);
    if (setFinalizedValue.isBoolean()) {
        finalized = setFinalizedValue.asBoolean();
    }

    uint32_t len = hash->m_mdLen;

    if (hash->m_zigHasher) {
        if (hash->m_digestBuffer.size() > 0 || len == 0) {
            RELEASE_AND_RETURN(scope, StringBytes::encode(lexicalGlobalObject, scope, hash->m_digestBuffer.span().subspan(0, hash->m_mdLen), encoding));
        }

        uint32_t maxDigestLen = std::max((uint32_t)EVP_MAX_MD_SIZE, len);
        hash->m_digestBuffer.resizeToFit(maxDigestLen);
        auto totalDigestLen = ExternZigHash::digest(hash->m_zigHasher, globalObject, hash->m_digestBuffer.mutableSpan());
        if (!totalDigestLen) {
            throwCryptoError(lexicalGlobalObject, scope, ERR_get_error(), "Failed to finalize digest"_s);
            return {};
        }

        hash->m_finalized = finalized;
        hash->m_mdLen = std::min(len, totalDigestLen);

        RELEASE_AND_RETURN(scope, StringBytes::encode(lexicalGlobalObject, scope, hash->m_digestBuffer.span().subspan(0, hash->m_mdLen), encoding));
    }

    // Only compute the digest if it hasn't been cached yet
    if (!hash->m_digest && len > 0) {
        auto data = hash->m_ctx.digestFinal(len);
        if (!data) {
            throwCryptoError(lexicalGlobalObject, scope, ERR_get_error(), "Failed to finalize digest"_s);
            return {};
        }

        // Some hash algorithms don't support calling EVP_DigestFinal_ex more than once
        // We need to cache the result for future calls
        hash->m_digest = ByteSource::allocated(data.release());
    }

    // Mark as finalized
    hash->m_finalized = finalized;

    // Return the digest with the requested encoding
    RELEASE_AND_RETURN(scope, StringBytes::encode(lexicalGlobalObject, scope, std::span<const uint8_t> { reinterpret_cast<const uint8_t*>(hash->m_digest.data()), len }, encoding));
}

JSC_DEFINE_HOST_FUNCTION(constructHash, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSHashClassStructure.get(zigGlobalObject);

    // Handle new target
    JSC::JSValue newTarget = callFrame->newTarget();
    if (zigGlobalObject->m_JSHashClassStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor Hash cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->m_JSHashClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSValue algorithmOrHashInstanceValue = callFrame->argument(0);

    // Because we aren't checking if m_finalized true in Hash.prototype.copy, we need to check here
    // and make sure we validate arguments in the correct order.
    // If clone, check m_finalized before anything else.
    JSHash* original = nullptr;
    const EVP_MD* md = nullptr;
    ExternZigHash::Hasher* zigHasher = nullptr;
    if (algorithmOrHashInstanceValue.inherits(JSHash::info())) {
        original = jsDynamicCast<JSHash*>(algorithmOrHashInstanceValue);
        if (!original || original->m_finalized) {
            return Bun::ERR::CRYPTO_HASH_FINALIZED(scope, globalObject);
        }

        if (original->m_zigHasher) {
            zigHasher = ExternZigHash::getFromOther(zigGlobalObject, original->m_zigHasher);
        } else {
            md = original->m_ctx.getDigest();
        }
    } else {
        Bun::V::validateString(scope, globalObject, algorithmOrHashInstanceValue, "algorithm"_s);
        RETURN_IF_EXCEPTION(scope, {});

        WTF::String algorithm = algorithmOrHashInstanceValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        md = ncrypto::getDigestByName(algorithm);
        if (!md) {
            zigHasher = ExternZigHash::getByName(zigGlobalObject, algorithm);
        }
    }

    std::optional<unsigned int> xofLen = std::nullopt;
    JSValue optionsValue = callFrame->argument(1);
    if (optionsValue.isObject()) {
        JSValue outputLengthValue = optionsValue.get(globalObject, Identifier::fromString(vm, "outputLength"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (!outputLengthValue.isUndefined()) {
            Bun::V::validateUint32(scope, globalObject, outputLengthValue, "options.outputLength"_s, jsUndefined());
            RETURN_IF_EXCEPTION(scope, {});
            xofLen = outputLengthValue.toUInt32(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    JSHash* hash = JSHash::create(vm, structure);

    if (zigHasher) {
        if (!hash->initZig(globalObject, scope, zigHasher, xofLen)) {
            throwCryptoError(globalObject, scope, 0, "Digest method not supported"_s);
            return {};
        }
        return JSValue::encode(hash);
    }

    if (md == nullptr || !hash->init(globalObject, scope, md, xofLen)) {
        throwCryptoError(globalObject, scope, ERR_get_error(), "Digest method not supported"_s);
        return {};
    }

    if (original != nullptr && !original->m_ctx.copyTo(hash->m_ctx)) {
        throwCryptoError(globalObject, scope, ERR_get_error(), "Digest copy error"_s);
        return {};
    }

    return JSC::JSValue::encode(hash);
}

JSC_DEFINE_HOST_FUNCTION(callHash, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    throwTypeError(globalObject, scope, "Class constructor Hash cannot be invoked without 'new'"_s);
    return JSC::encodedJSUndefined();
}

JSC::Structure* JSHashConstructor::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
}

void setupJSHashClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSHashPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSHashPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSHashConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSHashConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSHash::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
