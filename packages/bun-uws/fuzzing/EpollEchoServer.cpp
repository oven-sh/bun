/* We rely on wrapped syscalls */
#include "libEpollFuzzer/epoll_fuzzer.h"

#include "App.h"

/* We keep this one for teardown later on */
struct us_listen_socket_t *listen_socket;

/* This test is run by libEpollFuzzer */
void test() {

    struct PerSocketData {
        int nothing;
        std::shared_ptr<bool> valid;
    };

    /* First byte determines what compressor to use */
    unsigned char compressorByte;
    if (consume_byte(&compressorByte)) {
        //uWS::Loop::get()->free();
        return;
    }

    uWS::CompressOptions compressors[] = {
        uWS::DISABLED,
        uWS::SHARED_COMPRESSOR,
        uWS::DEDICATED_COMPRESSOR_3KB,
        uWS::DEDICATED_COMPRESSOR_4KB,
        uWS::DEDICATED_COMPRESSOR_8KB,
        uWS::DEDICATED_COMPRESSOR_16KB,
        uWS::DEDICATED_COMPRESSOR_32KB,
        uWS::DEDICATED_COMPRESSOR_64KB,
        uWS::DEDICATED_COMPRESSOR_128KB,
        uWS::DEDICATED_COMPRESSOR_256KB
    };

    uWS::CompressOptions compressor = compressors[compressorByte % 10];

    {
        auto app = uWS::App().ws<PerSocketData>("/broadcast", {
            /* Settings */
            .compression = compressor,
            /* We want this to be low so that we can hit it, yet bigger than 256 */
            .maxPayloadLength = 300,
            .idleTimeout = 12,
            /* Handlers */
            .open = [](auto *ws) {
                /* Subscribe to anything */
                ws->subscribe(/*req->getHeader(*/"topic"/*)*/);
            },
            .message = [](auto *ws, std::string_view message, uWS::OpCode opCode) {
                if (message.length() && message[0] == 'C') {
                    ws->close();
                } else if (message.length() && message[0] == 'E') {
                    ws->end(1006);
                } else {
                    /* Publish to topic sent by message */
                    ws->publish(message, message, opCode, true);

                    if (message.length() && message[0] == 'U') {
                        ws->unsubscribe(message);
                    }
                }
            },
            .drain = [](auto *ws) {
                /* Check getBufferedAmount here */
            },
            .ping = [](auto *ws, std::string_view) {

            },
            .pong = [](auto *ws, std::string_view) {

            },
            .close = [](auto *ws, int code, std::string_view message) {
                /* Cause reported crash */
                ws->close();
            }
        }).ws<PerSocketData>("/*", {
            /* Settings */
            .compression = compressor,
            /* We want this to be low so that we can hit it, yet bigger than 256 */
            .maxPayloadLength = 300,
            .idleTimeout = 12,
            /* Handlers */
            .open = [](auto *ws) {

                ws->getUserData()->valid.reset(new bool{true});

                //if (req->getHeader("close_me").length()) {
                //    ws->close();
                //} else if (req->getHeader("end_me").length()) {
                //    ws->end(1006);
                //}
            },
            .message = [](auto *ws, std::string_view message, uWS::OpCode opCode) {
                if (message.length() > 300) {
                    /* Inform the sanitizer of the fault */
                    fprintf(stderr, "Too long message passed\n");
                    free((void *) -1);
                }

                if (message.length() && message[0] == 'C') {
                    ws->close();
                } else if (message.length() && message[0] == 'E') {
                    ws->end(1006);
                } else {
                    ws->send(message, opCode, true);
                }
            },
            .drain = [](auto *ws) {
                /* Check getBufferedAmount here */
            },
            .ping = [](auto *ws, std::string_view) {
                /* Here we test send and end while uncorked, by having them send from deferred */
                PerSocketData *psd = (PerSocketData *) ws->getUserData();

                uWS::Loop::get()->defer([ws, valid = psd->valid]() {
                    if (*valid.get()) {
                        /* We haven't been closed */
                        ws->send("Hello!", uWS::TEXT, false);
                        ws->end(1000);
                    }
                });
            },
            .pong = [](auto *ws, std::string_view) {

            },
            .close = [](auto *ws, int code, std::string_view message) {
                (*ws->getUserData()->valid.get()) = false;
            }
        }).listen(9001, [](us_listen_socket_t *listenSocket) {
            listen_socket = listenSocket;
        });

        app.run();
    }

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
