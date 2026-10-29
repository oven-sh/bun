#include "root.h"

#include "BunDebugger.h"
#include "BunCompiledModules.h"
#include "CodeGenerationFromStrings.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/InspectorFrontendChannel.h>
#include <JavaScriptCore/JSGlobalObjectDebuggable.h>
#include <JavaScriptCore/JSGlobalObjectDebugger.h>
#include <JavaScriptCore/Debugger.h>
#include <wtf/Condition.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringToIntegerConversion.h>
#include "ScriptExecutionContext.h"
#include "debug-helpers.h"
#include "BunInjectedScriptHost.h"
#include <JavaScriptCore/InspectorFrontendRouter.h>
#include <JavaScriptCore/JSGlobalObjectInspectorController.h>
#include <JavaScriptCore/JSLock.h>
#include <JavaScriptCore/SamplingProfiler.h>
#include <wtf/JSONValues.h>

#include "InspectorLifecycleAgent.h"
#include "InspectorTestReporterAgent.h"
#include "InspectorBunFrontendDevServerAgent.h"
#include "InspectorHTTPServerAgent.h"

extern "C" void Bun__tickWhilePaused(bool*);

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

// A frontend is dropped once this much was queued for it since it last took a byte. Node queues without bound.
static size_t stalledFrontendBacklog = 128 * 1024 * 1024;

// Beside `<Domain>.enable` and `<Domain>.disable`: a command that turns something on, and the one that turns it off.
static constexpr std::pair<ASCIILiteral, ASCIILiteral> commandsThatTurnOnAndOff[] = {
    { "ScriptProfiler.startTracking"_s, "ScriptProfiler.stopTracking"_s },
    { "Runtime.enableTypeProfiler"_s, "Runtime.disableTypeProfiler"_s },
};

