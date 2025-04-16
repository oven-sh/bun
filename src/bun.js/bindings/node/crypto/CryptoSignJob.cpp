#include "CryptoSignJob.h"
#include "NodeValidator.h"
#include "KeyObject.h"

using namespace JSC;
using namespace ncrypto;
using namespace WebCore;

namespace Bun {

JSC_DEFINE_HOST_FUNCTION(jsVerifyOneShot, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSValue algorithmValue = callFrame->argument(0);
    JSValue dataValue = callFrame->argument(1);
    JSValue keyValue = callFrame->argument(2);
    JSValue signatureValue = callFrame->argument(3);
    JSValue callbackValue = callFrame->argument(4);

    auto ctx = SignJobCtx::fromJS(lexicalGlobalObject, scope, SignJobCtx::Mode::Verify, algorithmValue, dataValue, keyValue, signatureValue, callbackValue);
    RETURN_IF_EXCEPTION(scope, {});

    if (!callbackValue.isUndefined()) {
        SignJob::createAndSchedule(lexicalGlobalObject, WTFMove(*ctx), callbackValue);
        return JSValue::encode(jsUndefined());
    }

    ctx->runTask(lexicalGlobalObject);

    if (!ctx->m_verifyResult) {
        return ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "verify operation failed"_s);
    }

    return JSValue::encode(jsBoolean(*ctx->m_verifyResult));
}

JSC_DEFINE_HOST_FUNCTION(jsSignOneShot, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSValue algorithmValue = callFrame->argument(0);
    JSValue dataValue = callFrame->argument(1);
    JSValue keyValue = callFrame->argument(2);
    JSValue callbackValue = callFrame->argument(3);

    auto ctx = SignJobCtx::fromJS(lexicalGlobalObject, scope, SignJobCtx::Mode::Sign, algorithmValue, dataValue, keyValue, jsUndefined(), callbackValue);
    RETURN_IF_EXCEPTION(scope, {});

    if (!callbackValue.isUndefined()) {
        SignJob::createAndSchedule(lexicalGlobalObject, WTFMove(*ctx), callbackValue);
        return JSValue::encode(jsUndefined());
    }

    ctx->runTask(lexicalGlobalObject);

    if (!ctx->m_signResult) {
        return ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "sign operation failed"_s);
    }

    auto& result = ctx->m_signResult.value();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto sigBuf = ArrayBuffer::createUninitialized(result.size(), 1);
    memcpy(sigBuf->data(), result.data(), result.size());
    auto* signature = JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTFMove(sigBuf), 0, result.size());
    return JSValue::encode(signature);
}

extern "C" void Bun__SignJobCtx__deinit(SignJobCtx* ctx)
{
    ctx->deinit();
}
void SignJobCtx::deinit()
{
    delete this;
}

extern "C" void Bun__SignJobCtx__runTask(SignJobCtx* ctx, JSGlobalObject* globalObject)
{
    ctx->runTask(globalObject);
}
void SignJobCtx::runTask(JSGlobalObject* globalObject)
{
    ClearErrorOnReturn clearError;
    auto context = EVPMDCtxPointer::New();
    if (UNLIKELY(!context)) {
        return;
    }

    const auto& key = m_keyData->asymmetricKey;

    std::optional<EVP_PKEY_CTX*> ctx;
    switch (m_mode) {
    case Mode::Sign:
        ctx = context.signInit(key, m_digest);
        break;
    case Mode::Verify:
        ctx = context.verifyInit(key, m_digest);
        break;
    }

    if (!ctx) {
        return;
    }

    int32_t padding = m_padding.value_or(key.getDefaultSignPadding());

    if (key.isRsaVariant() && !EVPKeyCtxPointer::setRsaPadding(*ctx, padding, m_saltLength)) {
        return;
    }

    switch (m_mode) {
    case Mode::Sign: {
        auto dataBuf = ncrypto::Buffer<const uint8_t> {
            .data = m_data.data(),
            .len = m_data.size(),
        };

        if (key.isOneShotVariant()) {
            auto data = context.signOneShot(dataBuf);
            if (!data) {
                return;
            }

            m_signResult = ByteSource::allocated(data.release());
        } else {
            auto data = context.sign(dataBuf);
            if (!data) {
                return;
            }

            auto bs = ByteSource::allocated(data.release());

            if (key.isSigVariant() && m_dsaSigEnc == DSASigEnc::P1363) {
                uint32_t n = key.getBytesOfRS().value_or(NoDsaSignature);
                if (n == NoDsaSignature) {
                    return;
                }

                auto p1363Buffer = DataPointer::Alloc(n * 2);
                if (!p1363Buffer) {
                    return;
                }

                p1363Buffer.zero();

                ncrypto::Buffer<const uint8_t> sigBuf {
                    .data = reinterpret_cast<const uint8_t*>(bs.data()),
                    .len = bs.size(),
                };

                if (!ncrypto::extractP1363(sigBuf, reinterpret_cast<uint8_t*>(p1363Buffer.get()), n)) {
                    return;
                }

                m_signResult = ByteSource::allocated(p1363Buffer.release());
            } else {
                m_signResult = WTFMove(bs);
            }
        }
        break;
    }
    case Mode::Verify: {
        auto dataBuf = ncrypto::Buffer<const uint8_t> {
            .data = m_data.data(),
            .len = m_data.size(),
        };
        auto sigBuf = ncrypto::Buffer<const uint8_t> {
            .data = m_signature.data(),
            .len = m_signature.size(),
        };
        m_verifyResult = context.verify(dataBuf, sigBuf);
        break;
    }
    }
}

