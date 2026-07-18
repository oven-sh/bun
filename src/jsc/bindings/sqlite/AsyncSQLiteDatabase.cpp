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

std::atomic<int64_t> liveJobs { 0 };
std::atomic<int64_t> liveResults { 0 };
std::atomic<int64_t> liveRequests { 0 };
std::atomic<int64_t> liveAbortAlgorithms { 0 };
std::atomic<int64_t> postFailures { 0 };
std::atomic<int64_t> completionsRun { 0 };
std::atomic<int64_t> completionsDropped { 0 };
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

class AsyncSQLiteNativeJob {
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

    void run() noexcept;

    uint32_t contextId;
    uint64_t operationId;
    uint32_t callerThreadUid;
    std::string path;
    WTF::Ref<AsyncSQLiteTaskState> state;
};

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

void JSAsyncSQLitePendingRegistry::abandonRequest(PendingRequest& request, bool unrefEventLoop)
{
    request.state->cancel(true);
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
    return JSC::JSValue::encode(object);
}

extern "C" void Bun__AsyncSQLiteNativeJob__runAndDelete(AsyncSQLiteNativeJob* job) noexcept
{
    std::unique_ptr<AsyncSQLiteNativeJob> owned(job);
    if (owned)
        owned->run();
}

extern "C" void Bun__AsyncSQLiteNativeJob__destroy(AsyncSQLiteNativeJob* job) noexcept
{
    delete job;
}

} // namespace Bun
