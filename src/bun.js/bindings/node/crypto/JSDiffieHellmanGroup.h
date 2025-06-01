#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <wtf/text/WTFString.h>
#include "ncrypto.h"
#include "BunClientData.h"
namespace Bun {

class JSDiffieHellmanGroup final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSDiffieHellmanGroup* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject, ncrypto::DHPointer&& dh)
    {
        JSDiffieHellmanGroup* instance = new (NotNull, JSC::allocateCell<JSDiffieHellmanGroup>(vm)) JSDiffieHellmanGroup(vm, structure, WTFMove(dh));
        instance->finishCreation(vm, globalObject);
        return instance;
    }

    ncrypto::DHPointer& getImpl() { return m_dh; }
    const ncrypto::DHPointer& getImpl() const { return m_dh; }

    static void destroy(JSC::JSCell* cell) { static_cast<JSDiffieHellmanGroup*>(cell)->~JSDiffieHellmanGroup(); }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSDiffieHellmanGroup, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSDiffieHellmanGroup.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSDiffieHellmanGroup = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSDiffieHellmanGroup.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSDiffieHellmanGroup = std::forward<decltype(space)>(space); });
    }

private:
    JSDiffieHellmanGroup(JSC::VM& vm, JSC::Structure* structure, ncrypto::DHPointer&& dh)
        : Base(vm, structure)
        , m_dh(WTFMove(dh))
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);

    ncrypto::DHPointer m_dh;
    unsigned m_sizeForGC = 0;
};

void setupDiffieHellmanGroupClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
