#include "JSHash.h"
#include "CryptoUtil.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"
#include "LazyTransform.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/ThrowScope.h>
#include <openssl/evp.h>
#include "NodeValidator.h"
#include <JavaScriptCore/FunctionPrototype.h>

namespace Bun {

static JSC_DECLARE_HOST_FUNCTION(jsHashProtoFuncUpdate);
static JSC_DECLARE_HOST_FUNCTION(jsHashProtoFuncDigest);
static JSC_DECLARE_HOST_FUNCTION(jsHashProtoFuncCopy);
static JSC_DECLARE_HOST_FUNCTION(jsHashProtoFuncTransform);
static JSC_DECLARE_HOST_FUNCTION(jsHashProtoFuncFlush);

// Enumerable, like the `Hash.prototype.x = function` assignments in Node's lib/internal/crypto/hash.js.
static const HashTableValue JSHashPrototypeTableValues[] = {
    { "copy"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHashProtoFuncCopy, 1 } },
    { "_transform"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHashProtoFuncTransform, 3 } },
    { "_flush"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHashProtoFuncFlush, 1 } },
    { "update"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHashProtoFuncUpdate, 2 } },
    { "digest"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsHashProtoFuncDigest, 1 } },
    { "_readableState"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsLazyTransformStateGetter, jsLazyTransformStateSetter } },
    { "_writableState"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsLazyTransformStateGetter, jsLazyTransformStateSetter } },
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

template<typename Visitor>
void JSHash::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSHash* thisObject = uncheckedDowncast<JSHash>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.reportExtraMemoryVisited(thisObject->m_sizeForGC);
}

DEFINE_VISIT_CHILDREN(JSHash);

template<typename, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSHash::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;

    return WebCore::subspaceForImpl<JSHash, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSHash, m_subspaceForJSHash));
}

JSHash* JSHash::create(JSC::VM& vm, JSC::Structure* structure)
{
    JSHash* instance = new (NotNull, JSC::allocateCell<JSHash>(vm)) JSHash(vm, structure);
    instance->finishCreation(vm);
    return instance;
}

bool JSHash::init(JSC::JSGlobalObject* globalObject, ThrowScope& scope, const EVP_MD* md, std::optional<uint32_t> xofLen)
{
    m_ctx = ncrypto::EVPMDCtxPointer::New();
    if (!m_ctx.digestInit(md)) {
        m_ctx.reset();
        return false;
    }

    m_mdLen = m_ctx.getDigestSize();

    if (xofLen.has_value() && xofLen.value() != m_mdLen) {
        // This is a little hack to cause createHash to fail when an incorrect
        // hashSize option was passed for a non-XOF hash function.
        // https://github.com/nodejs/node/blob/2a6f90813f4802def79f2df1bfe20e95df279abf/src/crypto/crypto_hash.cc#L346
        if (!m_ctx.hasXofFlag()) {
            EVPerr(EVP_F_EVP_DIGESTFINALXOF, EVP_R_NOT_XOF_OR_INVALID_LENGTH);
            m_ctx.reset();
            return false;
        }
        m_mdLen = xofLen.value();
    }

    m_sizeForGC = sizeof(EVP_MD_CTX) + m_mdLen;
    globalObject->vm().heap.reportExtraMemoryAllocated(this, m_sizeForGC);

    return true;
}

bool JSHash::initZig(JSGlobalObject* globalObject, ThrowScope& scope, ExternZigHash::Hasher* hasher, std::optional<uint32_t> xofLen)
{
    m_zigHasher = hasher;
    m_mdLen = ExternZigHash::getDigestSize(hasher);

    if (m_mdLen == 0) {
        return false;
    }

    if (xofLen.has_value() && xofLen.value() != m_mdLen) {
        if (!ExternZigHash::isXof(hasher)) {
            EVPerr(EVP_F_EVP_DIGESTFINALXOF, EVP_R_NOT_XOF_OR_INVALID_LENGTH);
            return false;
        }
        m_mdLen = xofLen.value();
    }

    m_sizeForGC = m_mdLen;
    globalObject->vm().heap.reportExtraMemoryAllocated(this, m_sizeForGC);

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
    Bun::reifyStaticPropertyTable(vm, JSHash::info(), JSHashPrototypeTableValues, *this);
}