static constexpr bool isMethodNameCharacter(char16_t character)
{
    return isASCIIAlphanumeric(character) || character == '.';
}

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

            // The controller's disconnectFrontend() disables every agent before its last-frontend check.
            auto* inspectedGlobalObject = connection->globalObject;
            auto& router = const_cast<Inspector::FrontendRouter&>(inspectedGlobalObject->inspectorController().frontendRouter());
            if (!connection->hasEverConnected || router.frontendCount() > 1) {
                JSC::JSLockHolder locker(inspectedGlobalObject->vm());
                // A frontend that left before it was connected is not in the router, but its commands ran.
                if (connection->hasEverConnected)
                    router.disconnectFrontend(connection.get());
                connection->turnOffWhatOnlyThisFrontendTurnedOn();
            } else {
                connection->inspector().disconnect(connection.get());
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

    bool hasLeft() const
    {
        auto status = this->status.load();
        return status == ConnectionStatus::Disconnected || status == ConnectionStatus::Disconnecting;
    }

    // Inspected thread.
    bool turnedDebuggerOn() const
    {
        return !hasLeft() && turnOffCommands.contains("Debugger.disable"_s);
    }

    // Inspected thread. A pause waits only for a frontend on a transport, and only if the debugger is on for it.
    static size_t countFrontendsThatCannotResume(const Vector<RefPtr<BunInspectorConnection>, 8>& connections)
    {
        // The breakpoints of the in-process `inspector.Session` are for every client on a transport, as in Node.
        bool debuggerIsOnForSession = connections.containsIf([](auto& connection) {
            return !connection->hasTransport && connection->turnedDebuggerOn();
        });

        size_t count = 0;
        for (auto& connection : connections) {
            if (!connection->hasTransport || connection->hasLeft() || !(debuggerIsOnForSession || connection->turnedDebuggerOn()))
                count++;
        }
        return count;
    }

    // Inspected thread. Remembers what this frontend turned on, as the command that turns it off.
    void trackTurnOffCommand(const WTF::String& message)
    {
        StringView text { message };
        StringView method;
        String parsedMethod;

        // The shape that every known frontend sends needs no parse: {"id":1,"method":"Domain.method"
        if (text.startsWith("{\"id\":"_s)) {
            unsigned cursor = 6;
            while (cursor < text.length() && isASCIIDigit(text[cursor]))
                cursor++;
            if (cursor > 6 && text.substring(cursor).startsWith(",\"method\":\""_s)) {
                cursor += 11;
                if (size_t end = text.find('"', cursor); end != notFound)
                    method = text.substring(cursor, end - cursor);
            }
        }

        if (method.isNull() || method.contains('\\')) {
            // A command that turns something on or off is short. The backend parses each command again.
            if (message.length() > 1024)
                return;
            auto value = JSON::Value::parseJSON(message);
            auto object = value ? value->asObject() : nullptr;
            // The backend runs no command without an integer id.
            if (!object || !object->getInteger("id"_s))
                return;
            parsedMethod = object->getString("method"_s);
            method = parsedMethod;
        }

        String turnOff;
        bool turnsOn = false;
        if (method.endsWith(".enable"_s)) {
            turnOff = makeString(method.left(method.length() - 6), "disable"_s);
            turnsOn = true;
        } else if (method.endsWith(".disable"_s))
            turnOff = method.toString();
        else {
            for (auto& [on, off] : commandsThatTurnOnAndOff) {
                if (method == on || method == off) {
                    turnOff = off;
                    turnsOn = method == on;
                    break;
                }
            }
        }

        // The name goes into a command as it is.
        if (turnOff.isNull() || !StringView(turnOff).containsOnly<isMethodNameCharacter>())
            return;

        if (turnOff == "ScriptProfiler.stopTracking"_s)
            recordsProfileSamples = turnsOn && asksForProfileSamples(message);

        turnOffCommands.removeAll(turnOff);
        if (turnsOn)
            turnOffCommands.append(WTF::move(turnOff));
    }

    // `ScriptProfiler.startTracking` with `includeSamples` starts the sampling profiler of the VM.
    static bool asksForProfileSamples(const WTF::String& message)
    {
        auto value = JSON::Value::parseJSON(message);
        auto object = value ? value->asObject() : nullptr;
        auto params = object ? object->getObject("params"_s) : nullptr;
        return params && params->getBoolean("includeSamples"_s).value_or(false);
    }

    // Inspected thread. JSC keeps one state for every frontend, so what only this frontend turned on goes off with it.
    void turnOffWhatOnlyThisFrontendTurnedOn()
    {
        Vector<RefPtr<BunInspectorConnection>, 8> connections;
        {
            Locker<Lock> locker(inspectorConnectionsLock);
            connections.appendVector(inspectorConnections->get(scriptExecutionContextIdentifier));
        }

        for (auto& command : std::exchange(turnOffCommands, {})) {
            bool anotherFrontendTurnedItOn = connections.containsIf([&](auto& other) {
                return other.get() != this && other->hasTransport && other->status != ConnectionStatus::Disconnected && other->turnOffCommands.contains(command);
            });
            // JSC asserts when a frontend disables a debugger that is not attached.
            if (anotherFrontendTurnedItOn || (command == "Debugger.disable"_s && !globalObject->debugger()))
                continue;
            if (recordsProfileSamples && command == "ScriptProfiler.stopTracking"_s)
                discardProfileSamples();
            inspector().dispatchMessageFromRemote(makeString("{\"id\":-1,\"method\":\""_s, command, "\"}"_s));
        }
    }

    // Inspected thread. Nobody asked for the profile of the frontend that left: JSC drops it too when a frontend disconnects.
    void discardProfileSamples()
    {
#if ENABLE(SAMPLING_PROFILER)
        if (auto* profiler = globalObject->vm().samplingProfiler()) {
            Locker locker { profiler->getLock() };
            profiler->pause();
            profiler->clearData();
        }
#endif
    }

    void sendMessageToFrontend(const String& message) override
    {
        if (message.length() == 0)
            return;

        // The debugger thread dropped this frontend and hands it nothing more.
        if (this->status.load(std::memory_order_relaxed) == ConnectionStatus::Disconnecting)
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
            for (auto& connection : connections) {
                if (connection->hasLeft())
                    continue;
                connection->receiveMessagesOnInspectorThread(*global->scriptExecutionContext(), global, true);
                if (isDoneProcessingEvents)
                    break;
            }

            if (isDoneProcessingEvents)
                break;

            size_t closedCount = countFrontendsThatCannotResume(connections);
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
        for (auto& connection : connections) {
            if (connection->hasLeft())
                continue;

            Locker<Lock> locker(connection->jsThreadMessagesLock);
            if (!connection->jsThreadMessages.isEmpty())
                return true;
        }
        // A connection that was already counted as closed by the caller is
        // not new work and must not keep us from sleeping (otherwise one
        // closed connection among several would cause us to spin). Only
        // treat a *change* in the closed count as pending work so the outer
        // loop re-evaluates whether every connection is gone.
        return countFrontendsThatCannotResume(connections) != previousClosedCount;
    }

    // Wake the inspected thread if it is blocked inside runWhilePaused.
    // Safe to call from any thread; cheap when nobody is waiting.
    static void notifyPausedThread()
    {
        auto& wait = pausedWait();
        Locker<Lock> locker(wait.lock);
        wait.condition.notifyAll();
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
                trackTurnOffCommand(message);
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
                trackTurnOffCommand(message);
                dispatcher.dispatchMessageFromRemote(WTF::move(message));
            }
        }

        messages.clear();
    }

    // Debugger thread. Hands the queued messages to debugger.ts for as long as the transport takes them.
    void deliverMessagesOnDebuggerThread(Zig::GlobalObject* debuggerGlobalObject)
    {
        // One call takes at most Interpreter::maxArguments arguments.
        static constexpr size_t maxPieceMessages = 1024;
        static constexpr size_t maxPieceBytes = 1024 * 1024;

        debuggerThreadMessageScheduledCount.store(0);

        auto& vm = debuggerGlobalObject->vm();
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

        if (!jsBunDebuggerOnMessageFunction) {
            dropQueuedMessages();
            return;
        }

        if (transportIsFull && !transportHasRoom(debuggerGlobalObject))
            return;

        // One batch per task, so that the debugger thread's other tasks and sockets get their turn.
        if (undeliveredIndex == undelivered.size()) {
            undelivered.clear();
            undeliveredIndex = 0;
            Locker<Lock> locker(debuggerThreadMessagesLock);
            debuggerThreadMessages.swap(undelivered);
        }

        while (undeliveredIndex < undelivered.size()) {
            // jsFunctionDisconnect() clears it, also from inside the call below.
            if (!jsBunDebuggerOnMessageFunction) {
                dropQueuedMessages();
                return;
            }

            MarkedArgumentBuffer arguments;
            size_t pieceBytes = 0;
            do {
                auto& message = undelivered[undeliveredIndex];
                size_t bytes = message.sizeInBytes();
                if (pieceBytes && pieceBytes + bytes > maxPieceBytes)
                    break;
                pieceBytes += bytes;
                arguments.append(jsString(vm, WTF::move(message)));
                undeliveredIndex++;
            } while (undeliveredIndex < undelivered.size() && arguments.size() < maxPieceMessages);

            JSValue unsent = JSC::call(debuggerGlobalObject, jsBunDebuggerOnMessageFunction.get(), arguments, "BunInspectorConnection::deliverMessagesOnDebuggerThread - onMessageFn"_s);
            bool threw = reportExceptionOnDebuggerThread(debuggerGlobalObject, scope);
            RETURN_IF_EXCEPTION(scope, );

            // The callback returns what the transport could not write, when there is any.
            size_t unsentBytes = !threw && unsent.isNumber() && unsent.asNumber() > 0 ? static_cast<size_t>(unsent.asNumber()) : 0;
            bool hasMoreQueued;
            {
                Locker<Lock> locker(debuggerThreadMessagesLock);
                queuedBytes -= std::min(queuedBytes, pieceBytes);
                hasMoreQueued = !debuggerThreadMessages.isEmpty();
                if (unsentBytes) {
                    transportIsFull = true;
                    queuedBytesAtProgress = queuedBytes;
                    nextStallCheck = queuedBytes + stalledFrontendBacklog / 8;
                }
            }
            if (unsentBytes) {
                transportUnsentBytes = unsentBytes;
                return;
            }
            // What was queued while the transport was full has no task of its own.
            if (hasMoreQueued && undeliveredIndex == undelivered.size())
                scheduleDeliveryOnDebuggerThread();
        }
    }

    // Debugger thread. False while the transport still holds bytes, and then `queuedBytes` only grows.
    bool transportHasRoom(Zig::GlobalObject* debuggerGlobalObject)
    {
        auto& vm = debuggerGlobalObject->vm();
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

        size_t unsentBytes = 0;
        if (jsTransportUnsentBytesFunction) {
            JSValue unsent = JSC::call(debuggerGlobalObject, jsTransportUnsentBytesFunction.get(), MarkedArgumentBuffer(), "BunInspectorConnection::transportHasRoom - unsentBytesFn"_s);
            bool threw = reportExceptionOnDebuggerThread(debuggerGlobalObject, scope);
            RETURN_IF_EXCEPTION(scope, false);
            if (!threw && unsent.isNumber() && unsent.asNumber() > 0)
                unsentBytes = static_cast<size_t>(unsent.asNumber());
        }

        bool tookBytes = unsentBytes < transportUnsentBytes;
        transportUnsentBytes = unsentBytes;

        size_t stalledBytes = 0;
        {
            Locker<Lock> locker(debuggerThreadMessagesLock);
            if (!unsentBytes) {
                transportIsFull = false;
                return true;
            }
            if (tookBytes)
                queuedBytesAtProgress = queuedBytes;
            else if (queuedBytes >= queuedBytesAtProgress + stalledFrontendBacklog)
                stalledBytes = queuedBytes;
        }

        if (stalledBytes)
            dropStalledFrontend(debuggerGlobalObject, stalledBytes);
        return false;
    }

    // Debugger thread. The frontend leaves the inspector now. debugger.ts closes the transport once it has said why.
    void dropStalledFrontend(Zig::GlobalObject* debuggerGlobalObject, size_t stalledBytes)
    {
        if (JSValue dismissFn = jsTransportDismissFunction.get()) {
            auto& vm = debuggerGlobalObject->vm();
            auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            MarkedArgumentBuffer arguments;
            arguments.append(jsString(vm, makeString("Inspector frontend read nothing while "_s, stalledBytes / (1024 * 1024), " MB were queued for it"_s)));
            JSC::call(debuggerGlobalObject, dismissFn, arguments, "BunInspectorConnection::dropStalledFrontend - dismissFn"_s);
            reportExceptionOnDebuggerThread(debuggerGlobalObject, scope);
        }
        disconnectFromDebuggerThread();
    }

    // Debugger thread.
    void disconnectFromDebuggerThread()
    {
        auto status = this->status.load();
        if (status != ConnectionStatus::Connected && status != ConnectionStatus::Pending)
            return;

        this->status = ConnectionStatus::Disconnecting;
        jsBunDebuggerOnMessageFunction.clear();
        jsTransportUnsentBytesFunction.clear();
        jsTransportDismissFunction.clear();
        dropQueuedMessages();
        disconnect();
    }

    // debugger.ts runs at the top of the stack here, so what it throws has no handler.
    static bool reportExceptionOnDebuggerThread(Zig::GlobalObject* debuggerGlobalObject, JSC::TopExceptionScope& scope)
    {
        auto* exception = scope.exception();
        if (!exception) [[likely]]
            return false;
        (void)scope.tryClearException();
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(debuggerGlobalObject, exception);
        return true;
    }

    // Debugger thread.
    void dropQueuedMessages()
    {
        WTF::Vector<WTF::String, 12> dropped;
        {
            Locker<Lock> locker(debuggerThreadMessagesLock);
            queuedBytes = 0;
            dropped.swap(debuggerThreadMessages);
        }
        undelivered.clear();
        undeliveredIndex = 0;
    }

    // Debugger thread. The transport wrote what it held.
    void resumeDeliveryOnDebuggerThread()
    {
        if (transportIsFull)
            scheduleDeliveryOnDebuggerThread();
    }

    void scheduleDeliveryOnDebuggerThread()
    {
        if (this->debuggerThreadMessageScheduledCount++ == 0) {
            debuggerScriptExecutionContext->postTaskConcurrently([connection = Ref { *this }](ScriptExecutionContext& context) {
                connection->deliverMessagesOnDebuggerThread(static_cast<Zig::GlobalObject*>(context.jsGlobalObject()));
            });
        }
    }

    void sendMessageToDebuggerThread(WTF::String&& inputMessage)
    {
        size_t bytes = inputMessage.sizeInBytes();
        bool schedule = true;
        {
            Locker<Lock> locker(debuggerThreadMessagesLock);
            debuggerThreadMessages.append(WTF::move(inputMessage));
            queuedBytes += bytes;
            if (transportIsFull) [[unlikely]] {
                // Nothing is handed over now. The debugger thread asks the transport again as the queue grows.
                schedule = queuedBytes >= nextStallCheck;
                if (schedule)
                    nextStallCheck = queuedBytes + stalledFrontendBacklog / 8;
            }
        }

        if (schedule)
            scheduleDeliveryOnDebuggerThread();
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
    // Bytes in `debuggerThreadMessages` and in what is left of `undelivered`.
    size_t queuedBytes { 0 };
    // The debugger thread writes it under the lock and is the only one to read it without.
    bool transportIsFull { false };
    // `queuedBytes` when the frontend last took a byte.
    size_t queuedBytesAtProgress { 0 };
    // `queuedBytes` at which the debugger thread asks the transport again.
    size_t nextStallCheck { 0 };
    std::atomic<uint32_t> debuggerThreadMessageScheduledCount { 0 };

    // Debugger thread only: the batch it is handing to debugger.ts.
    WTF::Vector<WTF::String, 12> undelivered;
    size_t undeliveredIndex { 0 };
    size_t transportUnsentBytes { 0 };

    WTF::Vector<WTF::String, 12> jsThreadMessages;
    WTF::Lock jsThreadMessagesLock = WTF::Lock();
    std::atomic<uint32_t> jsThreadMessageScheduledCount { 0 };

    JSC::JSGlobalObject* globalObject;
    ScriptExecutionContextIdentifier scriptExecutionContextIdentifier;
    JSC::Strong<JSC::Unknown> jsBunDebuggerOnMessageFunction {};
    JSC::Strong<JSC::Unknown> jsTransportUnsentBytesFunction {};
    JSC::Strong<JSC::Unknown> jsTransportDismissFunction {};

    // Inspected thread only: the commands that turn off what this frontend turned on.
    WTF::Vector<WTF::String, 4> turnOffCommands;

    std::atomic<ConnectionStatus> status = ConnectionStatus::Pending;

    bool unrefOnDisconnect = false;

    bool hasEverConnected = false;

    // False for the in-process `inspector.Session`: no client reads its events or answers a pause.
    bool hasTransport = false;

    // Inspected thread only: this frontend's `ScriptProfiler.startTracking` asked for samples.
    bool recordsProfileSamples = false;
};