extern "C" void Bun__SignJobCtx__runFromJS(SignJobCtx* ctx, JSGlobalObject* globalObject, EncodedJSValue callback)
{
    ctx->runFromJS(globalObject, JSValue::decode(callback));
}
void SignJobCtx::runFromJS(JSGlobalObject* lexicalGlobalObject, JSValue callback)
{
    switch (m_mode) {
    case Mode::Sign: {
        if (!m_signResult) {
            auto* err = createError(lexicalGlobalObject, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "sign operation failed"_s);
            Bun__EventLoop__runCallback1(lexicalGlobalObject, JSValue::encode(callback), JSValue::encode(jsUndefined()), JSValue::encode(err));
            return;
        }

        auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

        auto sigBuf = ArrayBuffer::createUninitialized(m_signResult->size(), 1);
        memcpy(sigBuf->data(), m_signResult->data(), m_signResult->size());
        auto* signature = JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTFMove(sigBuf), 0, m_signResult->size());

        Bun__EventLoop__runCallback2(
            lexicalGlobalObject,
            JSValue::encode(callback),
            JSValue::encode(jsUndefined()),
            JSValue::encode(jsNull()),
            JSValue::encode(signature));

        break;
    }
    case Mode::Verify: {
        if (!m_verifyResult) {
            auto* err = createError(lexicalGlobalObject, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "verify operation failed"_s);
            Bun__EventLoop__runCallback1(lexicalGlobalObject, JSValue::encode(callback), JSValue::encode(jsUndefined()), JSValue::encode(err));
            return;
        }

        Bun__EventLoop__runCallback2(
            lexicalGlobalObject,
            JSValue::encode(callback),
            JSValue::encode(jsUndefined()),
            JSValue::encode(jsNull()),
            JSValue::encode(jsBoolean(*m_verifyResult)));
        break;
    }
    }
}

extern "C" SignJob* Bun__SignJob__create(JSGlobalObject* globalObject, SignJobCtx* ctx, EncodedJSValue callback);
SignJob* SignJob::create(JSGlobalObject* globalObject, SignJobCtx&& ctx, JSValue callback)
{
    SignJobCtx* ctxCopy = new SignJobCtx(WTFMove(ctx));
    return Bun__SignJob__create(globalObject, ctxCopy, JSValue::encode(callback));
}

extern "C" void Bun__SignJob__schedule(SignJob* job);
void SignJob::schedule()
{
    Bun__SignJob__schedule(this);
}

extern "C" void Bun__SignJob__createAndSchedule(JSGlobalObject* globalObject, SignJobCtx* ctx, EncodedJSValue callback);
void SignJob::createAndSchedule(JSGlobalObject* globalObject, SignJobCtx&& ctx, JSValue callback)
{
    SignJobCtx* ctxCopy = new SignJobCtx(WTFMove(ctx));
    Bun__SignJob__createAndSchedule(globalObject, ctxCopy, JSValue::encode(callback));
}

