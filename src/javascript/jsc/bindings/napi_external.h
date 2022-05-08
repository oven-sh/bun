

#pragma once

#include "root.h"

#include "BunBuiltinNames.h"
#include "BunClientData.h"

namespace Zig {

using namespace JSC;

class NapiExternal : public JSC::JSNonFinalObject {
    using Base = JSC::JSNonFinalObject;

public:
    NapiExternal(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    DECLARE_INFO;

    ~NapiExternal()
    {
        if (m_value) {
            delete m_value;
        }

        static constexpr unsigned StructureFlags = Base::StructureFlags;

        template<typename, SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM & vm)
        {
            if constexpr (mode == JSC::SubspaceAccess::Concurrently)
                return nullptr;
            return WebCore::subspaceForImpl<JSNapiExternal, WebCore::UseCustomHeapCellType::No>(
                vm,
                [](auto& spaces) { return spaces.m_clientSubspaceForNapiExternal.get(); },
                [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNapiExternal = WTFMove(space); },
                [](auto& spaces) { return spaces.m_subspaceForNapiExternal.get(); },
                [](auto& spaces, auto&& space) { spaces.m_subspaceForNapiExternal = WTFMove(space); });
        }

        static JSC::Structure* createStructure(JSC::VM & vm, JSC::JSGlobalObject * globalObject,
            JSC::JSValue prototype)
        {
            return JSC::Structure::create(vm, globalObject, prototype,
                JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        }

        static NapiExternal* create(JSC::VM & vm, JSC::Structure * structure)
        {
            NapiExternal* accessor = new (NotNull, JSC::allocateCell<NapiExternal>(vm)) NapiExternal(vm, structure);
            accessor->finishCreation(vm);
            return accessor;
        }

        void finishCreation(JSC::VM & vm);
        void* m_value;
        void* finalizer_context;
    };

} // namespace Zig