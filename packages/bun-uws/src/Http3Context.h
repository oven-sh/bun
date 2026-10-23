#ifndef UWS_H3CONTEXT_H
#define UWS_H3CONTEXT_H

#include "quic.h"
#include "Loop.h"
#include "Http3ContextData.h"
#include "Http3Request.h"
#include "Http3Response.h"
#include "Http3ResponseData.h"

namespace uWS {

static_assert(US_QUIC_MAX_REQUEST_FIELDS == UWS_HTTP_MAX_HEADERS_COUNT, "HTTP/3 has the field limit of HTTP/1 and HTTP/2");

struct Http3Context {

    static Http3Context *create(Loop *loop, us_bun_socket_context_options_t options, unsigned idleTimeoutSecs, uint64_t maxRequestBodySize) {
        us_quic_socket_context_t *ctx = us_create_quic_socket_context(
            (us_loop_t *) loop, options, sizeof(Http3ContextData), idleTimeoutSecs);
        if (!ctx) return nullptr;
        (new (us_quic_socket_context_ext(ctx)) Http3ContextData())->maxRequestBodySize = maxRequestBodySize;

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
            if (rd->state != 0) {
                if (!Http3Request::validTrailers(us_quic_stream_header(s, 0), us_quic_stream_header_count(s))) {
                    rd->inStream = nullptr;
                    us_quic_stream_reset(s, US_QUIC_H3_MESSAGE_ERROR);
                }
                return;
            }
            rd->reset();

            if (us_quic_stream_headers_too_large(s)) {
                res->writeStatus("431 Request Header Fields Too Large")->end();
                return;
            }

            Http3Request req(s);
            if (req.isMalformed()) {
                res->writeStatus("400 Bad Request")->end();
                return;
            }
            if (!isKnownMethod(req.getCaseSensitiveMethod())) {
                /* RFC 9110 §15.6.2. The router would dispatch it to the "any"
                 * handler, which cannot represent the method and would report GET. */
                res->writeStatus("501 Not Implemented")->end();
                return;
            }
            if (declaresBodyOverLimit(req.getContentLength(), cd->maxRequestBodySize)) {
                rd->state |= Http3ResponseData::HTTP_REQUEST_BODY_TOO_LARGE;
            } else if (req.getExpectsContinue()) {
                res->writeContinue();
            }
            cd->router.getUserData() = {res, &req};
            if (!cd->router.route(req.getMethod(), req.getUrl())) {
                res->writeStatus("404 Not Found")->end();
            }
        });

        us_quic_socket_context_on_stream_data(ctx, [](us_quic_stream_t *s, const char *data, unsigned len, int fin) {
            Http3Response *res = (Http3Response *) s;
            Http3ResponseData *rd = res->getHttpResponseData();
            if (!rd->inStream) return;
            if (len > rd->requestBodyBudget) return res->refuseRequestBody();
            rd->requestBodyBudget -= len;
            rd->inStream(res, data, len, fin != 0, rd->userData);
        });

        us_quic_socket_context_on_stream_writable(ctx, [](us_quic_stream_t *s) {
            Http3Response *res = (Http3Response *) s;
            if (!res->drain()) us_quic_stream_want_write(s);
        });

        us_quic_socket_context_on_stream_close(ctx, [](us_quic_stream_t *s) {
            Http3Response *res = (Http3Response *) s;
            Http3ResponseData *rd = res->getHttpResponseData();
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

        us_quic_socket_context_on_released(ctx, [](us_quic_socket_context_t *ctx) {
            Http3ContextData *cd = (Http3ContextData *) us_quic_socket_context_ext(ctx);
            if (cd->onReleased) cd->onReleased(cd->onReleasedUser);
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

    us_quic_udp_t *listen(const char *host, int port, int flags) {
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
