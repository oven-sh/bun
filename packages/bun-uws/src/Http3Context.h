#ifndef UWS_H3CONTEXT_H
#define UWS_H3CONTEXT_H

#include "quic.h"
#include "HttpContext.h"
#include "Loop.h"
#include "Http3ContextData.h"
#include "Http3Request.h"
#include "Http3Response.h"
#include "Http3ResponseData.h"

namespace uWS {

static_assert(US_QUIC_MAX_REQUEST_FIELDS == UWS_HTTP_MAX_HEADERS_COUNT, "HTTP/3 has the field limit of HTTP/1 and HTTP/2");

struct Http3Context {
    using Ptr = std::unique_ptr<Http3Context>;

    static Ptr create(Loop *loop, us_bun_socket_context_options_t options, unsigned idleTimeoutSecs = 0) {
        static constexpr us_quic_callbacks_t callbacks = {
            .on_open = [](void *user, const us_quic_stream_t *stream) -> void * {
                Http3Context *ctx = (Http3Context *) user;
                return new Http3Response{*stream, ctx, ctx->loopData, {}};
            },
            .on_headers = [](void *response, const us_quic_header_t *headers, unsigned count, bool incomplete) {
                Http3Response *res = (Http3Response *) response;
                if (incomplete) {
                    res->writeStatus("431 Request Header Fields Too Large")->end();
                    return;
                }
                Http3ContextData *cd = res->context->getContextData();
                Http3Request req(headers, count);
                if (!isKnownMethod(req.getCaseSensitiveMethod())) {
                    res->writeStatus("501 Not Implemented")->end();
                    return;
                }
                if (req.getHeader("expect") == "100-continue") res->writeContinue();
                cd->router.getUserData() = {res, &req};
                if (!cd->router.route(req.getCaseSensitiveMethod(), req.getUrl())) {
                    res->writeStatus("404 Not Found")->end();
                }
            },
            .on_data = [](void *response, const char *data, unsigned len, bool fin) {
                Http3Response *res = (Http3Response *) response;
                Http3ResponseData *rd = res->getHttpResponseData();
                if (rd->inStream) rd->inStream(res, data, len, fin, rd->userData);
            },
            .on_writable = [](void *response) {
                Http3Response *res = (Http3Response *) response;
                if (!res->drain()) us_quic_stream_want_write(&res->stream);
            },
            .on_close = [](void *response) {
                std::unique_ptr<Http3Response> res{(Http3Response *) response};
                Http3ResponseData *rd = res->getHttpResponseData();
                /* Fire onAborted for both real aborts and post-completion stream
                 * teardown. The handler distinguishes via hasResponded(); for the
                 * completed case it ends the request here, because this is its
                 * last notification and its pointer must not outlive this
                 * destructor. */
                if (rd->onAborted) {
                    rd->onAborted(res.get(), rd->userData);
                }
            },
        };

        Ptr ctx = std::make_unique<Http3Context>();
        ctx->loopData = (LoopData *) us_loop_ext((us_loop_t *) loop);
        ctx->idleTimeoutSecs = idleTimeoutSecs;
        /* Same limit as Http2Context::maxHeaderListSize. */
        ctx->quic.reset(us_create_quic_socket_context((us_loop_t *) loop, &options, idleTimeoutSecs,
            BUN_DEFAULT_MAX_HTTP_HEADER_SIZE ? BUN_DEFAULT_MAX_HTTP_HEADER_SIZE : 64 * 1024, &callbacks, ctx.get()));
        if (!ctx->quic) return nullptr;
        return ctx;
    }

    unsigned idleTimeoutSecs = 0;

    Http3ContextData *getContextData() { return &data; }

    void onHttp(std::string_view method, std::string_view pattern,
                MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {
        Http3ContextData *cd = getContextData();
        std::span<const std::string_view> methods{&method, 1};
        if (method == "*") methods = detail::supportedHttpMethods;
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
        return us_quic_socket_context_listen(quic.get(), host, port, flags);
    }

    void shutdown(void (*onDrained)(void *), void *user) { us_quic_socket_context_shutdown(quic.get(), onDrained, user); }

    bool addServerName(const char *hostname, us_bun_socket_context_options_t options) {
        return us_quic_socket_context_add_server_name(quic.get(), hostname, &options);
    }

private:
    LoopData *loopData;
    Http3ContextData data;
    std::unique_ptr<us_quic_socket_context_t,
        decltype([](us_quic_socket_context_t *ctx) { us_quic_socket_context_free(ctx); })> quic;
};

}

#endif
