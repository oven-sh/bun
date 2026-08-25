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

namespace Bun {
using namespace JSC;
using namespace WebCore;

class InProcessInspectorChannel;
static InProcessInspectorChannel& inProcessInspectorChannel();
static void drainInProcessInspectorWhilePaused(Zig::GlobalObject*);
static void finishDeferredInProcessDetach(Zig::GlobalObject*);

class BunInspectorConnection;

static WebCore::ScriptExecutionContext* debuggerScriptExecutionContext = nullptr;
static WTF::Lock inspectorConnectionsLock = WTF::Lock();
static WTF::UncheckedKeyHashMap<ScriptExecutionContextIdentifier, Vector<RefPtr<BunInspectorConnection>, 8>>* inspectorConnections = nullptr;

// Condition the inspected JS thread waits on inside runWhilePaused for debugger-thread
// messages or status changes (replaces a busy spin). Function-local static: no static init.
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
// Context whose inspector stopped taking new CDP clients, or 0 — bounds the exit wait.
// Node's InspectorIo::StopAcceptingNewConnections: https://github.com/nodejs/node/blob/main/src/inspector_agent.cc
static std::atomic<uint32_t> notAcceptingConnectionsContext { 0 };
// True once connectFrontend has been called on the Bun controller; the exit path must
// then leak it (see Bun__InspectorConnection__disconnectAllOnExit) even if all sessions left.
static bool bunControllerHasEverConnected = false;
extern "C" void Debugger__didConnect();

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
            Bun__VmHandle__refKeepAlive(WebCore::clientData(JSC::getVM(globalObject))->vmHandle, BunLoopKind::Regular, 1);
        }
        globalObject->setInspectable(true);
        auto& inspector = globalObject->inspectorDebuggable();
        inspector.setInspectable(true);

        registerBunAlternateAgents(globalObject);

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
                if (context.isMainThread())
                    finishDeferredInProcessDetach(static_cast<Zig::GlobalObject*>(context.jsGlobalObject()));
            }

            if (connection->unrefOnDisconnect) {
                connection->unrefOnDisconnect = false;
                Bun__VmHandle__refKeepAlive(WebCore::clientData(context.vm())->vmHandle, BunLoopKind::Regular, -1);
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
            // Drain the in-process session synchronously so its listeners can evaluateOnCallFrame while paused.
            // https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-evaluateOnCallFrame
            drainInProcessInspectorWhilePaused(global);
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

            // Block until the debugger thread delivers a message or a connection drops;
            // the 1s timeout is a missed-wakeup safety net, not a busy spin.
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
        // Only a *change* in the closed count is pending work; otherwise one already-closed
        // connection among several would keep us from sleeping.
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

    // vm.deleteAllCode (via Debugger.setBreakpointsActive) must not clearCode ModuleProgramExecutables:
    // regeneration under CodeGenerationMode::Debugger breaks the live JSModuleEnvironment layout invariant
    // (see JSC UnlinkedModuleProgramCodeBlock.h). Runs via whenIdle to precede any deferred deleteAllCode.
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
        // Connect before swapping the queue: doConnect re-enters this function, and connecting
        // after the swap would reorder the batch that arrived during connectFrontend ahead of it.
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

        // JSC's frontendInitialized() gates on m_isAutomaticInspection, which any disconnectFrontend() clears,
        // so resolve waitForDebugger directly on Inspector.initialized instead of relying on that path.
        // https://github.com/WebKit/WebKit/tree/main/Source/JavaScriptCore/inspector/protocol
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

        if (!jsBunDebuggerOnMessageFunction)
            return;

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
            ScriptExecutionContext::postTaskTo(scriptExecutionContextIdentifier, BunLoopKind::Regular, [connection = Ref { *this }](ScriptExecutionContext& context) {
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
            ScriptExecutionContext::postTaskTo(scriptExecutionContextIdentifier, BunLoopKind::Regular, [connection = Ref { *this }](ScriptExecutionContext& context) {
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

    bool isNodeCDP = false;

    // Only real remote frontends join the exit handshake (in-process Session never delays exit).
    // Node's InspectorSession::preventShutdown: https://github.com/nodejs/node/blob/main/src/inspector_agent.cc
    bool preventShutdown = false;

    bool unrefOnDisconnect = false;

    bool hasEverConnected = false;
};

JSC_DECLARE_HOST_FUNCTION(jsFunctionSend);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDisconnect);

// Same-thread frontend for the in-process node:inspector Session: commands dispatch
// synchronously and replies/events are buffered back to JS in one batch.
// https://github.com/nodejs/node/blob/main/lib/inspector.js
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
        if (!dispatchDepth && !inPauseLoop && !drainPosted && onMessages && scriptExecutionContextIdentifier) {
            drainPosted = true;
            ScriptExecutionContext::postTaskTo(scriptExecutionContextIdentifier, BunLoopKind::Regular, [](ScriptExecutionContext& context) {
                inProcessDrainTask(context);
            });
        }
    }

    static void inProcessDrainTask(ScriptExecutionContext& context);
    void drainSynchronously();

    Vector<String>& buffered() { return m_buffered; }
    void clear() { m_buffered.clear(); }

    bool connected = false;
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
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    channel.clear();
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), args)));
}

