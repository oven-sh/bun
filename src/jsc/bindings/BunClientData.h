#pragma once

// A counted reference to a VM's handle (bun_jsc::VmHandle): what any thread other than the
// VM's own uses to post work to it, keep its loop alive, or ask whether it may still run
// script. Valid however long it is held.
#include "BunLoopKind.h"
#include <wtf/SharedTask.h>
struct BunVmHandleRef;
extern "C" const BunVmHandleRef* Bun__VmHandle__retain(void* bunVM); // JS thread
extern "C" void Bun__VmHandle__retainRef(const BunVmHandleRef*); // any thread
extern "C" void Bun__VmHandle__release(const BunVmHandleRef*);
struct BunVmHandleRef {
    BunVmHandleRef() = delete;
    void ref() const { Bun__VmHandle__retainRef(this); }
    void deref() const { Bun__VmHandle__release(this); }
};
namespace JSC {
class TopExceptionScope;
}
namespace Bun {
// A TerminationException that has unwound past the outermost script frame (!vm.isEntered()) is the VM's stop arriving
// at native code that keeps running: take it off the VM, reset JSC's request flag as an entry-scope exit would, forbid
// execution (WebCore's forbidExecution() at the same point). Beneath script it stays pending for JSC to unwind. True if
// taken. bindings.cpp.
bool takeTerminationOutsideScript(JSC::VM&, JSC::TopExceptionScope&);
}
extern "C" bool Bun__VM__takeTerminationOutsideScript(JSC::JSGlobalObject*);

namespace WebCore {
class WorkerMessagingProxy;
class EventLoopTask;
}
extern "C" bool Bun__VmHandle__post(const BunVmHandleRef*, WebCore::EventLoopTask*, BunLoopKind);
extern "C" void Bun__VmHandle__refKeepAlive(const BunVmHandleRef*, BunLoopKind, int delta);
extern "C" void Bun__VmHandle__wake(const BunVmHandleRef*); // any thread
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

namespace WebCore {

class ExtendedDOMClientIsoSubspaces;

class DOMWrapperWorld;
}

#include "root.h"
#include <wtf/SentinelLinkedList.h>

#include "ExtendedDOMClientIsoSubspaces.h"
#include "BunBuiltinNames.h"
// #include "WebCoreJSBuiltins.h"
// #include "WorkerThreadType.h"
#include <wtf/AbstractRefCountedAndCanMakeWeakPtr.h>
#include <wtf/Function.h>
#include <wtf/HashSet.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/RefPtr.h>
#include <wtf/UniqueRef.h>
#include <JavaScriptCore/IsoHeapCellType.h>
#include <JavaScriptCore/WeakInlines.h>
#include <wtf/StdLibExtras.h>
#include <wtf/WeakHashSet.h>
#include "JSCTaskScheduler.h"
#include "HTTPHeaderIdentifiers.h"
#include "BunCommonStrings.h"
#include "Bindgen/SchemaStrings.h"
#include "DOMURLBaseCache.h"
#include "NodeHTTPRequestHeaderValues.h"
#include "NodeVMOptionNames.h"
#include "NodeVMSourceOriginCache.h"
#include <JavaScriptCore/HeapObserver.h>
namespace Zig {
class GlobalObject;
}
class VersionSqlite3;

namespace Bun {
class StrongRootBlock;
struct IsolatedInternalModule;

// JSC measures the live size of the heap at the end of each collection, but only
// publishes it per scope: an eden collection updates
// Heap::sizeAfterLastEdenCollection() and a full collection updates
// Heap::sizeAfterLastFullCollection(), so one of the two is always stale. The
// combined counter (Heap::m_sizeAfterLastCollect) has no accessor. Attached to
// the heap for the life of the VM, this copies the counter of whichever scope
// just finished. Unlike Heap::size(), reading it does not walk the heap.
class HeapSizeAfterLastCollection final : public JSC::HeapObserver {
    WTF_MAKE_NONCOPYABLE(HeapSizeAfterLastCollection);

public:
    explicit HeapSizeAfterLastCollection(JSC::Heap& heap)
        : m_heap(heap)
    {
        m_heap.addObserver(this);
    }

