#pragma once

#include "root.h"

#include <wtf/Forward.h>

namespace WebCore {

class DOMWrapperWorld : public RefCounted<DOMWrapperWorld> {
public:
    enum class Type {
        Normal, // Main (e.g. Page)
        User, // User Scripts (e.g. Extensions)
        Internal, // WebKit Internal (e.g. Media Controls)
    };

    static Ref<DOMWrapperWorld> create(JSC::VM& vm, Type type = Type::Internal)
    {
        return adoptRef(*new DOMWrapperWorld(vm, type));
    }
    WEBCORE_EXPORT ~DOMWrapperWorld();

    bool isNormal() const { return m_type == Type::Normal; }

    JSC::VM& vm() const { return m_vm; }

protected:
    DOMWrapperWorld(JSC::VM&, Type);

private:
    JSC::VM& m_vm;

    Type m_type { Type::Internal };
};

} // namespace WebCore
