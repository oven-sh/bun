#ifndef UWS_H3APP_H
#define UWS_H3APP_H

#include "App.h"
#include "Http3Context.h"

namespace uWS {

/* TemplatedApp-shaped front for HTTP/3. listen() mirrors SSLApp so the C ABI
 * in libuwsockets_h3.cpp can stay 1:1 with the existing uws_app_* surface. */
struct H3App {
    Http3Context::Ptr http3Context;

    static H3App *create(SocketContextOptions options, unsigned idleTimeoutSecs, const void *routes) {
        us_bun_socket_context_options_t raw;
        memcpy(&raw, &options, sizeof(raw));
        auto ctx = Http3Context::create(Loop::get(), raw, idleTimeoutSecs, routes);
        if (!ctx) return nullptr;
        return new H3App{std::move(ctx)};
    }

    H3App &&listen(const std::string &host, int port, int options,
                   MoveOnlyFunction<void(us_quic_listen_socket_t *)> &&cb) {
        cb(http3Context->listen(host.empty() ? nullptr : host.c_str(), port, options));
        return std::move(*this);
    }

    /* GOAWAY + drain. The engine itself is torn down in the destructor. */
    void close() { http3Context->shutdown(); }
    bool addServerNameWithOptions(const char *hostname, SocketContextOptions options) {
        us_bun_socket_context_options_t raw;
        memcpy(&raw, &options, sizeof(raw));
        return http3Context->addServerName(hostname, raw);
    }
};

}

#endif
