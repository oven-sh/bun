/* We rely on wrapped syscalls */
#include "libEpollFuzzer/epoll_fuzzer.h"

#include "App.h"
#include <vector>

/* We keep this one for teardown later on */
struct us_listen_socket_t *listen_socket;

/* This test is run by libEpollFuzzer */
void test() {

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
	    .key_file_name = "../misc/key.pem",
	    .cert_file_name = "../misc/cert.pem",
	    .passphrase = "1234"
	});
    
    app->ws<PerSocketData>("/*", {
        /* Settings */
        .compression = uWS::DISABLED,
        .maxPayloadLength = 512, // also have a low value here for fuzzing
        .idleTimeout = 60,
        .maxBackpressure = 128, // we want a low number so that we can reach this in fuzzing
        .closeOnBackpressureLimit = false, // this one could be tested as well
        .resetIdleTimeoutOnSend = true, // and this
        .sendPingsAutomatically = false, // and this
        /* Handlers */
        .upgrade = nullptr,
        .open = [](auto *ws) {
            /* Open event here, you may access ws->getUserData() which points to a PerSocketData struct */

            PerSocketData *perSocketData = (PerSocketData *) ws->getUserData();

            for (int i = 0; i < 100; i++) {
                std::string topic = std::to_string((uintptr_t)ws) + "-" + std::to_string(i);
                perSocketData->topics.push_back(topic);
                ws->subscribe(topic);
            }
        },
        .message = [&app](auto *ws, std::string_view message, uWS::OpCode opCode) {
            PerSocketData *perSocketData = (PerSocketData *) ws->getUserData();

            app->publish(perSocketData->topics[++perSocketData->nr % 100], message, opCode);
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
            //std::cout << "Listening on port " << 9001 << std::endl;
            listen_socket = listen_s;
        }
    });
    
    app->run();

    delete app;

    uWS::Loop::get()->free();
}

/* Thus function should shutdown the event-loop and let the test fall through */
void teardown() {
	/* If we are called twice there's a bug (it potentially could if
	 * all open sockets cannot be error-closed in one epoll_wait call).
	 * But we only allow 1k FDs and we have a buffer of 1024 from epoll_wait */
	if (!listen_socket) {
		exit(-1);
	}

	/* We might have open sockets still, and these will be error-closed by epoll_wait */
	// us_socket_context_close - close all open sockets created with this socket context
    if (listen_socket) {
        us_listen_socket_close(0, listen_socket);
        listen_socket = NULL;
    }
}
