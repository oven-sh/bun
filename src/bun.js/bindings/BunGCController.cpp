#include "root.h"

#include "BunGCController.h"
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/IncrementalSweeper.h>
#include <wtf/SystemTracing.h>
#include <JavaScriptCore/GCActivityCallback.h>
#include <JavaScriptCore/FullGCActivityCallback.h>
#include <JavaScriptCore/EdenGCActivityCallback.h>
#include <JavaScriptCore/JSRunLoopTimer.h>
#include "BunClientData.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include "mimalloc.h"
#include "BunProcess.h"

namespace Bun {
extern "C" bool Bun__isBusyDoingImportantWork(void* bunVM);

static size_t ramSize()
{
    return JSC::Options::forceRAMSize() || WTF::ramSize();
}

// Based on WebKit's WebCore::OpportunisticTaskScheduler::FullGCActivityCallback
class FullGCActivityCallback final : public JSC::FullGCActivityCallback {
public:
    using Base = JSC::FullGCActivityCallback;

    static RefPtr<FullGCActivityCallback> create(JSC::Heap& heap)
    {
        return adoptRef(*new FullGCActivityCallback(heap));
    }

    void doCollection(JSC::VM&) final;
    void doCollectionEvenIfBusy(JSC::VM&);
    bool isDeferred() const { return m_deferCount > 0; }
    bool scheduleCollection(JSC::VM&);
    bool scheduleCollectionToReclaimMemoryOnIdle(JSC::VM&);
    JSC::HeapVersion m_version { 0 };

private:
    FullGCActivityCallback(JSC::Heap&);

    void* m_bunVM = nullptr;
    JSC::VM& m_vm;
    bool m_isIdleCollection { false };

    unsigned m_deferCount { 0 };
};

// Based on WebKit's WebCore::OpportunisticTaskScheduler::EdenGCActivityCallback
class EdenGCActivityCallback final : public JSC::EdenGCActivityCallback {
public:
    using Base = JSC::EdenGCActivityCallback;

    static RefPtr<EdenGCActivityCallback> create(JSC::Heap& heap)
    {
        return adoptRef(*new EdenGCActivityCallback(heap));
    }

    void doCollection(JSC::VM&) final;
    void doCollectionIfNeeded(JSC::VM&);
    void doCollectionEvenIfBusy(JSC::VM&);

    bool isDeferred() const { return m_deferCount > 0; }
    JSC::HeapVersion m_version { 0 };
    bool scheduleCollection(JSC::VM&, bool soon);

private:
    EdenGCActivityCallback(JSC::Heap&);

    JSC::VM& m_vm;
    void* m_bunVM = nullptr;

