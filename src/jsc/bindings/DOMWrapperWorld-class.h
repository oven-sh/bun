#pragma once

#include "root.h"

#include <wtf/Forward.h>

namespace WebCore {

class DOMWrapperWorld : public RefCounted<DOMWrapperWorld> {
public:
    static Ref<DOMWrapperWorld> create(JSC::VM& vm)
    {
        return adoptRef(*new DOMWrapperWorld(vm));
    }
    WEBCORE_EXPORT ~DOMWrapperWorld();

    JSC::VM& vm() const { return m_vm; }

protected:
    explicit DOMWrapperWorld(JSC::VM&);

private:
    JSC::VM& m_vm;
};

} // namespace WebCore