// hash.update(data[, inputEncoding]) minus the finalized / this checks. Throws on failure.
static void hashUpdate(JSGlobalObject* globalObject, JSHash* hash, JSValue inputValue, JSValue encodingValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (inputValue.isString()) {
        JSString* inputString = inputValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, void());

        auto _ = JSC::EnsureStillAliveScope(inputString);

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
        if (!hash->update(std::span { reinterpret_cast<const uint8_t*>(convertedView->vector()), convertedView->byteLength() })) {
            Bun::ERR::CRYPTO_HASH_UPDATE_FAILED(scope, globalObject);
        }
        return;
    }

    if (auto* view = dynamicDowncast<JSArrayBufferView>(inputValue)) {
        if (!hash->update(view->span())) {
            Bun::ERR::CRYPTO_HASH_UPDATE_FAILED(scope, globalObject);
        }
        return;
    }

    Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "data"_s, "string or an instance of Buffer, TypedArray, or DataView"_s, inputValue);
}

JSC_DEFINE_HOST_FUNCTION(jsHashProtoFuncUpdate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSHash* hash = dynamicDowncast<JSHash>(thisValue);
    if (!hash) [[unlikely]] {
        return Bun::ERR::INVALID_THIS(scope, globalObject, "Hash"_s);
    }
    if (hash->m_finalized) {
        return Bun::ERR::CRYPTO_HASH_FINALIZED(scope, globalObject);
    }

    hashUpdate(globalObject, hash, callFrame->argument(0), callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(thisValue);
}

// The raw digest bytes as a Buffer/string. Repeated calls return the cached digest;
// `finalize` controls whether later update()/digest() calls throw ERR_CRYPTO_HASH_FINALIZED.
static EncodedJSValue hashDigest(JSGlobalObject* lexicalGlobalObject, JSHash* hash, BufferEncodingType encoding, bool finalize)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    uint32_t len = hash->m_mdLen;

    if (hash->m_zigHasher) {
        if (hash->m_digest || len == 0) {
            if (finalize)
                hash->m_finalized = true;
            RELEASE_AND_RETURN(scope, StringBytes::encode(lexicalGlobalObject, scope, std::span<const uint8_t> { reinterpret_cast<const uint8_t*>(hash->m_digest.data()), hash->m_mdLen }, encoding));
        }

        size_t maxDigestLen = std::max((uint32_t)EVP_MAX_MD_SIZE, len);
        auto data = ncrypto::DataPointer::Alloc(maxDigestLen);
        if (!data) {
            throwOutOfMemoryError(lexicalGlobalObject, scope);
            return {};
        }

        auto totalDigestLen = ExternZigHash::digest(hash->m_zigHasher, globalObject, std::span { data.get<uint8_t>(), data.size() });
        if (!totalDigestLen) {
            throwCryptoError(lexicalGlobalObject, scope, ERR_get_error(), "Failed to finalize digest"_s);
            return {};
        }

        if (finalize)
            hash->m_finalized = true;
        hash->m_mdLen = std::min(len, totalDigestLen);
        hash->m_digest = ByteSource::allocated(data.release());

        RELEASE_AND_RETURN(scope, StringBytes::encode(lexicalGlobalObject, scope, std::span<const uint8_t> { reinterpret_cast<const uint8_t*>(hash->m_digest.data()), hash->m_mdLen }, encoding));
    }

    if (!hash->m_digest && len > 0) {
        auto data = hash->m_ctx.digestFinal(len);
        if (!data) {
            throwCryptoError(lexicalGlobalObject, scope, ERR_get_error(), "Failed to finalize digest"_s);
            return {};
        }
        // Some hash algorithms don't support calling EVP_DigestFinal_ex more than once, so cache it.
        hash->m_digest = ByteSource::allocated(data.release());
    }

    if (finalize)
        hash->m_finalized = true;
    RELEASE_AND_RETURN(scope, StringBytes::encode(lexicalGlobalObject, scope, std::span<const uint8_t> { reinterpret_cast<const uint8_t*>(hash->m_digest.data()), len }, encoding));
}

