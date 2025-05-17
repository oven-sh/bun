#include "root.h"
#include "ZigGlobalObject.h"
#include "AsyncContextFrame.h"
#include <JavaScriptCore/InternalFieldTuple.h>

using namespace JSC;
using namespace WebCore;

const ClassInfo AsyncContextFrame::s_info = { "AsyncContextFrame"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(AsyncContextFrame) };

AsyncContextFrame* AsyncContextFrame::create(VM& vm, JSC::Structure* structure, JSValue callback, JSValue context)
{
    AsyncContextFrame* asyncContextData = new (NotNull, allocateCell<AsyncContextFrame>(vm)) AsyncContextFrame(vm, structure);
    asyncContextData->finishCreation(vm);
    asyncContextData->callback.set(vm, asyncContextData, callback);
    asyncContextData->context.set(vm, asyncContextData, context);
    return asyncContextData;
}

AsyncContextFrame* AsyncContextFrame::create(JSGlobalObject* global, JSValue callback, JSValue context)
{
    auto& vm = global->vm();
    ASSERT(callback.isCallable());
    auto* structure = jsCast<Zig::GlobalObject*>(global)->AsyncContextFrameStructure();
    AsyncContextFrame* asyncContextData = new (NotNull, allocateCell<AsyncContextFrame>(vm)) AsyncContextFrame(vm, structure);
    asyncContextData->finishCreation(vm);
    asyncContextData->callback.set(vm, asyncContextData, callback);
    asyncContextData->context.set(vm, asyncContextData, context);
    return asyncContextData;
}

JSC::Structure* AsyncContextFrame::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, jsNull(), TypeInfo(ObjectType, StructureFlags), info());
}

JSValue AsyncContextFrame::withAsyncContextIfNeeded(JSGlobalObject* globalObject, JSValue callback)
{
    JSValue context = globalObject->m_asyncContextData.get()->getInternalField(0);

    // If there is no async context, do not snapshot the callback.
    if (context.isUndefined()) {
        return callback;
    }

    // Construct a low-overhead wrapper
    auto& vm = JSC::getVM(globalObject);
    return AsyncContextFrame::create(
        vm,
        jsCast<Zig::GlobalObject*>(globalObject)->AsyncContextFrameStructure(),
        callback,
        context);
}

template<typename Visitor>
void AsyncContextFrame::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<AsyncContextFrame*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->callback);
    visitor.append(thisObject->context);
}

DEFINE_VISIT_CHILDREN(AsyncContextFrame);

extern "C" JSC::EncodedJSValue AsyncContextFrame__withAsyncContextIfNeeded(JSGlobalObject* globalObject, JSC::EncodedJSValue callback)
{
    return JSValue::encode(AsyncContextFrame::withAsyncContextIfNeeded(globalObject, JSValue::decode(callback)));
}

#define ASYNCCONTEXTFRAME_CALL_IMPL(...)                                     \
    if (!functionObject.isCell())                                            \
        return jsUndefined();                                                \
    auto& vm = global->vm();                                                 \
    JSValue restoreAsyncContext;                                             \
    InternalFieldTuple* asyncContextData = nullptr;                          \
    if (auto* wrapper = jsDynamicCast<AsyncContextFrame*>(functionObject)) { \
        functionObject = jsCast<JSC::JSObject*>(wrapper->callback.get());    \
        asyncContextData = global->m_asyncContextData.get();                 \
        restoreAsyncContext = asyncContextData->getInternalField(0);         \
        asyncContextData->putInternalField(vm, 0, wrapper->context.get());   \
    }                                                                        \
    auto result = JSC::profiledCall(__VA_ARGS__);                            \
    if (asyncContextData) {                                                  \
        asyncContextData->putInternalField(vm, 0, restoreAsyncContext);      \
    }                                                                        \
    return result;

// JSValue AsyncContextFrame::call(JSGlobalObject* global, JSValue functionObject, const ArgList& args, ASCIILiteral errorMessage)
// {
//     ASYNCCONTEXTFRAME_CALL_IMPL(global, ProfilingReason::API, functionObject, args, errorMessage);
// }
// JSValue AsyncContextFrame::call(JSGlobalObject* global, JSValue functionObject, JSValue thisValue, const ArgList& args, ASCIILiteral errorMessage)
// {
//     ASYNCCONTEXTFRAME_CALL_IMPL(global, ProfilingReason::API, functionObject, thisValue, args, errorMessage);
// }
JSValue AsyncContextFrame::call(JSGlobalObject* global, JSValue functionObject, JSValue thisValue, const ArgList& args)
{
    if (LIKELY(!global->isAsyncContextTrackingEnabled())) {
        return JSC::profiledCall(global, ProfilingReason::API, functionObject, JSC::getCallData(functionObject), thisValue, args);
    }

    ASYNCCONTEXTFRAME_CALL_IMPL(global, ProfilingReason::API, functionObject, JSC::getCallData(functionObject), thisValue, args);
}
JSValue AsyncContextFrame::call(JSGlobalObject* global, JSValue functionObject, JSValue thisValue, const ArgList& args, NakedPtr<Exception>& returnedException)
{
    if (LIKELY(!global->isAsyncContextTrackingEnabled())) {
        return JSC::profiledCall(global, ProfilingReason::API, functionObject, JSC::getCallData(functionObject), thisValue, args, returnedException);
    }

    ASYNCCONTEXTFRAME_CALL_IMPL(global, ProfilingReason::API, functionObject, JSC::getCallData(functionObject), thisValue, args, returnedException);
}
JSValue AsyncContextFrame::profiledCall(JSGlobalObject* global, JSValue functionObject, JSValue thisValue, const ArgList& args)
{
    return AsyncContextFrame::call(global, functionObject, thisValue, args);
}
JSValue AsyncContextFrame::profiledCall(JSGlobalObject* global, JSValue functionObject, JSValue thisValue, const ArgList& args, NakedPtr<Exception>& returnedException)
{
    return AsyncContextFrame::call(global, functionObject, thisValue, args, returnedException);
}

#undef ASYNCCONTEXTFRAME_CALL_IMPL
