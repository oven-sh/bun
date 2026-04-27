// HTTP/3 C ABI for Zig. Mirrors the uws_* surface in libuwsockets.cpp 1:1
// (same parameter shapes, same callback signatures) so the Zig side can
// pattern-match NewApp/NewResponse without protocol-specific branches.
// Kept in its own TU so HTTP/1.1 and HTTP/3 stay file-level separable.

// clang-format off
#include "_libusockets.h"
#include "quic.h"

#include <bun-uws/src/Http3App.h>
#include <bun-uws/src/Http3Response.h>
#include <bun-uws/src/Http3Request.h>
#include <string_view>
#include <string.h>
// clang-format on

extern "C" const char* ares_inet_ntop(int af, const char* src, char* dst, size_t size);

using uWS::H3App;
using uWS::Http3Request;
using uWS::Http3Response;
using uWS::Http3ResponseData;
using uWS::WebTransportSession;

static inline std::string_view sv(const char* p, size_t n) { return p ? std::string_view { p, n } : std::string_view {}; }

extern "C" {

typedef struct uws_h3_app_s uws_h3_app_t;
typedef struct uws_h3_res_s uws_h3_res_t;
typedef struct uws_h3_req_s uws_h3_req_t;

typedef void (*uws_h3_method_handler)(uws_h3_res_t*, uws_h3_req_t*, void*);
typedef void (*uws_h3_listen_handler)(us_quic_listen_socket_t*, void*);

/* ───── app ───── */

uws_h3_app_t* uws_h3_create_app(struct us_bun_socket_context_options_t options, unsigned int idle_timeout_s)
{
    static int once = (us_quic_global_init(), 1);
    (void)once;
    uWS::SocketContextOptions sco;
    static_assert(sizeof(sco) == sizeof(options));
    memcpy(&sco, &options, sizeof(sco));
    return (uws_h3_app_t*)H3App::create(sco, idle_timeout_s);
}

void uws_h3_app_destroy(uws_h3_app_t* app) { delete (H3App*)app; }
bool uws_h3_constructor_failed(uws_h3_app_t* app) { return !app || ((H3App*)app)->constructorFailed(); }
void uws_h3_app_close(uws_h3_app_t* app) { ((H3App*)app)->close(); }
void uws_h3_app_clear_routes(uws_h3_app_t* app) { ((H3App*)app)->clearRoutes(); }
void* uws_h3_get_native_handle(uws_h3_app_t* app) { return ((H3App*)app)->getNativeHandle(); }

bool uws_h3_app_add_server_name(uws_h3_app_t* app, const char* hostname,
    struct us_bun_socket_context_options_t options)
{
    uWS::SocketContextOptions sco;
    memcpy(&sco, &options, sizeof(sco));
    return ((H3App*)app)->addServerNameWithOptions(hostname, sco);
}

#define H3_ROUTE(name, method)                                                                       \
    void uws_h3_app_##name(uws_h3_app_t* app, const char* pattern, size_t pattern_len,               \
        uws_h3_method_handler handler, void* user_data)                                              \
    {                                                                                                \
        if (handler == nullptr) return;                                                              \
        ((H3App*)app)->method(sv(pattern, pattern_len), [handler, user_data](auto* res, auto* req) { \
            handler((uws_h3_res_t*)res, (uws_h3_req_t*)req, user_data);                              \
        });                                                                                          \
    }
H3_ROUTE(get, get)
H3_ROUTE(post, post)
H3_ROUTE(options, options)
H3_ROUTE(delete, del)
H3_ROUTE(patch, patch)
H3_ROUTE(put, put)
H3_ROUTE(head, head)
H3_ROUTE(connect, connect)
H3_ROUTE(trace, trace)
H3_ROUTE(any, any)
#undef H3_ROUTE

