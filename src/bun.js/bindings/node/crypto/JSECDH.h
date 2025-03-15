#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <wtf/text/WTFString.h>
#include "ncrypto.h"
#include "BunClientData.h"

namespace Bun {

class JSECDH final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSECDH* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject, ncrypto::ECKeyPointer&& key)
    {
        JSECDH* instance = new (NotNull, JSC::allocateCell<JSECDH>(vm)) JSECDH(vm, structure, WTFMove(key));
        instance->finishCreation(vm, globalObject);
        return instance;
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSECDH, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSECDH.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSECDH = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSECDH.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSECDH = std::forward<decltype(space)>(space); });
    }

    const ncrypto::ECKeyPointer& key() const { return m_key; }
    void setKey(ncrypto::ECKeyPointer&& key) { m_key = WTFMove(key); }

private:
    JSECDH(JSC::VM& vm, JSC::Structure* structure, ncrypto::ECKeyPointer&& key)
        : Base(vm, structure)
        , m_key(WTFMove(key))
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
    static void destroy(JSC::JSCell* cell) { static_cast<JSECDH*>(cell)->~JSECDH(); }

    ncrypto::ECKeyPointer m_key;
};

void setupECDHClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
