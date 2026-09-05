// HTTP/2 C ABI. Mirrors libuwsockets_h3.cpp 1:1 (same parameter shapes,
// same callback signatures) so the Rust side pattern-matches the H3 surface.
// Requests are uWS::Http3Request (the shared decoded-header-list request),
// so the uws_h3_req_* functions serve HTTP/2 too; only app and response
// entry points live here.

// clang-format off
#include "_libusockets.h"

#include <bun-uws/src/Http2App.h>
#include <string_view>
#include <string.h>
// clang-format on

using uWS::H2App;
using uWS::Http2Request;
using uWS::Http2Response;
using uWS::Http2ResponseData;

static inline std::string_view h2sv(const char* p, size_t n) { return p ? std::string_view { p, n } : std::string_view {}; }

extern "C" {

#pragma clang attribute push(__attribute__((always_inline)), apply_to = function)

typedef struct uws_app_s uws_app_t;
typedef struct uws_h2_app_s uws_h2_app_t;
typedef struct uws_h2_res_s uws_h2_res_t;
typedef struct uws_h3_req_s uws_h3_req_t;

typedef void (*uws_h2_method_handler)(uws_h2_res_t*, uws_h3_req_t*, void*);

/* ───── app ───── */

uws_h2_app_t* uws_h2_create_app(int ssl, uws_app_t* parent, bool allow_http1, unsigned int idle_timeout_s)
{
    if (ssl) {
        return (uws_h2_app_t*)H2App::create((uWS::TemplatedApp<true>*)parent, allow_http1, idle_timeout_s);
    }
    return (uws_h2_app_t*)H2App::create((uWS::TemplatedApp<false>*)parent, allow_http1, idle_timeout_s);
}

void uws_h2_app_destroy(uws_h2_app_t* app) { delete (H2App*)app; }
void uws_h2_app_on_schedule_drain(uws_h2_app_t* app, void (*cb)(void*, void*), void* user) { ((H2App*)app)->onScheduleDrain((void (*)(void*, uWS::Http2Context*))cb, user); }
bool uws_h2_app_drain(uws_h2_app_t* app) { return ((H2App*)app)->drain(); }
void uws_h2_app_clear_routes(uws_h2_app_t* app) { ((H2App*)app)->clearRoutes(); }

#define H2_ROUTE(name, method)                                                                         \
    void uws_h2_app_##name(uws_h2_app_t* app, const char* pattern, size_t pattern_len,                 \
        uws_h2_method_handler handler, void* user_data)                                                \
    {                                                                                                  \
        if (handler == nullptr) return;                                                                \
        ((H2App*)app)->method(h2sv(pattern, pattern_len), [handler, user_data](auto* res, auto* req) { \
            handler((uws_h2_res_t*)res, (uws_h3_req_t*)req, user_data);                                \
        });                                                                                            \
    }
H2_ROUTE(get, get)
H2_ROUTE(post, post)
H2_ROUTE(options, options)
H2_ROUTE(delete, del)
H2_ROUTE(patch, patch)
H2_ROUTE(put, put)
H2_ROUTE(head, head)
H2_ROUTE(connect, connect)
H2_ROUTE(trace, trace)
H2_ROUTE(any, any)
#undef H2_ROUTE

/* ───── response ───── */

int uws_h2_res_state(uws_h2_res_t* res) { return ((Http2Response*)res)->getHttpResponseData()->state; }

void uws_h2_res_end(uws_h2_res_t* res, const char* data, size_t length, bool close_connection)
{
    Http2Response* r = (Http2Response*)res;
    r->clearOnWritableAndAborted();
    r->end(h2sv(data, length), close_connection);
}

void uws_h2_res_end_stream(uws_h2_res_t* res, bool close_connection)
{
    Http2Response* r = (Http2Response*)res;
    r->clearOnWritableAndAborted();
    r->sendTerminatingChunk(close_connection);
}

bool uws_h2_res_is_closed(uws_h2_res_t* res) { return ((Http2Response*)res)->dead; }

/* END_STREAM on the request HEADERS, or content-length: 0 (declaredContentLength is -1 when absent). */
bool uws_h2_res_request_body_ended(uws_h2_res_t* res)
{
    Http2Response* r = (Http2Response*)res;
    return r->remoteClosed || r->declaredContentLength == 0;
}

/* Server-side failure after the response started (a body stream errored,
 * a file read failed): the peer sees INTERNAL_ERROR, not a cancel. */
void uws_h2_res_force_close(uws_h2_res_t* res)
{
    Http2Response* r = (Http2Response*)res;
    r->clearOnWritableAndAborted();
    r->close(uWS::http2::ERR_INTERNAL_ERROR);
}

bool uws_h2_res_try_end(uws_h2_res_t* res, const char* bytes, size_t len, size_t total_len, bool close)
{
    return ((Http2Response*)res)->tryEnd(h2sv(bytes, len), total_len, close).first;
}

