#pragma once

#include "root.h"
#include <wtf/RefCounted.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/JSObject.h>
#include <yoga/Yoga.h>

namespace Bun {

class JSYogaNode;
class JSYogaConfig;

class YogaNodeImpl : public RefCounted<YogaNodeImpl> {
public:
    static Ref<YogaNodeImpl> create(YGConfigRef config = nullptr);
    ~YogaNodeImpl();

    YGNodeRef yogaNode() const { return m_yogaNode; }

    // JS wrapper management
    void setJSWrapper(JSYogaNode*);
    void clearJSWrapper();
    void clearJSWrapperWithoutDeref(); // Clear weak ref without deref (for JS destructor)
    JSYogaNode* jsWrapper() const;
    
    // Config access through JS wrapper's WriteBarrier
    JSYogaConfig* jsConfig() const;


    // Helper to get YogaNodeImpl from YGNodeRef
    static YogaNodeImpl* fromYGNode(YGNodeRef);

    // Replace the internal YGNodeRef (used for cloning)
    void replaceYogaNode(YGNodeRef newNode);

private:
    explicit YogaNodeImpl(YGConfigRef config);

    YGNodeRef m_yogaNode;
    JSC::Weak<JSYogaNode> m_wrapper;
};

} // namespace Bun
