#include "root.h"

#include <JavaScriptCore/InspectorFrontendChannel.h>
#include <JavaScriptCore/JSGlobalObjectDebuggable.h>
#include <JavaScriptCore/JSGlobalObjectDebugger.h>
#include <JavaScriptCore/Debugger.h>
#include "ScriptExecutionContext.h"
#include "Strong.h"
#include "debug-helpers.h"
#include "BunInjectedScriptHost.h"
#include <JavaScriptCore/JSGlobalObjectInspectorController.h>

extern "C" void Bun__tickWhilePaused(bool*);
extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);

namespace Bun {
using namespace JSC;
using namespace WebCore;

class BunInspectorConnection;

static WebCore::ScriptExecutionContext* debuggerScriptExecutionContext = nullptr;
static WTF::Lock inspectorConnectionsLock = WTF::Lock();
static WTF::HashMap<ScriptExecutionContextIdentifier, Vector<BunInspectorConnection*, 8>>* inspectorConnections = nullptr;

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

    void pauseWaitingForAutomaticInspection() override
    {
    }
    void unpauseForInitializedInspector() override
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
                connection->status = ConnectionStatus::Connected;
                auto* globalObject = context.jsGlobalObject();
                if (connection->unrefOnDisconnect) {
                    Bun__eventLoop__incrementRefConcurrently(reinterpret_cast<Zig::GlobalObject*>(globalObject)->bunVM(), 1);
                }
                globalObject->setInspectable(true);
                auto& inspector = globalObject->inspectorDebuggable();
                inspector.setInspectable(true);
                globalObject->inspectorController().connectFrontend(*connection, true, waitingForConnection);

                Inspector::JSGlobalObjectDebugger* debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(globalObject->debugger());
                if (debugger) {
                    debugger->runWhilePausedCallback = [](JSC::JSGlobalObject& globalObject, bool& isDoneProcessingEvents) -> void {
                        BunInspectorConnection::runWhilePaused(globalObject, isDoneProcessingEvents);
                    };
                }

                connection->receiveMessagesOnInspectorThread(context, reinterpret_cast<Zig::GlobalObject*>(globalObject));
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
            connection->inspector().disconnect(*connection);
            if (connection->unrefOnDisconnect) {
                connection->unrefOnDisconnect = false;
                Bun__eventLoop__incrementRefConcurrently(reinterpret_cast<Zig::GlobalObject*>(context.jsGlobalObject())->bunVM(), -1);
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
        Zig::GlobalObject* global = reinterpret_cast<Zig::GlobalObject*>(&globalObject);
        Vector<BunInspectorConnection*, 8> connections;
        {
            WTF::LockHolder locker(inspectorConnectionsLock);
            connections.appendVector(inspectorConnections->get(global->scriptExecutionContext()->identifier()));
        }

        for (auto* connection : connections) {
            if (connection->status == ConnectionStatus::Pending) {
                connection->connect();
            }

            if (connection->status != ConnectionStatus::Disconnected) {
                connection->receiveMessagesOnInspectorThread(*global->scriptExecutionContext(), global);
            }
        }

        // for (auto* connection : connections) {
        //     if (connection->status == ConnectionStatus::Connected) {
        //         connection->jsWaitForMessageFromInspectorLock.lock();
        //     }
        // }

        if (connections.size() == 1) {
            while (!isDoneProcessingEvents) {
                auto* connection = connections[0];
                if (connection->status == ConnectionStatus::Disconnected || connection->status == ConnectionStatus::Disconnecting) {
                    if (global->debugger() && global->debugger()->isPaused()) {
                        global->debugger()->continueProgram();
                    }
                    break;
                }
                connection->receiveMessagesOnInspectorThread(*global->scriptExecutionContext(), global);
            }
        } else {
            while (!isDoneProcessingEvents) {
                size_t closedCount = 0;
                for (auto* connection : connections) {
                    closedCount += connection->status == ConnectionStatus::Disconnected || connection->status == ConnectionStatus::Disconnecting;
                    connection->receiveMessagesOnInspectorThread(*global->scriptExecutionContext(), global);
                    if (isDoneProcessingEvents)
                        break;
                }

                if (closedCount == connections.size() && global->debugger() && !isDoneProcessingEvents) {
                    global->debugger()->continueProgram();
                    continue;
                }
            }
        }
    }

    void receiveMessagesOnInspectorThread(ScriptExecutionContext& context, Zig::GlobalObject* globalObject)
    {
        this->jsThreadMessageScheduledCount.store(0);
        WTF::Vector<WTF::String, 12> messages;

        {
            WTF::LockHolder locker(jsThreadMessagesLock);
            this->jsThreadMessages.swap(messages);
        }

        auto& dispatcher = globalObject->inspectorDebuggable();
        Inspector::JSGlobalObjectDebugger* debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(globalObject->debugger());

        if (!debugger) {
            for (auto message : messages) {
                dispatcher.dispatchMessageFromRemote(WTFMove(message));

                debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(globalObject->debugger());
                if (debugger) {
                    debugger->runWhilePausedCallback = [](JSC::JSGlobalObject& globalObject, bool& isDoneProcessingEvents) -> void {
                        runWhilePaused(globalObject, isDoneProcessingEvents);
                    };
                }
            }
        } else {
            for (auto message : messages) {
                dispatcher.dispatchMessageFromRemote(WTFMove(message));
            }
        }

        messages.clear();
    }

