#pragma once

#include <wtf/RefCounted.h>
#include <wtf/Ref.h>
#include <wtf/Function.h>

namespace Bun {

// Work queue which really uses CppTask.Concurrent in Bun's event loop (which enqueues into a WorkPool).
// Maintained so that SubtleCrypto functions can pretend they're using a WorkQueue, even though
// WTF::WorkQueue doesn't work and we need to use Bun's equivalent.
class PhonyWorkQueue : public WTF::RefCounted<PhonyWorkQueue> {
public:
    static Ref<PhonyWorkQueue> create(WTF::ASCIILiteral name);

    void dispatch(Function<void()>&&);
};

}; // namespace Bun
