#include "root.h"

#include "AsyncSQLiteDatabase.h"
#include "AbortAlgorithm.h"
#include "AbortSignal.h"
#include "BunClientData.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "Exception.h"
#include "JSDOMPromiseDeferred.h"
#include "JSDOMWrapper.h"
#include "JSAbortSignal.h"
#include "JSSQLStatement.h"
#include "ScriptExecutionContext.h"
#include "ZigGlobalObject.h"

#if LAZY_LOAD_SQLITE
#include "lazy_sqlite3.h"
#else
#include "sqlite3_local.h"
static inline int lazyLoadSQLite()
{
    return 0;
}
#endif

#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSBigInt.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/TypedArrayInlines.h>
#include <wtf/Atomics.h>
#include <wtf/Threading.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <memory>

extern "C" void Bun__initializeSQLite();

namespace Bun {

namespace {

JSAsyncSQLitePendingRegistry* registryForGlobal(JSC::JSGlobalObject*);

std::atomic<int64_t> liveJobs { 0 };
std::atomic<int64_t> liveResults { 0 };
std::atomic<int64_t> liveRequests { 0 };
std::atomic<int64_t> liveAbortAlgorithms { 0 };
std::atomic<int64_t> postFailures { 0 };
std::atomic<int64_t> completionsRun { 0 };
std::atomic<int64_t> completionsDropped { 0 };
std::atomic<int64_t> deliveryDisabledDrops { 0 };
std::atomic<int64_t> activeTaskDatabases { 0 };
std::atomic<int64_t> taskInterrupts { 0 };
std::atomic<int64_t> liveConnections { 0 };
std::atomic<int64_t> activeConnectionOperations { 0 };
std::atomic<int64_t> connectionInterrupts { 0 };
std::atomic<int64_t> closeJobsRun { 0 };
std::atomic<int64_t> physicalCloses { 0 };
std::atomic<int64_t> liveRows { 0 };
std::atomic<int64_t> liveErrors { 0 };
std::atomic<int64_t> copiedRowValues { 0 };
std::atomic<uint64_t> nextOperationId { 1 };

class AsyncSQLiteAbortAlgorithm final : public WebCore::AbortAlgorithm {
public:
    explicit AsyncSQLiteAbortAlgorithm(WTF::Ref<AsyncSQLiteTaskState>&& state)
        : WebCore::AbortAlgorithm(nullptr)
        , m_state(WTF::move(state))
    {
        liveAbortAlgorithms.fetch_add(1, std::memory_order_relaxed);
    }

    ~AsyncSQLiteAbortAlgorithm() final
    {
        liveAbortAlgorithms.fetch_sub(1, std::memory_order_relaxed);
    }

    WebCore::CallbackResult<void> handleEvent(JSC::JSValue) final
    {
        m_state->cancel(false);
        return {};
    }

private:
    WTF::Ref<AsyncSQLiteTaskState> m_state;
};

// JS-thread abort algorithm for a per-connection operation. It owns only the
// operation ID; when the signal aborts it routes to the pending registry, which
// resolves the connection and cancels the exact operation under its lock.
class AsyncSQLiteConnectionAbortAlgorithm final : public WebCore::AbortAlgorithm {
public:
    AsyncSQLiteConnectionAbortAlgorithm(WebCore::ScriptExecutionContext* context, uint64_t operationId)
        : WebCore::AbortAlgorithm(context)
        , m_operationId(operationId)
    {
        liveAbortAlgorithms.fetch_add(1, std::memory_order_relaxed);
    }

    ~AsyncSQLiteConnectionAbortAlgorithm() final
    {
        liveAbortAlgorithms.fetch_sub(1, std::memory_order_relaxed);
    }

    WebCore::CallbackResult<void> handleEvent(JSC::JSValue) final
    {
        auto* context = scriptExecutionContext();
        if (!context)
            return {};
        if (auto* registry = registryForGlobal(context->globalObject()))
            registry->cancelConnectionOperation(m_operationId, *context);
        return {};
    }

private:
    uint64_t m_operationId;
};

struct AsyncSQLiteNativeResult {
    explicit AsyncSQLiteNativeResult(int value)
        : value(value)
    {
        liveResults.fetch_add(1, std::memory_order_relaxed);
    }

    ~AsyncSQLiteNativeResult()
    {
        liveResults.fetch_sub(1, std::memory_order_relaxed);
    }

    int value;
    bool success { true };
    int errorCode { SQLITE_ERROR };
    std::string errorMessage;
};

struct CompletionCapture {
    explicit CompletionCapture(std::unique_ptr<AsyncSQLiteNativeResult>&& result)
        : result(WTF::move(result))
    {
    }

    ~CompletionCapture()
    {
        if (!ran)
            completionsDropped.fetch_add(1, std::memory_order_relaxed);
    }

    std::unique_ptr<AsyncSQLiteNativeResult> result;
    bool ran { false };
};

struct ConnectionCompletionCapture {
    ConnectionCompletionCapture(WTF::Ref<AsyncSQLiteConnection>&& connection, std::unique_ptr<AsyncSQLiteNativeResult>&& result)
        : connection(WTF::move(connection))
        , result(WTF::move(result))
    {
    }

    ~ConnectionCompletionCapture()
    {
        if (!ran) {
            completionsDropped.fetch_add(1, std::memory_order_relaxed);
            connection->abandon();
        }
    }

    WTF::Ref<AsyncSQLiteConnection> connection;
    std::unique_ptr<AsyncSQLiteNativeResult> result;
    bool ran { false };
};

struct ConnectionOperationCompletion {
    ConnectionOperationCompletion(WTF::Ref<AsyncSQLiteConnection>&& connection, std::unique_ptr<AsyncSQLiteOperationResult>&& result)
        : connection(WTF::move(connection))
        , result(WTF::move(result))
    {
    }

    ~ConnectionOperationCompletion()
    {
        if (!ran) {
            completionsDropped.fetch_add(1, std::memory_order_relaxed);
            connection->advanceAfterCompletion(true);
        }
    }

    WTF::Ref<AsyncSQLiteConnection> connection;
    std::unique_ptr<AsyncSQLiteOperationResult> result;
    bool ran { false };
};

class AsyncSQLiteConnectionJob;

class AsyncSQLiteJobBase {
public:
    // The Rust OwnedTask bridge carries this opaque pointer; every allocation
    // submitted here is one of these native-only polymorphic jobs.
    virtual ~AsyncSQLiteJobBase() = default;
    virtual void run() noexcept = 0;
};

extern "C" void AsyncSQLiteTask__schedule(AsyncSQLiteJobBase*);

static void postConnectionStarted(uint32_t contextId, uint64_t operationId, bool offThread, AsyncSQLiteConnection& connection)
{
    if (!connection.deliveryEnabled())
        return;
    bool posted = WebCore::ScriptExecutionContext::postTaskTo(contextId, [operationId, offThread](WebCore::ScriptExecutionContext& context) {
        if (auto* registry = registryForGlobal(context.globalObject()))
            registry->resolveStarted(operationId, offThread, context.globalObject());
    });
    if (!posted) {
        postFailures.fetch_add(1, std::memory_order_relaxed);
        connection.abandon();
    }
}

static void postConnectionCompletion(uint32_t contextId, uint64_t operationId, AsyncSQLiteConnection& connection, std::unique_ptr<AsyncSQLiteNativeResult>&& result)
{
    if (!connection.deliveryEnabled()) {
        deliveryDisabledDrops.fetch_add(1, std::memory_order_relaxed);
        return;
    }
    auto completion = std::make_unique<ConnectionCompletionCapture>(WTF::Ref { connection }, WTF::move(result));
    bool posted = WebCore::ScriptExecutionContext::postTaskTo(contextId, [operationId, completion = WTF::move(completion)](WebCore::ScriptExecutionContext& context) mutable {
        completion->ran = true;
        completionsRun.fetch_add(1, std::memory_order_relaxed);
        if (auto* registry = registryForGlobal(context.globalObject())) {
            auto result = WTF::move(completion->result);
            registry->completeConnection(operationId, result->success, result->errorCode, WTF::move(result->errorMessage), context);
        }
    });
    if (!posted)
        postFailures.fetch_add(1, std::memory_order_relaxed);
}

static void postConnectionOperationCompletion(uint32_t contextId, uint64_t operationId, AsyncSQLiteConnection& connection, std::unique_ptr<AsyncSQLiteOperationResult>&& result)
{
    if (!connection.deliveryEnabled()) {
        deliveryDisabledDrops.fetch_add(1, std::memory_order_relaxed);
        // No JS completion will run, so advance the FIFO to physical close here.
        connection.advanceAfterCompletion(true);
        return;
    }
    auto completion = std::make_unique<ConnectionOperationCompletion>(WTF::Ref { connection }, WTF::move(result));
    bool posted = WebCore::ScriptExecutionContext::postTaskTo(contextId, [operationId, completion = WTF::move(completion)](WebCore::ScriptExecutionContext& context) mutable {
        completion->ran = true;
        completionsRun.fetch_add(1, std::memory_order_relaxed);
        auto* registry = registryForGlobal(context.globalObject());
        if (registry) {
            registry->completeConnectionOperation(operationId, completion->connection.get(), WTF::move(completion->result), context);
        } else {
            // No registry means no request to settle; still advance the FIFO.
            completion->connection->advanceAfterCompletion(false);
        }
    });
    if (!posted)
        postFailures.fetch_add(1, std::memory_order_relaxed);
}

class AsyncSQLiteConnectionJob final : public AsyncSQLiteJobBase {
public:
    enum class Kind : uint8_t {
        Open,
        Operation,
        Close
    };

    AsyncSQLiteConnectionJob(WTF::Ref<AsyncSQLiteConnection>&& connection, Kind kind, uint64_t operationId, uint32_t callerThreadUid)
        : connection(WTF::move(connection))
        , kind(kind)
        , operationId(operationId)
        , callerThreadUid(callerThreadUid)
    {
        liveJobs.fetch_add(1, std::memory_order_relaxed);
    }

    AsyncSQLiteConnectionJob(WTF::Ref<AsyncSQLiteConnection>&& connection, uint64_t operationId, uint32_t callerThreadUid, AsyncSQLiteConnection::Operation&& operation)
        : connection(WTF::move(connection))
        , kind(Kind::Operation)
        , operationId(operationId)
        , callerThreadUid(callerThreadUid)
        , operation(WTF::move(operation))
    {
        liveJobs.fetch_add(1, std::memory_order_relaxed);
    }

    ~AsyncSQLiteConnectionJob()
    {
        liveJobs.fetch_sub(1, std::memory_order_relaxed);
    }

    void run() noexcept final
    {
        if (kind == Kind::Open)
            connection->runOpen(operationId, callerThreadUid);
        else if (kind == Kind::Operation)
            connection->runOperation(WTF::move(operation));
        else
            connection->runClose(operationId);
    }

private:
    WTF::Ref<AsyncSQLiteConnection> connection;
    Kind kind;
    uint64_t operationId;
    uint32_t callerThreadUid;
    AsyncSQLiteConnection::Operation operation { 0, {} };
};

class AsyncSQLiteNativeJob final : public AsyncSQLiteJobBase {
public:
    AsyncSQLiteNativeJob(uint32_t contextId, uint64_t operationId, uint32_t callerThreadUid, std::string&& path, WTF::Ref<AsyncSQLiteTaskState>&& state)
        : contextId(contextId)
        , operationId(operationId)
        , callerThreadUid(callerThreadUid)
        , path(WTF::move(path))
        , state(WTF::move(state))
    {
        liveJobs.fetch_add(1, std::memory_order_relaxed);
    }

