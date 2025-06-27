#pragma once
#include "root.h"
#include <memory>
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/WriteBarrier.h>

// Forward declarations
typedef struct YGNode* YGNodeRef;
typedef struct YGConfig* YGConfigRef;
typedef const struct YGNode* YGNodeConstRef;

namespace Bun {

class JSYogaNode final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSYogaNode* create(JSC::VM&, JSC::Structure*, YGConfigRef config = nullptr);
    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue);
    ~JSYogaNode();

    template<typename, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM&);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    YGNodeRef internal() { return m_node; }
    void clearInternal() { m_node = nullptr; }
    void setInternal(YGNodeRef node) { m_node = node; }

    // Helper to get JS wrapper from Yoga node
    static JSYogaNode* fromYGNode(YGNodeRef);
    JSC::JSGlobalObject* globalObject() const;

    // Storage for JS callbacks
    JSC::WriteBarrier<JSC::JSObject> m_measureFunc;
    JSC::WriteBarrier<JSC::JSObject> m_dirtiedFunc;

private:
    JSYogaNode(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, YGConfigRef config);

    YGNodeRef m_node;
};

} // namespace Bun
