#include "App.h"

struct us_listen_socket_t *global_listen_socket;

int main() {

    /* ws->getUserData returns one of these */
    struct PerSocketData {
        /* Fill with user data */
        std::vector<std::string> topics;
        int nr = 0;
    };

    /* Keep in mind that uWS::SSLApp({options}) is the same as uWS::App() when compiled without SSL support.
     * You may swap to using uWS:App() if you don't need SSL */
    uWS::SSLApp *app = new uWS::SSLApp({
        /* There are example certificates in uWebSockets.js repo */
	    .key_file_name = "misc/key.pem",
	    .cert_file_name = "misc/cert.pem",
	    .passphrase = "1234"
	});
    
    app->ws<PerSocketData>("/*", {
        /* Settings */
        .compression = uWS::DISABLED,
        .maxPayloadLength = 16 * 1024 * 1024,
        .idleTimeout = 60,
        .maxBackpressure = 16 * 1024 * 1024,
        .closeOnBackpressureLimit = false,
        .resetIdleTimeoutOnSend = true,
        .sendPingsAutomatically = false,
        /* Handlers */
        .upgrade = nullptr,
        .open = [](auto *ws) {
            /* Open event here, you may access ws->getUserData() which points to a PerSocketData struct */

            PerSocketData *perSocketData = (PerSocketData *) ws->getUserData();

            for (int i = 0; i < 32; i++) {
                std::string topic = std::to_string((uintptr_t)ws) + "-" + std::to_string(i);
                perSocketData->topics.push_back(topic);
                ws->subscribe(topic);
            }
        },
        .message = [&app](auto *ws, std::string_view message, uWS::OpCode opCode) {
            PerSocketData *perSocketData = (PerSocketData *) ws->getUserData();

            app->publish(perSocketData->topics[(size_t)(++perSocketData->nr % 32)], message, opCode);
            ws->publish(perSocketData->topics[(size_t)(++perSocketData->nr % 32)], message, opCode);
        },
        .drain = [](auto */*ws*/) {
            /* Check ws->getBufferedAmount() here */
            //std::cout << "drain" << std::endl;
        },
        .ping = [](auto */*ws*/, std::string_view ) {
            /* Not implemented yet */
        },
        .pong = [](auto */*ws*/, std::string_view ) {
            /* Not implemented yet */
        },
        .close = [](auto */*ws*/, int /*code*/, std::string_view /*message*/) {
            /* You may access ws->getUserData() here */
        }
    }).listen(9001, [](auto *listen_s) {
        if (listen_s) {
            std::cout << "Listening on port " << 9001 << std::endl;
            //listen_socket = listen_s;
        }
    });
    
    app->run();

    delete app;

    uWS::Loop::get()->free();
}
