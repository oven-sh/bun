#include "root.h"

#include "AsyncSQLiteDatabase.h"
#include "AbortAlgorithm.h"
#include "AbortSignal.h"
#include "BunClientData.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMPromiseDeferred.h"
#include "JSDOMWrapper.h"
#include "JSAbortSignal.h"
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
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <wtf/Atomics.h>
#include <wtf/Threading.h>

#include <algorithm>
#include <memory>

extern "C" void Bun__initializeSQLite();
extern "C" void AsyncSQLiteTask__schedule(void*);

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
std::atomic<int64_t> liveConnections { 0 };
std::atomic<int64_t> activeConnectionOperations { 0 };
std::atomic<int64_t> closeJobsRun { 0 };
std::atomic<int64_t> physicalCloses { 0 };
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

class AsyncSQLiteConnectionJob;

class AsyncSQLiteJobBase {
public:
    // The Rust OwnedTask bridge carries this opaque pointer; every allocation
    // submitted here is one of these native-only polymorphic jobs.
    virtual ~AsyncSQLiteJobBase() = default;
    virtual void run() noexcept = 0;
};

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
        completionsDropped.fetch_add(1, std::memory_order_relaxed);
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

static void scheduleConnectionJob(std::unique_ptr<AsyncSQLiteConnectionJob>&& job)
{
    AsyncSQLiteTask__schedule(job.release());
}

AsyncSQLiteConnection::AsyncSQLiteConnection(uint32_t contextId, std::string&& path, uint32_t capacity, int busyTimeout)
    : m_contextId(contextId)
    , m_path(WTF::move(path))
    , m_capacity(std::max(1u, capacity))
    , m_busyTimeout(std::max(0, busyTimeout))
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