JSC_DECLARE_HOST_FUNCTION(jsFunctionSend);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDisconnect);
JSC_DECLARE_HOST_FUNCTION(jsFunctionResume);

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

    // Nothing answers a frontend that left.
    auto status = jsConnection->connection()->status.load();
    if (status != ConnectionStatus::Pending && status != ConnectionStatus::Connected)
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

    jsConnection->connection()->disconnectFromDebuggerThread();

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionResume, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    if (auto* jsConnection = dynamicDowncast<JSBunInspectorConnection>(callFrame->thisValue()))
        jsConnection->connection()->resumeDeliveryOnDebuggerThread();

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

// Not inlined, here and below: each holds one guard, and link-time optimization would copy the guard into every caller. The link charges a guard to the built-ins that reach it.
extern "C" NEVER_INLINE void BunDebugger__willHotReload()
{
    JSC_BEGIN_REMOVABLE_ENTRY_POINT(Inspector, ReturnDefault, void)
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
    JSC_END_REMOVABLE_ENTRY_POINT
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
    if (JSValue unsentBytesFn = callFrame->argument(3); unsentBytesFn.isCallable()) {
        connection->jsTransportUnsentBytesFunction = { vm, unsentBytesFn };
        connection->hasTransport = true;
    }
    if (JSValue dismissFn = callFrame->argument(4); dismissFn.isCallable())
        connection->jsTransportDismissFunction = { vm, dismissFn };
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
            RETURN_IF_EXCEPTION(scope, );
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

    // An executable that admits no debugger has none, and open() does nothing.
    if (!Bun::isDebuggerAdmitted()) [[unlikely]]
        return JSValue::encode(jsUndefined());

    // The debugger evaluates what its client sends, whatever the engine's eval setting. Returned
    // for open() to throw: what is thrown from here it reports as a port that could not be bound.
    if (Bun::isCodeGenerationFromStringsStrict()) [[unlikely]]
        return JSValue::encode(Bun::createCodeGenerationFromStringsError(globalObject));

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

extern "C" void Bun__startJSDebuggerThread(Zig::GlobalObject* debuggerGlobalObject, ScriptExecutionContextIdentifier scriptId, const BunString* portOrPathString, int isAutomatic, bool isUrlServer, bool isNodeInspector)
{
    if (!debuggerScriptExecutionContext) {
        debuggerScriptExecutionContext = debuggerGlobalObject->scriptExecutionContext();
        // For the tests: megabytes, so that a test reaches the limit without 128 MB of messages.
        if (const char* megabytes = getenv("BUN_DEBUG_TEST_INSPECTOR_BACKLOG_MB")) {
            if (auto parsed = parseInteger<uint32_t>(StringView::fromLatin1(megabytes)))
                stalledFrontendBacklog = static_cast<size_t>(*parsed) * 1024 * 1024;
        }
    }

    JSC::VM& vm = debuggerGlobalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue defaultValue = BUN_REQUIRE_INTERNAL_MODULE(debuggerGlobalObject, InternalDebugger, "node:inspector", "default"_s);
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
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 5, String(), jsFunctionCreateConnection, ImplementationVisibility::Public));
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 1, String("send"_s), jsFunctionSend, ImplementationVisibility::Public));
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 0, String("disconnect"_s), jsFunctionDisconnect, ImplementationVisibility::Public));
    arguments.append(jsBoolean(isAutomatic));
    arguments.append(jsBoolean(isUrlServer));
    arguments.append(jsBoolean(isNodeInspector));
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 3, String("reportNodeInspectorServerStarted"_s), jsFunctionReportNodeInspectorServerStarted, ImplementationVisibility::Public));
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 0, String("resume"_s), jsFunctionResume, ImplementationVisibility::Public));

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

