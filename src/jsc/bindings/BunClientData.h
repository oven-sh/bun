#pragma once

// A counted reference to a VM's handle (bun_jsc::VmHandle): what any thread other than the
// VM's own uses to post work to it, keep its loop alive, or ask whether it may still run
// script. retain / retainRef take a count, release gives one up; valid however long it is held.
struct BunVmHandleRef;
extern "C" const BunVmHandleRef* Bun__VmHandle__retain(void* bunVM); // JS thread
extern "C" const BunVmHandleRef* Bun__VmHandle__retainRef(const BunVmHandleRef*); // any thread
extern "C" void Bun__VmHandle__release(const BunVmHandleRef*);
namespace WebCore {
class EventLoopTask;
}
// Post through a reference and give it up in one step (a reference taken only to outlive a lock).
extern "C" void Bun__VmHandle__postAndRelease(const BunVmHandleRef*, WebCore::EventLoopTask*);
extern "C" void Bun__VmHandle__refKeepAlive(const BunVmHandleRef*, int delta);
// Node's can_call_into_js(): false once the VM's stop was requested (terminate()/exit/teardown). Any thread.
extern "C" bool Bun__VmHandle__scriptAllowed(const BunVmHandleRef*);
// The handle's state byte, so hot paths test it inline (BUN_VM_HANDLE_STATE_OPEN == bun_jsc::vm_handle::State::Open).
extern "C" const unsigned char* Bun__VmHandle__stateAddress(const BunVmHandleRef*);
#define BUN_VM_HANDLE_STATE_OPEN 0
#include <atomic>
inline bool Bun__VmHandle__scriptAllowedInline(const unsigned char* state)
{
    // Rust's AtomicU8 has the layout of u8; a relaxed load pairs with its stores.
    return reinterpret_cast<const std::atomic<unsigned char>*>(state)->load(std::memory_order_relaxed) == BUN_VM_HANDLE_STATE_OPEN;
}
// JS thread only: adjust the keep-alive of the VM this thread runs.
extern "C" void Bun__eventLoop__refKeepAlive(void* bunVM, int delta);

namespace WebCore {

class ExtendedDOMClientIsoSubspaces;
class ExtendedDOMIsoSubspaces;
class JSBuiltinFunctions;

class DOMWrapperWorld;
}

#include "root.h"
#include <wtf/SentinelLinkedList.h>

#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "BunBuiltinNames.h"
// #include "WebCoreJSBuiltins.h"
// #include "WorkerThreadType.h"
#include <wtf/AbstractRefCountedAndCanMakeWeakPtr.h>
#include <wtf/Function.h>
#include <wtf/HashSet.h>
#include <wtf/RefPtr.h>
#include <JavaScriptCore/WeakInlines.h>
#include <wtf/StdLibExtras.h>
#include <wtf/WeakHashSet.h>
#include "JSCTaskScheduler.h"
#include "HTTPHeaderIdentifiers.h"
namespace Zig {
class GlobalObject;
}

namespace Bun {
class StrongRootBlock;
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
    JSC::IsoSubspace m_domNamespaceObjectSpace;

    Vector<JSC::IsoSubspace*> m_outputConstraintSpaces;
};

DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(JSVMClientData);

// WebCore's JSVMClientDataClient: something holding JSC::Weak<> handles into a VM whose C++ owner
// can outlive that VM (a JSEventListener on an AbortSignal an in-flight request holds, or on a
// MessagePort in transit) registers here so ~JSVMClientData can tell it to let go first
// (willDestroyVM). As upstream, only worker VMs' clients register — the main VM lives for the
// process. Unlike upstream (WeakHashSet), Bun links clients intrusively: two pointer stores to
// register, and the client unlinks itself in its destructor (VM thread, which the Weak<> handles
// already require).
class JSVMClientDataClient : public BasicRawSentinelNode<JSVMClientDataClient> {
public:
    virtual ~JSVMClientDataClient() = default;
    virtual void willDestroyVM() = 0;
};

class JSVMClientData : public JSC::VM::ClientData {
    WTF_MAKE_NONCOPYABLE(JSVMClientData);
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(JSVMClientData, JSVMClientData);

public:
    explicit JSVMClientData(JSC::VM&, RefPtr<JSC::SourceProvider>);

    virtual ~JSVMClientData();

    static void create(JSC::VM*, void* bunVM, bool isWorkerVM);

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

    // Constructed eagerly so the concurrent GC marker
    // (Zig::GlobalObject::visitChildrenImpl) never races the mutator on a
    // lazy std::optional::emplace(). The ctor only calls
    // LazyProperty::initLater ~90 times (stores a tagged function pointer),
    // so there is no startup cost worth deferring.
    WebCore::HTTPHeaderIdentifiers& httpHeaderIdentifiers() { return m_httpHeaderIdentifiers; }

    void* bunVM;
    // Opaque box of the Rust VmHandle for this VM: what any *other* thread uses
    // to post work / ref the loop (never bunVM). Created in create(), released
    // in the destructor; valid however long C++ holds it.
    const ::BunVmHandleRef* vmHandle { nullptr };
    // vmHandle's state byte (Bun__VmHandle__stateAddress): the per-callback "may run script" test is one load.
    const unsigned char* vmHandleState { nullptr };
    ALWAYS_INLINE bool scriptAllowed() const { return Bun__VmHandle__scriptAllowedInline(vmHandleState); }
    Bun::JSCTaskScheduler deferredWorkTimer;

