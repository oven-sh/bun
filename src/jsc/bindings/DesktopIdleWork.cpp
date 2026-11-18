#include "root.h"

#include "DesktopICU.h"
#include "BunClientData.h"

#if ENABLE(AOT)
#include <JavaScriptCore/AOTInstance.h>
#include <JavaScriptCore/AOTInstanceLayout.h>
#include <JavaScriptCore/AOTState.h>
#include <JavaScriptCore/AOTTimingOfModuleLoads.h>
#include <JavaScriptCore/AOTVMState.h>
#endif
#include <JavaScriptCore/BlockDirectory.h>
#include <JavaScriptCore/DeferGCInlines.h>
#include <JavaScriptCore/GCActivityCallback.h>
#include <JavaScriptCore/HeapObserver.h>
#include <JavaScriptCore/IncrementalSweeper.h>
#include <JavaScriptCore/IntlObject.h>
#include <wtf/MonotonicTime.h>
#include <wtf/OSAllocator.h>
#include <wtf/PageBlock.h>

#if OS(DARWIN) || OS(LINUX)
#include <sys/mman.h>
#endif

#if defined(__GLIBC__)
#include <malloc.h>
#elif OS(DARWIN)
#include <malloc/malloc.h>
#endif
#if USE(MIMALLOC)
#include <mimalloc.h>
#endif

extern "C" void JSC__VM__collectWhileParked(JSC::VM*, JSC::CollectionScope, bool isIdle);
extern "C" bool JSC__VM__shrinkFootprintNow(JSC::VM*);
extern "C" uint32_t Bun__DOM__freedNodes();

namespace Bun {

using namespace JSC;

// Paces garbage collection by what the user sees instead of by timers: collections start in the pauses between interactions,
// and memory is given back once the program has gone quiet.
#if ENABLE(AOT) && (OS(DARWIN) || OS(LINUX))
// What it reads includes the unused capacity of vectors.
SUPPRESS_ASAN static bool holdsOnlyZeros(const uint8_t* page, size_t size)
{
    auto* words = reinterpret_cast<const uintptr_t*>(page);
    for (size_t i = 0; i < size / sizeof(uintptr_t); ++i) {
        if (words[i])
            return false;
    }
    return true;
}

static void giveBackPagesOfZeros(uint8_t* begin, uint8_t* end)
{
#if OS(DARWIN)
    std::array<char, 4096> residency;
#else
    std::array<unsigned char, 4096> residency;
#endif
    size_t sizeOfPage = pageSize();
    begin = reinterpret_cast<uint8_t*>(roundUpToMultipleOf(sizeOfPage, reinterpret_cast<uintptr_t>(begin)));
    while (begin < end && static_cast<size_t>(end - begin) >= sizeOfPage) {
        size_t count = std::min(residency.size(), static_cast<size_t>(end - begin) / sizeOfPage);
        if (mincore(begin, count * sizeOfPage, residency.data()))
            return;
        for (size_t page = 0; page < count; ++page) {
            size_t first = page;
            while (page < count && (residency[page] & 1) && holdsOnlyZeros(begin + page * sizeOfPage, sizeOfPage))
                ++page;
            if (page > first)
                OSAllocator::decommit(begin + first * sizeOfPage, (page - first) * sizeOfPage);
        }
        begin += count * sizeOfPage;
    }
}

// On the thread of the VM, with no collection under way. The poll page and the method table are protected or map the image.
static void giveBackPagesOfZeros(VM& vm)
{
    using AOT::InstanceLayout;
    for (AOT::Instance* instance : vm.aotState().instances) {
        auto sizes = instance->tables().instanceSizes;
        auto* start = reinterpret_cast<uint8_t*>(instance);
        uint8_t* pollPage = start + InstanceLayout::offsetOfLoopPollPage();
        giveBackPagesOfZeros(start - InstanceLayout::bytesReservedBelowInstance(sizes), pollPage);
        giveBackPagesOfZeros(pollPage + InstanceLayout::bytesReservedForLoopPollPage, start + InstanceLayout::offsetOfMethodTable(sizes));
        giveBackPagesOfZeros(start + InstanceLayout::offsetOfSiteCaches(sizes), start + InstanceLayout::bytesReservedFromInstance(sizes));
        for (auto [pages, size] : instance->state->pages.ranges())
            giveBackPagesOfZeros(static_cast<uint8_t*>(pages), static_cast<uint8_t*>(pages) + size);
    }
}
#endif

class DesktopIdleWork final : public HeapObserver {
public:
    explicit DesktopIdleWork(VM& vm)
        : m_vm(vm)
    {
        vm.heap.setEdenActivityCallback(nullptr);
        vm.heap.setFullActivityCallback(nullptr);
        vm.heap.addObserver(this);
    }

