#include "root.h"
#include "ZigGlobalObject.h"
#include "AsyncContextFrame.h"
#include "BunClientData.h"
#include "ModuleGraph.h"
#include "node/NodeTimers.h"
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
    auto* structure = uncheckedDowncast<Zig::GlobalObject>(global)->AsyncContextFrameStructure();
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

    // If already wrapped in an AsyncContextFrame, return as-is to avoid double-wrapping.
    if (dynamicDowncast<AsyncContextFrame>(callback)) {
        return callback;
    }

    // Construct a low-overhead wrapper
    auto& vm = JSC::getVM(globalObject);
    return AsyncContextFrame::create(
        vm,
        uncheckedDowncast<Zig::GlobalObject>(globalObject)->AsyncContextFrameStructure(),
        callback,
        context);
}

JSValue AsyncContextFrame::withGraphContextIfNeeded(JSGlobalObject* globalObject, JSValue callback)
{
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSObject* graphFrame = Bun::currentModuleGraphFrame(zigGlobalObject);
    if (!graphFrame || dynamicDowncast<AsyncContextFrame>(callback))
        return callback;
    return AsyncContextFrame::create(JSC::getVM(globalObject), zigGlobalObject->AsyncContextFrameStructure(), callback, graphFrame);
}

static void setCurrentAsyncContext(JSGlobalObject* globalObject, JSValue asyncContext)
{
    globalObject->m_asyncContextData.get()->putInternalField(globalObject->vm(), 0, asyncContext);
    // A nested ModuleGraphContextScope records the context it restores on exit. Record ours too, or that entry goes stale.
    if (auto* zigGlobalObject = dynamicDowncast<Zig::GlobalObject>(globalObject))
        Bun::noteEnteredFromEventLoop(zigGlobalObject, asyncContext);
}

AsyncContextScope::AsyncContextScope(JSGlobalObject* globalObject, JSValue snapshot)
{
    if (!snapshot || snapshot.isUndefinedOrNull())
        return;
    m_globalObject = globalObject;
    m_previous = globalObject->m_asyncContextData.get()->getInternalField(0);
    if (snapshot != m_previous)
        setCurrentAsyncContext(globalObject, snapshot);
}

AsyncContextScope::~AsyncContextScope()
{
    if (m_globalObject)
        setCurrentAsyncContext(m_globalObject, m_previous);
}

template<typename Visitor>
void AsyncContextFrame::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<AsyncContextFrame>(cell);
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

extern "C" JSC::EncodedJSValue AsyncContextFrame__withGraphContextIfNeeded(JSGlobalObject* globalObject, JSC::EncodedJSValue callback)
{
    return JSValue::encode(AsyncContextFrame::withGraphContextIfNeeded(globalObject, JSValue::decode(callback)));
}

// The function withAsyncContextIfNeeded() / withGraphContextIfNeeded() was given: what a getter hands back to script.
extern "C" JSC::EncodedJSValue AsyncContextFrame__callbackOf(JSC::EncodedJSValue stored)
{
    JSValue value = JSValue::decode(stored);
    if (auto* wrapper = dynamicDowncast<AsyncContextFrame>(value))
        return JSValue::encode(wrapper->callback.get());
    return stored;
}

// ─── The async context of a handle ───────────────────────────────────────────────────
//
// A node:net socket's handle keeps the async context it was made in, as node's HandleWrap does, and
// what script hands it to call later (the close callback) runs there, whoever closes it. Each of
// these is called by a host function of the handle, so script is on the stack.

extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue AsyncContextFrame__current(JSC::JSGlobalObject* globalObject)
{
    return JSValue::encode(globalObject->m_asyncContextData.get()->getInternalField(0));
}

// The frame that entered the Bun.ModuleGraph context `stored` (what withAsyncContextIfNeeded() returned)
// was handed over in; undefined when that was in no graph's.
extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue AsyncContextFrame__graphFrameOf(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue stored)
{
    if (auto* wrapper = dynamicDowncast<AsyncContextFrame>(JSValue::decode(stored))) {
        if (auto* frame = Bun::moduleGraphFrameOf(defaultGlobalObject(globalObject), wrapper->context.get()))
            return JSValue::encode(frame);
    }
    return JSValue::encode(jsUndefined());
}

extern "C" [[ZIG_EXPORT(nothrow)]] bool AsyncContextFrame__isInCurrentModuleGraph(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue context)
{
    return Bun::areInSameModuleGraph(defaultGlobalObject(globalObject), JSValue::decode(context), globalObject->m_asyncContextData.get()->getInternalField(0));
}

