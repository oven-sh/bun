#include "root.h"
#include "ZigGlobalObject.h"
#include "AsyncContextFrame.h"
#include <JavaScriptCore/InternalFieldTuple.h>

#if ASSERT_ENABLED
#include <JavaScriptCore/IntegrityInlines.h>
#endif

using namespace JSC;
using namespace WebCore;

const ClassInfo AsyncContextFrame::s_info = { "AsyncContextFrame"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(AsyncContextFrame) };

AsyncContextFrame* AsyncContextFrame::create(VM& vm, JSC::Structure* structure, JSValue callback, JSValue context)
{
    AsyncContextFrame* asyncContextData = new (NotNull, allocateCell<AsyncContextFrame>(vm)) AsyncContextFrame(vm, structure, callback, context);
    asyncContextData->finishCreation(vm);
    return asyncContextData;
}

AsyncContextFrame* AsyncContextFrame::create(JSGlobalObject* global, JSValue callback, JSValue context)
{
    auto& vm = global->vm();
    ASSERT(callback.isCallable());
    auto* structure = jsCast<Zig::GlobalObject*>(global)->AsyncContextFrameStructure();
    AsyncContextFrame* asyncContextData = new (NotNull, allocateCell<AsyncContextFrame>(vm)) AsyncContextFrame(vm, structure, callback, context);
    asyncContextData->finishCreation(vm);
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

#if ASSERT_ENABLED
void auditEverything(JSGlobalObject* globalObject, JSValue value, JSValue thisValue, const ArgList& args)
{

    auto& vm = globalObject->vm();
    ASSERT_WITH_MESSAGE(!value.isEmpty(), "Value is JSValue.zero. This will cause a crash.");
    ASSERT_WITH_MESSAGE(value.isCell(), "AsyncContextFrame value is not a cell. This will cause a crash.");
    ASSERT_WITH_MESSAGE(!thisValue.isEmpty(), "This value is JSValue.zero. This will cause a crash.");
    JSC::Integrity::auditCellFully(vm, value.asCell());
    if (thisValue.isCell()) {
        JSC::Integrity::auditCellFully(vm, thisValue.asCell());
    }

    for (size_t i = 0; i < args.size(); i++) {
        ASSERT_WITH_MESSAGE(!args.at(i).isEmpty(), "arguments[%lu] is JSValue.zero. This will cause a crash.", i);
        if (args.at(i).isCell()) {
            JSC::Integrity::auditCellFully(vm, args.at(i).asCell());
        }
    }
}
#endif

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
#if ASSERT_ENABLED
    auditEverything(global, functionObject, thisValue, args);
#endif

    if (!global->isAsyncContextTrackingEnabled()) [[likely]] {
        return JSC::profiledCall(global, ProfilingReason::API, functionObject, JSC::getCallData(functionObject), thisValue, args);
    }

    ASYNCCONTEXTFRAME_CALL_IMPL(global, ProfilingReason::API, functionObject, JSC::getCallData(functionObject), thisValue, args);
}
JSValue AsyncContextFrame::call(JSGlobalObject* global, JSValue functionObject, JSValue thisValue, const ArgList& args, NakedPtr<Exception>& returnedException)
{
#if ASSERT_ENABLED
    auditEverything(global, functionObject, thisValue, args);
#endif

    if (!global->isAsyncContextTrackingEnabled()) [[likely]] {
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

JSC::JSValue AsyncContextFrame::run(JSGlobalObject* global, JSValue functionObject, JSValue thisValue, const ArgList& args)
{
    ASSERT(global->isAsyncContextTrackingEnabled());
#if ASSERT_ENABLED
    auditEverything(global, functionObject, thisValue, args);
#endif
    ASYNCCONTEXTFRAME_CALL_IMPL(global, ProfilingReason::API, functionObject, JSC::getCallData(functionObject), thisValue, args);
}
#undef ASYNCCONTEXTFRAME_CALL_IMPL
