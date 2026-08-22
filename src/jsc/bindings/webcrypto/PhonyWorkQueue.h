#pragma once

#include "root.h"
#include <wtf/RefCounted.h>
#include <wtf/Ref.h>

namespace WebCore {
class ScriptExecutionContext;
}

namespace Bun {

// Work queue which really uses CppTask.Concurrent in Bun's event loop (which enqueues into a WorkPool).
// Maintained so that SubtleCrypto functions can pretend they're using a WorkQueue, even though
// WTF::WorkQueue doesn't work and we need to use Bun's equivalent.
class PhonyWorkQueue : public WTF::RefCounted<PhonyWorkQueue> {
public:
    static Ref<PhonyWorkQueue> create(WTF::ASCIILiteral name);

    // What the work returns is run back on the dispatching context's thread, on the event loop that
    // was current there when it was dispatched (so a macro that awaits it is the one that sees it).
    using Reply = Function<void(WebCore::ScriptExecutionContext&)>;
    void dispatch(JSC::JSGlobalObject* globalObject, Function<Reply()>&&);
};

}; // namespace Bun