JSC_DEFINE_HOST_FUNCTION(jsHashProtoFuncDigest, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHash* hash = dynamicDowncast<JSHash>(callFrame->thisValue());
    if (!hash) [[unlikely]] {
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "Hash"_s);
    }
    if (hash->m_finalized) {
        return Bun::ERR::CRYPTO_HASH_FINALIZED(scope, lexicalGlobalObject);
    }

    JSC::JSValue encodingValue = callFrame->argument(0);
    BufferEncodingType encoding = BufferEncodingType::buffer;
    if (encodingValue.pureToBoolean() != TriState::False) {
        // this value needs to stringify if truthy
        // https://github.com/nodejs/node/blob/2a6f90813f4802def79f2df1bfe20e95df279abf/lib/internal/crypto/hash.js#L130
        WTF::String encodingString = encodingValue.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        encoding = parseEnumerationFromString<BufferEncodingType>(encodingString).value_or(BufferEncodingType::buffer);
    }

    RELEASE_AND_RETURN(scope, hashDigest(lexicalGlobalObject, hash, encoding, true));
}

// Transform hook: _transform(chunk, encoding, callback)
JSC_DEFINE_HOST_FUNCTION(jsHashProtoFuncTransform, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHash* hash = dynamicDowncast<JSHash>(callFrame->thisValue());
    if (!hash) [[unlikely]] {
        return Bun::ERR::INVALID_THIS(scope, globalObject, "Hash"_s);
    }
    if (hash->m_finalized) {
        return Bun::ERR::CRYPTO_HASH_FINALIZED(scope, globalObject);
    }
    hashUpdate(globalObject, hash, callFrame->argument(0), callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});

    JSValue callback = callFrame->argument(2);
    auto callData = JSC::getCallData(callback);
    if (callData.type == CallData::Type::None) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "callback"_s, "function"_s, callback);
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::profiledCall(globalObject, ProfilingReason::API, callback, callData, jsUndefined(), ArgList())));
}

