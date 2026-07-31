#include "root.h"

#include "BunDebugger.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/InspectorFrontendChannel.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <wtf/threads/BinarySemaphore.h>
#include <JavaScriptCore/JSGlobalObjectDebuggable.h>
#include <JavaScriptCore/JSGlobalObjectDebugger.h>
#include <JavaScriptCore/Debugger.h>
#include <JavaScriptCore/HeapIterationScope.h>
#include <JavaScriptCore/IsoCellSetInlines.h>
#include <wtf/Condition.h>
#include <wtf/NeverDestroyed.h>
#include "ScriptExecutionContext.h"
#include "debug-helpers.h"
#include "BunInjectedScriptHost.h"
#include <JavaScriptCore/JSGlobalObjectInspectorController.h>
#include <wtf/JSONValues.h>

#include "InspectorLifecycleAgent.h"
#include "InspectorTestReporterAgent.h"
#include "InspectorBunFrontendDevServerAgent.h"
#include "InspectorHTTPServerAgent.h"

extern "C" void Bun__tickWhilePaused(bool*);
extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);

namespace Bun {
using namespace JSC;
using namespace WebCore;

class BunInspectorConnection;

static WebCore::ScriptExecutionContext* debuggerScriptExecutionContext = nullptr;
static WTF::Lock inspectorConnectionsLock = WTF::Lock();
static WTF::UncheckedKeyHashMap<ScriptExecutionContextIdentifier, Vector<RefPtr<BunInspectorConnection>, 8>>* inspectorConnections = nullptr;

// When the inspected JS thread is paused at a breakpoint (inside runWhilePaused),
// it waits on this condition for the debugger thread to deliver new messages or
// for a connection status change. This replaces a busy spin loop that would pin
// one core at 100% CPU while paused. Wrapped in a function-local static so it
// doesn't add a static initializer to the binary.
struct PausedWait {
    WTF::Lock lock;
    WTF::Condition condition;
};

static PausedWait& pausedWait()
{
    static PausedWait instance;
    return instance;
}

// Count of messages handed off from the inspected (main) thread to the
// debugger thread via sendMessageToDebuggerThread() that haven't yet had
// their corresponding onMessage/write() call invoked on the debugger thread.
// Bun__debugger__drain() reads this only as an entry gate -- "is any handoff
// still pending?" -- to decide whether to post its FIFO sentinel task; it
// does NOT spin-wait for the count to reach zero (the sentinel's FIFO
// ordering is what guarantees the handoff has caught up, not this counter).
//
// DISCLOSURE: this is process-global static state (like
// debuggerScriptExecutionContext above), not per-VM or per-connection. A
// process that opens more than one debugger connection -- e.g. a main VM
// plus a WebWorker, each with their own inspector -- shares a single count
// across all of them. That is fine for Bun__debugger__drain()'s use (any
// pending handoff, from any connection, is reason enough to wait), but it
// does mean this counter cannot answer "is *this specific* connection's
// handoff caught up?".
static std::atomic<uint64_t> totalPendingDebuggerMessages { 0 };

// Set (never cleared) the first time any message is queued for the debugger
// thread via sendMessageToDebuggerThread(). Also process-global, for the
// same reason as totalPendingDebuggerMessages above.
//
// Bun__debugger__drain()'s layer-(b) flush grace uses this -- not
// totalPendingDebuggerMessages -- as its gate: that counter decrements back
// to zero as soon as write() has been called for a message, even though the
// bytes it produced can still be sitting unflushed in the socket layer below
// write() (exactly the case the flush grace exists to help). This flag,
// by contrast, stays true for the rest of the process's life once anything
// has ever been queued, so it can safely answer the coarser question
// Bun__debugger__drain() actually needs -- "has any message ever been
// queued for delivery, so there is any chance of pending output to flush?"
// -- without needing to introspect the debugger thread's live buffer state.
// If this is still false, nothing was ever queued, so there is provably
// nothing to flush and the grace wait can be skipped outright.
static std::atomic<bool> hasQueuedAnyDebuggerMessage { false };

static bool waitingForConnection = false;
static bool bunControllerInstalled = false;
// Tracks whether connectFrontend has ever been called on the Bun-installed
// inspector controller; once true, the exit path must leak that controller
// (see Bun__InspectorConnection__disconnectAllOnExit) even if every
// connection has since disconnected and been removed from inspectorConnections.
static bool bunControllerHasEverConnected = false;
extern "C" void Debugger__didConnect();

class BunJSGlobalObjectDebuggable final : public JSC::JSGlobalObjectDebuggable {
public:
    using Base = JSC::JSGlobalObjectDebuggable;

    BunJSGlobalObjectDebuggable(JSC::JSGlobalObject& globalObject)
        : Base(globalObject)
    {
    }

    ~BunJSGlobalObjectDebuggable() final
    {
    }

    static Ref<BunJSGlobalObjectDebuggable> create(JSGlobalObject& globalObject)
    {
        return adoptRef(*new BunJSGlobalObjectDebuggable(globalObject));
    }

    void pauseWaitingForAutomaticInspection() override
    {
    }
    void unpauseForResolvedAutomaticInspection() override
    {
        if (waitingForConnection) {
            waitingForConnection = false;
            Debugger__didConnect();
        }
    }
};

enum class ConnectionStatus : int32_t {
    Pending = 0,
    Connected = 1,
    Disconnecting = 2,
    Disconnected = 3,
};

class BunInspectorConnection : public ThreadSafeRefCounted<BunInspectorConnection>, public Inspector::FrontendChannel {

public:
    BunInspectorConnection(ScriptExecutionContext& scriptExecutionContext, JSC::JSGlobalObject* globalObject, bool shouldRefEventLoop)
        : Inspector::FrontendChannel()
        , globalObject(globalObject)
        , scriptExecutionContextIdentifier(scriptExecutionContext.identifier())
        , unrefOnDisconnect(shouldRefEventLoop)
    {
    }

    ~BunInspectorConnection()
    {
    }

    static Ref<BunInspectorConnection> create(ScriptExecutionContext& scriptExecutionContext, JSC::JSGlobalObject* globalObject, bool shouldRefEventLoop)
    {
        return adoptRef(*new BunInspectorConnection(scriptExecutionContext, globalObject, shouldRefEventLoop));
    }

    ConnectionType connectionType() const override
    {
        return ConnectionType::Remote;
    }

