#include "YogaNodeImpl.h"
#include "JSYogaNode.h"
#include "JSYogaConfig.h"
#include "JSYogaNodeOwner.h"
#include <yoga/Yoga.h>

namespace Bun {

Ref<YogaNodeImpl> YogaNodeImpl::create(YGConfigRef config, JSYogaConfig* jsConfig)
{
    return adoptRef(*new YogaNodeImpl(config, jsConfig));
}

YogaNodeImpl::YogaNodeImpl(YGConfigRef config, JSYogaConfig* jsConfig)
    : m_jsConfig(jsConfig)
{
    if (config) {
        m_yogaNode = YGNodeNewWithConfig(config);
    } else {
        m_yogaNode = YGNodeNew();
    }

    // Store this C++ wrapper in the Yoga node's context
    YGNodeSetContext(m_yogaNode, this);
}

YogaNodeImpl::~YogaNodeImpl()
{
    if (m_yogaNode) {
        // Clear the context pointer to avoid callbacks during cleanup
        YGNodeSetContext(m_yogaNode, nullptr);

        // Remove from parent to avoid use-after-free when parent tries to clear owner
        YGNodeRef parent = YGNodeGetParent(m_yogaNode);
        if (parent) {
            YGNodeRemoveChild(parent, m_yogaNode);
        }

        YGNodeFree(m_yogaNode);
        m_yogaNode = nullptr;
    }
}

void YogaNodeImpl::setJSWrapper(JSYogaNode* wrapper)
{
    // Only increment ref count if we don't already have a wrapper
    // This prevents ref count leaks if setJSWrapper is called multiple times
    if (!m_wrapper) {
        // Increment ref count for the weak handle context
        this->ref();
    }

    // Create weak reference with our JS owner
    m_wrapper = JSC::Weak<JSYogaNode>(wrapper, &jsYogaNodeOwner(), this);
}

void YogaNodeImpl::clearJSWrapper()
{
    m_wrapper.clear();
}

void YogaNodeImpl::clearJSWrapperWithoutDeref()
{
    // Clear weak reference without deref - used by JS destructor
    // when WeakHandleOwner::finalize will handle the deref
    m_wrapper.clear();
}

JSYogaNode* YogaNodeImpl::jsWrapper() const
{
    return m_wrapper.get();
}

YogaNodeImpl* YogaNodeImpl::fromYGNode(YGNodeRef nodeRef)
{
    if (!nodeRef) return nullptr;
    return static_cast<YogaNodeImpl*>(YGNodeGetContext(nodeRef));
}

void YogaNodeImpl::replaceYogaNode(YGNodeRef newNode)
{
    if (m_yogaNode) {
        YGNodeSetContext(m_yogaNode, nullptr);
        YGNodeFree(m_yogaNode);
    }
    m_yogaNode = newNode;
    if (newNode) {
        YGNodeSetContext(newNode, this);
    }
}

} // namespace Bun
