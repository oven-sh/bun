// HTTP/2 C ABI for Zig. Mirrors the uws_h3_* surface in libuwsockets_h3.cpp
// 1:1 (same parameter shapes, same callback signatures) so the Zig side can
// pattern-match NewApp/NewResponse/H3 without protocol-specific branches.
// Kept in its own TU so HTTP/1.1, HTTP/2 and HTTP/3 stay file-level
// separable.

// clang-format off
#include "_libusockets.h"

#include <bun-uws/src/App.h>
#include <bun-uws/src/Http2App.h>
#include <bun-uws/src/Http2Response.h>
#include <bun-uws/src/Http2Request.h>
#include <string_view>
#include <string.h>
// clang-format on

extern "C" const char* ares_inet_ntop(int af, const char* src, char* dst, size_t size);

using uWS::H2App;
using uWS::Http2Request;
using uWS::Http2Response;
using uWS::Http2ResponseData;

/* Unified-build: libuwsockets_h3.cpp defines h2sv()/h2out() at file scope
 * in the same TU. Keep ours in an anonymous namespace so they don't
 * collide. */
namespace {
inline std::string_view h2sv(const char* p, size_t n) { return p ? std::string_view { p, n } : std::string_view {}; }
inline size_t h2out(std::string_view v, const char** dest)
{
    *dest = v.empty() ? "" : v.data();
    return v.length();
}
}

/* Bridges invoked from HttpContext<true>/TemplatedApp so those TUs don't
 * need to include Http2App.h. */
extern "C" us_socket_t* uws_internal_h2_adopt(void* h2Context,
    us_socket_t* s, int oldExtSize, char* data, int length)
{
    return H2App::adoptIfNegotiated((uWS::Http2Context*)h2Context, s, oldExtSize, data, length);
}

extern "C" void uws_internal_h2_close_all(void* h2Context)
{
    us_socket_group_close_all(((uWS::Http2Context*)h2Context)->getSocketGroup());
}

