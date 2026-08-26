#include "CryptoKemJob.h"
#include "NodeValidator.h"
#include "JSKeyObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/ObjectConstructor.h>

using namespace JSC;
using namespace ncrypto;

namespace Bun {

extern "C" void Bun__KemJobCtx__deinit(KemJobCtx* ctx)
{
    ctx->deinit();
}
void KemJobCtx::deinit()
{
    delete this;
}

extern "C" void Bun__KemJobCtx__runTask(KemJobCtx* ctx, JSGlobalObject* globalObject)
{
    ctx->runTask(globalObject);
}
void KemJobCtx::runTask(JSGlobalObject* globalObject)
{
    // A failed operation must not leave its OpenSSL errors on the thread's error queue, where a
    // later unrelated operation would pick them up.
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;

    switch (m_mode) {
    case Mode::Encapsulate: {
        auto result = KEM::Encapsulate(m_key->asymmetricKey);
        if (!result) {
            return;
        }
        m_ciphertextResult = ByteSource::allocated(result->ciphertext.release());
        m_sharedKeyResult = ByteSource::allocated(result->shared_key.release());
        break;
    }
    case Mode::Decapsulate: {
        ncrypto::Buffer<const void> ciphertext {
            .data = m_ciphertext.span().data(),
            .len = m_ciphertext.size(),
        };
        auto sharedKey = KEM::Decapsulate(m_key->asymmetricKey, ciphertext);
        if (!sharedKey) {
            return;
        }
        m_sharedKeyResult = ByteSource::allocated(sharedKey.release());
        break;
    }
    }
}

extern "C" void Bun__KemJobCtx__runFromJS(KemJobCtx* ctx, JSGlobalObject* globalObject, JSCallbackArgs* out)
{
    *out = ctx->runFromJS(globalObject);
}
JSCallbackArgs KemJobCtx::runFromJS(JSGlobalObject* lexicalGlobalObject)
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    if (!m_sharedKeyResult) {
        // Node reports an asynchronous KEM failure as a plain Error with this exact message
        // (the shared DeriveBitsJob completion path in src/crypto/crypto_util.h).
        JSObject* err = JSC::createError(lexicalGlobalObject, "Deriving bits failed"_s);
        return { err };
    }

    JSValue sharedKey = WebCore::createBuffer(lexicalGlobalObject, m_sharedKeyResult.span());
    RETURN_IF_EXCEPTION(scope, {});

    if (m_mode == Mode::Encapsulate) {
        JSValue ciphertext = WebCore::createBuffer(lexicalGlobalObject, m_ciphertextResult.span());
        RETURN_IF_EXCEPTION(scope, {});
        JSObject* result = constructEmptyObject(lexicalGlobalObject);
        result->putDirect(vm, Identifier::fromString(vm, "sharedKey"_s), sharedKey);
        result->putDirect(vm, Identifier::fromString(vm, "ciphertext"_s), ciphertext);
        return { jsNull(), result };
    }

    return { jsNull(), sharedKey };
}

extern "C" void Bun__KemJob__createAndSchedule(JSGlobalObject* globalObject, KemJobCtx* ctx, EncodedJSValue callback);
void KemJob::createAndSchedule(JSGlobalObject* globalObject, KemJobCtx&& ctx, JSValue callback)
{
    KemJobCtx* ctxCopy = new KemJobCtx(WTF::move(ctx));
    Bun__KemJob__createAndSchedule(globalObject, ctxCopy, JSValue::encode(callback));
}