    // Returns how long the wait may last. Nothing is planned for the time of `slack`.
    Seconds beforeWait(Seconds timeout, Seconds slack)
    {
        auto& heap = m_vm.heap;
        if (!heap.hasAccess())
            return timeout;
        auto now = MonotonicTime::now();
        uint64_t allocated = heap.totalBytesAllocated();
        m_burst = std::max(0.0, m_burst - bytesPerSecondOfChatter * (now - m_lastWait).seconds()) + (allocated - m_allocatedAtLastWait);
        // What a program does in the background does not put off settling.
        m_work = std::max(0.0, m_work - bytesPerSecondOfChores * (now - m_lastWait).seconds()) + (allocated - m_allocatedAtLastWait);
        if (m_work > workBytes) {
            m_work = 0;
            m_settlesAt = now + quietAfter + settleAfter;
        }
        m_lastWait = now;
        m_allocatedAtLastWait = allocated;
        if (m_burst > activityBytes) {
            m_burst = 0;
            m_step = Step::Collect;
            m_due = now + quietAfter;
            m_quietSince = now;
            m_agingRounds = 0;
        }
        if (isCollecting()) {
            heap.stopIfNecessary();
            return std::min(timeout, 5_ms);
        }
        if (now < m_due) {
            // The allocator sweeps a block when it needs one. Freeing the empty ones now has it fault them in again.
            if (m_stopsSweeper.exchange(false) && m_step == Step::Collect)
                heap.sweeper().stopSweeping();
            uint64_t young = allocated - m_allocatedAtLastCollection;
            if (destroyWithin(slack, now))
                return 0_s;
            if (young < nurseryBytes || now - m_lastRequest < minimumGap)
                return std::min(timeout, m_due - now);
            if (now - m_quietSince < lullAfter && (!m_hasBeenQuiet || young < 2 * nurseryBytes))
                return std::min(timeout, m_quietSince + lullAfter - now);
            m_lastRequest = now;
            collect(hasGrown(growthWhileBusy) ? CollectionScope::Full : CollectionScope::Eden, false);
            return 0_s;
        }
        runStep(now, allocated);
        return std::min(timeout, std::max(0_s, m_due - MonotonicTime::now()));
    }

    // Scrolling and typing can allocate next to nothing.
    void didGetEvents(bool hasInput)
    {
        auto now = MonotonicTime::now();
        if (hasInput || now - m_lastEvent > lullAfter)
            m_framesSince = now;
        m_lastEvent = now;
        if (hasInput) {
            m_due = std::max(m_due, now + quietAfterInput);
            m_quietSince = now;
        } else if (now - m_framesSince < longestWaitForFramesToEnd)
            m_due = std::max(m_due, now + lullAfter);
    }

private:
    enum class Step : uint8_t { Collect,
        CollectOld,
        Sweep,
        KeepSweeping,
        Release,
        Settle };

    // Else the allocator does, in the middle of a task. The blocks stay.
    bool destroyWithin(Seconds slack, MonotonicTime now)
    {
        auto& heap = m_vm.heap;
        if (m_hasUnsweptBlocks.exchange(false)) {
            m_directoryToSweep = heap.objectSpace().firstDirectory();
            m_blockToSweep = 0;
        }
        if (!m_directoryToSweep || slack < marginOfSlack)
            return false;
        JSLockHolder lock(m_vm);
        DeferGCForAWhile deferGC(m_vm);
        heap.clearConcurrentRetainedDataIfPossible();
        while (m_directoryToSweep && MonotonicTime::now() < now + marginOfSlack / 2) {
            if (auto* block = m_directoryToSweep->destruction() == DoesNotNeedDestruction ? nullptr : m_directoryToSweep->findBlockToSweep(m_blockToSweep)) {
                block->sweep(nullptr);
                m_directoryToSweep->didFinishUsingBlock(block);
                ++m_blockToSweep;
            } else {
                m_directoryToSweep = m_directoryToSweep->nextDirectory();
                m_blockToSweep = 0;
            }
        }
        return true;
    }