    ~AsyncSQLiteNativeJob()
    {
        liveJobs.fetch_sub(1, std::memory_order_relaxed);
    }

    void run() noexcept final;

    uint32_t contextId;
    uint64_t operationId;
    uint32_t callerThreadUid;
    std::string path;
    WTF::Ref<AsyncSQLiteTaskState> state;
};

} // namespace

// Owned-payload lifetime counters: ctor/dtor bump these so drop/leak assertions
// over the private stats surface are non-vacuous. Live counters return to
// baseline once every owned result/error is released.
AsyncSQLiteRows::AsyncSQLiteRows() { liveRows.fetch_add(1, std::memory_order_relaxed); }
AsyncSQLiteRows::~AsyncSQLiteRows() { liveRows.fetch_sub(1, std::memory_order_relaxed); }
AsyncSQLiteError::AsyncSQLiteError() { liveErrors.fetch_add(1, std::memory_order_relaxed); }
AsyncSQLiteError::~AsyncSQLiteError() { liveErrors.fetch_sub(1, std::memory_order_relaxed); }

static void scheduleConnectionJob(std::unique_ptr<AsyncSQLiteConnectionJob>&& job)
{
    AsyncSQLiteTask__schedule(static_cast<AsyncSQLiteJobBase*>(job.release()));
}

AsyncSQLiteConnection::AsyncSQLiteConnection(uint32_t contextId, std::string&& path, uint32_t capacity, int busyTimeout, bool strict, bool safeIntegers, int openFlags)
    : m_contextId(contextId)
    , m_path(WTF::move(path))
    , m_capacity(std::max(1u, capacity))
    , m_busyTimeout(std::max(0, busyTimeout))
    , m_openFlags(openFlags)
    , m_strict(strict)
    , m_safeIntegers(safeIntegers)
{
    liveConnections.fetch_add(1, std::memory_order_relaxed);
}

AsyncSQLiteConnection::~AsyncSQLiteConnection()
{
    liveConnections.fetch_sub(1, std::memory_order_relaxed);
}

bool AsyncSQLiteConnection::deliveryEnabled() const
{
    WTF::Locker locker { m_lock };
    return m_deliveryEnabled;
}

AsyncSQLiteConnection::State AsyncSQLiteConnection::state() const
{
    WTF::Locker locker { m_lock };
    return m_state;
}

void AsyncSQLiteConnection::open(uint64_t operationId, uint32_t callerThreadUid)
{
    scheduleConnectionJob(std::make_unique<AsyncSQLiteConnectionJob>(WTF::Ref { *this }, AsyncSQLiteConnectionJob::Kind::Open, operationId, callerThreadUid));
}

bool AsyncSQLiteConnection::admit(uint64_t operationId, std::string&& sql, AsyncSQLiteOperationKind kind, std::unique_ptr<AsyncSQLiteBindings>&& bindings)
{
    bool schedule = false;
    Operation operation { 0, {}, AsyncSQLiteOperationKind::Exec, nullptr };
    {
        WTF::Locker locker { m_lock };
        if (!m_deliveryEnabled || m_closeRequested || m_state == State::Closed || m_state == State::ShuttingDown)
            return false;
        if (m_queue.size() + (m_state == State::OpenActive ? 1u : 0u) >= m_capacity)
            return false;
        m_queue.append({ operationId, WTF::move(sql), kind, WTF::move(bindings) });
        schedule = m_state == State::OpenIdle;
        if (schedule) {
            m_state = State::OpenActive;
            operation = m_queue.takeFirst();
            m_activeOperationId = operation.id;
            m_activeCancelRequested = false;
        }
    }
    if (schedule)
        scheduleOperation(WTF::move(operation));
    return true;
}

bool AsyncSQLiteConnection::close(uint64_t operationId, uint32_t callerThreadUid)
{
    bool schedule = false;
    {
        WTF::Locker locker { m_lock };
        if (m_state == State::Closed || m_closeRequested)
            return false;
        auto previousState = m_state;
        m_closeRequested = true;
        m_closeOperationId = operationId;
        m_state = State::ShuttingDown;
        schedule = previousState == State::OpenIdle && m_queue.isEmpty();
    }
    if (schedule)
        scheduleClose();
    UNUSED_PARAM(callerThreadUid);
    return true;
}

void AsyncSQLiteConnection::scheduleOperation(Operation&& operation)
{
    scheduleConnectionJob(std::make_unique<AsyncSQLiteConnectionJob>(WTF::Ref { *this }, operation.id, static_cast<uint32_t>(WTF::Thread::currentSingleton().uid()), WTF::move(operation)));
}

void AsyncSQLiteConnection::scheduleClose()
{
    uint64_t operationId;
    {
        WTF::Locker locker { m_lock };
        if (m_closeScheduled)
            return;
        m_closeScheduled = true;
        operationId = m_closeOperationId;
    }
    scheduleConnectionJob(std::make_unique<AsyncSQLiteConnectionJob>(WTF::Ref { *this }, AsyncSQLiteConnectionJob::Kind::Close, operationId, static_cast<uint32_t>(WTF::Thread::currentSingleton().uid())));
}

void AsyncSQLiteConnection::interruptLocked()
{
    if (m_activeDatabase) {
        sqlite3_interrupt(m_activeDatabase);
        connectionInterrupts.fetch_add(1, std::memory_order_relaxed);
    }
}

int AsyncSQLiteConnection::busyHandler(void* ptr, int count)
{
    auto* self = static_cast<AsyncSQLiteConnection*>(ptr);
    // An interrupted op must not keep sleeping: yield so the step loop surfaces
    // the abort instead of blocking for the remaining busy timeout.
    if (self->m_activeInterruptRequested.load(std::memory_order_relaxed))
        return 0;
    // Emulate sqlite3_busy_timeout's escalating backoff, capped by the timeout.
    static const int delays[] = { 1, 2, 5, 10, 15, 20, 25, 25, 25, 50, 50, 100 };
    static const int totals[] = { 0, 1, 3, 8, 18, 33, 53, 78, 103, 128, 178, 228 };
    constexpr int ndelay = static_cast<int>(sizeof(delays) / sizeof(delays[0]));
    int tmout = self->m_busyTimeout;
    if (tmout <= 0)
        return 0;
    int delay = 0;
    int prior = 0;
    if (count < ndelay) {
        delay = delays[count];
        prior = totals[count];
    } else {
        delay = delays[ndelay - 1];
        prior = totals[ndelay - 1] + delay * (count - (ndelay - 1));
    }
    if (prior + delay > tmout) {
        delay = tmout - prior;
        if (delay <= 0)
            return 0;
    }
    sqlite3_sleep(delay);
    return 1;
}

AsyncSQLiteConnection::CancelOutcome AsyncSQLiteConnection::cancelOperation(uint64_t operationId)
{
    WTF::Locker locker { m_lock };
    // Queued target: erase by exact ID, releasing its capacity slot. This never
    // enters SQLite and no native completion will ever arrive for it.
    if (m_queue.removeFirstMatching([operationId](const Operation& operation) { return operation.id == operationId; }))
        return CancelOutcome::RemovedFromQueue;
    // Active target: mark it, and interrupt only while this exact op still owns
    // the active slot and the connection is open (a running statement exists and
    // the db cannot be closed underneath us because close is serialized here).
    if (operationId != 0 && operationId == m_activeOperationId) {
        m_activeCancelRequested = true;
        if (m_activeDatabase && m_state != State::Closed) {
            m_activeInterruptRequested.store(true, std::memory_order_relaxed);
            sqlite3_interrupt(m_activeDatabase);
            connectionInterrupts.fetch_add(1, std::memory_order_relaxed);
        }
        return CancelOutcome::Interrupted;
    }
    return CancelOutcome::NotFound;
}

void AsyncSQLiteConnection::abandon()
{
    bool schedule = false;
    {
        WTF::Locker locker { m_lock };
        if (!m_deliveryEnabled)
            return;
        if (m_state == State::Closed) {
            m_deliveryEnabled = false;
            return;
        }
        auto previousState = m_state;
        m_deliveryEnabled = false;
        m_closeRequested = true;
        m_queue.clear();
        m_state = State::ShuttingDown;
        interruptLocked();
        schedule = previousState == State::OpenIdle;
    }
    if (schedule)
        scheduleClose();
}

static std::unique_ptr<AsyncSQLiteNativeResult> connectionResult(bool success, int errorCode = SQLITE_OK, std::string&& message = {})
{
    auto result = std::make_unique<AsyncSQLiteNativeResult>(success ? 1 : 0);
    result->success = success;
    result->errorCode = errorCode;
    result->errorMessage = WTF::move(message);
    return result;
}

void AsyncSQLiteConnection::runOpen(uint64_t operationId, uint32_t callerThreadUid)
{
    Bun__initializeSQLite();
    auto result = connectionResult(false);
    sqlite3* database = nullptr;
    if (sqlite3_threadsafe() == 0) {
        result = connectionResult(false, SQLITE_MISUSE, "SQLite library is not thread-safe");
    } else {
        int rc = sqlite3_open_v2(m_path.c_str(), &database, m_openFlags | SQLITE_OPEN_URI | SQLITE_OPEN_FULLMUTEX, nullptr);
        if (rc != SQLITE_OK || !database) {
            int code = rc;
            std::string message = database && sqlite3_errmsg(database) ? sqlite3_errmsg(database) : sqlite3_errstr(rc);
            if (database)
                sqlite3_close(database);
            result = connectionResult(false, code, WTF::move(message));
        } else if (int rc = sqlite3_extended_result_codes(database, 1); rc != SQLITE_OK) {
            int code = rc;
            std::string message = sqlite3_errstr(rc);
            sqlite3_close(database);
            result = connectionResult(false, code, WTF::move(message));
        } else if (int rc = sqlite3_busy_timeout(database, m_busyTimeout); rc != SQLITE_OK) {
            int code = rc;
            std::string message = sqlite3_errstr(rc);
            sqlite3_close(database);
            result = connectionResult(false, code, WTF::move(message));
        } else {
            sqlite3_db_config(database, SQLITE_DBCONFIG_DEFENSIVE, 1, nullptr);
            // Override the default busy callback so a contended-lock wait can be
            // interrupted by an AbortSignal rather than blocking for the timeout.
            sqlite3_busy_handler(database, &AsyncSQLiteConnection::busyHandler, this);
            result = connectionResult(true);
        }
    }

    bool scheduleCloseAfterOpen = false;
    bool scheduleOperationAfterOpen = false;
    Operation operation { 0, {} };
    WTF::Vector<uint64_t> rejectedOperations;
    if (!result->success) {
        WTF::Locker locker { m_lock };
        m_state = State::Closed;
        m_closeRequested = true;
        scheduleCloseAfterOpen = m_closeOperationId != 0;
        while (!m_queue.isEmpty())
            rejectedOperations.append(m_queue.takeFirst().id);
    } else {
        WTF::Locker locker { m_lock };
        m_database = database;
        if (m_closeRequested && m_queue.isEmpty()) {
            m_state = State::ShuttingDown;
            scheduleCloseAfterOpen = true;
        } else if (!m_queue.isEmpty()) {
            m_state = State::OpenActive;
            operation = m_queue.takeFirst();
            m_activeOperationId = operation.id;
            m_activeCancelRequested = false;
            scheduleOperationAfterOpen = true;
        } else {
            m_state = State::OpenIdle;
        }
    }
    if (result->success) {
        bool offThread = static_cast<uint32_t>(WTF::Thread::currentSingleton().uid()) != callerThreadUid;
        postConnectionStarted(m_contextId, operationId, offThread, *this);
    }
    postConnectionCompletion(m_contextId, operationId, *this, WTF::move(result));
    for (auto rejectedOperation : rejectedOperations)
        postConnectionCompletion(m_contextId, rejectedOperation, *this, connectionResult(false, SQLITE_CANTOPEN, "connection open failed"));
    if (scheduleCloseAfterOpen)
        scheduleClose();
    else if (scheduleOperationAfterOpen)
        scheduleOperation(WTF::move(operation));
}

namespace {

// Copies a single column value off the sqlite3_stmt into an owner-agnostic
// AsyncSQLiteValue so it survives sqlite3_finalize(). Byte length then pointer
// order matches the synchronous bun:sqlite conversion in JSSQLStatement.cpp.
AsyncSQLiteValue copyColumnValue(sqlite3_stmt* statement, int column)
{
#if ASSERT_ENABLED
    // Debug-only ownership accounting; release async rows pay no diagnostic cost.
    copiedRowValues.fetch_add(1, std::memory_order_relaxed);
#endif
    AsyncSQLiteValue value;
    switch (sqlite3_column_type(statement, column)) {
    case SQLITE_INTEGER:
        value.kind = AsyncSQLiteValueKind::Integer;
        value.integer = sqlite3_column_int64(statement, column);
        break;
    case SQLITE_FLOAT:
        value.kind = AsyncSQLiteValueKind::Double;
        value.number = sqlite3_column_double(statement, column);
        break;
    case SQLITE3_TEXT: {
        value.kind = AsyncSQLiteValueKind::Text;
        int len = sqlite3_column_bytes(statement, column);
        const unsigned char* text = len > 0 ? sqlite3_column_text(statement, column) : nullptr;
        if (text && len > 0)
            value.bytes.assign(reinterpret_cast<const char*>(text), static_cast<size_t>(len));
        break;
    }
    case SQLITE_BLOB: {
        value.kind = AsyncSQLiteValueKind::Blob;
        int len = sqlite3_column_bytes(statement, column);
        const void* blob = len > 0 ? sqlite3_column_blob(statement, column) : nullptr;
        if (blob && len > 0)
            value.bytes.assign(static_cast<const char*>(blob), static_cast<size_t>(len));
        break;
    }
    case SQLITE_NULL:
    default:
        value.kind = AsyncSQLiteValueKind::Null;
        break;
    }
    return value;
}

// Snapshots the connection's authoritative error into an owned AsyncSQLiteError.
// Must run on the worker immediately after the failing call, before finalize or
// any later SQLite call overwrites the per-connection error state.
static std::unique_ptr<AsyncSQLiteError> captureConnectionError(sqlite3* database, int resultCode)
{
    auto error = std::make_unique<AsyncSQLiteError>();
    error->resultCode = resultCode;
    if (database) {
        error->extendedCode = sqlite3_extended_errcode(database);
        error->byteOffset = sqlite3_error_offset(database);
        if (const char* message = sqlite3_errmsg(database))
            error->message.assign(message);
    } else {
        error->extendedCode = resultCode;
        error->byteOffset = -1;
        error->message = "connection is not open";
    }
    return error;
}

// Binds one owned value onto the prepared statement with a worker-local
// sqlite3_bind_*. Payloads are copied (SQLITE_TRANSIENT); the owned bytes are
// independent of any JS lifetime. Returns the sqlite result code.
static int bindOwnedValue(sqlite3_stmt* statement, int index, const AsyncSQLiteValue& value)
{
    switch (value.kind) {
    case AsyncSQLiteValueKind::Null:
        return sqlite3_bind_null(statement, index);
    case AsyncSQLiteValueKind::Integer:
        return sqlite3_bind_int64(statement, index, value.integer);
    case AsyncSQLiteValueKind::Double:
        return sqlite3_bind_double(statement, index, value.number);
    case AsyncSQLiteValueKind::Text:
        return sqlite3_bind_text64(statement, index, value.bytes.data(), static_cast<sqlite3_uint64>(value.bytes.size()), SQLITE_TRANSIENT, SQLITE_UTF8);
    case AsyncSQLiteValueKind::Blob:
        return sqlite3_bind_blob64(statement, index, value.bytes.data(), static_cast<sqlite3_uint64>(value.bytes.size()), SQLITE_TRANSIENT);
    }
    return SQLITE_OK;
}

// Resolves the owned value for one prepared named/positional parameter, matching
// sync bun:sqlite: nameless (`?`) and strict out-of-order numeric names map to a
// declared index key; otherwise strict strips the prefix and non-strict keeps it.
static const AsyncSQLiteValue* resolveNamedBinding(const AsyncSQLiteBindings& bindings, const char* name, int index, bool strict)
{
    std::string key;
    if (!name) {
        key = std::to_string(index);
    } else {
        const char* stripped = (strict && name[0] != '\0') ? name + 1 : name;
        if (strict && stripped[0] >= '0' && stripped[0] <= '9') {
            char* endptr = nullptr;
            long ordinal = std::strtol(stripped, &endptr, 10);
            key = (endptr && *endptr == '\0' && ordinal >= 1) ? std::to_string(ordinal - 1) : std::string(stripped);
        } else {
            key = stripped;
        }
    }
    auto it = bindings.named.find(key);
    return it != bindings.named.end() ? &it->second : nullptr;
}

// Applies the owned binding snapshot to one prepared statement. On any bind
// failure or unsatisfied strict parameter it snapshots a complete
// AsyncSQLiteError before returning so the caller can finalize.
static bool bindStatementValues(sqlite3* database, sqlite3_stmt* statement, const AsyncSQLiteBindings& bindings, bool strict, std::unique_ptr<AsyncSQLiteError>& errorOut)
{
    int count = sqlite3_bind_parameter_count(statement);
    if (bindings.kind == AsyncSQLiteBindingKind::Positional) {
        if (static_cast<int>(bindings.positional.size()) != count) {
            auto error = std::make_unique<AsyncSQLiteError>();
            error->kind = AsyncSQLiteErrorKind::Binding;
            error->resultCode = SQLITE_RANGE;
            error->extendedCode = SQLITE_RANGE;
            error->message = std::string("SQLite query expected ") + std::to_string(count) + " values, received " + std::to_string(bindings.positional.size());
            errorOut = WTF::move(error);
            return false;
        }
        for (int i = 0; i < count; i++) {
            int rc = bindOwnedValue(statement, i + 1, bindings.positional[i]);
            if (rc != SQLITE_OK) {
                errorOut = captureConnectionError(database, rc);
                errorOut->kind = AsyncSQLiteErrorKind::Binding;
                return false;
            }
        }
        return true;
    }

    for (int i = 1; i <= count; i++) {
        const char* name = sqlite3_bind_parameter_name(statement, i);
        const AsyncSQLiteValue* value = resolveNamedBinding(bindings, name, i - 1, strict);
        if (!value) {
            if (strict) {
                auto error = std::make_unique<AsyncSQLiteError>();
                error->kind = AsyncSQLiteErrorKind::Binding;
                error->resultCode = SQLITE_ERROR;
                error->extendedCode = SQLITE_ERROR;
                WTF::String label = name ? WTF::String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const unsigned char*>(name + 1), strlen(name + 1) }) : WTF::String::number(i);
                auto labelUTF8 = label.utf8();
                error->message = std::string("Missing parameter \"") + std::string(labelUTF8.data(), labelUTF8.length()) + "\"";
                errorOut = WTF::move(error);
                return false;
            }
            continue; // Non-strict leaves an unmatched parameter as NULL.
        }
        int rc = bindOwnedValue(statement, i, *value);
        if (rc != SQLITE_OK) {
            errorOut = captureConnectionError(database, rc);
            errorOut->kind = AsyncSQLiteErrorKind::Binding;
            return false;
        }
    }
    return true;
}

