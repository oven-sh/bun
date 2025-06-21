#include "root.h"
#include "JSYogaConfig.h"
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {

const JSC::ClassInfo JSYogaConfig::s_info = { "Yoga.Config"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSYogaConfig) };

JSYogaConfig::JSYogaConfig(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
    , m_config(nullptr)
{
}

JSYogaConfig::~JSYogaConfig()
{
    if (m_config) {
        YGConfigFree(m_config);
    }
}

JSYogaConfig* JSYogaConfig::create(JSC::VM& vm, JSC::Structure* structure)
{
    JSYogaConfig* config = new (NotNull, JSC::allocateCell<JSYogaConfig>(vm)) JSYogaConfig(vm, structure);
    config->finishCreation(vm);
    return config;
}

void JSYogaConfig::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    m_config = YGConfigNew();
}

void JSYogaConfig::destroy(JSC::JSCell* cell)
{
    static_cast<JSYogaConfig*>(cell)->~JSYogaConfig();
}

JSC::Structure* JSYogaConfig::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

template<typename, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSYogaConfig::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSYogaConfig, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSYogaConfig.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSYogaConfig = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSYogaConfig.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSYogaConfig = std::forward<decltype(space)>(space); });
}

} // namespace Bun