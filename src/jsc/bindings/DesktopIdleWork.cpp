#include "root.h"

#include "BunClientData.h"

#if ENABLE(AOT)
#include <JavaScriptCore/AOTTimingOfModuleLoads.h>
#endif
#include <JavaScriptCore/GCActivityCallback.h>
#include <JavaScriptCore/HeapCompaction.h>
#include <JavaScriptCore/HeapCompactionInterrupt.h>
#include <JavaScriptCore/HeapObserver.h>
#include <JavaScriptCore/IncrementalSweeper.h>
#include <JavaScriptCore/IntlObject.h>
#if __has_include(<unicode/ucal.h>)
#include <unicode/ucal.h>
#else
// macOS: libicucore has these, and the SDK has no header for them.
#include <unicode/utypes.h>
enum UCalendarType { UCAL_DEFAULT };
extern "C" void** ucal_open(const UChar*, int32_t, const char*, UCalendarType, UErrorCode*);
extern "C" void ucal_close(void**);
#endif
#include <wtf/MonotonicTime.h>

#if defined(__GLIBC__)
#include <malloc.h>
#endif
#if USE(MIMALLOC)
#include <mimalloc.h>
#endif
#if OS(DARWIN)
#include <mach-o/getsect.h>
#include <mach-o/ldsyms.h>
#elif OS(LINUX)
#include <link.h>
#endif

extern "C" void JSC__VM__collectWhileParked(JSC::VM*, JSC::CollectionScope, bool isIdle);
extern "C" bool JSC__VM__shrinkFootprintNow(JSC::VM*);
extern "C" uint32_t Bun__DOM__freedNodes();

namespace Bun {

using namespace JSC;

#if USE(MIMALLOC)
static void forEachStaticVariable(const HeapCompaction::ScanSpan& scan)
{
#if OS(DARWIN)
    for (const char* name : { SEG_DATA, "__DATA_DIRTY" }) {
        unsigned long size = 0;
        if (uint8_t* start = getsegmentdata(&_mh_execute_header, name, &size))
            scan(start, start + size);
    }
#elif OS(LINUX)
    dl_iterate_phdr([](dl_phdr_info* executable, size_t, void* argument) {
        auto& scan = *static_cast<const HeapCompaction::ScanSpan*>(argument);
        for (auto& header : std::span { executable->dlpi_phdr, executable->dlpi_phnum }) {
            auto* start = header.p_type == PT_TLS ? static_cast<uint8_t*>(executable->dlpi_tls_data) : reinterpret_cast<uint8_t*>(executable->dlpi_addr + header.p_vaddr);
            if (start && (header.p_type == PT_TLS || (header.p_type == PT_LOAD && (header.p_flags & PF_W))))
                scan(start, start + header.p_memsz);
        }
        return 1; }, const_cast<HeapCompaction::ScanSpan*>(&scan));
#else
    UNUSED_PARAM(scan);
#endif
}

// Block by block in the pages of this thread. Those of other threads can only be read as a whole, and can go away
// meanwhile, which the scan survives for spans of 4 KB and more.
static void forEachAllocation(const HeapCompaction::ScanSpan& scan)
{
    forEachStaticVariable(scan);
    struct Walk {
        const HeapCompaction::ScanSpan& scan;
        std::array<const void*, 4096> ownPages;
        size_t numberOfOwnPages { 0 };
        std::span<const void*> visited() { return std::span { ownPages }.first(numberOfOwnPages); }
    } walk { scan, {} };
    mi_theap_visit_blocks(mi_theap_get_default(), true, [](const mi_heap_t*, const mi_heap_area_t* area, void* block, size_t size, void* argument) {
        auto& walk = *static_cast<Walk*>(argument);
        if (block)
            walk.scan(block, static_cast<uint8_t*>(block) + size);
        else if (walk.numberOfOwnPages < walk.ownPages.size())
            walk.ownPages[walk.numberOfOwnPages++] = area->blocks;
        return true; }, &walk);
    std::ranges::sort(walk.visited());
    mi_subproc_visit_heaps(mi_subproc_current(), [](mi_heap_t* heap, void* argument) { return mi_heap_visit_blocks(heap, false, [](const mi_heap_t*, const mi_heap_area_t* area, void*, size_t, void* argument) {
        auto& walk = *static_cast<Walk*>(argument);
        if (area->used && !std::ranges::binary_search(walk.visited(), area->blocks))
            walk.scan(area->blocks, static_cast<uint8_t*>(area->blocks) + std::max<size_t>(area->committed, 4 * KB));
        return true; }, argument); }, &walk);
}
#endif

// Paces garbage collection by what the user sees instead of by timers: collections start in the pauses between interactions,
// and memory is given back once the program has gone quiet.
class DesktopIdleWork final : public HeapObserver {
public:
    explicit DesktopIdleWork(VM& vm)
        : m_vm(vm)
    {
        vm.heap.setEdenActivityCallback(nullptr);
        vm.heap.setFullActivityCallback(nullptr);
        vm.heap.addObserver(this);
    }

