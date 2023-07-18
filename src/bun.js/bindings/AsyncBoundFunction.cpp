#pragma once

#include "root.h"
#include "ZigGlobalObject.h"
#include "AsyncBoundFunction.h"
#include "JavaScriptCore/InternalFieldTuple.h"

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

AsyncBoundFunction* AsyncBoundFunction::create(JSGlobalObject* global, JSValue callback, JSValue context)
{
    auto& vm = global->vm();
    AsyncBoundFunction* asyncContextData = new (NotNull, allocateCell<AsyncBoundFunction>(vm)) AsyncBoundFunction(vm, static_cast<Zig::GlobalObject*>(global)->AsyncBoundFunctionStructure());
    asyncContextData->finishCreation(vm);
    asyncContextData->callback.set(vm, asyncContextData, callback);
    asyncContextData->context.set(vm, asyncContextData, context);
    return asyncContextData;
}

JSC::Structure* AsyncBoundFunction::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, jsNull(), TypeInfo(ObjectType, StructureFlags), info());
}

JSValue AsyncBoundFunction::snapshotAsyncCallback(JSGlobalObject* globalObject, JSValue callback)
{
    JSValue context = globalObject->m_asyncContextData.get()->getInternalField(0);

    // If there is no async context, do not snapshot the callback.
    if (context.isUndefined()) {
        return callback;
    }

    // Construct a low-overhead wrapper
    auto& vm = globalObject->vm();
    return AsyncBoundFunction::create(
        vm,
        static_cast<Zig::GlobalObject*>(globalObject)->AsyncBoundFunctionStructure(),
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

extern "C" EncodedJSValue AsyncBoundFunction__snapshotAsyncCallback(JSGlobalObject* globalObject, EncodedJSValue callback)
{
    return JSValue::encode(AsyncBoundFunction::snapshotAsyncCallback(globalObject, JSValue::decode(callback)));
}

#define ASYNCBOUNDFUNCTION_CALL_IMPL(...)                                     \
    if (!functionObject.isCell())                                             \
        return jsUndefined();                                                 \
    auto& vm = global->vm();                                                  \
    JSValue restoreAsyncContext;                                              \
    InternalFieldTuple* asyncContextData = nullptr;                           \
    if (auto* wrapper = jsDynamicCast<AsyncBoundFunction*>(functionObject)) { \
        functionObject = jsCast<JSC::JSObject*>(wrapper->callback.get());     \
        asyncContextData = global->m_asyncContextData.get();                  \
        restoreAsyncContext = asyncContextData->getInternalField(0);          \
        asyncContextData->putInternalField(vm, 0, wrapper->context.get());    \
    }                                                                         \
    auto result = JSC::call(__VA_ARGS__);                                     \
    if (asyncContextData) {                                                   \
        asyncContextData->putInternalField(vm, 0, restoreAsyncContext);       \
    }                                                                         \
    return result;

JSValue AsyncBoundFunction::call(JSGlobalObject* global, JSValue functionObject, const ArgList& args, ASCIILiteral errorMessage)
{
    ASYNCBOUNDFUNCTION_CALL_IMPL(global, functionObject, args, errorMessage);
}
JSValue AsyncBoundFunction::call(JSGlobalObject* global, JSValue functionObject, JSValue thisValue, const ArgList& args, ASCIILiteral errorMessage)
{
    ASYNCBOUNDFUNCTION_CALL_IMPL(global, functionObject, thisValue, args, errorMessage);
}
JSValue AsyncBoundFunction::call(JSGlobalObject* global, JSValue functionObject, JSValue thisValue, const ArgList& args)
{
    ASYNCBOUNDFUNCTION_CALL_IMPL(global, functionObject, getCallData(functionObject.asCell()), thisValue, args);
}
JSValue AsyncBoundFunction::call(JSGlobalObject* global, JSValue functionObject, JSValue thisValue, const ArgList& args, NakedPtr<Exception>& returnedException)
{
    ASYNCBOUNDFUNCTION_CALL_IMPL(global, functionObject, getCallData(functionObject.asCell()), thisValue, args, returnedException);
}

#undef ASYNCBOUNDFUNCTION_CALL_IMPL
