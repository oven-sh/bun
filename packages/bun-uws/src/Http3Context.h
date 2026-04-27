#ifndef UWS_H3CONTEXT_H
#define UWS_H3CONTEXT_H

#include "quic.h"
#include "Loop.h"
#include "Http3ContextData.h"
#include "Http3Request.h"
#include "Http3Response.h"
#include "Http3ResponseData.h"

namespace uWS {

struct Http3Context {

    static Http3Context *create(Loop *loop, us_bun_socket_context_options_t options) {
        us_quic_socket_context_t *ctx = us_create_quic_socket_context(
            (us_loop_t *) loop, options, sizeof(Http3ContextData));
        if (!ctx) return nullptr;
        new (us_quic_socket_context_ext(ctx)) Http3ContextData();

        us_quic_socket_context_on_stream_open(ctx, [](us_quic_stream_t *s, int) {
            new (us_quic_stream_ext(s)) Http3ResponseData();
        });

        us_quic_socket_context_on_stream_headers(ctx, [](us_quic_stream_t *s) {
            Http3ContextData *cd = (Http3ContextData *) us_quic_socket_context_ext(us_quic_stream_context(s));
            Http3Response *res = (Http3Response *) s;
            Http3ResponseData *rd = res->getHttpResponseData();
            rd->reset();

            Http3Request req(s);
            cd->router.getUserData() = {res, &req};
            if (!cd->router.route(req.getMethod(), req.getUrl())) {
                res->writeStatus("404 Not Found")->end();
                return;
            }
            req.setParameters(cd->router.getParameters());
            /* If the handler responded synchronously without arming onAborted
             * or onData, we're done; otherwise the stream stays open and the
             * stream callbacks below take over. */
        });

        us_quic_socket_context_on_stream_data(ctx, [](us_quic_stream_t *s, const char *data, unsigned len, int fin) {
            Http3Response *res = (Http3Response *) s;
            Http3ResponseData *rd = res->getHttpResponseData();
            if (rd->inStream) rd->inStream(res, data, len, fin != 0, rd->userData);
        });

        us_quic_socket_context_on_stream_writable(ctx, [](us_quic_stream_t *s) {
            Http3Response *res = (Http3Response *) s;
            if (!res->drain()) us_quic_stream_want_write(s, 1);
        });

        us_quic_socket_context_on_stream_close(ctx, [](us_quic_stream_t *s) {
            Http3Response *res = (Http3Response *) s;
            Http3ResponseData *rd = res->getHttpResponseData();
            if (rd->onAborted && (rd->state & Http3ResponseData::HTTP_RESPONSE_PENDING)) {
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

    us_quic_listen_socket_t *listen(const char *host, int port) {
        return us_quic_socket_context_listen((us_quic_socket_context_t *) this,
            host, port, sizeof(Http3ResponseData));
    }
};

}

#endif
