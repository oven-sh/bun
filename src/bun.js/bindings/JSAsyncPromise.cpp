
#include "root.h"

#include "helpers.h"

#include "JavaScriptCore/Exception.h"
#include "JavaScriptCore/Interpreter.h"
#include "JavaScriptCore/JSCJSValue.h"

#include "BunClientData.h"

#include "wtf/Assertions.h"
#include "ZigGlobalObject.h"

#include "BunClientData.h"
#include "JavaScriptCore/SlotVisitorMacros.h"
#include "JavaScriptCore/WriteBarrier.h"
#include "wtf/IsoMallocInlines.h"
#include <JavaScriptCore/JSCell.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/StackFrame.h>

#include "JSAsyncPromise.h"

namespace Bun {

using namespace JSC;

const ClassInfo JSAsyncPromise::s_info = { "AsyncPromise"_s, nullptr, nullptr, nullptr, CREATE_METHOD_TABLE(JSAsyncPromise) };

JSAsyncPromise* JSAsyncPromise::create(JSC::VM& vm, Zig::GlobalObject* bunGlobalObject)
{
    auto* structure = bunGlobalObject->m_JSAsyncPromiseStructure.get(bunGlobalObject);
    if (UNLIKELY(!structure)) {
        return nullptr;
    }
    auto promise = JSPromise::create(vm, bunGlobalObject->promiseStructure());
    auto* thisObject = new (NotNull, JSC::allocateCell<JSAsyncPromise>(vm)) JSAsyncPromise(vm, structure, promise);
    thisObject->finishCreation(vm);
    if (UNLIKELY(!thisObject)) {
        return nullptr;
    }
    Vector<StackFrame> stackFrames;
    vm.interpreter.getStackTrace(thisObject, stackFrames, 0);

    StackFrame* lastBuiltinFrame = nullptr;
    bool didPickAGoodFrame = false;
    for (auto& frame : stackFrames) {
        if (frame.hasLineAndColumnInfo()) {
            if (auto* callee = frame.codeBlock()) {
                auto* unlinked = callee->unlinkedCodeBlock();
                if (unlinked && unlinked->isBuiltinFunction()) {
                    lastBuiltinFrame = &frame;
                    continue;
                }
            }
            didPickAGoodFrame = true;
            thisObject->frame = frame;
            break;
        }
    }

    if (!didPickAGoodFrame && lastBuiltinFrame) {
        thisObject->frame = *lastBuiltinFrame;
    }

    return thisObject;
}

void JSAsyncPromise::destroy(JSC::JSCell* cell)
{
    static_cast<JSAsyncPromise*>(cell)->JSAsyncPromise::destroy(cell);
}

void JSAsyncPromise::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
}

template<typename Visitor>
void JSAsyncPromise::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSAsyncPromise* thisObject = jsCast<JSAsyncPromise*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->promise);

    thisObject->frame.visitAggregate(visitor);
}

DEFINE_VISIT_CHILDREN(JSAsyncPromise);

void JSAsyncPromise::reject(VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    auto promise = this->promise.get();
    ASSERT(promise);

    if (this->frame.hasLineAndColumnInfo()) {
        if (auto* errorInstance = JSC::jsDynamicCast<JSC::ErrorInstance*>(value)) {
            auto* existingStackTrace = errorInstance->stackTrace();
            if (existingStackTrace != nullptr) {
                existingStackTrace->append(this->frame);
            } else {
                ASSERT_NOT_IMPLEMENTED_YET();
            }
        }
    }

    promise->reject(globalObject, value);
}

void JSAsyncPromise::resolve(VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    auto promise = this->promise.get();
    ASSERT(promise);
    promise->resolve(globalObject, value);
}

// We tried to pool these
// But it was very complicated
class AsyncPromise {
    WTF_MAKE_ISO_ALLOCATED(AsyncPromise);

public:
    AsyncPromise(JSC::VM& vm, JSAsyncPromise* value)
        : m_cell(vm, value)
    {
    }

    AsyncPromise()
        : m_cell()
    {
    }

    JSC::Strong<JSAsyncPromise> m_cell;
};

WTF_MAKE_ISO_ALLOCATED_IMPL(AsyncPromise);

extern "C" void Bun__AsyncPromise__delete(AsyncPromise* strongRef)
{
    delete strongRef;
}

extern "C" AsyncPromise* Bun__AsyncPromise__create(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    JSAsyncPromise* asyncPromise = JSAsyncPromise::create(globalObject->vm(), globalObject);
    return new AsyncPromise(vm, asyncPromise);
}

extern "C" JSC::EncodedJSValue Bun__AsyncPromise__get(AsyncPromise* strongRef)
{
    return JSC::JSValue::encode(strongRef->m_cell.get());
}

extern "C" void Bun__AsyncPromise__set(AsyncPromise* strongRef, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    strongRef->m_cell.set(globalObject->vm(), jsCast<JSAsyncPromise*>(JSC::JSValue::decode(value)));
}

extern "C" void Bun__AsyncPromise__clear(AsyncPromise* strongRef)
{
    strongRef->m_cell.clear();
}

extern "C" void Bun__AsyncPromise__resolve(AsyncPromise* strongRef, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    auto* asyncPromise = strongRef->m_cell.get();
    asyncPromise->resolve(globalObject->vm(), globalObject, JSC::JSValue::decode(value));
    strongRef->m_cell.clear();
}

extern "C" void Bun__AsyncPromise__reject(AsyncPromise* strongRef, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    auto* asyncPromise = strongRef->m_cell.get();
    asyncPromise->reject(globalObject->vm(), globalObject, JSC::JSValue::decode(value));
    strongRef->m_cell.clear();
}

extern "C" JSC::EncodedJSValue Bun__AsyncPromise__value(AsyncPromise* strongRef)
{
    if (!strongRef->m_cell) {
        return {};
    }

    auto* asyncPromise = strongRef->m_cell.get();
    return JSC::JSValue::encode(asyncPromise->promise.get());
}

extern "C" JSC::JSPromise* Bun__AsyncPromise__promise(AsyncPromise* strongRef)
{
    if (!strongRef->m_cell) {
        return nullptr;
    }

    auto* asyncPromise = strongRef->m_cell.get();
    return asyncPromise->promise.get();
}

JSC::Structure* createJSAsyncPromiseStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return JSAsyncPromise::createStructure(vm, globalObject);
}
}