static std::unique_ptr<AsyncSQLiteOperationResult> operationError(std::unique_ptr<AsyncSQLiteError>&& error)
{
    auto result = std::make_unique<AsyncSQLiteOperationResult>();
    result->kind = AsyncSQLiteResultKind::Error;
    result->error = WTF::move(error);
    return result;
}

static std::unique_ptr<AsyncSQLiteOperationResult> emptyOperationResult()
{
    return std::make_unique<AsyncSQLiteOperationResult>();
}

static std::unique_ptr<AsyncSQLiteError> validateSingleStatement(sqlite3* database, const std::string& sql)
{
    const char* cursor = sql.c_str();
    const char* end = cursor + sql.size();
    bool sawStatement = false;
    while (cursor < end) {
        sqlite3_stmt* statement = nullptr;
        const char* tail = nullptr;
        int rc = sqlite3_prepare_v3(database, cursor, static_cast<int>(end - cursor), 0, &statement, &tail);
        if (rc != SQLITE_OK)
            return captureConnectionError(database, rc);
        const char* next = tail ? tail : end;
        if (!statement) {
            if (next == cursor)
                break;
            cursor = next;
            continue;
        }
        sqlite3_finalize(statement);
        if (sawStatement) {
            auto error = std::make_unique<AsyncSQLiteError>();
            error->resultCode = SQLITE_MISUSE;
            error->extendedCode = SQLITE_MISUSE;
            error->message = "async SQLite operation accepts exactly one executable statement";
            return error;
        }
        sawStatement = true;
        cursor = next;
    }
    if (!sawStatement) {
        auto error = std::make_unique<AsyncSQLiteError>();
        error->resultCode = SQLITE_MISUSE;
        error->extendedCode = SQLITE_MISUSE;
        error->message = "async SQLite operation requires an executable statement";
        return error;
    }
    return nullptr;
}

