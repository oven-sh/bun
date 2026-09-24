// HTTP/3 C ABI. Mirrors the uws_* surface in libuwsockets.cpp 1:1
// (same parameter shapes, same callback signatures) so the caller can
// pattern-match NewApp/NewResponse without protocol-specific branches.
// Kept in its own TU so HTTP/1.1 and HTTP/3 stay file-level separable.

// clang-format off
#include "_libusockets.h"
#include "quic.h"
#include "StreamWebSocketParser.h"

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

static inline std::string_view sv(const char* p, size_t n) { return p ? std::string_view { p, n } : std::string_view {}; }

struct H3WebSocketTransport {
    using Response = Http3Response;

    static bool isWritable(Response* r) { return r->isTunnelWritable(); }
    static size_t bufferedAmount(Response* r) { return r->getBufferedAmount(); }
    static size_t backpressureMemory(Response* r) { return r->getHttpResponseData()->backpressure.totalLength(); }
    /* lsquic frames every write into DATA itself, and write_avail does not
     * reserve the next DATA header: count at most one per write (the split
     * path writes the header and payload separately). */
    static size_t frameBudget(size_t frameLength, size_t payloadLength)
    {
        constexpr size_t MAX_DATA_FRAME_HEADER = 9;
        return frameLength + (payloadLength >= 16 * 1024 ? 2 : 1) * MAX_DATA_FRAME_HEADER;
    }
    static bool canWriteWithinBackpressure(Response* r, size_t budget, size_t maxBackpressure)
    {
        return r->canWriteWithinBackpressure(budget, maxBackpressure);
    }
    static bool write(Response* r, std::string_view data) { return r->write(data); }
    /* A QUIC write may accept part of a buffer, so a separate header and
     * payload cannot be all-or-nothing; send() then copies the frame. */
    static bool tryWriteFrame(Response*, std::string_view, std::string_view) { return false; }
    static void cancel(Response* r) { r->cancel(); }
    static void writeHeader(Response* r, std::string_view name, std::string_view value) { r->writeHeader(name, value); }
    static uWS::Http3ContextData* contextData(Response* r)
    {
        return (uWS::Http3ContextData*)us_quic_socket_context_ext(us_quic_stream_context((us_quic_stream_t*)r));
    }
    static uWS::StreamTopicTree* topics(Response* r) { return contextData(r)->topicTree; }
    /* The context drains its tree from the Loop pre/post handlers. */
    static void scheduleTopicDrain(Response*) {}
    static uWS::LoopData* loopData(Response* r)
    {
        return (uWS::LoopData*)us_loop_ext((us_loop_t*)us_quic_socket_context_loop(us_quic_stream_context((us_quic_stream_t*)r)));
    }
};

using H3WebSocketParser = Bun::StreamWebSocketParser<H3WebSocketTransport>;

