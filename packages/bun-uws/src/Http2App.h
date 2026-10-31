#ifndef UWS_H2APP_H
#define UWS_H2APP_H

#include "App.h"
#include "Http2Context.h"

namespace uWS {

/* TemplatedApp-shaped front for HTTP/2. There is no listen(): connections are
 * accepted by the TemplatedApp this attaches to and migrate here after ALPN
 * (TLS) or the prior-knowledge preface (cleartext). Route registration
 * mirrors H3App so the C ABI stays 1:1 with uws_h3_app_*. */
struct H2App {
    Http2Context *http2Context;

    template <bool SSL>
    static H2App *create(TemplatedApp<SSL> *parent, bool allowHttp1, unsigned idleTimeoutSecs = 0) {
        if (!parent || parent->constructorFailed()) return nullptr;
        Http2Context *ctx = Http2Context::create(Loop::get(), idleTimeoutSecs);
        parent->attachHttp2(ctx, allowHttp1);
        return new H2App{ctx};
    }

    ~H2App() {
        if (http2Context) http2Context->free();
    }

#define H2_METHOD(name, verb)                                                            \
    H2App &&name(std::string_view pattern,                                               \
                 MoveOnlyFunction<void(Http2Response *, Http2Request *)> &&handler) {    \
        http2Context->onHttp(verb, pattern, std::move(handler));                         \
        return std::move(*this);                                                         \
    }
    H2_METHOD(get, "get")
    H2_METHOD(post, "post")
    H2_METHOD(put, "put")
    H2_METHOD(del, "delete")
    H2_METHOD(patch, "patch")
    H2_METHOD(head, "head")
    H2_METHOD(options, "options")
    H2_METHOD(connect, "connect")
    H2_METHOD(trace, "trace")
    H2_METHOD(any, "*")
#undef H2_METHOD

    void onScheduleDrain(void (*cb)(void *, Http2Context *), void *user) {
        http2Context->scheduleDrain = cb;
        http2Context->scheduleDrainUser = user;
    }
    bool drain() { return http2Context->drain(); }

    void clearRoutes() { http2Context->clearRoutes(); }
    /* GOAWAY + close every connection. */
    void close() { http2Context->closeAll(); }
    void *getNativeHandle() { return http2Context; }
};

}

#endif
