#include "root.h"
#include <uws/src/App.h>

#include <JavaScriptCore/InspectorFrontendChannel.h>
#include <JavaScriptCore/JSGlobalObjectDebuggable.h>
#include <JavaScriptCore/JSGlobalObjectDebugger.h>
#include <JavaScriptCore/Debugger.h>
#include "ScriptExecutionContext.h"
#include "Strong.h"

extern "C" void Bun__tickWhilePaused(bool*);

namespace Bun {
using namespace JSC;
using namespace WebCore;

static WebCore::ScriptExecutionContext* debuggerScriptExecutionContext = nullptr;
static HashMap<ScriptExecutionContextIdentifier, void*>* inspectorConnections = nullptr;

class BunInspectorConnection : public Inspector::FrontendChannel {
    WTF_MAKE_ISO_ALLOCATED(BunInspectorConnection);

public:
    BunInspectorConnection(ScriptExecutionContext& scriptExecutionContext, JSC::JSGlobalObject* globalObject)
        : Inspector::FrontendChannel()
        , globalObject(globalObject)
        , scriptExecutionContextIdentifier(scriptExecutionContext.identifier())
    {
    }

    ~BunInspectorConnection()
    {
    }

    static BunInspectorConnection* create(ScriptExecutionContext& scriptExecutionContext, JSC::JSGlobalObject* globalObject)
    {
        return new BunInspectorConnection(scriptExecutionContext, globalObject);
    }

    ConnectionType connectionType() const override
    {
        return ConnectionType::Remote;
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
        auto* connection = reinterpret_cast<BunInspectorConnection*>(inspectorConnections->get(global->scriptExecutionContext()->identifier()));
        while (!isDoneProcessingEvents) {
            connection->jsWaitForMessageFromInspectorLock.lock();
            connection->receiveMessagesOnInspectorThread(*global->scriptExecutionContext(), global);
        }
    }

    void receiveMessagesOnInspectorThread(ScriptExecutionContext& context, Zig::GlobalObject* globalObject)
    {
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

        debuggerScriptExecutionContext->postTaskConcurrently([connection = this](ScriptExecutionContext& context) {
            connection->receiveMessagesOnDebuggerThread(context, reinterpret_cast<Zig::GlobalObject*>(context.jsGlobalObject()));
        });
    }

    void sendMessageToInspectorFromDebuggerThread(WTF::String inputMessage)
    {
        {
            WTF::LockHolder locker(jsThreadMessagesLock);
            jsThreadMessages.append(inputMessage);
        }

        if (this->jsWaitForMessageFromInspectorLock.isHeld()) {
            this->jsWaitForMessageFromInspectorLock.unlock();
        } else {
            ScriptExecutionContext::postTaskTo(scriptExecutionContextIdentifier, [connection = this](ScriptExecutionContext& context) {
                connection->receiveMessagesOnInspectorThread(context, reinterpret_cast<Zig::GlobalObject*>(context.jsGlobalObject()));
            });
        }
    }

    WTF::Vector<WTF::String, 12> debuggerThreadMessages = WTF::Vector<WTF::String, 12>();
    WTF::Lock debuggerThreadMessagesLock = WTF::Lock();
    std::atomic<uint32_t> debuggerThreadMessageScheduledCount { 0 };

    WTF::Vector<WTF::String, 12> jsThreadMessages = WTF::Vector<WTF::String, 12>();
    WTF::Lock jsThreadMessagesLock = WTF::Lock();
    std::atomic<uint32_t> jsThreadMessageScheduledCount { 0 };

    JSC::JSGlobalObject* globalObject;
    ScriptExecutionContextIdentifier scriptExecutionContextIdentifier;
    Bun::StrongRef* jsBunDebuggerOnMessageFunction = nullptr;

    WTF::Lock jsWaitForMessageFromInspectorLock;
};

WTF_MAKE_ISO_ALLOCATED_IMPL(BunInspectorConnection);

JSC_DEFINE_HOST_FUNCTION(jsFunctionSendMessageToFrontend, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    BunInspectorConnection* connection = reinterpret_cast<BunInspectorConnection*>(inspectorConnections->get(callFrame->thisValue().asUInt32()));
#ifdef BUN_DEBUG
    RELEASE_ASSERT(connection);
#endif

    auto out = callFrame->uncheckedArgument(0).toWTFString(globalObject);
    if (out.length() > 0)
        connection->sendMessageToInspectorFromDebuggerThread(out);
    return JSValue::encode(jsUndefined());
}

extern "C" unsigned int Bun__createJSDebugger(Zig::GlobalObject* globalObject)
{
    if (!inspectorConnections) {
        inspectorConnections = new HashMap<ScriptExecutionContextIdentifier, void*>();
    }
    BunInspectorConnection* connection = BunInspectorConnection::create(*globalObject->scriptExecutionContext(), globalObject);
    inspectorConnections->add(globalObject->scriptExecutionContext()->identifier(), connection);
    return static_cast<unsigned int>(globalObject->scriptExecutionContext()->identifier());
}
extern "C" void Bun__tickWhilePaused(bool*);

extern "C" void Bun__waitForDebugger(ScriptExecutionContextIdentifier scriptId)
{
    auto* connection = reinterpret_cast<BunInspectorConnection*>(inspectorConnections->get(scriptId));
    auto* globalObject = connection->globalObject;

    globalObject->setInspectable(true);

    auto& inspector = globalObject->inspectorDebuggable();

    inspector.connect(*connection);

    Inspector::JSGlobalObjectDebugger* debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(globalObject->debugger());
    if (debugger) {
        debugger->runWhilePausedCallback = [](JSC::JSGlobalObject& globalObject, bool& isDoneProcessingEvents) -> void {
            BunInspectorConnection::runWhilePaused(globalObject, isDoneProcessingEvents);
        };
    }

    inspector.pauseWaitingForAutomaticInspection();
}

extern "C" void Bun__startJSDebuggerThread(Zig::GlobalObject* debuggerGlobalObject, ScriptExecutionContextIdentifier scriptId, BunString* portOrPathString)
{
    if (!debuggerScriptExecutionContext)
        debuggerScriptExecutionContext = debuggerGlobalObject->scriptExecutionContext();
    JSC::VM& vm = debuggerGlobalObject->vm();
    JSValue defaultValue = debuggerGlobalObject->internalModuleRegistry()->requireId(debuggerGlobalObject, vm, InternalModuleRegistry::Field::InternalDebugger);
    JSFunction* debuggerDefaultFn = jsCast<JSFunction*>(defaultValue.asCell());

    MarkedArgumentBuffer arguments;
    auto* connection = reinterpret_cast<BunInspectorConnection*>(inspectorConnections->get(scriptId));

    arguments.append(jsNumber(static_cast<unsigned int>(scriptId)));
    arguments.append(Bun::toJS(debuggerGlobalObject, *portOrPathString));
    arguments.append(JSFunction::create(vm, debuggerGlobalObject, 1, String(), jsFunctionSendMessageToFrontend, ImplementationVisibility::Public));

    JSValue onMessageFunction = JSC::call(debuggerGlobalObject, debuggerDefaultFn, arguments, "Bun__initJSDebuggerThread - debuggerDefaultFn"_s);
    if (!onMessageFunction) {
        return;
    }
    RELEASE_ASSERT(onMessageFunction.isCallable());
    connection->jsBunDebuggerOnMessageFunction = new Bun::StrongRef(vm, onMessageFunction);
}
}
