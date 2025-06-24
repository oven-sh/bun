#include "JSDiffieHellmanConstructor.h"
#include "JSDiffieHellman.h"
#include "ErrorCode.h"
#include "JSBufferEncodingType.h"
#include "NodeValidator.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include "CryptoUtil.h"
#include "openssl/dh.h"
#include "openssl/bn.h"
#include "openssl/err.h"
#include "ncrypto.h"
namespace Bun {

const JSC::ClassInfo JSDiffieHellmanConstructor::s_info = { "DiffieHellman"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDiffieHellmanConstructor) };

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

    JSValue sizeOrKey = callFrame->argument(0);

    if (!sizeOrKey.isNumber() && !sizeOrKey.isString() && !isArrayBufferOrView(sizeOrKey)) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "sizeOrKey"_s, "number, string, ArrayBuffer, Buffer, TypedArray, or DataView"_s, sizeOrKey);
    }

    if (sizeOrKey.isNumber()) {
        Bun::V::validateInt32(scope, globalObject, sizeOrKey, "sizeOrKey"_s, jsUndefined(), jsUndefined());
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSValue keyEncodingValue = callFrame->argument(1);
    JSValue generatorValue = callFrame->argument(2);
    JSValue genEncodingValue = callFrame->argument(3);

    std::optional<BufferEncodingType> keyEncoding = std::nullopt;

    if (keyEncodingValue.pureToBoolean() != TriState::False) {
        if (keyEncodingValue.isString()) {
            WTF::String keyEncodingString = keyEncodingValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});

            keyEncoding = WebCore::parseEnumerationFromView<BufferEncodingType>(keyEncodingString);

            if (!keyEncoding.has_value() && keyEncodingString == "buffer"_s) {
                keyEncoding = BufferEncodingType::buffer;
            }
        }

        if (!keyEncoding.has_value()) {
            genEncodingValue = generatorValue;
            generatorValue = keyEncodingValue;
            keyEncodingValue = jsBoolean(false);
            keyEncoding = std::nullopt;
        }
    }

    if (generatorValue.pureToBoolean() == TriState::False) {
        generatorValue = jsNumber(2);
    } else if (generatorValue.isNumber()) {
        Bun::V::validateInt32(scope, globalObject, generatorValue, "generator"_s, jsUndefined(), jsUndefined());
        RETURN_IF_EXCEPTION(scope, {});
    } else if (!generatorValue.isString() && !isArrayBufferOrView(generatorValue)) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "generator"_s, "number, string, ArrayBuffer, Buffer, TypedArray, or DataView"_s, generatorValue);
    }

    ncrypto::DHPointer dh;

    if (sizeOrKey.isNumber()) {
        int32_t bits = sizeOrKey.toInt32(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        if (bits < 2) {
            ERR_put_error(ERR_LIB_DH, 0, DH_R_MODULUS_TOO_LARGE, __FILE__, __LINE__);
            throwCryptoError(globalObject, scope, ERR_get_error(), "Invalid prime length"_s);
            return JSValue::encode({});
        }

        if (!generatorValue.isNumber()) {
            return JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, "Second argument must be an int32"_s));
        }

        int32_t generator = 0;
        V::validateInt32(scope, globalObject, generatorValue, "generator"_s, jsUndefined(), jsUndefined(), &generator);
        RETURN_IF_EXCEPTION(scope, {});

        if (generator < 2) {
            ERR_put_error(ERR_LIB_DH, 0, DH_R_BAD_GENERATOR, __FILE__, __LINE__);
            throwCryptoError(globalObject, scope, ERR_get_error(), "Invalid generator"_s);
            return JSValue::encode({});
        }

        dh = ncrypto::DHPointer::New(bits, generator);
        if (!dh) {
            return JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, "Invalid DH parameters"_s));
        }
    } else {

        auto* keyView = keyEncoding.has_value()
            ? getArrayBufferOrView(globalObject, scope, sizeOrKey, "sizeOrKey"_s, keyEncoding.value())
            : getArrayBufferOrView(globalObject, scope, sizeOrKey, "sizeOrKey"_s, keyEncodingValue, true);

        RETURN_IF_EXCEPTION(scope, {});

        if (keyView->byteLength() > INT32_MAX) {
            return JSValue::encode(createError(globalObject, ErrorCode::ERR_OUT_OF_RANGE, "prime is too big"_s));
        }

        ncrypto::BignumPointer bn_p(reinterpret_cast<uint8_t*>(keyView->vector()), keyView->byteLength());
        if (!bn_p) {
            return JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, "Invalid prime"_s));
        }
        ncrypto::BignumPointer bn_g;

        if (generatorValue.isNumber()) {
            int32_t generator = generatorValue.asInt32();
            if (generator < 2) {
                ERR_put_error(ERR_LIB_DH, 0, DH_R_BAD_GENERATOR, __FILE__, __LINE__);
                throwCryptoError(globalObject, scope, ERR_get_error(), "Invalid generator"_s);
                return JSValue::encode({});
            }
            bn_g = ncrypto::BignumPointer::New();
            if (!bn_g.setWord(generator)) {
                ERR_put_error(ERR_LIB_DH, 0, DH_R_BAD_GENERATOR, __FILE__, __LINE__);
                throwCryptoError(globalObject, scope, ERR_get_error(), "Invalid generator"_s);
            }
        } else {
            auto* generatorView = getArrayBufferOrView(globalObject, scope, generatorValue, "generator"_s, genEncodingValue);
            RETURN_IF_EXCEPTION(scope, {});

            if (generatorView->byteLength() > INT32_MAX) {
                return JSValue::encode(createError(globalObject, ErrorCode::ERR_OUT_OF_RANGE, "generator is too big"_s));
            }

            bn_g = ncrypto::BignumPointer(reinterpret_cast<uint8_t*>(generatorView->vector()), generatorView->byteLength());
            if (!bn_g) {
                return JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, "Invalid generator"_s));
            }

            if (bn_g.getWord() < 2) {
                ERR_put_error(ERR_LIB_DH, 0, DH_R_BAD_GENERATOR, __FILE__, __LINE__);
                throwCryptoError(globalObject, scope, ERR_get_error(), "Invalid generator"_s);
                return JSValue::encode({});
            }
        }

        dh = ncrypto::DHPointer::New(WTFMove(bn_p), WTFMove(bn_g));
        if (!dh) {
            return JSValue::encode(createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, "Invalid DH parameters"_s));
        }
    }

    // Get the appropriate structure and create the DiffieHellman object
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSDiffieHellmanClassStructure.get(zigGlobalObject);

    return JSC::JSValue::encode(JSDiffieHellman::create(vm, structure, globalObject, WTFMove(dh)));
}

} // namespace Bun
