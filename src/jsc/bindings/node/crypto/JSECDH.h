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

    static JSECDH* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject, ncrypto::ECKeyPointer&& key, const EC_GROUP* group)
    {
        JSECDH* instance = new (NotNull, JSC::allocateCell<JSECDH>(vm)) JSECDH(vm, structure, WTF::move(key), group);
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

    ncrypto::ECKeyPointer m_key;
    const EC_GROUP* m_group;

    JSC::EncodedJSValue getPublicKey(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue encodingValue, JSC::JSValue formatValue);

    static point_conversion_form_t getFormat(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue formatValue);

private:
    JSECDH(JSC::VM& vm, JSC::Structure* structure, ncrypto::ECKeyPointer&& key, const EC_GROUP* group)
        : Base(vm, structure)
        , m_key(WTF::move(key))
        , m_group(group)
    {
        ASSERT(m_group);
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
    static void destroy(JSC::JSCell* cell) { static_cast<JSECDH*>(cell)->~JSECDH(); }
};

void setupECDHClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
