#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include "BunClientData.h"

namespace Bun {

// require.extensions & Module._extensions
class JSCommonJSExtensions : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    // put() and deleteProperty() below mirror every assignment into the native
    // loader table. Without ProhibitsPropertyCaching, the second assignment from
    // the same call site is served by an inline cache (a plain store into the
    // object) and never reaches put(), so the loader table keeps the old handler.
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesPut | JSC::ProhibitsPropertyCaching;

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
        return WebCore::subspaceForImpl<JSCommonJSExtensions, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSCommonJSExtensions, m_subspaceForJSCommonJSExtensions));
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

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
