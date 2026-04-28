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

    static H3App *create(SocketContextOptions options, unsigned idleTimeoutSecs = 0) {
        us_bun_socket_context_options_t raw;
        memcpy(&raw, &options, sizeof(raw));
        Http3Context *ctx = Http3Context::create(Loop::get(), raw, idleTimeoutSecs);
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

    /* WebSocket-shaped behaviour but no upgrade callback: the CONNECT
     * request is routed like any other "connect"-method handler so the
     * application can inspect headers (Origin, WT-Available-Protocols) and
     * decide whether to res->upgradeWebTransport(). open/message/drain/close
     * are stored on the context and dispatched from the WT stream/datagram
     * callbacks. */
    struct WebTransportBehavior {
        unsigned int maxPayloadLength = 16 * 1024;
        unsigned int maxBackpressure = 64 * 1024;
        bool closeOnBackpressureLimit = false;
        MoveOnlyFunction<void(Http3Response *, Http3Request *)> upgrade = nullptr;
        MoveOnlyFunction<void(WebTransportSession *)> open = nullptr;
        MoveOnlyFunction<void(WebTransportSession *, std::string_view, OpCode)> message = nullptr;
        MoveOnlyFunction<void(WebTransportSession *)> drain = nullptr;
        MoveOnlyFunction<void(WebTransportSession *, int, std::string_view)> close = nullptr;
    };

    H3App &&wt(std::string_view pattern, WebTransportBehavior &&behavior) {
        WebTransportContextData *cd = &http3Context->getContextData()->wt;
        cd->maxPayloadLength = behavior.maxPayloadLength;
        cd->maxBackpressure = behavior.maxBackpressure;
        cd->closeOnBackpressureLimit = behavior.closeOnBackpressureLimit;
        cd->openHandler = std::move(behavior.open);
        cd->messageHandler = std::move(behavior.message);
        cd->drainHandler = std::move(behavior.drain);
        cd->closeHandler = std::move(behavior.close);
        if (!cd->topicTree) {
            cd->topicTree = new TopicTree<TopicTreeMessage, TopicTreeBigMessage>(
                [](Subscriber *s, TopicTreeMessage &m, auto) {
                    ((WebTransportSession *) s->user)->send(m.message, (OpCode) m.opCode);
                    return false;
                });
        }
        /* Route the CONNECT itself. The handler is what decides 200 vs 404
         * vs 403; the spec's :protocol check happens here so non-WT CONNECTs
         * (e.g. RFC 9220 websocket-over-h3) fall through to the next route. */
        http3Context->onHttp("connect", pattern,
            [upgrade = std::move(behavior.upgrade)](Http3Response *res, Http3Request *req) mutable {
                std::string_view proto = req->getHeader(":protocol");
                if (proto != "webtransport" && proto != "webtransport-h3") {
                    req->setYield(true);
                    return;
                }
                if (upgrade) upgrade(res, req);
                else res->upgradeWebTransport(nullptr);
            });
        return std::move(*this);
    }

    bool publish(std::string_view topic, std::string_view message, OpCode opCode = BINARY, bool = false) {
        WebTransportContextData *cd = &http3Context->getContextData()->wt;
        if (!cd->topicTree) return false;
        return cd->topicTree->publishBig(nullptr, topic, {message, opCode, false},
            [](Subscriber *s, TopicTreeBigMessage &m) {
                ((WebTransportSession *) s->user)->send(m.message, (OpCode) m.opCode);
            });
    }

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
