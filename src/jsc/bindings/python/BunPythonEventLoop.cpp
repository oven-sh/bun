#include "BunPythonModule.h"

#include "BunClientData.h"
#include "BunPython.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/PyEventWait.h>
#include <JavaScriptCore/PyExec.h>
#include <JavaScriptCore/PyHooks.h>
#include <JavaScriptCore/PyThreads.h>
#include <JavaScriptCore/StrongInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <wtf/HashMap.h>

// Python and the event loop. The Rust half is src/runtime/python.rs; python/README.md in JavaScriptCore has the design.

struct BunPythonTimer;
struct BunPythonFdWatcher;

extern "C" {
BunPythonTimer* Bun__Python__Timer__create(void* context);
void Bun__Python__Timer__set(BunPythonTimer*, JSC::JSGlobalObject*, int64_t nanoseconds, bool keepsLoopAlive);
void Bun__Python__Timer__cancel(BunPythonTimer*, JSC::JSGlobalObject*);
void Bun__Python__Timer__destroy(BunPythonTimer*, JSC::JSGlobalObject*);
bool Bun__Python__turnEventLoop(JSC::JSGlobalObject*);
void Bun__Python__callsAreOwed(void* bunVM);
#if !OS(WINDOWS)
BunPythonFdWatcher* Bun__Python__FdWatcher__create(JSC::JSGlobalObject*, int fd, void* context, bool keepsLoopAlive, int* error);
void Bun__Python__FdWatcher__setKeepsLoopAlive(BunPythonFdWatcher*, JSC::JSGlobalObject*, bool);
void Bun__Python__FdWatcher__destroy(BunPythonFdWatcher*);
#endif
}

