#pragma once

#include "BunClientData.h"
#include "root.h"

namespace Bun {

// The argument cell of a native microtask (JSC__JSGlobalObject__queueMicrotaskCallback).
// It owns the native context until the trampoline runs it; if the microtask is
// discarded instead (queue cleared at teardown, then the cell collected or the
// VM destroyed), the destructor hands the context to its drop function.
class NativeMicrotaskContext final : public JSC::JSCell {
public:
    using Base = JSC::JSCell;
    using Callback = void (*)(void*);

    static NativeMicrotaskContext* create(JSC::VM& vm, JSC::Structure* structure, void* ctx, Callback run, Callback drop);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return JSC::Structure::create(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::CellType, StructureFlags), info(), 0, 0);
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NativeMicrotaskContext, WebCore::UseCustomHeapCellType::Yes>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForNativeMicrotaskContext, m_subspaceForNativeMicrotaskContext),
            [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForNativeMicrotaskContext; });
    }

    DECLARE_INFO;

    static constexpr JSC::DestructionMode needsDestruction = JSC::DestructionMode::NeedsDestruction;
    static void destroy(JSC::JSCell* cell);

    // Consume the context: the destructor is a no-op afterwards.
    void run();

private:
    NativeMicrotaskContext(JSC::VM& vm, JSC::Structure* structure, void* ctx, Callback run, Callback drop)
        : Base(vm, structure)
        , m_ctx(ctx)
        , m_run(run)
        , m_drop(drop)
    {
    }

    ~NativeMicrotaskContext();

    void* m_ctx;
    Callback m_run;
    Callback m_drop;
};

} // namespace Bun
