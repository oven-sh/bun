#pragma once

#include "root.h"
#include "ModuleGraph.h"
#include "ScriptExecutionContext.h"
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <wtf/Deque.h>
#include <wtf/HashMap.h>
#include <wtf/ListHashSet.h>
#include <wtf/RunLoop.h>

namespace Zig {
class GlobalObject;
}

namespace Bun {

class DurableObjectDatabase;
class DurableObjectAlarmIndex;
class JSDurableObjectActor;
class JSDurableObjectEvent;
class JSDurableObjectHandle;
class JSDurableObjectId;
class JSDurableObjectNamespace;
class JSDurableObjectStub;

// Bun.DurableObject / Bun.DurableObjectNamespace.
//
// A namespace owns the objects of one class. An object that is loaded runs in a Bun.ModuleGraph
// of its own: it has a context of its own for timers and I/O (evicting or resetting it closes
// what it opened) and, when the class is given as a module, module state of its own. What
// outlives an eviction is the namespace's: the object's SQLite database, its alarm and its
// WebSockets.
//
// Everything here that is not the object's own script runs in the context the namespace was
// made in, never in an object's and never in a caller's: what is started in a context goes
// with it, and that must not be the namespace's bookkeeping or another object's graph.

enum class DurableObjectEventKind : uint8_t {
    Call,
    Get,
    Fetch,
    Alarm,
    SocketOpen,
    SocketMessage,
    SocketClose,
    SocketDrain,
    // Not delivered to the object: what a promise the runtime waits on continues with.
    Block,
    WaitUntil,
    Import,
    Transaction,
};

// Per-realm: the structures and functions of everything below.
class JSDurableObjectRealm final : public JSC::JSInternalFieldObjectImpl<24> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<24>;
    enum class Field : uint32_t {
        NamespaceStructure,
        NamespaceConstructor,
        DurableObjectConstructor,
        DurableObjectStructure,
        IdStructure,
        StubStructure,
        RpcFunctionStructure,
        StateStructure,
        StorageStructure,
        SqlStructure,
        KvStructure,
        TransactionStructure,
        SocketStructure,
        ServerStructure,
        CursorStructure,
        RawCursorStructure,
        ActorStructure,
        EventStructure,
        OnFulfilled,
        OnRejected,
        CommitMicrotask,
        OnGraphError,
        WebSocketHandler,
        SocketMap,
        Count,
    };
    static_assert(static_cast<uint32_t>(Field::Count) <= numberOfInternalFields);

    DECLARE_INFO;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*);
    static JSDurableObjectRealm* create(JSC::VM&, Zig::GlobalObject*);
    static JSDurableObjectRealm* of(Zig::GlobalObject*);

    JSC::Structure* structure(Field field) const { return uncheckedDowncast<JSC::Structure>(internalField(static_cast<uint32_t>(field)).get().asCell()); }
    JSC::JSObject* object(Field field) const { return asObject(internalField(static_cast<uint32_t>(field)).get()); }
    JSC::JSFunction* function(Field field) const { return uncheckedDowncast<JSC::JSFunction>(internalField(static_cast<uint32_t>(field)).get().asCell()); }

private:
    JSDurableObjectRealm(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM&, Zig::GlobalObject*);
};

class JSDurableObjectId final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    static JSDurableObjectId* create(JSC::VM&, JSC::Structure*, JSDurableObjectNamespace*, JSC::JSString* hex, JSC::JSString* name);

    JSDurableObjectNamespace* ns() const { return m_namespace.get(); }
    JSC::JSString* hex() const { return m_hex.get(); }
    JSC::JSString* name() const { return m_name.get(); }

private:
    JSDurableObjectId(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    JSC::WriteBarrier<JSDurableObjectNamespace> m_namespace;
    JSC::WriteBarrier<JSC::JSString> m_hex;
    JSC::WriteBarrier<JSC::JSString> m_name;
};

// stub.method(...) and `await stub.property`: every name that is not the stub's own is a
// function made on first use and kept on the stub.
class JSDurableObjectStub final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesGetOwnPropertySlot | JSC::GetOwnPropertySlotMayBeWrongAboutDontEnum;
    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    static JSDurableObjectStub* create(JSC::VM&, JSC::Structure*, JSDurableObjectId*);
    static bool getOwnPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);

    JSDurableObjectId* id() const { return m_id.get(); }
    // The object's record, once found. It is looked up again when the namespace has let go of it.
    JSDurableObjectActor* actor(Zig::GlobalObject*);

