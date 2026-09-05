#include "V8Isolate.h"
#include "V8HandleScope.h"
#include "V8String.h"
#include "shim/GlobalInternals.h"
#include "ZigGlobalObject.h"
#include "real_v8.h"
#include "v8_compatibility_assertions.h"
#include <JavaScriptCore/Error.h>

static_assert(offsetof(v8::Isolate, m_roots) == real_v8::internal::Internals::kIsolateRootsOffset, "Isolate roots array is at wrong offset");

#define CHECK_ROOT_INDEX(NAME)                                                                                                                \
    static_assert(v8::Isolate::NAME == real_v8::internal::Internals::NAME, "Isolate root index " #NAME " does not match between Bun and V8"); \
    static_assert(v8::Isolate::NAME < std::tuple_size_v<decltype(v8::Isolate::m_roots)>, "Bun v8::Isolate roots array is too small for index " #NAME);

CHECK_ROOT_INDEX(kUndefinedValueRootIndex)
CHECK_ROOT_INDEX(kTheHoleValueRootIndex)
CHECK_ROOT_INDEX(kNullValueRootIndex)
CHECK_ROOT_INDEX(kTrueValueRootIndex)
CHECK_ROOT_INDEX(kFalseValueRootIndex)

namespace v8 {

// Returns the isolate inside which the current thread is running or nullptr.
Isolate* Isolate::TryGetCurrent()
{
    auto* global = defaultGlobalObject();

    return global ? &global->V8GlobalInternals()->m_isolate : nullptr;
}

// Returns the isolate inside which the current thread is running.
Isolate* Isolate::GetCurrent()
{
    auto* global = defaultGlobalObject();

    return global ? &global->V8GlobalInternals()->m_isolate : nullptr;
}

Local<Context> Isolate::GetCurrentContext()
{
    return currentHandleScope()->createLocal<Context>(m_globalObject->vm(), m_globalObject);
}

Local<Context> Isolate::GetEnteredOrMicrotaskContext()
{
    return currentHandleScope()->createLocal<Context>(m_globalObject->vm(), m_globalObject);
}

Local<Value> Isolate::GetContinuationPreservedEmbedderData()
{
    return currentHandleScope()->createLocal<Value>(m_globalObject->vm(), JSC::jsUndefined());
}

bool Isolate::IsInUse()
{
    return true;
}

void Isolate::LowMemoryNotification()
{
    JSC::JSLockHolder lock(vm());
    vm().heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);
}

void Isolate::AutomaticallyRestoreInitialHeapLimit(double)
{
    // JSC manages its own heap limits; nothing to restore.
}

size_t Isolate::NumberOfTrackedHeapObjectTypes()
{
    return 0;
}

bool Isolate::GetHeapObjectStatisticsAtLastGC(HeapObjectStatistics*, size_t)
{
    return false;
}

void Isolate::AddGCPrologueCallback(GCCallbackWithData callback, void* data, GCType)
{
    // Stored but not fired: JSC's GC does not expose matching phase hooks.
    m_globalInternals->gcPrologueCallbacks().append({ callback, data });
}

void Isolate::RemoveGCPrologueCallback(GCCallbackWithData callback, void* data)
{
    m_globalInternals->gcPrologueCallbacks().removeFirstMatching([&](auto& entry) {
        return entry.first == callback && entry.second == data;
    });
}

void Isolate::AddGCEpilogueCallback(GCCallbackWithData callback, void* data, GCType)
{
    // Stored but not fired: JSC's GC does not expose matching phase hooks.
    m_globalInternals->gcEpilogueCallbacks().append({ callback, data });
}

void Isolate::RemoveGCEpilogueCallback(GCCallbackWithData callback, void* data)
{
    m_globalInternals->gcEpilogueCallbacks().removeFirstMatching([&](auto& entry) {
        return entry.first == callback && entry.second == data;
    });
}

void Isolate::AddNearHeapLimitCallback(NearHeapLimitCallback callback, void* data)
{
    // Stored but not fired: JSC grows its heap without a near-limit hook.
    m_globalInternals->nearHeapLimitCallbacks().append({ callback, data });
}

void Isolate::RemoveNearHeapLimitCallback(NearHeapLimitCallback callback, size_t)
{
    m_globalInternals->nearHeapLimitCallbacks().removeFirstMatching([&](auto& entry) {
        return entry.first == callback;
    });
}

extern "C" void JSC__JSGlobalObject__queueMicrotaskCallback(Zig::GlobalObject*, void*, void (*run)(void*), void (*drop)(void*));

namespace {
struct InterruptRequest {
    Isolate* isolate;
    InterruptCallback callback;
    void* data;
};
}

void Isolate::RequestInterrupt(InterruptCallback callback, void* data)
{
    // queueMicrotaskCallback is not thread-safe; V8 allows this from any thread.
    if (!vm().currentThreadIsHoldingAPILock()) [[unlikely]]
        return;
    auto* request = new InterruptRequest { this, callback, data };
    JSC__JSGlobalObject__queueMicrotaskCallback(
        m_globalObject, request,
        [](void* ptr) {
            auto* req = static_cast<InterruptRequest*>(ptr);
            req->callback(req->isolate, req->data);
            delete req;
        },
        [](void* ptr) { delete static_cast<InterruptRequest*>(ptr); });
}

Local<Value> Isolate::ThrowException(Local<Value> exception)
{
    auto scope = DECLARE_THROW_SCOPE(vm());
    JSC::throwException(m_globalObject, scope, exception->localToJSValue());
    return exception;
}

Local<Value> Isolate::ThrowError(Local<String> message)
{
    JSC::VM& vm = this->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    WTF::String wtfMessage = message->localToJSString()->value(m_globalObject);
    JSC::JSObject* error = JSC::createError(m_globalObject, wtfMessage);
    Local<Value> handle = currentHandleScope()->createLocal<Value>(vm, error);
    JSC::throwException(m_globalObject, scope, error);
    return handle;
}

Isolate::Isolate(shim::GlobalInternals* globalInternals)
    : m_globalInternals(globalInternals)
    , m_globalObject(globalInternals->m_globalObject)
    // Zero the padding: V8 14's inline HandleScope code keeps the isolate's HandleScopeData
    // (next/limit/level, see HandleScope::Extend) inside this region, and relies on it starting
    // out zeroed just like real V8's HandleScopeData::Initialize() leaves it.
    , m_padding {}
{
    m_roots[kUndefinedValueRootIndex] = TaggedPointer(&globalInternals->m_undefinedValue);
    m_roots[kNullValueRootIndex] = TaggedPointer(&globalInternals->m_nullValue);
    m_roots[kTrueValueRootIndex] = TaggedPointer(&globalInternals->m_trueValue);
    m_roots[kFalseValueRootIndex] = TaggedPointer(&globalInternals->m_falseValue);
}

HandleScope* Isolate::currentHandleScope()
{
    return m_globalInternals->currentHandleScope();
}

} // namespace v8