static std::unique_ptr<AsyncSQLiteOperationResult> runOperationSQL(sqlite3* database, const AsyncSQLiteConnection::Operation& operation, bool strict, std::atomic<bool>& interruptRequested)
{
    if (!database) {
        return operationError(captureConnectionError(nullptr, SQLITE_MISUSE));
    }

    bool singleStatement = operation.kind == AsyncSQLiteOperationKind::Get || operation.kind == AsyncSQLiteOperationKind::All || operation.kind == AsyncSQLiteOperationKind::Values;
    if (singleStatement) {
        if (auto error = validateSingleStatement(database, operation.sql))
            return operationError(WTF::move(error));
    }

    bool collectRows = operation.kind == AsyncSQLiteOperationKind::QueryForTesting || singleStatement;
    const char* cursor = operation.sql.c_str();
    const char* end = cursor + operation.sql.size();
    int rc = SQLITE_OK;
    bool bindingsApplied = false;
    bool sawStatement = false;
    int64_t totalChangesBefore = operation.kind == AsyncSQLiteOperationKind::Run ? sqlite3_total_changes64(database) : 0;
    auto result = emptyOperationResult();
    while (cursor < end) {
        sqlite3_stmt* statement = nullptr;
        const char* tail = nullptr;
        rc = sqlite3_prepare_v3(database, cursor, static_cast<int>(end - cursor), 0, &statement, &tail);
        if (rc != SQLITE_OK) {
            return operationError(captureConnectionError(database, rc));
        }
        if (!statement) {
            const char* next = tail ? tail : end;
            if (next == cursor)
                break;
            cursor = next;
            continue;
        }
        sawStatement = true;
        std::unique_ptr<sqlite3_stmt, decltype(&sqlite3_finalize)> finalizedStatement(statement, sqlite3_finalize);

        if (operation.bindings && !bindingsApplied) {
            bindingsApplied = true;
            std::unique_ptr<AsyncSQLiteError> error;
            if (!bindStatementValues(database, statement, *operation.bindings, strict, error)) {
                return operationError(WTF::move(error));
            }
        }

        int columnCount = sqlite3_column_count(statement);
        std::unique_ptr<AsyncSQLiteRows> statementRows;
        if (collectRows && columnCount > 0) {
            statementRows = std::make_unique<AsyncSQLiteRows>();
            statementRows->columns.reserve(static_cast<size_t>(columnCount));
            for (int c = 0; c < columnCount; c++) {
                const char* name = sqlite3_column_name(statement, c);
                statementRows->columns.emplace_back(name ? name : "");
            }
        }

        for (;;) {
            int stepRc = sqlite3_step(statement);
            if (stepRc == SQLITE_ROW) {
                if (statementRows) {
                    std::vector<AsyncSQLiteValue> row;
                    row.reserve(static_cast<size_t>(columnCount));
                    for (int c = 0; c < columnCount; c++)
                        row.push_back(copyColumnValue(statement, c));
                    statementRows->rows.push_back(WTF::move(row));
                }
                if (operation.kind == AsyncSQLiteOperationKind::Get) {
                    rc = SQLITE_OK;
                    break;
                }
                continue;
            }
            if (stepRc == SQLITE_DONE) {
                rc = SQLITE_OK;
                break;
            }
            rc = stepRc;
            // A busy wait broken by our interrupt handler surfaces as SQLITE_BUSY;
            // when this op was interrupted, report it as an interrupt so the
            // completion converts it to the signal's abort reason.
            if (rc == SQLITE_BUSY && interruptRequested.load(std::memory_order_relaxed)) {
                auto error = std::make_unique<AsyncSQLiteError>();
                error->resultCode = SQLITE_INTERRUPT;
                error->extendedCode = SQLITE_INTERRUPT;
                error->message = "async SQLite operation was aborted";
                return operationError(WTF::move(error));
            }
            auto error = captureConnectionError(database, rc);
            return operationError(WTF::move(error));
        }

        if (statementRows)
            result->rows = WTF::move(statementRows);
        cursor = tail ? tail : end;
    }

    if (!sawStatement)
        return operationError(validateSingleStatement(database, operation.sql));
    if (operation.kind == AsyncSQLiteOperationKind::Run) {
        result->kind = AsyncSQLiteResultKind::Changes;
        result->changes.changes = sqlite3_total_changes64(database) - totalChangesBefore;
        result->changes.lastInsertRowid = sqlite3_last_insert_rowid(database);
    } else if (collectRows) {
        result->kind = AsyncSQLiteResultKind::Rows;
        if (!result->rows)
            result->rows = std::make_unique<AsyncSQLiteRows>();
    }
    return result;
}

} // namespace

void AsyncSQLiteConnection::runOperation(Operation&& operation)
{
    sqlite3* database = nullptr;
    bool execute = false;
    bool strict = false;
    bool cancelled = false;
    {
        WTF::Locker locker { m_lock };
        database = m_database;
        strict = m_strict;
        // A cancel that landed before we began stepping is honored here: refuse
        // to enter SQLite and report SQLITE_INTERRUPT like an interrupted step.
        cancelled = m_activeCancelRequested;
        if (m_deliveryEnabled && !cancelled) {
            m_activeDatabase = database;
            // Clear any stale interrupt request from a prior op before this one
            // may begin waiting on a contended lock.
            m_activeInterruptRequested.store(false, std::memory_order_relaxed);
            activeConnectionOperations.fetch_add(1, std::memory_order_relaxed);
            execute = true;
        }
    }
    if (!execute) {
        auto error = std::make_unique<AsyncSQLiteError>();
        error->resultCode = SQLITE_INTERRUPT;
        error->extendedCode = SQLITE_INTERRUPT;
        error->message = cancelled ? "async SQLite operation was aborted" : "connection was abandoned";
        {
            WTF::Locker locker { m_lock };
            m_activeOperationId = 0;
            m_activeCancelRequested = false;
        }
        finishOperation(operation.id, operationError(WTF::move(error)));
        return;
    }

    auto result = runOperationSQL(database, operation, strict, m_activeInterruptRequested);

    {
        WTF::Locker locker { m_lock };
        // The statement is finalized; clear the interrupt target and active
        // identity so a late abort for this op resolves to NotFound.
        m_activeDatabase = nullptr;
        m_activeOperationId = 0;
        m_activeCancelRequested = false;
        m_activeInterruptRequested.store(false, std::memory_order_relaxed);
    }
    activeConnectionOperations.fetch_sub(1, std::memory_order_relaxed);

    finishOperation(operation.id, WTF::move(result));
}

void AsyncSQLiteConnection::finishOperation(uint64_t operationId, std::unique_ptr<AsyncSQLiteOperationResult>&& result)
{
    // Post the owned result. Successor scheduling / physical close is deferred to
    // advanceAfterCompletion(), driven by the JS thread once this result has been
    // materialized and released (or by the drop path on teardown).
    postConnectionOperationCompletion(m_contextId, operationId, *this, WTF::move(result));
}

void AsyncSQLiteConnection::advanceAfterCompletion(bool dropped)
{
    bool schedule = false;
    bool close = false;
    Operation operation { 0, {}, AsyncSQLiteOperationKind::Exec };
    {
        WTF::Locker locker { m_lock };
        if (m_state == State::Closed)
            return;
        if (dropped) {
            // Delivery is gone: stop accepting work, drop queued operations, and
            // drive straight to the physical close.
            m_deliveryEnabled = false;
            m_closeRequested = true;
            m_queue.clear();
        }
        if (!m_queue.isEmpty()) {
            operation = m_queue.takeFirst();
            m_state = State::OpenActive;
            m_activeOperationId = operation.id;
            m_activeCancelRequested = false;
            schedule = true;
        } else if (m_closeRequested) {
            m_activeOperationId = 0;
            m_state = State::ShuttingDown;
            close = true;
        } else {
            m_activeOperationId = 0;
            m_state = State::OpenIdle;
        }
    }
    if (schedule)
        scheduleOperation(WTF::move(operation));
    if (close)
        scheduleClose();
}

void AsyncSQLiteConnection::runClose(uint64_t operationId)
{
    closeJobsRun.fetch_add(1, std::memory_order_relaxed);
    sqlite3* database = nullptr;
    {
        WTF::Locker locker { m_lock };
        database = m_database;
        m_database = nullptr;
        m_activeDatabase = nullptr;
        m_state = State::Closed;
    }
    int rc = SQLITE_OK;
    if (database) {
        rc = sqlite3_close(database);
        RELEASE_ASSERT(rc != SQLITE_BUSY);
        physicalCloses.fetch_add(1, std::memory_order_relaxed);
    }
    auto result = connectionResult(rc == SQLITE_OK, rc, rc == SQLITE_OK ? std::string() : std::string("sqlite3_close failed"));
    postConnectionCompletion(m_contextId, operationId, *this, WTF::move(result));
}

namespace {

JSAsyncSQLitePendingRegistry* registryForGlobal(JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto& names = WebCore::builtinNames(vm);
    auto existing = globalObject->getDirect(vm, names.asyncSQLitePendingRegistryPrivateName());
    if (!existing.isEmpty()) {
        if (auto* registry = dynamicDowncast<JSAsyncSQLitePendingRegistry>(existing))
            return registry;
    }

    auto* structure = JSAsyncSQLitePendingRegistry::createStructure(vm, globalObject, globalObject->objectPrototype());
    auto* registry = JSAsyncSQLitePendingRegistry::create(vm, structure);
    globalObject->putDirect(vm, names.asyncSQLitePendingRegistryPrivateName(), registry, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    return registry;
}

void postStarted(AsyncSQLiteNativeJob& job, bool offThread)
{
    if (job.state->deliveryDisabled())
        return;

    WebCore::ScriptExecutionContext::postTaskTo(job.contextId, [operationId = job.operationId, offThread](WebCore::ScriptExecutionContext& context) {
        auto* registry = registryForGlobal(context.globalObject());
        if (registry)
            registry->resolveStarted(operationId, offThread, context.globalObject());
    });
}

void executeSQLiteJob(AsyncSQLiteNativeJob& job, AsyncSQLiteNativeResult& result)
{
    Bun__initializeSQLite();

    // The connection is opened FULLMUTEX and driven entirely on this WorkPool
    // thread, so the library must have been built thread-safe (serialized or
    // multi-thread). A 0 here means FULLMUTEX is a no-op and the handle is
    // unsafe to touch off the JS thread; refuse to proceed.
    if (sqlite3_threadsafe() == 0)
        return;

    sqlite3* database = nullptr;
    int rc = sqlite3_open_v2(job.path.c_str(), &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_URI | SQLITE_OPEN_FULLMUTEX, nullptr);
    if (rc != SQLITE_OK || !database) {
        if (database)
            sqlite3_close(database);
        return;
    }

    sqlite3_extended_result_codes(database, 1);
    sqlite3_busy_timeout(database, 60000);

    if (!job.state->publishActiveDatabase(database)) {
        sqlite3_close(database);
        return;
    }

    sqlite3_stmt* statement = nullptr;
    rc = sqlite3_prepare_v2(database, "INSERT INTO gate (value) VALUES (1)", -1, &statement, nullptr);
    if (rc == SQLITE_OK && statement) {
        if (!job.state->isCancelled())
            rc = sqlite3_step(statement);
        sqlite3_finalize(statement);
    }

    job.state->clearActiveDatabase(database);
    sqlite3_close(database);
    if (rc == SQLITE_DONE)
        result.value = 1;
}

void AsyncSQLiteNativeJob::run() noexcept
{
    const uint32_t workerThreadUid = static_cast<uint32_t>(WTF::Thread::currentSingleton().uid());
    postStarted(*this, workerThreadUid != callerThreadUid);

    auto result = std::make_unique<AsyncSQLiteNativeResult>(0);
    executeSQLiteJob(*this, *result);

    if (state->deliveryDisabled()) {
        deliveryDisabledDrops.fetch_add(1, std::memory_order_relaxed);
        return;
    }

    auto completion = std::make_unique<CompletionCapture>(WTF::move(result));
    bool posted = WebCore::ScriptExecutionContext::postTaskTo(contextId, [operationId = operationId, completion = WTF::move(completion)](WebCore::ScriptExecutionContext& context) mutable {
        completion->ran = true;
        completionsRun.fetch_add(1, std::memory_order_relaxed);
        auto* registry = registryForGlobal(context.globalObject());
        if (registry)
            registry->complete(operationId, completion->result->value, context);
    });
    if (!posted)
        postFailures.fetch_add(1, std::memory_order_relaxed);
}

// Materializes one owned column value into a JS value on the owner thread. Text
// is decoded from UTF-8 (invalid sequences replaced) and blobs are copied into a
// fresh Uint8Array, matching the synchronous bun:sqlite conversions.
static JSC::JSValue materializeValue(JSC::JSGlobalObject* globalObject, const AsyncSQLiteValue& value, bool safeIntegers)
{
    auto& vm = globalObject->vm();
    switch (value.kind) {
    case AsyncSQLiteValueKind::Null:
        return JSC::jsNull();
    case AsyncSQLiteValueKind::Integer:
        // safeIntegers returns a lossless BigInt like sync jsBigIntFromSQLite;
        // default returns a Number (may lose precision beyond 2^53).
        return safeIntegers ? JSC::JSBigInt::createFrom(globalObject, value.integer) : JSC::jsNumber(value.integer);
    case AsyncSQLiteValueKind::Double:
        return JSC::jsNumber(value.number);
    case AsyncSQLiteValueKind::Text: {
        if (value.bytes.empty())
            return JSC::jsEmptyString(vm);
        return JSC::jsString(vm, WTF::String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(value.bytes.data()), value.bytes.size() }));
    }
    case AsyncSQLiteValueKind::Blob: {
        auto* array = JSC::JSUint8Array::createUninitialized(globalObject, globalObject->m_typedArrayUint8.get(globalObject), value.bytes.size());
        if (!array) [[unlikely]]
            return {};
        if (!value.bytes.empty())
            memcpy(array->vector(), value.bytes.data(), value.bytes.size());
        return array;
    }
    }
    return JSC::jsNull();
}

