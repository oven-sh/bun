#include "root.h"

#include "BunDebugger.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/InspectorFrontendChannel.h>
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

class InProcessInspectorChannel;
static InProcessInspectorChannel& inProcessInspectorChannel();
static void finishDeferredInProcessDetach(Zig::GlobalObject*);

class BunInspectorConnection;

static WebCore::ScriptExecutionContext* debuggerScriptExecutionContext = nullptr;
static WTF::Lock inspectorConnectionsLock = WTF::Lock();
static WTF::UncheckedKeyHashMap<ScriptExecutionContextIdentifier, Vector<BunInspectorConnection*, 8>>* inspectorConnections = nullptr;

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

static bool waitingForConnection = false;
static bool bunControllerInstalled = false;
// Node's InspectorIo::StopAcceptingNewConnections(), which WaitForDisconnect
// calls before parking: the context whose inspector has stopped taking new CDP
// clients, or 0. This is what bounds the wait — the session set can only
// shrink, so a client that reconnects whenever its socket closes (VS Code
// auto-attach, chrome://inspect) cannot hold the process open forever. There is
// no timeout behind this.
static std::atomic<uint32_t> notAcceptingConnectionsContext { 0 };
extern "C" void Debugger__didConnect();

// Bun's alternate inspector agents are registered once, on the first
// frontend connection (remote or in-process).
static void registerBunAlternateAgents(JSC::JSGlobalObject* globalObject)
{
    static bool hasConnected = false;
    if (hasConnected)
        return;
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

class BunInspectorConnection : public Inspector::FrontendChannel {

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

    static BunInspectorConnection* create(ScriptExecutionContext& scriptExecutionContext, JSC::JSGlobalObject* globalObject, bool shouldRefEventLoop)
    {
        return new BunInspectorConnection(scriptExecutionContext, globalObject, shouldRefEventLoop);
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

        registerBunAlternateAgents(globalObject);

        this->hasEverConnected = true;
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

        ScriptExecutionContext::ensureOnContextThread(scriptExecutionContextIdentifier, [connection = this](ScriptExecutionContext& context) {
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

        ScriptExecutionContext::ensureOnContextThread(scriptExecutionContextIdentifier, [connection = this](ScriptExecutionContext& context) {
            if (connection->status == ConnectionStatus::Disconnected)
                return;

            connection->status = ConnectionStatus::Disconnected;

            // Do not call .disconnect() if we never actually connected.
            if (connection->hasEverConnected) {
                connection->inspector().disconnect(*connection);
                // The last remote frontend leaving must complete any detach an
                // in-process Session deferred while this remote was attached.
                if (context.isMainThread())
                    finishDeferredInProcessDetach(static_cast<Zig::GlobalObject*>(context.jsGlobalObject()));
            }

            if (connection->unrefOnDisconnect) {
                connection->unrefOnDisconnect = false;
                Bun__eventLoop__incrementRefConcurrently(static_cast<Zig::GlobalObject*>(context.jsGlobalObject())->bunVM(), -1);
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
        Vector<BunInspectorConnection*, 8> connections;
        {
            Locker<Lock> locker(inspectorConnectionsLock);
            connections.appendVector(inspectorConnections->get(global->scriptExecutionContext()->identifier()));
        }

        for (auto* connection : connections) {
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
            for (auto* connection : connections) {
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

    static bool anyConnectionHasPendingWork(const Vector<BunInspectorConnection*, 8>& connections, size_t previousClosedCount)
    {
        size_t closedCount = 0;
        for (auto* connection : connections) {
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

        JSFunction* onMessageFn = uncheckedDowncast<JSFunction>(jsBunDebuggerOnMessageFunction.get());
        MarkedArgumentBuffer arguments;
        arguments.ensureCapacity(messages.size());
        auto& vm = debuggerGlobalObject->vm();

        for (auto& message : messages) {
            arguments.append(jsString(vm, message));
        }

        messages.clear();

        JSC::call(debuggerGlobalObject, onMessageFn, arguments, "BunInspectorConnection::receiveMessagesOnDebuggerThread - onMessageFn"_s);
    }

    void sendMessageToDebuggerThread(WTF::String&& inputMessage)
    {
        {
            Locker<Lock> locker(debuggerThreadMessagesLock);
            debuggerThreadMessages.append(inputMessage);
        }

        if (this->debuggerThreadMessageScheduledCount++ == 0) {
            debuggerScriptExecutionContext->postTaskConcurrently([connection = this](ScriptExecutionContext& context) {
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
            ScriptExecutionContext::postTaskTo(scriptExecutionContextIdentifier, [connection = this](ScriptExecutionContext& context) {
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
            ScriptExecutionContext::postTaskTo(scriptExecutionContextIdentifier, [connection = this](ScriptExecutionContext& context) {
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

    // This connection's frontend speaks CDP through InspectorCDPAdapter, so it
    // is the only kind that understands the synthetic Bun.* events below.
    bool isNodeCDP = false;

    // Node's InspectorSession::preventShutdown(): only a real remote frontend
    // takes part in the exit handshake. The in-process inspector.Session is
    // "invisible" there and must never be able to delay exit.
    bool preventShutdown = false;

    bool unrefOnDisconnect = false;

    bool hasEverConnected = false;
};

JSC_DECLARE_HOST_FUNCTION(jsFunctionSend);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDisconnect);

// Same-thread frontend for the in-process node:inspector Session. Commands
// execute synchronously on the calling JS thread inside the dispatch, so the
// reply and any events raised during it are buffered here and handed back
// to JS as one batch. A breakpoint pause never waits on this thread: see
// inProcessRunWhilePaused (deliver Debugger.paused, then continue).
class InProcessInspectorChannel final : public Inspector::FrontendChannel {
public:
    ConnectionType connectionType() const override
    {
        return ConnectionType::Local;
    }

    void sendMessageToFrontend(const String& message) override
    {
        if (message.length() == 0 || discarding)
            return;
        m_buffered.append(message.isolatedCopy());
        // Messages produced outside a synchronous dispatch (e.g.
        // Debugger.scriptParsed during compilation, a deferred awaitPromise
        // reply) would otherwise wait for the next command: wake the JS side
        // with one same-context task. Not from the pause loop, which delivers
        // synchronously instead (a task cannot run while the thread is parked).
        if (!dispatchDepth && !inPauseLoop && !drainPosted && onMessages && scriptExecutionContextIdentifier) {
            drainPosted = true;
            ScriptExecutionContext::postTaskTo(scriptExecutionContextIdentifier, [](ScriptExecutionContext& context) {
                inProcessDrainTask(context);
            });
        }
    }

    static void inProcessDrainTask(ScriptExecutionContext& context);
    // Delivers everything buffered to the JS drain callback right now.
    void drainSynchronously();

    Vector<String>& buffered() { return m_buffered; }
    void clear() { m_buffered.clear(); }

    bool connected = false;
    bool everConnected = false;
    // Set while a JS Session no longer wants messages but the frontend is
    // kept attached because a remote debugger shares the backend agents.
    bool discarding = false;
    unsigned dispatchDepth = 0;
    bool drainPosted = false;
    bool inPauseLoop = false;
    ScriptExecutionContextIdentifier scriptExecutionContextIdentifier {};
    // Weak: the callback is owned by the node:inspector module. A strong
    // process-lifetime root here would pin the whole realm at VM teardown.
    JSC::Weak<JSC::JSObject> onMessages;

private:
    Vector<String> m_buffered;
};

// Hands the channel's buffered messages to JS as an array of strings and
// clears the buffer. Sets an OOM exception and returns empty on overflow.
static JSC::EncodedJSValue takeBufferedInspectorMessages(JSC::JSGlobalObject* globalObject, InProcessInspectorChannel& channel)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& buffered = channel.buffered();
    JSC::MarkedArgumentBuffer args;
    args.ensureCapacity(buffered.size());
    for (auto& reply : buffered) {
        args.append(jsString(vm, reply));
    }
    if (args.hasOverflowed()) {
        // Leave the buffer intact: the messages were not handed to anyone, so
        // dropping them here would lose them for the next drain.
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    channel.clear();
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), args)));
}

// One channel per JS realm; the Session multiplexes over it. Function-local
// static: created lazily on the JS thread, intentionally leaked at exit like
// the once-connected controller (see the CheckedPtr note above).
static InProcessInspectorChannel& inProcessInspectorChannel()
{
    static NeverDestroyed<InProcessInspectorChannel> channel;
    return channel;
}

// Runs on the inspected JS thread's event loop: hands asynchronously
// buffered messages to the JS drain callback registered by node:inspector.
void InProcessInspectorChannel::inProcessDrainTask(ScriptExecutionContext&)
{
    auto& channel = inProcessInspectorChannel();
    channel.drainPosted = false;
    channel.drainSynchronously();
}

void InProcessInspectorChannel::drainSynchronously()
{
    JSC::JSObject* callback = onMessages.get();
    if (!callback || m_buffered.isEmpty())
        return;
    auto* globalObject = callback->globalObject();
    auto& vm = JSC::getVM(globalObject);
    // Top of the stack on the pause loop / a posted task: an escaping
    // exception must be reported here, or the enclosing debugger scope's
    // release-assert fires. The JS drain already turns listener throws into
    // warnings; this covers what it cannot (OOM, stack overflow).
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::MarkedArgumentBuffer arguments;
    JSC::call(globalObject, callback, arguments, "InProcessInspectorChannel::drainSynchronously - onMessages"_s);
    if (auto* exception = scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
    }
}

// Pause loop for the inspected thread. When a remote debugger is attached it
// owns resumption, so defer to the connection loop. With only in-process
// sessions, mirror Node's same-thread session semantics: deliver
// Debugger.paused to listeners synchronously (evaluateOnCallFrame and the
// like work from a listener while paused), then continue automatically —
// no other thread exists to send Debugger.resume, so waiting would hang.
static void inProcessRunWhilePaused(JSC::JSGlobalObject& globalObject, bool& isDoneProcessingEvents)
{
    if (globalObject.inspectorController().frontendRouter().hasRemoteFrontend()) {
        BunInspectorConnection::runWhilePaused(globalObject, isDoneProcessingEvents);
        return;
    }
    auto& channel = inProcessInspectorChannel();
    channel.inPauseLoop = true;
    channel.drainSynchronously();
    channel.inPauseLoop = false;
    if (auto* debugger = globalObject.debugger())
        debugger->continueProgram();
    isDoneProcessingEvents = true;
}

class JSBunInspectorConnection final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = DoesNotNeedDestruction;

    static JSBunInspectorConnection* create(JSC::VM& vm, JSC::Structure* structure, BunInspectorConnection* connection)
    {
        JSBunInspectorConnection* ptr = new (NotNull, JSC::allocateCell<JSBunInspectorConnection>(vm)) JSBunInspectorConnection(vm, structure, connection);
        ptr->finishCreation(vm);
        return ptr;
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
        return m_connection;
    }

private:
    JSBunInspectorConnection(JSC::VM& vm, JSC::Structure* structure, BunInspectorConnection* connection)
        : Base(vm, structure)
        , m_connection(connection)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
    }

    BunInspectorConnection* m_connection;
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
            inspectorConnections = new WTF::UncheckedKeyHashMap<ScriptExecutionContextIdentifier, Vector<BunInspectorConnection*, 8>>();
        }

        inspectorConnections->add(globalObject->scriptExecutionContext()->identifier(), Vector<BunInspectorConnection*, 8>());
    }

    return static_cast<unsigned int>(globalObject->scriptExecutionContext()->identifier());
}
extern "C" void Bun__tickWhilePaused(bool*);

// JSGlobalObject::init() installs a default controller and debuggable, so
// they are always non-null here; Bun must replace them with its own
// (BunInjectedScriptHost, and BunJSGlobalObjectDebuggable's
// unpauseForResolvedAutomaticInspection hook that resolves
// wait-for-debugger). Once installed, never recreate: destroying a
// controller that ever had a frontend attached — even a since-disconnected
// one — trips the CheckedPtr ordering bug (see the exit-path comment
// below). Also re-entered at runtime by waitForDebugger() and Session.
static void ensureBunInspectorController(Zig::GlobalObject* globalObject)
{
    if (!bunControllerInstalled) {
        bunControllerInstalled = true;
        globalObject->m_inspectorController = makeUnique<Inspector::JSGlobalObjectInspectorController>(*globalObject, Bun::BunInjectedScriptHost::create());
        globalObject->m_inspectorDebuggable = BunJSGlobalObjectDebuggable::create(*globalObject);
        globalObject->m_inspectorDebuggable->init();
    }
}

extern "C" void Bun__ensureDebugger(ScriptExecutionContextIdentifier scriptId, bool pauseOnStart)
{

    auto* globalObject = ScriptExecutionContext::getScriptExecutionContext(scriptId)->jsGlobalObject();
    ensureBunInspectorController(static_cast<Zig::GlobalObject*>(globalObject));

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

extern "C" void BunDebugger__willHotReload()
{
    if (debuggerScriptExecutionContext == nullptr) {
        return;
    }

    debuggerScriptExecutionContext->postTaskConcurrently([](ScriptExecutionContext& context) {
        Locker<Lock> locker(inspectorConnectionsLock);
        for (auto& connections : *inspectorConnections) {
            for (auto* connection : connections.value) {
                connection->sendMessageToFrontend("{\"method\":\"Bun.canReload\"}"_s);
            }
        }
    });
}

// A context started waiting for a frontend (inspector.waitForDebugger()).
// Mirrors Node's RuntimeAgent::setWaitingForDebugger; the adapter decides
// whether to forward it, since NodeRuntime `enabled` is per session.
extern "C" void BunDebugger__notifyWaitingForDebugger(uint32_t scriptId)
{
    if (debuggerScriptExecutionContext == nullptr) {
        return;
    }

    debuggerScriptExecutionContext->postTaskConcurrently([scriptId](ScriptExecutionContext& context) {
        Locker<Lock> locker(inspectorConnectionsLock);
        // Only this context's frontends: another context may be running fine.
        for (auto* connection : inspectorConnections->get(static_cast<ScriptExecutionContextIdentifier>(scriptId))) {
            if (connection->isNodeCDP) {
                connection->sendMessageToFrontend("{\"method\":\"Bun.waitingForDebugger\"}"_s);
            }
        }
    });
}

// Node's Agent::WaitForDisconnect (inspector_agent.cc): on exit, tell each
// attached CDP frontend the context is going away, then block until every one
// of them has disconnected. Frontends speaking the JSC protocol
// (debug.bun.sh, the editor extensions) never take part.
// The sessions that take part in the exit handshake. Taken once, after the
// listener has stopped accepting, so it can only shrink from here.
static void collectHandshakeSessions(ScriptExecutionContextIdentifier contextId, Vector<BunInspectorConnection*, 8>& out)
{
    out.shrink(0);
    Locker<Lock> locker(inspectorConnectionsLock);
    if (inspectorConnections == nullptr)
        return;
    for (auto* connection : inspectorConnections->get(contextId)) {
        if (!connection->isNodeCDP || !connection->preventShutdown)
            continue;
        ConnectionStatus status = connection->status.load();
        if (status == ConnectionStatus::Disconnecting || status == ConnectionStatus::Disconnected)
            continue;
        out.append(connection);
    }
}

extern "C" void BunDebugger__waitForDebuggerToDisconnect(uint32_t scriptId, bool isWorker)
{
    if (debuggerScriptExecutionContext == nullptr)
        return;

    auto contextId = static_cast<ScriptExecutionContextIdentifier>(scriptId);

    // Stop accepting first, exactly as WaitForDisconnect does, and only then
    // take the set to wait on. Everything below relies on that set shrinking
    // monotonically. An upgrade already in flight on the debugger thread may
    // still land: if it lands before the snapshot it simply joins the set, and
    // if it lands after, exit proceeds without it — the same benign race Node
    // has, and it fails towards exiting rather than towards hanging.
    if (!isWorker)
        notAcceptingConnectionsContext.store(scriptId);

    Vector<BunInspectorConnection*, 8> sessions;
    collectHandshakeSessions(contextId, sessions);

    // Nothing to wait for: a plain run, --inspect that nobody attached to, or
    // a JSC-protocol-only frontend. Exit is unaffected in all three.
    if (sessions.isEmpty())
        return;

    // Node prints this on the main thread only (`!is_worker` in WaitForDisconnect).
    if (!isWorker) {
        fputs("Waiting for the debugger to disconnect...\n", stderr);
        fflush(stderr);
    }

    // The adapter picks Runtime.executionContextDestroyed or
    // NodeRuntime.waitingForDisconnect from its own per-session state.
    for (auto* connection : sessions)
        connection->sendMessageToFrontend("{\"method\":\"Bun.waitingForDisconnect\"}"_s);

    // Deliberate divergence: Node *does* park a worker here when some session
    // enabled notifyWhenWaitingForDisconnect (WaitForDisconnect's `else if
    // (is_worker) waitForSessionsDisconnect()`); only the `io_ == nullptr`
    // main-thread tail is skipped. Bun publishes no CDP target for a worker
    // context, so no session can be attached to one and the branch would be
    // dead — announce and keep going rather than add a way to wedge a worker.
    if (isWorker)
        return;

    auto* context = ScriptExecutionContext::getScriptExecutionContext(contextId);
    if (context == nullptr)
        return;
    auto* global = static_cast<Zig::GlobalObject*>(context->jsGlobalObject());

    // Node's WaitForDisconnect runs a nested message loop, so a frontend can
    // still drive the protocol (test-inspector-waiting-for-disconnect does a
    // Runtime.evaluate here) while the process is held open. Pump inspector
    // traffic only — never the event loop — exactly as runWhilePaused does
    // while the JS thread is stopped at a breakpoint. The condition timeout is
    // a missed-wakeup safety net, not a deadline: like Node, there is none.
    for (;;) {
        size_t closedCount = 0;
        for (auto* connection : sessions) {
            ConnectionStatus status = connection->status.load();
            if (status == ConnectionStatus::Disconnected || status == ConnectionStatus::Disconnecting) {
                closedCount++;
                continue;
            }
            // connectIfNeeded: a frontend that attached in the exit window is
            // still Pending, and its connect() task is posted to this thread,
            // which is now parked here. Connecting inline is what
            // runWhilePaused does for the same reason; without it the frontend
            // never sees a byte of CDP, so it never closes, and this loop spins
            // forever.
            connection->receiveMessagesOnInspectorThread(*context, global, true);
        }

        if (closedCount == sessions.size())
            return;

        auto& wait = pausedWait();
        Locker<Lock> waitLocker(wait.lock);
        if (!BunInspectorConnection::anyConnectionHasPendingWork(sessions, closedCount))
            wait.condition.waitFor(wait.lock, Seconds(0.1));
    }
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

    bool isNodeCDP = callFrame->argument(3).toBoolean(globalObject);
    bool preventShutdown = callFrame->argument(4).toBoolean(globalObject);

    auto& vm = JSC::getVM(globalObject);
    auto connection = BunInspectorConnection::create(
        *targetContext,
        targetContext->jsGlobalObject(), shouldRef);

    // Fill the connection in before publishing it. The exit handshake reads
    // isNodeCDP/preventShutdown under inspectorConnectionsLock, so a connection
    // visible in the map with those still false would be skipped by the
    // snapshot while its adapter had already joined the shared session set —
    // leaving the session that *is* being waited on with no handshake event at
    // all. sendMessageToFrontend also needs the message callback.
    connection->jsBunDebuggerOnMessageFunction = { vm, onMessageFn };
    connection->isNodeCDP = isNodeCDP;
    connection->preventShutdown = preventShutdown;

    {
        Locker<Lock> locker(inspectorConnectionsLock);
        auto connections = inspectorConnections->get(targetContext->identifier());
        connections.append(connection);
        inspectorConnections->set(targetContext->identifier(), connections);
    }
    connection->connect();

    return JSValue::encode(JSBunInspectorConnection::create(vm, JSBunInspectorConnection::createStructure(vm, globalObject, globalObject->objectPrototype()), connection));
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
extern "C" void Debugger__clearDebugEnd();

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

    // An inspector is being asked for on this thread, so a previous
    // process._debugEnd() must stop suppressing the exit handshake. This has to
    // precede the already-listening early return below: Bun's _debugEnd leaves
    // the listener up, so that is exactly the path open() takes after one.
    Debugger__clearDebugEnd();
    // Node's stop-accepting flag lives on `io_`, which a new Agent::Start
    // replaces. open() from a Runtime.evaluate inside the wait loop builds a
    // whole new server, so clear ours too or it 503s every CDP upgrade for the
    // rest of the process.
    notAcceptingConnectionsContext.store(0);

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

// Dispatches one JSC-protocol message from the in-process node:inspector
// Session against this realm's inspector controller, synchronously on the
// calling JS thread, and returns every message the backend produced for the
// frontend (the command's response plus any events emitted during the
// dispatch) as an array of JSON strings. Connects the in-process channel on
// first use.
JSC_DEFINE_HOST_FUNCTION(jsFunction_dispatchInProcessInspectorMessage, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    String message = callFrame->argument(0).toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    // The channel is a process-wide singleton bound to the main realm: JSC's
    // controller cannot outlive a frontend once connected, and workers die
    // before the process does, so worker sessions get no in-process backend.
    auto* context = globalObject->scriptExecutionContext();
    if (!context || !context->isMainThread()) {
        throwTypeError(lexicalGlobalObject, scope, "node:inspector in-process backend is only available on the main thread"_s);
        return {};
    }
    auto& channel = inProcessInspectorChannel();
    channel.discarding = false;
    if (JSC::JSObject* callback = callFrame->argument(1).getObject())
        channel.onMessages = JSC::Weak<JSC::JSObject>(callback);
    if (!channel.connected) {
        channel.connected = true;
        channel.everConnected = true;
        channel.scriptExecutionContextIdentifier = context->identifier();
        ensureBunInspectorController(globalObject);
        globalObject->setInspectable(true);
        auto& debuggable = globalObject->inspectorDebuggable();
        debuggable.setInspectable(true);
        registerBunAlternateAgents(globalObject);
        // Not automatic inspection: an in-process session must never park
        // this thread waiting for a debugger.
        globalObject->inspectorController().connectFrontend(channel, false, false);
    }

    BunInspectorConnection::protectModuleExecutablesFromClearCode(vm);
    channel.dispatchDepth++;
    globalObject->inspectorDebuggable().dispatchMessageFromRemote(WTF::move(message));
    channel.dispatchDepth--;
    // The dispatch runs arbitrary user JS (Runtime.evaluate); surface anything it left pending.
    RETURN_IF_EXCEPTION(scope, {});
    // Own the pause loop while an in-process session is attached (it defers
    // to the remote connection loop whenever a remote frontend exists). The
    // Debugger is created lazily on Debugger.enable, so re-check each dispatch.
    if (auto* debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(globalObject->debugger()))
        debugger->runWhilePausedCallback = inProcessRunWhilePaused;

    RELEASE_AND_RETURN(scope, takeBufferedInspectorMessages(lexicalGlobalObject, channel));
}

// Returns any inspector messages that arrived outside a synchronous
// dispatch (events raised while user code ran, or deferred replies such as
// Runtime.awaitPromise), draining the in-process channel's buffer.
JSC_DEFINE_HOST_FUNCTION(jsFunction_drainInProcessInspectorMessages, (JSGlobalObject * lexicalGlobalObject, CallFrame*))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* context = globalObject->scriptExecutionContext();
    if (!context || !context->isMainThread())
        RELEASE_AND_RETURN(scope, JSValue::encode(JSC::constructEmptyArray(lexicalGlobalObject, nullptr)));
    auto& channel = inProcessInspectorChannel();
    channel.drainPosted = false;
    RELEASE_AND_RETURN(scope, takeBufferedInspectorMessages(lexicalGlobalObject, channel));
}

static void detachInProcessFrontend(Zig::GlobalObject* globalObject, InProcessInspectorChannel& channel)
{
    channel.discarding = false;
    channel.connected = false;
    globalObject->inspectorController().disconnectFrontend(channel);
    if (auto* debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(globalObject->debugger()); debugger && debugger->runWhilePausedCallback == inProcessRunWhilePaused)
        debugger->runWhilePausedCallback = nullptr;
}

// Completes a detach that jsFunction_disconnectInProcessInspector deferred
// because a remote frontend still shared the backend agents.
static void finishDeferredInProcessDetach(Zig::GlobalObject* globalObject)
{
    auto& channel = inProcessInspectorChannel();
    if (!channel.discarding || !channel.connected)
        return;
    if (globalObject->inspectorController().frontendRouter().hasRemoteFrontend())
        return;
    detachInProcessFrontend(globalObject, channel);
}

// A fully-disconnected Session stops receiving messages. The frontend is only
// detached when no remote debugger shares the backend: detaching a frontend
// tears down the shared agents, which would gut an attached remote client, so
// in that case the channel stays attached and just drops its messages.
JSC_DEFINE_HOST_FUNCTION(jsFunction_disconnectInProcessInspector, (JSGlobalObject * lexicalGlobalObject, CallFrame*))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* context = globalObject->scriptExecutionContext();
    if (!context || !context->isMainThread())
        return JSValue::encode(jsUndefined());
    auto& channel = inProcessInspectorChannel();
    channel.clear();
    channel.onMessages.clear();
    if (!channel.connected)
        return JSValue::encode(jsUndefined());
    if (globalObject->inspectorController().frontendRouter().hasRemoteFrontend()) {
        channel.discarding = true;
        return JSValue::encode(jsUndefined());
    }
    detachInProcessFrontend(globalObject, channel);
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

extern "C" bool Debugger__isWaitingForDebugger(uint32_t scriptId);

// Reads an inspected context's wait-for-frontend state from the debugger
// thread, for NodeRuntime.enable in internal/inspector/cdp.ts.
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsWaitingForDebugger, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    uint32_t scriptId = callFrame->argument(0).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(Debugger__isWaitingForDebugger(scriptId)));
}

// Whether this context's inspector still takes new CDP clients. False once the
// exit handshake has begun; internal/debugger.ts refuses the upgrade then, which
// is Bun's StopAcceptingNewConnections.
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsAcceptingInspectorConnections);
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsAcceptingInspectorConnections, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    uint32_t scriptId = callFrame->argument(0).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(scriptId == 0 || notAcceptingConnectionsContext.load() != scriptId));
}

extern "C" void Bun__startJSDebuggerThread(Zig::GlobalObject* debuggerGlobalObject, ScriptExecutionContextIdentifier scriptId, BunString* portOrPathString, int isAutomatic, bool isUrlServer, bool isNodeInspector, bool enableNodeCDP)
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
    arguments.append(jsBoolean(enableNodeCDP));
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 1, String("isWaitingForDebugger"_s), jsFunctionIsWaitingForDebugger, ImplementationVisibility::Public));
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 1, String("isAcceptingConnections"_s), jsFunctionIsAcceptingInspectorConnections, ImplementationVisibility::Public));

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
    Vector<BunInspectorConnection*, 8> toDisconnect;
    bool hasEverConnected = false;
    // The in-process node:inspector channel (main realm only) also attaches
    // a frontend, so it counts toward the ever-connected leak workaround.
    auto& inProcess = inProcessInspectorChannel();
    bool inProcessConnected = inProcess.connected && globalObject->scriptExecutionContext() && globalObject->scriptExecutionContext()->isMainThread();
    if (inProcessConnected || inProcess.everConnected)
        hasEverConnected = true;
    {
        Locker<Lock> locker(inspectorConnectionsLock);
        auto* context = globalObject->scriptExecutionContext();
        if (inspectorConnections && context) {
            auto it = inspectorConnections->find(context->identifier());
            if (it != inspectorConnections->end()) {
                for (auto* connection : it->value) {
                    hasEverConnected |= connection->hasEverConnected;
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

    // A controller that never had a frontend connect has no agents and is safe
    // to destroy normally. One that did needs the leak workaround below even
    // if every connection has already disconnected (e.g. inspector.close()
    // before exit) — its destructor still trips the CheckedPtr ordering bug.
    if (!hasEverConnected)
        return;

    if (inProcessConnected) {
        inProcess.connected = false;
        globalObject->inspectorController().disconnectFrontend(inProcess);
    }
    for (auto* connection : toDisconnect)
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
