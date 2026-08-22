#include "JSHashPrototype.h"
#include "JSHash.h"
#include "LazyTransform.h"
#include "CryptoUtil.h"
#include "ErrorCode.h"
#include "NodeValidator.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSCInlines.h>
#include <openssl/evp.h>

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

const ClassInfo JSHashPrototype::s_info = { "Hash"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHashPrototype) };

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

} // namespace Bun
