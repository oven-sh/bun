#include "YogaNodeImpl.h"
#include "JSYogaNode.h"
#include "JSYogaConfig.h"
#include "JSYogaNodeOwner.h"
#include <yoga/Yoga.h>
#include <wtf/HashSet.h>
#include <wtf/Lock.h>

namespace Bun {

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
    // Free the underlying Yoga node if it hasn't been freed already.
    // When the user calls .free() explicitly, replaceYogaNode(nullptr) sets
    // m_yogaNode to null first, so this guard prevents double-free.
    if (m_yogaNode && m_ownsNode) {
        // Use YGNodeFinalize instead of YGNodeFree: it frees the node's
        // memory without disconnecting it from its owner or children.
        // This is safe during GC, where nodes in the same tree may be
        // swept in arbitrary order and parent/child pointers may already
        // be dangling.
        YGNodeFinalize(m_yogaNode);
    }
    m_yogaNode = nullptr;
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
    if (newNode) {
        // Free the old node if we are replacing it with a different one.
        // This prevents leaks when, e.g., the clone path creates a throwaway
        // YGNode via create(nullptr) and immediately replaces it.
        if (m_yogaNode && m_yogaNode != newNode && m_ownsNode) {
            YGNodeFinalize(m_yogaNode);
        }

        // Update the context pointer to point to this impl.
        // YGNodeClone performs a deep clone (new YGNode objects throughout),
        // so there is no sharing of nodes and no previous owner to notify.
        YGNodeSetContext(newNode, this);
    }

    // When newNode is null (called from .free() after YGNodeFree), the old
    // m_yogaNode was already freed by the caller -- just clear the pointer.
    m_yogaNode = newNode;
    m_ownsNode = (newNode != nullptr);
}

} // namespace Bun
