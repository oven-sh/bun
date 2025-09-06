#include "YogaConfigImpl.h"
#include "JSYogaConfig.h"
#include "JSYogaConfigOwner.h"
#include <yoga/Yoga.h>

namespace Bun {

Ref<YogaConfigImpl> YogaConfigImpl::create()
{
    return adoptRef(*new YogaConfigImpl());
}

YogaConfigImpl::YogaConfigImpl()
{
    m_yogaConfig = YGConfigNew();

    // Store this C++ wrapper in the Yoga config's context
    // Note: YGConfig doesn't have context like YGNode, so we handle this differently
}

YogaConfigImpl::~YogaConfigImpl()
{
    if (m_yogaConfig) {
        YGConfigFree(m_yogaConfig);
        m_yogaConfig = nullptr;
    }
}

void YogaConfigImpl::setJSWrapper(JSYogaConfig* wrapper)
{
    // Only increment ref count if we don't already have a wrapper
    // This prevents ref count leaks if setJSWrapper is called multiple times
    if (!m_wrapper) {
        // Increment ref count for the weak handle context
        this->ref();
    }

    // Create weak reference with our JS owner
    m_wrapper = JSC::Weak<JSYogaConfig>(wrapper, &jsYogaConfigOwner(), this);
}

void YogaConfigImpl::clearJSWrapper()
{
    m_wrapper.clear();
}

void YogaConfigImpl::clearJSWrapperWithoutDeref()
{
    // Clear weak reference without deref - used by JS destructor
    // when WeakHandleOwner::finalize will handle the deref
    m_wrapper.clear();
}

JSYogaConfig* YogaConfigImpl::jsWrapper() const
{
    return m_wrapper.get();
}

YogaConfigImpl* YogaConfigImpl::fromYGConfig(YGConfigRef configRef)
{
    // YGConfig doesn't have context storage like YGNode
    // We'd need to maintain a separate map if needed
    return nullptr;
}

void YogaConfigImpl::replaceYogaConfig(YGConfigRef newConfig)
{
    if (m_yogaConfig) {
        YGConfigFree(m_yogaConfig);
    }
    m_yogaConfig = newConfig;
}

} // namespace Bun
