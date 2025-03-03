#include "root.h"

#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JavaScriptCore/JSInternalPromise.h"
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
    return WebCore::subspaceForImpl<JSNextTickQueue, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSNextTickQueue.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSNextTickQueue = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSNextTickQueue.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSNextTickQueue = std::forward<decltype(space)>(space); });
}

JSNextTickQueue* JSNextTickQueue::create(VM& vm, Structure* structure)
{
    JSNextTickQueue* mod = new (NotNull, allocateCell<JSNextTickQueue>(vm)) JSNextTickQueue(vm, structure);
    mod->finishCreation(vm);
    return mod;
}
Structure* JSNextTickQueue::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
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
    auto* thisObject = jsCast<JSNextTickQueue*>(cell);
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

void JSNextTickQueue::drain(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    bool mustResetContext = false;
    if (isEmpty()) {
        vm.drainMicrotasks();
        mustResetContext = true;
    }

    if (!isEmpty()) {
        if (mustResetContext) {
            globalObject->m_asyncContextData.get()->putInternalField(vm, 0, jsUndefined());
        }
        auto* drainFn = internalField(2).get().getObject();
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        MarkedArgumentBuffer drainArgs;
        JSC::call(globalObject, drainFn, drainArgs, "Failed to drain next tick queue"_s);
    }
}

}
