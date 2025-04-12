#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <wtf/text/WTFString.h>
#include "ncrypto.h"
#include "BunClientData.h"
#include "openssl/ssl.h"
#include "KeyObject.h"

namespace Bun {

class JSKeyObjectHandle final : public JSC::JSDestructibleObject {
    WTF_MAKE_TZONE_ALLOCATED(JSKeyObjectHandle);

public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSKeyObjectHandle* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject, KeyObject&& keyObj)
    {
        JSKeyObjectHandle* instance = new (NotNull, JSC::allocateCell<JSKeyObjectHandle>(vm)) JSKeyObjectHandle(vm, structure, WTFMove(keyObj));
        instance->finishCreation(vm, globalObject);
        return instance;
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSKeyObjectHandle, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSKeyObjectHandle.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSKeyObjectHandle = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSKeyObjectHandle.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSKeyObjectHandle = std::forward<decltype(space)>(space); });
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);

    KeyObject m_data;

    JSKeyObjectHandle(JSC::VM& vm, JSC::Structure* structure, KeyObject&& keyObj)
        : Base(vm, structure)
        , m_data(WTFMove(keyObj))
    {
    }
};

void setupKeyObjectHandleClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
