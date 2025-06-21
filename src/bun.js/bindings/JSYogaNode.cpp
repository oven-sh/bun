#include "root.h"
#include "JSYogaNode.h"
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {

const JSC::ClassInfo JSYogaNode::s_info = { "Yoga.Node"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaNode) };

JSYogaNode::JSYogaNode(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
    , m_node(nullptr)
{
}

JSYogaNode::~JSYogaNode()
{
    if (m_node) {
        YGNodeFreeRecursive(m_node);
    }
}

JSYogaNode* JSYogaNode::create(JSC::VM& vm, JSC::Structure* structure, YGConfigRef config)
{
    JSYogaNode* node = new (NotNull, JSC::allocateCell<JSYogaNode>(vm)) JSYogaNode(vm, structure);
    node->finishCreation(vm, config);
    return node;
}

void JSYogaNode::finishCreation(JSC::VM& vm, YGConfigRef config)
{
    Base::finishCreation(vm);
    if (config) {
        m_node = YGNodeNewWithConfig(config);
    } else {
        m_node = YGNodeNew();
    }
    // This is the essential link that enables callbacks and hierarchy traversal
    YGNodeSetContext(m_node, this);
}

void JSYogaNode::destroy(JSC::JSCell* cell)
{
    static_cast<JSYogaNode*>(cell)->~JSYogaNode();
}

JSC::Structure* JSYogaNode::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

JSYogaNode* JSYogaNode::fromYGNode(YGNodeRef nodeRef)
{
    if (!nodeRef) return nullptr;
    return static_cast<JSYogaNode*>(YGNodeGetContext(nodeRef));
}

DEFINE_VISIT_CHILDREN(JSYogaNode);
void JSYogaNode::visitChildrenImpl(JSC::JSCell* cell, JSC::Visitor& visitor)
{
    JSYogaNode* thisObject = jsCast<JSYogaNode*>(cell);
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_measureFunc);
    visitor.append(thisObject->m_dirtiedFunc);
}

template<typename, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSYogaNode::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSYogaNode, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSYogaNode.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSYogaNode = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSYogaNode.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSYogaNode = std::forward<decltype(space)>(space); });
}

} // namespace Bun