namespace {
// Unlike AsyncContextScope, undefined is a context to enter: none.
class HandleAsyncContextScope {
    WTF_MAKE_NONCOPYABLE(HandleAsyncContextScope);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    HandleAsyncContextScope(JSGlobalObject* globalObject, JSValue context)
        : m_globalObject(globalObject)
        , m_previous(globalObject->m_asyncContextData.get()->getInternalField(0))
        , m_entered(m_previous != context)
    {
        if (m_entered)
            globalObject->m_asyncContextData.get()->putInternalField(globalObject->vm(), 0, context);
    }

    ~HandleAsyncContextScope()
    {
        if (m_entered)
            m_globalObject->m_asyncContextData.get()->putInternalField(m_globalObject->vm(), 0, m_previous);
    }

private:
    JSGlobalObject* m_globalObject;
    JSValue m_previous;
    bool m_entered;
};
}

// `callFrame->argument(first)(...the arguments after it)`, with `context` as the async context.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue AsyncContextFrame__callInContext(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue context, JSC::CallFrame* callFrame, unsigned first)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue function = callFrame->argument(first);
    auto callData = JSC::getCallData(function);
    if (callData.type == CallData::Type::None) [[unlikely]] {
        throwTypeError(globalObject, scope, "Expected a function"_s);
        return {};
    }
    HandleAsyncContextScope contextScope(globalObject, JSValue::decode(context));
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::profiledCall(globalObject, ProfilingReason::API, function, callData, jsUndefined(), ArgList(callFrame, first + 1))));
}

// `setImmediate(callFrame->argument(first), ...the arguments after it)`, queued with `context` as the
// async context: the immediate runs there, and belongs to the Bun.ModuleGraph that context is in.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue AsyncContextFrame__setImmediateInContext(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue context, JSC::CallFrame* callFrame, unsigned first)
{
    HandleAsyncContextScope contextScope(globalObject, JSValue::decode(context));
    return Bun::setImmediateFromCallFrame(globalObject, callFrame, first);
}

#define ASYNCCONTEXTFRAME_CALL_IMPL(...)                                                                                   \
    if (!functionObject.isCell())                                                                                          \
        return jsUndefined();                                                                                              \
    auto& vm = global->vm();                                                                                               \
    if (WebCore::clientData(vm)->isStoppingOrStopped(vm)) [[unlikely]]                                                     \
        return jsUndefined();                                                                                              \
    if (Bun::isFromRetiredTestIsolationRealm(functionObject)) [[unlikely]]                                                 \
        return jsUndefined();                                                                                              \
    JSValue restoreAsyncContext;                                                                                           \
    InternalFieldTuple* asyncContextData = nullptr;                                                                        \
    if (auto* wrapper = dynamicDowncast<AsyncContextFrame>(functionObject)) {                                              \
        if (Bun::shouldDropCallbackOfStoppedModuleGraph(defaultGlobalObject(global), wrapper->context.get())) [[unlikely]] \
            return jsUndefined();                                                                                          \
        functionObject = uncheckedDowncast<JSC::JSObject>(wrapper->callback.get());                                        \
        asyncContextData = global->m_asyncContextData.get();                                                               \
        restoreAsyncContext = asyncContextData->getInternalField(0);                                                       \
        asyncContextData->putInternalField(vm, 0, wrapper->context.get());                                                 \
    }                                                                                                                      \
    auto result = JSC::profiledCall(__VA_ARGS__);                                                                          \
    if (asyncContextData) {                                                                                                \
        asyncContextData->putInternalField(vm, 0, restoreAsyncContext);                                                    \
    }                                                                                                                      \
    return result;

JSValue AsyncContextFrame::call(JSGlobalObject* global, JSValue functionObject, JSValue thisValue, const ArgList& args)
{
#if ASSERT_ENABLED
    auditEverything(global, functionObject, thisValue, args);
#endif

    if (!global->isAsyncContextTrackingEnabled()) [[likely]] {
        if (WebCore::clientData(global->vm())->isStoppingOrStopped(global->vm()) || Bun::isFromRetiredTestIsolationRealm(functionObject)) [[unlikely]]
            return jsUndefined();
        return JSC::profiledCall(global, ProfilingReason::API, functionObject, JSC::getCallData(functionObject), thisValue, args);
    }

    ASYNCCONTEXTFRAME_CALL_IMPL(global, ProfilingReason::API, functionObject, JSC::getCallData(functionObject), thisValue, args);
}
JSValue AsyncContextFrame::profiledCall(JSGlobalObject* global, JSValue functionObject, JSValue thisValue, const ArgList& args)
{
    return AsyncContextFrame::call(global, functionObject, thisValue, args);
}
#undef ASYNCCONTEXTFRAME_CALL_IMPL