    ~HeapSizeAfterLastCollection() final
    {
        m_heap.removeObserver(this);
    }

    // 0 until the first collection of this heap finishes.
    size_t get() const { return m_sizeAfterLastCollection; }

private:
    void willGarbageCollect() final {}

    // Heap::didFinishCollection() notifies observers after updateAllocationLimits()
    // stored this collection's size, in the end phase of the collection, while
    // the mutator is stopped. The mutator reads m_sizeAfterLastCollection once
    // it resumes, the same way it reads JSC's own counters.
    void didGarbageCollect(JSC::CollectionScope scope) final
    {
        m_sizeAfterLastCollection = scope == JSC::CollectionScope::Full
            ? m_heap.sizeAfterLastFullCollection()
            : m_heap.sizeAfterLastEdenCollection();
    }

    JSC::Heap& m_heap;
    size_t m_sizeAfterLastCollection { 0 };
};
}

namespace JSC {
struct HashTableValue;
}

namespace Bun {
// Out-of-line `JSC::Structure::create` / `JSC::reifyStaticProperties` for the
// once-per-class setup paths, so each wrapper class doesn't inline them.
JSC::Structure* createClassStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype, JSC::TypeInfo, const JSC::ClassInfo*, JSC::IndexingType = JSC::NonArray, unsigned inlineCapacity = 0);
void reifyStaticPropertyTable(JSC::VM&, const JSC::ClassInfo*, std::span<const JSC::HashTableValue>, JSC::JSObject&);
// `JSC::allocateCell` for a fieldless `JSNonFinalObject` subclass living in `vm.plainObjectSpace()` (prototype objects).
void* allocatePlainObjectCell(JSC::VM&, size_t);
// `JSC_TO_STRING_TAG_WITHOUT_TRANSITION()`, out of line.
void putToStringTagWithoutTransition(JSC::VM&, JSC::JSObject*, const JSC::ClassInfo*);
}

namespace WebCore {
using namespace JSC;
using namespace Zig;

enum class UseCustomHeapCellType { Yes,
    No };

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
    explicit JSVMClientData(JSC::VM&);

    virtual ~JSVMClientData();

    // `worker` is the WorkerMessagingProxy this VM is being created for, or null on the main thread.
    static void create(JSC::VM*, void* bunVM, WorkerMessagingProxy* worker);

    BunBuiltinNames& builtinNames() { return m_builtinNames; }

    WebCore::DOMWrapperWorld& normalWorld() { return *m_normalWorld; }

    JSC::ConsoleClient& consoleClient() { return m_consoleClient; }

    ExtendedDOMClientIsoSubspaces& clientSubspaces() { return *m_clientSubspaces.get(); }

    // Constructed eagerly so the concurrent GC marker
    // (Zig::GlobalObject::visitChildrenImpl) never races the mutator on a
    // lazy std::optional::emplace(). The ctor only calls
    // LazyProperty::initLater ~90 times (stores a tagged function pointer),
    // so there is no startup cost worth deferring.
    WebCore::HTTPHeaderIdentifiers& httpHeaderIdentifiers() { return m_httpHeaderIdentifiers; }

    // Public so Bun::commonStrings(vm) below is a static_cast and a member load.
    Bun::CommonStrings commonStrings;
    Bun::Bindgen::SchemaStrings schemaStrings;

    WebCore::DOMURLBaseCache& urlBaseCache() { return m_urlBaseCache; }
    Bun::NodeHTTPRequestHeaderValues& nodeHTTPRequestHeaderValues() { return m_nodeHTTPRequestHeaderValues; }
    Bun::NodeVMOptionNames& nodeVMOptionNames() { return m_nodeVMOptionNames; }
    Bun::NodeVMSourceOriginCache& nodeVMSourceOriginCache() { return m_nodeVMSourceOriginCache; }

    // Live size of the heap as measured by the most recent collection, eden or full.
    size_t heapSizeAfterLastCollection() const { return m_heapSizeAfterLastCollection.get(); }

    // The VM's default (first) Zig::GlobalObject: what defaultGlobalObject(JSC::VM&) returns on threads whose thread-local
    // default is not this VM's, e.g. the collector thread running a collection's end phase. gcProtect'ed for the VM's life.
    JSC::JSGlobalObject* defaultGlobalObject { nullptr };

