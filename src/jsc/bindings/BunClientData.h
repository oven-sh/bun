#pragma once

namespace WebCore {

class ExtendedDOMClientIsoSubspaces;
class ExtendedDOMIsoSubspaces;
class JSBuiltinFunctions;

class DOMWrapperWorld;
}

#include "root.h"

#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "BunBuiltinNames.h"
// #include "WebCoreJSBuiltins.h"
// #include "WorkerThreadType.h"
#include <wtf/Function.h>
#include <wtf/HashSet.h>
#include <wtf/WeakHashSet.h>
#include <wtf/RefPtr.h>
#include "JSVMClientDataClient.h"
#include <JavaScriptCore/WeakInlines.h>
#include <wtf/StdLibExtras.h>
#include "JSCTaskScheduler.h"
#include "HTTPHeaderIdentifiers.h"
namespace Zig {
class GlobalObject;
}

namespace WebCore {
using namespace JSC;
using namespace Zig;

enum class UseCustomHeapCellType { Yes,
    No };

class JSHeapData {
    WTF_MAKE_NONCOPYABLE(JSHeapData);
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(JSHeapData);
    friend class JSVMClientData;

public:
    JSHeapData(JSC::Heap&);
    ~JSHeapData();

    static JSHeapData* ensureHeapData(JSC::Heap&);

    Lock& lock() { return m_lock; }
    ExtendedDOMIsoSubspaces& subspaces() { return *m_subspaces.get(); }

    Vector<JSC::IsoSubspace*>& outputConstraintSpaces() { return m_outputConstraintSpaces; }

    template<typename Func>
    void forEachOutputConstraintSpace(const Func& func)
    {
        for (auto* space : m_outputConstraintSpaces)
            func(*space);
    }

    JSC::IsoHeapCellType m_heapCellTypeForJSWorkerGlobalScope;
    JSC::IsoHeapCellType m_heapCellTypeForNodeVMGlobalObject;
    JSC::IsoHeapCellType m_heapCellTypeForNapiHandleScopeImpl;
    JSC::IsoHeapCellType m_heapCellTypeForBakeGlobalObject;
    JSC::IsoHeapCellType m_heapCellTypeForNativePromiseContext;
    // JSC::IsoHeapCellType m_heapCellTypeForGeneratedClass;

private:
    Lock m_lock;

private:
    std::unique_ptr<ExtendedDOMIsoSubspaces> m_subspaces;
    JSC::IsoSubspace m_domConstructorSpace;
    JSC::IsoSubspace m_domBuiltinConstructorSpace;
    JSC::IsoSubspace m_domNamespaceObjectSpace;

    Vector<JSC::IsoSubspace*> m_outputConstraintSpaces;
};

DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(JSVMClientData);

class JSVMClientData : public JSC::VM::ClientData {
    WTF_MAKE_NONCOPYABLE(JSVMClientData);
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(JSVMClientData, JSVMClientData);

public:
    explicit JSVMClientData(JSC::VM&, RefPtr<JSC::SourceProvider>);

    virtual ~JSVMClientData();

    static void create(JSC::VM*, void*);

    JSHeapData& heapData() { return *m_heapData; }
    BunBuiltinNames& builtinNames() { return m_builtinNames; }
    JSBuiltinFunctions& builtinFunctions() { return *m_builtinFunctions; }

    String overrideSourceURL(const StackFrame&, const String& originalSourceURL) const
    {
        return originalSourceURL;
    }

    WebCore::DOMWrapperWorld& normalWorld() { return *m_normalWorld; }

    JSC::GCClient::IsoSubspace& domConstructorSpace() { return m_domConstructorSpace; }

    ExtendedDOMClientIsoSubspaces& clientSubspaces() { return *m_clientSubspaces.get(); }

    Vector<JSC::IsoSubspace*>& outputConstraintSpaces() { return m_outputConstraintSpaces; }

    JSC::GCClient::IsoSubspace& domBuiltinConstructorSpace() { return m_domBuiltinConstructorSpace; }

    // Constructed eagerly so the concurrent GC marker
    // (Zig::GlobalObject::visitChildrenImpl) never races the mutator on a
    // lazy std::optional::emplace(). The ctor only calls
    // LazyProperty::initLater ~90 times (stores a tagged function pointer),
    // so there is no startup cost worth deferring.
    WebCore::HTTPHeaderIdentifiers& httpHeaderIdentifiers() { return m_httpHeaderIdentifiers; }

    template<typename Func> void forEachOutputConstraintSpace(const Func& func)
    {
        for (auto* space : m_outputConstraintSpaces)
            func(*space);
    }

    void* bunVM;
    Bun::JSCTaskScheduler deferredWorkTimer;

    // Backing storage for Bun::IsolatedModuleCache (see IsolatedModuleCache.h).
    // All access should go through that class. Stored as the JSC base type to
    // avoid pulling ZigSourceProvider.h into this header; the cache class
    // downcasts on lookup. Values hold strong refs by design: this map is the
    // only owner once the previous global is GC'd, so a weak map would empty
    // after every swap.
    WTF::UncheckedKeyHashMap<WTF::String, RefPtr<JSC::SourceProvider>> isolationSourceProviderCache;

    void addClient(JSVMClientDataClient& client) { m_clients.add(client); }

private:
    bool isWebCoreJSClientData() const final { return true; }