    // Linked list of StrongRootBlock cells backing bun_jsc::Strong handles
    // (see StrongRootBlock.h). Raw pointers into the GC heap: they are rooted
    // by a SimpleMarkingConstraint registered in JSVMClientData::create(), so
    // no HandleSet node is needed and no GlobalObject owns them (ShadowRealm /
    // node:vm / `bun test --isolate` globals share one list).
    Bun::StrongRootBlock* m_strongRootBlockHead { nullptr };
    Bun::StrongRootBlock* m_strongRootBlockFree { nullptr };
    // Last block acquire() found room in; always on the active list (cleared by
    // release() if unlinked), so it is already rooted via m_strongRootBlockHead.
    Bun::StrongRootBlock* m_strongRootBlockCursor { nullptr };
    JSC::Structure* m_strongRootBlockStructure { nullptr };

    // Backing storage for Bun::IsolatedModuleCache (see IsolatedModuleCache.h).
    // All access should go through that class. Stored as the JSC base type to
    // avoid pulling ZigSourceProvider.h into this header; the cache class
    // downcasts on lookup. Values hold strong refs by design: this map is the
    // only owner once the previous global is GC'd, so a weak map would empty
    // after every swap.
    WTF::UncheckedKeyHashMap<WTF::String, RefPtr<JSC::SourceProvider>> isolationSourceProviderCache;

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
    JSC::GCClient::IsoSubspace m_domNamespaceObjectSpace;

    std::unique_ptr<ExtendedDOMClientIsoSubspaces> m_clientSubspaces;

    WebCore::HTTPHeaderIdentifiers m_httpHeaderIdentifiers;

    SentinelLinkedList<JSVMClientDataClient, BasicRawSentinelNode<JSVMClientDataClient>> m_clients;
    bool m_isWorkerVM { false };

public:
    // upstream's `&vm != commonVMOrNull()`
    bool isWorkerVM() const { return m_isWorkerVM; }
    // VM thread. Unlinking is the client's own (`remove()` in its destructor).
    void addClient(JSVMClientDataClient& client) { m_clients.append(&client); }
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::JSVMClientData)
static bool isType(const JSC::VM::ClientData& clientData) { return clientData.isWebCoreJSClientData(); }
SPECIALIZE_TYPE_TRAITS_END()

namespace WebCore {

template<typename T, UseCustomHeapCellType useCustomHeapCellType, typename GetClient, typename SetClient, typename GetServer, typename SetServer>
ALWAYS_INLINE JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm, GetClient getClient, SetClient setClient, GetServer getServer, SetServer setServer, JSC::HeapCellType& (*getCustomHeapCellType)(JSHeapData&) = nullptr)
{
    auto& clientData = *downcast<JSVMClientData>(vm.clientData);
    auto& clientSubspaces = clientData.clientSubspaces();
    if (auto* clientSpace = getClient(clientSubspaces))
        return clientSpace;

    auto& heapData = clientData.heapData();
    Locker locker { heapData.lock() };

    auto& subspaces = heapData.subspaces();
    JSC::IsoSubspace* space = getServer(subspaces);
    if (!space) {
        JSC::Heap& heap = vm.heap;
        std::unique_ptr<JSC::IsoSubspace> uniqueSubspace;
        static_assert(useCustomHeapCellType == UseCustomHeapCellType::Yes || std::is_base_of_v<JSC::JSDestructibleObject, T> || T::needsDestruction == JSC::DoesNotNeedDestruction);
        if constexpr (useCustomHeapCellType == UseCustomHeapCellType::Yes)
            uniqueSubspace = makeUnique<JSC::IsoSubspace> ISO_SUBSPACE_INIT(heap, getCustomHeapCellType(heapData), T);
        else {
            if constexpr (std::is_base_of_v<JSC::JSDestructibleObject, T>)
                uniqueSubspace = makeUnique<JSC::IsoSubspace> ISO_SUBSPACE_INIT(heap, heap.destructibleObjectHeapCellType, T);
            else
                uniqueSubspace = makeUnique<JSC::IsoSubspace> ISO_SUBSPACE_INIT(heap, heap.cellHeapCellType, T);
        }
        space = uniqueSubspace.get();
        setServer(subspaces, WTF::move(uniqueSubspace));

        IGNORE_WARNINGS_BEGIN("unreachable-code")
        IGNORE_WARNINGS_BEGIN("tautological-compare")
        void (*myVisitOutputConstraint)(JSC::JSCell*, JSC::SlotVisitor&) = T::visitOutputConstraints;
        void (*jsCellVisitOutputConstraint)(JSC::JSCell*, JSC::SlotVisitor&) = JSC::JSCell::visitOutputConstraints;
        if (myVisitOutputConstraint != jsCellVisitOutputConstraint)
            heapData.outputConstraintSpaces().append(space);
        IGNORE_WARNINGS_END
        IGNORE_WARNINGS_END
    }

    auto uniqueClientSubspace = makeUnique<JSC::GCClient::IsoSubspace>(*space);
    auto* clientSpace = uniqueClientSubspace.get();
    setClient(clientSubspaces, WTF::move(uniqueClientSubspace));
    return clientSpace;
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