// Materializes owned rows into a { columns, rows } object on the owner thread.
// Returns {} with a pending exception on failure; caller propagates it via
// ExistingExceptionError. forceFailure injects a deterministic private-test throw.
static JSC::JSValue materializeRows(JSC::JSGlobalObject* globalObject, const AsyncSQLiteRows* rows, bool forceFailure, bool safeIntegers)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (forceFailure) [[unlikely]] {
        throwTypeError(globalObject, scope, "forced async SQLite materialization failure"_s);
        return {};
    }

    size_t columnCount = rows ? rows->columns.size() : 0;
    auto* columnsArray = JSC::constructEmptyArray(globalObject, nullptr, static_cast<unsigned>(columnCount));
    RETURN_IF_EXCEPTION(scope, {});
    for (unsigned c = 0; c < columnCount; c++) {
        auto* name = JSC::jsString(vm, WTF::String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const unsigned char*>(rows->columns[c].data()), rows->columns[c].size() }));
        RETURN_IF_EXCEPTION(scope, {});
        columnsArray->putDirectIndex(globalObject, c, name);
        RETURN_IF_EXCEPTION(scope, {});
    }

    size_t rowCount = rows ? rows->rows.size() : 0;
    auto* rowsArray = JSC::constructEmptyArray(globalObject, nullptr, static_cast<unsigned>(rowCount));
    RETURN_IF_EXCEPTION(scope, {});
    for (unsigned r = 0; r < rowCount; r++) {
        const auto& row = rows->rows[r];
        auto* rowArray = JSC::constructEmptyArray(globalObject, nullptr, static_cast<unsigned>(row.size()));
        RETURN_IF_EXCEPTION(scope, {});
        for (unsigned c = 0; c < row.size(); c++) {
            JSC::JSValue element = materializeValue(globalObject, row[c], safeIntegers);
            RETURN_IF_EXCEPTION(scope, {});
            rowArray->putDirectIndex(globalObject, c, element);
            RETURN_IF_EXCEPTION(scope, {});
        }
        rowsArray->putDirectIndex(globalObject, r, rowArray);
        RETURN_IF_EXCEPTION(scope, {});
    }

    auto* object = JSC::constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    object->putDirect(vm, JSC::Identifier::fromString(vm, "columns"_s), columnsArray);
    RETURN_IF_EXCEPTION(scope, {});
    object->putDirect(vm, JSC::Identifier::fromString(vm, "rows"_s), rowsArray);
    RETURN_IF_EXCEPTION(scope, {});
    return object;
}

static JSC::JSValue materializeRowObject(JSC::JSGlobalObject* globalObject, const AsyncSQLiteRows* rows, size_t index, bool safeIntegers)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!rows || index >= rows->rows.size())
        return JSC::jsNull();
    auto* object = JSC::constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    const auto& row = rows->rows[index];
    for (unsigned c = 0; c < row.size(); c++) {
        auto name = WTF::String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const unsigned char*>(rows->columns[c].data()), rows->columns[c].size() });
        auto value = materializeValue(globalObject, row[c], safeIntegers);
        RETURN_IF_EXCEPTION(scope, {});
        auto identifier = JSC::Identifier::fromString(vm, name);
        if (auto propertyIndex = JSC::parseIndex(identifier))
            object->putDirectIndex(globalObject, *propertyIndex, value);
        else
            object->putDirect(vm, identifier, value);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return object;
}

static JSC::JSValue materializeAllObjects(JSC::JSGlobalObject* globalObject, const AsyncSQLiteRows* rows, bool safeIntegers)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    size_t rowCount = rows ? rows->rows.size() : 0;
    auto* result = JSC::constructEmptyArray(globalObject, nullptr, static_cast<unsigned>(rowCount));
    RETURN_IF_EXCEPTION(scope, {});
    for (unsigned r = 0; r < rowCount; r++) {
        auto row = materializeRowObject(globalObject, rows, r, safeIntegers);
        RETURN_IF_EXCEPTION(scope, {});
        result->putDirectIndex(globalObject, r, row);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return result;
}

static JSC::JSValue materializeValues(JSC::JSGlobalObject* globalObject, const AsyncSQLiteRows* rows, bool safeIntegers)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    size_t rowCount = rows ? rows->rows.size() : 0;
    auto* result = JSC::constructEmptyArray(globalObject, nullptr, static_cast<unsigned>(rowCount));
    RETURN_IF_EXCEPTION(scope, {});
    for (unsigned r = 0; r < rowCount; r++) {
        const auto& row = rows->rows[r];
        auto* values = JSC::constructEmptyArray(globalObject, nullptr, static_cast<unsigned>(row.size()));
        RETURN_IF_EXCEPTION(scope, {});
        for (unsigned c = 0; c < row.size(); c++) {
            auto value = materializeValue(globalObject, row[c], safeIntegers);
            RETURN_IF_EXCEPTION(scope, {});
            values->putDirectIndex(globalObject, c, value);
            RETURN_IF_EXCEPTION(scope, {});
        }
        result->putDirectIndex(globalObject, r, values);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return result;
}

static JSC::JSValue materializeChanges(JSC::JSGlobalObject* globalObject, const AsyncSQLiteChanges& changes, bool safeIntegers)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* result = JSC::constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    result->putDirect(vm, JSC::Identifier::fromString(vm, "changes"_s), JSC::jsNumber(changes.changes));
    RETURN_IF_EXCEPTION(scope, {});
    result->putDirect(vm, JSC::Identifier::fromString(vm, "lastInsertRowid"_s), safeIntegers ? JSC::JSBigInt::createFrom(globalObject, changes.lastInsertRowid) : JSC::jsNumber(changes.lastInsertRowid));
    RETURN_IF_EXCEPTION(scope, {});
    return result;
}

// Copies one JS binding value into an owned AsyncSQLiteValue on the JS thread,
// mirroring sync bun:sqlite type dispatch. bigint range and detached buffers
// reject; text/blob bytes are copied so later mutation cannot affect execution.
static bool snapshotBindingValue(JSC::JSGlobalObject* globalObject, JSC::JSValue value, bool safeIntegers, JSC::ThrowScope& scope, AsyncSQLiteValue& out)
{
    if (value.isUndefinedOrNull()) {
        out.kind = AsyncSQLiteValueKind::Null;
        return true;
    }
    if (value.isBoolean()) {
        out.kind = AsyncSQLiteValueKind::Integer;
        out.integer = value.asBoolean() ? 1 : 0;
        return true;
    }
    if (value.isAnyInt()) {
        out.kind = AsyncSQLiteValueKind::Integer;
        out.integer = value.asAnyInt();
        return true;
    }
    if (value.isNumber()) {
        out.kind = AsyncSQLiteValueKind::Double;
        out.number = value.asNumber();
        return true;
    }
    if (value.isString()) {
        WTF::String string = value.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        auto utf8 = string.utf8();
        out.kind = AsyncSQLiteValueKind::Text;
        out.bytes.assign(utf8.data(), utf8.length());
        return true;
    }
    if (value.isHeapBigInt()) {
        JSC::JSBigInt* bigInt = value.asHeapBigInt();
        // Default (safeIntegers off) wraps out-of-i64 input like sync
        // sqlite3_bind_int64(toBigInt64); safeIntegers on rejects out of range.
        if (safeIntegers) {
            const auto min = JSC::JSBigInt::compare(bigInt, std::numeric_limits<int64_t>::min());
            const auto max = JSC::JSBigInt::compare(bigInt, std::numeric_limits<int64_t>::max());
            bool inRange = (min == JSC::JSBigInt::ComparisonResult::GreaterThan || min == JSC::JSBigInt::ComparisonResult::Equal)
                && (max == JSC::JSBigInt::ComparisonResult::LessThan || max == JSC::JSBigInt::ComparisonResult::Equal);
            if (!inRange) [[unlikely]] {
                throwRangeError(globalObject, scope, makeString("BigInt value '"_s, bigInt->toString(globalObject, 10), "' is out of range"_s));
                return false;
            }
        }
        out.kind = AsyncSQLiteValueKind::Integer;
        out.integer = JSC::JSBigInt::toBigInt64(value);
        return true;
    }
    if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(value)) {
        if (view->isDetached()) [[unlikely]] {
            throwException(globalObject, scope, createError(globalObject, "TypedArray is detached"_s));
            return false;
        }
        out.kind = AsyncSQLiteValueKind::Blob;
        size_t length = view->byteLength();
        if (length)
            out.bytes.assign(reinterpret_cast<const char*>(view->vector()), length);
        return true;
    }
    throwException(globalObject, scope, createTypeError(globalObject, "Binding expected string, TypedArray, boolean, number, bigint or null"_s));
    return false;
}

// SQLite's default SQLITE_LIMIT_VARIABLE_NUMBER (sqlite3_local.h documents 32766);
// exceeding it always fails to prepare, so cap before any large snapshot alloc.
static constexpr unsigned kMaxSQLiteVariableNumber = 32766;

// Snapshots a binding argument into owned native values before admission.
// undefined/null -> no bindings; arrays -> positional; objects -> a complete map
// of own string-keyed properties (getters/Proxy traps run here on the JS thread).
static bool snapshotBindings(JSC::JSGlobalObject* globalObject, JSC::JSValue arg, bool safeIntegers, JSC::ThrowScope& scope, std::unique_ptr<AsyncSQLiteBindings>& out)
{
    auto& vm = globalObject->vm();
    if (arg.isUndefinedOrNull()) {
        out = nullptr;
        return true;
    }
    if (auto* array = dynamicDowncast<JSC::JSArray>(arg)) {
        unsigned length = array->length();
        // An empty array means "no bindings" (parameters default to NULL), matching
        // sync rebindStatement; nonempty arrays remain exact-count validated.
        if (!length) {
            out = nullptr;
            return true;
        }
        if (length > kMaxSQLiteVariableNumber) [[unlikely]] {
            throwRangeError(globalObject, scope, makeString("Too many binding values: "_s, length, " exceeds SQLite's maximum of "_s, kMaxSQLiteVariableNumber));
            return false;
        }
        auto bindings = std::make_unique<AsyncSQLiteBindings>();
        bindings->kind = AsyncSQLiteBindingKind::Positional;
        bindings->positional.reserve(length);
        for (unsigned i = 0; i < length; i++) {
            JSC::JSValue element = array->getDirectIndex(globalObject, i);
            RETURN_IF_EXCEPTION(scope, false);
            if (!element)
                element = JSC::jsUndefined();
            AsyncSQLiteValue value;
            if (!snapshotBindingValue(globalObject, element, safeIntegers, scope, value))
                return false;
            bindings->positional.push_back(WTF::move(value));
        }
        out = WTF::move(bindings);
        return true;
    }
    if (JSC::JSObject* object = arg.getObject()) {
        auto bindings = std::make_unique<AsyncSQLiteBindings>();
        bindings->kind = AsyncSQLiteBindingKind::Named;
        JSC::PropertyNameArrayBuilder names(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
        object->methodTable()->getOwnPropertyNames(object, globalObject, names, JSC::DontEnumPropertiesMode::Include);
        RETURN_IF_EXCEPTION(scope, false);
        for (const auto& identifier : names.data()->propertyNameVector()) {
            JSC::JSValue propertyValue = object->get(globalObject, identifier);
            RETURN_IF_EXCEPTION(scope, false);
            AsyncSQLiteValue value;
            if (!snapshotBindingValue(globalObject, propertyValue, safeIntegers, scope, value))
                return false;
            WTF::String keyString = identifier.string();
            auto keyUTF8 = keyString.utf8();
            bindings->named.insert_or_assign(std::string(keyUTF8.data(), keyUTF8.length()), WTF::move(value));
        }
        out = WTF::move(bindings);
        return true;
    }
    throwException(globalObject, scope, createError(globalObject, "Expected array or object for bindings"_s));
    return false;
}

} // namespace

