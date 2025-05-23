#include "CryptoPrimes.h"
#include "ErrorCode.h"
#include "helpers.h"
#include "CryptoUtil.h"
#include "NodeValidator.h"

namespace Bun {

using namespace ncrypto;
using namespace JSC;

CheckPrimeJobCtx::CheckPrimeJobCtx(ncrypto::BignumPointer candidate, int32_t checks)
    : m_candidate(WTFMove(candidate))
    , m_checks(checks)
{
}

CheckPrimeJobCtx::~CheckPrimeJobCtx()
{
}

extern "C" void Bun__CheckPrimeJobCtx__runTask(CheckPrimeJobCtx* ctx, JSGlobalObject* lexicalGlobalObject)
{
    ctx->runTask(lexicalGlobalObject);
}
void CheckPrimeJobCtx::runTask(JSGlobalObject* lexicalGlobalObject)
{
    auto res = m_candidate.isPrime(m_checks, [](int32_t a, int32_t b) -> bool {
        // TODO(dylan-conway): ideally we check for !vm->isShuttingDown() here
        return true;
    });

    m_result = res != 0;
}

extern "C" void Bun__CheckPrimeJobCtx__runFromJS(CheckPrimeJobCtx* ctx, JSGlobalObject* lexicalGlobalObject, EncodedJSValue callback)
{
    ctx->runFromJS(lexicalGlobalObject, JSValue::decode(callback));
}
void CheckPrimeJobCtx::runFromJS(JSGlobalObject* lexicalGlobalObject, JSValue callback)
{
    Bun__EventLoop__runCallback2(lexicalGlobalObject, JSValue::encode(callback), JSValue::encode(jsUndefined()), JSValue::encode(jsUndefined()), JSValue::encode(jsBoolean(m_result)));
}

extern "C" void Bun__CheckPrimeJobCtx__deinit(CheckPrimeJobCtx* ctx)
{
    ctx->deinit();
}
void CheckPrimeJobCtx::deinit()
{
    delete this;
}

extern "C" CheckPrimeJob* Bun__CheckPrimeJob__create(JSGlobalObject*, CheckPrimeJobCtx*, EncodedJSValue callback);
CheckPrimeJob* CheckPrimeJob::create(JSGlobalObject* globalObject, ncrypto::BignumPointer candidate, int32_t checks, JSValue callback)
{
    CheckPrimeJobCtx* ctx = new CheckPrimeJobCtx(WTFMove(candidate), checks);
    return Bun__CheckPrimeJob__create(globalObject, ctx, JSValue::encode(callback));
}

extern "C" void Bun__CheckPrimeJob__schedule(CheckPrimeJob*);
void CheckPrimeJob::schedule()
{
    Bun__CheckPrimeJob__schedule(this);
}

extern "C" void Bun__CheckPrimeJob__createAndSchedule(JSGlobalObject*, CheckPrimeJobCtx*, EncodedJSValue callback);
void CheckPrimeJob::createAndSchedule(JSGlobalObject* globalObject, ncrypto::BignumPointer candidate, int32_t checks, JSValue callback)
{
    CheckPrimeJobCtx* ctx = new CheckPrimeJobCtx(WTFMove(candidate), checks);
    return Bun__CheckPrimeJob__createAndSchedule(globalObject, ctx, JSValue::encode(callback));
}

JSC_DEFINE_HOST_FUNCTION(jsCheckPrimeSync, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue candidateValue = callFrame->argument(0);

    if (candidateValue.isBigInt()) {
        candidateValue = unsignedBigIntToBuffer(lexicalGlobalObject, scope, candidateValue, "candidate"_s);
        RETURN_IF_EXCEPTION(scope, {});
    }

    auto candidateView = getArrayBufferOrView2(lexicalGlobalObject, scope, candidateValue, "candidate"_s, jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});

    JSValue optionsValue = callFrame->argument(1);
    if (!optionsValue.isUndefined()) {
        V::validateObject(scope, lexicalGlobalObject, optionsValue, "options"_s);
        RETURN_IF_EXCEPTION(scope, {});
    }