private:
    JSDurableObjectStub(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    JSC::WriteBarrier<JSDurableObjectId> m_id;
    JSC::WriteBarrier<JSDurableObjectActor> m_actor;
};

class JSDurableObjectRpcFunction final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    static JSDurableObjectRpcFunction* create(JSC::VM&, JSC::Structure*, JSDurableObjectStub*, JSC::JSString* name);

    JSDurableObjectStub* stub() const { return m_stub.get(); }
    JSC::JSString* methodName() const { return m_name.get(); }

private:
    JSDurableObjectRpcFunction(JSC::VM&, JSC::Structure*);
    JSC::WriteBarrier<JSDurableObjectStub> m_stub;
    JSC::WriteBarrier<JSC::JSString> m_name;
};

// A reference into one life of one object: `ctx`, `ctx.storage`, `.sql`, `.kv`, a transaction,
// the `server` its fetch() gets, and the record that ties a WebSocket to it. One that outlives
// the life it was made in (the object was evicted or reset since) refuses to work.
class JSDurableObjectHandle final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    enum class Kind : uint8_t {
        State,
        Storage,
        Sql,
        Kv,
        Transaction,
        Server,
        Socket,
    };
    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    static JSDurableObjectHandle* create(JSC::VM&, JSC::Structure*, Kind, JSDurableObjectActor*);

    Kind kind() const { return m_kind; }
    JSDurableObjectActor* actor() const { return m_actor.get(); }
    uint32_t generation() const { return m_generation; }
    // Whether the life of the object this was made in is still the current one.
    bool isCurrent() const;

    // Server: the Bun.serve server. Socket: the ServerWebSocket, once it is open.
    JSC::JSValue target() const { return m_target.get(); }
    void setTarget(JSC::VM& vm, JSC::JSValue value) { m_target.set(vm, this, value); }
    // Socket: `data` from upgrade() until the socket is open, then the tags (a JSArray of strings).
    JSC::JSValue extra() const { return m_extra.get(); }
    void setExtra(JSC::VM& vm, JSC::JSValue value) { m_extra.set(vm, this, value); }

    // Transaction: finished, rolled back. Server: upgrade() took the request. Socket: which slot of the actor's list it is in.
    bool m_finished { false };
    bool m_rolledBack { false };
    uint32_t m_index { 0 };
    // Socket: when the auto-response last answered it, in ms since the epoch; 0 for never.
    double m_autoResponseAt { 0 };

private:
    JSDurableObjectHandle(JSC::VM& vm, JSC::Structure* structure, Kind kind)
        : Base(vm, structure)
        , m_kind(kind)
    {
    }
    JSC::WriteBarrier<JSDurableObjectActor> m_actor;
    JSC::WriteBarrier<JSC::Unknown> m_target;
    JSC::WriteBarrier<JSC::Unknown> m_extra;
    uint32_t m_generation { 0 };
    Kind m_kind;
};

// An event for an object (queued, or running), or what a promise the runtime waits on
// continues with.
class JSDurableObjectEvent final : public JSC::JSInternalFieldObjectImpl<5> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<5>;
    enum class Field : uint32_t {
        Actor,
        A,
        B,
        C,
        Promise,
    };
    DECLARE_INFO;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*);
    static JSDurableObjectEvent* create(JSC::VM&, Zig::GlobalObject*, DurableObjectEventKind, JSDurableObjectActor*, JSC::JSValue a, JSC::JSValue b, JSC::JSValue c, JSC::JSPromise*);

    JSDurableObjectActor* actor() const;
    JSC::JSValue a() const { return internalField(static_cast<uint32_t>(Field::A)).get(); }
    JSC::JSValue b() const { return internalField(static_cast<uint32_t>(Field::B)).get(); }
    JSC::JSValue c() const { return internalField(static_cast<uint32_t>(Field::C)).get(); }
    void setA(JSC::VM& vm, JSC::JSValue value) { internalField(static_cast<uint32_t>(Field::A)).set(vm, this, value); }
    // The promise the caller holds; null for an event nobody waits for.
    JSC::JSPromise* promise() const { return dynamicDowncast<JSC::JSPromise>(internalField(static_cast<uint32_t>(Field::Promise)).get()); }

    DurableObjectEventKind m_kind;
    uint32_t m_generation { 0 };
    // Its slot in the actor's list of running events; notRunning otherwise.
    static constexpr uint32_t notRunning = std::numeric_limits<uint32_t>::max();
    uint32_t m_runningIndex { notRunning };