    void doConnect(WebCore::ScriptExecutionContext& context)
    {
        this->status = ConnectionStatus::Connected;
        auto* globalObject = context.jsGlobalObject();
        if (this->unrefOnDisconnect) {
            Bun__eventLoop__incrementRefConcurrently(static_cast<Zig::GlobalObject*>(globalObject)->bunVM(), 1);
        }
        globalObject->setInspectable(true);
        auto& inspector = globalObject->inspectorDebuggable();
        inspector.setInspectable(true);

        static bool hasConnected = false;

        if (!hasConnected) {
            hasConnected = true;
            globalObject->inspectorController().registerAlternateAgent(
                WTF::makeUniqueRef<Inspector::InspectorLifecycleAgent>(*globalObject));
            globalObject->inspectorController().registerAlternateAgent(
                WTF::makeUniqueRef<Inspector::InspectorTestReporterAgent>(*globalObject));
            globalObject->inspectorController().registerAlternateAgent(
                WTF::makeUniqueRef<Inspector::InspectorBunFrontendDevServerAgent>(*globalObject));
            globalObject->inspectorController().registerAlternateAgent(
                WTF::makeUniqueRef<Inspector::InspectorHTTPServerAgent>(*globalObject));
        }

        this->hasEverConnected = true;
        bunControllerHasEverConnected = true;
        globalObject->inspectorController().connectFrontend(*this, true, false); // waitingForConnection

        Inspector::JSGlobalObjectDebugger* debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(globalObject->debugger());
        if (debugger) {
            debugger->runWhilePausedCallback = [](JSC::JSGlobalObject& globalObject, bool& isDoneProcessingEvents) -> void {
                BunInspectorConnection::runWhilePaused(globalObject, isDoneProcessingEvents);
            };
        }

        this->receiveMessagesOnInspectorThread(context, static_cast<Zig::GlobalObject*>(globalObject), false);
    }

    void connect()
    {
        switch (this->status) {
        case ConnectionStatus::Disconnected:
        case ConnectionStatus::Disconnecting: {
            return;
        }
        default: {
            break;
        }
        }

        notifyPausedThread();

        ScriptExecutionContext::ensureOnContextThread(scriptExecutionContextIdentifier, [connection = Ref { *this }](ScriptExecutionContext& context) {
            switch (connection->status) {
            case ConnectionStatus::Pending: {
                connection->doConnect(context);
                break;
            }
            default: {
                break;
            }
            }
        });
    }

    void disconnect()
    {
        notifyPausedThread();

        switch (this->status) {
        case ConnectionStatus::Disconnected: {
            return;
        }
        default: {
            break;
        }
        }

        ScriptExecutionContext::ensureOnContextThread(scriptExecutionContextIdentifier, [connection = Ref { *this }](ScriptExecutionContext& context) {
            if (connection->status == ConnectionStatus::Disconnected)
                return;

            connection->status = ConnectionStatus::Disconnected;

            // Do not call .disconnect() if we never actually connected.
            if (connection->hasEverConnected) {
                connection->inspector().disconnect(connection.get());
            }

            if (connection->unrefOnDisconnect) {
                connection->unrefOnDisconnect = false;
                Bun__eventLoop__incrementRefConcurrently(static_cast<Zig::GlobalObject*>(context.jsGlobalObject())->bunVM(), -1);
            }

            {
                Locker<Lock> locker(inspectorConnectionsLock);
                if (inspectorConnections) {
                    auto it = inspectorConnections->find(connection->scriptExecutionContextIdentifier);
                    if (it != inspectorConnections->end())
                        it->value.removeFirstMatching([&](auto& c) { return c.get() == connection.ptr(); });
                }
            }
        });
    }

    JSC::JSGlobalObjectDebuggable& inspector()
    {
        return globalObject->inspectorDebuggable();
    }

    void sendMessageToFrontend(const String& message) override
    {
        if (message.length() == 0)
            return;

        this->sendMessageToDebuggerThread(message.isolatedCopy());
    }

    static void runWhilePaused(JSGlobalObject& globalObject, bool& isDoneProcessingEvents)
    {
        Zig::GlobalObject* global = static_cast<Zig::GlobalObject*>(&globalObject);
        Vector<RefPtr<BunInspectorConnection>, 8> connections;
        {
            Locker<Lock> locker(inspectorConnectionsLock);
            connections.appendVector(inspectorConnections->get(global->scriptExecutionContext()->identifier()));
        }

        for (auto& connection : connections) {
            if (connection->status == ConnectionStatus::Pending) {
                connection->connect();
                continue;
            }

            if (connection->status != ConnectionStatus::Disconnected) {
                connection->receiveMessagesOnInspectorThread(*global->scriptExecutionContext(), global, true);
            }
        }

        while (!isDoneProcessingEvents) {
            size_t closedCount = 0;
            for (auto& connection : connections) {
                ConnectionStatus status = connection->status.load();
                if (status == ConnectionStatus::Disconnected || status == ConnectionStatus::Disconnecting) {
                    closedCount++;
                    continue;
                }
                connection->receiveMessagesOnInspectorThread(*global->scriptExecutionContext(), global, true);
                if (isDoneProcessingEvents)
                    break;
            }

            if (isDoneProcessingEvents)
                break;

            if (closedCount == connections.size()) {
                if (global->debugger() && global->debugger()->isPaused()) {
                    global->debugger()->continueProgram();
                }
                break;
            }

            // Block until the debugger thread delivers a new message or a
            // connection disconnects. Use a timeout as a safety net so that a
            // missed wakeup cannot leave the process stuck forever; with no
            // messages we'll simply re-check once per second instead of
            // spinning at 100% CPU.
            {
                auto& wait = pausedWait();
                Locker<Lock> waitLocker(wait.lock);
                if (!isDoneProcessingEvents && !anyConnectionHasPendingWork(connections, closedCount)) {
                    wait.condition.waitFor(wait.lock, Seconds(1));
                }
            }
        }
    }

    static bool anyConnectionHasPendingWork(const Vector<RefPtr<BunInspectorConnection>, 8>& connections, size_t previousClosedCount)
    {
        size_t closedCount = 0;
        for (auto& connection : connections) {
            ConnectionStatus status = connection->status.load();
            if (status == ConnectionStatus::Disconnected || status == ConnectionStatus::Disconnecting) {
                closedCount++;
                continue;
            }

            Locker<Lock> locker(connection->jsThreadMessagesLock);
            if (!connection->jsThreadMessages.isEmpty())
                return true;
        }
        // A connection that was already counted as closed by the caller is
        // not new work and must not keep us from sleeping (otherwise one
        // closed connection among several would cause us to spin). Only
        // treat a *change* in the closed count as pending work so the outer
        // loop re-evaluates whether every connection is gone.
        return closedCount != previousClosedCount;
    }