    // Frees a per-VM `JSHeapData` but leaves the process-wide `useGlobalGC`
    // singleton alone (it is shared by every VM). On the default `!useGlobalGC`
    // path `ensureHeapData` allocates a fresh `JSHeapData` per VM, so without
    // freeing it every terminated worker leaks its `JSHeapData` plus the
    // FastMalloc-backed `IsoSubspace`s it embeds.
    struct JSHeapDataDeleter {
        void operator()(JSHeapData*) const;
    };

    BunBuiltinNames m_builtinNames;
    std::unique_ptr<JSBuiltinFunctions> m_builtinFunctions;

    // Owns the per-VM `JSHeapData`. Declared *before* the client `IsoSubspace`
    // members below so it is destroyed *after* them (members destruct in
    // reverse declaration order): each client `GCClient::IsoSubspace` holds a
    // `LocalAllocator` whose `~LocalAllocator` unlinks itself from a
    // `BlockDirectory` that lives inside the server-side `JSHeapData`, so the
    // `JSHeapData` must outlive them.
    std::unique_ptr<JSHeapData, JSHeapDataDeleter> m_heapData;

    RefPtr<WebCore::DOMWrapperWorld> m_normalWorld;
    JSC::GCClient::IsoSubspace m_domConstructorSpace;
    JSC::GCClient::IsoSubspace m_domBuiltinConstructorSpace;
    JSC::GCClient::IsoSubspace m_domNamespaceObjectSpace;

    std::unique_ptr<ExtendedDOMClientIsoSubspaces> m_clientSubspaces;
    Vector<JSC::IsoSubspace*> m_outputConstraintSpaces;

    WebCore::HTTPHeaderIdentifiers m_httpHeaderIdentifiers;
    WeakHashSet<JSVMClientDataClient> m_clients;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::JSVMClientData)
static bool isType(const JSC::VM::ClientData& clientData) { return clientData.isWebCoreJSClientData(); }
SPECIALIZE_TYPE_TRAITS_END()

namespace WebCore {

// Out-of-line slow path shared by every subspaceForImpl<T> instantiation.
// The template wrapper keeps only the fast-path cache check inline and
// forwards the T-dependent constants + slot addresses here on a miss, so
// the lock + IsoSubspace construction is emitted once instead of per-class.
JSC::GCClient::IsoSubspace* subspaceForImplSlow(
    JSC::VM&,
    JSVMClientData&,
    std::unique_ptr<JSC::GCClient::IsoSubspace>& clientSlot,
    std::unique_ptr<JSC::IsoSubspace>& serverSlot,
    const JSC::HeapCellType&,
    size_t cellSize,
    uint8_t numberOfLowerTierPreciseCells,
    bool hasOutputConstraints);

template<typename T, UseCustomHeapCellType useCustomHeapCellType, typename ClientSlot, typename ServerSlot>
ALWAYS_INLINE JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm, ClientSlot clientSlot, ServerSlot serverSlot, JSC::HeapCellType& (*getCustomHeapCellType)(JSHeapData&) = nullptr)
{
    auto& clientData = *downcast<JSVMClientData>(vm.clientData);
    std::unique_ptr<JSC::GCClient::IsoSubspace>& clientSlotRef = clientSlot(clientData.clientSubspaces());
    if (auto* clientSpace = clientSlotRef.get())
        return clientSpace;

    static_assert(useCustomHeapCellType == UseCustomHeapCellType::Yes || std::is_base_of_v<JSC::JSDestructibleObject, T> || T::needsDestruction == JSC::DoesNotNeedDestruction);

    auto& heapData = clientData.heapData();
    const JSC::HeapCellType* heapCellType;
    if constexpr (useCustomHeapCellType == UseCustomHeapCellType::Yes)
        heapCellType = &getCustomHeapCellType(heapData);
    else if constexpr (std::is_base_of_v<JSC::JSDestructibleObject, T>)
        heapCellType = &vm.heap.destructibleObjectHeapCellType;
    else
        heapCellType = &vm.heap.cellHeapCellType;

    IGNORE_WARNINGS_BEGIN("unreachable-code")
    IGNORE_WARNINGS_BEGIN("tautological-compare")
    void (*myVisitOutputConstraint)(JSC::JSCell*, JSC::SlotVisitor&) = T::visitOutputConstraints;
    void (*jsCellVisitOutputConstraint)(JSC::JSCell*, JSC::SlotVisitor&) = JSC::JSCell::visitOutputConstraints;
    bool hasOutputConstraints = myVisitOutputConstraint != jsCellVisitOutputConstraint;
    IGNORE_WARNINGS_END
    IGNORE_WARNINGS_END

    return subspaceForImplSlow(vm, clientData, clientSlotRef, serverSlot(heapData.subspaces()), *heapCellType, sizeof(T), T::numberOfLowerTierPreciseCells, hasOutputConstraints);
}

static JSVMClientData* clientData(JSC::VM& vm)
{
    return downcast<JSVMClientData>(vm.clientData);
}

static inline BunBuiltinNames& builtinNames(JSC::VM& vm)
{
    return clientData(vm)->builtinNames();
}

} // namespace WebCore

inline void* bunVM(JSC::VM& vm)
{
    return WebCore::clientData(vm)->bunVM;
}

namespace WebCore {
using JSVMClientData = WebCore::JSVMClientData;
using JSHeapData = WebCore::JSHeapData;

}