void uws_h2_res_end_without_body(uws_h2_res_t* res, bool close_connection)
{
    Http2Response* r = (Http2Response*)res;
    r->clearOnWritableAndAborted();
    r->endWithoutBody(std::nullopt, close_connection);
}

void uws_h2_res_grow_request_window(uws_h2_res_t* res) { ((uWS::Http2Response*)res)->growReceiveWindow(); }
void uws_h2_res_pause(uws_h2_res_t* res) { ((Http2Response*)res)->pause(); }
void uws_h2_res_resume(uws_h2_res_t* res) { ((Http2Response*)res)->resume(); }
void uws_h2_res_write_continue(uws_h2_res_t* res) { ((Http2Response*)res)->writeContinue(); }

void uws_h2_res_write_status(uws_h2_res_t* res, const char* status, size_t length)
{
    ((Http2Response*)res)->writeStatus(h2sv(status, length));
}

void uws_h2_res_write_header(uws_h2_res_t* res, const char* key, size_t key_len,
    const char* value, size_t value_len)
{
    ((Http2Response*)res)->writeHeader(h2sv(key, key_len), h2sv(value, value_len));
}

void uws_h2_res_write_header_int(uws_h2_res_t* res, const char* key, size_t key_len, uint64_t value)
{
    ((Http2Response*)res)->writeHeader(h2sv(key, key_len), value);
}

void uws_h2_res_mark_wrote_content_length_header(uws_h2_res_t* res)
{
    ((Http2Response*)res)->getHttpResponseData()->state |= Http2ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER;
}

void uws_h2_res_mark_wrote_date_header(uws_h2_res_t* res)
{
    ((Http2Response*)res)->getHttpResponseData()->state |= Http2ResponseData::HTTP_WROTE_DATE_HEADER;
}

void uws_h2_res_write_mark(uws_h2_res_t* res) { ((Http2Response*)res)->writeMark(); }
void uws_h2_res_flush_headers(uws_h2_res_t* res, bool) { ((Http2Response*)res)->flushHeaders(); }

bool uws_h2_res_write(uws_h2_res_t* res, const char* data, size_t* length)
{
    size_t written = 0;
    bool ok = ((Http2Response*)res)->write(h2sv(data, *length), &written);
    *length = written;
    return ok;
}

bool uws_h2_res_has_responded(uws_h2_res_t* res) { return ((Http2Response*)res)->hasResponded(); }
size_t uws_h2_res_get_buffered_amount(uws_h2_res_t* res) { return ((Http2Response*)res)->getBufferedAmount(); }

void uws_h2_res_reset_timeout(uws_h2_res_t* res) { ((Http2Response*)res)->resetTimeout(); }
void uws_h2_res_timeout(uws_h2_res_t* res, uint8_t seconds) { ((Http2Response*)res)->setTimeout(seconds); }
void uws_h2_res_end_sendfile(uws_h2_res_t* res, uint64_t, bool close)
{
    ((Http2Response*)res)->sendTerminatingChunk(close);
}

void uws_h2_res_on_writable(uws_h2_res_t* res, bool (*h)(uws_h2_res_t*, uint64_t, void*), void* opt)
{
    ((Http2Response*)res)->onWritable(opt, (Http2ResponseData::OnWritableCallback)h);
}
void uws_h2_res_clear_on_writable(uws_h2_res_t* res) { ((Http2Response*)res)->clearOnWritable(); }
void uws_h2_res_on_aborted(uws_h2_res_t* res, void (*h)(uws_h2_res_t*, void*), void* opt)
{
    if (h)
        ((Http2Response*)res)->onAborted(opt, (Http2ResponseData::OnAbortedCallback)h);
    else
        ((Http2Response*)res)->clearOnAborted();
}
void uws_h2_res_on_timeout(uws_h2_res_t* res, void (*h)(uws_h2_res_t*, void*), void* opt)
{
    if (h)
        ((Http2Response*)res)->onTimeout(opt, (Http2ResponseData::OnTimeoutCallback)h);
    else
        ((Http2Response*)res)->clearOnTimeout();
}
void uws_h2_res_on_data(uws_h2_res_t* res, void (*h)(uws_h2_res_t*, const char*, size_t, bool, void*), void* opt)
{
    ((Http2Response*)res)->onData(opt, (Http2ResponseData::OnDataCallback)h);
}

void uws_h2_res_cork(uws_h2_res_t* res, void* ctx, void (*corker)(void*))
{
    ((Http2Response*)res)->cork([ctx, corker]() { corker(ctx); });
}

typedef struct uws_res_s uws_res_t;
uint64_t uws_res_get_remote_address_info(uws_res_t* res, const char** dest, int* port, bool* is_ipv6);
uint64_t uws_h2_res_get_remote_address_info(uws_h2_res_t* res, const char** dest, int* port, bool* is_ipv6)
{
    /* The HTTP/1 shim only reads the us_socket_t behind the response. */
    return uws_res_get_remote_address_info((uws_res_t*)((Http2Response*)res)->conn->s, dest, port, is_ipv6);
}

#pragma clang attribute pop

} // extern "C"
