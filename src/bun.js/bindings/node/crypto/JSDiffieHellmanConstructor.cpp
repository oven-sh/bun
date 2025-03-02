#include "JSDiffieHellmanConstructor.h"
#include "JSDiffieHellman.h"
#include "ErrorCode.h"
#include "JSBufferEncodingType.h"
#include "NodeValidator.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include "util.h"
namespace Bun {

const JSC::ClassInfo JSDiffieHellmanConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDiffieHellmanConstructor) };

JSC_DEFINE_HOST_FUNCTION(callDiffieHellman, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* constructor = globalObject->m_JSDiffieHellmanClassStructure.constructor(globalObject);

    ArgList args = ArgList(callFrame);
    auto callData = JSC::getConstructData(constructor);
    JSC::JSValue result = JSC::construct(globalObject, constructor, callData, args);
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(constructDiffieHellman, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // We need at least one argument
    if (callFrame->argumentCount() < 2) {
        throwError(globalObject, scope, ErrorCode::ERR_MISSING_ARGS, "Constructor must have two arguments"_s);
        return {};
    }

    JSC::JSValue primeArg = callFrame->argument(0);
    JSC::JSValue genArg = callFrame->argument(1);

    ncrypto::DHPointer dh;

    // Handle case where prime is a number (create new DH params with prime size)
    if (primeArg.isNumber()) {
        // Use validator for integer values
        // Instead of directly checking isInt32, use V::validateInt32 which throws the proper error
        int32_t bits = 0;
        V::validateInteger(scope, globalObject, primeArg, "sizeOrKey"_s, JSC::jsNumber(0), JSC::jsUndefined(), &bits);
        RETURN_IF_EXCEPTION(scope, {});

        if (bits < 2) {
#if OPENSSL_VERSION_MAJOR >= 3

            throwError(globalObject, scope, ErrorCode::ERR_OSSL_DH_MODULUS_TOO_SMALL, "modulus too small"_s);
#else

            throwError(globalObject, scope, ErrorCode::ERR_OSSL_BN_BITS_TOO_SMALL, "bits too small"_s);
#endif
            return {};
        }

        // Validate the generator argument
        int32_t generator = 0;
        V::validateInteger(scope, globalObject, genArg, "generator"_s, JSC::jsNumber(0), JSC::jsUndefined(), &generator);
        RETURN_IF_EXCEPTION(scope, {});

        if (generator < 2) {

            throwError(globalObject, scope, ErrorCode::ERR_OSSL_DH_BAD_GENERATOR, "bad generator"_s);
            return {};
        }

        dh = ncrypto::DHPointer::New(bits, generator);
        if (!dh) {
            throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "Invalid DH parameters"_s);
            return {};
        }
    } else {

        // This could be either a buffer or a string with encoding
        std::span<const uint8_t> primeSpan;

        // Check if we're dealing with a string input for the prime
        bool isPrimeString = primeArg.isString();
        JSC::JSValue primeEncodingArg = callFrame->argument(1);

        if (isPrimeString) { // Convert the string to a buffer using the specified encoding
            auto* primeBuffer = Bun::getArrayBufferOrView(globalObject, scope, primeArg, "prime"_s, primeEncodingArg);
            RETURN_IF_EXCEPTION(scope, {});
            ASSERT(primeBuffer);
            primeArg = primeBuffer;
            primeSpan = primeBuffer->span();
        } else if (auto* view = jsDynamicCast<JSC::JSArrayBufferView*>(primeArg)) {
            if (view->isDetached()) {
                throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "Buffer is detached"_s);
                return {};
            }
            primeSpan = view->span();
        } else if (auto* arrayBuffer = jsDynamicCast<JSC::JSArrayBuffer*>(primeArg)) {
            if (arrayBuffer->impl()->isDetached()) {
                throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "Buffer is detached"_s);
                return {};
            }
            primeSpan = arrayBuffer->impl()->span();
        } else {
            ERR::INVALID_ARG_INSTANCE(scope, globalObject, "sizeOrKey"_s, "Buffer, TypedArray, DataView, or string"_s, primeArg);
            return {};
        }
        EnsureStillAliveScope ensureStillAlive(primeArg);

        // Check for unusually large buffer sizes
        if (primeSpan.size() > INT32_MAX) {
            throwError(globalObject, scope, ErrorCode::ERR_OUT_OF_RANGE, "prime is too big"_s);
            return {};
        }

        ncrypto::BignumPointer bn_p(primeSpan.data(), primeSpan.size());
        if (!bn_p) {
            throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "Invalid prime"_s);
            return {};
        }

        ncrypto::BignumPointer bn_g;

        // Handle the generator parameter
        JSC::JSValue genEncodingArg = isPrimeString ? callFrame->argument(3) : callFrame->argument(2);

        if (genArg.isNumber()) {
            // Use the validator for integers
            int32_t generator = 0;
            V::validateInteger(scope, globalObject, genArg, "generator"_s, JSC::jsNumber(0), JSC::jsUndefined(), &generator);
            RETURN_IF_EXCEPTION(scope, {});

            if (generator < 2) {
                throwError(globalObject, scope, ErrorCode::ERR_OSSL_DH_BAD_GENERATOR, "bad generator"_s);
                return {};
            }

            bn_g = ncrypto::BignumPointer::New();
            if (!bn_g.setWord(generator)) {
                throwError(globalObject, scope, ErrorCode::ERR_OSSL_DH_BAD_GENERATOR, "bad generator"_s);
                return {};
            }
        } else if (genArg.isString()) {
            // Handle generator as string with encoding

            // Convert the string to a buffer using the specified encoding
            auto* genBuffer = Bun::getArrayBufferOrView(globalObject, scope, genArg, "generator"_s, genEncodingArg);
            RETURN_IF_EXCEPTION(scope, {});
            ASSERT(genBuffer);

            std::span<const uint8_t> genSpan = genBuffer->span();

            // Empty buffer or buffer with just 0 or 1 is not allowed
            if (genSpan.size() == 0 || (genSpan.size() == 1 && genSpan[0] <= 1)) {
                throwError(globalObject, scope, ErrorCode::ERR_OSSL_DH_BAD_GENERATOR, "bad generator"_s);
                return {};
            }

            bn_g = ncrypto::BignumPointer(genSpan.data(), genSpan.size());
            if (!bn_g) {
                throwError(globalObject, scope, ErrorCode::ERR_OSSL_DH_BAD_GENERATOR, "bad generator"_s);
                return {};
            }

            if (bn_g.getWord() < 2) {
                throwError(globalObject, scope, ErrorCode::ERR_OSSL_DH_BAD_GENERATOR, "bad generator"_s);
                return {};
            }
        } else {
            std::span<const uint8_t> genSpan;

            if (auto* view = jsDynamicCast<JSC::JSArrayBufferView*>(genArg)) {
                if (view->isDetached()) {
                    throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "Buffer is detached"_s);
                    return {};
                }
                genSpan = view->span();
            } else if (auto* arrayBuffer = jsDynamicCast<JSC::JSArrayBuffer*>(genArg)) {
                if (arrayBuffer->impl()->isDetached()) {
                    throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "Buffer is detached"_s);
                    return {};
                }
                genSpan = arrayBuffer->impl()->span();
            } else {
                ERR::INVALID_ARG_INSTANCE(scope, globalObject, "generator"_s, "number, string, Buffer, TypedArray, or DataView"_s, genArg);
                return {};
            }

            // Empty buffer or buffer with just 0 or 1 is not allowed
            if (genSpan.size() == 0 || (genSpan.size() == 1 && genSpan[0] <= 1)) {

                throwError(globalObject, scope, ErrorCode::ERR_OSSL_DH_BAD_GENERATOR, "bad generator"_s);
                return {};
            }

            bn_g = ncrypto::BignumPointer(genSpan.data(), genSpan.size());
            if (!bn_g) {

                throwError(globalObject, scope, ErrorCode::ERR_OSSL_DH_BAD_GENERATOR, "bad generator"_s);
                return {};
            }

            if (bn_g.getWord() < 2) {

                throwError(globalObject, scope, ErrorCode::ERR_OSSL_DH_BAD_GENERATOR, "bad generator"_s);
                return {};
            }
        }

        dh = ncrypto::DHPointer::New(std::move(bn_p), std::move(bn_g));
        if (!dh) {
            throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "Invalid DH parameters"_s);
            return {};
        }
    }

    // Get the appropriate structure and create the DiffieHellman object
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSDiffieHellmanClassStructure.get(zigGlobalObject);
    JSC::JSValue newTarget = callFrame->newTarget();

    if (UNLIKELY(zigGlobalObject->m_JSDiffieHellmanClassStructure.constructor(zigGlobalObject) != newTarget)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!newTarget) {
            throwError(globalObject, scope, ErrorCode::ERR_INVALID_THIS, "Class constructor DiffieHellman cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = reinterpret_cast<Zig::GlobalObject*>(JSC::getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = JSC::InternalFunction::createSubclassStructure(
            globalObject, newTarget.getObject(), functionGlobalObject->m_JSDiffieHellmanClassStructure.get(functionGlobalObject));
        scope.release();
    }

    return JSC::JSValue::encode(JSDiffieHellman::create(vm, structure, globalObject, std::move(dh)));
}

} // namespace Bun