    // Wake the inspected thread if it is blocked inside runWhilePaused.
    // Safe to call from any thread; cheap when nobody is waiting.
    static void notifyPausedThread()
    {
        auto& wait = pausedWait();
        Locker<Lock> locker(wait.lock);
        wait.condition.notifyAll();
    }

    // Debugger.setBreakpointsActive triggers Debugger::setBreakpointsActivated
    // → recompileAllJSFunctions → vm.deleteAllCode, which iterates each
    // ScriptExecutable subspace's clearableCodeSet and calls clearCode. For
    // ModuleProgramExecutable, clearCode drops m_unlinkedCodeBlock and
    // m_moduleEnvironmentSymbolTable; the next executeModuleProgram (a
    // top-level-await resume, or a linked-but-not-yet-evaluated module)
    // regenerates the unlinked code block under the now-different
    // CodeGenerationMode::Debugger, whose module-environment / generator-frame
    // layout no longer matches the live JSModuleEnvironment, and the next
    // op_put_to_scope writes past it. This is the invariant documented in
    // UnlinkedModuleProgramCodeBlock.h. Module bodies execute once, so dropping
    // their unlinked code block cannot recover debug hooks for the body anyway
    // (inner functions are recompiled independently via
    // deleteAllUnlinkedCodeBlocks); pre-removing every module executable from
    // the clearableCodeSet makes deleteAllCodeBlocks skip them and keeps the
    // original bytecode in place. Registered via whenIdle so it runs ahead of
    // any deferred deleteAllCode callback regardless of whether the dispatch
    // happens with a VMEntryScope on the stack (the run-while-paused case).
    static void protectModuleExecutablesFromClearCode(JSC::VM& vm)
    {
        if (auto* spaceAndSet = vm.heap.m_moduleProgramExecutableSpace.get()) {
            JSC::HeapIterationScope iterationScope(vm.heap);
            auto& set = spaceAndSet->clearableCodeSet;
            set.forEachLiveCell([&](JSC::HeapCell* cell, JSC::HeapCell::Kind) {
                set.remove(cell);
            });
        }
    }

    void receiveMessagesOnInspectorThread(ScriptExecutionContext& context, Zig::GlobalObject* globalObject, bool connectIfNeeded)
    {
        // Connect before swapping the queue: doConnect recursively calls this
        // function, so connecting after the swap would dispatch messages that
        // arrived during connectFrontend (batch B) ahead of the already-swapped
        // earlier batch A. Connecting first means the inner call drains
        // everything queued so far in order, and the swap below only sees
        // strictly-newer messages.
        if (connectIfNeeded && this->status == ConnectionStatus::Pending) {
            this->doConnect(context);
        }

        this->jsThreadMessageScheduledCount.store(0);
        WTF::Vector<WTF::String, 12> messages;

        {
            Locker<Lock> locker(jsThreadMessagesLock);
            this->jsThreadMessages.swap(messages);
        }

        if (!messages.isEmpty()) {
            auto& vm = globalObject->vm();
            vm.whenIdle([&vm] {
                protectModuleExecutablesFromClearCode(vm);
            });
        }

        auto& dispatcher = globalObject->inspectorDebuggable();
        Inspector::JSGlobalObjectDebugger* debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(globalObject->debugger());

        // JSC's frontendInitialized() only calls unpauseForResolvedAutomaticInspection
        // when m_isAutomaticInspection is true, but disconnectFrontend() on any
        // connection clears it. A previous connection's disconnect task can land
        // between this connection's connect and its Inspector.initialized dispatch,
        // so resolve waitForDebugger directly when we see the command instead of
        // relying on that JSC path.
        auto resolveWaitIfInitialized = [](const WTF::String& message) {
            if (waitingForConnection && message.contains("\"method\":\"Inspector.initialized\""_s)) {
                waitingForConnection = false;
                Debugger__didConnect();
            }
        };

        if (!debugger) {
            for (auto message : messages) {
                resolveWaitIfInitialized(message);
                dispatcher.dispatchMessageFromRemote(WTF::move(message));

                if (!debugger) {
                    debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(globalObject->debugger());
                    if (debugger) {
                        debugger->runWhilePausedCallback = [](JSC::JSGlobalObject& globalObject, bool& isDoneProcessingEvents) -> void {
                            runWhilePaused(globalObject, isDoneProcessingEvents);
                        };
                    }
                }
            }
        } else {
            for (auto message : messages) {
                resolveWaitIfInitialized(message);
                dispatcher.dispatchMessageFromRemote(WTF::move(message));
            }
        }

        messages.clear();
    }

    void receiveMessagesOnDebuggerThread(ScriptExecutionContext& context, Zig::GlobalObject* debuggerGlobalObject)
    {
        debuggerThreadMessageScheduledCount.store(0);
        WTF::Vector<WTF::String, 12> messages;

        {
            Locker<Lock> locker(debuggerThreadMessagesLock);
            this->debuggerThreadMessages.swap(messages);
        }

        size_t messageCount = messages.size();

        if (!jsBunDebuggerOnMessageFunction) {
            // Disconnected (jsFunctionDisconnect cleared the callback): this
            // batch is dropped, never reaching write(). Mark its handoff
            // complete, or Bun__debugger__drain()'s entry gate would treat it
            // as pending forever.
            if (messageCount > 0)
                totalPendingDebuggerMessages.fetch_sub(messageCount, std::memory_order_release);
            return;
        }

        JSFunction* onMessageFn = uncheckedDowncast<JSFunction>(jsBunDebuggerOnMessageFunction.get());
        MarkedArgumentBuffer arguments;
        arguments.ensureCapacity(messageCount);
        auto& vm = debuggerGlobalObject->vm();
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

        for (auto& message : messages) {
            arguments.append(jsString(vm, message));
        }

        messages.clear();

        JSC::call(debuggerGlobalObject, onMessageFn, arguments, "BunInspectorConnection::receiveMessagesOnDebuggerThread - onMessageFn"_s);

        // After JSC::call, so onMessageFn (which calls into debugger.ts's
        // webSocketWriter/bufferedWriter write()) has been invoked for every
        // message in this batch. See Bun__debugger__drain(). If onMessageFn
        // threw partway through the batch, there is no way to know how many
        // of the messages it was given actually made it to write() before
        // the throw, so the whole batch is conservatively treated as
        // undelivered (the count is left pending) rather than risking an
        // undercount that would let Bun__debugger__drain() skip a wait for a
        // message that never actually got written. The cost of that
        // conservatism is bounded: Bun__debugger__drain() only reads this
        // counter once as an entry gate for waits already capped at
        // kDrainHandoffTimeoutMs (250ms) / kDrainFlushGraceMs (150ms), so an
        // over-retained count costs at most one extra capped wait at exit,
        // never a stall.
        bool delivered = true;
        if (auto* exception = scope.exception()) [[unlikely]] {
            delivered = false;
            if (scope.clearExceptionExceptTermination())
                debuggerGlobalObject->reportUncaughtExceptionAtEventLoop(debuggerGlobalObject, exception);
            // else: termination exception -- left uncleared so it keeps
            // propagating, and (as with any other exception here) not
            // reported, since the process is already on its way down.
        }
        if (messageCount > 0 && delivered)
            totalPendingDebuggerMessages.fetch_sub(messageCount, std::memory_order_release);
    }

