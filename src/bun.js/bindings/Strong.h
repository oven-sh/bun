#pragma once

#include "root.h"
#include "wtf/DebugHeap.h"
#include "wtf/IsoMalloc.h"
#include <JavaScriptCore/Strong.h>

namespace Bun {

DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(StrongRef);
// We tried to pool these
// But it was very complicated
class StrongRef {
#if ENABLE(MALLOC_BREAKDOWN)
    WTF_MAKE_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(StrongRef);
#else
    WTF_MAKE_ISO_ALLOCATED(StrongRef);
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