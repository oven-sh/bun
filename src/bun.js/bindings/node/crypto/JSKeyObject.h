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

class JSKeyObject : public JSC::JSDestructibleObject {
    WTF_MAKE_TZONE_ALLOCATED(JSKeyObject);

public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSKeyObject* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject, KeyObject&& keyObject)
    {
        JSKeyObject* instance = new (NotNull, JSC::allocateCell<JSKeyObject>(vm)) JSKeyObject(vm, structure, WTF::move(keyObject));
        instance->finishCreation(vm, globalObject);
        return instance;
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSKeyObject, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSKeyObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSKeyObject = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSKeyObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSKeyObject = std::forward<decltype(space)>(space); });
    }

    JSKeyObject(JSC::VM& vm, JSC::Structure* structure, KeyObject&& keyObject)
        : Base(vm, structure)
        , m_handle(WTF::move(keyObject))
    {
    }

    KeyObject& handle() { return m_handle; }
    const KeyObject& handle() const { return m_handle; }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
    static void destroy(JSC::JSCell* cell) { static_cast<JSKeyObject*>(cell)->~JSKeyObject(); }

    KeyObject m_handle;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;
};

void setupKeyObjectClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