    void receiveMessagesOnDebuggerThread(ScriptExecutionContext& context, Zig::GlobalObject* debuggerGlobalObject)
    {
        debuggerThreadMessageScheduledCount.store(0);
        WTF::Vector<WTF::String, 12> messages;

        {
            WTF::LockHolder locker(debuggerThreadMessagesLock);
            this->debuggerThreadMessages.swap(messages);
        }

        JSFunction* onMessageFn = jsCast<JSFunction*>(jsBunDebuggerOnMessageFunction->m_cell.get());
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
            WTF::LockHolder locker(debuggerThreadMessagesLock);
            debuggerThreadMessages.append(inputMessage);
        }

        if (this->debuggerThreadMessageScheduledCount++ == 0) {
            debuggerScriptExecutionContext->postTaskConcurrently([connection = this](ScriptExecutionContext& context) {
                connection->receiveMessagesOnDebuggerThread(context, reinterpret_cast<Zig::GlobalObject*>(context.jsGlobalObject()));
            });
        }
    }

    void sendMessageToInspectorFromDebuggerThread(const WTF::String& inputMessage)
    {
        {
            WTF::LockHolder locker(jsThreadMessagesLock);
            jsThreadMessages.append(inputMessage);
        }

        if (this->jsWaitForMessageFromInspectorLock.isLocked()) {
            this->jsWaitForMessageFromInspectorLock.unlock();
        } else if (this->jsThreadMessageScheduledCount++ == 0) {
            ScriptExecutionContext::postTaskTo(scriptExecutionContextIdentifier, [connection = this](ScriptExecutionContext& context) {
                connection->receiveMessagesOnInspectorThread(context, reinterpret_cast<Zig::GlobalObject*>(context.jsGlobalObject()));
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
    Bun::StrongRef* jsBunDebuggerOnMessageFunction = nullptr;

    WTF::Lock jsWaitForMessageFromInspectorLock;
    std::atomic<ConnectionStatus> status = ConnectionStatus::Pending;

    bool unrefOnDisconnect = false;
};

JSC_DECLARE_HOST_FUNCTION(jsFunctionSend);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDisconnect);

class JSBunInspectorConnection final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr bool needsDestruction = false;

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
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), JSC::NonArray, 2);
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
    auto message = callFrame->uncheckedArgument(0).toWTFString(globalObject).isolatedCopy();

    if (!jsConnection)
        return JSValue::encode(jsUndefined());

    jsConnection->connection()->sendMessageToInspectorFromDebuggerThread(message);

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
        WTF::LockHolder locker(inspectorConnectionsLock);
        if (inspectorConnections == nullptr) {
            inspectorConnections = new WTF::HashMap<ScriptExecutionContextIdentifier, Vector<BunInspectorConnection*, 8>>();
        }

        inspectorConnections->add(globalObject->scriptExecutionContext()->identifier(), Vector<BunInspectorConnection*, 8>());
    }

    return static_cast<unsigned int>(globalObject->scriptExecutionContext()->identifier());
}
extern "C" void Bun__tickWhilePaused(bool*);

extern "C" void Bun__ensureDebugger(ScriptExecutionContextIdentifier scriptId, bool pauseOnStart)
{

    auto* globalObject = ScriptExecutionContext::getScriptExecutionContext(scriptId)->jsGlobalObject();
    globalObject->m_inspectorController = makeUnique<Inspector::JSGlobalObjectInspectorController>(*globalObject, Bun::BunInjectedScriptHost::create());
    globalObject->m_inspectorDebuggable = makeUnique<BunJSGlobalObjectDebuggable>(*globalObject);

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

    auto& vm = globalObject->vm();
    auto connection = BunInspectorConnection::create(
        *targetContext,
        targetContext->jsGlobalObject(), shouldRef);

    {
        WTF::LockHolder locker(inspectorConnectionsLock);
        auto connections = inspectorConnections->get(targetContext->identifier());
        connections.append(connection);
        inspectorConnections->set(targetContext->identifier(), connections);
    }
    connection->jsBunDebuggerOnMessageFunction = new Bun::StrongRef(vm, onMessageFn);
    connection->connect();

    return JSValue::encode(JSBunInspectorConnection::create(vm, JSBunInspectorConnection::createStructure(vm, globalObject, globalObject->objectPrototype()), connection));
}

extern "C" BunString Bun__startJSDebuggerThread(Zig::GlobalObject* debuggerGlobalObject, ScriptExecutionContextIdentifier scriptId, BunString* portOrPathString)
{
    if (!debuggerScriptExecutionContext)
        debuggerScriptExecutionContext = debuggerGlobalObject->scriptExecutionContext();
    JSC::VM& vm = debuggerGlobalObject->vm();
    JSValue defaultValue = debuggerGlobalObject->internalModuleRegistry()->requireId(debuggerGlobalObject, vm, InternalModuleRegistry::Field::InternalDebugger);
    JSFunction* debuggerDefaultFn = jsCast<JSFunction*>(defaultValue.asCell());

    MarkedArgumentBuffer arguments;

    arguments.append(jsNumber(static_cast<unsigned int>(scriptId)));
    arguments.append(Bun::toJS(debuggerGlobalObject, *portOrPathString));
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 3, String(), jsFunctionCreateConnection, ImplementationVisibility::Public));
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 1, String("send"_s), jsFunctionSend, ImplementationVisibility::Public));
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 0, String("disconnect"_s), jsFunctionDisconnect, ImplementationVisibility::Public));

    JSValue serverURLValue = JSC::call(debuggerGlobalObject, debuggerDefaultFn, arguments, "Bun__initJSDebuggerThread - debuggerDefaultFn"_s);

    if (serverURLValue.isUndefinedOrNull())
        return BunStringEmpty;

    return Bun::toStringRef(debuggerGlobalObject, serverURLValue);
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
    Inspector::InspectorDebuggerAgent::AsyncCallType type;
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
}
