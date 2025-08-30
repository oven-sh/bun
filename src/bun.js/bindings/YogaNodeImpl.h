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
    static Ref<YogaNodeImpl> create(YGConfigRef config = nullptr, JSYogaConfig* jsConfig = nullptr);
    ~YogaNodeImpl();

    YGNodeRef yogaNode() const { return m_yogaNode; }

    // JS wrapper management
    void setJSWrapper(JSYogaNode*);
    void clearJSWrapper();
    JSYogaNode* jsWrapper() const;

    // Config management
    JSYogaConfig* jsConfig() const { return m_jsConfig; }
    void setJSConfig(JSYogaConfig* config) { m_jsConfig = config; }

    // Helper to get YogaNodeImpl from YGNodeRef
    static YogaNodeImpl* fromYGNode(YGNodeRef);

private:
    explicit YogaNodeImpl(YGConfigRef config, JSYogaConfig* jsConfig);

    YGNodeRef m_yogaNode;
    JSC::Weak<JSYogaNode> m_wrapper;
    JSYogaConfig* m_jsConfig;
};

} // namespace Bun