    int32_t checks = 0;
    if (auto* optionsObj = optionsValue.getObject()) {
        auto clientData = WebCore::clientData(vm);
        JSValue checksValue = optionsObj->get(lexicalGlobalObject, clientData->builtinNames().checksPublicName());
        RETURN_IF_EXCEPTION(scope, {});

        if (!checksValue.isUndefined()) {
            V::validateInt32(scope, lexicalGlobalObject, checksValue, "options.checks"_s, jsNumber(0), jsUndefined(), &checks);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    ncrypto::BignumPointer candidate = ncrypto::BignumPointer(candidateView->data(), candidateView->size());
    if (!candidate) {
        throwCryptoError(lexicalGlobalObject, scope, ERR_get_error(), "BignumPointer"_s);
        return JSValue::encode({});
    }

    auto res = candidate.isPrime(checks, [](int32_t a, int32_t b) -> bool {
        // TODO(dylan-conway): ideally we check for !vm->isShuttingDown() here
        return true;
    });

    return JSValue::encode(jsBoolean(res != 0));
}

JSC_DEFINE_HOST_FUNCTION(jsCheckPrime, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue candidateValue = callFrame->argument(0);
    if (candidateValue.isBigInt()) {
        candidateValue = unsignedBigIntToBuffer(lexicalGlobalObject, scope, candidateValue, "candidate"_s);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    }

    auto candidateView = getArrayBufferOrView2(lexicalGlobalObject, scope, candidateValue, "candidate"_s, jsUndefined());
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    JSValue optionsValue = callFrame->argument(1);
    JSValue callback = callFrame->argument(2);
    if (optionsValue.isCallable()) {
        callback = optionsValue;
        optionsValue = jsUndefined();
    }

    V::validateFunction(scope, lexicalGlobalObject, callback, "callback"_s);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    if (!optionsValue.isUndefined()) {
        V::validateObject(scope, lexicalGlobalObject, optionsValue, "options"_s);
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    }

    int32_t checks = 0;
    if (optionsValue.isObject()) {
        JSObject* options = optionsValue.getObject();
        JSValue checksValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "checks"_s));
        RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

        if (!checksValue.isUndefined()) {
            V::validateInt32(scope, lexicalGlobalObject, checksValue, "options.checks"_s, jsNumber(0), jsUndefined(), &checks);
            RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
        }
    }

    ncrypto::BignumPointer candidate = ncrypto::BignumPointer(candidateView->data(), candidateView->size());
    if (!candidate) {
        throwCryptoError(lexicalGlobalObject, scope, ERR_get_error(), "BignumPointer"_s);
        return JSValue::encode({});
    }

    CheckPrimeJob::createAndSchedule(lexicalGlobalObject, WTFMove(candidate), checks, callback);

    return JSValue::encode(jsUndefined());
}

GeneratePrimeJobCtx::GeneratePrimeJobCtx(int32_t size, bool safe, ncrypto::BignumPointer prime, ncrypto::BignumPointer add, ncrypto::BignumPointer rem, bool bigint)
    : m_size(size)
    , m_safe(safe)
    , m_bigint(bigint)
    , m_add(WTFMove(add))
    , m_rem(WTFMove(rem))
    , m_prime(WTFMove(prime))
{
}

GeneratePrimeJobCtx::~GeneratePrimeJobCtx()
{
}

extern "C" void Bun__GeneratePrimeJobCtx__runTask(GeneratePrimeJobCtx* ctx, JSGlobalObject* lexicalGlobalObject)
{
    ctx->runTask(lexicalGlobalObject);
}
void GeneratePrimeJobCtx::runTask(JSGlobalObject* lexicalGlobalObject)
{
    m_prime.generate({ .bits = m_size, .safe = m_safe, .add = m_add, .rem = m_rem }, [](int32_t a, int32_t b) -> bool {
        // TODO(dylan-conway): ideally we check for !vm->isShuttingDown() here
        return true;
    });
}

