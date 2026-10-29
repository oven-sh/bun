#include "root.h"
#include "ZigGlobalObject.h"
#include "AsyncContextFrame.h"
#include "BunClientData.h"
#include "ModuleGraph.h"
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/ObjectConstructor.h>

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

// ─── bun test: the test that owns an error ───────────────────────────────────────────
//
// Tests that run concurrently share the runner's cursor, so the runner cannot tell from its own
// state whose timer or promise an error comes from. It calls each of those test bodies inside a
// frame that binds the file's key to an id for that call. What the body starts captures the
// frame, and the runner looks an error up in the context it was thrown or rejected in.
// (Execution.rs: `owner_key`.)

// The key of a test file. From here on the realm captures async contexts, and a promise
// rejected with no handler keeps the one it was rejected in.
extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__TestOwner__createKey(JSC::JSGlobalObject* lexicalGlobalObject)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    globalObject->setAsyncContextTrackingEnabled(true);
    globalObject->keepAsyncContextOfRejectedPromises();
    return JSValue::encode(constructEmptyObject(globalObject->vm(), globalObject->nullPrototypeObjectStructure()));
}

// `callback` (a test body, as withAsyncContextIfNeeded() stored it) to call inside the frame
// that binds `key` to `id`. The frame goes on top of the context the body was registered in,
// never the one that is current: the runner can start a body from inside another test's report.
extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__TestOwner__wrap(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue encodedKey, uint32_t id, JSC::EncodedJSValue encodedCallback)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    JSValue callback = JSValue::decode(encodedCallback);
    JSValue registeredIn = jsUndefined();
    if (auto* wrapper = dynamicDowncast<AsyncContextFrame>(callback)) {
        callback = wrapper->callback.get();
        registeredIn = wrapper->context.get();
    }
    JSObject* frame = Bun::createAsyncContextFrame(globalObject, asObject(JSValue::decode(encodedKey)), jsNumber(id), registeredIn);
    return JSValue::encode(AsyncContextFrame::create(vm, globalObject->AsyncContextFrameStructure(), callback, frame));
}

// The frame that binds `key` in the chain headed by `asyncContext`, or null.
static JSObject* testOwnerFrame(VM& vm, JSValue asyncContext, JSObject* key)
{
    auto& names = WebCore::builtinNames(vm);
    for (JSObject* frame = asyncContext.getObject(); frame;) {
        if (frame->getDirect(vm, names.storagePublicName()) == JSValue(key))
            return frame;
        JSValue previous = frame->getDirect(vm, names.prevPublicName());
        frame = previous ? previous.getObject() : nullptr;
    }
    return nullptr;
}

// The id `key` is bound to where `error` comes from, or 0. `rejectedIn` is the rejection owner
// of an unhandled rejection (null: it had none). Empty: `error` is an uncaught exception, which
// comes from the context it was thrown in (the engine notes it on the Exception), and a value
// nobody threw from the context that is current.
extern "C" [[ZIG_EXPORT(nothrow)]] uint32_t Bun__TestOwner__find(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue encodedKey, JSC::EncodedJSValue encodedError, JSC::EncodedJSValue encodedRejectedIn)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    JSValue asyncContext = JSValue::decode(encodedRejectedIn);
    if (!asyncContext) {
        JSValue error = JSValue::decode(encodedError);
        if (auto* exception = error.isCell() ? dynamicDowncast<JSC::Exception>(error.asCell()) : nullptr)
            asyncContext = exception->asyncContext();
        if (!asyncContext)
            asyncContext = globalObject->m_asyncContextData.get()->getInternalField(0);
    }
    JSObject* frame = testOwnerFrame(vm, asyncContext, asObject(JSValue::decode(encodedKey)));
    if (!frame)
        return 0;
    JSValue id = frame->getDirect(vm, vm.propertyNames->value);
    return id && id.isInt32() && id.asInt32() > 0 ? static_cast<uint32_t>(id.asInt32()) : 0;
}

// A test that waits inside a matcher keeps its frame current while the event loop runs under
// it, and a job that captured no context would run in it. Leaves the frame for the wait: what
// is current becomes the context below the frame. Returns what to put back with
// Bun__TestOwner__reenter, or empty if no frame of `key` is current.
extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__TestOwner__leave(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue encodedKey)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto* asyncContextData = globalObject->m_asyncContextData.get();
    JSValue current = asyncContextData->getInternalField(0);
    JSObject* frame = testOwnerFrame(vm, current, asObject(JSValue::decode(encodedKey)));
    if (!frame)
        return {};
    JSValue below = frame->getDirect(vm, WebCore::builtinNames(vm).prevPublicName());
    asyncContextData->putInternalField(vm, 0, below ? below : jsUndefined());
    return JSValue::encode(current);
}

extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__TestOwner__reenter(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue previous)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    globalObject->m_asyncContextData.get()->putInternalField(globalObject->vm(), 0, JSValue::decode(previous));
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
