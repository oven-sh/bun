#include "CryptoHkdf.h"
#include "NodeValidator.h"
#include "CryptoUtil.h"
#include "JSCryptoKey.h"
#include "CryptoKey.h"
#include "JSBuffer.h"
#include "ErrorCode.h"
#include "BunString.h"
#include "JSKeyObject.h"

using namespace JSC;
using namespace WebCore;
using namespace ncrypto;

namespace Bun {

HkdfJobCtx::HkdfJobCtx(Digest digest, size_t length, RefPtr<KeyObjectData>&& keyData, ByteSource&& key, ByteSource&& info, ByteSource&& salt)
    : m_digest(digest)
    , m_length(length)
    , m_keyData(WTF::move(keyData))
    , m_key(WTF::move(key))
    , m_info(WTF::move(info))
    , m_salt(WTF::move(salt))
{
}

HkdfJobCtx::HkdfJobCtx(HkdfJobCtx&& other)
    : m_digest(other.m_digest)
    , m_length(other.m_length)
    , m_keyData(WTF::move(other.m_keyData))
    , m_key(WTF::move(other.m_key))
    , m_info(WTF::move(other.m_info))
    , m_salt(WTF::move(other.m_salt))
    , m_result(WTF::move(other.m_result))
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
    auto dp = ncrypto::hkdf(m_digest, m_key, m_info, m_salt, m_length);

    if (!dp) {
        // indicate an error with m_result == std::nullopt
        return;
    }

    m_result = ByteSource::allocated(dp.release());
}

extern "C" void Bun__HkdfJobCtx__runFromJS(HkdfJobCtx* ctx, JSGlobalObject* lexicalGlobalObject, JSCallbackArgs* out)
{
    *out = ctx->runFromJS(lexicalGlobalObject);
}
JSCallbackArgs HkdfJobCtx::runFromJS(JSGlobalObject* lexicalGlobalObject)
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!m_result) {
        JSObject* err = createError(lexicalGlobalObject, "HKDF derivation failed"_s);
        RETURN_IF_EXCEPTION(scope, {});
        return { err };
    }

    auto& result = m_result.value();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    RefPtr<ArrayBuffer> buf = ArrayBuffer::tryCreateUninitialized(result.size(), 1);
    if (!buf) {
        JSObject* err = createOutOfMemoryError(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        return { err };
    }

    memcpy(buf->data(), result.data(), result.size());

    JSValue resultBuffer = JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(), buf.releaseNonNull());
    RETURN_IF_EXCEPTION(scope, {});
    return { jsNull(), resultBuffer };
}

extern "C" void Bun__HkdfJobCtx__deinit(HkdfJobCtx* ctx)
{
    ctx->deinit();
}
void HkdfJobCtx::deinit()
{
    delete this;
}

extern "C" void Bun__HkdfJob__createAndSchedule(JSGlobalObject* globalObject, HkdfJobCtx* ctx, EncodedJSValue callback);
void HkdfJob::createAndSchedule(JSGlobalObject* globalObject, HkdfJobCtx&& ctx, JSValue callback)
{
    HkdfJobCtx* ctxCopy = new HkdfJobCtx(WTF::move(ctx));
    return Bun__HkdfJob__createAndSchedule(globalObject, ctxCopy, JSValue::encode(callback));
}

// An ikm that is a KeyObject goes to `keyData`. Any other ikm is returned, not copied.
static BorrowedBytes prepareKey(JSGlobalObject* globalObject, ThrowScope& scope, JSValue key, RefPtr<KeyObjectData>& keyData)
{
    if (JSKeyObject* keyObject = dynamicDowncast<JSKeyObject>(key)) {
        auto& handle = keyObject->handle();
        if (handle.type() != CryptoKeyType::Secret) {
            ERR::CRYPTO_INVALID_KEY_OBJECT_TYPE(scope, globalObject, handle.type(), "secret"_s);
            return {};
        }
        keyData = handle.data();
        return {};
    }

    if (key.isString()) {
        JSString* keyString = key.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto keyView = keyString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        JSValue buffer = JSValue::decode(WebCore::constructFromEncoding(globalObject, keyView, BufferEncodingType::utf8));
        RETURN_IF_EXCEPTION(scope, {});
        return uncheckedDowncast<JSC::JSArrayBufferView>(buffer);
    }

    if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(key))
        return view;

    if (auto* buf = dynamicDowncast<JSC::JSArrayBuffer>(key))
        return buf;

    ERR::INVALID_ARG_TYPE(scope, globalObject, "ikm"_s, "string or an instance of SecretKeyObject, ArrayBuffer, TypedArray, DataView, or Buffer"_s, key);
    return {};
}