    // Returns how long the wait may last.
    Seconds beforeWait(Seconds timeout)
    {
        auto& heap = m_vm.heap;
        if (!heap.hasAccess())
            return timeout;
        auto now = MonotonicTime::now();
        uint64_t allocated = heap.totalBytesAllocated();
        m_burst = std::max(0.0, m_burst - bytesPerSecondOfChatter * (now - m_lastWait).seconds()) + (allocated - m_allocatedAtLastWait);
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
        if (double seconds = Options::secondsBetweenForcedHeapCompactions(); seconds && now - m_lastRequest >= Seconds(seconds)) [[unlikely]] {
            compact();
            m_lastRequest = MonotonicTime::now();
        }
        if (now < m_due) {
            // The allocator sweeps a block when it needs one. Freeing the empty ones now has it fault them in again.
            if (m_stopsSweeper.exchange(false) && m_step == Step::Collect)
                heap.sweeper().stopSweeping();
            uint64_t young = allocated - m_allocatedAtLastCollection;
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

private:
    enum class Step : uint8_t { Collect,
        CollectOld,
        Sweep,
        KeepSweeping,
        Release,
        Settle };

    void runStep(MonotonicTime now, uint64_t allocated)
    {
        auto& heap = m_vm.heap;
        m_hasBeenQuiet = true;
        switch (m_step) {
        case Step::Collect:
            if (allocated - m_allocatedAtLastRelease < worthReleasing) {
                m_step = Step::Settle;
                m_due = now + settleAfter;
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
            if (std::exchange(m_hasJustCompacted, false))
                m_holesAfterLastCompaction = HeapCompaction::bytesInHoles(heap);
            m_step = Step::Release;
            return;
        case Step::Release:
            release();
            m_allocatedAtLastRelease = allocated;
            m_step = Step::Settle;
            m_due = now + settleAfter;
            return;
        case Step::Settle:
            if (now >= m_nextCompaction && isWorthCompacting()) {
                m_nextCompaction = now + betweenIdleFullCollections;
                agesCode(now);
                if (compact()) {
                    m_nextIdleFullCollection = now + betweenIdleFullCollections;
                    m_step = Step::Sweep;
                    return;
                }
            }
            if (now >= m_nextIdleFullCollection && (agesCode(now) || hasGrown(growthWhenSettled) || hasClosedViews())) {
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

    bool isWorthCompacting() const { return Options::useHeapCompaction() && HeapCompaction::bytesInHoles(m_vm.heap) >= m_holesAfterLastCompaction + worthCompacting; }

    // Returns whether that collected.
    bool compact()
    {
#if USE(MIMALLOC)
        JSLockHolder lock(m_vm);
        auto result = HeapCompaction::collectAndCompact(m_vm.heap, [](const HeapCompaction::ScanSpan& scan) { forEachAllocation(scan); });
        m_hasJustCompacted = result.skipped.isNull();
        return result.didCollect;
#else
        return false;
#endif
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
#endif
    }

    void willGarbageCollect() final {}
    void didGarbageCollect(CollectionScope scope) final
    {
        if (scope == CollectionScope::Full)
            m_freedNodesAtLastFullCollection = Bun__DOM__freedNodes();
        m_allocatedAtLastCollection = m_vm.heap.totalBytesAllocated();
        m_stopsSweeper = true;
    }

    static constexpr uint32_t nodesOfAView = 600;
    static constexpr uint64_t nurseryBytes = 24 * MB;
    static constexpr uint64_t worthReleasing = 4 * MB;
    static constexpr size_t worthCompacting = 8 * MB;
    static constexpr double activityBytes = 256 * KB;
    static constexpr double bytesPerSecondOfChatter = 256 * KB;
    // What a render leaves behind dies soon after it has been promoted. Until it is freed, survivors are spread over ever more blocks.
    static constexpr double growthWhileBusy = 1.35;
    static constexpr double growthWhenQuiet = 1.12;
    static constexpr double growthWhenSettled = 1.06;
    static constexpr Seconds minimumGap = 100_ms;
    static constexpr Seconds lullAfter = 150_ms;
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
    MonotonicTime m_lastWait { MonotonicTime::now() };
    MonotonicTime m_due { m_lastWait + quietAfter };
    MonotonicTime m_quietSince { m_lastWait };
    MonotonicTime m_lastRequest;
    MonotonicTime m_nextShrink;
    MonotonicTime m_nextCompaction;
    MonotonicTime m_nextIdleFullCollection;
    size_t m_holesAfterLastCompaction { 0 };
    size_t m_agingRounds { 0 };
    Step m_step { Step::Collect };
    bool m_hasJustCompacted { false };
    bool m_hasBeenQuiet { false };
    std::atomic<bool> m_stopsSweeper { false };
};

} // namespace Bun

extern "C" Bun::DesktopIdleWork* Bun__DesktopIdleWork__create(JSC::VM* vm, bool (*hasInput)())
{
    JSC::setHeapCompactionInterruptCheck(hasInput);
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

extern "C" long long Bun__DesktopIdleWork__beforeWait(Bun::DesktopIdleWork* work, long long timeoutNs)
{
    Seconds timeout = work->beforeWait(timeoutNs < 0 ? Seconds::infinity() : Seconds::fromNanoseconds(timeoutNs));
    return timeout.isInfinity() ? -1 : timeout.nanosecondsAs<long long>();
}

extern "C" void JSC__useOptionsForDesktopProgram(const char* envp[], size_t envc)
{
    RELEASE_ASSERT(!g_jscConfig.isPermanentlyFrozen());
#if ENABLE(AOT)
    JSC::AOT::relaxTimingOfModuleLoads();
#endif
    JSC::Options::warmUpMarkedBlockStartAfterBlocks() = 64;
    JSC::Options::warmUpMarkedBlockCount() = 64;
    JSC::Options::releaseIdleRegExpCodeWhenShrinkingFootprint() = true;
    JSC::Options::numberOfGCMarkers() = std::min(JSC::Options::numberOfGCMarkers(), 4u);
    JSC::Options::largeHeapSize() = 32 * MB;
    JSC::Options::heapGrowthMaxIncrease() = 0.5;
    JSC::Options::smallHeapGrowthFactor() = 1.5;
    JSC::Options::minEdenToOldGenerationRatio() = 0.18;
    // The window that calls `postMessage()` is found on the stack.
    JSC::Options::useTailCalls() = false;
    static constexpr std::array names { "warmUpMarkedBlock"_s, "releaseIdleRegExpCodeWhenShrinkingFootprint="_s, "numberOfGCMarkers="_s, "largeHeapSize="_s, "heapGrowthMaxIncrease="_s, "smallHeapGrowthFactor="_s, "minEdenToOldGenerationRatio="_s };
    for (size_t i = 0; i < envc; i++) {
        auto entry = WTF::StringView::fromLatin1(envp[i]);
        if (entry.startsWith("BUN_JSC_"_s) && std::ranges::any_of(names, [&](auto name) { return entry.substring(8).startsWithIgnoringASCIICase(name); }))
            JSC::Options::setOption(envp[i] + 8, false);
        // Child processes inherit the environment, and another version of Bun refuses a BUN_JSC_ option that it does not know.
        if (entry.startsWith("BUN_DESKTOP_JSC_"_s))
            JSC::Options::setOption(envp[i] + 16, false);
    }
}