    void runStep(MonotonicTime now, uint64_t allocated)
    {
        auto& heap = m_vm.heap;
        m_hasBeenQuiet = true;
        switch (m_step) {
        case Step::Collect:
            if (allocated - m_allocatedAtLastRelease < worthReleasing) {
                m_step = Step::Settle;
                m_due = std::max(now, m_settlesAt);
                return;
            }
            m_step = Step::CollectOld;
            collect(CollectionScope::Eden, false);
            return;
        case Step::CollectOld:
            m_step = Step::Sweep;
            if (now >= m_nextIdleFullCollection && (hasGrown(growthWhenQuiet) || hasClosedViews()))
                collectOld(now);
            return;
        case Step::Sweep:
            // It may have been stopped, and shrink() takes every empty block for swept.
            heap.sweeper().startSweeping(heap);
            m_step = Step::KeepSweeping;
            return;
        case Step::KeepSweeping:
            heap.sweeper().doWorkUntil(m_vm, ApproximateTime::now() + 2_ms);
            if (heap.sweeper().timeUntilFire())
                return;
            heap.objectSpace().shrink();
            m_step = Step::Release;
            return;
        case Step::Release:
            release();
#if ENABLE(AOT) && (OS(DARWIN) || OS(LINUX))
            if (Options::runsCompiledImage())
                giveBackPagesOfZeros(m_vm);
#endif
            m_allocatedAtLastRelease = allocated;
            m_step = Step::Settle;
            m_due = std::max(now, m_settlesAt);
            return;
        case Step::Settle:
            if (now >= m_nextIdleFullCollection && (agesCode(now) || hasGrown(growthWhenSettled) || hasClosedViews() || mayHaveLetGo(now))) {
                m_step = Step::Sweep;
                collectOld(now);
                return;
            }
            m_step = Step::Collect;
            m_due = now + restFor;
            return;
        }
    }

    // Full collections are also what lets go of code that no longer runs. A compiled program only has RegExp code to lose.
    bool agesCode(MonotonicTime now)
    {
        if (Options::runsCompiledImage()) {
            if (now < m_nextShrink || m_agingRounds || !JSC__VM__shrinkFootprintNow(&m_vm))
                return false;
            m_nextShrink = now + betweenShrinks;
            m_agingRounds = 1;
            return true;
        }
        static constexpr std::array rounds { 10_s, 2_min, 10_min };
        if (m_agingRounds == rounds.size() || now - m_quietSince < rounds[m_agingRounds])
            return false;
        if (m_agingRounds + 1 == rounds.size() && !JSC__VM__shrinkFootprintNow(&m_vm))
            return false;
        ++m_agingRounds;
        return true;
    }

    bool hasGrown(double factor) const { return m_vm.heap.sizeAfterLastCollection() > m_vm.heap.sizeAfterLastFullCollection() * factor; }
    // What was behind them is old, and has died without the heap growing.
    bool hasClosedViews() const { return Bun__DOM__freedNodes() - m_freedNodesAtLastFullCollection >= nodesOfAView; }
    // Programs drop what they kept for quick reuse on timers. Once after each stretch of work.
    bool mayHaveLetGo(MonotonicTime now) const { return now >= m_settlesAt + restFor && m_nextIdleFullCollection < m_settlesAt + restFor + betweenIdleFullCollections; }
    bool isCollecting() const { return WebCore::clientData(m_vm)->idleCollectionsPending.load() || m_vm.heap.collectionScope(); }

    void collect(CollectionScope scope, bool isIdle)
    {
        JSC__VM__collectWhileParked(&m_vm, scope, isIdle);
    }

    void collectOld(MonotonicTime now)
    {
        m_nextIdleFullCollection = now + betweenIdleFullCollections;
        collect(CollectionScope::Full, true);
    }

    static void release()
    {
        WTF::releaseFastMallocFreeMemory();
#if USE(MIMALLOC)
        mi_on_thread_idle();
        mi_collect(true);
#endif
#if defined(__GLIBC__)
        malloc_trim(0);
#elif OS(DARWIN)
        malloc_zone_pressure_relief(nullptr, 0);
#endif
    }

    void willGarbageCollect() final {}
    void didGarbageCollect(CollectionScope scope) final
    {
        if (scope == CollectionScope::Full)
            m_freedNodesAtLastFullCollection = Bun__DOM__freedNodes();
        m_allocatedAtLastCollection = m_vm.heap.totalBytesAllocated();
        m_hasUnsweptBlocks = true;
        m_stopsSweeper = true;
    }