static InProcessInspectorChannel& inProcessInspectorChannel()
{
    static NeverDestroyed<InProcessInspectorChannel> channel;
    return channel;
}

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
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::MarkedArgumentBuffer arguments;
    JSC::call(globalObject, callback, arguments, "InProcessInspectorChannel::drainSynchronously - onMessages"_s);
    if (auto* exception = scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
    }
}

static void drainInProcessInspectorWhilePaused(Zig::GlobalObject* globalObject)
{
    auto& channel = inProcessInspectorChannel();
    bool wasInPauseLoop = channel.inPauseLoop;
    channel.inPauseLoop = true;
    channel.drainSynchronously();
    channel.inPauseLoop = wasInPauseLoop;
    if (!wasInPauseLoop && channel.dispatchDepth == 0)
        finishDeferredInProcessDetach(globalObject);
}

// Pause loop: defer to the remote connection loop when one is attached; otherwise deliver
// Debugger.paused synchronously then auto-continue (Node's same-thread Session semantics).
// https://github.com/nodejs/node/blob/main/src/inspector_agent.cc
static void inProcessRunWhilePaused(JSC::JSGlobalObject& globalObject, bool& isDoneProcessingEvents)
{
    if (globalObject.inspectorController().frontendRouter().hasRemoteFrontend()) {
        BunInspectorConnection::runWhilePaused(globalObject, isDoneProcessingEvents);
        return;
    }
    auto& channel = inProcessInspectorChannel();
    bool wasInPauseLoop = channel.inPauseLoop;
    channel.inPauseLoop = true;
    channel.drainSynchronously();
    channel.inPauseLoop = wasInPauseLoop;
    if (!isDoneProcessingEvents) {
        if (auto* debugger = globalObject.debugger())
            debugger->continueProgram();
        isDoneProcessingEvents = true;
    }
    if (!wasInPauseLoop && channel.dispatchDepth == 0)
        finishDeferredInProcessDetach(static_cast<Zig::GlobalObject*>(&globalObject));
}

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
        return WebCore::subspaceForImpl<JSBunInspectorConnection, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForBunInspectorConnection, m_subspaceForBunInspectorConnection));
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), JSC::NonArray);
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

// Replaces JSGlobalObject::init()'s default controller/debuggable with Bun's (BunInjectedScriptHost +
// the unpauseForResolvedAutomaticInspection hook). Never recreate once installed: destroying a
// once-connected controller trips the CheckedPtr ordering bug (see Bun__InspectorConnection__disconnectAllOnExit).
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
            for (auto& connection : connections.value) {
                connection->sendMessageToFrontend("{\"method\":\"Bun.canReload\"}"_s);
            }
        }
    });
}

// inspector.waitForDebugger() — mirrors Node's NodeRuntime.waitingForDebugger (per-session enable).
// https://github.com/nodejs/node/tree/main/src/inspector
extern "C" void BunDebugger__notifyWaitingForDebugger(uint32_t scriptId)
{
    if (debuggerScriptExecutionContext == nullptr) {
        return;
    }

    debuggerScriptExecutionContext->postTaskConcurrently([scriptId](ScriptExecutionContext& context) {
        Locker<Lock> locker(inspectorConnectionsLock);
        for (auto& connection : inspectorConnections->get(static_cast<ScriptExecutionContextIdentifier>(scriptId))) {
            if (connection->isNodeCDP) {
                connection->sendMessageToFrontend("{\"method\":\"Bun.waitingForDebugger\"}"_s);
            }
        }
    });
}

// Sessions that take part in the exit handshake (CDP frontends only, not JSC-protocol ones).
// Node's Agent::WaitForDisconnect: https://github.com/nodejs/node/blob/main/src/inspector_agent.cc
static void collectHandshakeSessions(ScriptExecutionContextIdentifier contextId, Vector<RefPtr<BunInspectorConnection>, 8>& out)
{
    out.shrink(0);
    Locker<Lock> locker(inspectorConnectionsLock);
    if (inspectorConnections == nullptr)
        return;
    for (auto& connection : inspectorConnections->get(contextId)) {
        if (!connection->isNodeCDP || !connection->preventShutdown)
            continue;
        ConnectionStatus status = connection->status.load();
        if (status == ConnectionStatus::Disconnecting || status == ConnectionStatus::Disconnected)
            continue;
        out.append(connection);
    }
}