    void sendMessageToDebuggerThread(WTF::String&& inputMessage)
    {
        {
            Locker<Lock> locker(debuggerThreadMessagesLock);
            debuggerThreadMessages.append(inputMessage);
            // Incremented inside the same locked section as the append,
            // before the lock is released. Incrementing after unlocking would
            // race receiveMessagesOnDebuggerThread(), which could swap the
            // vector out (and later decrement by the batch size) before this
            // increment ran, undercounting totalPendingDebuggerMessages.
            totalPendingDebuggerMessages.fetch_add(1, std::memory_order_release);
            // Never cleared -- see the declaration above for why this is a
            // separate flag from totalPendingDebuggerMessages.
            hasQueuedAnyDebuggerMessage.store(true, std::memory_order_release);
        }

        if (this->debuggerThreadMessageScheduledCount++ == 0) {
            debuggerScriptExecutionContext->postTaskConcurrently([connection = Ref { *this }](ScriptExecutionContext& context) {
                connection->receiveMessagesOnDebuggerThread(context, static_cast<Zig::GlobalObject*>(context.jsGlobalObject()));
            });
        }
    }

    void sendMessageToInspectorFromDebuggerThread(Vector<WTF::String, 12>&& inputMessages)
    {
        {
            Locker<Lock> locker(jsThreadMessagesLock);
            jsThreadMessages.appendVector(inputMessages);
        }

        notifyPausedThread();

        if (this->jsThreadMessageScheduledCount++ == 0) {
            ScriptExecutionContext::postTaskTo(scriptExecutionContextIdentifier, [connection = Ref { *this }](ScriptExecutionContext& context) {
                connection->receiveMessagesOnInspectorThread(context, static_cast<Zig::GlobalObject*>(context.jsGlobalObject()), true);
            });
        }
    }

    void sendMessageToInspectorFromDebuggerThread(const WTF::String& inputMessage)
    {
        {
            Locker<Lock> locker(jsThreadMessagesLock);
            jsThreadMessages.append(inputMessage);
        }

        notifyPausedThread();

        if (this->jsThreadMessageScheduledCount++ == 0) {
            ScriptExecutionContext::postTaskTo(scriptExecutionContextIdentifier, [connection = Ref { *this }](ScriptExecutionContext& context) {
                connection->receiveMessagesOnInspectorThread(context, static_cast<Zig::GlobalObject*>(context.jsGlobalObject()), true);
            });
        }
    }

    WTF::Vector<WTF::String, 12> debuggerThreadMessages;
    WTF::Lock debuggerThreadMessagesLock = WTF::Lock();
    std::atomic<uint32_t> debuggerThreadMessageScheduledCount { 0 };

    WTF::Vector<WTF::String, 12> jsThreadMessages;
    WTF::Lock jsThreadMessagesLock = WTF::Lock();
    std::atomic<uint32_t> jsThreadMessageScheduledCount { 0 };

    JSC::JSGlobalObject* globalObject;
    ScriptExecutionContextIdentifier scriptExecutionContextIdentifier;
    JSC::Strong<JSC::Unknown> jsBunDebuggerOnMessageFunction {};

    std::atomic<ConnectionStatus> status = ConnectionStatus::Pending;

    bool unrefOnDisconnect = false;

    bool hasEverConnected = false;
};

JSC_DECLARE_HOST_FUNCTION(jsFunctionSend);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDisconnect);

class JSBunInspectorConnection final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSBunInspectorConnection* create(JSC::VM& vm, JSC::Structure* structure, RefPtr<BunInspectorConnection>&& connection)
    {
        JSBunInspectorConnection* ptr = new (NotNull, JSC::allocateCell<JSBunInspectorConnection>(vm)) JSBunInspectorConnection(vm, structure, WTF::move(connection));
        ptr->finishCreation(vm);
        return ptr;
    }

    static void destroy(JSCell* cell)
    {
        static_cast<JSBunInspectorConnection*>(cell)->~JSBunInspectorConnection();
    }

    DECLARE_EXPORT_INFO;
    template<typename, SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSBunInspectorConnection, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForBunInspectorConnection.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBunInspectorConnection = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForBunInspectorConnection.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForBunInspectorConnection = std::forward<decltype(space)>(space); });
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), JSC::NonArray);
    }

    BunInspectorConnection* connection()
    {
        return m_connection.get();
    }

private:
    JSBunInspectorConnection(JSC::VM& vm, JSC::Structure* structure, RefPtr<BunInspectorConnection>&& connection)
        : Base(vm, structure)
        , m_connection(WTF::move(connection))
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
    }

    RefPtr<BunInspectorConnection> m_connection;
};

JSC_DEFINE_HOST_FUNCTION(jsFunctionSend, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* jsConnection = dynamicDowncast<JSBunInspectorConnection>(callFrame->thisValue());
    auto message = callFrame->uncheckedArgument(0);

    if (!jsConnection)
        return JSValue::encode(jsUndefined());

    if (message.isString()) {
        jsConnection->connection()->sendMessageToInspectorFromDebuggerThread(message.toWTFString(globalObject).isolatedCopy());
    } else if (message.isCell()) {
        auto* array = uncheckedDowncast<JSArray>(message.asCell());
        Vector<WTF::String, 12> messages;
        JSC::forEachInArrayLike(globalObject, array, [&](JSC::JSValue value) -> bool {
            messages.append(value.toWTFString(globalObject).isolatedCopy());
            return true;
        });
        jsConnection->connection()->sendMessageToInspectorFromDebuggerThread(WTF::move(messages));
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDisconnect, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* jsConnection = dynamicDowncast<JSBunInspectorConnection>(callFrame->thisValue());
    if (!jsConnection)
        return JSValue::encode(jsUndefined());

    auto& connection = *jsConnection->connection();

    if (connection.status == ConnectionStatus::Connected || connection.status == ConnectionStatus::Pending) {
        connection.status = ConnectionStatus::Disconnecting;
        connection.jsBunDebuggerOnMessageFunction.clear();
        connection.disconnect();
    }

    return JSValue::encode(jsUndefined());
}

const JSC::ClassInfo JSBunInspectorConnection::s_info = { "BunInspectorConnection"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBunInspectorConnection) };

