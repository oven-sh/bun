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

JSYogaNode::JSYogaNode(JSC::VM& vm, JSC::Structure* structure, YGConfigRef config)
    : Base(vm, structure)
    , m_impl(YogaNodeImpl::create(config))
{
}

JSYogaNode::JSYogaNode(JSC::VM& vm, JSC::Structure* structure, Ref<YogaNodeImpl>&& impl)
    : Base(vm, structure)
    , m_impl(std::move(impl))
{
}

JSYogaNode::~JSYogaNode()
{
    // The WeakHandleOwner::finalize should handle cleanup
    // Don't interfere with that mechanism
}

JSYogaNode* JSYogaNode::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, YGConfigRef config, JSYogaConfig* jsConfig)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSYogaNode* node = new (NotNull, JSC::allocateCell<JSYogaNode>(vm)) JSYogaNode(vm, structure, config);
    node->finishCreation(vm, jsConfig);

    // Initialize children array - this can throw so it must be done here
    // where exceptions can be properly propagated to callers
    JSC::JSArray* children = JSC::constructEmptyArray(globalObject, nullptr, 0);
    RETURN_IF_EXCEPTION(scope, nullptr);
    node->m_children.set(vm, node, children);

    return node;
}

JSYogaNode* JSYogaNode::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, Ref<YogaNodeImpl>&& impl)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSYogaNode* node = new (NotNull, JSC::allocateCell<JSYogaNode>(vm)) JSYogaNode(vm, structure, std::move(impl));
    node->finishCreation(vm);

    // Initialize children array - this can throw so it must be done here
    // where exceptions can be properly propagated to callers
    JSC::JSArray* children = JSC::constructEmptyArray(globalObject, nullptr, 0);
    RETURN_IF_EXCEPTION(scope, nullptr);
    node->m_children.set(vm, node, children);

    return node;
}

void JSYogaNode::finishCreation(JSC::VM& vm, JSYogaConfig* jsConfig)
{
    Base::finishCreation(vm);

    // Set this JS wrapper in the C++ impl
    m_impl->setJSWrapper(this);

    // Store the JSYogaConfig if provided
    if (jsConfig) {
        m_config.set(vm, this, jsConfig);
    }

    // Note: m_children is initialized by create() after finishCreation returns,
    // with proper exception scope handling. Do not initialize it here.
}

void JSYogaNode::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);

    // Set this JS wrapper in the C++ impl
    m_impl->setJSWrapper(this);

    // No JSYogaConfig in this path - it's only set when explicitly provided

    // Note: m_children is initialized by create() after finishCreation returns,
    // with proper exception scope handling. Do not initialize it here.
}

JSC::Structure* JSYogaNode::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

void JSYogaNode::destroy(JSC::JSCell* cell)
{
    auto* thisObject = static_cast<JSYogaNode*>(cell);

    // Explicitly free the YGNode here because the ref-counting chain
    // (destroy() deref + finalize() deref -> ~YogaNodeImpl -> YGNodeFinalize)
    // may not complete during VM shutdown if WeakHandleOwner::finalize()
    // doesn't fire for all handles. This ensures the native Yoga memory
    // is always freed when the JSYogaNode cell is swept.
    auto& impl = thisObject->m_impl.get();
    YGNodeRef node = impl.yogaNode();
    if (node && impl.ownsNode()) {
        // Use YGNodeFinalize (raw delete) instead of YGNodeFree (tree-traversing)
        // because GC can sweep parent/child nodes in arbitrary order.
        YGNodeFinalize(node);
        impl.replaceYogaNode(nullptr); // Prevent double-free in ~YogaNodeImpl
    }

    thisObject->~JSYogaNode();
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

template<typename Visitor>
void JSYogaNode::visitAdditionalChildren(Visitor& visitor)
{
    visitor.append(m_measureFunc);
    visitor.append(m_dirtiedFunc);
    visitor.append(m_baselineFunc);
    visitor.append(m_config);
    visitor.append(m_children);

    // Use the YogaNodeImpl pointer as opaque root instead of YGNodeRef
    // This avoids use-after-free when YGNode memory is freed but YogaNodeImpl still exists
    visitor.addOpaqueRoot(&m_impl.get());
}

DEFINE_VISIT_ADDITIONAL_CHILDREN(JSYogaNode);

template<typename Visitor>
void JSYogaNode::visitOutputConstraints(JSC::JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<JSYogaNode*>(cell);

    // Lock for concurrent GC thread safety - the mutator thread may be modifying
    // WriteBarriers (m_children, m_measureFunc, etc.) concurrently via insertChild,
    // removeChild, setMeasureFunc, free(), etc. Without this lock, the GC thread
    // can read a torn/partially-written pointer from a WriteBarrier, leading to
    // a segfault in validateCell when it tries to decode a corrupted StructureID.
    WTF::Locker locker { thisObject->cellLock() };

    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitOutputConstraints(thisObject, visitor);

    // Re-visit after mutator execution in case callbacks changed references
    // This is critical for objects whose reachability can change during runtime
    thisObject->visitAdditionalChildren(visitor);
}

template void JSYogaNode::visitOutputConstraints(JSC::JSCell*, JSC::AbstractSlotVisitor&);
template void JSYogaNode::visitOutputConstraints(JSC::JSCell*, JSC::SlotVisitor&);

} // namespace Bun
