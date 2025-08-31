#pragma once

#include "root.h"
#include <wtf/RefCounted.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/JSObject.h>
#include <yoga/Yoga.h>
#include <atomic>

namespace Bun {

class JSYogaNode;
class JSYogaConfig;

class YogaNodeImpl : public RefCounted<YogaNodeImpl> {
public:
    static Ref<YogaNodeImpl> create(YGConfigRef config = nullptr, JSYogaConfig* jsConfig = nullptr);
    ~YogaNodeImpl();

    YGNodeRef yogaNode() const { return m_yogaNode; }

    // JS wrapper management
    void setJSWrapper(JSYogaNode*);
    void clearJSWrapper();
    void clearJSWrapperWithoutDeref(); // Clear weak ref without deref (for JS destructor)
    JSYogaNode* jsWrapper() const;

    // Config management
    JSYogaConfig* jsConfig() const { return m_jsConfig; }
    void setJSConfig(JSYogaConfig* config) { m_jsConfig = config; }

    // Helper to get YogaNodeImpl from YGNodeRef
    static YogaNodeImpl* fromYGNode(YGNodeRef);

    // Replace the internal YGNodeRef (used for cloning)
    void replaceYogaNode(YGNodeRef newNode);
    
    // Layout state management for GC protection
    void setInLayoutCalculation(bool inLayout);
    bool isInLayoutCalculation() const;
    bool hasChildrenInLayout() const;

private:
    explicit YogaNodeImpl(YGConfigRef config, JSYogaConfig* jsConfig);

    YGNodeRef m_yogaNode;
    JSC::Weak<JSYogaNode> m_wrapper;
    JSYogaConfig* m_jsConfig;
    std::atomic<bool> m_inLayoutCalculation; // Track layout state for GC protection
};

} // namespace Bun
