#ifndef UWS_H3APP_H
#define UWS_H3APP_H

#include "Http3Context.h"

#include <string>

extern "C" us_loop_t *uws_get_loop();

namespace uWS {

struct H3App {
    Http3Context::Ptr http3Context;

    static H3App *create(us_bun_socket_context_options_t options, unsigned idleTimeoutSecs, const void *routes) {
        auto ctx = Http3Context::create(uws_get_loop(), options, idleTimeoutSecs, routes);
        if (!ctx) return nullptr;
        return new H3App{std::move(ctx)};
    }

    H3App &&listen(const std::string &host, int port, int options, auto &&cb) {
        cb(http3Context->listen(host.empty() ? nullptr : host.c_str(), port, options));
        return std::move(*this);
    }

    /* GOAWAY + drain. The engine itself is torn down in the destructor. */
    void close() { http3Context->shutdown(); }
    bool addServerNameWithOptions(const char *hostname, us_bun_socket_context_options_t options) {
        return http3Context->addServerName(hostname, options);
    }
};

}

#endif
