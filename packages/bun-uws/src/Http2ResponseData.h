#ifndef UWS_H2RESPONSEDATA_H
#define UWS_H2RESPONSEDATA_H

#include "AsyncSocketData.h"

#include <wtf/Vector.h>
#include <cstdint>
#include <cstring>

namespace uWS {

struct Http2Response;

/* One name/value pair for the outgoing header block. Same shape as
 * us_quic_header_t so the Zig side and the tests can reason about both
 * transports identically. */
struct Http2Header {
    const char *name;
    unsigned int name_len;
    const char *value;
    unsigned int value_len;
};

/* Per-stream response state. Same bit values and callback shapes as
 * HttpResponseData / Http3ResponseData so Zig's State enum and the
 * uws_res_* C ABI stay 1:1. Heap-allocated (one per stream, many per
 * connection). */
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
    /* See Http3ResponseData for why onWritable gets its own userData. */
    void *writableUserData = nullptr;
    void *socketData = nullptr;
    OnWritableCallback onWritable = nullptr;
    OnAbortedCallback onAborted = nullptr;
    OnDataCallback inStream = nullptr;
    OnTimeoutCallback onTimeout = nullptr;

    /* Outgoing headers buffered until the first body write/end so they go
     * out as one HEADERS frame. Inline capacity keeps typical responses
     * off the heap. Offsets stored as pointers (cast through uintptr_t)
     * so hdrBuf can realloc; resolved against hdrBuf.data() at send. */
    WTF::Vector<char, 256> hdrBuf;
    WTF::Vector<Http2Header, 16> hdrs;

    /* Body bytes the stream's send window (or TCP) couldn't accept yet. */
    BackPressure backpressure;
    bool endAfterDrain = false;
    bool remoteClosed = false;

    uint64_t offset = 0;
    uint64_t totalSize = 0;
    uint8_t state = 0;

    void appendHeader(const char *name, unsigned nlen, const char *value, unsigned vlen) {
        size_t off = hdrBuf.size();
        hdrBuf.grow(off + nlen + vlen);
        char *dst = hdrBuf.mutableSpan().data() + off;
        for (unsigned i = 0; i < nlen; i++) {
            /* RFC 9113 §8.2.1: field names MUST be lowercase. */
            char c = name[i];
            dst[i] = (char)(c | ((unsigned char)(c - 'A') < 26 ? 0x20 : 0));
        }
        memcpy(dst + nlen, value, vlen);
        hdrs.append({(const char *)(uintptr_t) off, nlen,
                     (const char *)(uintptr_t)(off + nlen), vlen});
    }

    void reset() {
        userData = nullptr;
        writableUserData = nullptr;
        onWritable = nullptr;
        onAborted = nullptr;
        inStream = nullptr;
        onTimeout = nullptr;
        hdrBuf.shrink(0);
        hdrs.shrink(0);
        backpressure.clear();
        endAfterDrain = false;
        remoteClosed = false;
        offset = 0;
        totalSize = 0;
        state = HTTP_RESPONSE_PENDING;
    }
};

}

#endif