extern "C" unsigned int Bun__createJSDebugger(Zig::GlobalObject* globalObject)
{
    {
        Locker<Lock> locker(inspectorConnectionsLock);
        if (inspectorConnections == nullptr) {
            inspectorConnections = new WTF::UncheckedKeyHashMap<ScriptExecutionContextIdentifier, Vector<RefPtr<BunInspectorConnection>, 8>>();
        }

        inspectorConnections->add(globalObject->scriptExecutionContext()->identifier(), Vector<RefPtr<BunInspectorConnection>, 8>());
    }

    return static_cast<unsigned int>(globalObject->scriptExecutionContext()->identifier());
}
extern "C" void Bun__tickWhilePaused(bool*);

extern "C" void Bun__ensureDebugger(ScriptExecutionContextIdentifier scriptId, bool pauseOnStart)
{

    auto* globalObject = ScriptExecutionContext::getScriptExecutionContext(scriptId)->jsGlobalObject();
    // JSGlobalObject::init() installs a default controller and debuggable, so
    // they are always non-null here; Bun must replace them with its own
    // (BunInjectedScriptHost, and BunJSGlobalObjectDebuggable's
    // unpauseForResolvedAutomaticInspection hook that resolves
    // wait-for-debugger). Once installed, never recreate: destroying a
    // controller that ever had a frontend attached — even a since-disconnected
    // one — trips the CheckedPtr ordering bug (see the exit-path comment
    // below). node:inspector re-enters this from waitForDebugger() at runtime.
    if (!bunControllerInstalled) {
        bunControllerInstalled = true;
        globalObject->m_inspectorController = makeUnique<Inspector::JSGlobalObjectInspectorController>(*globalObject, Bun::BunInjectedScriptHost::create());
        globalObject->m_inspectorDebuggable = BunJSGlobalObjectDebuggable::create(*globalObject);
        globalObject->m_inspectorDebuggable->init();
    }

    globalObject->setInspectable(true);

    auto& inspector = globalObject->inspectorDebuggable();
    inspector.setInspectable(true);

    Inspector::JSGlobalObjectDebugger* debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(globalObject->debugger());
    if (debugger) {
        debugger->runWhilePausedCallback = [](JSC::JSGlobalObject& globalObject, bool& isDoneProcessingEvents) -> void {
            BunInspectorConnection::runWhilePaused(globalObject, isDoneProcessingEvents);
        };
    }
    if (pauseOnStart) {
        waitingForConnection = true;
    }
}

// Small ref-counted signal so a wait that times out doesn't leave a dangling
// pointer for the debugger thread's already-posted task to dereference, and
// so nothing is deliberately leaked (Bun's leak-sanitizer builds treat that
// as a bug to fix -- see fba43af684, "Fix effectively every native-code
// memory leak in Bun"). Both the waiting thread (Bun__debugger__drain) and
// the posted task hold a reference via WTF::Ref (ThreadSafeRefCounted);
// whichever finishes last frees it.
struct DebuggerDrainSignal : public ThreadSafeRefCounted<DebuggerDrainSignal> {
public:
    static Ref<DebuggerDrainSignal> create() { return adoptRef(*new DebuggerDrainSignal()); }
    WTF::BinarySemaphore semaphore;

private:
    DebuggerDrainSignal() = default;
};

// Cap on how long the main thread waits, on exit, for the debugger thread to
// finish the pending main->debugger-thread message handoff (layer a). A cap,
// not a target: a wedged/starved debugger thread must never block process
// exit indefinitely.
static constexpr double kDrainHandoffTimeoutMs = 250;

// Additional bounded grace period, taken on exit whenever any message was
// ever queued for the debugger thread (see hasQueuedAnyDebuggerMessage
// above), for the debugger thread's own event loop to flush whatever it has
// already handed to the socket layer out of that layer's send buffer and
// onto the wire (layer b). Also a cap, not a target.
static constexpr double kDrainFlushGraceMs = 150;

