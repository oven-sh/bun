#include "BunInspector.h"
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include "JSGlobalObjectInspectorController.h"
#include <JavaScriptCore/JSGlobalObjectDebugger.h>

namespace Zig {

WTF_MAKE_ISO_ALLOCATED_IMPL(BunInspector);

class BunInspectorConnection {

public:
    WTF::Deque<WTF::CString> m_messages;
    RefPtr<BunInspector> inspector;
    bool hasSentWelcomeMessage = false;
    BunInspectorConnection(RefPtr<BunInspector> inspector)
        : inspector(inspector)
        , m_messages()
    {
    }
};

void BunInspector::sendMessageToFrontend(const String& message)
{

    String out = message;
    auto jsonObject = WTF::JSONImpl::Value::parseJSON(message);
    if (jsonObject) {
        if (auto object = jsonObject->asObject()) {
            auto method = object->getString("method"_s);

            // {
            //   "scriptId": "384",
            //   "url": "file:///private/tmp/empty.js",
            //   "startLine": 0,
            //   "startColumn": 0,
            //   "endLine": 1,
            //   "endColumn": 0,
            //   "executionContextId": 1,
            //   "hash": "a3b314362f7e47deabee6100e0d8081619194faf1b5741e0fe2f88b150557ddd",
            //   "executionContextAuxData": { "isDefault": true },
            //   "isLiveEdit": false,
            //   "sourceMapURL": "",
            //   "hasSourceURL": false,
            //   "isModule": false,
            //   "length": 21,
            //   "stackTrace": {
            //     "callFrames": [
            //       {
            //         "functionName": "internalCompileFunction",
            //         "scriptId": "62",
            //         "url": "node:internal/vm",
            //         "lineNumber": 72,
            //         "columnNumber": 17
            //       }
            //     ]
            //   },
            //   "scriptLanguage": "JavaScript",
            //   "embedderName": "file:///private/tmp/empty.js"
            // }
            if (method == "Debugger.scriptParsed"_s) {
                if (auto params = object->getObject("params"_s)) {
                    params->setInteger("executionContextId"_s, 1);
                    auto url = makeString("file://"_s, params->getString("url"_s));
                    params->setString("url"_s, url);
                    // TODO: content hash
                    params->setInteger("hash"_s, url.hash());
                    params->setBoolean("isModule"_s, true);
                    params->setString("scriptLanguage"_s, "JavaScript"_s);
                    params->setString("embedderName"_s, "Bun!"_s);
                }

                out = object->toJSONString();
            }

            if (method == "Debugger.enable"_s) {
                // debuggerId is missing from the response
                auto params = WTF::JSONImpl::Object::create();
                params->setString("debuggerId"_s, "3701622443570787625.-8711178633418819848"_s);
                object->setObject("params"_s, WTFMove(params));
            }

            out = object->toJSONString();
        }
    }

    auto utf8Message = out.utf8();
    if (this->m_pendingMessages.size() > 0) {
        this->m_pendingMessages.append(WTFMove(utf8Message));
        return;
    }

    std::string_view view { utf8Message.data(), utf8Message.length() };
    if (!this->server->publish("BunInspectorConnection", view, uWS::OpCode::TEXT, false)) {
        this->m_pendingMessages.append(WTFMove(utf8Message));
    }
}

void BunInspector::drainOutgoingMessages()
{

    size_t size = this->m_pendingMessages.size();
    while (size > 0) {
        auto& message = this->m_pendingMessages.first();
        std::string_view view { message.data(), message.length() };
        if (!this->server->publish("BunInspectorConnection", view, uWS::OpCode::TEXT, false)) {
            return;
        }
        this->m_pendingMessages.removeFirst();
        size = this->m_pendingMessages.size();
    }
}

extern "C" void Bun__tickWhileWaitingForDebugger(JSC::JSGlobalObject* globalObject);

RefPtr<BunInspector> BunInspector::startWebSocketServer(
    WebCore::ScriptExecutionContext& context,
    WTF::String hostname,
    uint16_t port,
    WTF::Function<void(RefPtr<BunInspector>, bool success)>&& callback)
{
    context.ensureURL();
    auto url = context.url();
    auto identifier = url.fileSystemPath();

    auto title = makeString(
        url.fileSystemPath(),
        " (Bun "_s, Bun__version, ")"_s);

    auto* globalObject = context.jsGlobalObject();

    uWS::App* app = new uWS::App();
    RefPtr<BunInspector> inspector = adoptRef(*new BunInspector(&context, app, WTFMove(identifier)));
    auto host = hostname.utf8();

    // https://chromedevtools.github.io/devtools-protocol/  GET /json or /json/list
    app->get("/json", [hostname, port, url, title = title, inspector](auto* res, auto* /*req*/) {
           auto identifier = inspector->identifier();
           auto jsonString = makeString(
               "[ {\"faviconUrl\": \"https://bun.sh/favicon.svg\", \"description\": \"\", \"devtoolsFrontendUrl\": \"devtools://devtools/bundled/js_app.html?experiments=true&v8only=true&ws="_s,
               hostname,
               ":"_s,
               port,
               "/devtools/page/"_s,
               identifier,
               "\","_s
               "  \"id\": \"6e99c4f9-6bb6-4f45-9749-5772545b2371\","_s,
               "  \"title\": \""_s,
               title,
               "\","
               "  \"type\": \"node\","_s,
               "  \"url\": \"file://"_s,
               identifier,
               "\","_s
               "  \"webSocketDebuggerUrl\": \"ws://"_s,
               hostname,
               ":"_s,
               port,
               "/devtools/page/"_s,
               identifier,
               "\"} ]"_s);
           auto utf8 = jsonString.utf8();
           res->writeStatus("200 OK");
           res->writeHeader("Content-Type", "application/json");
           res->end(utf8.data(), utf8.length());
       })
        .get("/json/version", [](auto* res, auto* req) {
            auto out = makeString("{\"Browser\": \"Bun/"_s, Bun__version, "\",\"Protocol-Version\": \"1.1\"}"_s);
            auto utf8 = out.utf8();
            res->writeStatus("200 OK");
            res->writeHeader("Content-Type", "application/json");
            res->end({ utf8.data(), utf8.length() });
        })
        .ws<BunInspectorConnection*>("/*", { /* Settings */
                                               .compression = uWS::DISABLED,
                                               .maxPayloadLength = 1024 * 1024 * 1024,
                                               .idleTimeout = 512,
                                               .maxBackpressure = 64 * 1024 * 1024,
                                               .closeOnBackpressureLimit = false,
                                               .resetIdleTimeoutOnSend = false,
                                               .sendPingsAutomatically = true,
                                               /* Handlers */
                                               .upgrade = nullptr,
                                               .open = [inspector](auto* ws) {
                BunInspectorConnection** connectionPtr = ws->getUserData();
                *connectionPtr = new BunInspectorConnection(inspector);
                ws->subscribe("BunInspectorConnection");
                BunInspectorConnection* connection = *connectionPtr;
                inspector->connect(Inspector::FrontendChannel::ConnectionType::Local);
                 auto* debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(inspector->globalObject()->inspectorController().debugger());
    debugger->runWhilePausedCallback = [](JSC::JSGlobalObject& globalObject, bool& isPaused) {
        while (isPaused) {
            Bun__tickWhileWaitingForDebugger(&globalObject);
        }
    }; },

                                               .message = [inspector](auto* ws, std::string_view message, uWS::OpCode opCode) {
        if (opCode == uWS::OpCode::TEXT) {
            if (!inspector) {
                ws->close();
                return;
            }

            BunInspectorConnection** connectionPtr = ws->getUserData();
            BunInspectorConnection* connection = *connectionPtr;
        //       if (!connection->hasSentWelcomeMessage) {
        //     connection->hasSentWelcomeMessage = true;
        //     auto welcomeMessage = makeString(
        //                                                                 "{ \"method\": \"Runtime.executionContextCreated\", \"params\":{\"context\":{\"id\":"_s,  
        //                                                                 connection->inspector->scriptExecutionContext()->identifier(), 
        //                                                                 ",\"origin\":\"\",\"name\":\""_s, 
        //                                                                 connection->inspector->identifier(), 
        //                                                                 "\",\"uniqueId\":\"1234\",\"auxData\":{\"isDefault\":true}}}}"_s
        //                                                             ).utf8();
        //                                                             std::string_view view { welcomeMessage.data(), welcomeMessage.length() };
        //                                                           if (! ws->send(
        //                                                             view,
        //                                                             uWS::OpCode::TEXT,
        //                                                             false,
        //                                                             false
        //                                                            )) {
        //                                                             connection->m_messages.append(WTFMove(welcomeMessage));
        //                                                            }
        // }

            inspector->dispatchToBackend(message);
        } },
                                               .drain = [](auto* ws) {

        /* Check ws->getBufferedAmount() here */
        BunInspectorConnection** connectionPtr = ws->getUserData();
        BunInspectorConnection* connection = *connectionPtr;

        if (!connection) {
            return;
        }

      

        while (connection->m_messages.size() > 0) {
            auto& message = connection->m_messages.first();
            std::string_view view { message.data(), message.length() };
            if (!ws->send(view, uWS::OpCode::TEXT, false, false)) {
                return;
            }
            connection->m_messages.removeFirst();
        }

        connection->inspector->drainOutgoingMessages(); },
                                               .ping = [](auto* /*ws*/, std::string_view) {
    /* Not implemented yet */ },
                                               .pong = [](auto* /*ws*/, std::string_view) {
    /* Not implemented yet */ },
                                               .close = [](auto* ws, int /*code*/, std::string_view /*message*/) {
        BunInspectorConnection** connectionPtr = ws->getUserData();
        BunInspectorConnection* connection = *connectionPtr;
        if (!connection) {
            return;
        }
        if (connection->inspector.get()) {
            connection->inspector->disconnect();
            connection->inspector = nullptr;
        }

        connection->m_messages.clear();
        delete connection; } })
        .any("/*", [](auto* res, auto* req) {
            res->writeStatus("404 Not Found");
            res->writeHeader("Content-Type", "text/plain");
            res->write(req->getUrl());
            res->end(" was not found");
        })
        .listen(std::string(host.data(), host.length()), port, [inspector, callback = WTFMove(callback)](auto* listen_socket) {
            if (listen_socket) {
                callback(inspector, true);
            } else {
                callback(inspector, false);
            }
        });
    ;

    return inspector;
}

void BunInspector::dispatchToBackend(std::string_view message)
{
    WTF::CString data { message.data(), message.length() };
    WTF::String msg = WTF::String::fromUTF8(data.data(), data.length());
    auto jsonObject = WTF::JSONImpl::Value::parseJSON(msg);
    // if (auto object = jsonObject->asObject()) {
    //     auto method = object->getString("method"_s);

    //     if (method == "Profiler.enable"_s || method == "Runtime.runIfWaitingForDebugger"_s || method == "Debugger.setAsyncCallStackDepth"_s || method == "Debugger.setBlackboxPatterns"_s) {

    //         if (auto id = object.get()->getInteger("id"_s)) {
    //             auto response = makeString(
    //                 "{\"id\":"_s,
    //                 id.value(),
    //                 "\"result\":{}}"_s);

    //             sendMessageToFrontend(response);
    //             return;
    //         }
    //     } else if (method == "Runtime.getHeapUsage"_s) {

    //         if (auto id = object.get()->getInteger("id"_s)) {
    //             auto& heap = globalObject()->vm().heap;
    //             int usedSize = heap.size();
    //             int totalSize = heap.capacity();

    //             auto response = makeString(
    //                 "{\"id\":"_s,
    //                 id.value(),
    //                 "\"result\":{ "_s,
    //                 "\"usedSize\": "_s, usedSize, "\"totalSize\":"_s, totalSize, "}}"_s);

    //             sendMessageToFrontend(response);
    //             return;
    //         }
    //     } else if (method == "Runtime.getIsolateId"_s) {

    //         if (auto id = object.get()->getInteger("id"_s)) {
    //             auto& heap = globalObject()->vm().heap;
    //             int usedSize = heap.size();
    //             int totalSize = heap.capacity();

    //             auto response = makeString(
    //                 "{\"id\":"_s,
    //                 id.value(),
    //                 "\"result\": \"123\"}"_s);

    //             sendMessageToFrontend(response);
    //             return;
    //         }
    //     }
    // }
    globalObject()->inspectorController().backendDispatcher().dispatch(msg);
}

void BunInspector::sendMessageToTargetBackend(const WTF::String& message)
{
    globalObject()->inspectorController().dispatchMessageFromFrontend(message);
}

void BunInspector::connect(Inspector::FrontendChannel::ConnectionType connectionType)
{
    globalObject()->inspectorController().connectFrontend(*this, false, false);
}

void BunInspector::disconnect()
{
    globalObject()->inspectorController().disconnectFrontend(*this);
}

} // namespace Zig