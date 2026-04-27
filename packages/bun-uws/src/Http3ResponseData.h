#ifndef UWS_H3RESPONSEDATA_H
#define UWS_H3RESPONSEDATA_H

#include "AsyncSocketData.h"

#include <cstdint>
#include <string>
#include <vector>

namespace uWS {

struct Http3Response;

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
     * out as one HEADERS frame. names/values point into headerBuf. */
    std::string headerBuf;
    std::vector<std::pair<unsigned, unsigned>> headerNames;  /* offset, len */
    std::vector<std::pair<unsigned, unsigned>> headerValues; /* offset, len */

    /* Body bytes the QUIC stream couldn't accept yet. */
    BackPressure backpressure;
    bool endAfterDrain = false;

    uint64_t offset = 0;
    uint64_t totalSize = 0;
    uint8_t state = 0;

    void reset() {
        userData = nullptr;
        writableUserData = nullptr;
        onWritable = nullptr;
        onAborted = nullptr;
        inStream = nullptr;
        onTimeout = nullptr;
        headerBuf.clear();
        headerNames.clear();
        headerValues.clear();
        backpressure.clear();
        endAfterDrain = false;
        offset = 0;
        totalSize = 0;
        state = HTTP_RESPONSE_PENDING;
    }
};

}

#endif
