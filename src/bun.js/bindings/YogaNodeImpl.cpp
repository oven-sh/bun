#include "YogaNodeImpl.h"
#include "JSYogaNode.h"
#include "JSYogaConfig.h"
#include "JSYogaNodeOwner.h"
#include <yoga/Yoga.h>
#include <wtf/HashSet.h>
#include <wtf/Lock.h>

namespace Bun {

// Simplified approach: trust Yoga's built-in parent-child management
static void simpleYGNodeFree(YGNodeRef node)
{
    if (node) {
        YGNodeFree(node);
    }
}

Ref<YogaNodeImpl> YogaNodeImpl::create(YGConfigRef config)
{
    return adoptRef(*new YogaNodeImpl(config));
}

YogaNodeImpl::YogaNodeImpl(YGConfigRef config)
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
        // Clear context immediately to prevent callbacks during cleanup
        YGNodeSetContext(m_yogaNode, nullptr);
        
        // CRITICAL: Clear all callback functions to prevent cross-test contamination  
        // This prevents reused YGNode memory from calling old callbacks
        YGNodeSetMeasureFunc(m_yogaNode, nullptr);
        YGNodeSetDirtiedFunc(m_yogaNode, nullptr);
        YGNodeSetBaselineFunc(m_yogaNode, nullptr);
        
        // Simplified pattern: only free root nodes (no parent)
        // Let Yoga handle child cleanup automatically
        YGNodeRef parent = YGNodeGetParent(m_yogaNode);
        if (!parent) {
            simpleYGNodeFree(m_yogaNode);
        }
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

JSYogaConfig* YogaNodeImpl::jsConfig() const
{
    // Access config through JS wrapper's WriteBarrier - this is GC-safe
    if (auto* jsWrapper = m_wrapper.get()) {
        return jsCast<JSYogaConfig*>(jsWrapper->m_config.get());
    }
    return nullptr;
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
        
        // Clear callback functions to prevent cross-test contamination
        YGNodeSetMeasureFunc(m_yogaNode, nullptr);
        YGNodeSetDirtiedFunc(m_yogaNode, nullptr);
        YGNodeSetBaselineFunc(m_yogaNode, nullptr);
        
        // Simplified pattern: only free if no parent (root node)
        YGNodeRef parent = YGNodeGetParent(m_yogaNode);
        if (!parent) {
            simpleYGNodeFree(m_yogaNode);
        }
    }
    m_yogaNode = newNode;
    if (newNode) {
        YGNodeSetContext(newNode, this);
    }
}

} // namespace Bun
