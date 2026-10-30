#include "root.h"
#include "ZigGlobalObject.h"
#include "AsyncContextFrame.h"
#include "BunClientData.h"
#include "ModuleGraph.h"
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

// For the test runner, which starts the next hook or test from inside the report of an uncaught error. The async
// context of the callback that failed can still be current there (AsyncContextFrame::CallScope). These two leave it
// for that step: `saved` holds the current async context and the one a microtask checkpoint resets it to.
extern "C" void AsyncContextFrame__leaveForTestStep(JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue* saved)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    saved[0] = JSValue::encode(globalObject->m_asyncContextData.get()->getInternalField(0));
    saved[1] = JSValue::encode(Bun::moduleGraphAsyncContextAtEventLoop(globalObject));
    setCurrentAsyncContext(globalObject, jsUndefined());
}

extern "C" void AsyncContextFrame__returnFromTestStep(JSGlobalObject* lexicalGlobalObject, const JSC::EncodedJSValue* saved)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    globalObject->m_asyncContextData.get()->putInternalField(globalObject->vm(), 0, JSValue::decode(saved[0]));
    Bun::noteEnteredFromEventLoop(globalObject, JSValue::decode(saved[1]));
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

bool AsyncContextFrame::isOfStoppedModuleGraph(JSGlobalObject* globalObject) const
{
    return Bun::shouldDropCallbackOfStoppedModuleGraph(defaultGlobalObject(globalObject), context.get());
}

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

    if (!functionObject.isCell())
        return jsUndefined();
    auto& vm = global->vm();
    if (WebCore::clientData(vm)->isStoppingOrStopped(vm)) [[unlikely]]
        return jsUndefined();
    if (Bun::isFromRetiredTestIsolationRealm(functionObject)) [[unlikely]]
        return jsUndefined();
    CallScope asyncContext(vm, global, functionObject);
    if (asyncContext.calleeIsOfStoppedModuleGraph()) [[unlikely]]
        return jsUndefined();
    return JSC::profiledCall(global, ProfilingReason::API, functionObject, JSC::getCallData(functionObject), thisValue, args);
}
JSValue AsyncContextFrame::profiledCall(JSGlobalObject* global, JSValue functionObject, JSValue thisValue, const ArgList& args)
{
    return AsyncContextFrame::call(global, functionObject, thisValue, args);
}
