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

#include <memory>

#include <atomic>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

extern "C" {
struct sqlite3;
}

namespace WebCore {
class AbortSignal;
class AbortAlgorithm;
class DeferredPromise;
}

namespace Zig {
class GlobalObject;
}

namespace Bun {

class AsyncSQLiteConnection;

// Closed set of the SQLite storage classes a copied result value can hold. The
// worker copies raw SQLite output into these owner-agnostic values; the JS
// thread later materializes them into JS values.
enum class AsyncSQLiteValueKind : uint8_t {
    Null,
    Integer,
    Double,
    Text,
    Blob
};

// A single owned column value. `bytes` owns a private copy of TEXT (UTF-8) or
// BLOB data (embedded NULs preserved); scalar kinds use `integer`/`number`.
struct AsyncSQLiteValue {
    AsyncSQLiteValueKind kind { AsyncSQLiteValueKind::Null };
    int64_t integer { 0 };
    double number { 0 };
    std::string bytes;
};

// Owned result of a statement that produced columns. Column names and every row
// value are copied off the sqlite3_stmt before it is finalized, so the result
// outlives statement and connection teardown.
struct AsyncSQLiteRows {
    // ctor/dtor track live ownership through a private diagnostic counter.
    AsyncSQLiteRows();
    ~AsyncSQLiteRows();
    std::vector<std::string> columns;
    std::vector<std::vector<AsyncSQLiteValue>> rows;
};

// Closed set of connection operation kinds. Exec discards any produced rows
// (Gate B scalar semantics); Query returns owned rows to the JS thread.
enum class AsyncSQLiteOperationKind : uint8_t {
    Exec,
    QueryForTesting,
    Run,
    Get,
    All,
    Values
};

// How a snapshotted binding set is addressed. Positional binds by declared
// index; Named looks each prepared parameter up in the owned key/value map.
enum class AsyncSQLiteBindingKind : uint8_t {
    Positional,
    Named
};

// Owner-agnostic snapshot of one operation's bindings, copied off JS values on
// the JS thread before admission. Reuses AsyncSQLiteValue's closed value set; the
// worker binds these with worker-local sqlite3_bind_* and holds no JS state.
struct AsyncSQLiteBindings {
    AsyncSQLiteBindingKind kind { AsyncSQLiteBindingKind::Positional };
    std::vector<AsyncSQLiteValue> positional;
    // Own std::string keys give O(1) worker lookup with no JS/WTF thread affinity.
    std::unordered_map<std::string, AsyncSQLiteValue> named;
};

// Distinguishes owned operation errors so the owner thread builds the matching
// JS error: Binding failures (count mismatch, strict-missing, sqlite3_bind_*)
// become plain Errors like sync; Execution (prepare/step) stays SQLiteError.
enum class AsyncSQLiteErrorKind : uint8_t {
    Execution,
    Binding
};

// Owned snapshot of a failing operation's authoritative SQLite diagnostics,
// copied on the worker immediately after the failing call, before finalize or a
// later SQLite call can overwrite the per-connection error state.
struct AsyncSQLiteError {
    // ctor/dtor track live ownership through a private diagnostic counter.
    AsyncSQLiteError();
    ~AsyncSQLiteError();
    AsyncSQLiteErrorKind kind { AsyncSQLiteErrorKind::Execution };
    int resultCode { 0 };
    int extendedCode { 0 };
    int byteOffset { -1 };
    std::string message;
};

struct AsyncSQLiteChanges {
    int64_t changes { 0 };
    int64_t lastInsertRowid { 0 };
};

enum class AsyncSQLiteResultKind : uint8_t {
    Empty,
    Changes,
    Rows,
    Error
};

struct AsyncSQLiteOperationResult {
    AsyncSQLiteResultKind kind { AsyncSQLiteResultKind::Empty };
    AsyncSQLiteChanges changes;
    std::unique_ptr<AsyncSQLiteRows> rows;
    std::unique_ptr<AsyncSQLiteError> error;
};

class AsyncSQLiteConnection final : public WTF::ThreadSafeRefCounted<AsyncSQLiteConnection> {
public:
    enum class State : uint8_t {
        Opening,
        OpenIdle,
        OpenActive,
        ShuttingDown,
        Closed
    };

    AsyncSQLiteConnection(uint32_t, std::string&&, uint32_t, int, bool, bool, int);

    bool admit(uint64_t, std::string&&, AsyncSQLiteOperationKind, std::unique_ptr<AsyncSQLiteBindings>&&);
    void open(uint64_t, uint32_t);
    bool close(uint64_t, uint32_t);
    void abandon();
    bool deliveryEnabled() const;
    State state() const;
    // Immutable after open; safe to read on the JS thread during binding snapshot.
    bool safeIntegers() const { return m_safeIntegers; }

    struct Operation {
        uint64_t id;
        std::string sql;
        AsyncSQLiteOperationKind kind { AsyncSQLiteOperationKind::Exec };
        std::unique_ptr<AsyncSQLiteBindings> bindings;
    };

    uint32_t contextId() const { return m_contextId; }
    void runOpen(uint64_t, uint32_t callerThreadUid);
    void runOperation(Operation&&);
    void runClose(uint64_t);
    // Pops/schedules the successor operation (or drives to physical close).
    // Called exactly once per completed operation on the JS thread after its
    // result is released, or on the drop/teardown path (dropped=true).
    void advanceAfterCompletion(bool dropped);

private:
    friend class WTF::ThreadSafeRefCounted<AsyncSQLiteConnection>;
    friend class AsyncSQLiteConnectionJob;

    ~AsyncSQLiteConnection();
    void finishOperation(uint64_t, std::unique_ptr<AsyncSQLiteOperationResult>&&);
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
    // sqlite3_open_v2 read/write/create flags owned per connection; the worker
    // ORs URI and FULLMUTEX before opening. Fixed at open.
    int m_openFlags { 0 };
    // Strict name matching, fixed at open; read by the worker binding path.
    bool m_strict { false };
    // Safe-integer bigint binding, fixed at open; read on the JS snapshot thread.
    bool m_safeIntegers { false };
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
        bool wantsRows { false };
        bool forceMaterializeFailure { false };
        AsyncSQLiteOperationKind operationKind { AsyncSQLiteOperationKind::Exec };
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
    void completeConnectionOperation(uint64_t, AsyncSQLiteConnection&, std::unique_ptr<AsyncSQLiteOperationResult>&&, WebCore::ScriptExecutionContext&);
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
    int64_t deliveryDisabledDrops;
    int64_t activeTaskDatabases;
    int64_t taskInterrupts;
    int64_t liveConnections;
    int64_t activeConnectionOperations;
    int64_t connectionInterrupts;
    int64_t closeJobsRun;
    int64_t physicalCloses;
    int64_t liveRows;
    int64_t liveErrors;
    int64_t copiedRowValues;
};

void abandonAsyncSQLiteRequestsForGlobal(JSC::JSGlobalObject*);

// Factory for the public `AsyncDatabase` native surface, loaded lazily via
// `$cpp()` from src/js/bun/sqlite.ts. Returns an object of host functions
// (open/exec/run/get/all/values/close) so production never imports the
// bun:internal-for-testing bindings.
JSC::JSValue createAsyncSQLiteBinding(Zig::GlobalObject*);

JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteTaskForTesting);
JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteTaskStatsForTesting);
JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionOpenForTesting);
JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionExecForTesting);
JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionQueryForTesting);
JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionRunForTesting);
JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionGetForTesting);
JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionAllForTesting);
JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionValuesForTesting);
JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionCloseForTesting);
JSC_DECLARE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionStatsForTesting);

} // namespace Bun
