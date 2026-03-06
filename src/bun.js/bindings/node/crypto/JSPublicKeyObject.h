#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <wtf/text/WTFString.h>
#include "ncrypto.h"
#include "BunClientData.h"
#include "openssl/ssl.h"
#include "JSKeyObject.h"
#include "KeyObject.h"

namespace Bun {

class JSPublicKeyObject final : public JSKeyObject {
public:
    using Base = JSKeyObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSPublicKeyObject* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject, KeyObject&& keyObject)
    {
        JSPublicKeyObject* instance = new (NotNull, JSC::allocateCell<JSPublicKeyObject>(vm)) JSPublicKeyObject(vm, structure, WTF::move(keyObject));
        instance->finishCreation(vm, globalObject);
        return instance;
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSPublicKeyObject, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSPublicKeyObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSPublicKeyObject = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSPublicKeyObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSPublicKeyObject = std::forward<decltype(space)>(space); });
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    JSC::WriteBarrier<JSC::JSObject> m_keyDetails;

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);

    JSPublicKeyObject(JSC::VM& vm, JSC::Structure* structure, KeyObject&& keyObject)
        : Base(vm, structure, WTF::move(keyObject))
    {
    }
};

void setupPublicKeyObjectClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