// Called from the main (inspected) thread immediately before process exit
// (see VirtualMachine::global_exit in VirtualMachine.rs). Blocks briefly so
// the detached debugger thread isn't killed mid-delivery of queued inspector
// protocol messages -- without this, exit() tears down the debugger thread
// while messages are still queued or buffered, and the frontend misses the
// final events (most visibly the last TestReporter.start/end events from
// `bun test`, whose synchronous tests can queue right up to the same
// event-loop iteration that falls through to exit()).
//
// This addresses two distinct layers of loss:
//
//   (a) The main->debugger-thread message handoff itself
//       (sendMessageToDebuggerThread / receiveMessagesOnDebuggerThread).
//       totalPendingDebuggerMessages tracks messages queued but not yet
//       handed to onMessageFn; if any are pending we post a sentinel task and
//       wait (capped) for it to run. Concurrent tasks on this context are
//       FIFO, so once the sentinel runs, every receiveMessagesOnDebuggerThread
//       invocation posted before this call has already invoked write() for
//       every message it was holding.
//
//   (b) Whatever write() already handed to the socket layer may still be
//       sitting in that layer's own send buffer rather than on the wire --
//       e.g. a WebSocket send reporting backpressure means the message was
//       accepted but not yet flushed. That buffer only drains as the
//       debugger thread's own event loop services socket writability, which
//       keeps running independently of this (main) thread. This case is NOT
//       captured by totalPendingDebuggerMessages -- the handoff counter can
//       already be zero (write() was called, decrementing it) while bytes are
//       still buffered below write(). So the layer-(b) grace wait is gated on
//       hasQueuedAnyDebuggerMessage instead, independent of the layer-(a)
//       counter: gating it on that counter (as an earlier revision did) gave
//       a message already sitting in the send buffer zero grace whenever
//       there was no pending layer-(a) handoff at the moment of this call.
//       hasQueuedAnyDebuggerMessage avoids that specific bug while still
//       skipping the wait outright on the common case where nothing was ever
//       queued for this debugger connection to begin with (e.g. a debugger
//       attached but no messages were ever sent to it) -- in that case there
//       is provably no pending output, so the wait would be pure cost. This
//       intentionally adds a bounded (~kDrainFlushGraceMs) cost to every
//       exit where at least one message was queued for the debugger thread.
//
// Both waits are capped so a wedged/starved debugger thread, or a consumer
// that has stopped reading entirely, cannot block process exit indefinitely.
// On timeout we simply degrade to pre-fix behavior for whatever hasn't been
// delivered yet -- a truly non-reading consumer is inherently undeliverable
// (a zero TCP/socket window can't be waited past), so timing out there is
// correct, not a bug.
//
// SCOPE: this is exercised on graceful main-process exit paths only (see the
// `global_exit()` call sites in VirtualMachine.rs's callers -- CLI run/test/
// repl commands, `process.exit()`, bake production builds). Its behavior on
// a process torn down by a signal or `abort()` -- paths that do not run
// `global_exit()` -- is unverified by this change; no claim is made about
// those paths.
extern "C" void Bun__debugger__drain()
{
    if (debuggerScriptExecutionContext == nullptr)
        return;

    // Layer (a): if a main->debugger-thread handoff is still pending, wait for
    // it to catch up via a FIFO sentinel.
    if (totalPendingDebuggerMessages.load(std::memory_order_acquire) != 0) {
        auto signal = DebuggerDrainSignal::create();
        debuggerScriptExecutionContext->postTaskConcurrently([signal](ScriptExecutionContext&) {
            signal->semaphore.signal();
        });
        signal->semaphore.waitFor(WTF::Seconds::fromMilliseconds(kDrainHandoffTimeoutMs));
    }

    // Layer (b): give the debugger thread's own event loop a further bounded
    // grace period to flush anything still sitting in the socket layer's send
    // buffer to a normally-reading consumer. Gated on hasQueuedAnyDebuggerMessage
    // (see its declaration above) rather than run unconditionally: if nothing
    // was ever queued for this process's debugger thread, there is nothing
    // that could possibly still be buffered, so the wait is skipped outright.
    // When something WAS queued, we still can't tell from here whether it has
    // already fully flushed -- unlike layer (a), there is no main-thread-
    // visible counter for "bytes still buffered below write()": the layer-(a)
    // counter can already be zero while such bytes remain.
    //
    // This is a deliberately simple, coarsely-gated wait rather than a poll of
    // live buffer state: safely reading the debugger thread's JS-heap-owned
    // writer state from this (main) thread would need new cross-thread
    // synchronization whose surface area we judged not worth adding for a
    // best-effort exit-time extension. Reusing BinarySemaphore purely for its
    // timeout (nothing ever signals `topUp`) matches the existing
    // wait-with-timeout-as-sleep idiom already used in this file (see
    // pausedWait()'s `wait.condition.waitFor(wait.lock, Seconds(1))` above).
    if (hasQueuedAnyDebuggerMessage.load(std::memory_order_acquire)) {
        WTF::BinarySemaphore topUp;
        topUp.waitFor(WTF::Seconds::fromMilliseconds(kDrainFlushGraceMs));
    }
}

extern "C" void BunDebugger__willHotReload()
{
    if (debuggerScriptExecutionContext == nullptr) {
        return;
    }

    debuggerScriptExecutionContext->postTaskConcurrently([](ScriptExecutionContext& context) {
        Locker<Lock> locker(inspectorConnectionsLock);
        for (auto& connections : *inspectorConnections) {
            for (auto& connection : connections.value) {
                connection->sendMessageToFrontend("{\"method\":\"Bun.canReload\"}"_s);
            }
        }
    });
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionCreateConnection, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* debuggerGlobalObject = dynamicDowncast<Zig::GlobalObject>(globalObject);
    if (!debuggerGlobalObject)
        return JSValue::encode(jsUndefined());

    ScriptExecutionContext* targetContext = ScriptExecutionContext::getScriptExecutionContext(static_cast<ScriptExecutionContextIdentifier>(callFrame->argument(0).toUInt32(globalObject)));
    bool shouldRef = !callFrame->argument(1).toBoolean(globalObject);
    JSFunction* onMessageFn = uncheckedDowncast<JSFunction>(callFrame->argument(2).toObject(globalObject));

    if (!targetContext || !onMessageFn)
        return JSValue::encode(jsUndefined());

    auto& vm = JSC::getVM(globalObject);
    auto connection = BunInspectorConnection::create(
        *targetContext,
        targetContext->jsGlobalObject(), shouldRef);

    {
        Locker<Lock> locker(inspectorConnectionsLock);
        auto connections = inspectorConnections->get(targetContext->identifier());
        connections.append(connection.ptr());
        inspectorConnections->set(targetContext->identifier(), connections);
    }
    connection->jsBunDebuggerOnMessageFunction = { vm, onMessageFn };
    connection->connect();

    return JSValue::encode(JSBunInspectorConnection::create(vm, JSBunInspectorConnection::createStructure(vm, globalObject, globalObject->objectPrototype()), WTF::move(connection)));
}

// State shared between the main thread (node:inspector's open()/close()) and
// the debugger thread, which reports the listening WebSocket URL (or a startup
// error) and registers a callback that shuts the server down again.
struct NodeInspectorState {
    WTF::Lock lock;
    WTF::Condition condition;
    WTF::String url;
    WTF::String error;
    bool serverStarted { false };
    // Owned by the debugger thread's VM; process-lifetime once set (the
    // debugger thread is never joined).
    JSC::Strong<JSC::Unknown> controlCallback {};
};

static NodeInspectorState& nodeInspectorState()
{
    // NeverDestroyed: the debugger thread and its VM outlive main(), so
    // ~Strong() at exit() would touch a live foreign HandleSet without JSLock.
    static NeverDestroyed<NodeInspectorState> instance;
    return instance.get();
}

// Called by internal/debugger.ts on the debugger thread once the node:inspector
// server is listening (url, controlCallback) or failed to start ("", undefined, error).
JSC_DECLARE_HOST_FUNCTION(jsFunctionReportNodeInspectorServerStarted);
JSC_DEFINE_HOST_FUNCTION(jsFunctionReportNodeInspectorServerStarted, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    String url = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue controlCallbackValue = callFrame->argument(1);
    String error = callFrame->argument(2).isUndefined() ? String() : callFrame->argument(2).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Empty url with no error is the "close" acknowledgement from the
    // debugger-thread control callback, after server.stop(true) has fired each
    // connection's close callback and downgraded the ServerWebSocket wrapper's
    // Strong handle to Weak. The Rust box behind each wrapper is only freed
    // when GC sweeps it, and this thread's VM never runs destruct-on-exit, so
    // sweep here before waking the main thread (which may immediately
    // process.exit()). close() is synchronous and rare enough that a full
    // collection is acceptable.
    if (url.isEmpty() && error.isEmpty())
        vm.heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);

    auto& state = nodeInspectorState();
    {
        Locker<Lock> locker(state.lock);
        state.url = url.isolatedCopy();
        state.error = error.isolatedCopy();
        if (controlCallbackValue.isCallable()) {
            state.controlCallback = { vm, controlCallbackValue };
        }
        state.serverStarted = true;
        state.condition.notifyAll();
    }

    return JSValue::encode(jsUndefined());
}

