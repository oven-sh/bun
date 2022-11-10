

#pragma once

#include "root.h"

#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "node_api.h"

namespace Bun {

using namespace JSC;
using namespace WebCore;

class NapiExternal : public JSC::JSDestructibleObject {
    using Base = JSC::JSDestructibleObject;

public:
    NapiExternal(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    DECLARE_EXPORT_INFO;

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;

        return WebCore::subspaceForImpl<NapiExternal, UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForNapiExternal.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNapiExternal = WTFMove(space); },
            [](auto& spaces) { return spaces.m_subspaceForNapiExternal.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForNapiExternal = WTFMove(space); });
    }

    ~NapiExternal();

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject,
        JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype,
            JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static NapiExternal* create(JSC::VM& vm, JSC::Structure* structure, void* value, void* finalizer_hint, napi_finalize finalizer)
    {
        NapiExternal* accessor = new (NotNull, JSC::allocateCell<NapiExternal>(vm)) NapiExternal(vm, structure);
        accessor->finishCreation(vm, value, finalizer_hint, finalizer);
        return accessor;
    }

    void finishCreation(JSC::VM& vm, void* value, void* finalizer_hint, napi_finalize finalizer)
    {
        Base::finishCreation(vm);
        m_value = value;
        m_finalizerHint = finalizer_hint;
        this->finalizer = finalizer;
    }

    static void destroy(JSC::JSCell* cell);

    void* value() const { return m_value; }

    void* m_value;
    void* m_finalizerHint;
    napi_finalize finalizer;
};

} // namespace Zig