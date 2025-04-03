#include "JSDiffieHellman.h"
#include "JSDiffieHellmanPrototype.h"
#include "JSDiffieHellmanConstructor.h"
#include "DOMIsoSubspaces.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/ObjectPrototype.h>
#include "JSDOMExceptionHandling.h"

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsDiffieHellmanGetter_verifyError);

const JSC::ClassInfo JSDiffieHellman::s_info = { "DiffieHellman"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDiffieHellman) };

void JSDiffieHellman::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    JSC_NATIVE_GETTER("verifyError"_s, jsDiffieHellmanGetter_verifyError, PropertyAttribute::ReadOnly | PropertyAttribute::Accessor);

    m_sizeForGC = this->m_dh.size();
    vm.heap.reportExtraMemoryAllocated(this, m_sizeForGC);
}

template<typename Visitor>
void JSDiffieHellman::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSDiffieHellman* thisObject = jsCast<JSDiffieHellman*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.reportExtraMemoryVisited(thisObject->m_sizeForGC);
}

DEFINE_VISIT_CHILDREN(JSDiffieHellman);

void setupDiffieHellmanClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSDiffieHellmanPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSDiffieHellmanPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSDiffieHellmanConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSDiffieHellmanConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSDiffieHellman::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

JSC_DEFINE_HOST_FUNCTION(jsDiffieHellmanGetter_verifyError, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();

    JSDiffieHellman* thisObject = JSC::jsDynamicCast<JSDiffieHellman*>(thisValue);
    if (UNLIKELY(!thisObject)) {
        throwVMTypeError(globalObject, scope);
        return {};
    }

    auto& dh = thisObject->getImpl();
    auto result = dh.check();
    if (result == ncrypto::DHPointer::CheckResult::CHECK_FAILED) {
        return Bun::ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Checking DH parameters failed"_s);
    }

    return JSC::JSValue::encode(JSC::jsNumber(static_cast<int>(result)));
}

} // namespace Bun
