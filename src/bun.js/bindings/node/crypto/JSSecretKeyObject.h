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

namespace Bun {

class JSSecretKeyObject final : public JSKeyObject {
public:
    using Base = JSKeyObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSSecretKeyObject* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject, KeyObject&& keyObject)
    {
        JSSecretKeyObject* instance = new (NotNull, JSC::allocateCell<JSSecretKeyObject>(vm)) JSSecretKeyObject(vm, structure, WTFMove(keyObject));
        instance->finishCreation(vm, globalObject);
        return instance;
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSSecretKeyObject, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSSecretKeyObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSSecretKeyObject = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSSecretKeyObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSSecretKeyObject = std::forward<decltype(space)>(space); });
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);

    JSSecretKeyObject(JSC::VM& vm, JSC::Structure* structure, KeyObject&& keyObject)
        : Base(vm, structure, WTFMove(keyObject))
    {
    }
};

void setupSecretKeyObjectClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