    // `bun test --isolate` loads DOM packages into this global, which outlives the test files. gcProtect'ed for the VM's life.
    JSC::JSGlobalObject* testEnvironmentRealm { nullptr };

    // Idle full collections GarbageCollectionController requested that have not finished (see Bun__JSC_onBeforeWait).
    std::atomic<unsigned> idleCollectionsPending { 0 };
    // Their GCRequest::didFinishEndPhase, made once (JSC__VM__collectAsyncIdle).
    RefPtr<WTF::SharedTask<void()>> idleCollectionDidFinish;

    void* bunVM;
    // A count on the Rust VmHandle for this VM: what any *other* thread uses to post work / ref the loop (never bunVM).
    RefPtr<const ::BunVmHandleRef> vmHandle;
    // vmHandle's state byte (Bun__VmHandle__stateAddress): the per-callback "may run script" test is one load.
    const unsigned char* vmHandleState { nullptr };
    ALWAYS_INLINE bool scriptAllowed() const { return Bun__VmHandle__scriptAllowedInline(vmHandleState); }
    // Stopping: the stop has been requested (any thread; `!scriptAllowed()`). Stopped: it has been carried out on
    // this thread and JSC forbids execution. Either way no script may be entered on this VM.
    ALWAYS_INLINE bool isStoppingOrStopped(const JSC::VM& vm) const { return !scriptAllowed() || vm.executionForbidden(); }
    Bun::JSCTaskScheduler deferredWorkTimer;

    // "process", "stdout" and "stderr", atomized by the first jsFunctionIsStandardOutputStream.
    std::array<JSC::Identifier, 3> standardOutputStreamNames;

    // Linked list of StrongRootBlock cells backing bun_jsc::Strong handles
    // (see StrongRootBlock.h). Raw pointers into the GC heap: they are rooted
    // by a SimpleMarkingConstraint registered in JSVMClientData::create(), so
    // no JSC::Strong is needed and no GlobalObject owns them (ShadowRealm /
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
    Vector<Bun::IsolatedInternalModule> isolationInternalModules;

    void reportErrorOfMicrotask(JSC::JSGlobalObject*, JSC::Exception*) final;

private:
    bool isWebCoreJSClientData() const final { return true; }

    BunBuiltinNames m_builtinNames;

    RefPtr<WebCore::DOMWrapperWorld> m_normalWorld;
    const UniqueRef<JSC::ConsoleClient> m_consoleClient;

    std::unique_ptr<ExtendedDOMClientIsoSubspaces> m_clientSubspaces;

    WebCore::HTTPHeaderIdentifiers m_httpHeaderIdentifiers;

    WebCore::DOMURLBaseCache m_urlBaseCache;
    Bun::NodeHTTPRequestHeaderValues m_nodeHTTPRequestHeaderValues;
    Bun::NodeVMOptionNames m_nodeVMOptionNames;
    Bun::NodeVMSourceOriginCache m_nodeVMSourceOriginCache;

    Bun::HeapSizeAfterLastCollection m_heapSizeAfterLastCollection;

    SentinelLinkedList<JSVMClientDataClient, BasicRawSentinelNode<JSVMClientDataClient>> m_clients;
    Vector<VersionSqlite3*> m_sqliteDatabases;
    bool m_isWorkerVM { false };
    bool m_isNodeWorkerVM { false };

public:
    // upstream's `&vm != commonVMOrNull()`
    bool isWorkerVM() const { return m_isWorkerVM; }
    // Created by node:worker_threads' Worker (WorkerOptions::Kind::Node), as opposed to the Web Worker constructor.
    bool isNodeWorkerVM() const { return m_isNodeWorkerVM; }
    // VM thread. Unlinking is the client's own (`remove()` in its destructor).
    void addClient(JSVMClientDataClient& client) { m_clients.append(&client); }
    // VM thread. The bun:sqlite connections this VM has; each one removes itself in its destructor.
    Vector<VersionSqlite3*>& sqliteDatabases() { return m_sqliteDatabases; }
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::JSVMClientData)
static bool isType(const JSC::VM::ClientData& clientData) { return clientData.isWebCoreJSClientData(); }
SPECIALIZE_TYPE_TRAITS_END()