void uws_h3_app_listen_with_config(uws_h3_app_t* app, const char* host, uint16_t port,
    int32_t options, uws_h3_listen_handler handler, void* user_data)
{
    std::string h = host && host[0] ? std::string(host) : std::string {};
    ((H3App*)app)->listen(h, port, options, [handler, user_data](us_quic_listen_socket_t* ls) {
        handler(ls, user_data);
    });
}

int uws_h3_listen_socket_port(us_quic_listen_socket_t* ls) { return us_quic_listen_socket_port(ls); }
int uws_h3_listen_socket_local_address(us_quic_listen_socket_t* ls, char* buf, int len)
{
    return us_quic_listen_socket_local_address(ls, buf, len);
}
void uws_h3_listen_socket_close(us_quic_listen_socket_t* ls) { us_quic_listen_socket_close(ls); }

/* ───── response ───── */

int uws_h3_res_state(uws_h3_res_t* res) { return ((Http3Response*)res)->getHttpResponseData()->state; }

void uws_h3_res_end(uws_h3_res_t* res, const char* data, size_t length, bool close_connection)
{
    Http3Response* r = (Http3Response*)res;
    r->clearOnWritableAndAborted();
    r->end(sv(data, length), close_connection);
}

void uws_h3_res_end_stream(uws_h3_res_t* res, bool close_connection)
{
    Http3Response* r = (Http3Response*)res;
    r->clearOnWritableAndAborted();
    r->sendTerminatingChunk(close_connection);
}

void uws_h3_res_force_close(uws_h3_res_t* res)
{
    ((Http3Response*)res)->clearOnWritableAndAborted();
    us_quic_stream_close((us_quic_stream_t*)res);
}

bool uws_h3_res_try_end(uws_h3_res_t* res, const char* bytes, size_t len, size_t total_len, bool close)
{
    return ((Http3Response*)res)->tryEnd(sv(bytes, len), total_len, close).first;
}

void uws_h3_res_end_without_body(uws_h3_res_t* res, bool close_connection)
{
    Http3Response* r = (Http3Response*)res;
    r->clearOnWritableAndAborted();
    r->endWithoutBody(std::nullopt, close_connection);
}

void uws_h3_res_pause(uws_h3_res_t* res) { ((Http3Response*)res)->pause(); }
void uws_h3_res_resume(uws_h3_res_t* res) { ((Http3Response*)res)->resume(); }
void uws_h3_res_write_continue(uws_h3_res_t* res) { ((Http3Response*)res)->writeContinue(); }

void uws_h3_res_write_status(uws_h3_res_t* res, const char* status, size_t length)
{
    ((Http3Response*)res)->writeStatus(sv(status, length));
}

void uws_h3_res_write_header(uws_h3_res_t* res, const char* key, size_t key_len,
    const char* value, size_t value_len)
{
    ((Http3Response*)res)->writeHeader(sv(key, key_len), sv(value, value_len));
}

void uws_h3_res_write_header_int(uws_h3_res_t* res, const char* key, size_t key_len, uint64_t value)
{
    ((Http3Response*)res)->writeHeader(sv(key, key_len), value);
}

void uws_h3_res_mark_wrote_content_length_header(uws_h3_res_t* res)
{
    ((Http3Response*)res)->getHttpResponseData()->state |= Http3ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER;
}

void uws_h3_res_write_mark(uws_h3_res_t* res) { ((Http3Response*)res)->writeMark(); }
void uws_h3_res_flush_headers(uws_h3_res_t* res, bool) { ((Http3Response*)res)->flushHeaders(); }

bool uws_h3_res_write(uws_h3_res_t* res, const char* data, size_t* length)
{
    size_t written = 0;
    bool ok = ((Http3Response*)res)->write(sv(data, *length), &written);
    *length = written;
    return ok;
}