namespace Bun {
namespace PythonModules {

namespace {

// What a timer or a watcher calls.
struct Listener {
    virtual ~Listener() = default;
    virtual void happened() = 0;
};

struct Flag final : Listener {
    void happened() final { isSet = true; }
    bool isSet { false };
};

} // namespace

extern "C" void Bun__Python__eventHappened(void* context)
{
    static_cast<Listener*>(context)->happened();
}

// ---- Exceptions that reach the event loop ----

// The exception that is propagating has nothing above it but the event loop: the program is over.
void exitWithUncaughtPythonException(JSGlobalObject* globalObject)
{
    exitWithPythonStatus(globalObject, handleUncaughtException(globalObject));
}

// ---- Calls owed ----

// How many waits (below) are in progress. What is owed is theirs to call then: what a signal handler raises is raised in the
// code that waits.
static thread_local unsigned t_waitDepth;

static void callsAreOwed(VM& vm)
{
    Bun__Python__callsAreOwed(WebCore::clientData(vm)->bunVM);
}

// What other threads have left for the thread of an event loop to do.
static Lock s_callsForEventLoopThreadsLock;
static Vector<std::pair<VM*, Function<void()>>> s_callsForEventLoopThreads WTF_GUARDED_BY_LOCK(s_callsForEventLoopThreadsLock);
static std::atomic<bool> s_hasCallsForEventLoopThreads;

void callOnEventLoopThread(VM& vm, Function<void()>&& function)
{
    auto& runtimes = vm.heap.pythonRuntimes();
    if (runtimes.isEmpty() || runtimes.first()->threads().isMainThread()) {
        function();
        return;
    }
    {
        Locker locker { s_callsForEventLoopThreadsLock };
        s_callsForEventLoopThreads.append({ &vm, WTF::move(function) });
        s_hasCallsForEventLoopThreads.store(true);
    }
    callsAreOwed(vm);
}

static void makeCallsForEventLoopThread(VM& vm)
{
    if (!s_hasCallsForEventLoopThreads.load()) [[likely]]
        return;
    Vector<Function<void()>> functions;
    {
        Locker locker { s_callsForEventLoopThreadsLock };
        s_callsForEventLoopThreads.removeAllMatching([&](auto& entry) {
            if (entry.first != &vm)
                return false;
            functions.append(WTF::move(entry.second));
            return true;
        });
        s_hasCallsForEventLoopThreads.store(!s_callsForEventLoopThreads.isEmpty());
    }
    for (auto& function : functions)
        function();
}

extern "C" void Bun__Python__makeCallsOwed(JSGlobalObject* globalObject)
{
    makeCallsForEventLoopThread(getVM(globalObject));
    if (t_waitDepth)
        return;
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    makeCallsOwed(vm);
    if (scope.exception()) [[unlikely]]
        exitWithUncaughtPythonException(globalObject);
}

// ---- Waiting for descriptors: the event loop turns meanwhile ----

#if !OS(WINDOWS)

// A queue that is readable when one of the descriptors of a Poll or a Select request is ready. Negative: there is no telling.
static int queueFor(const WaitRequest& request)
{
    UncheckedKeyHashMap<int, short, WTF::IntHash<int>, WTF::UnsignedWithZeroKeyHashTraits<int>> interests;
    auto add = [&](int descriptor, short events) {
        interests.add(descriptor, 0).iterator->value |= events;
    };
    if (request.kind == WaitRequest::Kind::Poll) {
        for (nfds_t i = 0; i < request.descriptorCount; ++i) {
            if (request.descriptors[i].fd >= 0)
                add(request.descriptors[i].fd, request.descriptors[i].events);
        }
    } else {
        for (int descriptor = 0; descriptor < request.selectLimit; ++descriptor) {
            if (request.readable && FD_ISSET(descriptor, request.readable))
                add(descriptor, POLLIN);
            if (request.writable && FD_ISSET(descriptor, request.writable))
                add(descriptor, POLLOUT);
            if (request.exceptional && FD_ISSET(descriptor, request.exceptional))
                add(descriptor, POLLPRI);
        }
    }
#if OS(LINUX)
    int queue = epoll_create1(EPOLL_CLOEXEC);
    if (queue < 0)
        return -1;
    for (auto& interest : interests) {
        // The bits of poll() and of epoll are the same.
        struct epoll_event event { };
        event.events = static_cast<uint32_t>(static_cast<unsigned short>(interest.value));
        event.data.fd = interest.key;
        if (epoll_ctl(queue, EPOLL_CTL_ADD, interest.key, &event) < 0) {
            close(queue);
            return -1;
        }
    }
    return queue;
#elif PY_HAVE_KQUEUE
    int queue = kqueue();
    if (queue < 0)
        return -1;
    for (auto& interest : interests) {
        struct kevent changes[2];
        int count = 0;
        if (interest.value & (POLLIN | POLLPRI))
            EV_SET(&changes[count++], interest.key, EVFILT_READ, EV_ADD, 0, 0, nullptr);
        if (interest.value & POLLOUT)
            EV_SET(&changes[count++], interest.key, EVFILT_WRITE, EV_ADD, 0, 0, nullptr);
        if (count && kevent(queue, changes, count, nullptr, 0, nullptr) < 0) {
            close(queue);
            return -1;
        }
    }
    return queue;
#else
    return -1;
#endif
}

static int waitWhileTheLoopTurns(JSGlobalObject* globalObject, WaitRequest& request)
{
    int result = waitWithoutBlocking(request);
    if (result || !request.timeout)
        return result;

    bool isQueue = request.kind == WaitRequest::Kind::Epoll || request.kind == WaitRequest::Kind::Kqueue;
    int queue = isQueue ? request.queue : queueFor(request);
    if (queue < 0)
        return blockingWait(globalObject, request);

    VM& vm = getVM(globalObject);
    Flag isReady;
    Flag timeIsUp;
    int error = 0;
    BunPythonFdWatcher* watcher = Bun__Python__FdWatcher__create(globalObject, queue, &isReady, true, &error);
    if (!watcher) {
        if (!isQueue)
            close(queue);
        return blockingWait(globalObject, request);
    }
    BunPythonTimer* timer = nullptr;
    if (request.timeout > 0) {
        timer = Bun__Python__Timer__create(&timeIsUp);
        Bun__Python__Timer__set(timer, globalObject, request.timeout, true);
    }

    ++t_waitDepth;
    while (true) {
        // Signal handlers, finalizers: whoever waits calls them, and waits again.
        if (vm.traps().needHandling(VMTraps::NeedPythonCalls)) {
            result = -1;
            error = EINTR;
            break;
        }
        if (!Bun__Python__turnEventLoop(globalObject)) {
            auto scope = DECLARE_THROW_SCOPE(vm);
            if (!scope.exception())
                vm.throwTerminationException();
            result = -1;
            error = EINTR;
            break;
        }
        if (!isReady.isSet && !timeIsUp.isSet)
            continue;
        isReady.isSet = false;
        result = waitWithoutBlocking(request);
        error = errno;
        if (result || timeIsUp.isSet)
            break;
    }
    --t_waitDepth;

    Bun__Python__FdWatcher__destroy(watcher);
    if (timer)
        Bun__Python__Timer__destroy(timer, globalObject);
    if (!isQueue)
        close(queue);
    errno = error;
    return result;
}

#endif // !OS(WINDOWS)

// ---- The module _bun_loop: timers and watchers for src/python/_bun_asyncio.py ----

namespace {

struct CallbackListener : Listener {
    CallbackListener(JSGlobalObject* globalObject, JSValue callback)
        : globalObject(globalObject)
        , callback(getVM(globalObject), callback)
    {
    }