bool AsyncSQLiteConnection::admit(uint64_t operationId, std::string&& sql)
{
    bool schedule = false;
    Operation operation { 0, {} };
    {
        WTF::Locker locker { m_lock };
        if (!m_deliveryEnabled || m_closeRequested || m_state == State::Closed || m_state == State::ShuttingDown)
            return false;
        if (m_queue.size() + (m_state == State::OpenActive ? 1u : 0u) >= m_capacity)
            return false;
        m_queue.append({ operationId, WTF::move(sql) });
        schedule = m_state == State::OpenIdle;
        if (schedule) {
            m_state = State::OpenActive;
            operation = m_queue.takeFirst();
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
    if (m_activeDatabase)
        sqlite3_interrupt(m_activeDatabase);
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
        int rc = sqlite3_open_v2(m_path.c_str(), &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_URI | SQLITE_OPEN_FULLMUTEX, nullptr);
        if (rc != SQLITE_OK || !database) {
            int code = rc;
            std::string message = database && sqlite3_errmsg(database) ? sqlite3_errmsg(database) : sqlite3_errstr(rc);
            if (database)
                sqlite3_close(database);
            result = connectionResult(false, code, WTF::move(message));
        } else if (sqlite3_extended_result_codes(database, 1) != SQLITE_OK) {
            int code = sqlite3_extended_errcode(database);
            std::string message = sqlite3_errmsg(database);
            sqlite3_close(database);
            result = connectionResult(false, code, WTF::move(message));
        } else if (sqlite3_busy_timeout(database, m_busyTimeout) != SQLITE_OK) {
            int code = sqlite3_extended_errcode(database);
            std::string message = sqlite3_errmsg(database);
            sqlite3_close(database);
            result = connectionResult(false, code, WTF::move(message));
        } else {
            sqlite3_db_config(database, SQLITE_DBCONFIG_DEFENSIVE, 1, nullptr);
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

void AsyncSQLiteConnection::runOperation(Operation&& operation)
{
    sqlite3* database = nullptr;
    bool execute = false;
    {
        WTF::Locker locker { m_lock };
        database = m_database;
        if (m_deliveryEnabled) {
            m_activeDatabase = database;
            activeConnectionOperations.fetch_add(1, std::memory_order_relaxed);
            execute = true;
        }
    }
    if (!execute) {
        finishOperation(operation.id, false, SQLITE_INTERRUPT, "connection was abandoned");
        return;
    }

    char* error = nullptr;
    int rc = database ? sqlite3_exec(database, operation.sql.c_str(), nullptr, nullptr, &error) : SQLITE_MISUSE;
    std::string message;
    if (error) {
        message = error;
        sqlite3_free(error);
    } else if (database && rc != SQLITE_OK) {
        message = sqlite3_errmsg(database);
    }
    activeConnectionOperations.fetch_sub(1, std::memory_order_relaxed);
    finishOperation(operation.id, rc == SQLITE_OK, rc, WTF::move(message));
}

void AsyncSQLiteConnection::finishOperation(uint64_t operationId, bool success, int errorCode, std::string&& message)
{
    bool close = false;
    bool schedule = false;
    Operation operation { 0, {} };
    {
        WTF::Locker locker { m_lock };
        m_activeDatabase = nullptr;
        if (!m_queue.isEmpty()) {
            operation = m_queue.takeFirst();
            m_state = State::OpenActive;
            schedule = true;
        } else if (m_closeRequested) {
            m_state = State::ShuttingDown;
            close = true;
        } else {
            m_state = State::OpenIdle;
        }
    }
    if (schedule)
        scheduleOperation(WTF::move(operation));
    postConnectionCompletion(m_contextId, operationId, *this, connectionResult(success, errorCode, WTF::move(message)));
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
        postFailures.fetch_add(1, std::memory_order_relaxed);
        completionsDropped.fetch_add(1, std::memory_order_relaxed);
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

} // namespace

void AsyncSQLiteTaskState::cancel(bool disableDelivery)
{
    WTF::Locker locker { m_lock };
    m_cancelled = true;
    if (disableDelivery)
        m_deliveryDisabled = true;
    if (m_activeDatabase)
        sqlite3_interrupt(m_activeDatabase);
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
    if (m_cancelled)
        return false;
    m_activeDatabase = database;
    return true;
}

void AsyncSQLiteTaskState::clearActiveDatabase(sqlite3* database)
{
    WTF::Locker locker { m_lock };
    if (m_activeDatabase == database)
        m_activeDatabase = nullptr;
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
    if (!success && request->started)
        request->started->reject(WebCore::ExceptionCode::OperationError, WTF::String::fromUTF8(message));
    if (request->result) {
        if (success)
            request->result->resolveWithJSValue(JSC::jsBoolean(true));
        else
            request->result->reject(WebCore::ExceptionCode::OperationError, WTF::String::fromUTF8(message));
    }
    if (request->removeConnection || (request->started && !success)) {
        request->connection = nullptr;
        m_connections.remove(request->connectionId);
    }
    if (request->keepAlive)
        context.unrefEventLoop();
    UNUSED_PARAM(errorCode);
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
        liveConnections.load(std::memory_order_relaxed),
        activeConnectionOperations.load(std::memory_order_relaxed),
        closeJobsRun.load(std::memory_order_relaxed),
        physicalCloses.load(std::memory_order_relaxed),
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

    AsyncSQLiteTask__schedule(job.release());

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
    put("liveConnections"_s, stats.liveConnections);
    put("activeConnectionOperations"_s, stats.activeConnectionOperations);
    put("closeJobsRun"_s, stats.closeJobsRun);
    put("physicalCloses"_s, stats.physicalCloses);
    return JSC::JSValue::encode(object);
}

static JSC::EncodedJSValue rejectedConnectionPromise(JSC::JSGlobalObject* globalObject, WebCore::JSDOMGlobalObject* domGlobalObject, const char* message)
{
    auto promise = WebCore::DeferredPromise::create(*domGlobalObject);
    if (!promise)
        return JSC::JSValue::encode(JSC::jsUndefined());
    auto value = promise->promise();
    promise->reject(WebCore::ExceptionCode::OperationError, WTF::String::fromUTF8(message));
    return JSC::JSValue::encode(value);
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
    auto connection = WTF::adoptRef(*new AsyncSQLiteConnection(context->identifier(), std::string(pathUTF8.data(), pathUTF8.length()), capacity, timeout));
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

JSC_DEFINE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionExecForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto id = static_cast<uint64_t>(callFrame->argument(0).toUInt32(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    auto sqlString = callFrame->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto* context = static_cast<Zig::GlobalObject*>(globalObject)->scriptExecutionContext();
    auto* domGlobalObject = uncheckedDowncast<WebCore::JSDOMGlobalObject>(globalObject);
    auto result = WebCore::DeferredPromise::create(*domGlobalObject);
    if (!result) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    auto promise = result->promise();
    auto* registry = registryForGlobal(globalObject);
    auto connection = registry->connection(id);
    if (!connection)
        return rejectedConnectionPromise(globalObject, domGlobalObject, "connection is closed");

    auto operationId = nextOperationId.fetch_add(1, std::memory_order_relaxed);
    registry->add(operationId, JSAsyncSQLitePendingRegistry::PendingRequest { nullptr, WTF::move(result), nullptr, 0, nullptr, connection, id, false, true });
    auto sqlUTF8 = sqlString.utf8();
    if (!connection->admit(operationId, std::string(sqlUTF8.data(), sqlUTF8.length()))) {
        registry->remove(operationId);
        auto rejected = WebCore::DeferredPromise::create(*domGlobalObject);
        if (!rejected)
            return JSC::JSValue::encode(JSC::jsUndefined());
        auto rejectedValue = rejected->promise();
        rejected->reject(WebCore::ExceptionCode::OperationError, "connection queue is full or closing"_s);
        return JSC::JSValue::encode(rejectedValue);
    }
    context->refEventLoop();
    registry->markKeepAlive(operationId);
    return JSC::JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_asyncSQLiteConnectionCloseForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto id = static_cast<uint64_t>(callFrame->argument(0).toUInt32(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    auto* context = static_cast<Zig::GlobalObject*>(globalObject)->scriptExecutionContext();
    auto* domGlobalObject = uncheckedDowncast<WebCore::JSDOMGlobalObject>(globalObject);
    auto result = WebCore::DeferredPromise::create(*domGlobalObject);
    if (!result) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    auto promise = result->promise();
    auto* registry = registryForGlobal(globalObject);
    auto connection = registry->connection(id);
    if (!connection) {
        result->resolveWithJSValue(JSC::jsBoolean(false));
        return JSC::JSValue::encode(promise);
    }
    auto operationId = nextOperationId.fetch_add(1, std::memory_order_relaxed);
    registry->add(operationId, JSAsyncSQLitePendingRegistry::PendingRequest { nullptr, WTF::move(result), nullptr, 0, nullptr, connection, id, true, true });
    if (!connection->close(operationId, static_cast<uint32_t>(WTF::Thread::currentSingleton().uid()))) {
        registry->remove(operationId);
        auto fallback = WebCore::DeferredPromise::create(*domGlobalObject);
        if (!fallback)
            return JSC::JSValue::encode(JSC::jsUndefined());
        auto fallbackValue = fallback->promise();
        fallback->resolveWithJSValue(JSC::jsBoolean(false));
        return JSC::JSValue::encode(fallbackValue);
    }
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
    object->putDirect(vm, JSC::Identifier::fromString(vm, "closeJobsRun"_s), JSC::jsNumber(stats.closeJobsRun));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "physicalCloses"_s), JSC::jsNumber(stats.physicalCloses));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "liveJobs"_s), JSC::jsNumber(stats.liveJobs));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "liveResults"_s), JSC::jsNumber(stats.liveResults));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "liveRequests"_s), JSC::jsNumber(stats.liveRequests));
    return JSC::JSValue::encode(object);
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