extern "C" void Bun__GeneratePrimeJobCtx__runFromJS(GeneratePrimeJobCtx* ctx, JSGlobalObject* lexicalGlobalObject, EncodedJSValue callback)
{
    ctx->runFromJS(lexicalGlobalObject, JSValue::decode(callback));
}
void GeneratePrimeJobCtx::runFromJS(JSGlobalObject* globalObject, JSValue callback)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue result = GeneratePrimeJob::result(globalObject, scope, m_prime, m_bigint);
    ASSERT(result.isEmpty() == !!scope.exception());
    if (scope.exception()) {
        auto* err = scope.exception();
        scope.clearException();
        Bun__EventLoop__runCallback1(
            globalObject,
            JSValue::encode(callback),
            JSValue::encode(jsUndefined()),
            JSValue::encode(err));
        return;
    }

    Bun__EventLoop__runCallback2(
        globalObject,
        JSValue::encode(callback),
        JSValue::encode(jsUndefined()),
        JSValue::encode(jsUndefined()),
        JSValue::encode(result));
    return;
}

extern "C" void Bun__GeneratePrimeJobCtx__deinit(GeneratePrimeJobCtx* ctx)
{
    ctx->deinit();
}
void GeneratePrimeJobCtx::deinit()
{
    delete this;
}

extern "C" GeneratePrimeJob* Bun__GeneratePrimeJob__create(JSGlobalObject*, GeneratePrimeJobCtx*, EncodedJSValue callback);
GeneratePrimeJob* GeneratePrimeJob::create(JSGlobalObject* globalObject, int32_t size, bool safe, ncrypto::BignumPointer prime, ncrypto::BignumPointer add, ncrypto::BignumPointer rem, bool bigint, JSValue callback)
{
    GeneratePrimeJobCtx* ctx = new GeneratePrimeJobCtx(size, safe, WTFMove(prime), WTFMove(add), WTFMove(rem), bigint);
    return Bun__GeneratePrimeJob__create(globalObject, ctx, JSValue::encode(callback));
}

extern "C" void Bun__GeneratePrimeJob__schedule(GeneratePrimeJob*);
void GeneratePrimeJob::schedule()
{
    Bun__GeneratePrimeJob__schedule(this);
}

extern "C" void Bun__GeneratePrimeJob__createAndSchedule(JSGlobalObject*, GeneratePrimeJobCtx*, EncodedJSValue callback);
void GeneratePrimeJob::createAndSchedule(JSGlobalObject* globalObject, int32_t size, bool safe, ncrypto::BignumPointer prime, ncrypto::BignumPointer add, ncrypto::BignumPointer rem, bool bigint, JSValue callback)
{
    GeneratePrimeJobCtx* ctx = new GeneratePrimeJobCtx(size, safe, WTFMove(prime), WTFMove(add), WTFMove(rem), bigint);
    Bun__GeneratePrimeJob__createAndSchedule(globalObject, ctx, JSValue::encode(callback));
}

JSValue GeneratePrimeJob::result(JSGlobalObject* globalObject, JSC::ThrowScope& scope, const ncrypto::BignumPointer& prime, bool bigint)
{
    VM& vm = globalObject->vm();

    if (bigint) {
        ncrypto::DataPointer primeHex = prime.toHex();
        if (!primeHex) {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }

        JSValue result = JSBigInt::parseInt(globalObject, vm, primeHex.span(), 16, JSBigInt::ErrorParseMode::IgnoreExceptions, JSBigInt::ParseIntSign::Unsigned);
        if (result.isEmpty()) {
            ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "could not generate prime"_s);
            return {};
        }

        return result;
    }

    ArrayBufferContents contents;

    auto buf = ArrayBuffer::tryCreateUninitialized(prime.byteLength(), 1);
    if (!buf) {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    BignumPointer::EncodePaddedInto(prime.get(), reinterpret_cast<uint8_t*>(buf->data()), buf->byteLength());

    return JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(), WTFMove(buf));
}