extern "C" {

typedef struct uws_h2_app_s uws_h2_app_t;
typedef struct uws_h2_res_s uws_h2_res_t;
typedef struct uws_h2_req_s uws_h2_req_t;

typedef void (*uws_h2_method_handler)(uws_h2_res_t*, uws_h2_req_t*, void*);

/* ───── app ───── */

uws_h2_app_t* uws_h2_create_app(uws_app_t* parent, unsigned int idle_timeout_s)
{
    auto* sslApp = (uWS::TemplatedApp<true>*)parent;
    return (uws_h2_app_t*)H2App::create(sslApp, idle_timeout_s);
}

void uws_h2_app_destroy(uws_h2_app_t* app) { delete (H2App*)app; }
bool uws_h2_constructor_failed(uws_h2_app_t* app) { return !app || ((H2App*)app)->constructorFailed(); }
void uws_h2_app_close(uws_h2_app_t* app) { ((H2App*)app)->close(); }
void uws_h2_app_clear_routes(uws_h2_app_t* app) { ((H2App*)app)->clearRoutes(); }
void* uws_h2_get_native_handle(uws_h2_app_t* app) { return ((H2App*)app)->getNativeHandle(); }

#define H2_ROUTE(name, method)                                                                         \
    void uws_h2_app_##name(uws_h2_app_t* app, const char* pattern, size_t pattern_len,                 \
        uws_h2_method_handler handler, void* user_data)                                                \
    {                                                                                                  \
        if (handler == nullptr) return;                                                                \
        ((H2App*)app)->method(h2sv(pattern, pattern_len), [handler, user_data](auto* res, auto* req) { \
            handler((uws_h2_res_t*)res, (uws_h2_req_t*)req, user_data);                                \
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

void uws_h2_res_force_close(uws_h2_res_t* res)
{
    Http2Response* r = (Http2Response*)res;
    r->clearOnWritableAndAborted();
    r->close();
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

void uws_h2_res_write_mark(uws_h2_res_t* res) { ((Http2Response*)res)->writeMark(); }
void uws_h2_res_flush_headers(uws_h2_res_t* res, bool) { ((Http2Response*)res)->flushHeaders(); }

bool uws_h2_res_write(uws_h2_res_t* res, const char* data, size_t* length)
{
    size_t written = 0;
    bool ok = ((Http2Response*)res)->write(h2sv(data, *length), &written);
    *length = written;
    return ok;
}

uint64_t uws_h2_res_get_write_offset(uws_h2_res_t* res) { return ((Http2Response*)res)->getWriteOffset(); }
void uws_h2_res_override_write_offset(uws_h2_res_t* res, uint64_t off) { ((Http2Response*)res)->overrideWriteOffset(off); }
bool uws_h2_res_has_responded(uws_h2_res_t* res) { return ((Http2Response*)res)->hasResponded(); }
size_t uws_h2_res_get_buffered_amount(uws_h2_res_t* res) { return ((Http2Response*)res)->getBufferedAmount(); }

void uws_h2_res_reset_timeout(uws_h2_res_t*) {}
void uws_h2_res_timeout(uws_h2_res_t*, uint8_t) {}
void uws_h2_res_end_sendfile(uws_h2_res_t* res, uint64_t, bool close)
{
    ((Http2Response*)res)->sendTerminatingChunk(close);
}
void uws_h2_res_prepare_for_sendfile(uws_h2_res_t*) {}
bool uws_h2_res_is_connect_request(uws_h2_res_t*) { return false; }
void* uws_h2_res_get_native_handle(uws_h2_res_t* res) { return res; }
void* uws_h2_res_get_socket_data(uws_h2_res_t* res) { return ((Http2Response*)res)->getSocketData(); }

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
void uws_h2_res_uncork(uws_h2_res_t*) {}
bool uws_h2_res_is_corked(uws_h2_res_t*) { return false; }

uint64_t uws_h2_res_get_remote_address_info(uws_h2_res_t* res, const char** dest, int* port, bool* is_ipv6)
{
    /* Http2Response wraps a real us_socket_t. Mirror
     * uws_res_get_remote_address_info (libuwsockets.cpp) and the H3
     * wrapper: us_get_remote_address_info only memcpy()s raw
     * in_addr/in6_addr bytes into b and sets *port — dest/is_ipv6 are
     * vestigial — so stringify with inet_ntop here so the Zig side
     * gets a text slice, not raw address bytes. */
    static thread_local char b[64];
    Http2Response* r = (Http2Response*)res;
    int ipv6 = 0;
    auto length = us_get_remote_address_info(b, r->socket, dest, port, &ipv6);
    if (length == 0) {
        *dest = b;
        *is_ipv6 = false;
        return 0;
    }
    if (length == 4) {
        ares_inet_ntop(AF_INET, b, &b[4], 64 - 4);
        *dest = &b[4];
        *is_ipv6 = false;
    } else {
        ares_inet_ntop(AF_INET6, b, &b[16], 64 - 16);
        *dest = &b[16];
        *is_ipv6 = true;
    }
    return (uint64_t)strlen(*dest);
}

/* ───── request ───── */

bool uws_h2_req_is_ancient(uws_h2_req_t*) { return false; }
bool uws_h2_req_get_yield(uws_h2_req_t* req) { return ((Http2Request*)req)->getYield(); }
void uws_h2_req_set_yield(uws_h2_req_t* req, bool y) { ((Http2Request*)req)->setYield(y); }

size_t uws_h2_req_get_url(uws_h2_req_t* req, const char** dest)
{
    return h2out(((Http2Request*)req)->getFullUrl(), dest);
}

size_t uws_h2_req_get_method(uws_h2_req_t* req, const char** dest)
{
    return h2out(((Http2Request*)req)->getMethod(), dest);
}

size_t uws_h2_req_get_header(uws_h2_req_t* req, const char* lower, size_t lower_len, const char** dest)
{
    return h2out(((Http2Request*)req)->getHeader(h2sv(lower, lower_len)), dest);
}

void uws_h2_req_for_each_header(uws_h2_req_t* req,
    void (*cb)(const char*, size_t, const char*, size_t, void*),
    void* user_data)
{
    ((Http2Request*)req)->forEachHeader([cb, user_data](std::string_view name, std::string_view value) {
        cb(name.empty() ? "" : name.data(), name.length(),
            value.empty() ? "" : value.data(), value.length(), user_data);
    });
}

size_t uws_h2_req_get_query(uws_h2_req_t* req, const char* key, size_t key_len, const char** dest)
{
    return h2out(key ? ((Http2Request*)req)->getQuery(h2sv(key, key_len))
                     : ((Http2Request*)req)->getQuery(),
        dest);
}

size_t uws_h2_req_get_parameter(uws_h2_req_t* req, unsigned short index, const char** dest)
{
    return h2out(((Http2Request*)req)->getParameter(index), dest);
}

} // extern "C"