static BorrowedBytes borrowBufferOrString(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, JSValue value, ASCIILiteral name)
{
    if (value.isString()) {
        JSString* str = value.toString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        GCOwnedDataScope<WTF::StringView> view = str->view(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto utf8 = UTF8View::tryCreate(lexicalGlobalObject, scope, view);
        RETURN_IF_EXCEPTION(scope, {});
        return BorrowedBytes(str, WTF::move(*utf8));
    }
    if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(value))
        return view;
    if (auto* buf = dynamicDowncast<JSArrayBuffer>(value))
        return buf;
    ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, name, "string, ArrayBuffer, TypedArray, Buffer"_s, value);
    return {};
}

std::optional<HkdfJobCtx> HkdfJobCtx::fromJS(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame, ThrowScope& scope, Mode mode, Inputs& inputs)
{
    JSValue hashValue = callFrame->argument(0);
    JSValue keyValue = callFrame->argument(1);
    JSValue saltValue = callFrame->argument(2);
    JSValue infoValue = callFrame->argument(3);
    JSValue lengthValue = callFrame->argument(4);

    V::validateString(scope, lexicalGlobalObject, hashValue, "digest"_s);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    RefPtr<KeyObjectData> keyData;
    inputs.key = prepareKey(lexicalGlobalObject, scope, keyValue, keyData);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    inputs.salt = borrowBufferOrString(lexicalGlobalObject, scope, saltValue, "salt"_s);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    inputs.info = borrowBufferOrString(lexicalGlobalObject, scope, infoValue, "info"_s);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    int32_t length = 0;
    V::validateInteger(scope, lexicalGlobalObject, lengthValue, "length"_s, jsNumber(0), jsNumber(Bun::Buffer::kMaxLength), &length);
    RETURN_IF_EXCEPTION(scope, std::nullopt);

    // No user JS runs from here on, so the bytes of the arguments cannot change.
    size_t infoSize = inputs.info.span().size();
    if (infoSize > 1024) {
        ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "info"_s, "must not contain more than 1024 bytes"_s, jsNumber(infoSize));
        return std::nullopt;
    }

    if (mode == Mode::Async) {
        V::validateFunction(scope, lexicalGlobalObject, callFrame->argument(5), "callback"_s);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
    }

    WTF::String hashString = hashValue.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    Digest hash = Digest::FromName(hashString);
    if (!hash) {
        ERR::CRYPTO_INVALID_DIGEST(scope, lexicalGlobalObject, hashString);
        return std::nullopt;
    }

    // Like Node: after the digest, and a KeyObject ikm has no limit.
    if (inputs.key.isTooBig()) [[unlikely]] {
        ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "key is too big"_s);
        return std::nullopt;
    }
    if (inputs.salt.isTooBig()) [[unlikely]] {
        ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "salt is too big"_s);
        return std::nullopt;
    }

    if (!ncrypto::checkHkdfLength(hash, length)) {
        ERR::CRYPTO_INVALID_KEYLEN(scope, lexicalGlobalObject);
        return std::nullopt;
    }

    bool ownsBytes = mode == Mode::Async;
    auto key = inputs.key.toByteSource(ownsBytes);
    auto salt = inputs.salt.toByteSource(ownsBytes);
    auto info = inputs.info.toByteSource(ownsBytes);
    if (!key || !salt || !info) [[unlikely]] {
        throwOutOfMemoryError(lexicalGlobalObject, scope);
        return std::nullopt;
    }
    if (keyData) {
        auto bytes = keyData->symmetricKey.span();
        key = ByteSource::foreign(bytes.data(), bytes.size());
    }

    return HkdfJobCtx(hash, length, WTF::move(keyData), WTF::move(*key), WTF::move(*info), WTF::move(*salt));
}

JSC_DEFINE_HOST_FUNCTION(jsHkdf, (JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    HkdfJobCtx::Inputs inputs;
    std::optional<HkdfJobCtx> ctx = HkdfJobCtx::fromJS(lexicalGlobalObject, callFrame, scope, HkdfJobCtx::Mode::Async, inputs);
    RETURN_IF_EXCEPTION(scope, {});

    HkdfJob::createAndSchedule(lexicalGlobalObject, WTF::move(ctx.value()), callFrame->argument(5));

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHkdfSync, (JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // The ctx reads the bytes that `inputs` keeps alive, so `inputs` outlives runTask.
    HkdfJobCtx::Inputs inputs;
    std::optional<HkdfJobCtx> ctx = HkdfJobCtx::fromJS(lexicalGlobalObject, callFrame, scope, HkdfJobCtx::Mode::Sync, inputs);
    RETURN_IF_EXCEPTION(scope, {});

    ctx->runTask(lexicalGlobalObject);

    if (!ctx->m_result.has_value()) {
        return throwVMError(lexicalGlobalObject, scope, "HKDF derivation failed"_s);
    }

    auto& result = ctx->m_result.value();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    RefPtr<ArrayBuffer> buf = JSC::ArrayBuffer::tryCreateUninitialized(result.size(), 1);
    if (!buf) {
        throwOutOfMemoryError(lexicalGlobalObject, scope);
        return {};
    }

    memcpy(buf->data(), result.data(), result.size());

    return JSValue::encode(JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(), buf.releaseNonNull()));
}

} // namespace Bun
