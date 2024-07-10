#include "root.h"
#include <bun-uws/src/App.h>

#include <JavaScriptCore/InspectorFrontendChannel.h>
#include <JavaScriptCore/JSGlobalObjectDebuggable.h>
#include <JavaScriptCore/JSGlobalObjectDebugger.h>
#include <JavaScriptCore/Debugger.h>

extern "C" void Bun__tickWhilePaused(bool*);

namespace Bun {
using namespace JSC;
template<bool isSSL>
class BunInspectorConnection : public Inspector::FrontendChannel {
public:
    using BunInspectorSocket = uWS::WebSocket<isSSL, true, BunInspectorConnection*>;

    BunInspectorConnection(BunInspectorSocket* ws, JSC::JSGlobalObject* globalObject)
        : ws(ws)
        , globalObject(globalObject)
        , pendingMessages()
    {
    }

    ~BunInspectorConnection()
    {
    }

    Inspector::FrontendChannel::ConnectionType connectionType() const override
    {
        return Inspector::FrontendChannel::ConnectionType::Remote;
    }

    void onOpen(JSC::JSGlobalObject* globalObject)
    {
        this->globalObject = globalObject;
        this->globalObject->inspectorDebuggable().connect(*this);

        Inspector::JSGlobalObjectDebugger* debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(this->globalObject->debugger());
        if (debugger) {
            debugger->runWhilePausedCallback = [](JSC::JSGlobalObject& globalObject, bool& isPaused) -> void {
                Bun__tickWhilePaused(&isPaused);
            };
        }
    }

    void onClose()
    {
        this->globalObject->inspectorDebuggable().disconnect(*this);
        this->pendingMessages.clear();
    }

    void sendMessageToFrontend(const String& message) override
    {
        send(message);
    }

    void send(const WTF::String& message)
    {
        if (ws->getBufferedAmount() == 0) {
            WTF::CString messageCString = message.utf8();
            ws->send(std::string_view { messageCString.data(), messageCString.length() }, uWS::OpCode::TEXT);
        } else {
            pendingMessages.append(message);
        }
    }

    void onMessage(std::string_view message)
    {
        WTF::String messageString = WTF::String::fromUTF8(std::span { message.data(), message.length() });
        Inspector::JSGlobalObjectDebugger* debugger = reinterpret_cast<Inspector::JSGlobalObjectDebugger*>(this->globalObject->debugger());
        if (debugger) {
            debugger->runWhilePausedCallback = [](JSC::JSGlobalObject& globalObject, bool& done) -> void {
                Bun__tickWhilePaused(&done);
            };
        }
        this->globalObject->inspectorDebuggable().dispatchMessageFromRemote(WTFMove(messageString));
    }

    void drain()
    {
        if (pendingMessages.size() == 0)
            return;

        if (ws->getBufferedAmount() == 0) {
            ws->cork([&]() {
                for (auto& message : pendingMessages) {
                    WTF::CString messageCString = message.utf8();
                    ws->send(std::string_view { messageCString.data(), messageCString.length() }, uWS::OpCode::TEXT);
                }
                pendingMessages.clear();
            });
        }
    }

    WTF::Vector<WTF::String> pendingMessages;
    JSC::JSGlobalObject* globalObject;
    BunInspectorSocket* ws;
};

using BunInspectorConnectionNoSSL = BunInspectorConnection<false>;
using SSLBunInspectorConnection = BunInspectorConnection<true>;

template<bool isSSL>
static void addInspector(void* app, JSC::JSGlobalObject* globalObject)
{
    if constexpr (isSSL) {
        auto handler = uWS::SSLApp::WebSocketBehavior<SSLBunInspectorConnection*> {
            /* Settings */
            .compression = uWS::DISABLED,
            .maxPayloadLength = 16 * 1024 * 1024,
            .idleTimeout = 960,
            .maxBackpressure = 16 * 1024 * 1024,
            .closeOnBackpressureLimit = false,
            .resetIdleTimeoutOnSend = true,
            .sendPingsAutomatically = true,
            /* Handlers */
            .upgrade = nullptr,
            .open = [globalObject](auto* ws) {
                globalObject->setInspectable(true);
                *ws->getUserData() = new SSLBunInspectorConnection(ws, globalObject);
                SSLBunInspectorConnection* inspector = *ws->getUserData();
                inspector->onOpen(globalObject);
                //
            },
            .message = [](auto* ws, std::string_view message, uWS::OpCode opCode) {
                SSLBunInspectorConnection* inspector = *(SSLBunInspectorConnection**)ws->getUserData();
                inspector->onMessage(message);
                //
            },
            .drain = [](auto* ws) {
                SSLBunInspectorConnection* inspector = *(SSLBunInspectorConnection**)ws->getUserData();
                inspector->drain();
                //
            },
            .ping = [](auto* /*ws*/, std::string_view) {
        /* Not implemented yet */ },
            .pong = [](auto* /*ws*/, std::string_view) {
        /* Not implemented yet */ },

            .close = [](auto* ws, int /*code*/, std::string_view /*message*/) {
            SSLBunInspectorConnection* inspector = *(SSLBunInspectorConnection**)ws->getUserData();
            inspector->onClose();
            delete inspector; }
        };

        ((uWS::SSLApp*)app)->ws<SSLBunInspectorConnection*>("/bun:inspect", std::move(handler));
    } else {

        auto handler = uWS::App::WebSocketBehavior<BunInspectorConnectionNoSSL*> {
            /* Settings */
            .compression = uWS::DISABLED,
            .maxPayloadLength = 16 * 1024 * 1024,
            .idleTimeout = 960,
            .maxBackpressure = 16 * 1024 * 1024,
            .closeOnBackpressureLimit = false,
            .resetIdleTimeoutOnSend = true,
            .sendPingsAutomatically = true,
            /* Handlers */
            .upgrade = nullptr,
            .open = [globalObject](auto* ws) {
                globalObject->setInspectable(true);
                *ws->getUserData() = new BunInspectorConnectionNoSSL(ws, globalObject);
                BunInspectorConnectionNoSSL* inspector = *ws->getUserData();
                inspector->onOpen(globalObject);
                //
            },
            .message = [](auto* ws, std::string_view message, uWS::OpCode opCode) {
                BunInspectorConnectionNoSSL* inspector = *(BunInspectorConnectionNoSSL**)ws->getUserData();
                inspector->onMessage(message);
                //
            },
            .drain = [](auto* ws) {
                BunInspectorConnectionNoSSL* inspector = *(BunInspectorConnectionNoSSL**)ws->getUserData();
                inspector->drain();
                //
            },
            .ping = [](auto* /*ws*/, std::string_view) {
        /* Not implemented yet */ },
            .pong = [](auto* /*ws*/, std::string_view) {
        /* Not implemented yet */ },

            .close = [](auto* ws, int /*code*/, std::string_view /*message*/) {
            BunInspectorConnectionNoSSL* inspector = *(BunInspectorConnectionNoSSL**)ws->getUserData();
            inspector->onClose();
            delete inspector; }
        };

        ((uWS::App*)app)->ws<BunInspectorConnectionNoSSL*>("/bun:inspect", std::move(handler));
    }
}

extern "C" void Bun__addInspector(bool isSSL, void* app, JSC::JSGlobalObject* globalObject)
{
    if (isSSL) {
        addInspector<true>((uWS::TemplatedApp<true>*)app, globalObject);
    } else {
        addInspector<false>((uWS::TemplatedApp<false>*)app, globalObject);
    }
};
}
