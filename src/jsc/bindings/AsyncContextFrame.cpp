#include "root.h"
#include "ZigGlobalObject.h"
#include "ZigGeneratedClasses.h"
#include "AsyncContextFrame.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSArray.h>

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

#define ASYNCCONTEXTFRAME_CALL_IMPL(...)                                            \
    if (!functionObject.isCell())                                                   \
        return jsUndefined();                                                       \
    auto& vm = global->vm();                                                        \
    JSValue restoreAsyncContext;                                                    \
    InternalFieldTuple* asyncContextData = nullptr;                                 \
    if (auto* wrapper = dynamicDowncast<AsyncContextFrame>(functionObject)) {       \
        functionObject = uncheckedDowncast<JSC::JSObject>(wrapper->callback.get()); \
        asyncContextData = global->m_asyncContextData.get();                        \
        restoreAsyncContext = asyncContextData->getInternalField(0);                \
        asyncContextData->putInternalField(vm, 0, wrapper->context.get());          \
    }                                                                               \
    auto result = JSC::profiledCall(__VA_ARGS__);                                   \
    if (asyncContextData) {                                                         \
        asyncContextData->putInternalField(vm, 0, restoreAsyncContext);             \
    }                                                                               \
    return result;

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
JSValue AsyncContextFrame::profiledCall(JSGlobalObject* global, JSValue functionObject, JSValue thisValue, const ArgList& args)
{
    return AsyncContextFrame::call(global, functionObject, thisValue, args);
}
#undef ASYNCCONTEXTFRAME_CALL_IMPL

// ── bun:test (src/runtime/test_runner/AsyncContextRef.rs) ──────────────────
//
// The context array ([key, value, ...], see node/async_hooks.ts) gets one extra
// pair per test or hook invocation: (ref, ref), the invocation's AsyncContextRef.

static bool isAsyncContextRef(JSValue value)
{
    return dynamicDowncast<WebCore::JSAsyncContextRef>(value) != nullptr;
}

static JSValue findAsyncContextRef(JSValue context)
{
    auto* array = dynamicDowncast<JSArray>(context);
    if (!array)
        return jsUndefined();
    unsigned length = array->length();
    for (unsigned i = 0; i < length; i += 2) {
        if (!array->canGetIndexQuickly(i))
            continue;
        JSValue key = array->getIndexQuickly(i);
        if (isAsyncContextRef(key))
            return key;
    }
    return jsUndefined();
}

// A context the runner alone populated: without the runner there would be none.
static bool holdsOnlyAsyncContextRefs(JSValue context)
{
    auto* array = dynamicDowncast<JSArray>(context);
    if (!array)
        return false;
    unsigned length = array->length();
    if (length == 0)
        return false;
    for (unsigned i = 0; i < length; i += 2) {
        if (!array->canGetIndexQuickly(i) || !isAsyncContextRef(array->getIndexQuickly(i)))
            return false;
    }
    return true;
}

// The caller checks for an exception afterwards.
static void appendPairsWithoutRefs(JSGlobalObject* globalObject, JSValue context, MarkedArgumentBuffer& entries)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* array = dynamicDowncast<JSArray>(context);
    if (!array)
        return;
    unsigned length = array->length();
    entries.ensureCapacity(length + 2);
    for (unsigned i = 0; i < length; i += 2) {
        JSValue key = array->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, );
        JSValue value = i + 1 < length ? array->getIndex(globalObject, i + 1) : jsUndefined();
        RETURN_IF_EXCEPTION(scope, );
        if (isAsyncContextRef(key))
            continue;
        entries.append(key);
        entries.append(value);
    }
}

// node:vm contexts copy this flag when created, so it is set before a test file loads.
extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__AsyncContextRef__enableTracking(JSC::JSGlobalObject* globalObject)
{
    globalObject->setAsyncContextTrackingEnabled(true);
}

// AsyncContextFrame::withAsyncContextIfNeeded for a callback being registered: the
// registering invocation's (ref, ref) is not a context to capture. __enter drops it
// from a context that is.
extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__AsyncContextRef__withAsyncContextIfNeeded(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue callbackValue)
{
    if (holdsOnlyAsyncContextRefs(globalObject->m_asyncContextData.get()->getInternalField(0)))
        return callbackValue;
    return JSValue::encode(AsyncContextFrame::withAsyncContextIfNeeded(globalObject, JSValue::decode(callbackValue)));
}

// Returns what to invoke in place of `callback` so that it runs with its usual
// context plus (ref, ref). A callback registered under a context (an
// AsyncContextFrame) gets a new frame, which Bun__JSValue__call installs and
// restores as usual. Any other callback gets the array installed in place, so
// that, as before, what it does to the context (als.enterWith()) outlives it;
// __leave then only removes the ref.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Bun__AsyncContextRef__enter(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue callbackValue, JSC::EncodedJSValue refValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue callback = JSValue::decode(callbackValue);
    JSValue ref = JSValue::decode(refValue);
    ASSERT(isAsyncContextRef(ref));
    auto* slot = globalObject->m_asyncContextData.get();

    auto* registrationFrame = dynamicDowncast<AsyncContextFrame>(callback);
    JSValue previousContext = registrationFrame ? registrationFrame->context.get() : slot->getInternalField(0);

    MarkedArgumentBuffer entries;
    appendPairsWithoutRefs(globalObject, previousContext, entries);
    RETURN_IF_EXCEPTION(scope, {});
    entries.append(ref);
    entries.append(ref);
    if (entries.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    JSArray* context = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), entries);
    RETURN_IF_EXCEPTION(scope, {});

    globalObject->setAsyncContextTrackingEnabled(true);

    if (registrationFrame)
        return JSValue::encode(AsyncContextFrame::create(globalObject, registrationFrame->callback.get(), context));

    slot->putInternalField(vm, 0, context);
    return JSValue::encode(callback);
}

// Takes the refs out of whatever the callback left in the slot, keeping the rest
// in effect as before. Always rebuilt: als.disable() splices the installed array
// in place. After a frame the call restored the slot itself, so there is no ref.
extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__AsyncContextRef__leave(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* slot = globalObject->m_asyncContextData.get();
    JSValue current = slot->getInternalField(0);
    if (findAsyncContextRef(current).isUndefined())
        return;
    MarkedArgumentBuffer entries;
    appendPairsWithoutRefs(globalObject, current, entries);
    RETURN_IF_EXCEPTION(scope, );
    if (entries.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return;
    }
    JSValue remaining = jsUndefined();
    if (!entries.isEmpty()) {
        remaining = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), entries);
        RETURN_IF_EXCEPTION(scope, );
    }
    slot->putInternalField(vm, 0, remaining);
}

extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__AsyncContextRef__current(JSC::JSGlobalObject* globalObject)
{
    return JSValue::encode(findAsyncContextRef(globalObject->m_asyncContextData.get()->getInternalField(0)));
}
