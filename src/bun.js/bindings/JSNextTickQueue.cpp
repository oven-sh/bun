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
#include "NodeValidator.h"
#include "ZigGlobalObject.h"
#include "BunProcess.h"
namespace Bun {

using namespace JSC;

class JSNextTickQueueEntry : public JSC::JSInternalFieldObjectImpl<5> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<5>;
    static constexpr bool needsDestruction = false;

    static JSNextTickQueueEntry* create(JSC::VM& vm, JSC::Structure* structure)
    {
        JSNextTickQueueEntry* entry = new (NotNull, JSC::allocateCell<JSNextTickQueueEntry>(vm)) JSNextTickQueueEntry(vm, structure);
        entry->finishCreation(vm);
        return entry;
    }

    static JSNextTickQueueEntry* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject, JSC::JSValue callback, JSC::JSValue args, JSC::JSValue frame, JSC::JSValue callee, BytecodeIndex bytecodeIndex)
    {
        JSNextTickQueueEntry* entry = JSNextTickQueueEntry::create(vm, structure);
        entry->internalField(static_cast<unsigned>(Fields::Callback)).set(vm, entry, callback);
        entry->internalField(static_cast<unsigned>(Fields::Args)).set(vm, entry, args);
        entry->internalField(static_cast<unsigned>(Fields::Frame)).set(vm, entry, frame);
        entry->internalField(static_cast<unsigned>(Fields::Callee)).set(vm, entry, callee);
        entry->m_bytecodeIndex = bytecodeIndex;
        return entry;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFieldTupleType, StructureFlags), info());
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    enum class Fields : unsigned {
        Callback = 0,
        Args = 1,
        Frame = 2,
        Callee = 3,
    };

    BytecodeIndex m_bytecodeIndex;

    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return WebCore::subspaceForImpl<JSNextTickQueueEntry, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSNextTickQueueEntry.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSNextTickQueueEntry = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSNextTickQueueEntry.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSNextTickQueueEntry = std::forward<decltype(space)>(space); });
    }

private:
    JSNextTickQueueEntry(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
    }
};

const JSC::ClassInfo JSNextTickQueueEntry::s_info = { "NextTickQueueEntry"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNextTickQueueEntry) };

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

JSC_DEFINE_HOST_FUNCTION(jsFunctionCreateNextTickQueueEntry, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue callback;
    RETURN_IF_EXCEPTION(scope, {});

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    ArgList args;
    BytecodeIndex bytecodeIndex = BytecodeIndex();
    JSValue functionExecutableValue = jsUndefined();
    if (auto* callerFrame = callFrame->callerFrame()) {
        callback = callerFrame->argument(0);
        args = callFrame->argumentCount() > 1 ? JSC::ArgList(callFrame, 1) : JSC::ArgList();

        if (auto* calleeObject = callerFrame->jsCallee()) {
            if (auto* callee = jsDynamicCast<JSFunction*>(calleeObject)) {
                if (callee->isNonBoundHostFunction()) {
                    if (auto* executable = callee->jsExecutable()) {
                        functionExecutableValue = executable;
                        bytecodeIndex = callerFrame->bytecodeIndex();
                    }
                }
            }
        }
    }

    JSC::JSValue argsValue = jsUndefined();
    if (args.size() > 0) {
        argsValue = JSC::constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), args);
    }
    auto* asyncContext = globalObject->m_asyncContextData.get();
    auto frame = asyncContext->getInternalField(0);

    auto* processObject = jsCast<Process*>(globalObject->processObject());
    auto* structure = processObject->nextTickQueueEntryStructure();

    auto entry = JSNextTickQueueEntry::create(vm, structure, lexicalGlobalObject, callback, argsValue, frame, functionExecutableValue, bytecodeIndex);
    return JSValue::encode(entry);
}

template<typename Visitor>
void JSNextTickQueueEntry::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSNextTickQueueEntry* thisObject = jsCast<JSNextTickQueueEntry*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSNextTickQueueEntry);

}
