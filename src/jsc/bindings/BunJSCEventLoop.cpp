#include "root.h"
#include "BunClientData.h"

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/Heap.h>
#include <wtf/MonotonicTime.h>
#include <wtf/Seconds.h>

#if USE(MIMALLOC)
#include <bmalloc/mimalloc.h>
// bmalloc's vendored mimalloc.h predates these; bun links oven-sh/mimalloc,
// which defines them.
extern "C" void mi_purge_holes(void);
typedef struct {
    size_t purged_bytes, purged_blocks, purged_bytes_total;
    size_t discard_calls, reuse_calls, pages_freed;
    size_t ineligible_pages, ineligible_bytes, ineligible_free_bytes;
} Bun__mi_purge_holes_stats;
extern "C" void mi_purge_holes_stats_get(Bun__mi_purge_holes_stats*);
#endif

extern "C" int Bun__defaultRemainingRunsUntilSkipReleaseAccess;

// How often the idle hole-purge sweep may run, in milliseconds. Tunable so the
// throughput-vs-idle-memory tradeoff can be measured rather than guessed.
extern "C" int Bun__mimallocPurgeHolesIntervalMs;

extern "C" void Bun__JSC_onBeforeWait(JSC::VM* _Nonnull vm)
{
    ASSERT(vm);
    const bool previouslyHadAccess = vm->heap.hasHeapAccess();
    // sanity check for debug builds to ensure we're not doing a
    // use-after-free here
    ASSERT(vm->refCount() > 0);
    if (previouslyHadAccess) {

        // Releasing heap access is a balance between:
        // 1. CPU usage
        // 2. Memory usage
        //
        // Not releasing heap access causes benchmarks like
        // https://github.com/oven-sh/bun/pull/14885 to regress due to
        // finalizers not being called quickly enough.
        //
        // Releasing heap access too often causes high idle CPU usage.
        //
        // For the following code:
        // ```
        // setTimeout(() => {}, 10 * 1000)
        // ```
        //
        // command time -v when with defaultRemainingRunsUntilSkipReleaseAccess = 0:
        //
        //   Involuntary context switches: 605
        //
        // command time -v when with defaultRemainingRunsUntilSkipReleaseAccess = 5:
        //
        //   Involuntary context switches: 350
        //
        // command time -v when with defaultRemainingRunsUntilSkipReleaseAccess = 10:
        //
        //   Involuntary context switches: 241
        //
        // Also comapre the #14885 benchmark with different values.
        //
        // The idea here is if you entered JS "recently", running any
        // finalizers that might've been waiting to be run is a good idea.
        // But if you haven't, like if the process is just waiting on I/O
        // then don't bother.
        const int defaultRemainingRunsUntilSkipReleaseAccess = Bun__defaultRemainingRunsUntilSkipReleaseAccess;

        static thread_local int remainingRunsUntilSkipReleaseAccess = 0;

        // Note: usage of `didEnterVM` in JSC::VM conflicts with Options::validateDFGClobberize
        // We don't need to use that option, so it should be fine.
        if (vm->didEnterVM) {
            vm->didEnterVM = false;
            remainingRunsUntilSkipReleaseAccess = defaultRemainingRunsUntilSkipReleaseAccess;
        }

        if (remainingRunsUntilSkipReleaseAccess-- > 0) {
            // Constellation:
            // > If you are not moving a VM to the different thread, then you can aquire the access and do not need to release
            vm->heap.stopIfNecessary();
            vm->didEnterVM = false;

#if USE(MIMALLOC)
            // Process this thread's retired mimalloc pages so freed memory
            // returns promptly. Shares the release-access throttle above so
            // steady-idle parks stay free of per-park work.
            mi_theap_collect(mi_theap_get_default(), /* force */ false);

            // A mimalloc page is only returned to the arena once every block in
            // it is free, so one surviving object keeps the whole page dirty.
            // mi_purge_holes() discards the free blocks inside still-used pages,
            // but it walks every page queue plus the abandoned pages, so it is
            // far more expensive than the collect above. A busy loop re-enters JS
            // constantly and would otherwise run it on nearly every park; rate-
            // limit it so the cost lands on genuine idle, not on throughput.
            static thread_local MonotonicTime lastPurgeHoles;
            const auto now = MonotonicTime::now();
            if ((now - lastPurgeHoles) >= Seconds::fromMilliseconds(Bun__mimallocPurgeHolesIntervalMs)) {
                lastPurgeHoles = now;
                mi_purge_holes();

                static const bool logHoleStats = getenv("BUN_MIMALLOC_HOLE_STATS") != nullptr;
                if (logHoleStats) {
                    Bun__mi_purge_holes_stats s;
                    mi_purge_holes_stats_get(&s);
                    WTFLogAlways("[holes] discarded=%zuMB blocks=%zu total=%zuMB discards=%zu reuses=%zu pagesFreed=%zu | ineligible: pages=%zu bytes=%zuMB free=%zuMB",
                        s.purged_bytes >> 20, s.purged_blocks, s.purged_bytes_total >> 20,
                        s.discard_calls, s.reuse_calls, s.pages_freed,
                        s.ineligible_pages, s.ineligible_bytes >> 20, s.ineligible_free_bytes >> 20);
                }
            }
#endif
        }
    }
}
