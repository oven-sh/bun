#include "ApiFixtures.h"

using namespace JSC;
using namespace Inspector;

namespace {

struct Frontend final : FrontendChannel {
    void sendMessageToFrontend(const String& message) final { messages.append(message); }

    String take()
    {
        StringBuilder all;
        for (auto& message : std::exchange(messages, {}))
            all.append(message, '\n');
        return all.toString();
    }

    Vector<String> messages;
};

struct Client final : InspectorClient {
    JSValue subtype(JSGlobalObject*, JSValue) final { return jsUndefined(); }
    JSValue getInternalProperties(VM&, JSGlobalObject*, JSValue) final { return {}; }
    void frontendInitialized() final { ++initializedCount; }

    void runWhilePaused(JSGlobalObject& globalObject, bool& isDone) final
    {
        auto& inspector = globalObject.inspectorController();
        EXPECT(inspector.isPaused() && !isDone);
        ++pauseCount;
        inspector.dispatchMessageFromFrontend(R"({"id":9,"method":"Debugger.resume"})"_s);
        EXPECT(isDone);
    }

    unsigned initializedCount { 0 };
    unsigned pauseCount { 0 };
};

class Agent final : public InspectorAgentBase {
    WTF_MAKE_TZONE_ALLOCATED(Agent);

public:
    Agent(JSGlobalObject& globalObject, int& enableCount)
        : InspectorAgentBase(globalObject, "Test"_s)
        , m_enableCount(enableCount)
    {
    }

private:
    void didEnable() final { ++m_enableCount; }
    void didDisable() final { --m_enableCount; }

    std::optional<CommandResult> runCommand(StringView command) final
    {
        if (command == "fail"_s)
            return makeUnexpected(ErrorString { "Failed"_s });
        if (command != "echo"_s)
            return std::nullopt;
        auto object = JSON::Object::create();
        object->setValue("isEnabled"_s, JSON::Value::create(isEnabled()));
        sendEvent("echoed"_s, object.copyRef());
        return object;
    }

    int& m_enableCount;
};

}

TEST(InspectorAgentOfEmbedder)
{
    Client client;
    Frontend first, second;
    int enableCount = 0;
    Test::Realm realm;
    EXPECT(!realm.global->hasInspectorController());
    auto& inspector = realm.global->inspectorController();
    inspector.registerAgent(makeUniqueRef<Agent>(*realm.global, enableCount));
    inspector.connectFrontend(first, client);
    auto send = [&](ASCIILiteral message) {
        inspector.dispatchMessageFromFrontend(message);
        return first.take();
    };

    EXPECT(send(R"({"id":1,"method":"Test.enable"})"_s) == "{\"result\":{},\"id\":1}\n"_s);
    EXPECT(send(R"({"id":2,"method":"Test.enable"})"_s) == "{\"result\":{},\"id\":2}\n"_s);
    EXPECT(enableCount == 1);
    EXPECT(send(R"({"id":3,"method":"Test.echo"})"_s) == R"({"method":"Test.echoed","params":{"isEnabled":true}}
{"result":{"isEnabled":true},"id":3}
)"_s);
    EXPECT(send(R"({"id":4,"method":"Test.fail"})"_s) == R"({"error":{"code":-32000,"message":"Failed","data":[{"code":-32000,"message":"Failed"}]},"id":4}
)"_s);
    EXPECT(send(R"({"id":5,"method":"Test.other"})"_s) == R"({"error":{"code":-32601,"message":"'Test.other' was not found","data":[{"code":-32601,"message":"'Test.other' was not found"}]},"id":5}
)"_s);
    EXPECT(send(R"({"id":6,"method":"Other.enable"})"_s) == R"({"error":{"code":-32601,"message":"'Other' domain was not found","data":[{"code":-32601,"message":"'Other' domain was not found"}]},"id":6}
)"_s);

    inspector.connectFrontend(second, client);
    EXPECT(send(R"({"id":7,"method":"Inspector.initialized"})"_s) == second.take());
    EXPECT(client.initializedCount == 1);
    inspector.disconnectFrontend(second);
    EXPECT(!enableCount && inspector.hasFrontend());
    send(R"({"id":8,"method":"Test.enable"})"_s);
    EXPECT(second.messages.isEmpty());
    inspector.disconnectFrontend(first);
    EXPECT(!enableCount && !inspector.hasFrontend());
}

TEST(InspectorPausesAndResumes)
{
    Client client;
    Frontend frontend;
    Test::Realm realm;
    auto& inspector = realm.global->inspectorController();
    inspector.connectFrontend(frontend, client);
    EXPECT(!realm.global->hasDebugger());
    for (auto message : { R"({"id":1,"method":"Debugger.enable"})"_s, R"({"id":2,"method":"Debugger.setBreakpointsActive","params":{"active":true}})"_s, R"({"id":3,"method":"Debugger.setPauseOnDebuggerStatements","params":{"enabled":true}})"_s })
        inspector.dispatchMessageFromFrontend(message);
    EXPECT(realm.global->hasDebugger() && inspector.isInteractivelyDebugging());

    EXPECT(realm.run("debugger; 1"_s) == jsNumber(1));
    EXPECT(client.pauseCount == 1 && !inspector.isPaused());
    String messages = frontend.take();
    EXPECT(messages.contains("\"Debugger.scriptParsed\""_s) && messages.contains("\"Debugger.paused\""_s));

    inspector.disconnectFrontend(frontend);
    EXPECT(!realm.global->hasDebugger());
    inspector.discardValues();
}

TEST(InspectorKeepsConsoleMessagesForFrontend)
{
    Client client;
    Frontend frontend;
    Test::Realm realm;
    auto& inspector = realm.global->inspectorController();
    {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(realm.vm);
        EncodedJSValue arguments[] = { JSValue::encode(jsString(realm.vm, String("early"_s))) };
        inspector.addConsoleMessage(realm.global, MessageType::Log, MessageLevel::Warning, arguments);
        EXPECT(!scope.exception());
    }
    realm.collect();
    inspector.connectFrontend(frontend, client);
    inspector.dispatchMessageFromFrontend(R"({"id":1,"method":"Console.enable"})"_s);
    EXPECT(frontend.take().contains(R"("level":"warning","text":"early")"_s));
    inspector.disconnectFrontend(frontend);
}