private:
    JSDurableObjectEvent(JSC::VM& vm, JSC::Structure* structure, DurableObjectEventKind kind)
        : Base(vm, structure)
        , m_kind(kind)
    {
    }
};

class JSDurableObjectActor final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;
    enum class State : uint8_t {
        Unloaded,
        Starting,
        Running,
    };
    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*);
    static JSDurableObjectActor* create(JSC::VM&, JSC::Structure*, JSDurableObjectNamespace*, JSDurableObjectId*);
    static void destroy(JSC::JSCell*);
    ~JSDurableObjectActor();

    JSDurableObjectNamespace* ns() const { return m_namespace.get(); }
    JSDurableObjectId* id() const { return m_id.get(); }
    void setId(JSC::VM& vm, JSDurableObjectId* id) { m_id.set(vm, this, id); }
    JSModuleGraph* graph() const { return m_graph.get(); }
    JSC::JSObject* instance() const { return m_instance.get(); }
    State state() const { return m_state; }
    uint32_t generation() const { return m_generation; }
    bool isIdle() const { return m_state == State::Running && !m_inflight && !m_blockers && m_queue.isEmpty(); }
    bool isBusy() const { return m_state == State::Starting || m_inflight || !m_queue.isEmpty(); }
    bool hasKeptState() const { return m_database || !m_sockets.isEmpty() || !m_autoResponseRequest.isNull(); }

    // ── Events ──
    // An event nobody waits for.
    void post(Zig::GlobalObject*, DurableObjectEventKind, JSC::JSValue a, JSC::JSValue b, JSC::JSValue c);
    // An event whose result settles the returned promise. `callerGraph`: the graph whose script is asking.
    // `arguments` (for Call) are used as they are when the event starts at once, and copied when it has to wait.
    JSC::JSPromise* request(Zig::GlobalObject*, DurableObjectEventKind, JSC::JSValue a, JSC::JSValue b, const JSC::ArgList* arguments, JSModuleGraph* callerGraph);
    void pump(Zig::GlobalObject*);
    void settle(Zig::GlobalObject*, JSDurableObjectEvent*, JSC::JSValue, bool failed);

    // ── ctx ──
    JSC::JSValue block(Zig::GlobalObject*, JSC::JSValue callback);
    void unblock(Zig::GlobalObject*, uint32_t generation);
    void waitUntil(Zig::GlobalObject*, JSC::JSPromise*);
    // The object is reset: what it was doing fails with `error`, what it had not committed is
    // rolled back and its WebSockets are closed. The next event starts it afresh.
    void abort(Zig::GlobalObject*, JSC::JSValue error);
    // The object goes out of memory; its storage, alarm and WebSockets stay.
    void evict(Zig::GlobalObject*);

    // ── Storage ── (DurableObjectStorage.cpp)
    // The open database, opening it first; null with an exception thrown.
    DurableObjectDatabase* database(Zig::GlobalObject*);
    DurableObjectDatabase* databaseIfOpen() const { return m_database.get(); }
    void closeDatabase();
    // Before a write: opens the implicit transaction and schedules its commit.
    bool beginWrite(Zig::GlobalObject*, DurableObjectDatabase*);
    // Commits what the object wrote. False, with the object reset, when that fails.
    bool flush(Zig::GlobalObject*);
    void alarmChanged(Zig::GlobalObject*);
    // Open sql cursors read the rest of their rows into memory (before a commit or a write).
    void drainCursors(Zig::GlobalObject*);

    // ── WebSockets ──
    void addSocket(JSC::VM&, JSDurableObjectHandle*);
    void removeSocket(JSDurableObjectHandle*);
    JSC::JSArray* socketsWithTag(Zig::GlobalObject*, const String& tag);
    void closeSockets(Zig::GlobalObject*, int code, ASCIILiteral reason);

    uint32_t m_blockers { 0 };
    bool m_alarmRunning { false };
    // The alarm handler that is running set or deleted the alarm itself.
    bool m_alarmTouched { false };
    uint8_t m_alarmRetries { 0 };
    bool m_commitScheduled { false };
    // The namespace's idle list: when it was put there, and whether it has been used since.
    double m_idleSince { 0 };
    bool m_inIdleList { false };
    bool m_usedSinceIdle { false };
    // The namespace has let go of this record; a stub that holds it looks the object up again.
    bool m_forgotten { false };
    // { request, response } answered without waking the object; empty for none.
    String m_autoResponseRequest;
    String m_autoResponseResponse;