void AsyncSQLiteTaskState::cancel(bool disableDelivery)
{
    WTF::Locker locker { m_lock };
    m_cancelled = true;
    if (disableDelivery)
        m_deliveryDisabled = true;
    if (m_activeDatabase) {
        sqlite3_interrupt(m_activeDatabase);
        taskInterrupts.fetch_add(1, std::memory_order_relaxed);
    }
}

bool AsyncSQLiteTaskState::isCancelled() const
{
    WTF::Locker locker { m_lock };
    return m_cancelled;
}

bool AsyncSQLiteTaskState::deliveryDisabled() const
{
    WTF::Locker locker { m_lock };
    return m_deliveryDisabled;
}

bool AsyncSQLiteTaskState::publishActiveDatabase(sqlite3* database)
{
    WTF::Locker locker { m_lock };
    if (m_cancelled || !database)
        return false;
    m_activeDatabase = database;
    activeTaskDatabases.fetch_add(1, std::memory_order_relaxed);
    return true;
}

void AsyncSQLiteTaskState::clearActiveDatabase(sqlite3* database)
{
    WTF::Locker locker { m_lock };
    if (m_activeDatabase == database) {
        m_activeDatabase = nullptr;
        activeTaskDatabases.fetch_sub(1, std::memory_order_relaxed);
    }
}

const JSC::ClassInfo JSAsyncSQLitePendingRegistry::s_info = { "AsyncSQLitePendingRegistry"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSAsyncSQLitePendingRegistry) };

JSAsyncSQLitePendingRegistry::JSAsyncSQLitePendingRegistry(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

JSC::Structure* JSAsyncSQLitePendingRegistry::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

JSAsyncSQLitePendingRegistry* JSAsyncSQLitePendingRegistry::create(JSC::VM& vm, JSC::Structure* structure)
{
    auto* registry = new (NotNull, JSC::allocateCell<JSAsyncSQLitePendingRegistry>(vm)) JSAsyncSQLitePendingRegistry(vm, structure);
    registry->finishCreation(vm);
    return registry;
}

JSC::GCClient::IsoSubspace* JSAsyncSQLitePendingRegistry::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSAsyncSQLitePendingRegistry, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForAsyncSQLitePendingRegistry.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForAsyncSQLitePendingRegistry = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForAsyncSQLitePendingRegistry.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForAsyncSQLitePendingRegistry = std::forward<decltype(space)>(space); });
}

template<typename Visitor>
void JSAsyncSQLitePendingRegistry::visitChildrenImpl(JSC::JSCell* cell, Visitor& visitor)
{
    auto* registry = uncheckedDowncast<JSAsyncSQLitePendingRegistry>(cell);
    Base::visitChildren(registry, visitor);
}
DEFINE_VISIT_CHILDREN(JSAsyncSQLitePendingRegistry);

void JSAsyncSQLitePendingRegistry::add(uint64_t operationId, PendingRequest&& request)
{
    m_requests.add(operationId, std::make_unique<PendingRequest>(WTF::move(request)));
    liveRequests.fetch_add(1, std::memory_order_relaxed);
}

void JSAsyncSQLitePendingRegistry::remove(uint64_t operationId)
{
    if (m_requests.remove(operationId))
        liveRequests.fetch_sub(1, std::memory_order_relaxed);
}

void JSAsyncSQLitePendingRegistry::addConnection(uint64_t id, WTF::Ref<AsyncSQLiteConnection>&& connection)
{
    m_connections.set(id, WTF::move(connection));
}

WTF::RefPtr<AsyncSQLiteConnection> JSAsyncSQLitePendingRegistry::connection(uint64_t id)
{
    if (auto iterator = m_connections.find(id); iterator != m_connections.end())
        return iterator->value.copyRef();
    return nullptr;
}

void JSAsyncSQLitePendingRegistry::abandonConnections()
{
    for (auto& entry : m_connections)
        entry.value->abandon();
    m_connections.clear();
}

void JSAsyncSQLitePendingRegistry::detachAbortAlgorithm(PendingRequest& request)
{
    if (request.signal && request.abortAlgorithmId) {
        WebCore::AbortSignal::removeAbortAlgorithmFromSignal(*request.signal, request.abortAlgorithmId);
        request.abortAlgorithmId = 0;
    }
    request.signal = nullptr;
}

void JSAsyncSQLitePendingRegistry::setAbortAlgorithmId(uint64_t operationId, uint32_t identifier)
{
    if (auto iterator = m_requests.find(operationId); iterator != m_requests.end())
        iterator->value->abortAlgorithmId = identifier;
}

void JSAsyncSQLitePendingRegistry::markKeepAlive(uint64_t operationId)
{
    if (auto iterator = m_requests.find(operationId); iterator != m_requests.end())
        iterator->value->keepAlive = true;
}

void JSAsyncSQLitePendingRegistry::resolveStarted(uint64_t operationId, bool offThread, JSC::JSGlobalObject* globalObject)
{
    auto iterator = m_requests.find(operationId);
    if (iterator == m_requests.end() || !iterator->value->started)
        return;

    auto& vm = globalObject->vm();
    auto* value = JSC::constructEmptyObject(globalObject);
    value->putDirect(vm, JSC::Identifier::fromString(vm, "offThread"_s), JSC::jsBoolean(offThread));
    iterator->value->started->resolveWithJSValue(value);
}

void JSAsyncSQLitePendingRegistry::complete(uint64_t operationId, int value, WebCore::ScriptExecutionContext& context)
{
    auto request = m_requests.take(operationId);
    if (!request)
        return;

    liveRequests.fetch_sub(1, std::memory_order_relaxed);
    detachAbortAlgorithm(*request);
    // Settle first; the keepalive unref must still run on this JS thread even if
    // materializing the result throws, so it is not guarded by an early return.
    if (request->result)
        request->result->resolveWithJSValue(JSC::jsNumber(value));
    if (request->keepAlive)
        context.unrefEventLoop();
}

void JSAsyncSQLitePendingRegistry::completeConnection(uint64_t operationId, bool success, int errorCode, std::string&& message, WebCore::ScriptExecutionContext& context)
{
    auto request = m_requests.take(operationId);
    if (!request)
        return;
    liveRequests.fetch_sub(1, std::memory_order_relaxed);
    detachAbortAlgorithm(*request);
    // Open/close failures are SQLite failures: reject with a SQLiteError carrying
    // the symbolic code, mirroring synchronous bun:sqlite. Extended codes are not
    // enabled until after open, so errorCode is the primary result code here.
    auto* globalObject = context.globalObject();
    auto sqliteError = [&]() -> JSC::JSValue {
        auto decoded = WTF::String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const unsigned char*>(message.data()), message.size() });
        return WebCore::createSQLiteErrorFromCode(globalObject, errorCode, -1, decoded);
    };
    if (!success && request->started)
        request->started->reject(sqliteError());
    if (request->result) {
        if (success)
            request->result->resolveWithJSValue(JSC::jsBoolean(true));
        else
            request->result->reject(sqliteError());
    }
    if (request->removeConnection || (request->started && !success)) {
        request->connection = nullptr;
        m_connections.remove(request->connectionId);
    }
    if (request->keepAlive)
        context.unrefEventLoop();
}

void JSAsyncSQLitePendingRegistry::completeConnectionOperation(uint64_t operationId, AsyncSQLiteConnection& connection, std::unique_ptr<AsyncSQLiteOperationResult>&& result, WebCore::ScriptExecutionContext& context)
{
    auto request = m_requests.take(operationId);
    if (!request) {
        // The request is gone (e.g. abandoned), but the FIFO must still advance
        // so the connection cannot strand or skip its physical close.
        connection.advanceAfterCompletion(false);
        return;
    }
    liveRequests.fetch_sub(1, std::memory_order_relaxed);
    // Capture the signal before detaching: an interrupt caused by this op's own
    // abort must still be recognizable when building the settlement value.
    WTF::RefPtr<WebCore::AbortSignal> signal = request->signal;
    detachAbortAlgorithm(*request);

    auto* globalObject = context.globalObject();
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // Build the JS settlement value while native ownership is still held. Any
    // pending JS exception (materialization or SQLiteError construction) must be
    // propagated to the promise, never cleared.
    JSC::JSValue resolveValue;
    JSC::JSValue rejectValue;
    if (request->result) {
        if (result && result->kind == AsyncSQLiteResultKind::Empty)
            resolveValue = JSC::jsBoolean(true);
        else if (result && result->kind == AsyncSQLiteResultKind::Changes)
            resolveValue = materializeChanges(globalObject, result->changes, connection.safeIntegers());
        else if (result && result->kind == AsyncSQLiteResultKind::Rows) {
            if (request->operationKind == AsyncSQLiteOperationKind::QueryForTesting) {
                resolveValue = materializeRows(globalObject, result->rows.get(), request->forceMaterializeFailure, connection.safeIntegers());
            } else if (request->operationKind == AsyncSQLiteOperationKind::Get) {
                resolveValue = materializeRowObject(globalObject, result->rows.get(), 0, connection.safeIntegers());
            } else if (request->operationKind == AsyncSQLiteOperationKind::All) {
                resolveValue = materializeAllObjects(globalObject, result->rows.get(), connection.safeIntegers());
            } else {
                resolveValue = materializeValues(globalObject, result->rows.get(), connection.safeIntegers());
            }
        } else if (result && result->kind == AsyncSQLiteResultKind::Error && result->error) {
            const auto& error = result->error;
            // A step interrupted by this operation's own AbortSignal settles as the
            // signal's abort reason. Unrelated interrupts and all other SQLite
            // errors keep their native diagnostics; never blanket-convert here.
            if ((error->resultCode == SQLITE_INTERRUPT || error->extendedCode == SQLITE_INTERRUPT) && signal && signal->aborted()) {
                rejectValue = signal->jsReason(*globalObject);
            } else {
                auto message = WTF::String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const unsigned char*>(error->message.data()), error->message.size() });
                // Binding failures mirror sync bun:sqlite as plain Errors with no
                // code/errno; only prepare/step errors carry SQLite diagnostics.
                if (error->kind == AsyncSQLiteErrorKind::Binding)
                    rejectValue = JSC::createError(globalObject, message);
                else
                    rejectValue = WebCore::createSQLiteErrorFromCode(globalObject, error->extendedCode, error->byteOffset, message);
            }
        }
    }
    bool exceptionPending = scope.exception();

    // Release owned native payloads (JS holds copies, or an exception is pending)
    // and advance the FIFO exactly once before settling. Both steps are native
    // only and leave any pending exception intact.
    result = nullptr;
    connection.advanceAfterCompletion(false);

    if (request->result) {
        if (exceptionPending)
            // DeferredPromise consumes the pending exception (handling
            // termination) and rejects with it; never clearException here.
            request->result->reject(WebCore::Exception { WebCore::ExceptionCode::ExistingExceptionError });
        else if (rejectValue)
            request->result->reject(rejectValue);
        else
            request->result->resolveWithJSValue(resolveValue);
    }
    if (request->keepAlive)
        context.unrefEventLoop();
}

