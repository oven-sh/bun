#ifndef UWS_H2RESPONSEDATA_H
#define UWS_H2RESPONSEDATA_H

#include "AsyncSocketData.h"

#include <wtf/Vector.h>
#include <cstdint>
#include <cstring>

namespace uWS {

struct Http2Response;

/* Per-stream response state. Same shape and bit values as
 * Http3ResponseData / HttpResponseData so the C ABI and uws_res_state()
 * consumers are transport-agnostic. */
struct Http2ResponseData {
    using OnWritableCallback = bool (*)(Http2Response *, uint64_t, void *);
    using OnAbortedCallback = void (*)(Http2Response *, void *);
    using OnTimeoutCallback = void (*)(Http2Response *, void *);
    using OnDataCallback = void (*)(Http2Response *, const char *, size_t, bool, void *);

    enum : uint8_t {
        HTTP_STATUS_CALLED = 1,
        HTTP_WRITE_CALLED = 2,
        HTTP_END_CALLED = 4,
        HTTP_RESPONSE_PENDING = 8,
        HTTP_CONNECTION_CLOSE = 16,
        HTTP_WROTE_CONTENT_LENGTH_HEADER = 32,
        HTTP_WROTE_DATE_HEADER = 64,
    };

    void *userData = nullptr;
    /* See Http3ResponseData: the body writer (sink) and the RequestContext arm
     * onWritable and onAborted/onData concurrently with different owners. */
    void *writableUserData = nullptr;
    void *socketData = nullptr;
    OnWritableCallback onWritable = nullptr;
    OnAbortedCallback onAborted = nullptr;
    OnDataCallback inStream = nullptr;
    OnTimeoutCallback onTimeout = nullptr;

    struct HeaderRef {
        uint32_t nameOff, nameLen, valueOff, valueLen;
    };
    /* Outgoing headers buffered until the first body write/end so they go
     * out as one HEADERS frame. Names are lowercased on append (RFC 9113
     * §8.2.1). */
    WTF::Vector<char, 256> hdrBuf;
    WTF::Vector<HeaderRef, 16> hdrs;

    /* Body bytes the stream/connection window or socket couldn't take yet. */
    BackPressure backpressure;
    bool endAfterDrain = false;

    uint64_t offset = 0;
    uint64_t totalSize = 0;
    uint8_t state = HTTP_RESPONSE_PENDING;

    void appendHeader(const char *name, unsigned nlen, const char *value, unsigned vlen) {
        size_t off = hdrBuf.size();
        hdrBuf.grow(off + nlen + vlen);
        char *dst = hdrBuf.mutableSpan().data() + off;
        for (unsigned i = 0; i < nlen; i++) {
            char c = name[i];
            dst[i] = (char)(c | ((unsigned char)(c - 'A') < 26 ? 0x20 : 0));
        }
        memcpy(dst + nlen, value, vlen);
        hdrs.append({(uint32_t) off, nlen, (uint32_t)(off + nlen), vlen});
    }
};

}

#endif
