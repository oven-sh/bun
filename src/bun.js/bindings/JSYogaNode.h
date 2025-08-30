#pragma once
#include "root.h"
#include <memory>
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <wtf/Ref.h>

// Forward declarations
typedef struct YGNode* YGNodeRef;
typedef struct YGConfig* YGConfigRef;
typedef const struct YGNode* YGNodeConstRef;

namespace Bun {

class JSYogaConfig;
class YogaNodeImpl;

class JSYogaNode final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSYogaNode* create(JSC::VM&, JSC::Structure*, YGConfigRef config = nullptr, JSYogaConfig* jsConfig = nullptr);
    static JSYogaNode* create(JSC::VM&, JSC::Structure*, Ref<YogaNodeImpl>&&);
    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue);
    ~JSYogaNode();

    template<typename, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM&);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    YogaNodeImpl& impl() { return m_impl.get(); }
    const YogaNodeImpl& impl() const { return m_impl.get(); }

    // Helper to get JS wrapper from Yoga node
    static JSYogaNode* fromYGNode(YGNodeRef);
    JSC::JSGlobalObject* globalObject() const;

    // Storage for JS callbacks
    JSC::WriteBarrier<JSC::JSObject> m_measureFunc;
    JSC::WriteBarrier<JSC::JSObject> m_dirtiedFunc;
    JSC::WriteBarrier<JSC::JSObject> m_baselineFunc;

    // Store the JSYogaConfig that was used to create this node
    JSC::WriteBarrier<JSC::JSObject> m_config;

private:
    JSYogaNode(JSC::VM&, JSC::Structure*);
    JSYogaNode(JSC::VM&, JSC::Structure*, Ref<YogaNodeImpl>&&);
    void finishCreation(JSC::VM&, YGConfigRef config, JSYogaConfig* jsConfig);
    void finishCreation(JSC::VM&);

    Ref<YogaNodeImpl> m_impl;
};

} // namespace Bun
