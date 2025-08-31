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

Ref<YogaNodeImpl> YogaNodeImpl::create(YGConfigRef config, JSYogaConfig* jsConfig)
{
    return adoptRef(*new YogaNodeImpl(config, jsConfig));
}

YogaNodeImpl::YogaNodeImpl(YGConfigRef config, JSYogaConfig* jsConfig)
    : m_jsConfig(jsConfig)
    , m_inLayoutCalculation(false)
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

YogaNodeImpl* YogaNodeImpl::fromYGNode(YGNodeRef nodeRef)
{
    if (!nodeRef) return nullptr;
    return static_cast<YogaNodeImpl*>(YGNodeGetContext(nodeRef));
}

void YogaNodeImpl::replaceYogaNode(YGNodeRef newNode)
{
    if (m_yogaNode) {
        YGNodeSetContext(m_yogaNode, nullptr);
        
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

void YogaNodeImpl::setInLayoutCalculation(bool inLayout)
{
    m_inLayoutCalculation.store(inLayout);
}

bool YogaNodeImpl::isInLayoutCalculation() const
{
    return m_inLayoutCalculation.load();
}

bool YogaNodeImpl::hasChildrenInLayout() const
{
    if (!m_yogaNode) return false;
    
    size_t childCount = YGNodeGetChildCount(m_yogaNode);
    for (size_t i = 0; i < childCount; i++) {
        YGNodeRef childNode = YGNodeGetChild(m_yogaNode, i);
        YogaNodeImpl* childImpl = fromYGNode(childNode);
        if (childImpl && childImpl->isInLayoutCalculation()) {
            return true;
        }
    }
    return false;
}

} // namespace Bun
