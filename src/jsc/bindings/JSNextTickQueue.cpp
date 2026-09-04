#include "root.h"

#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/LazyPropertyInlines.h"
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/GetterSetter.h>

#include "JSNextTickQueue.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/JSInternalFieldObjectImplInlines.h>
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "BunClientData.h"

namespace Bun {

using namespace JSC;

const JSC::ClassInfo JSNextTickQueue::s_info = { "NextTickQueue"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNextTickQueue) };

template<typename, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSNextTickQueue::subspaceFor(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSNextTickQueue, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSNextTickQueue, m_subspaceForJSNextTickQueue));
}

JSNextTickQueue* JSNextTickQueue::create(VM& vm, Structure* structure)
{
    JSNextTickQueue* mod = new (NotNull, allocateCell<JSNextTickQueue>(vm)) JSNextTickQueue(vm, structure);
    mod->finishCreation(vm);
    return mod;
}
Structure* JSNextTickQueue::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

JSNextTickQueue::JSNextTickQueue(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSNextTickQueue::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
}

template<typename Visitor>
void JSNextTickQueue::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSNextTickQueue>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSNextTickQueue);

JSNextTickQueue* JSNextTickQueue::create(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto* obj = create(vm, createStructure(vm, globalObject, jsNull()));
    return obj;
}

bool JSNextTickQueue::isEmpty()
{
    return !internalField(0) || internalField(0).get().asNumber() == 0;
}

void JSNextTickQueue::discard(JSC::VM& vm)
{
    internalField(0).set(vm, this, jsNumber(0));
    internalField(2).set(vm, this, jsUndefined());
}

void JSNextTickQueue::drain(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (isEmpty()) {
        RETURN_IF_EXCEPTION(throwScope, );
        vm.drainMicrotasks();
        RETURN_IF_EXCEPTION(throwScope, );
    }

    if (!isEmpty()) {
        RETURN_IF_EXCEPTION(throwScope, );
        auto* drainFn = internalField(2).get().getObject();
        if (!drainFn)
            return; // discarded at teardown
        MarkedArgumentBuffer drainArgs;
        JSC::call(globalObject, drainFn, drainArgs, "Failed to drain next tick queue"_s);
        RETURN_IF_EXCEPTION(throwScope, );
    }
}

}