uint64_t uws_h3_res_get_write_offset(uws_h3_res_t* res) { return ((Http3Response*)res)->getWriteOffset(); }
void uws_h3_res_override_write_offset(uws_h3_res_t* res, uint64_t off) { ((Http3Response*)res)->overrideWriteOffset(off); }
bool uws_h3_res_has_responded(uws_h3_res_t* res) { return ((Http3Response*)res)->hasResponded(); }
size_t uws_h3_res_get_buffered_amount(uws_h3_res_t* res) { return ((Http3Response*)res)->getBufferedAmount(); }

void uws_h3_res_reset_timeout(uws_h3_res_t*) {}
void uws_h3_res_timeout(uws_h3_res_t*, uint8_t) {}
void uws_h3_res_end_sendfile(uws_h3_res_t* res, uint64_t, bool close)
{
    /* sendfile path falls back to plain end-of-stream over QUIC. */
    ((Http3Response*)res)->sendTerminatingChunk(close);
}
void uws_h3_res_prepare_for_sendfile(uws_h3_res_t*) {}
bool uws_h3_res_is_connect_request(uws_h3_res_t*) { return false; }
void* uws_h3_res_get_native_handle(uws_h3_res_t* res) { return res; }
void* uws_h3_res_get_socket_data(uws_h3_res_t* res) { return ((Http3Response*)res)->getSocketData(); }

void uws_h3_res_on_writable(uws_h3_res_t* res, bool (*h)(uws_h3_res_t*, uint64_t, void*), void* opt)
{
    ((Http3Response*)res)->onWritable(opt, (Http3ResponseData::OnWritableCallback)h);
}
void uws_h3_res_clear_on_writable(uws_h3_res_t* res) { ((Http3Response*)res)->clearOnWritable(); }
void uws_h3_res_on_aborted(uws_h3_res_t* res, void (*h)(uws_h3_res_t*, void*), void* opt)
{
    if (h)
        ((Http3Response*)res)->onAborted(opt, (Http3ResponseData::OnAbortedCallback)h);
    else
        ((Http3Response*)res)->clearOnAborted();
}
void uws_h3_res_on_timeout(uws_h3_res_t* res, void (*h)(uws_h3_res_t*, void*), void* opt)
{
    if (h)
        ((Http3Response*)res)->onTimeout(opt, (Http3ResponseData::OnTimeoutCallback)h);
    else
        ((Http3Response*)res)->clearOnTimeout();
}
void uws_h3_res_on_data(uws_h3_res_t* res, void (*h)(uws_h3_res_t*, const char*, size_t, bool, void*), void* opt)
{
    ((Http3Response*)res)->onData(opt, (Http3ResponseData::OnDataCallback)h);
}

void uws_h3_res_cork(uws_h3_res_t* res, void* ctx, void (*corker)(void*))
{
    ((Http3Response*)res)->cork([ctx, corker]() { corker(ctx); });
}
void uws_h3_res_uncork(uws_h3_res_t*) {}
bool uws_h3_res_is_corked(uws_h3_res_t*) { return false; }