void JSAsyncSQLitePendingRegistry::cancelConnectionOperation(uint64_t operationId, WebCore::ScriptExecutionContext& context)
{
    auto iterator = m_requests.find(operationId);
    if (iterator == m_requests.end())
        return; // The native completion already claimed and settled this op.
    auto* request = iterator->value.get();
    if (!request->connection || !request->result)
        return;

    auto outcome = request->connection->cancelOperation(operationId);
    if (outcome != AsyncSQLiteConnection::CancelOutcome::RemovedFromQueue)
        return; // Running/scheduled: the native completion settles exactly once.

    // Queued cancellation settles here without waiting for a completion that will
    // never arrive: reject once with the signal reason, then release the request
    // and its keepalive. The FIFO is untouched because the op never became active.
    auto owned = m_requests.take(operationId);
    if (!owned)
        return;
    liveRequests.fetch_sub(1, std::memory_order_relaxed);
    auto* globalObject = context.globalObject();
    JSC::JSValue reason = owned->signal ? owned->signal->jsReason(*globalObject) : JSC::JSValue(JSC::jsUndefined());
    detachAbortAlgorithm(*owned);
    owned->result->reject(reason);
    owned->connection = nullptr;
    if (owned->keepAlive)
        context.unrefEventLoop();
}

void JSAsyncSQLitePendingRegistry::abandonRequest(PendingRequest& request, bool unrefEventLoop)
{
    if (request.state)
        request.state->cancel(true);
    if (request.connection)
        request.connection->abandon();
    detachAbortAlgorithm(request);
    if (unrefEventLoop && request.keepAlive) {
        request.keepAlive = false;
        static_cast<Zig::GlobalObject*>(globalObject())->scriptExecutionContext()->unrefEventLoop();
    }
}

void JSAsyncSQLitePendingRegistry::abandon(bool unrefEventLoop)
{
    while (!m_requests.isEmpty()) {
        auto key = m_requests.begin()->key;
        auto request = m_requests.take(key);
        if (!request)
            continue;
        liveRequests.fetch_sub(1, std::memory_order_relaxed);
        abandonRequest(*request, unrefEventLoop);
    }
    abandonConnections();
}

JSAsyncSQLitePendingRegistry::~JSAsyncSQLitePendingRegistry()
{
    abandon(false);
}

void abandonAsyncSQLiteRequestsForGlobal(JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto& names = WebCore::builtinNames(vm);
    auto existing = globalObject->getDirect(vm, names.asyncSQLitePendingRegistryPrivateName());
    if (existing.isEmpty())
        return;
    if (auto* registry = dynamicDowncast<JSAsyncSQLitePendingRegistry>(existing))
        registry->abandon(true);
}

static AsyncSQLiteTaskStats asyncSQLiteTaskStats()
{
    return {
        liveJobs.load(std::memory_order_relaxed),
        liveResults.load(std::memory_order_relaxed),
        liveRequests.load(std::memory_order_relaxed),
        liveAbortAlgorithms.load(std::memory_order_relaxed),
        postFailures.load(std::memory_order_relaxed),
        completionsRun.load(std::memory_order_relaxed),
        completionsDropped.load(std::memory_order_relaxed),
        deliveryDisabledDrops.load(std::memory_order_relaxed),
        activeTaskDatabases.load(std::memory_order_relaxed),
        taskInterrupts.load(std::memory_order_relaxed),
        liveConnections.load(std::memory_order_relaxed),
        activeConnectionOperations.load(std::memory_order_relaxed),
        connectionInterrupts.load(std::memory_order_relaxed),
        closeJobsRun.load(std::memory_order_relaxed),
        physicalCloses.load(std::memory_order_relaxed),
        liveRows.load(std::memory_order_relaxed),
        liveErrors.load(std::memory_order_relaxed),
        copiedRowValues.load(std::memory_order_relaxed),
    };
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_asyncSQLiteTaskForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

#if LAZY_LOAD_SQLITE
    if (lazyLoadSQLite() < 0) [[unlikely]] {
        throwException(globalObject, scope, createError(globalObject, WTF::String::fromUTF8(dlerror())));
        return {};
    }
#endif
    Bun__initializeSQLite();

    auto pathString = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (pathString.isEmpty())
        return throwVMTypeError(globalObject, scope, "asyncSQLiteTaskForTesting requires a database path"_s);

    auto pathUTF8 = pathString.utf8();
    std::string path(pathUTF8.data(), pathUTF8.length());
    auto* context = static_cast<Zig::GlobalObject*>(globalObject)->scriptExecutionContext();
    auto* domGlobalObject = uncheckedDowncast<WebCore::JSDOMGlobalObject>(globalObject);

    WebCore::AbortSignal* signal = nullptr;
    if (!callFrame->argument(1).isUndefined()) {
        signal = WebCore::JSAbortSignal::toWrapped(vm, callFrame->argument(1));
        if (!signal)
            return throwVMTypeError(globalObject, scope, "signal must be an AbortSignal"_s);
    }

    auto started = WebCore::DeferredPromise::create(*domGlobalObject);
    auto result = WebCore::DeferredPromise::create(*domGlobalObject);
    if (!started || !result) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    auto startedPromise = started->promise();
    auto resultPromise = result->promise();

    auto operationId = nextOperationId.fetch_add(1, std::memory_order_relaxed);
    auto state = WTF::adoptRef(*new AsyncSQLiteTaskState(operationId));
    auto job = std::make_unique<AsyncSQLiteNativeJob>(context->identifier(), operationId, static_cast<uint32_t>(WTF::Thread::currentSingleton().uid()), WTF::move(path), state.copyRef());
    JSAsyncSQLitePendingRegistry::PendingRequest request {
        WTF::move(started),
        WTF::move(result),
        signal ? WTF::RefPtr<WebCore::AbortSignal>(signal) : nullptr,
        0,
        state.copyRef(),
        nullptr,
        0,
        false,
    };

    auto* registry = registryForGlobal(globalObject);
    registry->add(operationId, WTF::move(request));

    if (signal) {
        auto algorithm = WTF::adoptRef(*new AsyncSQLiteAbortAlgorithm(state.copyRef()));
        auto algorithmId = WebCore::AbortSignal::addAbortAlgorithmToSignal(*signal, WTF::move(algorithm));
        registry->setAbortAlgorithmId(operationId, algorithmId);
        if (algorithmId == 0)
            state->cancel(false);
    }

    context->refEventLoop();
    registry->markKeepAlive(operationId);

    AsyncSQLiteTask__schedule(static_cast<AsyncSQLiteJobBase*>(job.release()));

    auto* object = JSC::constructEmptyObject(globalObject);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "started"_s), startedPromise);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "result"_s), resultPromise);
    return JSC::JSValue::encode(object);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_asyncSQLiteTaskStatsForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    auto stats = asyncSQLiteTaskStats();
    auto& vm = globalObject->vm();
    auto* object = JSC::constructEmptyObject(globalObject);
    auto put = [&](ASCIILiteral name, int64_t value) {
        object->putDirect(vm, JSC::Identifier::fromString(vm, name), JSC::jsNumber(value));
    };
    put("liveJobs"_s, stats.liveJobs);
    put("liveResults"_s, stats.liveResults);
    put("liveRequests"_s, stats.liveRequests);
    put("liveAbortAlgorithms"_s, stats.liveAbortAlgorithms);
    put("postFailures"_s, stats.postFailures);
    put("completionsRun"_s, stats.completionsRun);
    put("completionsDropped"_s, stats.completionsDropped);
    put("deliveryDisabledDrops"_s, stats.deliveryDisabledDrops);
    put("activeTaskDatabases"_s, stats.activeTaskDatabases);
    put("taskInterrupts"_s, stats.taskInterrupts);
    put("liveConnections"_s, stats.liveConnections);
    put("activeConnectionOperations"_s, stats.activeConnectionOperations);
    put("connectionInterrupts"_s, stats.connectionInterrupts);
    put("closeJobsRun"_s, stats.closeJobsRun);
    put("physicalCloses"_s, stats.physicalCloses);
    put("liveRows"_s, stats.liveRows);
    put("liveErrors"_s, stats.liveErrors);
    put("copiedRowValues"_s, stats.copiedRowValues);
    return JSC::JSValue::encode(object);
}

static bool parseAsyncSQLiteConnectionId(JSC::JSGlobalObject* globalObject, JSC::JSValue value, JSC::ThrowScope& scope, uint64_t& id)
{
    double number = value.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    if (!std::isfinite(number) || number < 0 || std::trunc(number) != number || number > JSC::maxSafeInteger())
        return false;
    id = static_cast<uint64_t>(number);
    return true;
}

// Shared open path for the private testing surface and the public AsyncDatabase.
// Creates the connection with its owned open flags, registers a pending open
// request, and returns { id, ready }. Path emptiness is validated by the caller.
static JSC::EncodedJSValue startAsyncSQLiteOpen(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, const WTF::String& pathString, uint32_t capacity, int timeout, bool strict, bool safeIntegers, int openFlags)
{
    auto& vm = globalObject->vm();
    auto* context = static_cast<Zig::GlobalObject*>(globalObject)->scriptExecutionContext();
    auto* domGlobalObject = uncheckedDowncast<WebCore::JSDOMGlobalObject>(globalObject);
    auto started = WebCore::DeferredPromise::create(*domGlobalObject);
    if (!started) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    auto readyPromise = started->promise();
    auto id = nextOperationId.fetch_add(1, std::memory_order_relaxed);
    auto pathUTF8 = pathString.utf8();
    auto connection = WTF::adoptRef(*new AsyncSQLiteConnection(context->identifier(), std::string(pathUTF8.data(), pathUTF8.length()), capacity, timeout, strict, safeIntegers, openFlags));
    auto* registry = registryForGlobal(globalObject);
    registry->addConnection(id, connection.copyRef());
    registry->add(id, JSAsyncSQLitePendingRegistry::PendingRequest { WTF::move(started), nullptr, nullptr, 0, nullptr, connection.copyRef(), id, false, true });
    context->refEventLoop();
    registry->markKeepAlive(id);
    connection->open(id, static_cast<uint32_t>(WTF::Thread::currentSingleton().uid()));

    auto* object = JSC::constructEmptyObject(globalObject);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "id"_s), JSC::jsNumber(static_cast<double>(id)));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "ready"_s), readyPromise);
    return JSC::JSValue::encode(object);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionOpenForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
#if LAZY_LOAD_SQLITE
    if (lazyLoadSQLite() < 0)
        return throwVMError(globalObject, scope, WTF::String::fromUTF8(dlerror()));
