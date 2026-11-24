#ifndef UWS_H2RESPONSE_H
#define UWS_H2RESPONSE_H

// clang-format off

/* What C++ sees of src/uws_sys/h2.rs. */

#include <cstddef>
#include <cstdint>
#include <string_view>

namespace uWS {

struct Http2Response;

/* State in src/http2/server/stream.rs. */
struct Http2ResponseData {
    enum : uint8_t {
        HTTP_WROTE_CONTENT_LENGTH_HEADER = 32,
        HTTP_WROTE_DATE_HEADER = 64,
    };

    uint8_t state;
};

extern "C" void uws_h2_res_write_header(Http2Response *, const char *key, size_t keyLength, const char *value, size_t valueLength);
extern "C" void uws_h2_res_write_mark(Http2Response *);
extern "C" Http2ResponseData *uws_h2_res_state(Http2Response *);

struct Http2Response {
    void writeHeader(std::string_view key, std::string_view value) { uws_h2_res_write_header(this, key.data(), key.size(), value.data(), value.size()); }
    void writeMark() { uws_h2_res_write_mark(this); }
    Http2ResponseData *getHttpResponseData() { return uws_h2_res_state(this); }
};

}

#endif