    void happened() final
    {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(getVM(globalObject));
        call(globalObject, callback.get());
        // asyncio deals with what callbacks raise, except for what is to end the program: SystemExit, KeyboardInterrupt.
        if (scope.exception()) [[unlikely]]
            exitWithUncaughtPythonException(globalObject);
    }

    JSGlobalObject* globalObject;
    Strong<Unknown> callback;
};

struct TimerState final : CallbackListener {
    static constexpr bool belongsToEventLoop = true;
    using CallbackListener::CallbackListener;
    ~TimerState() { close(); }

    void close()
    {
        if (timer)
            Bun__Python__Timer__destroy(std::exchange(timer, nullptr), globalObject);
    }

    BunPythonTimer* timer { nullptr };
};

#if !OS(WINDOWS)
struct WatcherState final : CallbackListener {
    static constexpr bool belongsToEventLoop = true;
    using CallbackListener::CallbackListener;
    ~WatcherState() { close(); }

    void close()
    {
        if (watcher)
            Bun__Python__FdWatcher__destroy(std::exchange(watcher, nullptr));
    }

    BunPythonFdWatcher* watcher { nullptr };
};
#endif

} // namespace

static JSValue timerNew(JSGlobalObject* globalObject, JSValue cls, JSValue callback)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (failed(scope, ensureMainThreadForJS(globalObject)))
        return { };
    auto state = makeUniqueWithoutFastMallocCheck<TimerState>(globalObject, callback);
    state->timer = Bun__Python__Timer__create(static_cast<Listener*>(state.get()));
    RELEASE_AND_RETURN(scope, createRecordWithState(globalObject, PyType::from(cls), 0, WTF::move(state)));
}

static JSValue timerSet(JSGlobalObject* globalObject, JSValue self, JSValue seconds)
{
    if (!ensureMainThreadForJS(globalObject))
        return { };
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    double delay = toDouble(globalObject, seconds);
    RETURN_IF_EXCEPTION(scope, { });
    auto* state = stateOf<TimerState>(self);
    if (!state->timer)
        return raiseValueError(globalObject, scope, "the timer is closed"_s);
    Bun__Python__Timer__set(state->timer, globalObject, delay >= 9e9 ? std::numeric_limits<int64_t>::max() : static_cast<int64_t>(std::ceil(std::max(delay, 0.0) * 1e9)), true);
    return jsUndefined();
}

static JSValue timerCancel(JSGlobalObject* globalObject, JSValue self)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (failed(scope, ensureMainThreadForJS(globalObject)))
        return { };
    if (auto* timer = stateOf<TimerState>(self)->timer)
        Bun__Python__Timer__cancel(timer, globalObject);
    return jsUndefined();
}

