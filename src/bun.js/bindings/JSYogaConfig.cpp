#include "root.h"
#include "JSYogaConfig.h"
#include "YogaConfigImpl.h"
#include "webcore/DOMIsoSubspaces.h"
#include "webcore/DOMClientIsoSubspaces.h"
#include "webcore/WebCoreJSClientData.h"
#include <yoga/Yoga.h>

namespace Bun {

using namespace JSC;

const JSC::ClassInfo JSYogaConfig::s_info = { "Config"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaConfig) };

JSYogaConfig::JSYogaConfig(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
    , m_impl(YogaConfigImpl::create())
{
}

JSYogaConfig::JSYogaConfig(JSC::VM& vm, JSC::Structure* structure, Ref<YogaConfigImpl>&& impl)
    : Base(vm, structure)
    , m_impl(WTFMove(impl))
{
}

JSYogaConfig::~JSYogaConfig()
{
    // The WeakHandleOwner::finalize should handle cleanup
    // Don't interfere with that mechanism
}

JSYogaConfig* JSYogaConfig::create(JSC::VM& vm, JSC::Structure* structure)
{
    JSYogaConfig* config = new (NotNull, JSC::allocateCell<JSYogaConfig>(vm)) JSYogaConfig(vm, structure);
    config->finishCreation(vm);
    return config;
}

JSYogaConfig* JSYogaConfig::create(JSC::VM& vm, JSC::Structure* structure, Ref<YogaConfigImpl>&& impl)
{
    JSYogaConfig* config = new (NotNull, JSC::allocateCell<JSYogaConfig>(vm)) JSYogaConfig(vm, structure, WTFMove(impl));
    config->finishCreation(vm);
    return config;
}

void JSYogaConfig::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);

    // Set this JS wrapper in the C++ impl
    m_impl->setJSWrapper(this);
}

JSC::Structure* JSYogaConfig::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

void JSYogaConfig::destroy(JSC::JSCell* cell)
{
    static_cast<JSYogaConfig*>(cell)->~JSYogaConfig();
}

template<typename MyClassT, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSYogaConfig::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<MyClassT, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSYogaConfig.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSYogaConfig = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSYogaConfig.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSYogaConfig = std::forward<decltype(space)>(space); });
}

template<typename Visitor>
void JSYogaConfig::visitAdditionalChildren(Visitor& visitor)
{
    visitor.append(m_context);
    visitor.append(m_loggerFunc);
    visitor.append(m_cloneNodeFunc);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN(JSYogaConfig);

template<typename Visitor>
void JSYogaConfig::visitOutputConstraints(JSC::JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<JSYogaConfig*>(cell);
    
    // Lock for concurrent GC thread safety
    WTF::Locker locker { thisObject->cellLock() };
    
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitOutputConstraints(thisObject, visitor);
    thisObject->visitAdditionalChildren(visitor);
}

template void JSYogaConfig::visitOutputConstraints(JSC::JSCell*, JSC::AbstractSlotVisitor&);
template void JSYogaConfig::visitOutputConstraints(JSC::JSCell*, JSC::SlotVisitor&);

} // namespace Bun