std::optional<KemJobCtx> KemJobCtx::fromJS(JSGlobalObject* globalObject, ThrowScope& scope, Mode mode,
    JSValue keyValue, JSValue ciphertextValue, JSValue callbackValue)
{
    if (!callbackValue.isUndefined()) {
        V::validateFunction(scope, globalObject, callbackValue, "callback"_s);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Encapsulation needs only the public key, but like Node it also accepts a
    // private key (whose embedded public part is used). Decapsulation requires
    // a private key.
    auto prepareResult = mode == Mode::Encapsulate
        ? KeyObject::preparePublicOrPrivateKey(globalObject, scope, keyValue)
        : KeyObject::preparePrivateKey(globalObject, scope, keyValue);
    RETURN_IF_EXCEPTION(scope, {});

    Vector<uint8_t> ciphertext;
    if (mode == Mode::Decapsulate) {
        auto ciphertextView = getArrayBufferOrView2(globalObject, scope, ciphertextValue, "ciphertext"_s, jsUndefined());
        RETURN_IF_EXCEPTION(scope, {});
        ciphertext.append(std::span { ciphertextView->data(), ciphertextView->size() });
    }

    ClearErrorOnReturn clearError;
    auto keyType = mode == Mode::Encapsulate
        ? CryptoKeyType::Public
        : CryptoKeyType::Private;

    KeyObject keyObject;

    if (prepareResult.keyData) {
        keyObject = KeyObject::create(keyType, WTF::move(*prepareResult.keyData));
    } else {
        keyObject = KeyObject::getPublicOrPrivateKey(
            globalObject,
            scope,
            prepareResult.keyDataView,
            keyType,
            prepareResult.formatType,
            prepareResult.encodingType,
            prepareResult.cipher,
            WTF::move(prepareResult.passphrase));
        RETURN_IF_EXCEPTION(scope, {});
    }

    return KemJobCtx(mode, keyObject.data(), WTF::move(ciphertext));
}

static EncodedJSValue runKemJob(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame, KemJobCtx::Mode mode)
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue keyValue = callFrame->argument(0);
    bool isDecapsulate = mode == KemJobCtx::Mode::Decapsulate;
    JSValue ciphertextValue = isDecapsulate ? callFrame->argument(1) : jsUndefined();
    JSValue callbackValue = callFrame->argument(isDecapsulate ? 2 : 1);

    std::optional<KemJobCtx> ctx = KemJobCtx::fromJS(lexicalGlobalObject, scope, mode, keyValue, ciphertextValue, callbackValue);
    EXCEPTION_ASSERT(ctx.has_value() == !scope.exception());
    RETURN_IF_EXCEPTION(scope, {});

    if (!callbackValue.isUndefined()) {
        KemJob::createAndSchedule(lexicalGlobalObject, WTF::move(*ctx), callbackValue);
        return JSValue::encode(jsUndefined());
    }

    ctx->runTask(lexicalGlobalObject);

    if (!ctx->m_sharedKeyResult) {
        return isDecapsulate
            ? ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "Failed to perform decapsulation"_s)
            : ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "Failed to perform encapsulation"_s);
    }

    JSValue sharedKey = WebCore::createBuffer(lexicalGlobalObject, ctx->m_sharedKeyResult.span());
    RETURN_IF_EXCEPTION(scope, {});

    if (mode == KemJobCtx::Mode::Encapsulate) {
        JSValue ciphertext = WebCore::createBuffer(lexicalGlobalObject, ctx->m_ciphertextResult.span());
        RETURN_IF_EXCEPTION(scope, {});
        JSObject* result = constructEmptyObject(lexicalGlobalObject);
        result->putDirect(vm, Identifier::fromString(vm, "sharedKey"_s), sharedKey);
        result->putDirect(vm, Identifier::fromString(vm, "ciphertext"_s), ciphertext);
        RELEASE_AND_RETURN(scope, JSValue::encode(result));
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(sharedKey));
}

JSC_DEFINE_HOST_FUNCTION(jsEncapsulate, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return runKemJob(lexicalGlobalObject, callFrame, KemJobCtx::Mode::Encapsulate);
}

JSC_DEFINE_HOST_FUNCTION(jsDecapsulate, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return runKemJob(lexicalGlobalObject, callFrame, KemJobCtx::Mode::Decapsulate);
}

} // namespace Bun
