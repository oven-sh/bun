
extern "C" {
#include "quic.h"
}

#include "Http3ContextData.h"
#include "Http3ResponseData.h"

namespace uWS {
    struct Http3Context {
        static Http3Context *create(us_loop_t *loop, us_quic_socket_context_options_t options) {

            /* Create quic socket context (assumes h3 for now) */
            auto *context = us_create_quic_socket_context(loop, options, sizeof(Http3ContextData));

            /* Specify application callbacks */
            us_quic_socket_context_on_stream_data(context, [](us_quic_stream_t *s, char *data, int length) {

                Http3ResponseData *responseData = (Http3ResponseData *) us_quic_stream_ext(s);

                /* We never emit FIN here */
                if (responseData->onData) {
                    responseData->onData({data, (size_t) length}, false);
                }
            });
            us_quic_socket_context_on_stream_end(context, [](us_quic_stream_t *s) {

                Http3ResponseData *responseData = (Http3ResponseData *) us_quic_stream_ext(s);

                /* Emit FIN to app */
                if (responseData->onData) {
                    responseData->onData({nullptr, 0}, true);
                }

                /* Have we written our entire backpressure, if any? */
                // if (responseData->buffer.length() && (responseData->bufferOffset == (int) responseData->buffer.length())) {
                //     printf("We got FIN and we have no backpressure, closing stream now!\n");
                //     //us_quic_stream_close(s);
                // } else {
                //     //printf("We got FIN but we have data to write, so keeping connection half-closed!\n");
                // }

            });
            us_quic_socket_context_on_stream_open(context, [](us_quic_stream_t *s, int is_client) {

                printf("Stream open!\n");

                /* Inplace init our per stream data */
                new (us_quic_stream_ext(s)) Http3ResponseData();
            });
            us_quic_socket_context_on_close(context, [](us_quic_socket_t *s) {
                printf("QUIC socket disconnected!\n");
            });
            us_quic_socket_context_on_stream_writable(context, [](us_quic_stream_t *s) {
                Http3ResponseData *responseData = (Http3ResponseData *) us_quic_stream_ext(s);

                /* Either we handle the streaming or we let the application handle it */
                if (responseData->onWritable) {
                    responseData->onWritable(responseData->offset);
                } else {
                    int written = us_quic_stream_write(s, (char *) responseData->backpressure.data(), responseData->backpressure.length());
                    responseData->backpressure.erase(written);

                    if (responseData->backpressure.length() == 0) {
                        printf("wrote until end, shutting down now!\n");
                        us_quic_stream_shutdown(s);
                        us_quic_stream_close(s);
                    }
                }
            });
            us_quic_socket_context_on_stream_headers(context, [](us_quic_stream_t *s) {

                /* This is the main place of start for requests */
                Http3ContextData *contextData = (Http3ContextData *) us_quic_socket_context_ext(us_quic_socket_context(us_quic_stream_socket(s)));

                Http3Request *req = nullptr;

                std::string_view upperCasedMethod = req->getHeader(":method");
                std::string_view path = req->getHeader(":path");

                contextData->router.getUserData() = {(Http3Response *) s, (Http3Request *) nullptr};
                contextData->router.route(upperCasedMethod, path);

            });
            us_quic_socket_context_on_open(context, [](us_quic_socket_t *s, int is_client) {
                printf("QUIC socket connected!\n");
            });
            us_quic_socket_context_on_stream_close(context, [](us_quic_stream_t *s) {

                printf("Stream closed!\n");

                //lsquic_stream_has_unacked_data

                Http3ResponseData *responseData = (Http3ResponseData *) us_quic_stream_ext(s);

                if (responseData->onAborted) {
                    responseData->onAborted();
                }

                //printf("Freeing per stream data in on_stream_close in uws!\n");

                responseData->~Http3ResponseData();
            });

            return (Http3Context *) context;

            // call init here after setting the ext to Http3ContextData
        }

        us_quic_listen_socket_t *listen(const char *host, int port) {
            /* The listening socket is the actual UDP socket used */
            us_quic_listen_socket_t *listen_socket = us_quic_socket_context_listen((us_quic_socket_context_t *) this, host, port, sizeof(Http3ResponseData));

            //printf("Listen socket is: %p\n", listen_socket);

            return listen_socket;
        }

        void init() {
            // set all callbacks here



            Http3ContextData *contextData = (Http3ContextData *) us_quic_socket_context_ext((us_quic_socket_context_t *) this);

            //printf("init: %p\n", contextData);

            new (contextData) Http3ContextData();

        }

        // generic for get, post, any, etc
        void onHttp(std::string_view method, std::string_view path, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&cb) {
            // modifies the router we own as part of Http3ContextData, used in callbacks set in init

            Http3ContextData *contextData = (Http3ContextData *) us_quic_socket_context_ext((us_quic_socket_context_t *) this);

            /* Todo: This is ugly, fix */
            std::vector<std::string> methods;
            if (method == "*") {
                methods = contextData->router.upperCasedMethods; //bug! needs to be upper cased!
                // router.upperCasedMethods;
            } else {
                methods = {std::string(method)};
            }

            contextData->router.add(methods, path, [handler = std::move(cb)](HttpRouter<Http3ContextData::RouterData> *router) mutable {

                Http3ContextData::RouterData &routerData = router->getUserData();

                handler(routerData.res, routerData.req);

                return true;
            });
        }
    };
}