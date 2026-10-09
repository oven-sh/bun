#include "JSDiffieHellmanGroupConstructor.h"
#include "JSDiffieHellmanGroup.h"
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include "ErrorCode.h"
#include "NodeValidator.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include "ZigGlobalObject.h"

namespace Bun {

const JSC::ClassInfo JSDiffieHellmanGroupConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDiffieHellmanGroupConstructor) };

JSC_DEFINE_HOST_FUNCTION(callDiffieHellmanGroup, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* constructor = globalObject->m_JSDiffieHellmanGroupClassStructure.constructor(globalObject);

    ArgList args = ArgList(callFrame);
    auto callData = JSC::getConstructData(constructor);
    JSC::JSValue result = JSC::construct(globalObject, constructor, callData, args);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(constructDiffieHellmanGroup, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Use the validator to check if the argument is a string
    V::validateString(scope, globalObject, callFrame->argument(0), "group name"_s);
    RETURN_IF_EXCEPTION(scope, {});

    auto name = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto dh = ncrypto::DHPointer::FromGroup(name);
    if (!dh) {
        return Bun::ERR::CRYPTO_UNKNOWN_DH_GROUP(scope, globalObject);
    }

    auto checkResult = dh.check();
    if (checkResult == ncrypto::DHPointer::CheckResult::CHECK_FAILED) {
        return Bun::ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Checking DH parameters failed"_s);
    }

    JSC::Structure* structure = structureForNewTarget(globalObject, callFrame->newTarget(), &Zig::GlobalObject::m_JSDiffieHellmanGroupClassStructure);
    RETURN_IF_EXCEPTION(scope, {});

    return JSC::JSValue::encode(JSDiffieHellmanGroup::create(vm, structure, globalObject, WTF::move(dh), static_cast<int>(checkResult)));
}

} // namespace Bun
