#include "CryptoHkdf.h"
#include "NodeValidator.h"
#include "CryptoUtil.h"
#include "KeyObject.h"
#include "JSCryptoKey.h"
#include "CryptoKey.h"
#include "AsymmetricKeyValue.h"
#include "JSBuffer.h"
#include "ErrorCode.h"
#include "BunString.h"

using namespace JSC;
using namespace Bun;
using namespace WebCore;
using namespace ncrypto;

HkdfJobCtx::HkdfJobCtx(Digest digest, size_t length, WTF::Vector<uint8_t>&& key, WTF::Vector<uint8_t>&& info, WTF::Vector<uint8_t>&& salt)
    : m_digest(digest)
    , m_length(length)
    , m_key(WTFMove(key))
    , m_info(WTFMove(info))
    , m_salt(WTFMove(salt))
{
}

HkdfJobCtx::HkdfJobCtx(HkdfJobCtx&& other)
    : m_digest(other.m_digest)
    , m_length(other.m_length)
    , m_key(WTFMove(other.m_key))
    , m_info(WTFMove(other.m_info))
    , m_salt(WTFMove(other.m_salt))
    , m_result(WTFMove(other.m_result))
{
}

HkdfJobCtx::~HkdfJobCtx()
{
}

extern "C" void Bun__HkdfJobCtx__runTask(HkdfJobCtx* ctx, JSGlobalObject* lexicalGlobalObject)
{
    ctx->runTask(lexicalGlobalObject);
}
void HkdfJobCtx::runTask(JSGlobalObject* lexicalGlobalObject)
{
    auto keyBuf = ncrypto::Buffer<const unsigned char> {
        .data = m_key.data(),
        .len = m_key.size(),
    };
    auto infoBuf = ncrypto::Buffer<const unsigned char> {
        .data = m_info.data(),
        .len = m_info.size(),
    };
    auto saltBuf = ncrypto::Buffer<const unsigned char> {
        .data = m_salt.data(),
        .len = m_salt.size(),
    };
    auto dp = ncrypto::hkdf(m_digest, keyBuf, infoBuf, saltBuf, m_length);

    if (!dp) {
        // indicate an error with m_result == std::nullopt
        return;
    }

    m_result = ByteSource::allocated(dp.release());
}

extern "C" void Bun__HkdfJobCtx__runFromJS(HkdfJobCtx* ctx, JSGlobalObject* lexicalGlobalObject, EncodedJSValue callback)
{
    ctx->runFromJS(lexicalGlobalObject, JSValue::decode(callback));
}
void HkdfJobCtx::runFromJS(JSGlobalObject* lexicalGlobalObject, JSValue callback)
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!m_result) {
        JSObject* err = createError(lexicalGlobalObject, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "hkdf operation failed"_s);
        Bun__EventLoop__runCallback1(lexicalGlobalObject, JSValue::encode(callback), JSValue::encode(jsUndefined()), JSValue::encode(err));
        return;
    }

    auto& result = m_result.value();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    RefPtr<ArrayBuffer> buf = ArrayBuffer::tryCreateUninitialized(result.size(), 1);
    if (!buf) {
        JSObject* err = createOutOfMemoryError(lexicalGlobalObject);
        Bun__EventLoop__runCallback1(lexicalGlobalObject, JSValue::encode(callback), JSValue::encode(jsUndefined()), JSValue::encode(err));
        return;
    }

    memcpy(buf->data(), result.data(), result.size());

    Bun__EventLoop__runCallback2(lexicalGlobalObject,
        JSValue::encode(callback),
        JSValue::encode(jsUndefined()),
        JSValue::encode(jsUndefined()),
        JSValue::encode(JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(), buf.releaseNonNull())));
}

extern "C" void Bun__HkdfJobCtx__deinit(HkdfJobCtx* ctx)
{
    ctx->deinit();
}
void HkdfJobCtx::deinit()
{
    delete this;
}

extern "C" HkdfJob* Bun__HkdfJob__create(JSGlobalObject* globalObject, HkdfJobCtx* ctx, EncodedJSValue callback);
HkdfJob* HkdfJob::create(JSGlobalObject* globalObject, HkdfJobCtx&& ctx, JSValue callback)
{
    HkdfJobCtx* ctxCopy = new HkdfJobCtx(WTFMove(ctx));
    return Bun__HkdfJob__create(globalObject, ctxCopy, JSValue::encode(callback));
}

extern "C" void Bun__HkdfJob__schedule(HkdfJob* job);
void HkdfJob::schedule()
{
    Bun__HkdfJob__schedule(this);
}

extern "C" void Bun__HkdfJob__createAndSchedule(JSGlobalObject* globalObject, HkdfJobCtx* ctx, EncodedJSValue callback);
void HkdfJob::createAndSchedule(JSGlobalObject* globalObject, HkdfJobCtx&& ctx, JSValue callback)
{
    HkdfJobCtx* ctxCopy = new HkdfJobCtx(WTFMove(ctx));
    return Bun__HkdfJob__createAndSchedule(globalObject, ctxCopy, JSValue::encode(callback));
}