uint64_t uws_h3_res_get_remote_address_info(uws_h3_res_t* res, const char** dest, int* port, bool* is_ipv6)
{
    /* Mirror uws_res_get_remote_address_info: stringify with inet_ntop so the
     * Zig side gets a text slice, not raw in_addr bytes. */
    static thread_local char b[64];
    int len = 0, ipv6 = 0;
    us_quic_socket_t* qs = us_quic_stream_socket((us_quic_stream_t*)res);
    if (!qs) {
        *dest = b;
        *port = 0;
        *is_ipv6 = false;
        return 0;
    }
    us_quic_socket_remote_address(qs, b, &len, port, &ipv6);
    if (len == 0) {
        *dest = b;
        *is_ipv6 = false;
        return 0;
    }
    if (len == 4) {
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

bool uws_h3_req_is_ancient(uws_h3_req_t*) { return false; }
bool uws_h3_req_get_yield(uws_h3_req_t* req) { return ((Http3Request*)req)->getYield(); }
void uws_h3_req_set_yield(uws_h3_req_t* req, bool y) { ((Http3Request*)req)->setYield(y); }

/* Zig declares these as [*]const u8 (non-null many-pointer); a default-
 * constructed string_view has data() == nullptr, so normalise empties. */
static inline size_t ffi_sv(std::string_view v, const char** dest)
{
    *dest = v.empty() ? "" : v.data();
    return v.length();
}

size_t uws_h3_req_get_url(uws_h3_req_t* req, const char** dest)
{
    return ffi_sv(((Http3Request*)req)->getFullUrl(), dest);
}

size_t uws_h3_req_get_method(uws_h3_req_t* req, const char** dest)
{
    return ffi_sv(((Http3Request*)req)->getMethod(), dest);
}

size_t uws_h3_req_get_header(uws_h3_req_t* req, const char* lower, size_t lower_len, const char** dest)
{
    return ffi_sv(((Http3Request*)req)->getHeader(sv(lower, lower_len)), dest);
}

void uws_h3_req_for_each_header(uws_h3_req_t* req,
    void (*cb)(const char*, size_t, const char*, size_t, void*),
    void* user_data)
{
    ((Http3Request*)req)->forEachHeader([cb, user_data](std::string_view name, std::string_view value) {
        cb(name.empty() ? "" : name.data(), name.length(),
            value.empty() ? "" : value.data(), value.length(), user_data);
    });
}

size_t uws_h3_req_get_query(uws_h3_req_t* req, const char* key, size_t key_len, const char** dest)
{
    return ffi_sv(key ? ((Http3Request*)req)->getQuery(sv(key, key_len))
                      : ((Http3Request*)req)->getQuery(),
        dest);
}

size_t uws_h3_req_get_parameter(uws_h3_req_t* req, unsigned short index, const char** dest)
{
    return ffi_sv(((Http3Request*)req)->getParameter(index), dest);
}

/* ───── WebTransport ─────
 *
 * Mirrors uws_ws / uws_ws_* so the Zig AnyWebSocket union can carry an
 * .h3_wt arm with the same method shapes. Same uws_socket_behavior_t struct;
 * compression/idleTimeout/ping/pong fields are ignored (WT has no
 * permessage-deflate and QUIC owns keepalive). */

void uws_h3_ws(uws_h3_app_t* app, void* upgradeCtx, const char* pattern,
    size_t pattern_len, size_t id, const uws_socket_behavior_t* behavior_)
{
    uws_socket_behavior_t behavior = *behavior_;
    H3App::WebTransportBehavior b;
    b.maxPayloadLength = behavior.maxPayloadLength;
    b.maxBackpressure = behavior.maxBackpressure;
    b.closeOnBackpressureLimit = behavior.closeOnBackpressureLimit;
    if (behavior.upgrade)
        b.upgrade = [behavior, upgradeCtx, id](Http3Response* res, Http3Request* req) {
            behavior.upgrade(upgradeCtx, (uws_res_t*)res, (uws_req_t*)req,
                (uws_socket_context_t*)us_quic_stream_context((us_quic_stream_t*)res), id);
        };
    if (behavior.open)
        b.open = [behavior](WebTransportSession* ws) { behavior.open((uws_websocket_t*)ws); };
    if (behavior.message)
        b.message = [behavior](WebTransportSession* ws, std::string_view m, uWS::OpCode op) {
            behavior.message((uws_websocket_t*)ws, m.data(), m.length(), (uws_opcode_t)op);
        };
    if (behavior.drain)
        b.drain = [behavior](WebTransportSession* ws) { behavior.drain((uws_websocket_t*)ws); };
    if (behavior.close)
        b.close = [behavior](WebTransportSession* ws, int code, std::string_view m) {
            behavior.close((uws_websocket_t*)ws, code, m.data(), m.length());
        };
    ((H3App*)app)->wt(sv(pattern, pattern_len), std::move(b));
}

/* Accept the CONNECT and fire open. Mirrors uws_res_upgrade except there's
 * no Sec-WebSocket-* handshake — the 2xx HEADERS is the whole acceptance. */
void* uws_h3_res_upgrade(uws_h3_res_t* res, void* userData)
{
    Http3Response* r = (Http3Response*)res;
    WebTransportSession* ws = r->upgradeWebTransport(userData);
    if (!ws) return nullptr;
    auto* cd = ws->getContextData();
    if (cd->openHandler) cd->openHandler(ws);
    return ws;
}

void* uws_h3_wt_get_user_data(uws_websocket_t* ws)
{
    auto* d = ((WebTransportSession*)ws)->getSessionData();
    return d ? d->userData : nullptr;
}

void uws_h3_wt_close(uws_websocket_t* ws) { ((WebTransportSession*)ws)->close(); }

int uws_h3_wt_send(uws_websocket_t* ws, const char* msg, size_t len,
    uws_opcode_t op, bool /*compress*/, bool /*fin*/)
{
    return (int)((WebTransportSession*)ws)->send(sv(msg, len), (uWS::OpCode)op);
}

void uws_h3_wt_end(uws_websocket_t* ws, int code, const char* msg, size_t len)
{
    ((WebTransportSession*)ws)->end(code, sv(msg, len));
}

void uws_h3_wt_cork(uws_websocket_t* ws, void (*cb)(void*), void* user_data)
{
    ((WebTransportSession*)ws)->cork([cb, user_data]() { cb(user_data); });
}

bool uws_h3_wt_subscribe(uws_websocket_t* ws, const char* topic, size_t len)
{
    return ((WebTransportSession*)ws)->subscribe(sv(topic, len));
}
bool uws_h3_wt_unsubscribe(uws_websocket_t* ws, const char* topic, size_t len)
{
    return ((WebTransportSession*)ws)->unsubscribe(sv(topic, len));
}
bool uws_h3_wt_is_subscribed(uws_websocket_t* ws, const char* topic, size_t len)
{
    return ((WebTransportSession*)ws)->isSubscribed(sv(topic, len));
}
bool uws_h3_wt_publish(uws_websocket_t* ws, const char* topic, size_t topic_len,
    const char* msg, size_t msg_len, uws_opcode_t op, bool /*compress*/)
{
    return ((WebTransportSession*)ws)->publish(sv(topic, topic_len), sv(msg, msg_len), (uWS::OpCode)op);
}
bool uws_h3_publish(uws_h3_app_t* app, const char* topic, size_t topic_len,
    const char* msg, size_t msg_len, uws_opcode_t op, bool /*compress*/)
{
    return ((H3App*)app)->publish(sv(topic, topic_len), sv(msg, msg_len), (uWS::OpCode)op);
}

size_t uws_h3_wt_get_buffered_amount(uws_websocket_t* ws)
{
    return ((WebTransportSession*)ws)->getBufferedAmount();
}
size_t uws_h3_wt_memory_cost(uws_websocket_t* ws)
{
    return ((WebTransportSession*)ws)->memoryCost();
}

size_t uws_h3_wt_get_remote_address(uws_websocket_t* ws, const char** dest)
{
    static thread_local char b[64];
    int len = 0, port = 0, ipv6 = 0;
    us_quic_socket_t* qs = us_quic_stream_socket((us_quic_stream_t*)ws);
    if (!qs) {
        *dest = b;
        return 0;
    }
    us_quic_socket_remote_address(qs, b, &len, &port, &ipv6);
    *dest = b;
    return (size_t)len;
}

void uws_h3_wt_iterate_topics(uws_websocket_t* ws,
    void (*cb)(const char*, size_t, void*), void* user_data)
{
    ((WebTransportSession*)ws)->iterateTopics([cb, user_data](std::string_view t) {
        cb(t.data(), t.length(), user_data);
    });
}

} // extern "C"
