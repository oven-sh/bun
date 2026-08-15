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
// The async context value (AsyncLocalStorage's storage, see node/async_hooks.ts)
// is an array of [key, value, ...] pairs that promise reactions, timers and
// native callbacks snapshot and restore. bun:test adds one pair per test or
// hook invocation, with the invocation's AsyncContextRef as both key and value,
// so that code still running on behalf of that invocation can be told apart
// from the entry the runner is executing now.

static bool isAsyncContextRef(JSValue value)
{
    return dynamicDowncast<WebCore::JSAsyncContextRef>(value) != nullptr;
}

// The key of the first ref pair in `context`, or undefined.
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

// Appends the pairs of `context` (if it is an array) to `entries`, leaving out
// ref pairs. The caller checks for an exception afterwards.
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

// AsyncContextFrame::call only unwraps the wrappers withAsyncContextIfNeeded()
// creates while a context is installed when tracking is enabled (normally
// constructing an AsyncLocalStorage enables it). node:vm contexts copy the flag
// when they are created, so bun test enables it before loading each test file.
extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__AsyncContextRef__enableTracking(JSC::JSGlobalObject* globalObject)
{
    globalObject->setAsyncContextTrackingEnabled(true);
}

// Arranges for `callback`, about to be invoked once by the test runner, to run
// with `ref` in its async context, and returns what to invoke in its place.
//
// The context it runs with is the one it would have run with anyway plus the
// pair (ref, ref); a ref left over from the invocation that registered the
// callback is dropped, so a context names one invocation, the innermost.
//
// - A callback registered while a context was active (`als.run(() => test(..))`)
//   is already an AsyncContextFrame. It keeps running the way wrapped callbacks
//   run: a new frame installs the combined context for the call and
//   Bun__JSValue__call puts the previous value back afterwards.
// - Otherwise the combined context is installed directly, exactly as the
//   callback would have found the slot before, so whatever it does to the
//   context (`als.enterWith()` in a beforeEach) is still there afterwards, as it
//   always was; __leave only takes the ref back out.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Bun__AsyncContextRef__enter(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue callbackValue, JSC::EncodedJSValue refValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue callback = JSValue::decode(callbackValue);
    auto* ref = dynamicDowncast<WebCore::JSAsyncContextRef>(JSValue::decode(refValue));
    ASSERT(ref);
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

    // Installing a context is what makes wrappers appear (see enableTracking above).
    globalObject->setAsyncContextTrackingEnabled(true);

    if (registrationFrame)
        return JSValue::encode(AsyncContextFrame::create(globalObject, registrationFrame->callback.get(), context));

    ref->m_previousContext.set(vm, ref, previousContext);
    ref->m_installedContext.set(vm, ref, context);
    slot->putInternalField(vm, 0, context);
    return JSValue::encode(callback);
}

// Called once the callback returned (before microtasks are drained, where
// Bun__JSValue__call restores for wrapped callbacks). Takes the ref back out of
// the slot: the previous value comes back if the callback left the slot alone,
// otherwise what the callback installed stays, minus the ref.
extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__AsyncContextRef__leave(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue refValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* ref = dynamicDowncast<WebCore::JSAsyncContextRef>(JSValue::decode(refValue));
    ASSERT(ref);
    JSValue installed = ref->m_installedContext.get();
    if (!installed)
        return; // __enter returned a frame; Bun__JSValue__call already restored.
    JSValue previous = ref->m_previousContext.get();
    ref->m_installedContext.clear();
    ref->m_previousContext.clear();

    auto* slot = globalObject->m_asyncContextData.get();
    JSValue current = slot->getInternalField(0);
    if (current == installed) {
        slot->putInternalField(vm, 0, previous);
        return;
    }
    if (findAsyncContextRef(current).isUndefined())
        return; // replaced by something that does not carry the ref (e.g. the enterWith() cleanup reset it)

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

// The AsyncContextRef in the current async context, or undefined when the JS
// running right now does not descend from a bun:test invocation.
extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__AsyncContextRef__current(JSC::JSGlobalObject* globalObject)
{
    return JSValue::encode(findAsyncContextRef(globalObject->m_asyncContextData.get()->getInternalField(0)));
}
