#pragma once

#include "BunBuiltinNames.h"
#include "root.h"
#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/IsoSubspacePerVM.h>
#include <JavaScriptCore/JSDestructibleObjectHeapCellType.h>
#include <wtf/HashSet.h>
#include <wtf/RefPtr.h>

namespace Bun {
using namespace JSC;

enum class UseCustomHeapCellType { Yes,
    No };

class JSHeapData {
    WTF_MAKE_NONCOPYABLE(JSHeapData);
    WTF_MAKE_FAST_ALLOCATED;
    friend class JSVMClientData;

public:
    JSHeapData(JSC::Heap&);

    static JSHeapData* ensureHeapData(JSC::Heap&);

    Lock& lock() { return m_lock; }
    // ExtendedDOMIsoSubspaces& subspaces() { return *m_subspaces.get(); }

    Vector<JSC::IsoSubspace*>& outputConstraintSpaces() { return m_outputConstraintSpaces; }

    template<typename Func>
    void forEachOutputConstraintSpace(const Func& func)
    {
        for (auto* space : m_outputConstraintSpaces)
            func(*space);
    }

    JSC::IsoSubspace m_domNamespaceObjectSpace;

private:
    Lock m_lock;

private:
    // std::unique_ptr<ExtendedDOMIsoSubspaces> m_subspaces;
    Vector<JSC::IsoSubspace*> m_outputConstraintSpaces;
};

class JSVMClientData : public JSC::VM::ClientData {
    WTF_MAKE_NONCOPYABLE(JSVMClientData);
    WTF_MAKE_FAST_ALLOCATED;

public:
    explicit JSVMClientData(JSC::VM&);

    virtual ~JSVMClientData();

    static void create(JSC::VM*);

    JSHeapData& heapData() { return *m_heapData; }
    BunBuiltinNames& builtinNames() { return m_builtinNames; }
    // ExtendedDOMClientIsoSubspaces& clientSubspaces() { return *m_clientSubspaces.get(); }

    // Vector<JSC::IsoSubspace *> &outputConstraintSpaces() { return m_outputConstraintSpaces; }

    // template<typename Func> void forEachOutputConstraintSpace(const Func& func)
    // {
    //     for (auto* space : m_outputConstraintSpaces)
    //         func(*space);
    // }

private:
    BunBuiltinNames m_builtinNames;

    JSHeapData* m_heapData;

    // Vector<JSC::IsoSubspace *> m_outputConstraintSpaces;
};

template<typename T, UseCustomHeapCellType useCustomHeapCellType, typename GetClient, typename SetClient, typename GetServer, typename SetServer>
ALWAYS_INLINE JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm, GetClient getClient, SetClient setClient, GetServer getServer, SetServer setServer, JSC::HeapCellType& (*getCustomHeapCellType)(JSHeapData&) = nullptr)
{
    static NeverDestroyed<JSC::IsoSubspacePerVM> perVM([](JSC::Heap& heap) {
        return ISO_SUBSPACE_PARAMETERS(heap.destructibleObjectHeapCellType, T);
    });
    return &perVM.get().clientIsoSubspaceforVM(vm);
}

static JSVMClientData* clientData(JSC::VM& vm)
{
    return static_cast<Bun::JSVMClientData*>(vm.clientData);
}

} // namespace Bun