extern "C" bool Debugger__startNodeInspectorServer(BunString* url, bool waitForConnection);
extern "C" void Debugger__waitForNodeInspectorConnection();
extern "C" void Debugger__abandonNodeInspectorWait();

// Posts a control message to the node-inspector server's debugger thread
// without checking whether the server is currently listening (the reopen path
// runs while it is closed).
static bool postNodeInspectorControlMessage(const String& message)
{
    if (!debuggerScriptExecutionContext)
        return false;

    debuggerScriptExecutionContext->postTaskConcurrently([message = message.isolatedCopy()](ScriptExecutionContext& context) {
        auto& state = nodeInspectorState();
        JSC::JSValue controlCallback;
        {
            Locker<Lock> locker(state.lock);
            controlCallback = state.controlCallback.get();
        }
        if (!controlCallback || !controlCallback.isCallable())
            return;
        auto* globalObject = context.jsGlobalObject();
        auto& vm = globalObject->vm();
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        MarkedArgumentBuffer arguments;
        arguments.append(jsString(vm, message));
        JSC::call(globalObject, controlCallback.getObject(), arguments, "postNodeInspectorControlMessage - controlCallback"_s);
        // The callback runs internal/debugger.ts, which can throw (a malformed
        // forwarded command reaching the CDP adapter, a failing stop()). This
        // task is the top of the stack on the debugger thread, so an escaping
        // exception has no handler and would otherwise stay pending for
        // whatever runs next on this VM.
        if (auto* exception = scope.exception()) [[unlikely]] {
            (void)scope.tryClearException();
            Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
        }
    });

    return true;
}

// node:inspector's inspector.open(): starts the debugger thread (or asks the
// existing one to open a new server after inspector.close()), waits for the
// WebSocket server to come up, and returns the resolved ws:// URL. Returns
// null when an inspector is already active; throws when the server failed to
// start.
JSC_DEFINE_HOST_FUNCTION(jsFunction_openNodeInspector, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    String requestedUrl = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    bool waitForConnection = callFrame->argument(1).toBoolean(globalObject);

    auto& state = nodeInspectorState();
    bool reopen = false;
    {
        Locker<Lock> locker(state.lock);
        if (state.serverStarted && !state.url.isEmpty()) {
            // A node:inspector server is already listening.
            return JSValue::encode(jsNull());
        }
        if (state.serverStarted && state.controlCallback) {
            // Previously opened and then closed: the debugger thread is still
            // running, so ask it to start a new server instead of spawning one.
            reopen = true;
            state.serverStarted = false;
            state.error = String();
        }
    }

    if (reopen) {
        auto controlMessage = JSON::Object::create();
        controlMessage->setString("type"_s, "open"_s);
        controlMessage->setString("url"_s, requestedUrl);
        if (!postNodeInspectorControlMessage(controlMessage->toJSONString())) {
            return JSValue::encode(jsNull());
        }
    } else {
        BunString urlString = Bun::toString(requestedUrl);
        if (!Debugger__startNodeInspectorServer(&urlString, waitForConnection)) {
            return JSValue::encode(jsNull());
        }
    }

    String resolvedUrl;
    String error;
    {
        Locker<Lock> locker(state.lock);
        // internal/debugger.ts's try/catch guarantees this is signalled on
        // every path; a timeout would leave this.debugger set with no
        // controlCallback, which nothing can recover from.
        while (!state.serverStarted) {
            state.condition.wait(state.lock);
        }
        resolvedUrl = state.url.isolatedCopy();
        error = state.error.isolatedCopy();
    }

    if (!error.isEmpty()) {
        Debugger__abandonNodeInspectorWait();
        throwException(globalObject, scope, createError(globalObject, makeString("Failed to start inspector: "_s, error)));
        return {};
    }
    if (resolvedUrl.isEmpty()) {
        Debugger__abandonNodeInspectorWait();
        throwException(globalObject, scope, createError(globalObject, "Failed to start inspector: the inspector server did not start"_s));
        return {};
    }

    return JSValue::encode(jsString(vm, resolvedUrl));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_waitForNodeInspectorConnection, (JSGlobalObject*, CallFrame*))
{
    Debugger__waitForNodeInspectorConnection();
    return JSValue::encode(jsUndefined());
}

// Forwards a control message (close, breakpoint forwarded from the in-process
// Session, ...) from the main thread to the node-inspector server running on
// the debugger thread. Returns false when no server is active.
JSC_DEFINE_HOST_FUNCTION(jsFunction_postNodeInspectorControl, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    String message = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto& state = nodeInspectorState();
    {
        Locker<Lock> locker(state.lock);
        if (!state.serverStarted || state.url.isEmpty())
            return JSValue::encode(jsBoolean(false));
    }

    return JSValue::encode(jsBoolean(postNodeInspectorControlMessage(message)));
}

// node:inspector's inspector.close(): asks the debugger thread to shut the
// server down and blocks until it has, then marks the inspector closed so
// url() reports undefined. Node's close() is synchronous — once it returns,
// the port no longer accepts connections (test-inspector-open.js asserts a
// connection to the old port is refused right after close()), so waiting for
// the debugger thread's acknowledgement here is required, not just tidy.
JSC_DEFINE_HOST_FUNCTION(jsFunction_closeNodeInspector, (JSGlobalObject*, CallFrame*))
{
    // close() called from a callback that runs inside waitForDebugger()'s
    // event-loop tick must disarm the Rust-side wait (wait_for_connection /
    // poll_ref), or the wait loop spins forever against a stopped server.
    Debugger__abandonNodeInspectorWait();

    auto& state = nodeInspectorState();
    {
        Locker<Lock> locker(state.lock);
        if (state.url.isEmpty())
            return JSValue::encode(jsUndefined());
        // The debugger thread re-signals serverStarted once the server is down.
        state.serverStarted = false;
    }

    auto controlMessage = JSON::Object::create();
    controlMessage->setString("type"_s, "close"_s);
    if (!postNodeInspectorControlMessage(controlMessage->toJSONString())) {
        // No debugger thread to acknowledge; nothing is listening either.
        Locker<Lock> locker(state.lock);
        state.serverStarted = true;
        state.url = String();
        return JSValue::encode(jsUndefined());
    }

    Locker<Lock> locker(state.lock);
    while (!state.serverStarted) {
        state.condition.wait(state.lock);
    }
    state.url = String();
    return JSValue::encode(jsUndefined());
}

