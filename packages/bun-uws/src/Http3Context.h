#ifndef UWS_H3CONTEXT_H
#define UWS_H3CONTEXT_H

#include "quic.h"
#include "HttpRequest.h"
#include "Http3Response.h"
#include "Http3ResponseData.h"

#include <memory>

namespace uWS {

static_assert(US_QUIC_MAX_REQUEST_FIELDS == UWS_HTTP_MAX_HEADERS_COUNT, "HTTP/3 has the field limit of HTTP/1 and HTTP/2");

extern "C" void uws_h3_dispatch(const void *routes, Http3Response *, const us_quic_header_t *fields, unsigned int count);

struct Http3ContextData {
    /* Routes in src/uws_sys/h3.rs, which OwnedApp owns. */
    const void *routes;
};

struct Http3Context {

    struct Deleter {
        void operator()(Http3Context *ctx) const {
            us_quic_socket_context_free((us_quic_socket_context_t *) ctx);
        }
    };
    using Ptr = std::unique_ptr<Http3Context, Deleter>;

    static Ptr create(us_loop_t *loop, us_bun_socket_context_options_t options, unsigned idleTimeoutSecs, const void *routes) {
        us_quic_socket_context_t *ctx = us_create_quic_socket_context(
            loop, options, sizeof(Http3ContextData), idleTimeoutSecs);
        if (!ctx) return nullptr;
        new (us_quic_socket_context_ext(ctx)) Http3ContextData{routes};

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

            if (us_quic_stream_headers_too_large(s)) {
                res->writeStatus("431 Request Header Fields Too Large")->end();
                return;
            }

            uws_h3_dispatch(cd->routes, res, us_quic_stream_header(s, 0), us_quic_stream_header_count(s));
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

        return Ptr((Http3Context *) ctx);
    }

    Http3ContextData *getContextData() {
        return (Http3ContextData *) us_quic_socket_context_ext((us_quic_socket_context_t *) this);
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
