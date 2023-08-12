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
        this->sendMessageToDebuggerThread(message.isolatedCopy());
    }

    void receiveMessagesOnInspectorThread(ScriptExecutionContext& context, Zig::GlobalObject* globalObject)
    {
        jsThreadMessageScheduledCount = 0;
        WTF::Vector<WTF::String, 12> jsThreadMessages;

        {
            WTF::LockHolder locker(jsThreadMessagesLock);
            this->jsThreadMessages.swap(jsThreadMessages);
        }

        auto& debugger = globalObject->inspectorDebuggable();

        for (auto message : jsThreadMessages) {
            debugger.dispatchMessageFromRemote(WTFMove(message));
        }
        jsThreadMessages.clear();
    }

    void receiveMessagesOnDebuggerThread(ScriptExecutionContext& context, Zig::GlobalObject* debuggerGlobalObject)
    {
        debuggerThreadMessageScheduledCount = 0;
        WTF::Vector<WTF::String, 12> debuggerThreadMessages;

        {
            WTF::LockHolder locker(debuggerThreadMessagesLock);
            this->debuggerThreadMessages.swap(debuggerThreadMessages);
        }

        JSFunction* onMessageFn = jsCast<JSFunction*>(jsBunDebuggerOnMessageFunction->m_cell.get());
        MarkedArgumentBuffer arguments;
        arguments.ensureCapacity(debuggerThreadMessages.size() + 1);
        arguments.append(jsNumber(static_cast<unsigned>(this->scriptExecutionContextIdentifier)));
        auto& vm = debuggerGlobalObject->vm();

        for (auto& message : debuggerThreadMessages) {
            arguments.append(jsString(vm, message));
        }

        debuggerThreadMessages.clear();

        JSC::call(debuggerGlobalObject, onMessageFn, arguments, "BunInspectorConnection::receiveMessagesOnDebuggerThread - onMessageFn"_s);
    }

    void sendMessageToDebuggerThread(WTF::String&& inputMessage)
    {

        WTF::Locker locker(debuggerThreadMessagesLock);
        debuggerThreadMessages.append(inputMessage);
        if (debuggerThreadMessageScheduledCount++ == 0) {
            debuggerScriptExecutionContext->postTaskConcurrently([connection = this](ScriptExecutionContext& context) {
                connection->receiveMessagesOnDebuggerThread(context, reinterpret_cast<Zig::GlobalObject*>(context.jsGlobalObject()));
            });
        }
    }

    void sendMessageToInspectorFromDebuggerThread(WTF::String inputMessage)
    {
        {
            WTF::Locker locker(jsThreadMessagesLock);
            jsThreadMessages.append(inputMessage);
        }

        if (!this->jsWaitForMessageFromInspectorLock.isHeld()) {
            if (this->jsThreadMessageScheduledCount++ == 0) {
                ScriptExecutionContext::postTaskTo(scriptExecutionContextIdentifier, [connection = this](ScriptExecutionContext& context) {
                    connection->receiveMessagesOnInspectorThread(context, reinterpret_cast<Zig::GlobalObject*>(context.jsGlobalObject()));
                });
            }
        } else {
            this->jsWaitForMessageFromInspectorLock.unlockFairly();
        }
    }

    WTF::Vector<WTF::String, 12> debuggerThreadMessages;
    WTF::Lock debuggerThreadMessagesLock;
    std::atomic<uint32_t> debuggerThreadMessageScheduledCount { 0 };

    WTF::Vector<WTF::String, 12> jsThreadMessages;
    WTF::Lock jsThreadMessagesLock;
    std::atomic<uint32_t> jsThreadMessageScheduledCount { 0 };

    JSC::JSGlobalObject* globalObject;
    ScriptExecutionContextIdentifier scriptExecutionContextIdentifier;
    Bun::StrongRef* jsBunDebuggerOnMessageFunction = nullptr;

    WTF::Lock jsWaitForDebuggerThreadToStartLock;
    WTF::Lock jsWaitForMessageFromInspectorLock;
};

WTF_MAKE_ISO_ALLOCATED_IMPL(BunInspectorConnection);

JSC_DEFINE_HOST_FUNCTION(jsFunctionSendMessageToFrontend, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    BunInspectorConnection* connection = reinterpret_cast<BunInspectorConnection*>(inspectorConnections->get(callFrame->uncheckedArgument(0).asUInt32()));
#ifdef BUN_DEBUG
    RELEASE_ASSERT(connection);
#endif

    connection->sendMessageToInspectorFromDebuggerThread(callFrame->uncheckedArgument(1).toWTFString(globalObject));
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
    connection->globalObject->setInspectable(true);
    Inspector::JSGlobalObjectDebugger* debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(connection->globalObject->debugger());
    if (debugger) {
        debugger->runWhilePausedCallback = [](JSC::JSGlobalObject& globalObject, bool& done) -> void {
            Bun__tickWhilePaused(&done);
        };
        connection->globalObject->inspectorDebuggable().connect(*connection, false, true);
    }
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
    connection->jsWaitForDebuggerThreadToStartLock.unlockFairly();
}
}