// maybe replace other getArrayBufferOrView
GCOwnedDataScope<std::span<const uint8_t>> getArrayBufferOrView2(JSGlobalObject* globalObject, ThrowScope& scope, JSValue dataValue, ASCIILiteral argName, JSValue encodingValue)
{
    using Return = GCOwnedDataScope<std::span<const uint8_t>>;

    if (auto* view = jsDynamicCast<JSArrayBufferView*>(dataValue)) {
        return { view, view->span() };
    }

    if (auto* arrayBuffer = jsDynamicCast<JSArrayBuffer*>(dataValue)) {
        return { arrayBuffer, arrayBuffer->impl()->span() };
    }

    if (dataValue.isString()) {
        auto* str = dataValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, Return(nullptr, {}));
        auto strView = str->view(globalObject);
        RETURN_IF_EXCEPTION(scope, Return(nullptr, {}));

        BufferEncodingType encoding = BufferEncodingType::utf8;
        if (encodingValue.isString()) {
            auto* encodingString = encodingValue.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, Return(nullptr, {}));
            auto encodingView = encodingString->view(globalObject);
            RETURN_IF_EXCEPTION(scope, Return(nullptr, {}));

            if (encodingView != "buffer"_s) {
                encoding = parseEnumerationFromView<BufferEncodingType>(encodingView).value_or(BufferEncodingType::utf8);
                RETURN_IF_EXCEPTION(scope, Return(nullptr, {}));
            }
        }

        JSValue buffer = JSValue::decode(WebCore::constructFromEncoding(globalObject, strView, encoding));
        RETURN_IF_EXCEPTION(scope, Return(nullptr, {}));

        if (auto* view = jsDynamicCast<JSArrayBufferView*>(buffer)) {
            return { view, view->span() };
        }
    }

    ERR::INVALID_ARG_TYPE(scope, globalObject, argName, "string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView"_s, dataValue);
    return Return(nullptr, {});
}

std::optional<int32_t> getPadding(JSGlobalObject* globalObject, ThrowScope& scope, JSValue options)
{
    return getIntOption(globalObject, scope, options, "padding"_s);
}

std::optional<SignJobCtx> SignJobCtx::fromJS(JSGlobalObject* globalObject, ThrowScope& scope, Mode mode,
    JSValue algorithmValue, JSValue dataValue, JSValue keyValue, JSValue signatureValue, JSValue callbackValue)
{
    if (!algorithmValue.isUndefinedOrNull()) {
        V::validateString(scope, globalObject, algorithmValue, "algorithm"_s);
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (!callbackValue.isUndefined()) {
        V::validateFunction(scope, globalObject, callbackValue, "callback"_s);
        RETURN_IF_EXCEPTION(scope, {});
    }

    auto dataView = getArrayBufferOrView2(globalObject, scope, dataValue, "data"_s, jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});

    Vector<uint8_t> data;
    data.append(std::span { dataView->data(), dataView->size() });

    if (mode == Mode::Sign) {
        if (keyValue.pureToBoolean() == TriState::False) {
            ERR::CRYPTO_SIGN_KEY_REQUIRED(scope, globalObject);
            return std::nullopt;
        }
    }

    auto padding = getPadding(globalObject, scope, keyValue);
    RETURN_IF_EXCEPTION(scope, {});
    auto pssSaltLength = getSaltLength(globalObject, scope, keyValue);
    RETURN_IF_EXCEPTION(scope, {});
    auto dsaSigEnc = getDSASigEnc(globalObject, scope, keyValue);
    RETURN_IF_EXCEPTION(scope, {});

    Vector<uint8_t> signature;
    if (mode == Mode::Verify) {
        if (auto* view = jsDynamicCast<JSArrayBufferView*>(signatureValue)) {
            signature.append(view->span());
        } else {
            ERR::INVALID_ARG_INSTANCE(scope, globalObject, "signature"_s, "Buffer, TypedArray, or DataView"_s, signatureValue);
        }
    }

    auto prepareResult = mode == Mode::Verify
        ? KeyObject::preparePublicOrPrivateKey(globalObject, scope, keyValue)
        : KeyObject::preparePrivateKey(globalObject, scope, keyValue);
    RETURN_IF_EXCEPTION(scope, {});

    ClearErrorOnReturn clearError;
    auto keyType = mode == Mode::Verify
        ? CryptoKeyType::Public
        : CryptoKeyType::Private;

    KeyObject keyObject;

    if (prepareResult.keyData) {
        keyObject = KeyObject::create(keyType, WTFMove(*prepareResult.keyData));
    } else {

        keyObject = KeyObject::getPublicOrPrivateKey(
            globalObject,
            scope,
            prepareResult.keyDataView,
            keyType,
            prepareResult.formatType,
            prepareResult.encodingType,
            prepareResult.cipher,
            WTFMove(prepareResult.passphrase));
    }

    Digest digest = {};

    if (!algorithmValue.isUndefinedOrNull()) {
        auto* algorithmString = algorithmValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto algorithmView = algorithmString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        digest = Digest::FromName(algorithmView);
        if (!digest) {
            ERR::CRYPTO_INVALID_DIGEST(scope, globalObject, algorithmView);
            return {};
        }
    }

    if (mode == Mode::Verify) {

        return SignJobCtx(
            mode,
            keyObject.data(),
            WTFMove(data),
            digest,
            padding,
            pssSaltLength,
            dsaSigEnc,
            WTFMove(signature));
    }

    return SignJobCtx(
        mode,
        keyObject.data(),
        WTFMove(data),
        digest,
        padding,
        pssSaltLength,
        dsaSigEnc);
}

} // namespace Bun
