#ifndef UWS_H3CONTEXT_H
#define UWS_H3CONTEXT_H

#include "quic.h"
#include "Loop.h"
#include "Http3ContextData.h"
#include "Http3Request.h"
#include "Http3Response.h"
#include "Http3ResponseData.h"

#include <chrono>
#include <memory>
#include <optional>
#include <vector>

namespace uWS {

struct Http3Context {

    static Http3Context *create(Loop *loop, us_bun_socket_context_options_t options, unsigned idleTimeoutSecs = 0) {
        us_quic_socket_context_t *ctx = us_create_quic_socket_context(
            (us_loop_t *) loop, options, sizeof(Http3ContextData), idleTimeoutSecs);
        if (!ctx) return nullptr;
        Http3ContextData *contextData = new (us_quic_socket_context_ext(ctx)) Http3ContextData();
        contextData->topicTree = createStreamTopicTree();
        StreamTopicTree *topicTree = contextData->topicTree;
        /* Commit pub/sub batches every loop iteration, as TemplatedApp does
         * for HTTP/1. The pre handler runs before QUIC streams are flushed. */
        loop->addPostHandler(topicTree, [topicTree](Loop *) { topicTree->drain(); });
        loop->addPreHandler(topicTree, [topicTree](Loop *) { topicTree->drain(); });
        us_quic_socket_context_on_sweep(ctx, [](us_quic_socket_context_t *c) {
            ((Http3Context *) c)->sweepWebSocketTimeouts();
        });

        us_quic_socket_context_on_stream_open(ctx, [](us_quic_stream_t *s, int) {
            new (us_quic_stream_ext(s)) Http3ResponseData();
        });

        us_quic_socket_context_on_stream_headers(ctx, [](us_quic_stream_t *s) {
            Http3ContextData *cd = (Http3ContextData *) us_quic_socket_context_ext(us_quic_stream_context(s));
            Http3Response *res = (Http3Response *) s;
            Http3ResponseData *rd = res->getHttpResponseData();
            /* lsquic re-fires on_stream_headers for every HEADERS block on
             * the stream; only the first one is the request. Re-running
             * reset()/route() for trailers would wipe the live response's
             * onAborted/userData and dispatch the handler a second time.
             * state is 0 only before the first reset() on this stream. */
            if (rd->state != 0) return;
            rd->reset();

            Http3Request req(s);
            if (!classifyConnect(res, rd, req)) return;
            if (req.getHeader("expect") == "100-continue") res->writeContinue();
            cd->router.getUserData() = {res, &req};
            /* Bun's public WebSocket route is a GET route: HTTP/1 upgrades
             * arrive as GET, RFC 9220 sends the same handshake as Extended
             * CONNECT. Only a validated websocket CONNECT uses the GET table;
             * Http3Request keeps the wire method for the handler. */
            if (!cd->router.route(rd->websocketConnect ? std::string_view("get") : req.getMethod(), req.getUrl())) {
                res->writeStatus("404 Not Found")->end();
            }
        });

        us_quic_socket_context_on_stream_data(ctx, [](us_quic_stream_t *s, const char *data, unsigned len, int fin) {
            Http3Response *res = (Http3Response *) s;
            Http3ResponseData *rd = res->getHttpResponseData();
            if (fin) rd->remoteFin = true;
            if (rd->inStream) rd->inStream(res, data, len, fin != 0, rd->userData);
        });

        us_quic_socket_context_on_stream_writable(ctx, [](us_quic_stream_t *s) {
            Http3Response *res = (Http3Response *) s;
            if (!res->drain()) us_quic_stream_want_write(s, 1);
        });

        us_quic_socket_context_on_stream_close(ctx, [](us_quic_stream_t *s) {
            Http3Response *res = (Http3Response *) s;
            Http3ResponseData *rd = res->getHttpResponseData();
            if (rd->websocketTracked) {
                Http3ContextData *cd = (Http3ContextData *) us_quic_socket_context_ext(us_quic_stream_context(s));
                cd->websocketStreams.erase(res);
                rd->websocketTracked = false;
            }
            /* Fire onAborted for both real aborts and post-completion stream
             * teardown. The handler distinguishes via hasResponded(); for the
             * completed case it ends the request here, because this is its
             * last notification and its pointer must not outlive this
             * destructor. */
            if (rd->onAborted) {
                rd->onAborted(res, rd->userData);
            }
            rd->~Http3ResponseData();
        });

        return (Http3Context *) ctx;
    }

    void free() {
        Http3ContextData *cd = getContextData();
        *cd->alive = false;
        /* Closing the engine fires on_stream_close for every stream; those
         * WebSockets leave the topic tree, so it must outlive the engine. */
        us_quic_socket_context_destroy_engine((us_quic_socket_context_t *) this);
        Loop::get()->removePostHandler(cd->topicTree);
        Loop::get()->removePreHandler(cd->topicTree);
        delete cd->topicTree;
        cd->topicTree = nullptr;
        cd->~Http3ContextData();
        us_quic_socket_context_free((us_quic_socket_context_t *) this);
    }

