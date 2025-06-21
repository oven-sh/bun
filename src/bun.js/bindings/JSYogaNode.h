#pragma once
#include "root.h"
#include "vendor/yoga/yoga/Yoga.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/Strong.h>
#include <memory>

namespace Bun {

class JSYogaNode final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSYogaNode* create(JSC::VM&, JSC::Structure*, YGConfigRef config = nullptr);
    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue);
    static JSYogaNode* fromYGNode(YGNodeRef);
    ~JSYogaNode();

    template<typename, JSC::SubspaceAccess> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM&);
    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    YGNodeRef internal() { return m_node; }

    JSC::Strong<JSC::JSObject> m_measureFunc;
    JSC::Strong<JSC::JSObject> m_dirtiedFunc;

private:
    JSYogaNode(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, YGConfigRef config);
    YGNodeRef m_node;
};

} // namespace Bun