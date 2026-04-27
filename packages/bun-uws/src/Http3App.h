#ifndef UWS_H3APP_H
#define UWS_H3APP_H

#include "App.h"
#include "Http3Context.h"

namespace uWS {

/* TemplatedApp-shaped front for HTTP/3. Route registration and listen()
 * mirror SSLApp so the C ABI in libuwsockets_h3.cpp can stay 1:1 with the
 * existing uws_app_* surface. */
struct H3App {
    Http3Context *http3Context;

    static H3App *create(SocketContextOptions options) {
        us_bun_socket_context_options_t raw;
        memcpy(&raw, &options, sizeof(raw));
        Http3Context *ctx = Http3Context::create(Loop::get(), raw);
        if (!ctx) return nullptr;
        return new H3App{ctx};
    }

    bool constructorFailed() { return http3Context == nullptr; }

    ~H3App() {
        if (http3Context) http3Context->free();
    }

#define H3_METHOD(name, verb)                                                            \
    H3App &&name(std::string_view pattern,                                               \
                 MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {    \
        http3Context->onHttp(verb, pattern, std::move(handler));                         \
        return std::move(*this);                                                         \
    }
    H3_METHOD(get, "get")
    H3_METHOD(post, "post")
    H3_METHOD(put, "put")
    H3_METHOD(del, "delete")
    H3_METHOD(patch, "patch")
    H3_METHOD(head, "head")
    H3_METHOD(options, "options")
    H3_METHOD(connect, "connect")
    H3_METHOD(trace, "trace")
    H3_METHOD(any, "*")
#undef H3_METHOD

    H3App &&listen(const std::string &host, int port, int /*options*/,
                   MoveOnlyFunction<void(us_quic_listen_socket_t *)> &&cb) {
        cb(http3Context->listen(host.empty() ? nullptr : host.c_str(), port));
        return std::move(*this);
    }
    H3App &&listen(const std::string &host, int port,
                   MoveOnlyFunction<void(us_quic_listen_socket_t *)> &&cb) {
        return listen(host, port, 0, std::move(cb));
    }
    H3App &&listen(int port, MoveOnlyFunction<void(us_quic_listen_socket_t *)> &&cb) {
        return listen({}, port, 0, std::move(cb));
    }

    void clearRoutes() {
        http3Context->getContextData()->router = decltype(http3Context->getContextData()->router){};
    }
    void close() { /* engine teardown happens in destructor */ }
    void *getNativeHandle() { return http3Context; }
};

}

#endif