extern "C" {

// Same treatment as libuwsockets.cpp: every function below is a thin C-ABI
// wrapper around a uWS template method — force ThinLTO to inline the wrapper
// into its (Rust) callers.
#pragma clang attribute push(__attribute__((always_inline)), apply_to = function)

typedef struct uws_h3_app_s uws_h3_app_t;
typedef struct uws_h3_res_s uws_h3_res_t;
typedef struct uws_h3_req_s uws_h3_req_t;

typedef struct uws_h3_ws_parser_s uws_h3_ws_parser_t;

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
void uws_h3_app_close(uws_h3_app_t* app) { ((H3App*)app)->close(); }
void uws_h3_app_clear_routes(uws_h3_app_t* app) { ((H3App*)app)->clearRoutes(); }
uint32_t uws_h3_app_publish(uws_h3_app_t* app, const char* topic, size_t topic_length,
    const char* data, size_t data_length, int op_code, bool compress)
{
    return app ? ((H3App*)app)->publish(sv(topic, topic_length), sv(data, data_length), op_code, compress) : 2;
}
unsigned int uws_h3_app_num_subscribers(uws_h3_app_t* app, const char* topic, size_t topic_length)
{
    return app ? ((H3App*)app)->numSubscribers(sv(topic, topic_length)) : 0;
}

/* ───── RFC 9220 WebSocket ───── */

uws_h3_ws_parser_t* uws_h3_ws_parser_create(uws_h3_res_t* response, size_t max_payload_length,
    size_t max_backpressure, bool close_on_backpressure_limit, uint16_t compression,
    const char* extension_offer, size_t extension_offer_length, void* user,
    bool (*fragment_handler)(void*, const char*, size_t, unsigned int, int, bool),
    void (*fail_handler)(void*, int))
{
    if (!response || !fragment_handler || !fail_handler) return nullptr;
    H3WebSocketParser* parser = new H3WebSocketParser((Http3Response*)response, max_payload_length, max_backpressure,
        close_on_backpressure_limit, user, fragment_handler, fail_handler);
    parser->negotiateCompression(compression, sv(extension_offer, extension_offer_length));
    if (!((Http3Response*)response)->upgradeToWebSocket()) {
        delete parser;
        return nullptr;
    }
    return (uws_h3_ws_parser_t*)parser;
}

void uws_h3_ws_parser_consume(uws_h3_ws_parser_t* parser, const char* data, size_t length)
{
    if (parser) ((H3WebSocketParser*)parser)->consume(data, length);
}

void uws_h3_ws_parser_destroy(uws_h3_ws_parser_t* parser)
{
    delete (H3WebSocketParser*)parser;
}

uint32_t uws_h3_ws_send(uws_h3_ws_parser_t* parser, const char* data, size_t length,
    int op_code, bool compress, bool fin, size_t max_backpressure, bool* limit_exceeded)
{
    if (!parser || !limit_exceeded) return 2;
    return ((H3WebSocketParser*)parser)->send(data, length, op_code, compress, fin, max_backpressure, limit_exceeded);
}

size_t uws_h3_ws_parser_memory_cost(uws_h3_ws_parser_t* parser)
{
    return parser ? ((H3WebSocketParser*)parser)->memoryCost() : 0;
}

bool uws_h3_ws_subscribe(uws_h3_ws_parser_t* parser, const char* topic, size_t length)
{
    return parser && ((H3WebSocketParser*)parser)->subscribe(sv(topic, length));
}

bool uws_h3_ws_unsubscribe(uws_h3_ws_parser_t* parser, const char* topic, size_t length)
{
    return parser && ((H3WebSocketParser*)parser)->unsubscribe(sv(topic, length));
}

bool uws_h3_ws_is_subscribed(uws_h3_ws_parser_t* parser, const char* topic, size_t length)
{
    return parser && ((H3WebSocketParser*)parser)->isSubscribed(sv(topic, length));
}

uint32_t uws_h3_ws_publish(uws_h3_ws_parser_t* parser, const char* topic, size_t topic_length,
    const char* data, size_t data_length, int op_code, bool compress)
{
    return parser ? ((H3WebSocketParser*)parser)->publish(sv(topic, topic_length), sv(data, data_length), op_code, compress) : 2;
}

void uws_h3_ws_get_topics(uws_h3_ws_parser_t* parser, void (*callback)(void*, const char*, size_t), void* user)
{
    if (!parser || !callback) return;
    ((H3WebSocketParser*)parser)->iterateTopics([&](std::string_view topic) { callback(user, topic.data(), topic.size()); });
}

void uws_h3_ws_unsubscribe_all(uws_h3_ws_parser_t* parser)
{
    if (parser) ((H3WebSocketParser*)parser)->unsubscribeAll();
}

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

void uws_h3_res_mark_wrote_date_header(uws_h3_res_t* res)
{
    ((Http3Response*)res)->getHttpResponseData()->state |= Http3ResponseData::HTTP_WROTE_DATE_HEADER;
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

bool uws_h3_res_has_responded(uws_h3_res_t* res) { return ((Http3Response*)res)->hasResponded(); }
size_t uws_h3_res_get_buffered_amount(uws_h3_res_t* res) { return ((Http3Response*)res)->getBufferedAmount(); }

bool uws_h3_res_request_body_ended(uws_h3_res_t* res) { return ((Http3Response*)res)->requestBodyEnded(); }
bool uws_h3_res_is_websocket_connect(uws_h3_res_t* res) { return ((Http3Response*)res)->isWebSocketConnectRequest(); }
void uws_h3_res_cancel(uws_h3_res_t* res) { ((Http3Response*)res)->cancel(); }
void uws_h3_res_websocket_timeout(uws_h3_res_t* res, uint16_t seconds) { ((Http3Response*)res)->setWebSocketTimeout(seconds); }
void uws_h3_res_websocket_timeout_config(uws_h3_res_t* res, uint16_t seconds, bool refresh_on_write)
{
    auto* response = (Http3Response*)res;
    response->setWebSocketTimeoutRefreshOnWrite(refresh_on_write);
    response->setWebSocketTimeout(seconds);
}
void uws_h3_res_websocket_timeout_refresh_on_write(uws_h3_res_t* res, bool enabled)
{
    ((Http3Response*)res)->setWebSocketTimeoutRefreshOnWrite(enabled);
}

void uws_h3_res_reset_timeout(uws_h3_res_t*) {}
void uws_h3_res_timeout(uws_h3_res_t*, uint8_t) {}
void uws_h3_res_end_sendfile(uws_h3_res_t* res, uint64_t, bool close)
{
    /* sendfile path falls back to plain end-of-stream over QUIC. */
    ((Http3Response*)res)->sendTerminatingChunk(close);
}

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

uint64_t uws_h3_res_get_remote_address_info(uws_h3_res_t* res, const char** dest, int* port, bool* is_ipv6)
{
    /* Mirror uws_res_get_remote_address_info: stringify with inet_ntop so the
     * caller gets a text slice, not raw in_addr bytes. */
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

void uws_h3_req_set_yield(uws_h3_req_t* req, bool y) { ((Http3Request*)req)->setYield(y); }

/* The FFI contract requires a non-null pointer; a default-
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

#pragma clang attribute pop

} // extern "C"
