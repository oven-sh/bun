#pragma once
// clang-format off

/* What C++ sees of src/uws_sys/http1. */

#include "libusockets.h"

#include <cstddef>
#include <cstdint>
#include <string_view>

namespace uWS {

/* The start of Connection. */
struct HttpResponseData {
    /* State in src/uws_sys/Response.rs. */
    enum : uint32_t {
        HTTP_STATUS_CALLED = 1,
        HTTP_WRITE_CALLED = 2,
        HTTP_END_CALLED = 4,
        HTTP_CONNECTION_CLOSE = 16,
        HTTP_WROTE_CONTENT_LENGTH_HEADER = 32,
        HTTP_WROTE_DATE_HEADER = 64,
        HTTP_WROTE_TRANSFER_ENCODING_HEADER = 128,
        HTTP_ANCIENT_REQUEST = 1 << 8,
        HTTP_NO_BODY_STATUS = 1 << 9,
        HTTP_CLOSE_DELIMITED = 1 << 10,
        HTTP_NODE_PIPELINED_DISPATCH = 1 << 11,
        HTTP_NODE_HAS_RESPONSE_TRAILERS = 1 << 16,
    };

    /* A WebSocket keeps it. */
    void *socketData;
    unsigned char unsent[40];
    uint32_t state;
};
static_assert(offsetof(HttpResponseData, state) == 48);

struct HttpResponse;

extern "C" void uws_res_write_raw(HttpResponse *, const char *data, size_t length);
extern "C" void uws_res_write_status(HttpResponse *, const char *status, size_t length);
extern "C" void uws_res_write_header(HttpResponse *, const char *key, size_t keyLength, const char *value, size_t valueLength);
extern "C" void uws_res_write_mark(HttpResponse *);
extern "C" void uws_res_cork_unless_buffered(HttpResponse *);
extern "C" char *uws_res_reserve_in_cork(HttpResponse *, size_t length);

struct HttpResponse {
    HttpResponseData *getHttpResponseData() { return (HttpResponseData *) us_socket_ext((us_socket_t *) this); }
    void writeRaw(std::string_view data) { uws_res_write_raw(this, data.data(), data.size()); }
    void writeStatus(std::string_view status) { uws_res_write_status(this, status.data(), status.size()); }
    void writeHeader(std::string_view key, std::string_view value) { uws_res_write_header(this, key.data(), key.size(), value.data(), value.size()); }
    void writeMark() { uws_res_write_mark(this); }
    void corkUnlessBuffered() { uws_res_cork_unless_buffered(this); }
    /* The caller fills them before it uses a socket. Null if they cannot be corked. */
    char *reserveInCorkBuffer(size_t length) { return uws_res_reserve_in_cork(this, length); }
};

}
