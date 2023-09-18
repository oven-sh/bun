/* We need to include the APIs to fuzz within */
#include "epoll_fuzzer.h"

/* Our test fuzz uSockets so we need its APIs */
#include "bun-sockets/src/libusockets.h"

int num_open_sockets = 0;

void wakeup_cb(struct us_loop_t *loop) {

}

void pre_cb(struct us_loop_t *loop) {

}

void post_cb(struct us_loop_t *loop) {

}

struct us_socket_t *on_open(struct us_socket_t *s, int is_client, char *ip, int ip_length) {
	num_open_sockets++;
	return s;
}

struct us_socket_t *on_close(struct us_socket_t *s, int code, void *reason) {
	num_open_sockets--;
	return s;
}

struct us_socket_t *on_data(struct us_socket_t *s, char *data, int length) {
	//exit(33);
	return s;
}

struct us_socket_t *on_end(struct us_socket_t *s) {

	return s;
}

struct us_listen_socket_t *listen_socket;

#include "App.h"

/* We define a test that deterministically sets up and tears down an uSockets event-loop */
void test() {
	//printf("Entering test\n");

	/*struct us_loop_t *loop = us_create_loop(0, wakeup_cb, pre_cb, post_cb, 0);

	struct us_socket_context_options_t context_options = {};
	struct us_socket_context_t *context = us_create_socket_context(0, loop, 0, context_options);

	us_socket_context_on_open(0, context, on_open);
	us_socket_context_on_close(0, context, on_close);
	us_socket_context_on_data(0, context, on_data);
	us_socket_context_on_end(0, context, on_end);

	listen_socket = us_socket_context_listen(0, context, 0, 3001, 0, 0);
	if (listen_socket) {
		printf("We are listening!\n");
	} else {
		printf("Failed to listen!\n");
	}

	us_loop_run(loop);

	us_socket_context_free(0, context);
	us_loop_free(loop);*/

	// skapa event-loopen explicit?
	//struct us_loop_t *loop = us_create_loop(0, wakeup_cb, pre_cb, post_cb, 0);


	// testing hello world http
	/*struct us_socket_context_options_t context_options = {};
	uWS::App(context_options).get("/*", [](auto *res, auto *req) {
	    res->end("Hello world!");
	}).listen(3000, [](auto *listenSocket) {
		listen_socket = listenSocket;
	}).run();*/

	/* ws->getUserData returns one of these */
    struct PerSocketData {
        /* Fill with user data */
    };

    /* Keep in mind that uWS::SSLApp({options}) is the same as uWS::App() when compiled without SSL support.
     * You may swap to using uWS:App() if you don't need SSL */
    uWS::App({
        /* There are example certificates in uWebSockets.js repo */
	    .key_file_name = "../misc/key.pem",
	    .cert_file_name = "../misc/cert.pem",
	    .passphrase = "1234"
	}).ws<PerSocketData>("/*", {
        /* Settings */
        .compression = uWS::SHARED_COMPRESSOR,
        .maxPayloadLength = 16 * 1024,
        .idleTimeout = 10,
        .maxBackpressure = 1 * 1024 * 1024,
        /* Handlers */
        .open = [](auto *ws) {
            /* Open event here, you may access ws->getUserData() which points to a PerSocketData struct */
        },
        .message = [](auto *ws, std::string_view message, uWS::OpCode opCode) {
            ws->send(message, opCode, true);
        },
        .drain = [](auto *ws) {
            /* Check ws->getBufferedAmount() here */
        },
        .ping = [](auto *ws) {
            /* Not implemented yet */
        },
        .pong = [](auto *ws) {
            /* Not implemented yet */
        },
        .close = [](auto *ws, int code, std::string_view message) {
            /* You may access ws->getUserData() here */
        }
    }).listen(9001, [](auto *listenSocket) {
		listen_socket = listenSocket;
    }).run();

	uWS::Loop::get()->free();



	//printf("Leaving test\n");
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

	us_listen_socket_close(0, listen_socket);
	listen_socket = NULL;
}