// Transform hook: _flush(callback) — push the digest without marking the hash finalized,
// so hash.digest() still works once after the stream ends (as in Node).
JSC_DEFINE_HOST_FUNCTION(jsHashProtoFuncFlush, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSHash* hash = dynamicDowncast<JSHash>(thisValue);
    if (!hash) [[unlikely]] {
        return Bun::ERR::INVALID_THIS(scope, globalObject, "Hash"_s);
    }

    JSValue digest = JSValue::decode(hashDigest(globalObject, hash, BufferEncodingType::buffer, false));
    RETURN_IF_EXCEPTION(scope, {});

    JSValue push = hash->get(globalObject, Identifier::fromString(vm, "push"_s));
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

// Shared by the constructor and copy(): create a Hash for `md`/`zigHasher` (cloning `original`'s
// state when given), apply options.outputLength, and record `options` for LazyTransform.
static JSHash* createHash(JSGlobalObject* globalObject, Structure* structure, const EVP_MD* md, std::unique_ptr<ExternZigHash::Hasher, decltype(&ExternZigHash::destroy)> zigHasher, JSHash* original, JSValue optionsValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (md == nullptr && zigHasher == nullptr) [[unlikely]] {
        throwCryptoError(globalObject, scope, ERR_get_error(), "Digest method not supported"_s);
        return nullptr;
    }

    std::optional<unsigned int> xofLen = std::nullopt;
    if (optionsValue.isObject()) {
        JSValue outputLengthValue = optionsValue.get(globalObject, Identifier::fromString(vm, "outputLength"_s));
        RETURN_IF_EXCEPTION(scope, nullptr);

        if (!outputLengthValue.isUndefined()) {
            Bun::V::validateUint32(scope, globalObject, outputLengthValue, "options.outputLength"_s, jsUndefined());
            RETURN_IF_EXCEPTION(scope, nullptr);
            xofLen = outputLengthValue.toUInt32(globalObject);
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
    }

    JSHash* hash = JSHash::create(vm, structure);

    if (zigHasher) {
        if (!hash->initZig(globalObject, scope, zigHasher.release(), xofLen)) {
            throwCryptoError(globalObject, scope, ERR_get_error(), "Digest method not supported"_s);
            return nullptr;
        }
    } else {
        if (!hash->init(globalObject, scope, md, xofLen)) {
            throwCryptoError(globalObject, scope, ERR_get_error(), "Digest method not supported"_s);
            return nullptr;
        }
        if (original != nullptr && !original->m_ctx.copyTo(hash->m_ctx)) {
            throwCryptoError(globalObject, scope, ERR_get_error(), "Digest copy error"_s);
            return nullptr;
        }
    }

    // Transform is constructed lazily (see LazyTransform.h); it reads `this._options` then.
    if (!optionsValue.isUndefined())
        hash->putDirect(vm, Identifier::fromString(vm, "_options"_s), optionsValue);

    return hash;
}

// hash.copy([options]): a new Hash (always the base class, as in Node) with this hash's current state.
JSC_DEFINE_HOST_FUNCTION(jsHashProtoFuncCopy, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSHash* original = dynamicDowncast<JSHash>(callFrame->thisValue());
    if (!original) [[unlikely]] {
        return Bun::ERR::INVALID_THIS(scope, globalObject, "Hash"_s);
    }
    if (original->m_finalized) {
        return Bun::ERR::CRYPTO_HASH_FINALIZED(scope, globalObject);
    }

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    Structure* structure = zigGlobalObject->m_JSHashClassStructure.get(zigGlobalObject);

    const EVP_MD* md = nullptr;
    std::unique_ptr<ExternZigHash::Hasher, decltype(&ExternZigHash::destroy)> zigHasher(nullptr, ExternZigHash::destroy);
    if (original->m_zigHasher) {
        zigHasher.reset(ExternZigHash::getFromOther(zigGlobalObject, original->m_zigHasher));
    } else {
        md = original->m_ctx.getDigest();
    }

    JSHash* hash = createHash(globalObject, structure, md, WTF::move(zigHasher), original, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(hash);
}

// new Hash(algorithm[, options]) / Hash(algorithm[, options])
static EncodedJSValue constructOrCallHash(JSGlobalObject* globalObject, CallFrame* callFrame, JSValue newTarget)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSHashClassStructure.get(zigGlobalObject);
    if (newTarget && zigGlobalObject->m_JSHashClassStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->m_JSHashClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSValue algorithmValue = callFrame->argument(0);
    Bun::V::validateString(scope, globalObject, algorithmValue, "algorithm"_s);
    RETURN_IF_EXCEPTION(scope, {});
    WTF::String algorithm = algorithmValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    const EVP_MD* md = ncrypto::getDigestByName(algorithm);
    std::unique_ptr<ExternZigHash::Hasher, decltype(&ExternZigHash::destroy)> zigHasher(nullptr, ExternZigHash::destroy);
    if (!md) {
        zigHasher.reset(ExternZigHash::getByName(zigGlobalObject, algorithm));
    }

    JSHash* hash = createHash(globalObject, structure, md, WTF::move(zigHasher), nullptr, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(hash);
}

JSC_DEFINE_HOST_FUNCTION(constructHash, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return constructOrCallHash(globalObject, callFrame, callFrame->newTarget());
}

// Node's Hash is a plain function: calling it without `new` constructs anyway.
JSC_DEFINE_HOST_FUNCTION(callHash, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return constructOrCallHash(globalObject, callFrame, JSValue());
}

JSC::Structure* JSHashConstructor::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
}

void setupJSHashClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    // class Hash extends Transform (internal/streams/transform); see LazyTransform.h for the lazy part.
    JSObject* transform = transformConstructor(init.global);
    RELEASE_ASSERT(transform);
    JSValue transformPrototype = transform->getDirect(init.vm, init.vm.propertyNames->prototype);
    RELEASE_ASSERT(transformPrototype && transformPrototype.isObject());

    auto* prototypeStructure = JSHashPrototype::createStructure(init.vm, init.global, transformPrototype);
    auto* prototype = JSHashPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSHashConstructor::createStructure(init.vm, init.global, transform);
    auto* constructor = JSHashConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSHash::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
