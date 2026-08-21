#ifndef UWS_H3CONTEXT_H
#define UWS_H3CONTEXT_H

#include "quic.h"
#include "Loop.h"
#include "Http3ContextData.h"
#include "Http3Request.h"
#include "Http3Response.h"
#include "Http3ResponseData.h"
#include "Http3WebTransport.h"

namespace uWS {

struct Http3Context {

    static Http3Context *create(Loop *loop, us_bun_socket_context_options_t options,
                                unsigned idleTimeoutSecs = 0, bool webtransport = false) {
        us_quic_socket_context_t *ctx = us_create_quic_socket_context(
            (us_loop_t *) loop, options, sizeof(Http3ContextData), idleTimeoutSecs, webtransport);
        if (!ctx) return nullptr;
        new (us_quic_socket_context_ext(ctx)) Http3ContextData();

        us_quic_socket_context_on_wt_datagram(ctx, [](us_quic_stream_t *s, const char *data, unsigned len) {
            Http3ContextData *cd = (Http3ContextData *) us_quic_socket_context_ext(us_quic_stream_context(s));
            if (cd->onWebTransportDatagram) {
                cd->onWebTransportDatagram((Http3WebTransportSession *) s, data, len);
            }
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
            if (req.getHeader("expect") == "100-continue") res->writeContinue();
            cd->router.getUserData() = {res, &req};
            if (!cd->router.route(req.getMethod(), req.getUrl())) {
                res->writeStatus("404 Not Found")->end();
            }
        });

        us_quic_socket_context_on_stream_data(ctx, [](us_quic_stream_t *s, const char *data, unsigned len, int fin) {
            Http3Response *res = (Http3Response *) s;
            Http3ResponseData *rd = res->getHttpResponseData();
            /* On an upgraded session the CONNECT stream carries capsules, not
             * a request body, so it never reaches inStream. A FIN without a
             * close capsule is still the end of the session — the draft allows
             * a peer to just stop — and on_stream_close reports it. */
            if (us_quic_stream_is_webtransport(s)) {
                Http3WebTransportSession *wt = (Http3WebTransportSession *) s;
                /* A close capsule only records why; the report itself happens
                 * in on_stream_close, so that a session that ends by capsule
                 * and one that ends by the connection going away arrive at the
                 * handler through the same single path. */
                bool alive = wt->feedCapsules(data, len, [&](uint32_t code, std::string_view reason) {
                    rd->wtCloseCode = code;
                    rd->wtCloseReason.shrink(0);
                    rd->wtCloseReason.append(std::span<const char>(reason.data(), reason.size()));
                });
                if (!alive) us_quic_stream_close(s);
                return;
            }
            if (rd->inStream) rd->inStream(res, data, len, fin != 0, rd->userData);
        });

        us_quic_socket_context_on_stream_writable(ctx, [](us_quic_stream_t *s) {
            Http3Response *res = (Http3Response *) s;
            if (!res->drain()) us_quic_stream_want_write(s, 1);
        });

        us_quic_socket_context_on_stream_close(ctx, [](us_quic_stream_t *s) {
            Http3Response *res = (Http3Response *) s;
            Http3ResponseData *rd = res->getHttpResponseData();
            /* An upgraded session never had onAborted armed — the CONNECT
             * response ended the HTTP exchange the moment it was accepted —
             * so it reports here and returns rather than falling through. */
            if (us_quic_stream_is_webtransport(s)) {
                Http3ContextData *cd =
                    (Http3ContextData *) us_quic_socket_context_ext(us_quic_stream_context(s));
                if (cd->onWebTransportClose) {
                    cd->onWebTransportClose((Http3WebTransportSession *) s, rd->wtCloseCode,
                        rd->wtCloseReason.span().data(), rd->wtCloseReason.size());
                }
                rd->~Http3ResponseData();
                return;
            }
            /* Fire onAborted for both real aborts and post-completion stream
             * teardown. The handler distinguishes via hasResponded(); for the
             * completed case it just drops its pointer so it doesn't outlive
             * this destructor. */
            if (rd->onAborted) {
                rd->onAborted(res, rd->userData);
            }
            rd->~Http3ResponseData();
        });

        return (Http3Context *) ctx;
    }

    void free() {
        getContextData()->~Http3ContextData();
        us_quic_socket_context_free((us_quic_socket_context_t *) this);
    }

    Http3ContextData *getContextData() {
        return (Http3ContextData *) us_quic_socket_context_ext((us_quic_socket_context_t *) this);
    }

    void onHttp(std::string_view method, std::string_view pattern,
                MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {
        Http3ContextData *cd = getContextData();
        std::vector<std::string_view> methods =
            method == "*" ? std::vector<std::string_view>{"*"} : std::vector<std::string_view>{method};
        cd->router.add(methods, pattern, [handler = std::move(handler)](auto *router) mutable {
            auto &ud = router->getUserData();
            ud.httpRequest->setYield(false);
            ud.httpRequest->setParameters(router->getParameters());
            handler(ud.httpResponse, ud.httpRequest);
            return !ud.httpRequest->getYield();
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