#endif
    auto pathString = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (pathString.isEmpty())
        return throwVMTypeError(globalObject, scope, "asyncSQLiteConnectionOpenForTesting requires a path"_s);
    uint32_t capacity = callFrame->argument(1).isUndefined() ? 8 : std::max(1, callFrame->argument(1).toInt32(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    int timeout = callFrame->argument(2).isUndefined() ? 60000 : std::max(0, callFrame->argument(2).toInt32(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    // Private open options (arg 3), fixed per connection to match the future
    // AsyncDatabase options and sync binding behavior.
    bool strict = false;
    bool safeIntegers = false;
    if (JSC::JSObject* options = callFrame->argument(3).getObject()) {
        JSC::JSValue strictValue = options->get(globalObject, JSC::Identifier::fromString(vm, "strict"_s));
        RETURN_IF_EXCEPTION(scope, {});
        strict = strictValue.toBoolean(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        JSC::JSValue safeValue = options->get(globalObject, JSC::Identifier::fromString(vm, "safeIntegers"_s));
        RETURN_IF_EXCEPTION(scope, {});
        safeIntegers = safeValue.toBoolean(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return startAsyncSQLiteOpen(globalObject, scope, pathString, capacity, timeout, strict, safeIntegers, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE);
}

// Public open for AsyncDatabase. Options are validated and coerced in
// src/js/bun/sqlite.ts, so args arrive as already-checked primitives:
// (path, openFlags, busyTimeout, maxPending, strict, safeIntegers).
JSC_DEFINE_HOST_FUNCTION(jsFunction_asyncSQLiteDatabaseOpen, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
#if LAZY_LOAD_SQLITE
    if (lazyLoadSQLite() < 0)
        return throwVMError(globalObject, scope, WTF::String::fromUTF8(dlerror()));
#endif
    auto pathString = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (pathString.isEmpty())
        return throwVMTypeError(globalObject, scope, "AsyncDatabase.open requires a path"_s);
    int openFlags = callFrame->argument(1).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    int timeout = std::max(0, callFrame->argument(2).toInt32(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    uint32_t capacity = std::max(1, callFrame->argument(3).toInt32(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    bool strict = callFrame->argument(4).toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    bool safeIntegers = callFrame->argument(5).toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return startAsyncSQLiteOpen(globalObject, scope, pathString, capacity, timeout, strict, safeIntegers, openFlags);
}

static JSC::EncodedJSValue asyncSQLiteConnectionSubmit(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, AsyncSQLiteOperationKind kind, bool acceptsBindings)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* context = static_cast<Zig::GlobalObject*>(globalObject)->scriptExecutionContext();
    auto* domGlobalObject = uncheckedDowncast<WebCore::JSDOMGlobalObject>(globalObject);
    auto result = WebCore::DeferredPromise::create(*domGlobalObject);
    if (!result) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    auto promise = result->promise();
    bool forceMaterializeFailure = false;
    if (kind == AsyncSQLiteOperationKind::QueryForTesting) {
        if (JSC::JSObject* options = callFrame->argument(3).getObject()) {
            JSC::JSValue forceValue = options->get(globalObject, JSC::Identifier::fromString(vm, "forceMaterializeFailure"_s));
            if (scope.exception()) {
                result->reject(WebCore::Exception { WebCore::ExceptionCode::ExistingExceptionError });
                return JSC::JSValue::encode(promise);
            }
            forceMaterializeFailure = forceValue.toBoolean(globalObject);
            if (scope.exception()) {
                result->reject(WebCore::Exception { WebCore::ExceptionCode::ExistingExceptionError });
                return JSC::JSValue::encode(promise);
            }
        }
    }
    uint64_t id;
    if (!parseAsyncSQLiteConnectionId(globalObject, callFrame->argument(0), scope, id)) {
        RETURN_IF_EXCEPTION(scope, {});
        result->reject(WebCore::ExceptionCode::OperationError, "connection ID must be a finite, non-negative safe integer"_s);
        return JSC::JSValue::encode(promise);
    }
    auto sqlString = callFrame->argument(1).toWTFString(globalObject);
    if (scope.exception()) {
        result->reject(WebCore::Exception { WebCore::ExceptionCode::ExistingExceptionError });
        return JSC::JSValue::encode(promise);
    }
    auto* registry = registryForGlobal(globalObject);
    auto connection = registry->connection(id);
    if (!connection) {
        result->reject(WebCore::ExceptionCode::OperationError, "connection is closed"_s);
        return JSC::JSValue::encode(promise);
    }

    // Resolve the optional per-operation AbortSignal (a dedicated native argument;
    // the public wrapper never exposes operation IDs). An invalid signal or one
    // already aborted rejects the Promise without admitting any work.
    WebCore::AbortSignal* signal = nullptr;
    if (kind != AsyncSQLiteOperationKind::QueryForTesting && !callFrame->argument(3).isUndefined()) {
        signal = WebCore::JSAbortSignal::toWrapped(vm, callFrame->argument(3));
        if (!signal) {
            result->reject(WebCore::ExceptionCode::OperationError, "signal must be an AbortSignal"_s);
            return JSC::JSValue::encode(promise);
        }
        if (signal->aborted()) {
            result->reject(signal->jsReason(*globalObject));
            return JSC::JSValue::encode(promise);
        }
    }

    // Snapshot all binding input on the JS thread before admission. Any getter,
    // Proxy trap, or conversion error rejects the returned Promise rather than
    // escaping synchronously; no keepalive/request has been taken yet.
    if (!acceptsBindings && !callFrame->argument(2).isUndefined()) {
        result->reject(WebCore::ExceptionCode::OperationError, "async SQLite exec does not accept bindings"_s);
        return JSC::JSValue::encode(promise);
    }
    std::unique_ptr<AsyncSQLiteBindings> bindings;
    if (acceptsBindings && !snapshotBindings(globalObject, callFrame->argument(2), connection->safeIntegers(), scope, bindings)) {
        result->reject(WebCore::Exception { WebCore::ExceptionCode::ExistingExceptionError });
        return JSC::JSValue::encode(promise);
    }

    auto operationId = nextOperationId.fetch_add(1, std::memory_order_relaxed);
    auto sqlUTF8 = sqlString.utf8();
    if (!connection->admit(operationId, std::string(sqlUTF8.data(), sqlUTF8.length()), kind, WTF::move(bindings))) {
        result->reject(WebCore::ExceptionCode::OperationError, "connection queue is full or closing"_s);
        return JSC::JSValue::encode(promise);
    }
    // admit() can schedule a fast completion, but its JS callback cannot claim
    // the registry until this host function returns.
    registry->add(operationId, JSAsyncSQLitePendingRegistry::PendingRequest { nullptr, WTF::move(result), signal ? WTF::RefPtr<WebCore::AbortSignal>(signal) : nullptr, 0, nullptr, connection, id, false, true, kind != AsyncSQLiteOperationKind::Exec, forceMaterializeFailure, kind });
    context->refEventLoop();
    registry->markKeepAlive(operationId);
    // Register the abort algorithm last, after the keepalive is taken, so a signal
    // that aborts during registration settles through the same terminal path.
    if (signal) {
        auto algorithm = WTF::adoptRef(*new AsyncSQLiteConnectionAbortAlgorithm(context, operationId));
        auto algorithmId = WebCore::AbortSignal::addAbortAlgorithmToSignal(*signal, WTF::move(algorithm));
        registry->setAbortAlgorithmId(operationId, algorithmId);
    }
    return JSC::JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionExecForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return asyncSQLiteConnectionSubmit(globalObject, callFrame, AsyncSQLiteOperationKind::Exec, false);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionQueryForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return asyncSQLiteConnectionSubmit(globalObject, callFrame, AsyncSQLiteOperationKind::QueryForTesting, true);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionRunForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return asyncSQLiteConnectionSubmit(globalObject, callFrame, AsyncSQLiteOperationKind::Run, true);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionGetForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return asyncSQLiteConnectionSubmit(globalObject, callFrame, AsyncSQLiteOperationKind::Get, true);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionAllForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return asyncSQLiteConnectionSubmit(globalObject, callFrame, AsyncSQLiteOperationKind::All, true);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionValuesForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return asyncSQLiteConnectionSubmit(globalObject, callFrame, AsyncSQLiteOperationKind::Values, true);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionCloseForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* context = static_cast<Zig::GlobalObject*>(globalObject)->scriptExecutionContext();
    auto* domGlobalObject = uncheckedDowncast<WebCore::JSDOMGlobalObject>(globalObject);
    auto result = WebCore::DeferredPromise::create(*domGlobalObject);
    if (!result) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    auto promise = result->promise();
    uint64_t id;
    if (!parseAsyncSQLiteConnectionId(globalObject, callFrame->argument(0), scope, id)) {
        RETURN_IF_EXCEPTION(scope, {});
        result->reject(WebCore::ExceptionCode::OperationError, "connection ID must be a finite, non-negative safe integer"_s);
        return JSC::JSValue::encode(promise);
    }
    auto* registry = registryForGlobal(globalObject);
    auto connection = registry->connection(id);
    if (!connection) {
        result->resolveWithJSValue(JSC::jsBoolean(false));
        return JSC::JSValue::encode(promise);
    }
    auto operationId = nextOperationId.fetch_add(1, std::memory_order_relaxed);
    if (!connection->close(operationId, static_cast<uint32_t>(WTF::Thread::currentSingleton().uid()))) {
        result->resolveWithJSValue(JSC::jsBoolean(false));
        return JSC::JSValue::encode(promise);
    }
    // close() can schedule a fast completion, which cannot run its JS callback
    // before this host function installs the request and returns.
    registry->add(operationId, JSAsyncSQLitePendingRegistry::PendingRequest { nullptr, WTF::move(result), nullptr, 0, nullptr, connection, id, true, true });
    context->refEventLoop();
    registry->markKeepAlive(operationId);
    return JSC::JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionStatsForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    auto stats = asyncSQLiteTaskStats();
    auto& vm = globalObject->vm();
    auto* object = JSC::constructEmptyObject(globalObject);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "liveConnections"_s), JSC::jsNumber(stats.liveConnections));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "activeConnectionOperations"_s), JSC::jsNumber(stats.activeConnectionOperations));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "connectionInterrupts"_s), JSC::jsNumber(stats.connectionInterrupts));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "closeJobsRun"_s), JSC::jsNumber(stats.closeJobsRun));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "physicalCloses"_s), JSC::jsNumber(stats.physicalCloses));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "liveRows"_s), JSC::jsNumber(stats.liveRows));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "liveErrors"_s), JSC::jsNumber(stats.liveErrors));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "copiedRowValues"_s), JSC::jsNumber(stats.copiedRowValues));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "liveJobs"_s), JSC::jsNumber(stats.liveJobs));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "liveResults"_s), JSC::jsNumber(stats.liveResults));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "liveRequests"_s), JSC::jsNumber(stats.liveRequests));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "deliveryDisabledDrops"_s), JSC::jsNumber(stats.deliveryDisabledDrops));
    return JSC::JSValue::encode(object);
}

// Builds the public AsyncDatabase native surface. The exec/run/get/all/values/
// close entry points share the same host functions as the private testing
// surface (their SQLite semantics are identical); only the arg-shape-specific
// open differs. Exposed exclusively through this factory, never via
// bun:internal-for-testing.
JSC::JSValue createAsyncSQLiteBinding(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto* object = JSC::constructEmptyObject(globalObject);
    auto put = [&](ASCIILiteral name, unsigned length, JSC::NativeFunction fn) {
        object->putDirect(vm, JSC::Identifier::fromString(vm, name), JSC::JSFunction::create(vm, globalObject, length, WTF::String(name), fn, JSC::ImplementationVisibility::Public), 0);
    };
    put("open"_s, 6, jsFunction_asyncSQLiteDatabaseOpen);
    put("exec"_s, 1, jsFunction_asyncSQLiteConnectionExecForTesting);
    put("run"_s, 2, jsFunction_asyncSQLiteConnectionRunForTesting);
    put("get"_s, 2, jsFunction_asyncSQLiteConnectionGetForTesting);
    put("all"_s, 2, jsFunction_asyncSQLiteConnectionAllForTesting);
    put("values"_s, 2, jsFunction_asyncSQLiteConnectionValuesForTesting);
    put("close"_s, 1, jsFunction_asyncSQLiteConnectionCloseForTesting);
    return object;
}

extern "C" void Bun__AsyncSQLiteNativeJob__runAndDelete(AsyncSQLiteJobBase* job) noexcept
{
    std::unique_ptr<AsyncSQLiteJobBase> owned(job);
    if (owned)
        owned->run();
}

extern "C" void Bun__AsyncSQLiteNativeJob__destroy(AsyncSQLiteJobBase* job) noexcept
{
    delete job;
}

} // namespace Bun
