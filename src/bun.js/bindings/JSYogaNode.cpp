#include "root.h"
#include "JSYogaNode.h"
#include "YogaNodeImpl.h"
#include "JSYogaConfig.h"
#include "JSYogaNodeOwner.h"
#include "webcore/DOMIsoSubspaces.h"
#include "webcore/DOMClientIsoSubspaces.h"
#include "webcore/WebCoreJSClientData.h"
#include <yoga/Yoga.h>

namespace Bun {

using namespace JSC;

const JSC::ClassInfo JSYogaNode::s_info = { "Node"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaNode) };

JSYogaNode::JSYogaNode(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
    , m_impl(YogaNodeImpl::create())
{
}

JSYogaNode::JSYogaNode(JSC::VM& vm, JSC::Structure* structure, Ref<YogaNodeImpl>&& impl)
    : Base(vm, structure)
    , m_impl(WTFMove(impl))
{
}

JSYogaNode::~JSYogaNode()
{
    // Clear the JS wrapper reference from the C++ impl
    m_impl->clearJSWrapper();
}

JSYogaNode* JSYogaNode::create(JSC::VM& vm, JSC::Structure* structure, YGConfigRef config, JSYogaConfig* jsConfig)
{
    JSYogaNode* node = new (NotNull, JSC::allocateCell<JSYogaNode>(vm)) JSYogaNode(vm, structure);
    node->finishCreation(vm, config, jsConfig);
    return node;
}

JSYogaNode* JSYogaNode::create(JSC::VM& vm, JSC::Structure* structure, Ref<YogaNodeImpl>&& impl)
{
    JSYogaNode* node = new (NotNull, JSC::allocateCell<JSYogaNode>(vm)) JSYogaNode(vm, structure, WTFMove(impl));
    node->finishCreation(vm);
    return node;
}

void JSYogaNode::finishCreation(JSC::VM& vm, YGConfigRef config, JSYogaConfig* jsConfig)
{
    Base::finishCreation(vm);

    // If we need to recreate with specific config, do so
    if (config || jsConfig) {
        m_impl = YogaNodeImpl::create(config, jsConfig);
    }

    // Set this JS wrapper in the C++ impl
    m_impl->setJSWrapper(this);

    // Store the JSYogaConfig if provided
    if (jsConfig) {
        m_config.set(vm, this, jsConfig);
    }
}

void JSYogaNode::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);

    // Set this JS wrapper in the C++ impl
    m_impl->setJSWrapper(this);

    // Store the JSYogaConfig if provided
    if (auto* jsConfig = m_impl->jsConfig()) {
        m_config.set(vm, this, jsConfig);
    }
}

JSC::Structure* JSYogaNode::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

void JSYogaNode::destroy(JSC::JSCell* cell)
{
    static_cast<JSYogaNode*>(cell)->~JSYogaNode();
}

JSYogaNode* JSYogaNode::fromYGNode(YGNodeRef nodeRef)
{
    if (!nodeRef) return nullptr;
    if (auto* impl = YogaNodeImpl::fromYGNode(nodeRef)) {
        return impl->jsWrapper();
    }
    return nullptr;
}

JSC::JSGlobalObject* JSYogaNode::globalObject() const
{
    return this->structure()->globalObject();
}

template<typename MyClassT, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSYogaNode::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<MyClassT, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSYogaNode.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSYogaNode = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSYogaNode.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSYogaNode = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSYogaNode);

template<typename Visitor>
void JSYogaNode::visitChildrenImpl(JSC::JSCell* cell, Visitor& visitor)
{
    JSYogaNode* thisObject = jsCast<JSYogaNode*>(cell);
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_measureFunc);
    visitor.append(thisObject->m_dirtiedFunc);
    visitor.append(thisObject->m_baselineFunc);
    visitor.append(thisObject->m_config);

    // Add the root YogaNode as an opaque root
    if (void* yogaRoot = root(&thisObject->m_impl.get())) {
        visitor.addOpaqueRoot(yogaRoot);
    }
}

} // namespace Bun
