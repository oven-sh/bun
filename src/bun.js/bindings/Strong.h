#pragma once

#include "root.h"
#include "JavaScriptCore/Strong.h"

namespace Bun {

// We tried to pool these
// But it was very complicated
class StrongRef {
    WTF_MAKE_ISO_ALLOCATED(StrongRef);

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