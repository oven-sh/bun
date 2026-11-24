// HTTP/3 C ABI.

// clang-format off
#include "_libusockets.h"
#include "quic.h"
#include <bun-usockets/src/internal/internal.h>

#include <bun-uws/src/Http3App.h>
#include <bun-uws/src/Http3Response.h>
#include <string_view>
// clang-format on

extern "C" size_t Bun__formatIpAddress(char (&buffer)[64], bool is_ipv6);

using uWS::H3App;
using uWS::Http3Response;
using uWS::Http3ResponseData;

static inline std::string_view sv(const char* p, size_t n) { return p ? std::string_view { p, n } : std::string_view {}; }

extern "C" {

// Same treatment as libuwsockets.cpp: every function below is a thin C-ABI
// wrapper around a uWS template method — force ThinLTO to inline the wrapper
// into its (Rust) callers.
#pragma clang attribute push(__attribute__((always_inline)), apply_to = function)

typedef struct uws_h3_app_s uws_h3_app_t;
typedef struct uws_h3_res_s uws_h3_res_t;

typedef void (*uws_h3_listen_handler)(us_quic_listen_socket_t*, void*);

/* ───── app ───── */

uws_h3_app_t* uws_h3_create_app(struct us_bun_socket_context_options_t options, unsigned int idle_timeout_s, const void* routes)
{
    return (uws_h3_app_t*)H3App::create(options, idle_timeout_s, routes);
}

void uws_h3_app_destroy(uws_h3_app_t* app) { delete (H3App*)app; }
void uws_h3_app_close(uws_h3_app_t* app) { ((H3App*)app)->close(); }
const void* uws_h3_app_routes(uws_h3_app_t* app) { return ((H3App*)app)->http3Context->getContextData()->routes; }

bool uws_h3_app_add_server_name(uws_h3_app_t* app, const char* hostname,
    struct us_bun_socket_context_options_t options)
{
    return ((H3App*)app)->addServerNameWithOptions(hostname, options);
}

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
    /* Mirror uws_res_get_remote_address_info: the caller gets text, not raw in_addr bytes. */
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
    *dest = b;
    *is_ipv6 = len != 4;
    return Bun__formatIpAddress(b, *is_ipv6);
}

#pragma clang attribute pop

} // extern "C"
