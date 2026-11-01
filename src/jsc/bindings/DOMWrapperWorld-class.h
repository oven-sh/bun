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

    static Ref<DOMWrapperWorld> create(JSC::VM& vm, Type type = Type::Internal, const String& name = {})
    {
        return adoptRef(*new DOMWrapperWorld(vm, type, name));
    }
    WEBCORE_EXPORT ~DOMWrapperWorld();

    Type type() const { return m_type; }
    bool isNormal() const { return m_type == Type::Normal; }

    const String& name() const { return m_name; }

    JSC::VM& vm() const { return m_vm; }

protected:
    DOMWrapperWorld(JSC::VM&, Type, const String& name);

private:
    JSC::VM& m_vm;

    String m_name;
    Type m_type { Type::Internal };
};

} // namespace WebCore