    uint32_t publish(std::string_view topic, std::string_view message, int opCode, bool compress) {
        bool queued = false;
        return publishToStreamTopic(getContextData()->topicTree, nullptr, topic, message, opCode, compress, queued);
    }

    unsigned int numSubscribers(std::string_view topic) {
        return streamTopicSubscriberCount(getContextData()->topicTree, topic);
    }

    /* Runs from the uSockets timeout sweep: expire WebSocket idle/close
     * deadlines. onTimeout may send a ping and re-arm the deadline; a stream
     * it leaves disarmed is cancelled. onTimeout does not run JavaScript
     * today; the revalidation after each call keeps the loop safe if it ever
     * closes other streams or frees the context. */
    void sweepWebSocketTimeouts() {
        Http3ContextData *cd = getContextData();
        if (cd->websocketStreams.empty()) return;
        auto now = std::chrono::steady_clock::now();
        std::vector<Http3Response *> expired;
        for (Http3Response *res : cd->websocketStreams) {
            Http3ResponseData *d = res->getHttpResponseData();
            if (d->websocketTimeoutActive && d->websocketDeadline <= now) expired.push_back(res);
        }
        std::shared_ptr<bool> alive = cd->alive;
        auto tracked = [cd](Http3Response *res) { return cd->websocketStreams.count(res) != 0; };
        for (Http3Response *res : expired) {
            if (!*alive) return;
            if (!tracked(res)) continue;
            Http3ResponseData *d = res->getHttpResponseData();
            if (!d->websocketTimeoutActive || d->websocketDeadline > now) continue;
            d->websocketTimeoutActive = false;
            if (d->onTimeout) d->onTimeout(res, d->userData);
            if (!*alive) return;
            if (tracked(res) && !res->getHttpResponseData()->websocketTimeoutActive) res->cancel();
        }
    }

private:
    static constexpr uint64_t H3_MESSAGE_ERROR = 0x10E;

    static bool isTokenChar(unsigned char c) {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return true;
        switch (c) {
        case '!': case '#': case '$': case '%': case '&': case '\'': case '*':
        case '+': case '-': case '.': case '^': case '_': case '`': case '|': case '~':
            return true;
        }
        return false;
    }

    /* RFC 9220 §3 applies RFC 8441 §4 to HTTP/3: an Extended CONNECT names
     * its protocol in :protocol and, unlike CONNECT, carries :scheme and
     * :path. :protocol on anything else is malformed (RFC 9114 §4.1.2).
     * Returns false after resetting a malformed request. */
    static bool classifyConnect(Http3Response *res, Http3ResponseData *rd, Http3Request &req) {
        bool isConnect = req.getWireMethod() == "CONNECT";
        rd->connectRequest = isConnect;
        std::optional<std::string_view> protocol = req.getProtocol();
        if (!protocol) return true;
        bool malformed = !isConnect || protocol->empty() || req.getScheme().empty() ||
            req.getFullUrl().empty() || !req.hasAuthority() || req.getHeader("host").empty();
        for (unsigned char c : *protocol) {
            if (!isTokenChar(c)) malformed = true;
        }
        if (!malformed && *protocol == "websocket") malformed = req.getScheme() != "https";
        if (malformed) {
            us_quic_stream_reset_with_code((us_quic_stream_t *) res, H3_MESSAGE_ERROR);
            return false;
        }
        rd->websocketConnect = *protocol == "websocket";
        return true;
    }

public:

    Http3ContextData *getContextData() {
        return (Http3ContextData *) us_quic_socket_context_ext((us_quic_socket_context_t *) this);
    }

    void onHttp(std::string_view method, std::string_view pattern,
                MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {
        Http3ContextData *cd = getContextData();
        std::vector<std::string_view> methods =
            method == "*" ? std::vector<std::string_view>{"*"} : std::vector<std::string_view>{method};
        cd->router.add(methods, pattern, [handler = std::move(handler)](auto *router) mutable {
            /* Copy out: the handler may reload routes, replacing `router`
             * (and its user data) while we're inside it. */
            Http3Request *req = router->getUserData().httpRequest;
            Http3Response *res = router->getUserData().httpResponse;
            req->setYield(false);
            req->setParameters(router->getParameters());
            handler(res, req);
            return !req->getYield();
        }, method == "*" ? cd->router.LOW_PRIORITY : cd->router.MEDIUM_PRIORITY);
    }

    us_quic_listen_socket_t *listen(const char *host, int port, int flags) {
        return us_quic_socket_context_listen((us_quic_socket_context_t *) this,
            host, port, flags, sizeof(Http3ResponseData));
    }

    void shutdown() { us_quic_socket_context_shutdown((us_quic_socket_context_t *) this); }

    bool addServerName(const char *hostname, us_bun_socket_context_options_t options) {
        return us_quic_socket_context_add_server_name((us_quic_socket_context_t *) this, hostname, options) == 0;
    }
};

}

#endif
