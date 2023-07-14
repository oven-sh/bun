#pragma once

#include "root.h"
#include "ZigGlobalObject.h"
#include "AsyncBoundFunction.h"
#include "JavaScriptCore/AsyncContextData.h"

namespace Bun {

using namespace JSC;
using namespace WebCore;

const ClassInfo AsyncBoundFunction::s_info = { "AsyncBoundFunction"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(AsyncBoundFunction) };

AsyncBoundFunction* AsyncBoundFunction::create(VM& vm, JSC::Structure* structure, JSValue callback, JSValue context)
{

    AsyncBoundFunction* asyncContextData = new (NotNull, allocateCell<AsyncBoundFunction>(vm)) AsyncBoundFunction(vm, structure);
    asyncContextData->finishCreation(vm);
    asyncContextData->callback.set(vm, asyncContextData, callback);
    asyncContextData->context.set(vm, asyncContextData, context);
    return asyncContextData;
}

JSValue AsyncBoundFunction::snapshotCallback(JSGlobalObject* globalObject, JSValue callback)
{
    JSValue context = globalObject->m_asyncContextData.get()->internalValue();

    // If there is no async context, do not snapshot the callback.
    if (context.isUndefined()) {
        return callback;
    }

    // Construct a low-overhead wrapper
    auto& vm = globalObject->vm();
    return AsyncBoundFunction::create(
        vm,
        globalObject->nullPrototypeObjectStructure(),
        callback,
        context);
}

template<typename Visitor>
void AsyncBoundFunction::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<AsyncBoundFunction*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->callback);
    visitor.append(thisObject->context);
}

DEFINE_VISIT_CHILDREN(AsyncBoundFunction);

extern "C" EncodedJSValue AsyncBoundFunction__snapshotCallback(JSGlobalObject* globalObject, EncodedJSValue callback)
{
    return JSValue::encode(Bun::AsyncBoundFunction::snapshotCallback(globalObject, JSValue::decode(callback)));
}

} // namespace Bun