    unsigned m_deferCount { 0 };
};

FullGCActivityCallback::FullGCActivityCallback(JSC::Heap& heap)
    : Base(heap, JSC::Synchronousness::Async)
    , m_vm(heap.vm())
    , m_bunVM(bunVM(heap.vm()))
{
}

// Timer-based GC callback
void FullGCActivityCallback::doCollection(JSC::VM& vm)
{
    auto& gcController = WebCore::clientData(vm)->gcController();
    if (gcController.hasMoreEventLoopWorkToDo() || Bun__isBusyDoingImportantWork(gcController.bunVM)) {
        if (!gcController.checkMemoryPressure()) {
            if (scheduleCollection(vm)) {
                // If we're in the middle of something important, delay timer-based GC.
                // unless there's memory pressure
                return;
            }
        }
    }

    doCollectionEvenIfBusy(vm);
}

void FullGCActivityCallback::doCollectionEvenIfBusy(JSC::VM& vm)
{
    m_version = 0;
    m_deferCount = 0;
    bool releaseCriticalMemory = false;
    if (m_isIdleCollection) {
        size_t rss = 0;

        m_isIdleCollection = false;

        if (vm.heap.blockBytesAllocated() > 1024 * 1024 * 512) {
            // getRSS is kind of expensive so we only check this if we're using a lot of memory
            if (getRSS(&rss)) {

                // If we're using more than 70% of the RAM, attempt to free up as much memory as possible
                if (static_cast<double>(rss) / static_cast<double>(ramSize()) > 0.7) {
                    releaseCriticalMemory = true;
                    vm.deleteAllCode(JSC::DeleteAllCodeEffort::DeleteAllCodeIfNotCollecting);
                }
            }
        }
    }

    Base::doCollection(vm);

    if (releaseCriticalMemory) {
        // After GC, we release memory to try to reclaim as much memory as possible
        WTF::releaseFastMallocFreeMemory();
        mi_collect(false);
    }
}

EdenGCActivityCallback::EdenGCActivityCallback(JSC::Heap& heap)
    : Base(heap, JSC::Synchronousness::Async)
    , m_vm(heap.vm())
    , m_bunVM(bunVM(heap.vm()))
{
}

bool EdenGCActivityCallback::scheduleCollection(JSC::VM& vm, bool soon)
{
    constexpr WTF::Seconds normalDelay { 60_ms };
    constexpr WTF::Seconds aggressiveDelay { 16_ms };
    constexpr unsigned deferCountThreshold = 4;

    // Check if we should be more aggressive based on soon parameter
    bool underHighMemoryPressure = soon;

    if (!m_version || m_version != vm.heap.objectSpace().edenVersion()) {
        m_version = vm.heap.objectSpace().edenVersion();
        m_deferCount = 0;
        m_delay = underHighMemoryPressure ? aggressiveDelay : normalDelay;
        setTimeUntilFire(m_delay);
        return true;
    }

    if (++m_deferCount < (underHighMemoryPressure ? deferCountThreshold / 2 : deferCountThreshold)) {
        m_delay = underHighMemoryPressure ? aggressiveDelay : normalDelay;
        setTimeUntilFire(m_delay);
        return true;
    }

    return false;
}

bool FullGCActivityCallback::scheduleCollectionToReclaimMemoryOnIdle(JSC::VM& vm)
{
    constexpr WTF::Seconds delay { 3000_ms };
    constexpr unsigned deferCountThreshold = 10;
    if (!m_version || m_version != vm.heap.objectSpace().markingVersion()) {
        m_version = vm.heap.objectSpace().markingVersion();
        m_deferCount = 0;
        m_delay = delay;
        setTimeUntilFire(delay);
        m_isIdleCollection = true;
        return true;
    }

    if (++m_deferCount < deferCountThreshold) {
        m_delay = delay;
        setTimeUntilFire(delay);
        m_isIdleCollection = true;
        return true;
    }

    return false;
}

bool FullGCActivityCallback::scheduleCollection(JSC::VM& vm)
{
    // Servers can tolerate slightly larger pauses for better overall throughput
    constexpr WTF::Seconds delay { 300_ms };
    constexpr unsigned deferCountThreshold = 3;

    // Detect idle periods based on event loop activity (if possible)
    bool inIdlePeriod = !WebCore::clientData(vm)->gcController().hasMoreEventLoopWorkToDo();

    if (!m_version || m_version != vm.heap.objectSpace().markingVersion()) {
        m_version = vm.heap.objectSpace().markingVersion();
        m_deferCount = 0;
        m_delay = delay;
        m_isIdleCollection = false;
        setTimeUntilFire(inIdlePeriod ? delay / 2 : delay); // Run sooner during idle periods
        return true;
    }

    if (++m_deferCount < deferCountThreshold) {
        m_delay = delay;
        m_isIdleCollection = false;
        setTimeUntilFire(inIdlePeriod ? delay / 2 : delay);
        return true;
    }

    return false;
}

// Timer-based GC callback
void EdenGCActivityCallback::doCollection(JSC::VM& vm)
{
    auto& gcController = WebCore::clientData(vm)->gcController();
    if (gcController.hasMoreEventLoopWorkToDo() || Bun__isBusyDoingImportantWork(gcController.bunVM)) {
        if (scheduleCollection(vm, true)) {
            return;
        }
    }

    doCollectionEvenIfBusy(vm);
}

void EdenGCActivityCallback::doCollectionEvenIfBusy(JSC::VM& vm)
{

    m_version = 0;
    m_deferCount = 0;
    Base::doCollection(vm);
}

GCController::GCController(JSC::VM& vm)
    : m_vm(vm)
{
}

GCController::~GCController()
{
}

extern "C" void Bun__GCController__setup(Bun::GCController* controller);

void GCController::initialize(bool miniMode)
{
    // Create Eden and Full GC callbacks
    m_edenCallback = EdenGCActivityCallback::create(m_vm.heap);
    m_fullCallback = FullGCActivityCallback::create(m_vm.heap);

    // Set them as active callbacks in the heap
    m_vm.heap.setEdenActivityCallback(m_edenCallback.get());
    m_vm.heap.setFullActivityCallback(m_fullCallback.get());

    {
        const char* disable_stop_if_necessary_timer = getenv("BUN_DISABLE_STOP_IF_NECESSARY_TIMER");
        // Keep stopIfNecessaryTimer enabled by default when either:
        // - `--smol` is passed
        // - The machine has less than 4GB of RAM
        bool shouldDisableStopIfNecessaryTimer = !miniMode;
        if (ramSize() < 1024ull * 1024ull * 1024ull * 4ull) {
            shouldDisableStopIfNecessaryTimer = false;
        }

        if (disable_stop_if_necessary_timer) {
            const char value = disable_stop_if_necessary_timer[0];
            if (value == '0') {
                shouldDisableStopIfNecessaryTimer = false;
            } else if (value == '1') {
                shouldDisableStopIfNecessaryTimer = true;
            }
        }

        if (shouldDisableStopIfNecessaryTimer) {
            m_vm.heap.disableStopIfNecessaryTimer();
        }
    }

    // Configure GC with server-optimized settings
    this->configureEdenGC(true, 30);
    this->configureFullGC(true, 300);

    Bun__GCController__setup(this);
}

void GCController::performOpportunisticGC()
{
    // runs after an HTTP request has completed
    // note: there may be other in-flight requests

    // Check if under memory pressure - be more aggressive if needed
    bool underPressure = checkMemoryPressure();
    size_t previousBlockBytesAllocated = m_lastBlockBytesAllocated;
    size_t blockBytesAllocated = m_vm.heap.blockBytesAllocated();
    m_lastBlockBytesAllocated = blockBytesAllocated;

    if (blockBytesAllocated > previousBlockBytesAllocated || underPressure) {
        m_hasStayedTheSameFor = 0;

        if (!Bun__isBusyDoingImportantWork(bunVM)) {
            // Always schedule an Eden GC if memory is growing
            m_edenCallback->scheduleCollection(m_vm, true);
        }

        // Only schedule full GC if under pressure or memory growing significantly
        if (underPressure && !m_fullCallback->isScheduled()) {
            m_fullCallback->scheduleCollection(m_vm);
        }

    } else if (m_hasStayedTheSameFor < 10) {
        // If memory usage plateaus, still do Eden collections
        if (!hasMoreEventLoopWorkToDo() && !Bun__isBusyDoingImportantWork(bunVM)) {
            if (m_edenCallback->scheduleCollection(m_vm, false)) {
                m_hasStayedTheSameFor++;
            }
        }
    } else {
        // After long plateau, occasionally do full collection to compact memory
        if (!hasMoreEventLoopWorkToDo() && !Bun__isBusyDoingImportantWork(bunVM)) {
            m_fullCallback->scheduleCollectionToReclaimMemoryOnIdle(m_vm);
        }
    }
}

void GCController::configureEdenGC(bool enabled, unsigned intervalMs)
{
    if (!m_edenCallback)
        return;

    if (enabled) {
        m_edenCallback->setEnabled(true);
        m_edenCallback->setTimeUntilFire(WTF::Seconds::fromMilliseconds(intervalMs));
    } else {
        m_edenCallback->setEnabled(false);
        m_edenCallback->cancel();
    }
}

void GCController::configureFullGC(bool enabled, unsigned intervalMs)
{
    if (!m_fullCallback)
        return;

    if (enabled) {
        m_fullCallback->setEnabled(true);
        m_fullCallback->setTimeUntilFire(WTF::Seconds::fromMilliseconds(intervalMs));
    } else {
        m_fullCallback->setEnabled(false);
        m_fullCallback->cancel();
    }
}

bool GCController::hasPendingGCWork() const
{
    return Bun__isBusyDoingImportantWork(bunVM);
}

bool GCController::checkMemoryPressure() const
{

    // vm.heap.size() is slow. It makes Express 1/3 the requests per second.
    // We use blockBytesAllocated() instead.
    size_t currentHeapSize = m_vm.heap.blockBytesAllocated();

    double memoryUsageRatio = static_cast<double>(currentHeapSize) / static_cast<double>(ramSize());

    // Check allocation rate (is memory growing rapidly?)
    bool rapidMemoryGrowth = m_lastBlockBytesAllocated > 0 && (currentHeapSize > m_lastBlockBytesAllocated * 1.5);

    // Memory is considered under pressure if either condition is true
    return (memoryUsageRatio > 0.7) || // Using more than 70% of available RAM
        (rapidMemoryGrowth && m_hasStayedTheSameFor < 5) || // Rapid memory growth
        (currentHeapSize > 1024ull * 1024ull * 1024ull); // Over 1GB allocated
}

} // namespace Bun

extern "C" {

Bun::GCController* Bun__GCController__create(JSC::VM* vm)
{
    auto* clientData = WebCore::clientData(*vm);
    auto& gcController = clientData->gcController();
    return &gcController;
}

void Bun__GCController__performOpportunisticGC(Bun::GCController* controller)
{
    controller->performOpportunisticGC();
}

// TODO: expose to JS
void Bun__GCController__getMetrics(
    Bun::GCController* controller,
    size_t* incrementalSweepCount,
    size_t* edenGCCount,
    size_t* fullGCCount,
    double* totalSweepTimeMs,
    double* maxSweepTimeMs)
{
    if (!controller)
        return;

    const auto& metrics = controller->metrics();

    if (incrementalSweepCount)
        *incrementalSweepCount = metrics.incrementalSweepCount;
    if (edenGCCount)
        *edenGCCount = metrics.edenGCCount;
    if (fullGCCount)
        *fullGCCount = metrics.fullGCCount;
    if (totalSweepTimeMs)
        *totalSweepTimeMs = metrics.totalSweepTimeMs;
    if (maxSweepTimeMs)
        *maxSweepTimeMs = metrics.maxSweepTimeMs;
}

JSC::JSObject* createGCStatsObject(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto* object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype());
    return object;
}
}