// Main thread only: `vm.debugger` is never set on a worker (workers publish no CDP target), so
// the Rust caller returns early there and this has no per-worker branch, unlike Node's
// Agent::WaitForDisconnect.
extern "C" void BunDebugger__waitForDebuggerToDisconnect(uint32_t scriptId)
{
    if (debuggerScriptExecutionContext == nullptr)
        return;

    auto contextId = static_cast<ScriptExecutionContextIdentifier>(scriptId);

    // Stop accepting first, then snapshot — the set must shrink monotonically (same benign
    // in-flight-upgrade race as Node: https://github.com/nodejs/node/blob/main/src/inspector_agent.cc).
    notAcceptingConnectionsContext.store(scriptId);

    Vector<RefPtr<BunInspectorConnection>, 8> sessions;
    collectHandshakeSessions(contextId, sessions);

    if (sessions.isEmpty())
        return;

    fputs("Waiting for the debugger to disconnect...\n", stderr);
    fflush(stderr);

    for (auto& connection : sessions)
        connection->sendMessageToFrontend("{\"method\":\"Bun.waitingForDisconnect\"}"_s);

    auto* context = ScriptExecutionContext::getScriptExecutionContext(contextId);
    if (context == nullptr)
        return;
    auto* global = static_cast<Zig::GlobalObject*>(context->jsGlobalObject());

    // Pump inspector traffic only (never the event loop), like runWhilePaused — no deadline, as in Node.
    // https://github.com/nodejs/node/blob/main/src/inspector_agent.cc (Agent::WaitForDisconnect)
    for (;;) {
        size_t closedCount = 0;
        for (auto& connection : sessions) {
            ConnectionStatus status = connection->status.load();
            if (status == ConnectionStatus::Disconnected || status == ConnectionStatus::Disconnecting) {
                closedCount++;
                continue;
            }
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

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ScriptExecutionContext* targetContext = ScriptExecutionContext::getScriptExecutionContext(static_cast<ScriptExecutionContextIdentifier>(callFrame->argument(0).toUInt32(globalObject)));
    RETURN_IF_EXCEPTION(scope, {});
    bool shouldRef = !callFrame->argument(1).toBoolean(globalObject);
    JSFunction* onMessageFn = uncheckedDowncast<JSFunction>(callFrame->argument(2).toObject(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    if (!targetContext || !onMessageFn)
        return JSValue::encode(jsUndefined());

    bool isNodeCDP = callFrame->argument(3).toBoolean(globalObject);
    bool preventShutdown = callFrame->argument(4).toBoolean(globalObject);

    auto connection = BunInspectorConnection::create(
        *targetContext,
        targetContext->jsGlobalObject(), shouldRef);

    // Fill isNodeCDP/preventShutdown before publishing: the exit handshake reads them under
    // inspectorConnectionsLock, and a half-initialized entry would be skipped by the snapshot.
    connection->jsBunDebuggerOnMessageFunction = { vm, onMessageFn };
    connection->isNodeCDP = isNodeCDP;
    connection->preventShutdown = preventShutdown;

    {
        Locker<Lock> locker(inspectorConnectionsLock);
        auto connections = inspectorConnections->get(targetContext->identifier());
        connections.append(connection.ptr());
        inspectorConnections->set(targetContext->identifier(), connections);
    }
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
        // Top of stack on the debugger thread: report an escaping exception now or it
        // stays pending for whatever runs next on this VM.
        if (auto* exception = scope.exception()) [[unlikely]] {
            (void)scope.tryClearException();
            Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
            RETURN_IF_EXCEPTION(scope, );
        }
    });

    return true;
}

// node:inspector.open(): starts (or reopens) the debugger-thread server and returns its ws:// URL;
// null if already active, throws on startup failure. https://github.com/nodejs/node/blob/main/lib/inspector.js
JSC_DEFINE_HOST_FUNCTION(jsFunction_openNodeInspector, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    String requestedUrl = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    bool waitForConnection = callFrame->argument(1).toBoolean(globalObject);

    // `state` and `notAcceptingConnectionsContext` are process-global and the
    // debugger-thread closure debugs main's context, so every route below is
    // main-thread-only: a worker gets null before touching any of it.
    auto* context = defaultGlobalObject(globalObject)->scriptExecutionContext();
    if (!context || !context->isMainThread()) {
        return JSValue::encode(jsNull());
    }

    auto& state = nodeInspectorState();
    bool reopen = false;
    {
        Locker<Lock> locker(state.lock);
        if (state.serverStarted && !state.url.isEmpty()) {
            // A node:inspector server is already listening. Bun's _debugEnd leaves the listener
            // up, so an open() after _debugEnd() re-arms the exit handshake and the accept gate.
            Debugger__clearDebugEnd();
            notAcceptingConnectionsContext.store(0);
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

    // Node's stop-accepting flag lives on `io_`, replaced by a new Agent::Start; clear ours only
    // once the new IO actually started. https://github.com/nodejs/node/blob/main/src/inspector_agent.cc
    Debugger__clearDebugEnd();
    notAcceptingConnectionsContext.store(0);
    return JSValue::encode(jsString(vm, resolvedUrl));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_waitForNodeInspectorConnection, (JSGlobalObject*, CallFrame*))
{
    Debugger__waitForNodeInspectorConnection();
    return JSValue::encode(jsUndefined());
}

// Dispatches one JSC-protocol message from the in-process Session synchronously and returns
// the reply + any events as an array of JSON strings. Connects the channel on first use.
// https://github.com/nodejs/node/blob/main/lib/inspector.js
JSC_DEFINE_HOST_FUNCTION(jsFunction_dispatchInProcessInspectorMessage, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    String message = callFrame->argument(0).toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
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
        channel.scriptExecutionContextIdentifier = context->identifier();
        ensureBunInspectorController(globalObject);
        globalObject->setInspectable(true);
        auto& debuggable = globalObject->inspectorDebuggable();
        debuggable.setInspectable(true);
        registerBunAlternateAgents(globalObject);
        bunControllerHasEverConnected = true;
        globalObject->inspectorController().connectFrontend(channel, false, false);
    }

    BunInspectorConnection::protectModuleExecutablesFromClearCode(vm);
    channel.dispatchDepth++;
    globalObject->inspectorDebuggable().dispatchMessageFromRemote(WTF::move(message));
    channel.dispatchDepth--;
    if (channel.dispatchDepth == 0 && !channel.inPauseLoop)
        finishDeferredInProcessDetach(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (auto* debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(globalObject->debugger()))
        debugger->runWhilePausedCallback = inProcessRunWhilePaused;

    RELEASE_AND_RETURN(scope, takeBufferedInspectorMessages(lexicalGlobalObject, channel));
}

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

static void finishDeferredInProcessDetach(Zig::GlobalObject* globalObject)
{
    auto& channel = inProcessInspectorChannel();
    if (!channel.discarding || !channel.connected)
        return;
    if (channel.dispatchDepth > 0 || channel.inPauseLoop)
        return;
    if (globalObject->inspectorController().frontendRouter().hasRemoteFrontend())
        return;
    detachInProcessFrontend(globalObject, channel);
}

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
    if (globalObject->inspectorController().frontendRouter().hasRemoteFrontend() || channel.dispatchDepth > 0 || channel.inPauseLoop) {
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

// node:inspector.close(): synchronous — blocks until the debugger thread acknowledges the server
// is down (test-inspector-open.js relies on this). https://github.com/nodejs/node/blob/main/lib/inspector.js
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

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsWaitingForDebugger, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    uint32_t scriptId = callFrame->argument(0).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(Debugger__isWaitingForDebugger(scriptId)));
}

JSC_DECLARE_HOST_FUNCTION(jsFunctionIsAcceptingInspectorConnections);
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsAcceptingInspectorConnections, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    uint32_t scriptId = callFrame->argument(0).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(scriptId == 0 || notAcceptingConnectionsContext.load() != scriptId));
}

extern "C" void Bun__startJSDebuggerThread(Zig::GlobalObject* debuggerGlobalObject, ScriptExecutionContextIdentifier scriptId, const BunString* portOrPathString, int isAutomatic, bool isUrlServer, bool isNodeInspector, bool enableNodeCDP)
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
    RETURN_IF_EXCEPTION(scope, );
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
    Vector<RefPtr<BunInspectorConnection>, 8> toDisconnect;
    auto& inProcess = inProcessInspectorChannel();
    bool inProcessConnected = inProcess.connected && globalObject->scriptExecutionContext() && globalObject->scriptExecutionContext()->isMainThread();
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

    // A never-connected controller is safe to destroy normally; a once-connected one needs the
    // leak workaround below even if every session has left (CheckedPtr ordering bug, see below).
    if (!bunControllerHasEverConnected)
        return;

    if (inProcessConnected) {
        inProcess.connected = false;
        globalObject->inspectorController().disconnectFrontend(inProcess);
    }
    for (auto& connection : toDisconnect)
        globalObject->inspectorDebuggable().disconnect(*connection);

    globalObject->m_inspectorController->globalObjectDestroyed();

    // WebKit header bug: m_inspectorAgent (CheckedPtr) is declared before m_agents, so the dtor
    // destroys the agent while still counted -> crashDueToCheckedPtrToDeadObject(). Leak and replace.
    [[maybe_unused]] auto* leakedController = globalObject->m_inspectorController.release();
    globalObject->m_inspectorController = makeUnique<Inspector::JSGlobalObjectInspectorController>(*globalObject, Bun::BunInjectedScriptHost::create());
}
}
