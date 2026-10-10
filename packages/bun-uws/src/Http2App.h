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
    void (*scheduledDrainCallback)(void *, Http2Context *) = nullptr;
    void *scheduledDrainUser = nullptr;
    bool drainQueued = false;
    bool draining = false;
    bool destroyPending = false;

    template <bool SSL>
    static H2App *create(TemplatedApp<SSL> *parent, bool allowHttp1, unsigned idleTimeoutSecs = 0, bool enableConnectProtocol = false) {
        if (!parent || parent->constructorFailed()) return nullptr;
        Http2Context *ctx = Http2Context::create(Loop::get(), idleTimeoutSecs, enableConnectProtocol);
        parent->attachHttp2(ctx, allowHttp1);
        return new H2App{ctx};
    }

    ~H2App() {
        if (http2Context) http2Context->free();
    }

    /* A deferred Bun task stores H2App* until its drain callback runs.  A JS
     * callback reached while draining can destroy the server re-entrantly, so
     * request destruction now but keep this tiny handle alive until that
     * queued/active callback has observed the tombstone. */
    void destroy() {
        if (destroyPending) return;
        destroyPending = true;
        if (http2Context) {
            http2Context->scheduleDrain = nullptr;
            http2Context->scheduleDrainUser = nullptr;
            http2Context->free();
            http2Context = nullptr;
        }
        if (!draining && !drainQueued) delete this;
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
        scheduledDrainCallback = cb;
        scheduledDrainUser = user;
        http2Context->scheduleDrain = [](void *opaque, Http2Context *ctx) {
            H2App *app = (H2App *) opaque;
            if (app->destroyPending || app->drainQueued) return;
            app->drainQueued = true;
            app->scheduledDrainCallback(app->scheduledDrainUser, ctx);
        };
        http2Context->scheduleDrainUser = this;
    }
    bool drain() {
        drainQueued = false;
        draining = true;
        bool more = http2Context && http2Context->drain();
        draining = false;
        if (destroyPending) {
            delete this;
            return false;
        }
        /* Returning true keeps Bun's deferred task registered for another
         * pass; account for that implicit queued invocation as well. */
        drainQueued = more;
        return more;
    }

    /* Bun removed the deferred callback from its queue. Clear the matching
     * pin before destroy(); otherwise a task cancelled before its first run
     * leaves this wrapper permanently waiting for a callback that cannot run. */
    void cancelDrain() { drainQueued = false; }

    void clearRoutes() { if (http2Context) http2Context->clearRoutes(); }
    uint32_t publish(std::string_view topic, std::string_view message, int opCode, bool compress) {
        return http2Context ? http2Context->publish(topic, message, opCode, compress) : 2;
    }
    unsigned int numSubscribers(std::string_view topic) {
        return http2Context ? http2Context->numSubscribers(topic) : 0;
    }
    /* GOAWAY + close every connection. */
    void close() { if (http2Context) http2Context->closeAll(); }
    void *getNativeHandle() { return http2Context; }
};

}

#endif
