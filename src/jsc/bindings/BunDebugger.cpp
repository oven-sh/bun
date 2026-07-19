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

    bool unrefOnDisconnect = false;

    bool hasEverConnected = false;
};

JSC_DECLARE_HOST_FUNCTION(jsFunctionSend);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDisconnect);

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
        connections.append(connection);
        inspectorConnections->set(targetContext->identifier(), connections);
    }
    connection->jsBunDebuggerOnMessageFunction = { vm, onMessageFn };
    connection->isNodeCDP = callFrame->argument(3).toBoolean(globalObject);
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

extern "C" bool Debugger__isWaitingForDebugger(uint32_t scriptId);

// Reads an inspected context's wait-for-frontend state from the debugger
// thread, for NodeRuntime.enable in internal/inspector/cdp.ts.
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsWaitingForDebugger, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(jsBoolean(Debugger__isWaitingForDebugger(callFrame->argument(0).toUInt32(globalObject))));
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
    {
        Locker<Lock> locker(inspectorConnectionsLock);
        if (!inspectorConnections)
            return;
        auto* context = globalObject->scriptExecutionContext();
        if (!context)
            return;
        auto it = inspectorConnections->find(context->identifier());
        if (it == inspectorConnections->end())
            return;
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

    // A controller that never had a frontend connect has no agents and is safe
    // to destroy normally. One that did needs the leak workaround below even
    // if every connection has already disconnected (e.g. inspector.close()
    // before exit) — its destructor still trips the CheckedPtr ordering bug.
    if (!hasEverConnected)
        return;

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
