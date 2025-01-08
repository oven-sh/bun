#pragma once

#include "root.h"

#include <wtf/Forward.h>

namespace WebCore {

class WindowProxy;

typedef HashMap<void*, JSC::Weak<JSC::JSObject>> DOMObjectWrapperMap;

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

    // Free as much memory held onto by this world as possible.
    WEBCORE_EXPORT void clearWrappers();

    void didCreateWindowProxy(WindowProxy* controller) { m_jsWindowProxies.add(controller); }
    void didDestroyWindowProxy(WindowProxy* controller) { m_jsWindowProxies.remove(controller); }

    void setShadowRootIsAlwaysOpen() { m_shadowRootIsAlwaysOpen = true; }
    bool shadowRootIsAlwaysOpen() const { return m_shadowRootIsAlwaysOpen; }

    void disableLegacyOverrideBuiltInsBehavior() { m_shouldDisableLegacyOverrideBuiltInsBehavior = true; }
    bool shouldDisableLegacyOverrideBuiltInsBehavior() const { return m_shouldDisableLegacyOverrideBuiltInsBehavior; }

    DOMObjectWrapperMap& wrappers() { return m_wrappers; }

    Type type() const { return m_type; }
    bool isNormal() const { return m_type == Type::Normal; }

    const String& name() const { return m_name; }

    JSC::VM& vm() const { return m_vm; }

protected:
    DOMWrapperWorld(JSC::VM&, Type, const String& name);

private:
    JSC::VM& m_vm;
    UncheckedKeyHashSet<WindowProxy*> m_jsWindowProxies;
    DOMObjectWrapperMap m_wrappers;

    String m_name;
    Type m_type { Type::Internal };

    bool m_shadowRootIsAlwaysOpen { false };
    bool m_shouldDisableLegacyOverrideBuiltInsBehavior { false };
};

} // namespace WebCore
