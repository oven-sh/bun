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

    static H3App *create(SocketContextOptions options, unsigned idleTimeoutSecs = 0,
                         bool webtransport = false) {
        us_bun_socket_context_options_t raw;
        memcpy(&raw, &options, sizeof(raw));
        Http3Context *ctx = Http3Context::create(Loop::get(), raw, idleTimeoutSecs, webtransport);
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

    H3App &&listen(const std::string &host, int port, int options,
                   MoveOnlyFunction<void(us_quic_listen_socket_t *)> &&cb) {
        cb(http3Context->listen(host.empty() ? nullptr : host.c_str(), port, options));
        return std::move(*this);
    }

    /* The WebTransport session route. High priority so the per-method
     * wildcard fallback cannot cull it; see Http3Context::onHttp. */
    H3App &&webtransportConnect(std::string_view pattern,
                                MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {
        http3Context->onHttp("connect", pattern, std::move(handler), true);
        return std::move(*this);
    }

    /* Session-lifetime callbacks. Opening one is the CONNECT route's job, so
     * there is no `open` here. */
    void onWebTransport(
        void (*onDatagram)(Http3WebTransportSession *, const char *, unsigned),
        void (*onClose)(Http3WebTransportSession *, uint32_t, const char *, size_t),
        void (*onDrain)(Http3WebTransportSession *))
    {
        http3Context->getContextData()->onWebTransportDatagram = onDatagram;
        http3Context->getContextData()->onWebTransportClose = onClose;
        http3Context->getContextData()->onWebTransportDrain = onDrain;
    }

    void clearRoutes() {
        http3Context->getContextData()->router = decltype(http3Context->getContextData()->router){};
    }
    /* GOAWAY + drain. The engine itself is torn down in the destructor. */
    void close() { http3Context->shutdown(); }
    bool addServerNameWithOptions(const char *hostname, SocketContextOptions options) {
        us_bun_socket_context_options_t raw;
        memcpy(&raw, &options, sizeof(raw));
        return http3Context->addServerName(hostname, raw);
    }
    void *getNativeHandle() { return http3Context; }
};

}

#endif
