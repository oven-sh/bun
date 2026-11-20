#pragma once

#include "RunTermination.h"

namespace Bun {

class TestCallbackDeadlineWatch;

// bun:test's timeout for one call of a test or hook callback. The runner's timer ends a callback that waits
// on the event loop; one that keeps running script never returns there, so this requests the VM's
// termination from another thread once the deadline passes. See Bun__TestCallback__callWithDeadline.
class TestCallbackDeadline final : public RunTermination {
public:
    // `deadline`: nanoseconds on bun_core::Timespec's monotonic clock.
    TestCallbackDeadline(JSC::JSGlobalObject*, uint64_t deadline);
    ~TestCallbackDeadline();

    // Call once, after what the deadline covers. True if the deadline unwound it: that termination has been
    // withdrawn, and nothing is pending. Otherwise whatever is pending is the caller's to propagate: an
    // ordinary exception, or the termination of a VM that is being stopped as a whole.
    bool finish();

private:
    friend class RunTermination;
    bool fired() const;

    // Non-null while the deadline can still fire.
    TestCallbackDeadlineWatch* m_watch { nullptr };
    uint64_t m_armedFor { 0 };
    bool m_fired { false };
};

} // namespace Bun