JSC_DEFINE_HOST_FUNCTION(jsGeneratePrime, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue sizeValue = callFrame->argument(0);
    int32_t size = 0;
    V::validateInt32(scope, lexicalGlobalObject, sizeValue, "size"_s, jsNumber(1), jsUndefined(), &size);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue optionsValue = callFrame->argument(1);
    JSValue callback = callFrame->argument(2);
    if (optionsValue.isCallable()) {
        callback = optionsValue;
        optionsValue = jsUndefined();
    }
    V::validateFunction(scope, lexicalGlobalObject, callback, "callback"_s);
    RETURN_IF_EXCEPTION(scope, {});

    if (!optionsValue.isUndefined()) {
        V::validateObject(scope, lexicalGlobalObject, optionsValue, "options"_s);
        RETURN_IF_EXCEPTION(scope, {});
    }

    bool safe = false;
    bool bigint = false;
    JSValue addValue = jsUndefined();
    JSValue remValue = jsUndefined();
    if (optionsValue.isObject()) {
        JSObject* options = optionsValue.getObject();

        JSValue safeValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "safe"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue bigintValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "bigint"_s));
        RETURN_IF_EXCEPTION(scope, {});
        addValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "add"_s));
        RETURN_IF_EXCEPTION(scope, {});
        remValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "rem"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (!safeValue.isUndefined()) {
            V::validateBoolean(scope, lexicalGlobalObject, safeValue, "options.safe"_s);
            RETURN_IF_EXCEPTION(scope, {});
            safe = safeValue.asBoolean();
        }

        if (!bigintValue.isUndefined()) {
            V::validateBoolean(scope, lexicalGlobalObject, bigintValue, "options.bigint"_s);
            RETURN_IF_EXCEPTION(scope, {});
            bigint = bigintValue.asBoolean();
        }
    }

    ncrypto::ClearErrorOnReturn clear;

    ncrypto::BignumPointer add;
    if (!addValue.isUndefined()) {
        if (addValue.isBigInt()) {
            addValue = unsignedBigIntToBuffer(lexicalGlobalObject, scope, addValue, "options.add"_s);
            RETURN_IF_EXCEPTION(scope, {});
        }
        auto* addView = jsDynamicCast<JSC::JSArrayBufferView*>(addValue);
        if (!addView) {
            return ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "options.add"_s, "ArrayBuffer, Buffer, TypedArray, DataView, or bigint"_s, addValue);
        }
        add.reset(reinterpret_cast<const uint8_t*>(addView->vector()), addView->byteLength());
        if (!add) {
            return ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "could not generate prime"_s);
        }
    }

    ncrypto::BignumPointer rem;
    if (!remValue.isUndefined()) {
        if (remValue.isBigInt()) {
            remValue = unsignedBigIntToBuffer(lexicalGlobalObject, scope, remValue, "options.rem"_s);
            RETURN_IF_EXCEPTION(scope, {});
        }
        auto* remView = jsDynamicCast<JSC::JSArrayBufferView*>(remValue);
        if (!remView) {
            return ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "options.rem"_s, "ArrayBuffer, Buffer, TypedArray, DataView, or bigint"_s, remValue);
        }
        rem.reset(reinterpret_cast<const uint8_t*>(remView->vector()), remView->byteLength());
        if (!rem) {
            return ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "could not generate prime"_s);
        }
    }

    if (add) {
        if (ncrypto::BignumPointer::GetBitCount(add.get()) > size) [[unlikely]] {
            throwError(lexicalGlobalObject, scope, ErrorCode::ERR_OUT_OF_RANGE, "invalid options.add"_s);
            return JSValue::encode({});
        }

        if (rem && add <= rem) [[unlikely]] {
            throwError(lexicalGlobalObject, scope, ErrorCode::ERR_OUT_OF_RANGE, "invalid options.rem"_s);
            return JSValue::encode({});
        }
    }

    ncrypto::BignumPointer prime = ncrypto::BignumPointer::NewSecure();
    if (!prime) {
        return ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "could not generate prime"_s);
    }

    GeneratePrimeJob::createAndSchedule(lexicalGlobalObject, size, safe, WTFMove(prime), WTFMove(add), WTFMove(rem), bigint, callback);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsGeneratePrimeSync, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue sizeValue = callFrame->argument(0);
    int32_t size = 0;
    V::validateInt32(scope, lexicalGlobalObject, sizeValue, "size"_s, jsNumber(1), jsUndefined(), &size);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue optionsValue = callFrame->argument(1);
    if (!optionsValue.isUndefined()) {
        V::validateObject(scope, lexicalGlobalObject, optionsValue, "options"_s);
        RETURN_IF_EXCEPTION(scope, {});
    }

    bool safe = false;
    bool bigint = false;
    JSValue addValue = jsUndefined();
    JSValue remValue = jsUndefined();
    if (optionsValue.isObject()) {
        JSObject* options = optionsValue.getObject();

        JSValue safeValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "safe"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue bigintValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "bigint"_s));
        RETURN_IF_EXCEPTION(scope, {});
        addValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "add"_s));
        RETURN_IF_EXCEPTION(scope, {});
        remValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "rem"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (!safeValue.isUndefined()) {
            V::validateBoolean(scope, lexicalGlobalObject, safeValue, "options.safe"_s);
            RETURN_IF_EXCEPTION(scope, {});
            safe = safeValue.asBoolean();
        }

        if (!bigintValue.isUndefined()) {
            V::validateBoolean(scope, lexicalGlobalObject, bigintValue, "options.bigint"_s);
            RETURN_IF_EXCEPTION(scope, {});
            bigint = bigintValue.asBoolean();
        }
    }

    ncrypto::ClearErrorOnReturn clear;

    ncrypto::BignumPointer add;
    if (!addValue.isUndefined()) {
        if (addValue.isBigInt()) {
            addValue = unsignedBigIntToBuffer(lexicalGlobalObject, scope, addValue, "options.add"_s);
            RETURN_IF_EXCEPTION(scope, {});
        }
        auto* addView = jsDynamicCast<JSC::JSArrayBufferView*>(addValue);
        if (!addView) {
            return ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "options.add"_s, "ArrayBuffer, Buffer, TypedArray, DataView, or bigint"_s, addValue);
        }
        add.reset(reinterpret_cast<const uint8_t*>(addView->vector()), addView->byteLength());
        if (!add) {
            return ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "could not generate prime"_s);
        }
    }

    ncrypto::BignumPointer rem;
    if (!remValue.isUndefined()) {
        if (remValue.isBigInt()) {
            remValue = unsignedBigIntToBuffer(lexicalGlobalObject, scope, remValue, "options.rem"_s);
            RETURN_IF_EXCEPTION(scope, {});
        }
        auto* remView = jsDynamicCast<JSC::JSArrayBufferView*>(remValue);
        if (!remView) {
            return ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "options.rem"_s, "ArrayBuffer, Buffer, TypedArray, DataView, or bigint"_s, remValue);
        }
        rem.reset(reinterpret_cast<const uint8_t*>(remView->vector()), remView->byteLength());
        if (!rem) {
            return ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "could not generate prime"_s);
        }
    }

    if (add) {
        if (ncrypto::BignumPointer::GetBitCount(add.get()) > size) [[unlikely]] {
            throwError(lexicalGlobalObject, scope, ErrorCode::ERR_OUT_OF_RANGE, "invalid options.add"_s);
            return JSValue::encode({});
        }

        if (rem && add <= rem) [[unlikely]] {
            throwError(lexicalGlobalObject, scope, ErrorCode::ERR_OUT_OF_RANGE, "invalid options.rem"_s);
            return JSValue::encode({});
        }
    }

    ncrypto::BignumPointer prime = ncrypto::BignumPointer::NewSecure();
    if (!prime) {
        return ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "could not generate prime"_s);
    }

    prime.generate({ .bits = size, .safe = safe, .add = add, .rem = rem }, [](int32_t a, int32_t b) -> bool {
        // TODO(dylan-conway): ideally we check for !vm->isShuttingDown() here
        return true;
    });

    return JSValue::encode(GeneratePrimeJob::result(lexicalGlobalObject, scope, prime, bigint));
}

} // namespace Bun