private:
    JSDurableObjectActor(JSC::VM&, JSC::Structure*);
    void enqueue(Zig::GlobalObject*, JSDurableObjectEvent*, const JSC::ArgList* arguments, JSModuleGraph* callerGraph);
    // Whether the event finished without waiting on anything.
    bool run(Zig::GlobalObject*, JSDurableObjectEvent*, const JSC::ArgList* arguments = nullptr);
    void schedulePump(Zig::GlobalObject*);
    void start(Zig::GlobalObject*);
    void construct(Zig::GlobalObject*, JSC::JSValue classValue);
    void unload(Zig::GlobalObject*);
    void becameIdleOrBusy();
    bool beginAlarm(Zig::GlobalObject*, JSDurableObjectEvent*);
    void endAlarm(Zig::GlobalObject*, JSC::JSValue error, bool failed);
    void rejectEvent(Zig::GlobalObject*, JSDurableObjectEvent*, JSC::JSValue error);
    void importSettled(Zig::GlobalObject*, JSDurableObjectEvent*, JSC::JSValue, bool failed);
    void blockTimedOut();
    friend class JSDurableObjectNamespace;
    friend JSC::EncodedJSValue durableObjectReaction(JSC::JSGlobalObject*, JSC::CallFrame*, bool failed);

    JSC::WriteBarrier<JSDurableObjectNamespace> m_namespace;
    JSC::WriteBarrier<JSDurableObjectId> m_id;
    JSC::WriteBarrier<JSModuleGraph> m_graph;
    JSC::WriteBarrier<JSC::JSObject> m_instance;
    // Under cellLock(): read by the collector.
    Deque<JSDurableObjectEvent*> m_queue;
    Vector<JSDurableObjectEvent*> m_running;
    Vector<JSDurableObjectHandle*> m_sockets;

    std::unique_ptr<DurableObjectDatabase> m_database;
    std::unique_ptr<RunLoop::Timer> m_blockTimer;
    State m_state { State::Unloaded };
    bool m_pumpScheduled { false };
    // Bumped at every unload, so that a continuation of an earlier life can tell.
    uint32_t m_generation { 0 };
    uint32_t m_inflight { 0 };
};

