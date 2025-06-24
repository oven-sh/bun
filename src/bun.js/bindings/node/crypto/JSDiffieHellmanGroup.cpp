#include "JSDiffieHellmanGroup.h"
#include "JSDiffieHellmanGroupPrototype.h"
#include "JSDiffieHellmanGroupConstructor.h"
#include "DOMIsoSubspaces.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/ObjectPrototype.h>

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanGroupGetter_verifyError);

const JSC::ClassInfo JSDiffieHellmanGroup::s_info = { "DiffieHellmanGroup"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDiffieHellmanGroup) };

void JSDiffieHellmanGroup::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    JSC_NATIVE_GETTER("verifyError"_s, jsDiffieHellmanGroupGetter_verifyError, PropertyAttribute::ReadOnly | PropertyAttribute::Accessor);

    m_sizeForGC = this->m_dh.size();
    vm.heap.reportExtraMemoryAllocated(this, m_sizeForGC);
}

template<typename Visitor>
void JSDiffieHellmanGroup::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSDiffieHellmanGroup* thisObject = jsCast<JSDiffieHellmanGroup*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.reportExtraMemoryVisited(thisObject->m_sizeForGC);
}

DEFINE_VISIT_CHILDREN(JSDiffieHellmanGroup);

void setupDiffieHellmanGroupClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSDiffieHellmanGroupPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSDiffieHellmanGroupPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSDiffieHellmanGroupConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSDiffieHellmanGroupConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSDiffieHellmanGroup::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanGroupGetter_verifyError, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();

    JSDiffieHellmanGroup* thisObject = jsDynamicCast<JSDiffieHellmanGroup*>(thisValue);
    if (!thisObject) {
        throwVMTypeError(globalObject, scope);
    }

    auto& dh = thisObject->getImpl();
    auto result = dh.check();
    if (result == ncrypto::DHPointer::CheckResult::CHECK_FAILED) {
        return ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Checking DH parameters failed"_s);
    }

    return JSValue::encode(JSC::jsNumber(static_cast<int>(result)));
}

} // namespace Bun
