#pragma once

#include "root.h"
#include "wtf/DebugHeap.h"
#include <JavaScriptCore/Strong.h>

namespace Bun {

// We tried to pool these
// But it was very complicated
class StrongRef {
#if ENABLE(MALLOC_BREAKDOWN)
    DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(StrongRef);
    WTF_MAKE_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(StrongRef);
#else
    WTF_MAKE_FAST_ALLOCATED(StrongRef);
#endif

public:
    StrongRef(JSC::VM& vm, JSC::JSValue value)
        : m_cell(vm, value)
    {
    }

    StrongRef()
        : m_cell()
    {
    }

    JSC::Strong<JSC::Unknown> m_cell;
};

}
