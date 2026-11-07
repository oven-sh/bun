#include "config.h"

#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSMicrotask.h"
#include "JavaScriptCore/MicrotaskQueue.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include "JavaScriptCore/EntryFrame.h"
#include "JavaScriptCore/VMEntryRecord.h"
#include "JavaScriptCore/ArgList.h"

#include "NodeAsyncHooks.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsQueueAsyncHooksMicrotask, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto callback = callFrame->argument(0);
    ASSERT(callback.isCallable());
    JSC::QueuedTask task { nullptr, JSC::InternalMicrotask::BunPerformMicrotaskJob, 0, globalObject, callback, JSC::jsUndefined() };
    globalObject->vm().queueMicrotask(WTF::move(task));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsSetAsyncHooksTimerDispatch, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    auto dispatch = callFrame->argument(0);
    if (auto* function = dispatch.getObject(); function && function->isCallable()) {
        global->m_asyncHooksTimerDispatch.set(vm, global, function);
    } else {
        global->m_asyncHooksTimerDispatch.clear();
    }
    return JSC::JSValue::encode(JSC::jsUndefined());
}

extern "C" void Bun__AsyncHooks__emitTimerLifecycle(
    JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedTimer, uint64_t asyncHooksId,
    AsyncHooksTimerLifecycleEvent event)
{
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    auto* dispatch = global->m_asyncHooksTimerDispatch.get();
    if (!dispatch) [[likely]]
        return;

    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::MarkedArgumentBuffer args;
    args.append(JSC::jsNumber(static_cast<uint8_t>(event)));
    args.append(JSC::JSValue::decode(encodedTimer));
    args.append(JSC::jsNumber(static_cast<double>(asyncHooksId)));
    JSC::call(globalObject, dispatch, JSC::getCallData(dispatch), JSC::jsUndefined(), args);
    if (auto* exception = scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        Bun__reportUnhandledError(globalObject, JSC::JSValue::encode(exception));
    }
}

// A job puts back the async context that was in place in front of it if async contexts were tracked when it began. The constructors of
// AsyncLocalStorage and AsyncResource turn tracking on; in an executable that was compiled ahead of time the first frame that is put in
// place does, and the constructors only say that one of them has run. So that both come to the same, the jobs that began between the two
// are finished here: behind each of them no async context is in place, as in front of it.

// An entry into script that is in progress, and where it was made from.
struct EntryIntoScript {
    EntryFrame* frame;
    EntryFrame* outerFrame;
    CallFrame* outerCallFrame;
    void* outerCallee;
};

// Innermost first.
using EntriesIntoScript = Vector<EntryIntoScript, 4>;

struct EntriesWithoutTracking {
    // In progress since the first constructor ran: a job among them puts nothing back.
    EntriesIntoScript sinceFirstConstructor;
    // Made after that, and in progress since the first frame was put in place.
    EntriesIntoScript sinceFirstFrame;
};

static thread_local EntriesWithoutTracking* entriesWithoutTracking;
static thread_local bool trackingWaitsForFirstFrame;

static void* calleeOf(CallFrame* callFrame)
{
    return callFrame ? callFrame->callee().rawPtr() : nullptr;
}

static EntriesIntoScript entriesInProgress(VM& vm)
{
    EntriesIntoScript entries;
    for (EntryFrame* frame = vm.topEntryFrame; frame;) {
        VMEntryRecord* record = vmEntryRecord(frame);
        entries.append({ frame, record->prevTopEntryFrame(), record->prevTopCallFrame(), calleeOf(record->prevTopCallFrame()) });
        frame = record->prevTopEntryFrame();
    }
    return entries;
}

// Takes out the entries that have returned. True if the job that has just ended is the outermost of them.
static bool takeEntriesThatReturned(VM& vm, EntriesIntoScript& entries)
{
    EntryFrame* top = vm.topEntryFrame;
    size_t count = 0;
    while (count < entries.size() && (!top || entries[count].frame < top))
        ++count;
    if (!count)
        return false;
    EntryIntoScript outermost = entries[count - 1];
    entries.removeAt(0, count);
    return outermost.outerFrame == top && outermost.outerCallFrame == vm.topCallFrame && outermost.outerCallee == calleeOf(vm.topCallFrame);
}

static void forgetEntriesWithoutTracking()
{
    delete std::exchange(entriesWithoutTracking, nullptr);
}

bool waitsForMicrotasksThatBeganWithoutAsyncContextTracking()
{
    return entriesWithoutTracking;
}

void didFinishMicrotaskThatMayHaveBegunWithoutAsyncContextTracking(VM& vm, Zig::GlobalObject* globalObject)
{
    auto* entries = entriesWithoutTracking;
    if (!entries)
        return;
    takeEntriesThatReturned(vm, entries->sinceFirstConstructor);
    if (takeEntriesThatReturned(vm, entries->sinceFirstFrame))
        globalObject->m_asyncContextData->putInternalField(vm, 0, jsUndefined());
    if (entries->sinceFirstConstructor.isEmpty() && entries->sinceFirstFrame.isEmpty())
        forgetEntriesWithoutTracking();
}

void updateOnEachMicrotaskTick(VM&);

static void waitForMicrotasksInProgress(VM& vm)
{
    updateOnEachMicrotaskTick(vm);
    vm.whenIdle([&vm] {
        forgetEntriesWithoutTracking();
        updateOnEachMicrotaskTick(vm);
    });
}

// True: this is called when AsyncLocalStorage or AsyncResource is constructed; in an executable that was compiled ahead of time, when a frame is put in place for the first time.
// False: only in such an executable, when one of the two is constructed for the first time.
JSC_DEFINE_HOST_FUNCTION(jsSetAsyncHooksEnabled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 1);
    VM& vm = globalObject->vm();
    bool isEnabled = callFrame->uncheckedArgument(0).toBoolean(globalObject);
    if (vm.isAsyncContextTrackingEnabled())
        return JSC::JSValue::encode(JSC::jsUndefined());

    if (!isEnabled) {
        trackingWaitsForFirstFrame = true;
        ASSERT(!entriesWithoutTracking);
        entriesWithoutTracking = new EntriesWithoutTracking;
        entriesWithoutTracking->sinceFirstConstructor = entriesInProgress(vm);
        waitForMicrotasksInProgress(vm);
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    globalObject->setAsyncContextTrackingEnabled(true);
    if (!trackingWaitsForFirstFrame)
        return JSC::JSValue::encode(JSC::jsUndefined());

    if (!entriesWithoutTracking)
        entriesWithoutTracking = new EntriesWithoutTracking;
    auto& sinceFirstConstructor = entriesWithoutTracking->sinceFirstConstructor;
    EntriesIntoScript entries = entriesInProgress(vm);
    // Those that have returned without a job ending since.
    while (!sinceFirstConstructor.isEmpty() && !entries.containsIf([&](auto& entry) { return entry.frame == sinceFirstConstructor.first().frame; }))
        sinceFirstConstructor.removeAt(0);
    if (!sinceFirstConstructor.isEmpty())
        entries.shrink(entries.findIf([&](auto& entry) { return entry.frame == sinceFirstConstructor.first().frame; }));
    entriesWithoutTracking->sinceFirstFrame = WTF::move(entries);
    waitForMicrotasksInProgress(vm);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

}
