#include "CryptoSignJob.h"
#include "NodeValidator.h"
#include "KeyObject.h"
#include "JSVerify.h"

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
        throwCryptoError(lexicalGlobalObject, scope, ctx->m_opensslError, "verify operation failed"_s);
        return JSValue::encode({});
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
        throwCryptoError(lexicalGlobalObject, scope, ctx->m_opensslError, "sign operation failed"_s);
        return JSValue::encode({});
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
    if (!context) [[unlikely]] {
        m_opensslError = ERR_get_error();
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
        m_opensslError = ERR_get_error();
        return;
    }

    int32_t padding = m_padding.value_or(key.getDefaultSignPadding());

    if (key.isRsaVariant() && !EVPKeyCtxPointer::setRsaPadding(*ctx, padding, m_saltLength)) {
        m_opensslError = ERR_get_error();
        return;
    }

    switch (m_mode) {
    case Mode::Sign: {
        auto dataBuf = ncrypto::Buffer<const uint8_t> {
            .data = m_data.begin(),
            .len = m_data.size(),
        };

        if (key.isOneShotVariant()) {
            auto data = context.signOneShot(dataBuf);
            if (!data) {
                m_opensslError = ERR_get_error();
                return;
            }

            m_signResult = ByteSource::allocated(data.release());
        } else {
            auto data = context.sign(dataBuf);
            if (!data) {
                m_opensslError = ERR_get_error();
                return;
            }

            auto bs = ByteSource::allocated(data.release());

            if (key.isSigVariant() && m_dsaSigEnc == DSASigEnc::P1363) {
                uint32_t n = key.getBytesOfRS().value_or(NoDsaSignature);
                if (n == NoDsaSignature) {
                    m_opensslError = ERR_get_error();
                    return;
                }

                auto p1363Buffer = DataPointer::Alloc(n * 2);
                if (!p1363Buffer) {
                    m_opensslError = ERR_get_error();
                    return;
                }

                p1363Buffer.zero();

                ncrypto::Buffer<const uint8_t> sigBuf {
                    .data = reinterpret_cast<const uint8_t*>(bs.data()),
                    .len = bs.size(),
                };

                if (!ncrypto::extractP1363(sigBuf, reinterpret_cast<uint8_t*>(p1363Buffer.get()), n)) {
                    m_opensslError = ERR_get_error();
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
            .data = m_data.begin(),
            .len = m_data.size(),
        };
        auto sigBuf = ncrypto::Buffer<const uint8_t> {
            .data = m_signature.begin(),
            .len = m_signature.size(),
        };
        m_verifyResult = context.verify(dataBuf, sigBuf);
        if (!m_verifyResult.has_value()) {
            m_opensslError = ERR_get_error();
        }
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
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    switch (m_mode) {
    case Mode::Sign: {
        if (!m_signResult) {
            JSValue err = createCryptoError(lexicalGlobalObject, scope, m_opensslError, "sign operation failed"_s);
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
            JSValue err = createCryptoError(lexicalGlobalObject, scope, m_opensslError, "verify operation failed"_s);
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

    GCOwnedDataScope<std::span<const uint8_t>> signatureView = { nullptr, {} };
    if (mode == Mode::Verify) {
        signatureView = getArrayBufferOrView2(globalObject, scope, signatureValue, "signature"_s, jsUndefined(), true);
        RETURN_IF_EXCEPTION(scope, {});
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
        RETURN_IF_EXCEPTION(scope, {});
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
        Vector<uint8_t> signature;
        if (keyObject.asymmetricKey().isSigVariant() && dsaSigEnc == DSASigEnc::P1363) {
            convertP1363ToDER(
                ncrypto::Buffer<const uint8_t> {
                    .data = signatureView->data(),
                    .len = signatureView->size(),
                },
                keyObject.asymmetricKey(),
                signature);
        } else {
            signature.append(std::span { signatureView->data(), signatureView->size() });
        }

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
