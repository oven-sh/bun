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

    // Get the appropriate structure and create the DiffieHellmanGroup object
    auto* zigGlobalObject = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSDiffieHellmanGroupClassStructure.get(zigGlobalObject);
    JSC::JSValue newTarget = callFrame->newTarget();

    if (zigGlobalObject->m_JSDiffieHellmanGroupClassStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!newTarget) {
            throwError(globalObject, scope, ErrorCode::ERR_INVALID_THIS, "Class constructor DiffieHellmanGroup cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(JSC::getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = JSC::InternalFunction::createSubclassStructure(
            globalObject, newTarget.getObject(), functionGlobalObject->m_JSDiffieHellmanGroupClassStructure.get(functionGlobalObject));
        scope.release();
    }

    return JSC::JSValue::encode(JSDiffieHellmanGroup::create(vm, structure, globalObject, WTFMove(dh)));
}

} // namespace Bun
