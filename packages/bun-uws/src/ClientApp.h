#include "MoveOnlyFunction.h"
#include "WebSocketContext.h"
#include <string>

namespace uWS {

    struct WebSocketClientBehavior {
        MoveOnlyFunction<void()> open;
        MoveOnlyFunction<void()> message;
        MoveOnlyFunction<void()> close;
        //MoveOnlyFunction<void()> failed;

    };

    struct ClientApp {

        WebSocketContext<0, false, int> *webSocketContext;
        // behöver ett nytt http context med minimal klient, som slår om till den riktiga websocketcontext
        // om samma storlek på httpsocket och websocket blir det enkel övergång

        ClientApp(WebSocketClientBehavior &&behavior) {
            //webSocketContext = WebSocketContext<0, false, int>::create();
        }

        ClientApp &&connect(std::string_view url, std::string_view protocol = "") {

            return std::move(*this);
        }

        void run() {

        }

    };

}