#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <wtf/text/WTFString.h>
#include "ncrypto.h"
#include "BunClientData.h"
namespace Bun {

class JSDiffieHellman final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSDiffieHellman* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject, ncrypto::DHPointer&& dh)
    {
        JSDiffieHellman* instance = new (NotNull, JSC::allocateCell<JSDiffieHellman>(vm)) JSDiffieHellman(vm, structure, WTF::move(dh));
        instance->finishCreation(vm, globalObject);
        return instance;
    }

    ncrypto::DHPointer& getImpl() { return m_dh; }
    const ncrypto::DHPointer& getImpl() const { return m_dh; }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSDiffieHellman, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSDiffieHellman.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSDiffieHellman = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSDiffieHellman.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSDiffieHellman = std::forward<decltype(space)>(space); });
    }

private:
    JSDiffieHellman(JSC::VM& vm, JSC::Structure* structure, ncrypto::DHPointer&& dh)
        : Base(vm, structure)
        , m_dh(WTF::move(dh))
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
    static void destroy(JSC::JSCell* cell) { static_cast<JSDiffieHellman*>(cell)->~JSDiffieHellman(); }

    ncrypto::DHPointer m_dh;
    unsigned m_sizeForGC = 0;
};

void setupDiffieHellmanClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
