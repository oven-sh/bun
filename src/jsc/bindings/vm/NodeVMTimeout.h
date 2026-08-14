#pragma once

#include "root.h"
#include "SigintReceiver.h"
#include <wtf/Lock.h>
#include <wtf/ThreadSafeRefCounted.h>

namespace Bun {

// The `timeout` of one node:vm run: a wall-clock timer that asks the VM to terminate (the same request SIGINT and
// worker.terminate() make) and remembers that it did, so the run can tell its own timeout from theirs.
class NodeVMTimeout {
    WTF_MAKE_NONCOPYABLE(NodeVMTimeout);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    NodeVMTimeout(JSC::VM&, std::optional<double> timeoutMs);
    ~NodeVMTimeout() { disarm(); }

    // The timer will not touch the VM after this returns. Whether it had already fired.
    bool disarm();

    // After the run: if this timeout or a SIGINT for `receiver` stopped it, take that termination off the VM (servicing
    // the request first if the script finished before it was delivered) and throw ERR_SCRIPT_EXECUTION_{TIMEOUT,
    // INTERRUPTED} into `scope`. Otherwise false: nothing happened, or the termination belongs to worker.terminate()
    // or an enclosing run and the caller rethrows what it caught.
    bool takeOwnTermination(JSC::JSGlobalObject* errorGlobalObject, JSC::JSGlobalObject* drainGlobalObject, JSC::ThrowScope&, SigintReceiver&);

private:
    struct State : public ThreadSafeRefCounted<State> {
        Lock lock;
        JSC::VM* vm WTF_GUARDED_BY_LOCK(lock) { nullptr }; // null once disarmed or fired
        bool fired WTF_GUARDED_BY_LOCK(lock) { false };
    };

    JSC::VM& m_vm;
    std::optional<double> m_timeoutMs;
    RefPtr<State> m_state;
    bool m_fired { false };
};

} // namespace Bun