extern "C" void Bun__startJSDebuggerThread(Zig::GlobalObject* debuggerGlobalObject, ScriptExecutionContextIdentifier scriptId, BunString* portOrPathString, int isAutomatic, bool isUrlServer, bool isNodeInspector)
{
    if (!debuggerScriptExecutionContext)
        debuggerScriptExecutionContext = debuggerGlobalObject->scriptExecutionContext();

    JSC::VM& vm = debuggerGlobalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue defaultValue = debuggerGlobalObject->internalModuleRegistry()->requireId(debuggerGlobalObject, vm, InternalModuleRegistry::Field::InternalDebugger);
    scope.assertNoException();
    JSFunction* debuggerDefaultFn = uncheckedDowncast<JSFunction>(defaultValue.asCell());

    MarkedArgumentBuffer arguments;

    arguments.append(jsNumber(static_cast<unsigned int>(scriptId)));
    auto* portOrPathJS = Bun::toJS(debuggerGlobalObject, *portOrPathString);
    if (!portOrPathJS) [[unlikely]] {
        return;
    }
    arguments.append(portOrPathJS);
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 3, String(), jsFunctionCreateConnection, ImplementationVisibility::Public));
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 1, String("send"_s), jsFunctionSend, ImplementationVisibility::Public));
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 0, String("disconnect"_s), jsFunctionDisconnect, ImplementationVisibility::Public));
    arguments.append(jsBoolean(isAutomatic));
    arguments.append(jsBoolean(isUrlServer));
    arguments.append(jsBoolean(isNodeInspector));
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 3, String("reportNodeInspectorServerStarted"_s), jsFunctionReportNodeInspectorServerStarted, ImplementationVisibility::Public));

    JSC::call(debuggerGlobalObject, debuggerDefaultFn, arguments, "Bun__initJSDebuggerThread - debuggerDefaultFn"_s);
    scope.assertNoException();
}

enum class AsyncCallTypeUint8 : uint8_t {
    DOMTimer = 1,
    EventListener = 2,
    PostMessage = 3,
    RequestAnimationFrame = 4,
    Microtask = 5,
};

static Inspector::InspectorDebuggerAgent::AsyncCallType getCallType(AsyncCallTypeUint8 callType)
{
    switch (callType) {
    case AsyncCallTypeUint8::DOMTimer:
        return Inspector::InspectorDebuggerAgent::AsyncCallType::DOMTimer;
    case AsyncCallTypeUint8::EventListener:
        return Inspector::InspectorDebuggerAgent::AsyncCallType::EventListener;
    case AsyncCallTypeUint8::PostMessage:
        return Inspector::InspectorDebuggerAgent::AsyncCallType::PostMessage;
    case AsyncCallTypeUint8::RequestAnimationFrame:
        return Inspector::InspectorDebuggerAgent::AsyncCallType::RequestAnimationFrame;
    case AsyncCallTypeUint8::Microtask:
        return Inspector::InspectorDebuggerAgent::AsyncCallType::Microtask;
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

extern "C" void Debugger__didScheduleAsyncCall(JSGlobalObject* globalObject, AsyncCallTypeUint8 callType, uint64_t callbackId, bool singleShot)
{
    auto* agent = debuggerAgent(globalObject);
    if (!agent)
        return;

    agent->didScheduleAsyncCall(globalObject, getCallType(callType), callbackId, singleShot);
}

extern "C" void Debugger__didCancelAsyncCall(JSGlobalObject* globalObject, AsyncCallTypeUint8 callType, uint64_t callbackId)
{
    auto* agent = debuggerAgent(globalObject);
    if (!agent)
        return;

    agent->didCancelAsyncCall(getCallType(callType), callbackId);
}

extern "C" void Debugger__didDispatchAsyncCall(JSGlobalObject* globalObject, AsyncCallTypeUint8 callType, uint64_t callbackId)
{
    auto* agent = debuggerAgent(globalObject);
    if (!agent)
        return;

    agent->didDispatchAsyncCall(getCallType(callType), callbackId);
}

extern "C" void Debugger__willDispatchAsyncCall(JSGlobalObject* globalObject, AsyncCallTypeUint8 callType, uint64_t callbackId)
{
    auto* agent = debuggerAgent(globalObject);
    if (!agent)
        return;

    agent->willDispatchAsyncCall(getCallType(callType), callbackId);
}

extern "C" void Bun__InspectorConnection__disconnectAllOnExit(Zig::GlobalObject* globalObject)
{
    // Snapshot under the lock, release before calling into the inspector —
    // `willDestroyFrontendAndBackend` must not run with `inspectorConnectionsLock` held.
    Vector<RefPtr<BunInspectorConnection>, 8> toDisconnect;
    {
        Locker<Lock> locker(inspectorConnectionsLock);
        if (inspectorConnections) {
            auto* context = globalObject->scriptExecutionContext();
            if (context) {
                auto it = inspectorConnections->find(context->identifier());
                if (it != inspectorConnections->end()) {
                    for (auto& connection : it->value) {
                        if (connection->status == ConnectionStatus::Disconnected)
                            continue;
                        connection->status = ConnectionStatus::Disconnected;
                        // Never call `disconnect()` for a connection that never connected —
                        // `disconnectFrontend` would underflow the FrontendRouter.
                        if (connection->hasEverConnected)
                            toDisconnect.append(connection);
                    }
                }
            }
        }
    }

    // A controller that never had a frontend connect has no agents and is safe
    // to destroy normally. One that did needs the leak workaround below even
    // if every connection has already disconnected (e.g. inspector.close()
    // before exit) — its destructor still trips the CheckedPtr ordering bug.
    if (!bunControllerHasEverConnected)
        return;

    for (auto& connection : toDisconnect)
        globalObject->inspectorDebuggable().disconnect(*connection);

    globalObject->m_inspectorController->globalObjectDestroyed();

    // WebKit header bug: `m_inspectorAgent` (CheckedPtr) is declared before
    // `m_agents`, so `~JSGlobalObjectInspectorController` destroys the agent
    // while a CheckedPtr still counts it -> `crashDueToCheckedPtrToDeadObject()`.
    // Leak the connected controller and hand the global a fresh, never-connected one.
    [[maybe_unused]] auto* leakedController = globalObject->m_inspectorController.release();
    globalObject->m_inspectorController = makeUnique<Inspector::JSGlobalObjectInspectorController>(*globalObject, Bun::BunInjectedScriptHost::create());
}
}
