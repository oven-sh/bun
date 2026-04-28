#ifndef UWS_H3RESPONSEDATA_H
#define UWS_H3RESPONSEDATA_H

#include "AsyncSocketData.h"
#include "quic.h"

#include <wtf/Vector.h>
#include <cstdint>
#include <cstring>

namespace uWS {

struct Http3Response;
struct WebTransportSessionData;

struct Http3ResponseData {
    /* Same callback signatures as HttpResponseData so the C ABI matches. */
    using OnWritableCallback = bool (*)(Http3Response *, uint64_t, void *);
    using OnAbortedCallback = void (*)(Http3Response *, void *);
    using OnTimeoutCallback = void (*)(Http3Response *, void *);
    using OnDataCallback = void (*)(Http3Response *, const char *, size_t, bool, void *);

    /* Same bit values as HttpResponseData so uws_res_state() consumers
     * (Zig's State enum) work unchanged. */
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
    /* onWritable is owned by the body writer (HTTPServerWritable sink),
     * which is a different object than the RequestContext that owns
     * onAborted/onTimeout/onData. uWS HttpResponseData<SSL> shares one
     * userData and gets away with it because tryEnd() over a corked TCP
     * socket never reports backpressure for in-memory bodies; QUIC does
     * (lsquic needs a process_conns() between HEADERS and DATA), so the
     * sink and the request context are armed concurrently. */
    void *writableUserData = nullptr;
    void *socketData = nullptr;
    OnWritableCallback onWritable = nullptr;
    OnAbortedCallback onAborted = nullptr;
    OnDataCallback inStream = nullptr;
    OnTimeoutCallback onTimeout = nullptr;

    /* Outgoing headers buffered until the first body write/end so they go
     * out as one HEADERS frame. WTF::Vector's inline capacity keeps the
     * common case (status + content-type + content-length + date ≈ 100
     * bytes, ≤ 6 headers) entirely off the heap. hdrs stores byte offsets
     * (cast through name/value pointers) so hdrBuf can grow; resolved
     * against hdrBuf.data() once at send time. */
    WTF::Vector<char, 256> hdrBuf;
    WTF::Vector<us_quic_header_t, 16> hdrs;

    /* Body bytes the QUIC stream couldn't accept yet. */
    BackPressure backpressure;
    bool endAfterDrain = false;

    /* Set by Http3Response::upgradeWebTransport() once the CONNECT is
     * accepted; the stream then routes through WebTransportSession instead
     * of the HTTP body path. Heap-allocated so non-WT requests don't pay the
     * std::vector / std::string footprint. */
    WebTransportSessionData *wt = nullptr;

    uint64_t offset = 0;
    uint64_t totalSize = 0;
    uint8_t state = 0;

    void appendHeader(const char *name, unsigned nlen, const char *value, unsigned vlen) {
        size_t off = hdrBuf.size();
        hdrBuf.grow(off + nlen + vlen);
        char *dst = hdrBuf.mutableSpan().data() + off;
        for (unsigned i = 0; i < nlen; i++) {
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
        offset = 0;
        totalSize = 0;
        state = HTTP_RESPONSE_PENDING;
    }
};

}

#endif
