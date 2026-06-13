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

class JSPrivateKeyObject final : public JSKeyObject {
public:
    using Base = JSKeyObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSPrivateKeyObject* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject, KeyObject&& keyObject)
    {
        JSPrivateKeyObject* instance = new (NotNull, JSC::allocateCell<JSPrivateKeyObject>(vm)) JSPrivateKeyObject(vm, structure, WTF::move(keyObject));
        instance->finishCreation(vm, globalObject);
        return instance;
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSPrivateKeyObject, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) -> auto& { return spaces.m_clientSubspaceForJSPrivateKeyObject; },
            [](auto& spaces) -> auto& { return spaces.m_subspaceForJSPrivateKeyObject; });
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    JSC::WriteBarrier<JSC::JSObject> m_keyDetails;

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);

    JSPrivateKeyObject(JSC::VM& vm, JSC::Structure* structure, KeyObject&& keyObject)
        : Base(vm, structure, WTF::move(keyObject))
    {
    }
};

void setupPrivateKeyObjectClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
