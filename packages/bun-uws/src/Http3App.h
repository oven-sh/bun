#include "App.h"

#include "Http3Response.h"
#include "Http3Request.h"
#include "Http3Context.h"

namespace uWS {

    struct H3App {
        Http3Context *http3Context;

        H3App(SocketContextOptions options = {}) {
            /* This conversion should not be needed */
            us_quic_socket_context_options_t h3options = {};

            h3options.key_file_name = strdup(options.key_file_name);
            h3options.cert_file_name = strdup(options.cert_file_name);
            h3options.passphrase = strdup(options.passphrase);

            /* Create the http3 context */
            http3Context = Http3Context::create((us_loop_t *)Loop::get(), h3options);

            http3Context->init();
        }

        /* Disallow copying, only move */
        H3App(const H3App &other) = delete;

        H3App(H3App &&other) {
            /* Move HttpContext */
            http3Context = other.http3Context;
            other.http3Context = nullptr;
        }

        /* Host, port, callback */
        H3App &&listen(const std::string &host, int port, MoveOnlyFunction<void(us_listen_socket_t *)> &&handler) {
            if (host.empty()) {
                return listen(port, std::move(handler));
            }
            handler(http3Context ? (us_listen_socket_t *) http3Context->listen(host.c_str(), port) : nullptr);
            return std::move(*this);
        }

        /* Host, port, options, callback */
        H3App &&listen(const std::string &host, int port, int options, MoveOnlyFunction<void(us_listen_socket_t *)> &&handler) {
            if (host.empty()) {
                return listen(port, options, std::move(handler));
            }
            handler(http3Context ? (us_listen_socket_t *) http3Context->listen(host.c_str(), port) : nullptr);
            return std::move(*this);
        }

        /* Port, callback */
        H3App &&listen(int port, MoveOnlyFunction<void(us_listen_socket_t *)> &&handler) {
            handler(http3Context ? (us_listen_socket_t *) http3Context->listen(nullptr, port) : nullptr);
            return std::move(*this);
        }

        /* Port, options, callback */
        H3App &&listen(int port, int options, MoveOnlyFunction<void(us_listen_socket_t *)> &&handler) {
            handler(http3Context ? (us_listen_socket_t *) http3Context->listen(nullptr, port) : nullptr);
            return std::move(*this);
        }

        H3App &&get(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {
            if (http3Context) {
                http3Context->onHttp("GET", pattern, std::move(handler));
            }
            return std::move(*this);
        }

        H3App &&post(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {
            if (http3Context) {
                http3Context->onHttp("POST", pattern, std::move(handler));
            }
            return std::move(*this);
        }

        H3App &&options(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {
            if (http3Context) {
                http3Context->onHttp("OPTIONS", pattern, std::move(handler));
            }
            return std::move(*this);
        }

        H3App &&del(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {
            if (http3Context) {
                http3Context->onHttp("DELETE", pattern, std::move(handler));
            }
            return std::move(*this);
        }

        H3App &&patch(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {
            if (http3Context) {
                http3Context->onHttp("PATCH", pattern, std::move(handler));
            }
            return std::move(*this);
        }

        H3App &&put(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {
            if (http3Context) {
                http3Context->onHttp("PUT", pattern, std::move(handler));
            }
            return std::move(*this);
        }

        H3App &&head(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {
            if (http3Context) {
                http3Context->onHttp("HEAD", pattern, std::move(handler));
            }
            return std::move(*this);
        }

        H3App &&connect(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {
            if (http3Context) {
                http3Context->onHttp("CONNECT", pattern, std::move(handler));
            }
            return std::move(*this);
        }

        H3App &&trace(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {
            if (http3Context) {
                http3Context->onHttp("TRACE", pattern, std::move(handler));
            }
            return std::move(*this);
        }

        /* This one catches any method */
        H3App &&any(std::string_view pattern, MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {
            if (http3Context) {
                http3Context->onHttp("*", pattern, std::move(handler));
            }
            return std::move(*this);
        }

        void run() {
            uWS::Loop::get()->run();
        }
    };
}