#pragma once

#include "root.h"
#include "ScriptExecutionContext.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <wtf/HashMap.h>
#include <wtf/Lock.h>
#include <wtf/Ref.h>
#include <wtf/RefCounted.h>
#include <wtf/RefPtr.h>
#include <wtf/ThreadSafeRefCounted.h>
#include <wtf/Deque.h>

#include <atomic>
#include <cstdint>
#include <string>

extern "C" {
struct sqlite3;
}

namespace WebCore {
class AbortSignal;
class AbortAlgorithm;
class DeferredPromise;
}

namespace Bun {

class AsyncSQLiteConnection;

class AsyncSQLiteConnection final : public WTF::ThreadSafeRefCounted<AsyncSQLiteConnection> {
public:
    enum class State : uint8_t {
        Opening,
        OpenIdle,
        OpenActive,
        ShuttingDown,
        Closed
    };

    AsyncSQLiteConnection(uint32_t, std::string&&, uint32_t, int);

    bool admit(uint64_t, std::string&&);
    void open(uint64_t, uint32_t);
    bool close(uint64_t, uint32_t);
    void abandon();
    bool deliveryEnabled() const;
    State state() const;

    struct Operation {
        uint64_t id;
        std::string sql;
    };

    uint32_t contextId() const { return m_contextId; }
    void runOpen(uint64_t, uint32_t callerThreadUid);
    void runOperation(Operation&&);
    void runClose(uint64_t);

private:
    friend class WTF::ThreadSafeRefCounted<AsyncSQLiteConnection>;
    friend class AsyncSQLiteConnectionJob;

    ~AsyncSQLiteConnection();
    void finishOperation(uint64_t, bool, int, std::string&&);
    void scheduleOperation(Operation&&);
    void scheduleClose();
    void interruptLocked();

    mutable WTF::Lock m_lock;
    State m_state { State::Opening };
    sqlite3* m_database { nullptr };
    sqlite3* m_activeDatabase { nullptr };
    WTF::Deque<Operation> m_queue;
    uint32_t m_contextId;
    std::string m_path;
    uint32_t m_capacity;
    int m_busyTimeout;
    uint64_t m_closeOperationId { 0 };
    bool m_closeRequested { false };
    bool m_closeScheduled { false };
    bool m_deliveryEnabled { true };
};

class AsyncSQLiteTaskState final : public WTF::ThreadSafeRefCounted<AsyncSQLiteTaskState> {
public:
    explicit AsyncSQLiteTaskState(uint64_t operationId)
        : m_operationId(operationId)
    {
    }

    uint64_t operationId() const { return m_operationId; }

    void cancel(bool disableDelivery);
    bool isCancelled() const;
    bool deliveryDisabled() const;
    bool publishActiveDatabase(sqlite3*);
    void clearActiveDatabase(sqlite3*);

private:
    friend class WTF::ThreadSafeRefCounted<AsyncSQLiteTaskState>;
    ~AsyncSQLiteTaskState() = default;

    mutable WTF::Lock m_lock;
    uint64_t m_operationId;
    bool m_cancelled { false };
    bool m_deliveryDisabled { false };
    sqlite3* m_activeDatabase { nullptr };
};

class JSAsyncSQLitePendingRegistry final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    struct PendingRequest {
        WTF::RefPtr<WebCore::DeferredPromise> started;
        WTF::RefPtr<WebCore::DeferredPromise> result;
        WTF::RefPtr<WebCore::AbortSignal> signal;
        uint32_t abortAlgorithmId { 0 };
        WTF::RefPtr<AsyncSQLiteTaskState> state;
        WTF::RefPtr<AsyncSQLiteConnection> connection;
        uint64_t connectionId { 0 };
        bool removeConnection { false };
        bool keepAlive { false };
    };

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue);
    static JSAsyncSQLitePendingRegistry* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell* cell) { static_cast<JSAsyncSQLitePendingRegistry*>(cell)->~JSAsyncSQLitePendingRegistry(); }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    void add(uint64_t, PendingRequest&&);
    void setAbortAlgorithmId(uint64_t, uint32_t);
    void markKeepAlive(uint64_t);
    void resolveStarted(uint64_t, bool, JSC::JSGlobalObject*);
    void complete(uint64_t, int, WebCore::ScriptExecutionContext&);
    void completeConnection(uint64_t, bool, int, std::string&&, WebCore::ScriptExecutionContext&);
    void remove(uint64_t);
    void addConnection(uint64_t, WTF::Ref<AsyncSQLiteConnection>&&);
    WTF::RefPtr<AsyncSQLiteConnection> connection(uint64_t);
    void abandonConnections();
    void abandon(bool unrefEventLoop);

    ~JSAsyncSQLitePendingRegistry();

private:
    JSAsyncSQLitePendingRegistry(JSC::VM&, JSC::Structure*);
    void detachAbortAlgorithm(PendingRequest&);
    void abandonRequest(PendingRequest&, bool unrefEventLoop);

    WTF::HashMap<uint64_t, std::unique_ptr<PendingRequest>> m_requests;
    WTF::HashMap<uint64_t, WTF::Ref<AsyncSQLiteConnection>> m_connections;
};

struct AsyncSQLiteTaskStats {
    int64_t liveJobs;
    int64_t liveResults;
    int64_t liveRequests;
    int64_t liveAbortAlgorithms;
    int64_t postFailures;
    int64_t completionsRun;
    int64_t completionsDropped;
    int64_t liveConnections;
    int64_t activeConnectionOperations;
    int64_t closeJobsRun;
    int64_t physicalCloses;
};

void abandonAsyncSQLiteRequestsForGlobal(JSC::JSGlobalObject*);

JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteTaskForTesting);
JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteTaskStatsForTesting);
JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionOpenForTesting);
JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionExecForTesting);
JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionCloseForTesting);
JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionStatsForTesting);

} // namespace Bun