extern "C" NEVER_INLINE void Debugger__didScheduleAsyncCall(JSGlobalObject* globalObject, AsyncCallTypeUint8 callType, uint64_t callbackId, bool singleShot)
{
    JSC_BEGIN_REMOVABLE_ENTRY_POINT(Inspector, ReturnDefault, void)
    auto* agent = debuggerAgent(globalObject);
    if (!agent)
        return;

    agent->didScheduleAsyncCall(globalObject, getCallType(callType), callbackId, singleShot);
    JSC_END_REMOVABLE_ENTRY_POINT
}

extern "C" NEVER_INLINE void Debugger__didCancelAsyncCall(JSGlobalObject* globalObject, AsyncCallTypeUint8 callType, uint64_t callbackId)
{
    JSC_BEGIN_REMOVABLE_ENTRY_POINT(Inspector, ReturnDefault, void)
    auto* agent = debuggerAgent(globalObject);
    if (!agent)
        return;

    agent->didCancelAsyncCall(getCallType(callType), callbackId);
    JSC_END_REMOVABLE_ENTRY_POINT
}

extern "C" NEVER_INLINE void Debugger__didDispatchAsyncCall(JSGlobalObject* globalObject, AsyncCallTypeUint8 callType, uint64_t callbackId)
{
    JSC_BEGIN_REMOVABLE_ENTRY_POINT(Inspector, ReturnDefault, void)
    auto* agent = debuggerAgent(globalObject);
    if (!agent)
        return;

    agent->didDispatchAsyncCall(getCallType(callType), callbackId);
    JSC_END_REMOVABLE_ENTRY_POINT
}

extern "C" NEVER_INLINE void Debugger__willDispatchAsyncCall(JSGlobalObject* globalObject, AsyncCallTypeUint8 callType, uint64_t callbackId)
{
    JSC_BEGIN_REMOVABLE_ENTRY_POINT(Inspector, ReturnDefault, void)
    auto* agent = debuggerAgent(globalObject);
    if (!agent)
        return;

    agent->willDispatchAsyncCall(getCallType(callType), callbackId);
    JSC_END_REMOVABLE_ENTRY_POINT
}

extern "C" NEVER_INLINE void Bun__InspectorConnection__disconnectAllOnExit(Zig::GlobalObject* globalObject)
{
    JSC_BEGIN_REMOVABLE_ENTRY_POINT(Inspector, ReturnDefault, void)
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
    JSC_END_REMOVABLE_ENTRY_POINT
}
}