static JSValue timerClose(JSGlobalObject* globalObject, JSValue self)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (failed(scope, ensureMainThreadForJS(globalObject)))
        return { };
    stateOf<TimerState>(self)->close();
    return jsUndefined();
}

static constexpr NativeDef timerMethods[] = {
    PY_NEW(timerNew, "($type, callback, /)"),
    PY_METHOD("set", timerSet, "($self, seconds, /)"),
    PY_METHOD("cancel", timerCancel, "($self, /)"),
    PY_METHOD("close", timerClose, "($self, /)"),
};
static constexpr TypeDef timerTypeDef { "_bun_loop.Timer"_s, { TypeFlag::Immutable }, timerMethods, {}, {} };

#if !OS(WINDOWS)
static JSValue watcherNew(JSGlobalObject* globalObject, JSValue cls, JSValue descriptor, JSValue callback)
{
    if (!ensureMainThreadForJS(globalObject))
        return { };
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int fd = toCInt(globalObject, descriptor);
    RETURN_IF_EXCEPTION(scope, { });
    auto state = makeUniqueWithoutFastMallocCheck<WatcherState>(globalObject, callback);
    int error = 0;
    state->watcher = Bun__Python__FdWatcher__create(globalObject, fd, static_cast<Listener*>(state.get()), false, &error);
    if (!state->watcher)
        return raiseOSError(globalObject, scope, error);
    RELEASE_AND_RETURN(scope, createRecordWithState(globalObject, PyType::from(cls), 0, WTF::move(state)));
}

static JSValue watcherKeepAlive(JSGlobalObject* globalObject, JSValue self, JSValue keepsAlive)
{
    if (!ensureMainThreadForJS(globalObject))
        return { };
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool value = isTrue(globalObject, keepsAlive);
    RETURN_IF_EXCEPTION(scope, { });
    if (auto* watcher = stateOf<WatcherState>(self)->watcher)
        Bun__Python__FdWatcher__setKeepsLoopAlive(watcher, globalObject, value);
    return jsUndefined();
}

static JSValue watcherClose(JSGlobalObject* globalObject, JSValue self)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (failed(scope, ensureMainThreadForJS(globalObject)))
        return { };
    stateOf<WatcherState>(self)->close();
    return jsUndefined();
}

static constexpr NativeDef watcherMethods[] = {
    PY_NEW(watcherNew, "($type, fd, callback, /)"),
    PY_METHOD("keep_alive", watcherKeepAlive, "($self, value, /)"),
    PY_METHOD("close", watcherClose, "($self, /)"),
};
static constexpr TypeDef watcherTypeDef { "_bun_loop.Watcher"_s, { TypeFlag::Immutable }, watcherMethods, {}, {} };
#endif

void initializeBunLoopModule(JSGlobalObject* globalObject, PyModule* module)
{
    Runtime& rt = runtime(globalObject);
    module->add(globalObject, "Timer"_s, rt.typeFor(timerTypeDef));
#if !OS(WINDOWS)
    module->add(globalObject, "Watcher"_s, rt.typeFor(watcherTypeDef));
#endif
}

void installPythonEventLoop()
{
    setCallsOwedFunction(callsAreOwed);
    setEventLoopModule("_bun_asyncio"_s);
    setImportSystemModule("_bun_import"_s);
#if !OS(WINDOWS)
    setWaitFunction(waitWhileTheLoopTurns);
#endif
}

} // namespace PythonModules
} // namespace Bun