// similar to prepareSecretKey
void prepareKey(JSGlobalObject* globalObject, ThrowScope& scope, Vector<uint8_t>& out, JSValue key)
{
    VM& vm = globalObject->vm();

    // Handle KeyObject (if not bufferOnly)
    if (key.isObject()) {
        JSObject* obj = key.getObject();
        auto& names = WebCore::builtinNames(vm);

        // Check for BunNativePtr on the object
        if (auto val = obj->getIfPropertyExists(globalObject, names.bunNativePtrPrivateName())) {
            if (auto* cryptoKey = jsDynamicCast<JSCryptoKey*>(val.asCell())) {

                JSValue typeValue = obj->get(globalObject, vm.propertyNames->type);
                RETURN_IF_EXCEPTION(scope, );

                auto wrappedKey = cryptoKey->protectedWrapped();

                if (!typeValue.isString()) {
                    Bun::ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, typeValue, "secret"_s);
                    return;
                }

                WTF::String typeString = typeValue.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, );

                if (wrappedKey->type() != CryptoKeyType::Secret || typeString != "secret"_s) {
                    Bun::ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, typeValue, "secret"_s);
                    return;
                }

                auto keyData = getSymmetricKey(wrappedKey);

                if (UNLIKELY(!keyData)) {
                    Bun::ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, typeValue, "secret"_s);
                    return;
                }

                out.append(keyData.value());
                return;
            }
        }
    }

    // Handle string or buffer
    if (key.isString()) {
        JSString* keyString = key.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, );

        auto keyView = keyString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, );

        JSValue buffer = JSValue::decode(WebCore::constructFromEncoding(globalObject, keyView, WebCore::BufferEncodingType::utf8));
        auto* view = jsDynamicCast<JSC::JSArrayBufferView*>(buffer);
        out.append(view->span());
        return;
    }

    // Handle ArrayBuffer types
    if (auto* view = jsDynamicCast<JSC::JSArrayBufferView*>(key)) {
        out.append(view->span());
        return;
    }

    if (auto* buf = jsDynamicCast<JSC::JSArrayBuffer*>(key)) {
        out.append(buf->impl()->span());
        return;
    }

    // If we got here, the key is not a valid type
    WTF::String expectedTypes
        = "string, SecretKeyObject, ArrayBuffer, TypedArray, DataView, or Buffer"_s;
    Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "ikm"_s, expectedTypes, key);
}

void copyBufferOrString(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, JSValue value, const WTF::ASCIILiteral& name, WTF::Vector<uint8_t>& buffer)
{
    if (value.isString()) {
        JSString* str = value.toString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, );
        GCOwnedDataScope<WTF::StringView> view = str->view(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, );
        UTF8View utf8(view);
        buffer.append(utf8.span());
    } else if (auto* view = jsDynamicCast<JSC::JSArrayBufferView*>(value)) {
        buffer.append(view->span());
    } else if (auto* buf = jsDynamicCast<JSArrayBuffer*>(value)) {
        buffer.append(buf->impl()->span());
    } else {
        ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, name, "string, ArrayBuffer, TypedArray, Buffer"_s, value);
    }
}

std::optional<HkdfJobCtx> HkdfJobCtx::fromJS(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame, ThrowScope& scope, Mode mode)
{
    JSValue hashValue = callFrame->argument(0);
    JSValue keyValue = callFrame->argument(1);
    JSValue saltValue = callFrame->argument(2);
    JSValue infoValue = callFrame->argument(3);
    JSValue lengthValue = callFrame->argument(4);

    V::validateString(scope, lexicalGlobalObject, hashValue, "digest"_s);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    // TODO(dylan-conway): All of these don't need to copy for sync mode

    WTF::Vector<uint8_t> keyData;
    prepareKey(lexicalGlobalObject, scope, keyData, keyValue);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    WTF::Vector<uint8_t> salt;
    copyBufferOrString(lexicalGlobalObject, scope, saltValue, "salt"_s, salt);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    WTF::Vector<uint8_t> info;
    copyBufferOrString(lexicalGlobalObject, scope, infoValue, "info"_s, info);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    int32_t length = 0;
    V::validateInteger(scope, lexicalGlobalObject, lengthValue, "length"_s, jsNumber(0), jsNumber(Bun::Buffer::kMaxLength), &length);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    if (info.size() > 1024) {
        ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "info"_s, "must not contain more than 1024 bytes"_s, jsNumber(info.size()));
        return std::nullopt;
    }

    WTF::String hashString = hashValue.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    Digest hash = Digest::FromName(hashString);
    if (!hash) {
        ERR::CRYPTO_INVALID_DIGEST(scope, lexicalGlobalObject, hashString);
        return std::nullopt;
    }

    if (!ncrypto::checkHkdfLength(hash, length)) {
        ERR::CRYPTO_INVALID_KEYLEN(scope, lexicalGlobalObject);
        return std::nullopt;
    }

    return HkdfJobCtx(hash, length, WTFMove(keyData), WTFMove(info), WTFMove(salt));
}

JSC_DEFINE_HOST_FUNCTION(jsHkdf, (JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    std::optional<HkdfJobCtx> ctx = HkdfJobCtx::fromJS(lexicalGlobalObject, callFrame, scope, HkdfJobCtx::Mode::Async);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    JSValue callback = callFrame->argument(5);
    V::validateFunction(scope, lexicalGlobalObject, callback, "callback"_s);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    HkdfJob::createAndSchedule(lexicalGlobalObject, WTFMove(ctx.value()), callback);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHkdfSync, (JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    std::optional<HkdfJobCtx> ctx = HkdfJobCtx::fromJS(lexicalGlobalObject, callFrame, scope, HkdfJobCtx::Mode::Sync);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    ctx->runTask(lexicalGlobalObject);

    if (!ctx->m_result.has_value()) {
        return ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "hkdf operation failed"_s);
    }

    auto& result = ctx->m_result.value();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    RefPtr<ArrayBuffer> buf = JSC::ArrayBuffer::tryCreateUninitialized(result.size(), 1);
    if (!buf) {
        throwOutOfMemoryError(lexicalGlobalObject, scope);
        return JSValue::encode({});
    }

    memcpy(buf->data(), result.data(), result.size());

    return JSValue::encode(JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(), buf.releaseNonNull()));
}
