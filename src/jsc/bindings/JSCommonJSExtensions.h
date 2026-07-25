#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include "BunClientData.h"

namespace Bun {

// require.extensions & Module._extensions
class JSCommonJSExtensions : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesPut;
    ~JSCommonJSExtensions();

    WTF::Vector<JSC::WriteBarrier<JSC::Unknown>> m_registeredFunctions;

    static JSCommonJSExtensions* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSCommonJSExtensions* ptr = new (NotNull, JSC::allocateCell<JSCommonJSExtensions>(vm)) JSCommonJSExtensions(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSCommonJSExtensions, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSCommonJSExtensions.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSCommonJSExtensions = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSCommonJSExtensions.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSCommonJSExtensions = std::forward<decltype(space)>(space); });
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    DECLARE_VISIT_CHILDREN;

protected:
    static bool defineOwnProperty(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, const JSC::PropertyDescriptor&, bool shouldThrow);
    static bool put(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&);
    static bool deleteProperty(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::DeletePropertySlot&);

private:
    JSCommonJSExtensions(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};

} // namespace Bun
