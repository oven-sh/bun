#include "JSECDHConstructor.h"
#include "JSECDH.h"
#include "ErrorCode.h"
#include "JSBufferEncodingType.h"
#include "NodeValidator.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include "util.h"
#include "openssl/dh.h"
#include "openssl/bn.h"
#include "openssl/err.h"
#include "ncrypto.h"
namespace Bun {

const JSC::ClassInfo JSECDHConstructor::s_info = { "ECDH"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSECDHConstructor) };

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

    return JSC::JSValue::encode(JSECDH::create(vm, structure, globalObject, WTFMove(key)));
}

} // namespace Bun
