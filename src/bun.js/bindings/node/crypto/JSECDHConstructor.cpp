#include "JSECDHConstructor.h"
#include "JSECDH.h"
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

JSC_DECLARE_HOST_FUNCTION(jsECDHConvertKey);

const JSC::ClassInfo JSECDHConstructor::s_info = { "ECDH"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSECDHConstructor) };

static const JSC::HashTableValue JSECDHConstructorTableValues[] = {
    { "convertKey"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsECDHConvertKey, 3 } },
};

void JSECDHConstructor::finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
{
    Base::finishCreation(vm, 2, "ECDH"_s);
    reifyStaticProperties(vm, JSECDHConstructor::info(), JSECDHConstructorTableValues, *this);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}

JSC_DEFINE_HOST_FUNCTION(callECDH, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* constructor = globalObject->m_JSECDHClassStructure.constructor(globalObject);

    ArgList args = ArgList(callFrame);
    auto callData = JSC::getConstructData(constructor);
    JSC::JSValue result = JSC::construct(globalObject, constructor, callData, args);
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(constructECDH, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue curveValue = callFrame->argument(0);

    Bun::V::validateString(scope, globalObject, curveValue, "curve"_s);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::String curveString = curveValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto curve = curveString.utf8();

    int nid = OBJ_sn2nid(curve.data());
    if (nid == NID_undef) {
        return Bun::ERR::CRYPTO_INVALID_CURVE(scope, globalObject);
    }

    auto key = ncrypto::ECKeyPointer::NewByCurveName(nid);
    if (!key) {
        return Bun::ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Failed to create key using named curve"_s);
    }

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSECDHClassStructure.get(zigGlobalObject);

    const EC_GROUP* group = key.getGroup();
    return JSC::JSValue::encode(JSECDH::create(vm, structure, globalObject, WTFMove(key), group));
}

JSC_DEFINE_HOST_FUNCTION(jsECDHConvertKey, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;

    JSValue curveValue = callFrame->argument(1);
    Bun::V::validateString(scope, lexicalGlobalObject, curveValue, "curve"_s);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue keyValue = callFrame->argument(0);
    JSValue inEncValue = callFrame->argument(2);
    auto* keyView = getArrayBufferOrView(lexicalGlobalObject, scope, keyValue, "key"_s, inEncValue);
    RETURN_IF_EXCEPTION(scope, {});

    auto buffer = keyView->span();

    JSValue formatValue = callFrame->argument(4);
    point_conversion_form_t form = JSECDH::getFormat(lexicalGlobalObject, scope, formatValue);
    RETURN_IF_EXCEPTION(scope, {});

    auto curveName = curveValue.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    int nid = OBJ_sn2nid(curveName.utf8().data());
    if (nid == NID_undef)
        return Bun::ERR::CRYPTO_INVALID_CURVE(scope, lexicalGlobalObject);

    auto group = ncrypto::ECGroupPointer::NewByCurveName(nid);
    if (!group)
        return throwVMError(lexicalGlobalObject, scope, "Failed to get EC_GROUP"_s);

    auto point = ncrypto::ECPointPointer::New(group);
    if (!point)
        return throwVMError(lexicalGlobalObject, scope, "Failed to create EC_POINT"_s);

    const unsigned char* key_data = buffer.data();
    size_t key_length = buffer.size();

    if (!point.setFromBuffer({ key_data, key_length }, group)) {
        return Bun::ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "Failed to convert Buffer to EC_POINT"_s);
    }

    size_t size = EC_POINT_point2oct(group, point, form, nullptr, 0, nullptr);
    if (size == 0) {
        return ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "Failed to get public key length"_s);
    }

    WTF::Vector<uint8_t> buf;
    if (!buf.tryGrow(size)) {
        throwOutOfMemoryError(lexicalGlobalObject, scope);
        return JSValue::encode({});
    }

    if (!EC_POINT_point2oct(group, point, form, buf.begin(), buf.size(), nullptr)) {
        return ERR::CRYPTO_OPERATION_FAILED(scope, lexicalGlobalObject, "Failed to get public key"_s);
    }

    JSValue outEncValue = callFrame->argument(3);
    BufferEncodingType outEnc = getEncodingDefaultBuffer(lexicalGlobalObject, scope, outEncValue);
    RETURN_IF_EXCEPTION(scope, {});

    return StringBytes::encode(lexicalGlobalObject, scope, buf.span(), outEnc);
}

} // namespace Bun
