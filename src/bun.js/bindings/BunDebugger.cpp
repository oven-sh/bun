#include "root.h"

#include "ZigGlobalObject.h"

#include <JavaScriptCore/InspectorFrontendChannel.h>
#include <JavaScriptCore/StopTheWorldCallback.h>
#include <JavaScriptCore/VMManager.h>
#include <JavaScriptCore/JSGlobalObjectDebuggable.h>
#include <JavaScriptCore/JSGlobalObjectDebugger.h>
#include <JavaScriptCore/Debugger.h>
#include "ScriptExecutionContext.h"
#include "debug-helpers.h"
#include "BunInjectedScriptHost.h"
#include <JavaScriptCore/JSGlobalObjectInspectorController.h>

#include "InspectorLifecycleAgent.h"
#include "InspectorTestReporterAgent.h"
#include "InspectorBunFrontendDevServerAgent.h"
#include "InspectorHTTPServerAgent.h"

extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);

namespace Bun {
using namespace JSC;
using namespace WebCore;

// True when the inspector was activated at runtime (SIGUSR1 / process._debugProcess),
// as opposed to --inspect at startup. When true, connect() uses requestStopAll to
// interrupt busy JS execution. When false (--inspect), the event loop handles delivery.
static std::atomic<bool> runtimeInspectorActivated { false };

class BunInspectorConnection;
static void installRunWhilePausedCallback(JSC::JSGlobalObject* globalObject);
static void makeInspectable(JSC::JSGlobalObject* globalObject);

static WebCore::ScriptExecutionContext* debuggerScriptExecutionContext = nullptr;
static WTF::Lock inspectorConnectionsLock = WTF::Lock();
static WTF::UncheckedKeyHashMap<ScriptExecutionContextIdentifier, Vector<BunInspectorConnection*, 8>>* inspectorConnections = nullptr;

static bool waitingForConnection = false;
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

static void makeInspectable(JSC::JSGlobalObject* globalObject)
{
    globalObject->setInspectable(true);
    globalObject->inspectorDebuggable().setInspectable(true);
}

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
        makeInspectable(globalObject);

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

        // Pre-attach the debugger so that schedulePauseAtNextOpportunity() can work
        // during the STW callback. Only on the SIGUSR1 path — for --inspect, the
        // debugger gets attached later via the Debugger.enable CDP command.
        if (runtimeInspectorActivated.load()) {
            auto* controllerDebugger = globalObject->inspectorController().debugger();
            if (controllerDebugger && !globalObject->debugger())
                controllerDebugger->attach(globalObject);
        }

        installRunWhilePausedCallback(globalObject);

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

        if (this->jsWaitForMessageFromInspectorLock.isLocked())
            this->jsWaitForMessageFromInspectorLock.unlockFairly();

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