namespace WebCore {

// Where a class that needs a space of its own keeps it.
struct SubspaceSlots {
    size_t clientOffset;
};

#define BUN_SUBSPACE_SLOTS(clientMember, serverMember) \
    ::WebCore::SubspaceSlots { OBJECT_OFFSETOF(::WebCore::ExtendedDOMClientIsoSubspaces, clientMember) }

JSC::GCClient::IsoSubspace* subspaceForImplSlow(JSC::VM&, SubspaceSlots, size_t cellSize, void (*destroy)(JSC::JSCell*), bool hasOutputConstraints);
void destroyWithClassInCell(JSC::JSCell*);

template<typename T>
inline constexpr bool hasOutputConstraints = static_cast<void (*)(JSC::JSCell*, JSC::SlotVisitor&)>(T::visitOutputConstraints) != static_cast<void (*)(JSC::JSCell*, JSC::SlotVisitor&)>(JSC::JSCell::visitOutputConstraints);

// A non-public destroy can only be an override.
template<typename T, typename From>
inline constexpr bool inheritsDestroy = [] {
    using Destroy = void (*)(JSC::JSCell*);
    if constexpr (requires { static_cast<Destroy>(&T::destroy) == static_cast<Destroy>(&From::destroy); })
        return static_cast<Destroy>(&T::destroy) == static_cast<Destroy>(&From::destroy);
    else
        return false;
}();

// JSCell::destroy runs no destructor, and that of another base class only its own.
template<typename T>
inline constexpr bool destroySkipsMembers = [] {
    if constexpr (requires { typename T::Base; })
        return inheritsDestroy<T, JSC::JSCell> || (inheritsDestroy<T, typename T::Base> && __datasizeof(T) != __datasizeof(typename T::Base));
    else
        return inheritsDestroy<T, JSC::JSCell>;
}();

template<typename T, UseCustomHeapCellType useCustomHeapCellType>
ALWAYS_INLINE JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm, SubspaceSlots slots)
{
    static_assert(useCustomHeapCellType == UseCustomHeapCellType::Yes || std::is_base_of_v<JSC::JSDestructibleObject, T> || T::needsDestruction == JSC::DoesNotNeedDestruction);
    static_assert(std::is_trivially_destructible_v<T> || (T::needsDestruction != JSC::DoesNotNeedDestruction && !destroySkipsMembers<T>),
        "the GC never runs the destructors of this cell type's members; set `needsDestruction` and define `static void destroy(JSC::JSCell*)`");
    constexpr bool hasClassInCell = std::is_base_of_v<JSC::JSDestructibleObject, T>;
    constexpr bool needsDestruction = T::needsDestruction != JSC::DoesNotNeedDestruction;
    if constexpr (hasClassInCell && !hasOutputConstraints<T>)
        return &vm.destructibleObjectSpace().allocatorFor<sizeof(T)>();
    else if constexpr (!needsDestruction && !hasOutputConstraints<T>)
        return &vm.heap.cellSpace().allocatorFor<sizeof(T)>();
    else {
        auto& clientData = *downcast<JSVMClientData>(vm.clientData);
        if (auto* space = *reinterpret_cast<JSC::GCClient::IsoSubspace**>(reinterpret_cast<uint8_t*>(&clientData.clientSubspaces()) + slots.clientOffset))
            return space;
        void (*destroy)(JSC::JSCell*) = nullptr;
        if constexpr (hasClassInCell)
            destroy = destroyWithClassInCell;
        else if constexpr (needsDestruction)
            destroy = T::destroy;
        return subspaceForImplSlow(vm, slots, sizeof(T), destroy, hasOutputConstraints<T>);
    }
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

namespace Bun {

ALWAYS_INLINE CommonStrings& commonStrings(JSC::VM& vm)
{
    return static_cast<WebCore::JSVMClientData*>(vm.clientData)->commonStrings;
}

} // namespace Bun

inline void* bunVM(JSC::VM& vm)
{
    return WebCore::clientData(vm)->bunVM;
}

namespace WebCore {
using JSVMClientData = WebCore::JSVMClientData;

}
