#include "root.h"
#include "BunClientData.h"

#include <atomic>

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/Heap.h>

#if USE(MIMALLOC)
// Matches oven-sh/mimalloc's mi_attr_noexcept declaration; bmalloc's
// vendored mimalloc.h predates this entry point.
extern "C" void mi_on_thread_idle(void) noexcept;
#endif

// Rust-side `AtomicI32` static (src/jsc/VirtualMachine.rs). Same layout as a plain
// int32_t, but Rust writes it (env parsing) while this thread reads it, so read
// it as an atomic rather than through a plain `int`.
extern "C" std::atomic<int32_t> Bun__defaultRemainingRunsUntilSkipReleaseAccess;

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
        const int defaultRemainingRunsUntilSkipReleaseAccess = Bun__defaultRemainingRunsUntilSkipReleaseAccess.load(std::memory_order_relaxed);

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
            // Collect retired pages, punch free-block holes, hand the arena purge to
            // the scavenger. Rate-limited: a busy server parks between every request,
            // and unthrottled sweeps cost ~25% of express throughput for no memory gain.
            static thread_local MonotonicTime lastIdleSweep;
            const auto now = MonotonicTime::now();
            if ((now - lastIdleSweep) >= Seconds::fromMilliseconds(100)) {
                lastIdleSweep = now;
                mi_on_thread_idle();
            }
#endif
        }
    }
}