        // Only use StopTheWorld for runtime-activated inspector (SIGUSR1 path)
        // where the event loop may not be running (e.g., while(true){}).
        // For --inspect, the event loop delivers doConnect via ensureOnContextThread above.
        //
        // Fire STW to interrupt busy JS (e.g., while(true){}) and process
        // this connection via the Bun__stopTheWorldCallback.
        // Note: do NOT fire a deferred requestStopAll here — if the target VM
        // enters the pause loop before the deferred STW fires, the deferred STW
        // deadlocks (target is in C++ pause loop, can't reach JS safe point,
        // debugger thread blocks in STW and can't deliver messages).
        if (runtimeInspectorActivated.load()) {
            VMManager::requestStopAll(VMManager::StopReason::JSDebugger);
        }
    }

    void disconnect()
    {
        if (jsWaitForMessageFromInspectorLock.isLocked())
            jsWaitForMessageFromInspectorLock.unlockFairly();

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

        // Check if this is a bootstrap pause (from breakProgram in handleTraps).
        // Bootstrap pauses dispatch messages and exit so the VM can re-enter
        // a proper pause with Debugger.paused event after Debugger.pause is received.
        bool isBootstrapPause = false;
        for (auto* connection : connections) {
            // Atomically read and clear pause reason flags.
            uint8_t prev = connection->pauseFlags.exchange(0);
            if (prev & BunInspectorConnection::kBootstrapPause)
                isBootstrapPause = true;
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

        if (isBootstrapPause) {
            // Bootstrap pause: breakProgram() fired from VMTraps to provide a
            // window for processing setup messages (e.g., Debugger.enable).
            // The drain above may or may not have processed them (depends on
            // timing — frontend messages may not have arrived yet).
            // Resume immediately. Messages will be delivered via the
            // NeedDebuggerBreak trap mechanism as they arrive. The user can
            // click Pause later for a real pause with proper call frames.
            //
            // Previously, this sent a synthetic Debugger.paused with empty
            // callFrames:[], but the frontend (DebuggerManager.js) auto-resumes
            // when activeCallFrame is null, making it pointless. Scripts also
            // weren't registered (no scriptParsed events), so even real pauses
            // had their call frames filtered out → auto-resume.
            if (auto* debugger = global->debugger())
                debugger->continueProgram();
            return;
        }

        // Mark all connections as being in the pause loop so that
        // interruptForMessageDelivery skips requestStopAll (which would
        // deadlock: the debugger thread blocks in STW while the target
        // VM is in this C++ loop and never reaches a JS safe point).
        for (auto* connection : connections)
            connection->pauseFlags.store(BunInspectorConnection::kInPauseLoop);

        if (connections.size() == 1) {
            while (!isDoneProcessingEvents) {
                auto* connection = connections[0];
                if (connection->status == ConnectionStatus::Disconnected || connection->status == ConnectionStatus::Disconnecting) {
                    if (global->debugger() && global->debugger()->isPaused()) {
                        global->debugger()->continueProgram();
                    }
                    break;
                }
                connection->receiveMessagesOnInspectorThread(*global->scriptExecutionContext(), global, true);
            }
        } else {
            while (!isDoneProcessingEvents) {
                size_t closedCount = 0;
                for (auto* connection : connections) {
                    closedCount += connection->status == ConnectionStatus::Disconnected || connection->status == ConnectionStatus::Disconnecting;
                    connection->receiveMessagesOnInspectorThread(*global->scriptExecutionContext(), global, true);
                    if (isDoneProcessingEvents)
                        break;
                }

                if (closedCount == connections.size() && global->debugger() && !isDoneProcessingEvents) {
                    global->debugger()->continueProgram();
                    continue;
                }
            }
        }

        // Drain any remaining messages before clearing flags to prevent
        // them from triggering a new interruptForMessageDelivery → STW → pause cascade.
        for (auto* connection : connections) {
            if (connection->status != ConnectionStatus::Disconnected) {
                connection->receiveMessagesOnInspectorThread(*global->scriptExecutionContext(), global, false);
            }
        }

        for (auto* connection : connections) {
            connection->pauseFlags.store(0);
            // Reset the scheduled flag so the debugger thread can post new
            // tasks after the pause loop exits.
            connection->jsThreadMessageScheduled.store(false);
        }
    }

    void receiveMessagesOnInspectorThread(ScriptExecutionContext& context, Zig::GlobalObject* globalObject, bool connectIfNeeded)
    {
        // Only clear the scheduled flag when NOT in the pause loop.
        // During the pause loop, receiveMessagesOnInspectorThread is called
        // repeatedly by the busy-poll. Clearing the flag would cause the
        // debugger thread to re-post a task + interruptForMessageDelivery
        // on every subsequent message, which is wasteful (and the posted
        // tasks pile up for after the loop exits).
        if (!(this->pauseFlags.load() & kInPauseLoop))
            this->jsThreadMessageScheduled.store(false);

        // Connect pending connections BEFORE draining messages.
        // If we drain first and then doConnect returns early, the drained
        // messages would be lost (dropped on stack unwind).
        auto& dispatcher = globalObject->inspectorDebuggable();
        Inspector::JSGlobalObjectDebugger* debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(globalObject->debugger());

        if (!debugger && connectIfNeeded && this->status == ConnectionStatus::Pending) {
            this->doConnect(context);
            // doConnect calls receiveMessagesOnInspectorThread recursively,
            // but jsThreadMessages may have been empty at that point.
            // Fall through to drain any messages that arrived during doConnect.
            debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(globalObject->debugger());
        }

        WTF::Vector<WTF::String, 12> messages;

        {
            Locker<Lock> locker(jsThreadMessagesLock);
            this->jsThreadMessages.swap(messages);
        }

        if (!debugger) {
            for (auto message : messages) {
                dispatcher.dispatchMessageFromRemote(WTF::move(message));

                if (!debugger) {
                    debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(globalObject->debugger());
                    if (debugger)
                        installRunWhilePausedCallback(globalObject);
                }
            }
        } else {
            for (auto message : messages) {
                dispatcher.dispatchMessageFromRemote(WTF::move(message));
            }
        }
    }

    void receiveMessagesOnDebuggerThread(ScriptExecutionContext& context, Zig::GlobalObject* debuggerGlobalObject)
    {
        debuggerThreadMessageScheduled.store(false);
        WTF::Vector<WTF::String, 12> messages;

        {
            Locker<Lock> locker(debuggerThreadMessagesLock);
            this->debuggerThreadMessages.swap(messages);
        }

        JSFunction* onMessageFn = jsCast<JSFunction*>(jsBunDebuggerOnMessageFunction.get());
        MarkedArgumentBuffer arguments;
        arguments.ensureCapacity(messages.size());
        auto& vm = debuggerGlobalObject->vm();

        for (auto& message : messages) {
            arguments.append(jsString(vm, message));
        }

        JSC::call(debuggerGlobalObject, onMessageFn, arguments, "BunInspectorConnection::receiveMessagesOnDebuggerThread - onMessageFn"_s);
    }

    void sendMessageToDebuggerThread(WTF::String&& inputMessage)
    {
        bool wasScheduled;
        {
            Locker<Lock> locker(debuggerThreadMessagesLock);
            debuggerThreadMessages.append(inputMessage);
        }

        wasScheduled = this->debuggerThreadMessageScheduled.exchange(true);
        if (!wasScheduled) {
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
        scheduleInspectorThreadDelivery();
    }

    void sendMessageToInspectorFromDebuggerThread(const WTF::String& inputMessage)
    {
        {
            Locker<Lock> locker(jsThreadMessagesLock);
            jsThreadMessages.append(inputMessage);
        }
        scheduleInspectorThreadDelivery();
    }

private:
    void scheduleInspectorThreadDelivery()
    {
        if (this->jsWaitForMessageFromInspectorLock.isLocked()) {
            this->jsWaitForMessageFromInspectorLock.unlock();
        } else if (!this->jsThreadMessageScheduled.exchange(true)) {
            ScriptExecutionContext::postTaskTo(scriptExecutionContextIdentifier, [connection = this](ScriptExecutionContext& context) {
                connection->receiveMessagesOnInspectorThread(context, static_cast<Zig::GlobalObject*>(context.jsGlobalObject()), true);
            });
            // Also interrupt busy JS execution via the debugger's pause mechanism.
            // If the debugger is attached, this triggers a pause at the next trap check,
            // where runWhilePaused will dispatch the queued messages.
            // If the debugger is not attached, the event loop delivery (above) is the fallback.
            this->interruptForMessageDelivery();
        } else {
        }
    }

public:
    // Interrupt the JS thread to process pending CDP messages via StopTheWorld.
    // Only used on the SIGUSR1 runtime activation path where the event loop may
    // not be running (e.g., while(true){}). For --inspect, the event loop
    // delivers messages via postTaskTo.
    void interruptForMessageDelivery()
    {
        if (!runtimeInspectorActivated.load())
            return;
        // If kInPauseLoop is set, the target VM is already in the runWhilePaused
        // message pump (busy-polling receiveMessagesOnInspectorThread). Skip the
        // STW request to avoid deadlock.
        uint8_t flags = this->pauseFlags.load();
        if (flags & kInPauseLoop)
            return;
        // Use notifyNeedDebuggerBreak instead of requestStopAll.
        // This sets the NeedDebuggerBreak trap on the target VM only,
        // WITHOUT stopping the debugger thread's VM. The trap handler
        // drains CDP messages and only enters breakProgram() if a pause
        // was explicitly requested (e.g., Debugger.pause).
        // This avoids the cascade where every message delivery stops
        // the debugger thread, preventing response delivery.
        this->pauseFlags.fetch_or(kMessageDeliveryPause);
        this->globalObject->vm().notifyNeedDebuggerBreak();
    }

    WTF::Vector<WTF::String, 12> debuggerThreadMessages;
    WTF::Lock debuggerThreadMessagesLock = WTF::Lock();
    std::atomic<bool> debuggerThreadMessageScheduled { false };

    WTF::Vector<WTF::String, 12> jsThreadMessages;
    WTF::Lock jsThreadMessagesLock = WTF::Lock();
    std::atomic<bool> jsThreadMessageScheduled { false };

    JSC::JSGlobalObject* globalObject;
    ScriptExecutionContextIdentifier scriptExecutionContextIdentifier;
    JSC::Strong<JSC::Unknown> jsBunDebuggerOnMessageFunction {};

    WTF::Lock jsWaitForMessageFromInspectorLock;
    std::atomic<ConnectionStatus> status = ConnectionStatus::Pending;

    // Pause state flags (consolidated into a single atomic).
    //
    //   kBootstrapPause       - runWhilePaused should send a synthetic Debugger.paused event
    //   kMessageDeliveryPause - a notifyNeedDebuggerBreak trap is needed to deliver CDP messages (no synthetic event)
    //   kInPauseLoop          - the connection is in the runWhilePaused message pump loop;
    //                           interruptForMessageDelivery must skip requestStopAll to avoid
    //                           deadlock (debugger thread blocks in STW while target VM is in
    //                           C++ code that never reaches a JS safe point)
    //
    static constexpr uint8_t kBootstrapPause = 1 << 0;
    static constexpr uint8_t kMessageDeliveryPause = 1 << 1;
    static constexpr uint8_t kInPauseLoop = 1 << 2;
    std::atomic<uint8_t> pauseFlags { 0 };

    bool unrefOnDisconnect = false;

    bool hasEverConnected = false;
};

// This callback is invoked by JSC when the debugger enters a paused state,
// delegating to BunInspectorConnection::runWhilePaused for CDP message pumping.
static void installRunWhilePausedCallback(JSC::JSGlobalObject* globalObject)
{
    auto* debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(globalObject->debugger());
    if (debugger) {
        debugger->runWhilePausedCallback = [](JSC::JSGlobalObject& go, bool& done) {
            BunInspectorConnection::runWhilePaused(go, done);
        };
    }
}

template<typename Func>
static auto forEachConnection(Func&& callback) -> void
{
    Locker<Lock> locker(inspectorConnectionsLock);
    if (!inspectorConnections)
        return;
    for (auto& entry : *inspectorConnections) {
        for (auto* connection : entry.value) {
            if (callback(connection))
                return;
        }
    }
}

template<typename Func>
static auto forEachConnectionForVM(JSC::VM& vm, Func&& callback) -> void
{
    forEachConnection([&](BunInspectorConnection* connection) -> bool {
        if (!connection->globalObject || &connection->globalObject->vm() != &vm)
            return false;
        return callback(connection);
    });
}

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
    auto* jsConnection = jsDynamicCast<JSBunInspectorConnection*>(callFrame->thisValue());
    auto message = callFrame->uncheckedArgument(0);

    if (!jsConnection)
        return JSValue::encode(jsUndefined());

    if (message.isString()) {
        jsConnection->connection()->sendMessageToInspectorFromDebuggerThread(message.toWTFString(globalObject).isolatedCopy());
    } else if (message.isCell()) {
        auto* array = jsCast<JSArray*>(message.asCell());
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
    auto* jsConnection = jsDynamicCast<JSBunInspectorConnection*>(callFrame->thisValue());
    if (!jsConnection)
        return JSValue::encode(jsUndefined());

    auto& connection = *jsConnection->connection();

    if (connection.status == ConnectionStatus::Connected || connection.status == ConnectionStatus::Pending) {
        connection.status = ConnectionStatus::Disconnecting;
        connection.disconnect();
        if (connection.jsWaitForMessageFromInspectorLock.isLocked())
            connection.jsWaitForMessageFromInspectorLock.unlockFairly();
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

extern "C" void Bun__ensureDebugger(ScriptExecutionContextIdentifier scriptId, bool pauseOnStart)
{

    auto* globalObject = ScriptExecutionContext::getScriptExecutionContext(scriptId)->jsGlobalObject();
    globalObject->m_inspectorController = makeUnique<Inspector::JSGlobalObjectInspectorController>(*globalObject, Bun::BunInjectedScriptHost::create());
    globalObject->m_inspectorDebuggable = BunJSGlobalObjectDebuggable::create(*globalObject);
    globalObject->m_inspectorDebuggable->init();

    makeInspectable(globalObject);

    installRunWhilePausedCallback(globalObject);
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

JSC_DEFINE_HOST_FUNCTION(jsFunctionCreateConnection, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* debuggerGlobalObject = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    if (!debuggerGlobalObject)
        return JSValue::encode(jsUndefined());

    ScriptExecutionContext* targetContext = ScriptExecutionContext::getScriptExecutionContext(static_cast<ScriptExecutionContextIdentifier>(callFrame->argument(0).toUInt32(globalObject)));
    bool shouldRef = !callFrame->argument(1).toBoolean(globalObject);
    JSFunction* onMessageFn = jsCast<JSFunction*>(callFrame->argument(2).toObject(globalObject));

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
    connection->connect();

    return JSValue::encode(JSBunInspectorConnection::create(vm, JSBunInspectorConnection::createStructure(vm, globalObject, globalObject->objectPrototype()), connection));
}

extern "C" void Bun__startJSDebuggerThread(Zig::GlobalObject* debuggerGlobalObject, ScriptExecutionContextIdentifier scriptId, BunString* portOrPathString, int isAutomatic, bool isUrlServer)
{
    if (!debuggerScriptExecutionContext)
        debuggerScriptExecutionContext = debuggerGlobalObject->scriptExecutionContext();

    JSC::VM& vm = debuggerGlobalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue defaultValue = debuggerGlobalObject->internalModuleRegistry()->requireId(debuggerGlobalObject, vm, InternalModuleRegistry::Field::InternalDebugger);
    scope.assertNoException();
    JSFunction* debuggerDefaultFn = jsCast<JSFunction*>(defaultValue.asCell());

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

// Helper functions called from the StopTheWorld callback.
// These run on the main thread at a safe point.

bool processPendingConnections(JSC::VM& callbackVM)
{
    bool connected = false;
    Vector<BunInspectorConnection*, 8> pendingConnections;
    forEachConnectionForVM(callbackVM, [&](BunInspectorConnection* connection) -> bool {
        if (connection->status == ConnectionStatus::Pending)
            pendingConnections.append(connection);
        return false;
    });

    for (auto* connection : pendingConnections) {
        auto* context = ScriptExecutionContext::getScriptExecutionContext(connection->scriptExecutionContextIdentifier);
        if (!context)
            continue;
        connection->doConnect(*context);
        connected = true;
    }
    return connected;
}

// Find a VM (other than the given one) that has pending work:
// either a pending connection or a pending pause (bootstrap or message delivery).
// Used to switch the STW callback to the right VM thread.
JSC::VM* findVMWithPendingWork(JSC::VM& excludeVM)
{
    JSC::VM* result = nullptr;
    forEachConnection([&](BunInspectorConnection* connection) -> bool {
        if (!connection->globalObject || &connection->globalObject->vm() == &excludeVM)
            return false;
        bool hasPendingConnection = (connection->status == ConnectionStatus::Pending);
        bool hasPendingPause = (connection->pauseFlags.load()
            & (BunInspectorConnection::kBootstrapPause | BunInspectorConnection::kMessageDeliveryPause));
        if (hasPendingConnection || hasPendingPause) {
            result = &connection->globalObject->vm();
            return true;
        }
        return false;
    });
    return result;
}

// Check if any connection has pending pause flags (bootstrap or message delivery).
uint8_t getPendingPauseFlags()
{
    uint8_t result = 0;
    forEachConnection([&](BunInspectorConnection* connection) -> bool {
        result |= connection->pauseFlags.load();
        return false;
    });
    // Mask out kInPauseLoop — that's not a "pending pause request".
    return result & (BunInspectorConnection::kBootstrapPause | BunInspectorConnection::kMessageDeliveryPause);
}

// Check if breakProgram() should be called after draining CDP messages.
// Returns true if a pause was explicitly requested (bootstrap, Debugger.pause,
// breakpoint). Returns false for plain message delivery.
extern "C" bool Bun__shouldBreakAfterMessageDrain(JSC::VM& vm)
{
    bool hasBootstrapPause = false;
    forEachConnectionForVM(vm, [&](BunInspectorConnection* connection) -> bool {
        uint8_t flags = connection->pauseFlags.load();
        // Bootstrap pause always needs breakProgram
        if (flags & BunInspectorConnection::kBootstrapPause) {
            hasBootstrapPause = true;
            return true;
        }
        return false;
    });
    if (hasBootstrapPause)
        return true;
    // Check if the debugger agent scheduled a pause (e.g., Debugger.pause command
    // was dispatched during the drain).
    auto* globalObject = vm.topCallFrame ? vm.topCallFrame->lexicalGlobalObject(vm) : nullptr;
    if (globalObject) {
        if (auto* debugger = globalObject->debugger()) {
            // schedulePauseAtNextOpportunity sets m_pauseAtNextOpportunity
            if (debugger->isPauseAtNextOpportunitySet())
                return true;
        }
    }
    return false;
}

// Drain queued CDP messages for a VM. Called from the NeedDebuggerBreak
// VMTraps handler before breakProgram() so that commands like Debugger.pause
// are processed first, setting the correct pause reason on the agent.
extern "C" void Bun__drainQueuedCDPMessages(JSC::VM& vm)
{
    forEachConnectionForVM(vm, [&](BunInspectorConnection* connection) -> bool {
        if (connection->status != ConnectionStatus::Connected)
            return false;
        auto* context = ScriptExecutionContext::getScriptExecutionContext(connection->scriptExecutionContextIdentifier);
        if (!context)
            return false;
        // Clear the message delivery flag — messages are being drained now.
        connection->pauseFlags.fetch_and(~BunInspectorConnection::kMessageDeliveryPause);
        connection->receiveMessagesOnInspectorThread(
            *context, static_cast<Zig::GlobalObject*>(connection->globalObject), false);
        return false;
    });
}

// Schedule a debugger pause for connected sessions.
// Called during STW after doConnect has already attached the debugger.
// schedulePauseAtNextOpportunity + notifyNeedDebuggerBreak set up a pause
// that fires after STW resumes. The NeedDebuggerBreak handler in VMTraps
// calls breakProgram() to enter the pause from any JIT tier.

void schedulePauseForConnectedSessions(JSC::VM& vm, bool isBootstrap)
{
    forEachConnectionForVM(vm, [&](BunInspectorConnection* connection) -> bool {
        if (connection->status != ConnectionStatus::Connected)
            return false;

        if (isBootstrap)
            connection->pauseFlags.fetch_or(BunInspectorConnection::kBootstrapPause);

        auto* debugger = connection->globalObject->debugger();
        if (!debugger)
            return false;

        // schedulePauseAtNextOpportunity() is NOT thread-safe in general (it calls
        // enableStepping → recompileAllJSFunctions), but is safe here because we're
        // inside a STW callback — all other VM threads are blocked.
        debugger->schedulePauseAtNextOpportunity();
        vm.notifyNeedDebuggerBreak();
        return true; // Only need once per VM
    });
}

}

// StopTheWorld callback for SIGUSR1 debugger activation.
// This runs on the main thread at a safe point when VMManager::requestStopAll(JSDebugger) is called.
//
// This handles the case where JS is actively executing (including infinite loops).
// For idle VMs, RuntimeInspector::checkAndActivateInspector handles it via event loop.

extern "C" bool Bun__tryActivateInspector();
extern "C" void Bun__activateRuntimeInspectorMode();

JSC::StopTheWorldStatus Bun__stopTheWorldCallback(JSC::VM& vm, JSC::StopTheWorldEvent event)
{
    using namespace JSC;

    // We only act on VMStopped (all VMs have reached a safe point).
    // For other events (VMCreated, VMActivated), just continue the STW process.
    if (event != StopTheWorldEvent::VMStopped)
        return STW_CONTINUE();

    // Phase 1: Activate inspector if requested (SIGUSR1 handler sets a flag)
    bool activated = Bun__tryActivateInspector();
    if (activated)
        Bun__activateRuntimeInspectorMode();

    // Phase 2: Process pending connections for THIS VM.
    // doConnect must run on the connection's owning VM thread.
    bool connected = Bun::processPendingConnections(vm);

    // If pending connections or pauses exist on a DIFFERENT VM, switch to it.
    if (!connected) {
        if (auto* targetVM = Bun::findVMWithPendingWork(vm))
            return STW_CONTEXT_SWITCH(targetVM);
    }

    // Phase 3: Handle pending pause/message flags.
    // Only trigger a bootstrap pause on the FIRST activation (not reconnections).
    // On reconnect, the debugger is already attached and agents are enabled.
    // A bootstrap pause on reconnect is dangerous because it sets kBootstrapPause
    // which can interfere with CDP message dispatch: dispatchMessageFromRemote
    // re-enters JS (e.g., Runtime.evaluate), which hits the poisoned stack limit,
    // fires handleTraps again, sees kBootstrapPause, enters breakProgram() →
    // sustained pause loop, blocking the evaluation forever.
    uint8_t pendingFlags = Bun::getPendingPauseFlags();
    bool isBootstrap = activated || (pendingFlags & Bun::BunInspectorConnection::kBootstrapPause);
    if (isBootstrap || (pendingFlags & Bun::BunInspectorConnection::kMessageDeliveryPause)) {
        Bun::schedulePauseForConnectedSessions(vm, isBootstrap);
    }

    return STW_RESUME_ALL();
}

// Zig bindings for VMManager
extern "C" void VMManager__requestStopAll(uint32_t reason)
{
    JSC::VMManager::requestStopAll(static_cast<JSC::VMManager::StopReason>(reason));
}

extern "C" void VMManager__requestResumeAll(uint32_t reason)
{
    JSC::VMManager::requestResumeAll(static_cast<JSC::VMManager::StopReason>(reason));
}

extern "C" void VM__cancelStop(JSC::VM* vm)
{
    vm->cancelStop();
}

// Called from Zig and from the STW callback when the inspector activates.
// Sets runtimeInspectorActivated so that connect() and
// interruptForMessageDelivery() use STW-based message delivery.
extern "C" void Bun__activateRuntimeInspectorMode()
{
    Bun::runtimeInspectorActivated.store(true);
}
