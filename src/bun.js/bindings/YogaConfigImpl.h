#pragma once

#include "root.h"
#include <wtf/RefCounted.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/JSObject.h>
#include <yoga/Yoga.h>

namespace Bun {

class JSYogaConfig;

class YogaConfigImpl : public RefCounted<YogaConfigImpl> {
public:
    static Ref<YogaConfigImpl> create();
    ~YogaConfigImpl();

    YGConfigRef yogaConfig() const { return m_freed ? nullptr : m_yogaConfig; }

    // JS wrapper management
    void setJSWrapper(JSYogaConfig*);
    void clearJSWrapper();
    JSYogaConfig* jsWrapper() const;

    // Helper to get YogaConfigImpl from YGConfigRef
    static YogaConfigImpl* fromYGConfig(YGConfigRef);

    // Replace the internal YGConfigRef (used for advanced cases)
    void replaceYogaConfig(YGConfigRef newConfig);

    // Mark as freed (for JS free() method validation)
    void markAsFreed() { m_freed = true; }
    bool isFreed() const { return m_freed; }

private:
    explicit YogaConfigImpl();

    YGConfigRef m_yogaConfig;
    JSC::Weak<JSYogaConfig> m_wrapper;
    bool m_freed { false };
};

} // namespace Bun
