/* We rely on wrapped syscalls */
#include "libEpollFuzzer/epoll_fuzzer.h"

#include "App.h"

/* We keep this one for teardown later on */
struct us_listen_socket_t *listen_socket;
struct us_socket_t *client;

/* This test is run by libEpollFuzzer */
void test() {
	/* ws->getUserData returns one of these */
    struct PerSocketData {
        /* Fill with user data */
    };

    {
        /* Keep in mind that uWS::SSLApp({options}) is the same as uWS::App() when compiled without SSL support.
        * You may swap to using uWS:App() if you don't need SSL */
        auto app = uWS::App({
            /* There are example certificates in uWebSockets.js repo */
            .key_file_name = "../misc/key.pem",
            .cert_file_name = "../misc/cert.pem",
            .passphrase = "1234"
        }).ws<PerSocketData>("/empty", {
        /* Having no handlers here should not crash */
        }).get("/*", [](auto *res, auto *req) {
            if (req->getHeader("write").length()) {
                res->writeStatus("200 OK")->writeHeader("write", "true")->write("Hello");
                res->write(" world!");
                res->end();
            } else if (req->getQuery().length()) {
                res->close();
            } else {
                res->end("Hello world!");
            }
        }).post("/*", [](auto *res, auto *req) {
            res->onAborted([]() {
                /* We might as well use this opportunity to stress the loop a bit */
                uWS::Loop::get()->defer([]() {

                });
            });
            res->onData([res](std::string_view chunk, bool isEnd) {
                if (isEnd) {
                    res->cork([res, chunk]() {
                        res->write("something ahead");
                        res->end(chunk);
                    });
                }
            });
        }).any("/:candy/*", [](auto *res, auto *req) {
            if (req->getParameter(0).length() == 0) {
                free((void *) -1);
            }
            /* Some invalid queries */
            req->getParameter(30000);
            req->getParameter((unsigned short) -34234);
            req->getHeader("yhello");
            req->getQuery();
            req->getQuery("assd");

            res->end("done");
        }).ws<PerSocketData>("/*", {
            /* Settings */
            .compression = uWS::SHARED_COMPRESSOR,
            .maxPayloadLength = 16 * 1024,
            .idleTimeout = 12,
            .maxBackpressure = 1024,
            /* Handlers */
            .open = [](auto *ws) {
                /* Open event here, you may access ws->getUserData() which points to a PerSocketData struct */
                ws->getNativeHandle();
                ws->getRemoteAddressAsText();
                us_poll_ext((struct us_poll_t *) ws);
            },
            .message = [](auto *ws, std::string_view message, uWS::OpCode opCode) {
                ws->send(message, opCode, true);
            },
            .drain = [](auto *ws) {
                /* Check ws->getBufferedAmount() here */
            },
            .ping = [](auto *ws, std::string_view) {
                /* We use this to trigger the async/wakeup feature */
                uWS::Loop::get()->defer([]() {
                    /* Do nothing */
                });
            },
            .pong = [](auto *ws, std::string_view) {
                /* Not implemented yet */
            },
            .close = [](auto *ws, int code, std::string_view message) {
                /* You may access ws->getUserData() here */
            }
        }).listen(9001, [](auto *listenSocket) {
            listen_socket = listenSocket;
        });

        /* Here we want to stress the connect feature, since nothing else stresses it */
        struct us_loop_t *loop = (struct us_loop_t *) uWS::Loop::get();
        /* This function is stupid */
        us_loop_iteration_number(loop);
        struct us_socket_context_t *client_context = us_create_socket_context(0, loop, 0, {});
        us_socket_context_timestamp(0, client_context);
        client = us_socket_context_connect(0, client_context, "hostname", 5000, "localhost", 0, 0);
	    
        if (client) {
            us_socket_is_established(0, client);
            us_socket_local_port(0, client);
        }

        us_socket_context_on_connect_error(0, client_context, [](struct us_socket_t *s, int code) {
            client = nullptr;
            return s;
        });

        us_socket_context_on_open(0, client_context, [](struct us_socket_t *s, int is_client, char *ip, int ip_length) {
            us_socket_flush(0, s);
            return s;
        });

        us_socket_context_on_end(0, client_context, [](struct us_socket_t *s) {
            /* Someone sent is a FIN, but we can still send data */
            us_socket_write(0, s, "asdadasdasdasdaddfgdfhdfgdfg", 28, false);
            return s;
        });

        us_socket_context_on_data(0, client_context, [](struct us_socket_t *s, char *data, int length) {
            return s;
        });

        us_socket_context_on_writable(0, client_context, [](struct us_socket_t *s) {
            /* Let's defer a close here */
            us_socket_shutdown_read(0, s);
            return s;
        });

        us_socket_context_on_close(0, client_context, [](struct us_socket_t *s, int code, void *reason) {
            client = NULL;
            return s;
        });

        /* Trigger some context functions */
        app.addServerName("servername", {});
        app.removeServerName("servername");
        app.missingServerName(nullptr);
        app.getNativeHandle();

        app.run();

        /* After done we also free the client context */
        us_socket_context_free(0, client_context);
    }
    uWS::Loop::get()->setSilent(true);
    uWS::Loop::get()->free();
}

/* Thus function should shutdown the event-loop and let the test fall through */
void teardown() {
	/* If we are called twice there's a bug (it potentially could if
	 * all open sockets cannot be error-closed in one epoll_wait call).
	 * But we only allow 1k FDs and we have a buffer of 1024 from epoll_wait */
	if (!listen_socket && !client) {
		exit(-1);
	}

    if (client) {
        us_socket_close(0, client, 0, 0);
        client = NULL;
    }

	/* We might have open sockets still, and these will be error-closed by epoll_wait */
	// us_socket_context_close - close all open sockets created with this socket context
    if (listen_socket) {
        us_listen_socket_close(0, listen_socket);
        listen_socket = NULL;
    }
}