    static constexpr uint32_t nodesOfAView = 120;
    static constexpr uint64_t nurseryBytes = 24 * MB;
    static constexpr uint64_t worthReleasing = 4 * MB;
    static constexpr double activityBytes = 256 * KB;
    static constexpr double bytesPerSecondOfChatter = 256 * KB;
    static constexpr double workBytes = 3 * MB;
    static constexpr double bytesPerSecondOfChores = 1 * MB;
    // What a render leaves behind dies soon after it has been promoted. Until it is freed, survivors are spread over ever more blocks.
    static constexpr double growthWhileBusy = 1.35;
    static constexpr double growthWhenQuiet = 1.12;
    static constexpr double growthWhenSettled = 1.06;
    static constexpr Seconds marginOfSlack = 2_ms;
    static constexpr Seconds minimumGap = 100_ms;
    static constexpr Seconds lullAfter = 150_ms;
    static constexpr Seconds quietAfterInput = 1_s;
    static constexpr Seconds longestWaitForFramesToEnd = 10_s;
    static constexpr Seconds quietAfter = 2_s;
    static constexpr Seconds settleAfter = 8_s;
    static constexpr Seconds restFor = 30_s;
    static constexpr Seconds betweenIdleFullCollections = 30_s;
    static constexpr Seconds betweenShrinks = 10_min;

    VM& m_vm;
    std::atomic<uint64_t> m_allocatedAtLastCollection { 0 };
    std::atomic<uint32_t> m_freedNodesAtLastFullCollection { 0 };
    uint64_t m_allocatedAtLastRelease { 0 };
    uint64_t m_allocatedAtLastWait { 0 };
    double m_burst { 0 };
    double m_work { 0 };
    MonotonicTime m_lastWait { MonotonicTime::now() };
    MonotonicTime m_due { m_lastWait + quietAfter };
    MonotonicTime m_quietSince { m_lastWait };
    MonotonicTime m_lastEvent;
    MonotonicTime m_framesSince;
    MonotonicTime m_settlesAt { m_due + settleAfter };
    MonotonicTime m_lastRequest;
    MonotonicTime m_nextShrink;
    MonotonicTime m_nextIdleFullCollection;
    size_t m_agingRounds { 0 };
    Step m_step { Step::Collect };
    bool m_hasBeenQuiet { false };
    std::atomic<bool> m_stopsSweeper { false };
    std::atomic<bool> m_hasUnsweptBlocks { false };
    BlockDirectory* m_directoryToSweep { nullptr };
    unsigned m_blockToSweep { 0 };
};

} // namespace Bun

extern "C" Bun::DesktopIdleWork* Bun__DesktopIdleWork__create(JSC::VM* vm)
{
    if (JSC::Options::runsCompiledImage()) {
        WTF::Thread::create("WarmICU"_s, [] {
            JSC::initializeAvailableTimeZones();
            UErrorCode status = U_ZERO_ERROR;
            ucal_close(ucal_open(nullptr, 0, "", UCAL_DEFAULT, &status));
            JSC::intlAvailableLocales();
            JSC::intlSegmenterAvailableLocales();
        })->detach();
    }
    return new Bun::DesktopIdleWork(*vm);
}

extern "C" long long Bun__DesktopIdleWork__beforeWait(Bun::DesktopIdleWork* work, long long timeoutNs, double slackMs)
{
    Seconds timeout = timeoutNs < 0 ? Seconds::infinity() : Seconds::fromNanoseconds(timeoutNs);
    timeout = work->beforeWait(timeout, std::min(timeout, Seconds::fromMilliseconds(slackMs)));
    return timeout.isInfinity() ? -1 : timeout.nanosecondsAs<long long>();
}

extern "C" void Bun__DesktopIdleWork__didGetEvents(Bun::DesktopIdleWork* work, bool hasInput)
{
    work->didGetEvents(hasInput);
}

extern "C" void JSC__useOptionsForDesktopProgram()
{
#if ENABLE(AOT)
    JSC::AOT::relaxTimingOfModuleLoads();
#endif
#if USE(MIMALLOC)
    // What a frame frees, one of the next few allocates again.
    mi_option_set_default(mi_option_purge_delay, 1000);
#endif
    JSC::Options::warmUpMarkedBlockStartAfterBlocks() = 64;
    JSC::Options::warmUpMarkedBlockCount() = 64;
    JSC::Options::releaseIdleRegExpCodeWhenShrinkingFootprint() = true;
    JSC::Options::numberOfGCMarkers() = std::min(JSC::Options::numberOfGCMarkers(), 4u);
    JSC::Options::largeHeapSize() = 32 * MB;
    JSC::Options::smallHeapSize() = 4 * MB;
    JSC::Options::heapGrowthMaxIncrease() = 0.5;
    JSC::Options::smallHeapGrowthFactor() = 1.5;
    JSC::Options::minEdenToOldGenerationRatio() = 0.18;
    // The window that calls `postMessage()` is found on the stack.
    JSC::Options::useTailCalls() = false;
}