class JSDurableObjectNamespace final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;
    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
    static void destroy(JSC::JSCell*);
    ~JSDurableObjectNamespace();

    struct Options {
        JSC::JSObject* classValue { nullptr };
        String modulePath;
        String exportName;
        String name;
        // Null: in memory.
        String storageDirectory;
        JSC::JSValue env;
        JSC::JSObject* globals { nullptr };
        JSC::JSObject* onError { nullptr };
        double idleTimeoutMs { 10'000 };
    };
    // Null with an exception thrown.
    static JSDurableObjectNamespace* create(Zig::GlobalObject*, JSC::ThrowScope&, JSC::Structure*, Options&&);

    const String& name() const { return m_name; }
    JSC::JSObject* classValue() const { return m_class.get(); }
    const String& modulePath() const { return m_modulePath; }
    const String& exportName() const { return m_exportName; }
    JSC::JSValue env() const { return m_env.get(); }
    JSC::JSObject* globals() const { return m_globals.get(); }
    JSC::JSObject* onError() const { return m_onError.get(); }
    const String& storageDirectory() const { return m_storageDirectory; }
    WebCore::ScriptExecutionContext& context() const { return m_context.get(); }
    bool isClosed() const { return m_closed; }
    DurableObjectAlarmIndex& alarmIndex() { return *m_index; }

    JSDurableObjectId* idFromName(Zig::GlobalObject*, JSC::JSString* name);
    JSDurableObjectId* newUniqueId(Zig::GlobalObject*);
    // Null with an exception thrown.
    JSDurableObjectId* idFromString(Zig::GlobalObject*, JSC::ThrowScope&, JSC::JSString* hex);
    JSDurableObjectActor* actorFor(Zig::GlobalObject*, JSDurableObjectId*);
    JSC::JSPromise* dispatch(Zig::GlobalObject*, JSDurableObjectStub*, DurableObjectEventKind, JSC::JSValue a, JSC::JSValue b, const JSC::ArgList* arguments = nullptr);

    // An error nobody is waiting for: to `onError`, or as an uncaught exception of the namespace's owner.
    void reportError(Zig::GlobalObject*, JSC::JSValue error, JSDurableObjectActor*);
    void actorBecameIdle(JSDurableObjectActor*);
    void actorBecameBusy(JSDurableObjectActor*);
    void actorWasReset();
    // An unloaded object with nothing the namespace keeps for it needs no record.
    void forget(JSDurableObjectActor*);
    // One timer for the namespace, set for the earliest entry of the alarm index.
    void scheduleAlarms();
    // While an object is loaded, an alarm is set or a WebSocket is accepted, the namespace stays
    // whether or not script still holds it.
    void updateKeepAlive();
    JSC::JSPromise* close(Zig::GlobalObject*);

    uint32_t m_loadedCount { 0 };
    uint32_t m_socketCount { 0 };

private:
    JSDurableObjectNamespace(JSC::VM&, JSC::Structure*, Ref<WebCore::ScriptExecutionContext>&&);
    void finishCreation(JSC::VM&);
    void alarmTimerFired();
    void sweepTimerFired();
    void fireAlarms(Zig::GlobalObject*);
    void sweep(Zig::GlobalObject*);
    void finishClosing(Zig::GlobalObject*);
    JSC::JSString* sealId(Zig::GlobalObject*, std::span<const uint8_t> payload);

    Ref<WebCore::ScriptExecutionContext> m_context;
    JSC::WriteBarrier<JSC::JSObject> m_class;
    JSC::WriteBarrier<JSC::JSObject> m_globals;
    JSC::WriteBarrier<JSC::JSObject> m_onError;
    JSC::WriteBarrier<JSC::Unknown> m_env;
    JSC::WriteBarrier<JSC::JSPromise> m_closing;
    // Under cellLock(): read by the collector.
    HashMap<String, JSDurableObjectActor*> m_actors;

    String m_name;
    String m_modulePath;
    String m_exportName;
    String m_storageDirectory;
    std::array<uint8_t, 32> m_key;
    double m_idleTimeoutMs { 10'000 };
    std::unique_ptr<DurableObjectAlarmIndex> m_index;
    // Loaded objects that had nothing to do when they were put here, oldest first. Under cellLock().
    Deque<JSDurableObjectActor*> m_idle;
    RunLoop::Timer m_alarmTimer;
    RunLoop::Timer m_sweepTimer;
    double m_alarmTimerAt { 0 };
    JSC::Strong<JSDurableObjectNamespace> m_keepAlive;
    bool m_closed { false };
    bool m_keepsEventLoopAlive { false };
};

JSC::JSCell* createDurableObjectRealm(JSC::VM&, Zig::GlobalObject*);
JSC::JSValue durableObjectConstructor(Zig::GlobalObject*);
JSC::JSValue durableObjectNamespaceConstructor(Zig::GlobalObject*);

// Throws ERR_DURABLE_OBJECT_RESET unless `value` is a handle of `kind` whose object is still in the life it was made in.
JSDurableObjectHandle* toCurrentHandle(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSValue, JSDurableObjectHandle::Kind, ASCIILiteral className, ASCIILiteral method);
JSC::JSObject* createDurableObjectResetError(JSC::JSGlobalObject*);

// DurableObjectStorage.cpp
JSC::JSObject* createDurableObjectStoragePrototype(JSC::VM&, JSC::JSGlobalObject*);
JSC::JSObject* createDurableObjectSqlPrototype(JSC::VM&, JSC::JSGlobalObject*);
JSC::JSObject* createDurableObjectKvPrototype(JSC::VM&, JSC::JSGlobalObject*);
JSC::JSObject* createDurableObjectTransactionPrototype(JSC::VM&, JSC::JSGlobalObject*);
JSC::Structure* createDurableObjectCursorStructure(JSC::VM&, JSC::JSGlobalObject*, bool raw);
JSC_DECLARE_HOST_FUNCTION(jsDurableObjectCommitMicrotask);
// The continuation of storage.transaction(): ends the scope the handle (event.a()) opened.
void finishDurableObjectTransaction(Zig::GlobalObject*, JSDurableObjectEvent*, bool commit);

} // namespace Bun
