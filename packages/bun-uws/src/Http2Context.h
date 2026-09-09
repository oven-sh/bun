#ifndef UWS_H2CONTEXT_H
#define UWS_H2CONTEXT_H

// clang-format off

/* HTTP/2 (RFC 9113) server transport for Bun.serve.
 *
 * Connections arrive here from HttpContext<SSL> once ALPN selected "h2" (or a
 * cleartext client sent the prior-knowledge preface); the us_socket_t is
 * adopted into this context's group in place and its ext block repointed at a
 * heap Http2Connection. Each request stream is an Http2Response, which
 * exposes the same method surface as HttpResponse<SSL> / Http3Response so the
 * layers above stay transport-agnostic. HPACK is ls-hpack.
 *
 * Lifetime rule: an Http2Response* handed to a route handler stays valid
 * until its onAborted fires. Streams retire (both directions closed or reset)
 * into a per-connection pendingFree list and are only deleted from
 * loop-driven frames — socket event epilogues and the embedder's deferred
 * drain pass (scheduleDrain -> drain()) — never from inside an API call, so a
 * caller's own pointer can't die under it. */

#include "libusockets.h"
#include "bun-usockets/src/internal/internal.h"
#include "Loop.h"
#include "HttpRouter.h"
#include "HttpContextData.h"
#include "HttpParser.h"
#include "Utilities.h"
#include "HttpResponse.h"
#include "SocketKinds.h"
#include "Http2ResponseData.h"
#include "Http3Request.h"

#include <lshpack.h>

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <limits>
#include <optional>
#include <string_view>
#include <vector>

namespace uWS {

using Http2Request = Http3Request;

namespace http2 {


enum FrameType : uint8_t {
    DATA = 0, HEADERS = 1, PRIORITY = 2, RST_STREAM = 3, SETTINGS = 4,
    PUSH_PROMISE = 5, PING = 6, GOAWAY = 7, WINDOW_UPDATE = 8, CONTINUATION = 9,
};

enum Flag : uint8_t {
    END_STREAM = 0x1, ACK = 0x1, END_HEADERS = 0x4, PADDED = 0x8, PRIORITY_FLAG = 0x20,
};

enum ErrorCode : uint32_t {
    ERR_NO_ERROR = 0, ERR_PROTOCOL_ERROR = 1, ERR_INTERNAL_ERROR = 2, ERR_FLOW_CONTROL_ERROR = 3,
    ERR_SETTINGS_TIMEOUT = 4, ERR_STREAM_CLOSED = 5, ERR_FRAME_SIZE_ERROR = 6, ERR_REFUSED_STREAM = 7,
    ERR_CANCEL = 8, ERR_COMPRESSION_ERROR = 9, ERR_CONNECT_ERROR = 10, ERR_ENHANCE_YOUR_CALM = 11,
    ERR_INADEQUATE_SECURITY = 12, ERR_HTTP_1_1_REQUIRED = 13,
};

enum SettingId : uint16_t {
    SETTINGS_HEADER_TABLE_SIZE = 1, SETTINGS_ENABLE_PUSH = 2, SETTINGS_MAX_CONCURRENT_STREAMS = 3,
    SETTINGS_INITIAL_WINDOW_SIZE = 4, SETTINGS_MAX_FRAME_SIZE = 5, SETTINGS_MAX_HEADER_LIST_SIZE = 6,
};

static constexpr uint32_t FRAME_HEADER_SIZE = 9;
static constexpr int32_t DEFAULT_WINDOW_SIZE = 65535;
static constexpr int64_t MAX_WINDOW_SIZE = 0x7fffffff;
static constexpr uint32_t DEFAULT_HEADER_TABLE_SIZE = 4096;
/* What we accept per frame. Kept at the protocol minimum so a full frame
 * always fits the per-connection reassembly buffer cheaply. */
static constexpr uint32_t LOCAL_MAX_FRAME_SIZE = 16384;
/* Per-stream and per-connection receive windows we advertise. Request
 * bodies are handed to the application as they arrive (and it can pause a
 * stream), so these bound how far a peer can run ahead of the reader. */
/* Advertised per-stream window before the handler asks for the body; grown
 * to LOCAL_STREAM_WINDOW_SIZE by growReceiveWindow() once it does, so peers
 * multiplexing many uploads can't park a full body per stream up front. */
static constexpr uint32_t LOCAL_INITIAL_WINDOW_SIZE = 64 * 1024;
static constexpr uint32_t LOCAL_STREAM_WINDOW_SIZE = 1u << 20;
static constexpr uint32_t LOCAL_CONNECTION_WINDOW_SIZE = 1u << 24;
static constexpr uint32_t LOCAL_MAX_CONCURRENT_STREAMS = 256;
/* Same cap as the HTTP/1 parser (UWS_HTTP_MAX_HEADERS_COUNT). */
static constexpr size_t MAX_HEADER_FIELDS = 200;
static constexpr unsigned MAX_SETTINGS_PER_FRAME = 32;
/* A header block may span this many CONTINUATION frames (the byte cap alone
 * doesn't bound a flood of empty ones). */
static constexpr unsigned MAX_CONTINUATION_FRAMES = 32;
/* A header block (HEADERS + CONTINUATIONs, and its decoded form) may be at
 * most this multiple of SETTINGS_MAX_HEADER_LIST_SIZE before the connection
 * is closed rather than the stream answered 431. */
static constexpr unsigned HEADER_BLOCK_HARD_CAP_FACTOR = 2;
static constexpr uint32_t DEFAULT_MAX_HEADER_LIST_SIZE = 64 * 1024;
/* Stop generating DATA frames once this much is queued on the socket; the
 * remainder waits for on_writable like an HttpResponse<SSL> would. */
static constexpr size_t SOCKET_BACKPRESSURE_HIGH_WATER = 256 * 1024;
/* A peer that keeps sending frames we must answer (PING, SETTINGS, frames on
 * closed streams) while never reading lets `out` grow past what DATA
 * throttling allows; beyond this it is flooding (CVE-2019-9512/9515 class). */
/* Control frames the peer made us queue (PING/SETTINGS ACKs, RST_STREAM and
 * WINDOW_UPDATE for its frames) that it hasn't read; our own responses don't
 * count — those are bounded by SOCKET_BACKPRESSURE_HIGH_WATER per drain. */
static constexpr size_t MAX_QUEUED_CONTROL = 1u << 20;
/* RST_STREAM token bucket (CVE-2023-44487 class): burst, refill per second. */
static constexpr double RESET_BURST = 1000;
static constexpr double RESET_REFILL_PER_SEC = 33;

static constexpr char CLIENT_PREFACE[] = "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";
static constexpr uint32_t CLIENT_PREFACE_LEN = 24;

static inline void writeFrameHeader(char *p, uint32_t length, uint8_t type, uint8_t flags, uint32_t streamId) {
    p[0] = (char)(length >> 16);
    p[1] = (char)(length >> 8);
    p[2] = (char) length;
    p[3] = (char) type;
    p[4] = (char) flags;
    p[5] = (char)((streamId >> 24) & 0x7f);
    p[6] = (char)(streamId >> 16);
    p[7] = (char)(streamId >> 8);
    p[8] = (char) streamId;
}

static inline uint32_t readU32BE(const unsigned char *p) {
    return ((uint32_t) p[0] << 24) | ((uint32_t) p[1] << 16) | ((uint32_t) p[2] << 8) | (uint32_t) p[3];
}

static inline void writeU32BE(char *p, uint32_t v) {
    p[0] = (char)(v >> 24); p[1] = (char)(v >> 16); p[2] = (char)(v >> 8); p[3] = (char) v;
}

static inline unsigned char *hpackEncodeInteger(unsigned char *dst, uint8_t prefixPattern, unsigned prefixBits, uint32_t value) {
    uint32_t maxPrefix = (1u << prefixBits) - 1;
    if (value < maxPrefix) {
        *dst++ = (unsigned char)(prefixPattern | value);
        return dst;
    }
    *dst++ = (unsigned char)(prefixPattern | maxPrefix);
    value -= maxPrefix;
    while (value >= 128) {
        *dst++ = (unsigned char)((value & 0x7f) | 0x80);
        value >>= 7;
    }
    *dst++ = (unsigned char) value;
    return dst;
}

/* RFC 9113 §8.2.1 field validity, beyond what HPACK decoding guarantees: a
 * name is an RFC 9110 token with no uppercase letter, optionally behind the
 * single ':' of a pseudo-header. The token set is the one the HTTP/1 parser
 * (isFieldNameByte) and the HTTP/3 header-set interface accept. */
static inline bool validFieldName(const char *p, unsigned n) {
    unsigned i = n && p[0] == ':';
    if (i == n) return false;
    for (; i < n; i++) {
        unsigned char c = (unsigned char) p[i];
        if (!isTokenByte(c) || (c >= 'A' && c <= 'Z')) return false;
    }
    return true;
}

/* The methods Bun.serve can represent: the HTTP/1 parser's strict set, in
 * their RFC 9110 case-sensitive wire form. */
static inline bool isKnownMethod(std::string_view method) {
    for (unsigned char c : method) if (!((c >= 'A' && c <= 'Z') || c == '-')) return false;
    return Bun__HTTPMethod__from(method.data(), method.size()) != -1;
}

/* The request fields validation cares about. lshpack reports the HPACK
 * static-table index when the peer used one for the name (nearly always);
 * literal names fall back to a compare. */
enum class Field : uint8_t { Other, Method, Scheme, Path, Authority, Host, ContentLength, Te, Expect, ConnectionSpecific };
static inline Field classify(int hpackIndex, std::string_view name) {
    switch (hpackIndex) {
    case LSHPACK_HDR_AUTHORITY: return Field::Authority;
    case LSHPACK_HDR_METHOD_GET: case LSHPACK_HDR_METHOD_POST: return Field::Method;
    case LSHPACK_HDR_PATH: case LSHPACK_HDR_PATH_INDEX_HTML: return Field::Path;
    case LSHPACK_HDR_SCHEME_HTTP: case LSHPACK_HDR_SCHEME_HTTPS: return Field::Scheme;
    case LSHPACK_HDR_HOST: return Field::Host;
    case LSHPACK_HDR_CONTENT_LENGTH: return Field::ContentLength;
    case LSHPACK_HDR_EXPECT: return Field::Expect;
    case LSHPACK_HDR_TRANSFER_ENCODING: return Field::ConnectionSpecific;
    case LSHPACK_HDR_UNKNOWN: break;
    default: return Field::Other;
    }
    switch (name.size()) {
    case 2: if (name == "te") return Field::Te; break;
    case 4: if (name == "host") return Field::Host; break;
    case 5: if (name == ":path") return Field::Path; break;
    case 6: if (name == "expect") return Field::Expect; break;
    case 7: if (name == ":method") return Field::Method; if (name == ":scheme") return Field::Scheme; if (name == "upgrade") return Field::ConnectionSpecific; break;
    case 10: if (name == ":authority") return Field::Authority; if (name == "connection") return Field::ConnectionSpecific; if (name == "keep-alive") return Field::ConnectionSpecific; break;
    case 14: if (name == "content-length") return Field::ContentLength; break;
    case 16: if (name == "proxy-connection") return Field::ConnectionSpecific; break;
    case 17: if (name == "transfer-encoding") return Field::ConnectionSpecific; break;
    }
    return Field::Other;
}

/* RFC 9113 §8.2.1: field-content (RFC 9110 §5.5) with no leading or trailing
 * whitespace. HTAB is the only control byte allowed; DEL and obs-text pass,
 * as they do through the HTTP/1 parser. */
static inline bool validFieldValue(const char *p, unsigned n) {
    if (n && (p[0] == ' ' || p[0] == '\t' || p[n - 1] == ' ' || p[n - 1] == '\t')) return false;
    for (unsigned i = 0; i < n; i++) {
        unsigned char c = (unsigned char) p[i];
        if (c < 0x20 && c != '\t') return false;
    }
    return true;
}

}

struct Http2Connection;
struct Http2Context;

/* One request/response stream. */
struct Http2Response {
    Http2Connection *conn;
    uint32_t id;
    int32_t sendWindow;
    /* DATA bytes consumed on this stream not yet returned via WINDOW_UPDATE. */
    uint32_t unackedReceive = 0;
    uint32_t receiveWindow = http2::LOCAL_INITIAL_WINDOW_SIZE;
    bool wide = false;
    int64_t declaredContentLength = -1;
    uint64_t receivedBodyBytes = 0;

    /* END_STREAM received / sent. A reset (either direction) closes both. */
    bool remoteClosed = false;
    bool localClosed = false;
    bool reset = false;
    /* inStream has been given its fin=true call. */
    bool finDelivered = false;
    bool paused = false;
    /* Linked in conn->writable. */
    bool wantsWrite = false;
    /* setTimeout(): this stream's idle budget in seconds; 0 = never time
     * out, 255 = use the context default. The connection applies the most
     * permissive value among its open streams. */
    uint8_t timeoutS = 255;
    uint8_t pausedTimeoutS = 255;
    /* Retired: out of conn->streams, waiting in pendingFree for deletion. */
    bool dead = false;

    Http2ResponseData data;

    Http2Response(Http2Connection *c, uint32_t streamId, int32_t window) : conn(c), id(streamId), sendWindow(window) {}

    Http2ResponseData *getHttpResponseData() { return &data; }

    /* ── HttpResponse<SSL>-shaped surface ─────────────────────────────── */

    Http2Response *writeStatus(std::string_view status) {
        if (data.state & Http2ResponseData::HTTP_STATUS_CALLED) return this;
        data.state |= Http2ResponseData::HTTP_STATUS_CALLED;
        std::string_view code = status.size() >= 3 ? status.substr(0, 3) : std::string_view{"200"};
        data.appendHeader(":status", 7, code.data(), (unsigned) code.size());
        return this;
    }

    Http2Response *writeHeader(std::string_view key, std::string_view value) {
        writeStatus("200");
        /* §8.2.2: connection-specific fields must not appear in an HTTP/2 message. */
        if (isConnectionSpecificResponseField(key, value)) return this;
        data.appendHeader(key.data(), (unsigned) key.size(), value.data(), (unsigned) value.size());
        return this;
    }

    Http2Response *writeHeader(std::string_view key, uint64_t value) {
        char buf[utils::U64_MAX_DIGITS];
        auto r = std::to_chars(buf, buf + sizeof(buf), value);
        return writeHeader(key, std::string_view{buf, (size_t)(r.ptr - buf)});
    }

    inline void writeMark();
    inline Http2Response *writeContinue();
    inline void flushHeaders(bool immediately = false);
    inline bool write(std::string_view chunk, size_t *writtenPtr = nullptr);
    void end(std::string_view body = {}, bool closeConnection = false) {
        internalEnd(body, body.length(), false, closeConnection);
    }
    std::pair<bool, bool> tryEnd(std::string_view body, uint64_t total = 0, bool closeConnection = false) {
        bool ok = internalEnd(body, total, true, closeConnection);
        return {ok, ok || hasResponded()};
    }
    inline void endWithoutBody(std::optional<size_t> reportedContentLength = std::nullopt, bool closeConnection = false);
    inline bool sendTerminatingChunk(bool closeConnection = false);

    bool hasResponded() { return !(data.state & Http2ResponseData::HTTP_RESPONSE_PENDING); }
    uint64_t getWriteOffset() { return data.offset; }
    void overrideWriteOffset(uint64_t o) { data.offset = o; }
    size_t getBufferedAmount() { return data.backpressure.length(); }

    inline Http2Response *pause();
    inline Http2Response *resume();
    /* The handler started consuming the body: widen this stream's window. */
    inline void growReceiveWindow();
    inline Http2Response *cork(MoveOnlyFunction<void()> &&fn);
    void uncork() {}
    bool isCorked() { return false; }
    /* RST_STREAM: the transport-level equivalent of dropping an
     * HTTP/1 socket mid-response. */
    /* RST_STREAM (unless already closed both ways) and retire. */
    inline void close(http2::ErrorCode code = http2::ERR_CANCEL);
    void *getNativeHandle() { return this; }
    void *getSocketData() { return data.socketData; }
    bool isConnectRequest() { return false; }
    inline void setTimeout(uint8_t seconds);
    inline void resetTimeout();
    void prepareForSendfile() {}

    Http2Response *onWritable(void *userData, Http2ResponseData::OnWritableCallback h) {
        data.writableUserData = userData; data.onWritable = h; return this;
    }
    Http2Response *clearOnWritable() { data.onWritable = nullptr; data.writableUserData = nullptr; return this; }
    Http2Response *onAborted(void *userData, Http2ResponseData::OnAbortedCallback h) {
        data.userData = userData; data.onAborted = h; return this;
    }
    Http2Response *clearOnAborted() { data.onAborted = nullptr; return this; }
    Http2Response *onTimeout(void *userData, Http2ResponseData::OnTimeoutCallback h) {
        data.onTimeout = h; if (h) data.userData = userData; return this;
    }
    Http2Response *clearOnTimeout() { data.onTimeout = nullptr; return this; }
    void onData(void *userData, Http2ResponseData::OnDataCallback h) {
        data.inStream = h;
        if (h) data.userData = userData;
    }
    /* Same contract as Http3Response: leave onAborted armed so the deferred
     * free can tell the holder its pointer is about to die. */
    Http2Response *clearOnWritableAndAborted() { data.onWritable = nullptr; return this; }

    /* The stream/connection window reopened or the socket drained. Returns
     * false while still blocked. */
    inline bool drain();

private:
    inline bool internalEnd(std::string_view body, uint64_t totalSize, bool optional, bool closeConnection);
    inline void markDone();
};

/* Per-connection state; the socket ext block holds a pointer to this. */
struct Http2Connection {
    us_socket_t *s;
    Http2Context *ctx;
    struct lshpack_enc enc;
    struct lshpack_dec dec;

    /* Inbound: partial frame reassembly, and HEADERS+CONTINUATION block. */
    BackPressure in;
    BackPressure headerBlock;
    uint32_t headerBlockStream = 0;
    uint8_t headerBlockFlags = 0;
    bool expectingContinuation = false;
    unsigned continuationFrames = 0;
    uint8_t prefaceOffset = 0;
    bool settingsReceived = false;

    size_t queuedControl = 0;
    /* Bytes from the head of `out` that must leave before every queued control frame has. */
    size_t controlEnd = 0;
    /* Set when response HEADERS/DATA were queued since the last flush. */
    bool wroteStreamBytes = false;
    /* Set by frames that make progress on a stream during onData. */
    bool progressed = false;
    /* Per-stream byte budget for the current drainWritable() pass; 0 = none. */
    size_t drainSlice = 0;
    /* Outbound bytes not yet accepted by the socket. */
    /* Pending output. Inside a socket event `out` points at the context's
     * loop-shared buffer (one allocation reused by every connection, like
     * HTTP/1's cork buffer); whatever the kernel doesn't take by the end of
     * the event is moved into ownOut. Outside an event it is ownOut. */
    BackPressure ownOut;
    BackPressure *out = &ownOut;

    uint32_t peerMaxFrameSize = 16384;
    int32_t peerInitialWindowSize = http2::DEFAULT_WINDOW_SIZE;
    int64_t connSendWindow = http2::DEFAULT_WINDOW_SIZE;
    uint32_t connUnackedReceive = 0;
    uint32_t encoderTableSize = http2::DEFAULT_HEADER_TABLE_SIZE;
    bool pendingTableSizeUpdate = false;
    uint32_t minTableSizeSinceBlock = 0;

    /* Highest client stream id seen (protocol checks) vs. highest one handed
     * to a handler (what GOAWAY reports as possibly acted upon, §6.8). */
    uint32_t lastStreamId = 0;
    uint32_t lastProcessedStreamId = 0;
    bool goawaySent = false;
    bool goawayReceived = false;
    double resetTokens = http2::RESET_BURST;
    std::chrono::steady_clock::time_point resetRefilledAt = std::chrono::steady_clock::now();

    /* Carried over from the HttpResponseData we replaced so the app's
     * connection filter sees a balanced close. */
    bool filteredOpen = false;
    bool filteredAccept = false;

    /* >0 while this connection is dispatching into user code; deletion of
     * the connection and its streams waits for the outermost frame. */
    int busy = 0;
    bool closed = false;
    bool inSweepList = false;

    std::vector<Http2Response *> streams;
    std::vector<Http2Response *> drainedAgain;
    /* Streams we sent RST_STREAM on; frames for them may still be in flight
     * and are ignored (§5.1 closed). Anything else on a closed id is an error. */
    uint32_t resetByUs[http2::LOCAL_MAX_CONCURRENT_STREAMS] = {};
    unsigned resetByUsNext = 0;
    bool headerBlockSelfDependent = false;
    uint32_t resetByPeer[http2::LOCAL_MAX_CONCURRENT_STREAMS] = {};
    unsigned resetByPeerNext = 0;
    void noteResetByUs(uint32_t id) { resetByUs[resetByUsNext++ % http2::LOCAL_MAX_CONCURRENT_STREAMS] = id; }
    bool wasResetByUs(uint32_t id) const { for (uint32_t r : resetByUs) if (r == id) return true; return false; }
    void noteResetByPeer(uint32_t id) { resetByPeer[resetByPeerNext++ % http2::LOCAL_MAX_CONCURRENT_STREAMS] = id; }
    bool wasResetByPeer(uint32_t id) const { for (uint32_t r : resetByPeer) if (r == id) return true; return false; }
    std::vector<Http2Response *> writable;
    std::vector<Http2Response *> draining;
    std::vector<Http2Response *> pendingFree;
    /* Seconds of silence before onTimeout; recomputed when a stream sets a
     * timeout or retires (see Http2Response::timeoutS). */
    unsigned idleTimeoutS = 0;
    int drainDepth = 0;

    Http2Connection(us_socket_t *socket, Http2Context *context) : s(socket), ctx(context) {
        lshpack_enc_init(&enc);
        lshpack_enc_use_hist(&enc, 1);
        lshpack_dec_init(&dec);
    }
    ~Http2Connection() {
        for (Http2Response *stream : pendingFree) delete stream;
        for (Http2Response *stream : streams) delete stream;
        lshpack_enc_cleanup(&enc);
        lshpack_dec_cleanup(&dec);
    }

    Http2Response *findStream(uint32_t id) {
        /* Newest streams are the busy ones. */
        for (size_t i = streams.size(); i-- > 0;) if (streams[i]->id == id) return streams[i];
        return nullptr;
    }

    /* ── outbound ─────────────────────────────────────────────────────── */

    void writeFrame(uint8_t type, uint8_t flags, uint32_t streamId, const char *payload, uint32_t length) {
        char header[http2::FRAME_HEADER_SIZE];
        http2::writeFrameHeader(header, length, type, flags, streamId);
        out->reserve(out->length() + http2::FRAME_HEADER_SIZE + length);
        out->append(header, http2::FRAME_HEADER_SIZE);
        out->append(payload, length);
    }

    /* A control frame the peer's input obliged us to send; see MAX_QUEUED_CONTROL. */
    void writeControlFrame(uint8_t type, uint8_t flags, uint32_t streamId, const char *payload, uint32_t length) {
        queuedControl += http2::FRAME_HEADER_SIZE + length;
        writeFrame(type, flags, streamId, payload, length);
        controlEnd = out->length();
    }

    inline void writeSettings();

    void writeWindowUpdate(uint32_t streamId, uint32_t increment) {
        char payload[4];
        http2::writeU32BE(payload, increment & 0x7fffffff);
        queuedControl += http2::FRAME_HEADER_SIZE + 4;
        writeFrame(http2::WINDOW_UPDATE, 0, streamId, payload, 4);
        controlEnd = out->length();
    }

    void writeRstStream(uint32_t streamId, http2::ErrorCode code) {
        queuedControl += http2::FRAME_HEADER_SIZE + 4;
        noteResetByUs(streamId);
        char payload[4];
        http2::writeU32BE(payload, code);
        writeFrame(http2::RST_STREAM, 0, streamId, payload, 4);
        controlEnd = out->length();
    }

    void writeGoaway(http2::ErrorCode code) {
        char payload[8];
        http2::writeU32BE(payload, lastProcessedStreamId);
        http2::writeU32BE(payload + 4, code);
        writeFrame(http2::GOAWAY, 0, 0, payload, 8);
        goawaySent = true;
    }

    inline uint32_t maxHeaderListSize();
    inline void writeHeaderBlock(Http2Response *stream, bool endStream);
    inline void writeInformational(Http2Response *stream, std::string_view status);

    /* How many body bytes `stream` may put on the wire right now: the
     * smaller of both windows, and no more than tops `out` up to the
     * high-water mark (so a large body is framed incrementally as the socket
     * drains rather than copied wholesale). */
    size_t sendAllowance(Http2Response *stream) {
        if (out->length() >= http2::SOCKET_BACKPRESSURE_HIGH_WATER) return 0;
        int64_t w = std::min<int64_t>(stream->sendWindow, connSendWindow);
        if (w <= 0) return 0;
        size_t n = std::min<size_t>((size_t) w, http2::SOCKET_BACKPRESSURE_HIGH_WATER - out->length());
        /* Inside a drain pass each stream is limited to its slice. */
        if (drainSlice) n = std::min(n, drainSlice);
        return n;
    }

    /* Frame up to the current allowance of `body` as DATA. END_STREAM rides on
     * the last frame only when everything fit. Returns bytes consumed. */
    size_t writeData(Http2Response *stream, const char *body, size_t length, bool endStream) {
        size_t allowed = std::min(length, sendAllowance(stream));
        if (length && !allowed) return 0;
        out->reserve(out->length() + allowed + http2::FRAME_HEADER_SIZE * (allowed / peerMaxFrameSize + 1));
        size_t sent = 0;
        do {
            uint32_t chunk = (uint32_t) std::min<size_t>(allowed - sent, peerMaxFrameSize);
            bool last = sent + chunk == length;
            writeFrame(http2::DATA, (last && endStream) ? http2::END_STREAM : 0, stream->id, body + sent, chunk);
            sent += chunk;
        } while (sent < allowed);
        stream->sendWindow -= (int32_t) sent;
        connSendWindow -= (int64_t) sent;
        if (sent) wroteStreamBytes = true;
        if (endStream && sent == length) stream->localClosed = true;
        return sent;
    }

    void writeEndStream(Http2Response *stream) {
        writeFrame(http2::DATA, http2::END_STREAM, stream->id, nullptr, 0);
        stream->localClosed = true;
    }

    void markWantsWrite(Http2Response *stream) {
        if (stream->wantsWrite || stream->dead) return;
        stream->wantsWrite = true;
        writable.push_back(stream);
    }

    void flush() {
        bool wrote = false;
        while (out->length() && !closed) {
            int chunk = (int) std::min<size_t>(out->length(), 1u << 30);
            int written = us_socket_write(s, out->data(), chunk);
            if (written <= 0) break;
            /* The shared buffer keeps its allocation; a connection's own one
             * is given back once drained. */
            if (out == &ownOut) out->erase((size_t) written);
            else out->consume((size_t) written);
            if ((size_t) written >= controlEnd) { controlEnd = 0; queuedControl = 0; }
            else controlEnd -= (size_t) written;
            wrote = true;
        }
        /* Only response HEADERS/DATA leaving count as activity; a PING ACK
         * going out must not keep a stalled connection alive. */
        if (wrote && wroteStreamBytes && !closed) touch();
        if (out->length() == 0) wroteStreamBytes = false;
    }

    /* Use the context's shared buffer for this event if nothing of ours is
     * pending and no other connection holds it. */
    inline void borrowSharedOut();
    /* Give it back: flush, then move any remainder into ownOut. */
    inline void returnSharedOut();

    bool wantsDrain() {
        return !closed && !writable.empty() && connSendWindow > 0 &&
               out->length() < http2::SOCKET_BACKPRESSURE_HIGH_WATER;
    }

    /* flush, and while the socket keeps accepting everything, keep framing
     * what blocked streams have queued (a socket that never backs up never
     * raises on_writable). Calls out to onWritable handlers. */
    void pump() {
        flush();
        while (out->length() == 0 && wantsDrain()) {
            drainWritable();
            if (closed || out->length() == 0) break;
            flush();
        }
    }

    /* API calls arriving outside a socket event (a JS stream pull, a settled
     * promise) are flushed by the deferred pass; inside one, by its epilogue.
     * Streams still blocked on the high-water mark are pumped from the loop
     * hook rather than here, so a caller is never re-entered through another
     * stream's onWritable. */
    inline void scheduleFlush();

    bool drainedAfterGoaway() {
        return !closed && streams.empty() && (goawaySent || goawayReceived) && out->length() == 0;
    }

    bool takeResetToken() {
        auto now = std::chrono::steady_clock::now();
        double elapsed = std::chrono::duration<double>(now - resetRefilledAt).count();
        resetRefilledAt = now;
        resetTokens = std::min(http2::RESET_BURST, resetTokens + elapsed * http2::RESET_REFILL_PER_SEC);
        if (resetTokens < 1) return false;
        resetTokens -= 1;
        return true;
    }

    inline void drainWritable();
    inline void streamMaybeClosed(Http2Response *stream);
    inline void retireStream(Http2Response *stream, bool abortNow);
    inline void recomputeIdleTimeout();
    inline void touch();
    inline void replenishStreamWindow(Http2Response *stream, uint32_t bytes);

    /* ── inbound ──────────────────────────────────────────────────────── */

    inline void onData(const char *data, size_t length);
    inline bool handleFrame(uint8_t type, uint8_t flags, uint32_t streamId, const unsigned char *payload, uint32_t length);
    inline bool handleHeaderBlock(uint32_t streamId, uint8_t flags, const unsigned char *block, size_t length);
    /* `flowLength` is the whole frame payload (padding counts against the
     * window); body/bodyLength is the data with padding already stripped. */
    inline bool handleData(Http2Response *stream, bool fin, uint32_t flowLength, const unsigned char *body, uint32_t bodyLength);
    inline bool handleSettings(uint8_t flags, const unsigned char *payload, uint32_t length);
    inline bool connectionError(http2::ErrorCode code);
    /* false: the connection was closed (re-entrancy, or the peer ran out of
     * reset tokens — a stream it forced us to reset counts like one it reset). */
    inline bool streamError(uint32_t streamId, Http2Response *stream, http2::ErrorCode code);
    inline bool dispatchRequest(Http2Response *stream, const us_quic_header_t *headers, unsigned count);
};

struct Http2Context {
    template <bool> friend struct TemplatedApp;

    /* group.ext == this; sockets recover us via us_socket_group_ext(). */
    us_socket_group_t group{};

    struct RouterData {
        Http2Response *httpResponse;
        Http2Request *httpRequest;
    };
    HttpRouter<RouterData> router;

    Loop *loop = nullptr;
    /* The HttpContextData<SSL> we take connections from: its filter handlers
     * count our connections too, and its flags/limits apply to us. */
    void *parent = nullptr;
    HttpFlags *parentFlags = nullptr;
    uint64_t *parentMaxHeaderSize = nullptr;
    void (*notifyParentClosed)(void *parent, us_socket_t *s, bool filteredOpen, bool filteredAccept) = nullptr;
    void (*detachFromParent)(void *parent, Http2Context *ctx) = nullptr;
    /* Seconds without traffic in either direction before a connection is
     * dropped (streams in flight are aborted); 0 disables. */
    unsigned idleTimeoutS = 10;

    /* Output buffer lent to whichever connection is inside a socket event;
     * see Http2Connection::out. */
    BackPressure sharedOut;
    Http2Connection *sharedOutHolder = nullptr;

    /* Scratch shared by every connection on this context: decoded request
     * header bytes + list, and the HPACK encode buffer. dispatchDepth guards
     * the (node:http-only) case of a dispatch nesting another. */
    std::vector<char> decodeBuffer;
    std::vector<us_quic_header_t> decodedHeaders;
    std::vector<unsigned char> encodeBuffer;
    int dispatchDepth = 0;

    std::vector<Http2Connection *> sweepList;

    static Http2Connection *connection(us_socket_t *s) {
        return *(Http2Connection **) us_socket_ext(s);
    }

    uint32_t maxHeaderListSize() {
        uint64_t v = parentMaxHeaderSize && *parentMaxHeaderSize ? *parentMaxHeaderSize : (BUN_DEFAULT_MAX_HTTP_HEADER_SIZE ? BUN_DEFAULT_MAX_HTTP_HEADER_SIZE : http2::DEFAULT_MAX_HEADER_LIST_SIZE);
        return v > 0xffffff ? 0xffffff : (uint32_t) v;
    }

    static Http2Context *create(Loop *loop, unsigned idleTimeoutS) {
        Http2Context *ctx = new Http2Context;
        ctx->loop = loop;
        ctx->idleTimeoutS = idleTimeoutS;
        us_socket_group_init(&ctx->group, (us_loop_t *) loop, &vtable, ctx);
        return ctx;
    }

    void free() {
        closeAll();
        if (parent && detachFromParent) detachFromParent(parent, this);
        for (Http2Connection *conn : sweepList) { conn->inSweepList = false; if (--conn->busy == 0 && conn->closed) delete conn; }
        sweepList.clear();
        us_socket_group_deinit(&group);
        delete this;
    }

    /* Hook into an HttpContext<SSL>'s data so its connections can migrate here. */
    template <bool SSL>
    void attach(HttpContextData<SSL> *data, bool allowHttp1) {
        parent = data;
        parentFlags = &data->flags;
        parentMaxHeaderSize = &data->maxHeaderSize;
        data->http2Context = this;
        data->allowHttp1 = allowHttp1;
        detachFromParent = [](void *p, Http2Context *ctx) { ctx->detach((HttpContextData<SSL> *) p); };
        data->onHttp2 = [](void *ctx, us_socket_t *s, char *initialData, int initialLength, unsigned prefaceConsumed) {
            if (us_socket_is_closed(s) || us_socket_is_shut_down(s)) return s;
            HttpResponseData<SSL> *rd = (HttpResponseData<SSL> *) us_socket_ext(s);
            bool filteredOpen = rd->filteredOpen, filteredAccept = rd->filteredAccept;
            ((AsyncSocket<SSL> *) s)->uncorkWithoutSending();
            rd->~HttpResponseData<SSL>();
            return ((Http2Context *) ctx)->adopt(s, filteredOpen, filteredAccept, initialData, initialLength, prefaceConsumed);
        };
        notifyParentClosed = [](void *p, us_socket_t *s, bool filteredOpen, bool filteredAccept) {
            HttpContextData<SSL> *d = (HttpContextData<SSL> *) p;
            if (filteredOpen) for (auto &f : d->filterHandlers) f((HttpResponse<SSL> *) s, -1);
            if (filteredAccept) for (auto &f : d->filterHandlers) f((HttpResponse<SSL> *) s, -2);
        };
    }

    /* Either side may be destroyed first; whichever goes clears the links. */
    template <bool SSL>
    void detach(HttpContextData<SSL> *data) {
        if (data->http2Context == this) {
            data->http2Context = nullptr;
            data->onHttp2 = nullptr;
            data->allowHttp1 = true;
        }
        parent = nullptr;
        parentFlags = nullptr;
        parentMaxHeaderSize = nullptr;
        notifyParentClosed = nullptr;
        detachFromParent = nullptr;
    }

    /* Take over `s`, whose previous ext has already been destructed. Bytes
     * that arrived with the preface are fed straight in; `prefaceConsumed`
     * preface bytes were already matched by the caller. */
    us_socket_t *adopt(us_socket_t *s, bool filteredOpen, bool filteredAccept, const char *initialData, int initialLength, unsigned prefaceConsumed) {
        us_socket_adopt(s, &group, US_SOCKET_KIND_DYNAMIC, -1, -1);
        Http2Connection *conn = new Http2Connection(s, this);
        conn->filteredOpen = filteredOpen;
        conn->filteredAccept = filteredAccept;
        conn->prefaceOffset = (uint8_t) prefaceConsumed;
        *(Http2Connection **) us_socket_ext(s) = conn;
        s->flags.allow_half_open = 0;
        conn->idleTimeoutS = idleTimeoutS;
        conn->touch();
        conn->writeSettings();
        if (initialLength > 0) {
            conn->onData(initialData, (size_t) initialLength);
            return s;
        }
        conn->flush();
        return s;
    }

    void onHttp(std::string_view method, std::string_view pattern,
                MoveOnlyFunction<void(Http2Response *, Http2Request *)> &&handler) {
        std::vector<std::string_view> methods =
            method == "*" ? std::vector<std::string_view>{"*"} : std::vector<std::string_view>{method};
        router.add(methods, pattern, [handler = std::move(handler)](auto *r) mutable {
            /* Copy out: the handler may reload routes, replacing `router`
             * (and its user data) while we're inside it. */
            Http2Request *req = r->getUserData().httpRequest;
            Http2Response *res = r->getUserData().httpResponse;
            req->setYield(false);
            req->setParameters(r->getParameters());
            handler(res, req);
            return !req->getYield();
        }, method == "*" ? router.LOW_PRIORITY : router.MEDIUM_PRIORITY);
    }

    /* server.reload(): drop all routes. Safe from inside a handler: the
     * route lambda copied what it needs and returns straight after. */
    void clearRoutes() { router = decltype(router){}; }

    /* fn may close connections (and run JS that closes others), so snapshot
     * the group's list first and pin each entry across the call. */
    template <typename F> void forEachConnection(F &&fn) {
        std::vector<Http2Connection *> list;
        for (us_socket_t *s = group.head_sockets; s; s = s->next) {
            Http2Connection *conn = connection(s);
            if (!conn->closed) { conn->busy++; list.push_back(conn); }
        }
        for (Http2Connection *conn : list) {
            if (!conn->closed) fn(conn);
            if (--conn->busy == 0 && conn->closed) delete conn;
        }
    }

    /* GOAWAY every connection and close it. Streams still in flight get
     * onAborted, as TemplatedApp::close() does for HTTP/1 sockets. */
    void closeAll() {
        forEachConnection([](Http2Connection *conn) {
            if (!conn->goawaySent) conn->writeGoaway(http2::ERR_NO_ERROR);
            conn->flush();
            us_socket_close(conn->s, 0, nullptr);
        });
    }

    /* Close connections with nothing in flight (after a GOAWAY). With
     * `closeWhenIdle`, busy connections also get GOAWAY so no new streams
     * start and they close once their last stream retires (graceful stop);
     * without it they are left alone. */
    size_t closeIdle(bool closeWhenIdle) {
        size_t closedNow = 0;
        forEachConnection([&](Http2Connection *conn) {
            if (!conn->streams.empty() && !closeWhenIdle) return;
            if (!conn->goawaySent) conn->writeGoaway(http2::ERR_NO_ERROR);
            conn->flush();
            if (conn->streams.empty()) {
                us_socket_close(conn->s, 0, nullptr);
                closedNow++;
            }
        });
        return closedNow;
    }

    /* Installed by the embedder: arrange for sweep() to run soon, outside the
     * current call stack (Bun posts it to the event loop's deferred task
     * queue, which runs after the current JS task and its microtasks). */
    void (*scheduleDrain)(void *user, Http2Context *ctx) = nullptr;
    void *scheduleDrainUser = nullptr;

    bool drainScheduled = false;

    /* Queued connections are pinned (busy) so they can't be deleted before
     * the pass reaches them. */
    void scheduleSweep(Http2Connection *conn) {
        if (conn->inSweepList || conn->closed) return;
        conn->inSweepList = true;
        conn->busy++;
        sweepList.push_back(conn);
        if (!drainScheduled && scheduleDrain) {
            drainScheduled = true;
            scheduleDrain(scheduleDrainUser, this);
        }
    }

    /* The embedder's deferred callback: returns whether more work is queued
     * (so a repeating task can stay registered). */
    bool drain() {
        /* Stay "scheduled" across sweep() so re-queues from inside it don't
         * call the hook re-entrantly; whatever is queued afterwards keeps the
         * embedder's task alive via the return value. */
        drainScheduled = true;
        sweep();
        drainScheduled = !sweepList.empty();
        return drainScheduled;
    }

    /* Pump connections whose streams are parked on the high-water mark and
     * free retired streams. Runs from the embedder's deferred queue (see
     * scheduleDrain) and after every socket event on that connection. */
    void sweep() {
        std::vector<Http2Connection *> batch;
        batch.swap(sweepList);
        if (batch.empty()) return;
        for (Http2Connection *conn : batch) {
            conn->inSweepList = false;
            conn->busy--; /* the queue's pin */
            if (conn->closed) { if (conn->busy == 0) delete conn; continue; }
            /* Inside its own socket event (the deferred queue runs after every
             * JS callback): the event's epilogue flushes once for the whole
             * batch and frees retired streams. Flushing here would be one
             * write() per response. */
            if (conn->busy > 0) continue;
            conn->busy++;
            conn->borrowSharedOut();
            conn->pump();
            conn->returnSharedOut();
            conn->busy--;
            if (!sweepConnection(conn)) continue;
            if (conn->drainedAfterGoaway()) us_socket_close(conn->s, 0, nullptr);
        }
    }

    /* Delete retired streams, telling each holder first. Returns false if
     * the connection closed meanwhile (and was deleted if nothing else of
     * ours is on the stack). */
    static bool sweepConnection(Http2Connection *conn) {
        if (conn->busy > 0) {
            /* A frame of ours further up the stack (a nested event-loop tick
             * got us here) may still hold one of these streams; its epilogue
             * sweeps when it unwinds. */
            return !conn->closed;
        }
        conn->busy++;
        while (!conn->pendingFree.empty() && !conn->closed) {
            Http2Response *stream = conn->pendingFree.back();
            conn->pendingFree.pop_back();
            if (stream->data.onAborted) {
                auto cb = stream->data.onAborted;
                stream->data.onAborted = nullptr;
                cb(stream, stream->data.userData);
            }
            delete stream;
        }
        conn->busy--;
        if (conn->closed) {
            if (conn->busy == 0) delete conn;
            return false;
        }
        return true;
    }

private:
    /* ── socket vtable ────────────────────────────────────────────────── */

    static us_socket_t *onData(us_socket_t *s, char *data, int length) {
        if (us_socket_is_shut_down(s)) return s;
        Http2Connection *conn = connection(s);
        conn->borrowSharedOut();
        conn->onData(data, (size_t) length);
        return s;
    }

    static us_socket_t *onWritable(us_socket_t *s) {
        Http2Connection *conn = connection(s);
        conn->busy++;
        conn->flush();
        conn->borrowSharedOut();
        if (!conn->closed) conn->drainWritable();
        conn->busy--;
        return epilogue(conn, s);
    }

    static us_socket_t *onClose(us_socket_t *s, int, void *) {
        Http2Connection *conn = connection(s);
        Http2Context *ctx = conn->ctx;
        conn->closed = true;
        if (ctx->sharedOutHolder == conn) { ctx->sharedOut.clear(); ctx->sharedOutHolder = nullptr; conn->out = &conn->ownOut; }
        conn->busy++;
        for (Http2Response *stream : conn->streams) {
            stream->dead = true;
            conn->pendingFree.push_back(stream);
        }
        conn->streams.clear();
        conn->writable.clear();
        conn->draining.clear();
        /* Every holder learns its Http2Response* is going away. The objects
         * themselves are deleted with the connection once no frame of ours
         * is still running (~Http2Connection). */
        for (Http2Response *stream : conn->pendingFree) {
            if (stream->data.onAborted) {
                auto cb = stream->data.onAborted;
                stream->data.onAborted = nullptr;
                cb(stream, stream->data.userData);
            }
        }
        if (ctx->notifyParentClosed) {
            ctx->notifyParentClosed(ctx->parent, s, conn->filteredOpen, conn->filteredAccept);
        }
        conn->busy--;
        if (conn->busy == 0) delete conn;
        return s;
    }

    /* No traffic either way for idleTimeoutS (or a drained going-away
     * connection): streams in flight are aborted through onClose. */
    static us_socket_t *onTimeout(us_socket_t *s) {
        Http2Connection *conn = connection(s);
        conn->busy++;
        std::vector<Http2Response *> open = conn->streams;
        for (Http2Response *stream : open) {
            if (!stream->dead && stream->data.onTimeout) stream->data.onTimeout(stream, stream->data.userData);
        }
        conn->busy--;
        if (conn->closed) {
            if (conn->busy == 0) delete conn;
            return s;
        }
        if (!conn->goawaySent) conn->writeGoaway(http2::ERR_NO_ERROR);
        conn->flush();
        return us_socket_close(s, 0, nullptr);
    }

    static us_socket_t *onEnd(us_socket_t *s) {
        Http2Connection *conn = connection(s);
        conn->flush();
        return us_socket_close(s, 0, nullptr);
    }

    /* After user code ran from a socket event: push bytes out, free what
     * retired, close a drained going-away connection. */
    static us_socket_t *epilogue(Http2Connection *conn, us_socket_t *s) {
        if (conn->closed) {
            conn->returnSharedOut();
            if (conn->busy == 0) delete conn;
            return s;
        }
        conn->busy++;
        conn->pump();
        conn->busy--;
        conn->returnSharedOut();
        if (!sweepConnection(conn)) return s;
        if (conn->drainedAfterGoaway()) return us_socket_close(s, 0, nullptr);
        return s;
    }

    static inline const us_socket_vtable_t vtable = {
        /* on_open */             nullptr,
        /* on_data */             &onData,
        /* on_fd */               nullptr,
        /* on_writable */         &onWritable,
        /* on_close */            &onClose,
        /* on_timeout */          &onTimeout,
        /* on_long_timeout */     nullptr,
        /* on_end */              &onEnd,
        /* on_connect_error */    nullptr,
        /* on_connecting_error */ nullptr,
        /* on_handshake */        nullptr,
    };

    friend struct Http2Connection;
};

/* ─── Http2Connection out-of-line ─────────────────────────────────────────── */

inline uint32_t Http2Connection::maxHeaderListSize() { return ctx->maxHeaderListSize(); }

inline void Http2Connection::writeSettings() {
    char payload[6 * 4];
    char *p = payload;
    auto put = [&](uint16_t id, uint32_t value) {
        p[0] = (char)(id >> 8); p[1] = (char) id; http2::writeU32BE(p + 2, value); p += 6;
    };
    put(http2::SETTINGS_MAX_CONCURRENT_STREAMS, http2::LOCAL_MAX_CONCURRENT_STREAMS);
    put(http2::SETTINGS_INITIAL_WINDOW_SIZE, http2::LOCAL_INITIAL_WINDOW_SIZE);
    put(http2::SETTINGS_MAX_FRAME_SIZE, http2::LOCAL_MAX_FRAME_SIZE);
    put(http2::SETTINGS_MAX_HEADER_LIST_SIZE, maxHeaderListSize());
    writeFrame(http2::SETTINGS, 0, 0, payload, (uint32_t)(p - payload));
    writeWindowUpdate(0, http2::LOCAL_CONNECTION_WINDOW_SIZE - http2::DEFAULT_WINDOW_SIZE);
}

inline void Http2Connection::touch() {
    us_socket_timeout(s, idleTimeoutS);
}

inline void Http2Connection::recomputeIdleTimeout() {
    /* Most permissive among open streams (0 = never); a stream that never
     * asked counts as the context default, as does a connection with none. */
    unsigned t = streams.empty() ? ctx->idleTimeoutS : 0;
    bool never = streams.empty() && ctx->idleTimeoutS == 0;
    for (Http2Response *stream : streams) {
        unsigned s = stream->timeoutS == 255 ? ctx->idleTimeoutS : stream->timeoutS;
        if (s == 0) { never = true; break; }
        t = std::max(t, s);
    }
    idleTimeoutS = never ? 0 : t;
    touch();
}

inline void Http2Connection::borrowSharedOut() {
    if (out != &ownOut || ownOut.length() != 0 || ctx->sharedOutHolder || closed) return;
    ctx->sharedOutHolder = this;
    out = &ctx->sharedOut;
}

inline void Http2Connection::returnSharedOut() {
    if (out == &ownOut) return;
    if (!closed) flush();
    if (out->length()) ownOut.append(out->data(), out->length());
    out->consume(out->length());
    /* Don't keep a huge shared buffer around after one outsized burst. */
    if (out->totalLength() > 4 * http2::SOCKET_BACKPRESSURE_HIGH_WATER) out->clear();
    ctx->sharedOutHolder = nullptr;
    out = &ownOut;
}

inline void Http2Connection::scheduleFlush() {
    /* Never write from under an API call. Inside a socket event its epilogue
     * flushes the whole batch; outside one (a JS pull, a settled promise, a
     * timer) the deferred pass does, once per connection per event-loop turn
     * — the same place HTTP/1 uncorks. */
    if (busy) return;
    ctx->scheduleSweep(this);
}

inline void Http2Connection::writeHeaderBlock(Http2Response *stream, bool endStream) {
    wroteStreamBytes = true;
    Http2ResponseData *d = &stream->data;
    std::vector<unsigned char> &buf = ctx->encodeBuffer;
    size_t need = 16;
    for (auto &h : d->hdrs) need += h.nameLen + h.valueLen + 32;
    if (buf.size() < need) buf.resize(need);
    unsigned char *p = buf.data();
    unsigned char *end = buf.data() + buf.size();
    if (pendingTableSizeUpdate) {
        if (minTableSizeSinceBlock != encoderTableSize) p = http2::hpackEncodeInteger(p, 0x20, 5, minTableSizeSinceBlock);
        p = http2::hpackEncodeInteger(p, 0x20, 5, encoderTableSize);
        pendingTableSizeUpdate = false;
    }
    const char *base = d->hdrBuf.span().data();
    for (auto &h : d->hdrs) {
        if (h.nameLen + h.valueLen + 32 > (size_t)(end - p)) {
            size_t used = (size_t)(p - buf.data());
            buf.resize(buf.size() * 2 + h.nameLen + h.valueLen + 32);
            p = buf.data() + used;
            end = buf.data() + buf.size();
        }
        if (h.nameLen > LSXPACK_MAX_STRLEN / 2 || h.valueLen > LSXPACK_MAX_STRLEN / 2) {
            /* Beyond ls-hpack's 16-bit lengths: literal without indexing, no Huffman. */
            *p++ = 0x00;
            p = http2::hpackEncodeInteger(p, 0x00, 7, h.nameLen);
            memcpy(p, base + h.nameOff, h.nameLen); p += h.nameLen;
            p = http2::hpackEncodeInteger(p, 0x00, 7, h.valueLen);
            memcpy(p, base + h.valueOff, h.valueLen); p += h.valueLen;
            continue;
        }
        lsxpack_header_t x;
        lsxpack_header_set_offset2(&x, base + h.nameOff, 0, h.nameLen, h.nameLen, h.valueLen);
        for (;;) {
            unsigned char *q = lshpack_enc_encode(&enc, p, end, &x);
            if (q != p) { p = q; break; }
            size_t used = (size_t)(p - buf.data());
            buf.resize(buf.size() * 2);
            p = buf.data() + used;
            end = buf.data() + buf.size();
        }
    }
    d->hdrBuf.shrink(0);
    d->hdrs.shrink(0);

    /* HEADERS then CONTINUATIONs, each ≤ the peer's frame size. No other
     * frame may interleave, which holds since the block is appended at once. */
    const char *block = (const char *) buf.data();
    size_t total = (size_t)(p - buf.data());
    size_t off = 0;
    bool first = true;
    do {
        uint32_t chunk = (uint32_t) std::min<size_t>(total - off, peerMaxFrameSize);
        bool last = off + chunk == total;
        uint8_t flags = (last ? http2::END_HEADERS : 0) | (first && endStream ? http2::END_STREAM : 0);
        writeFrame(first ? http2::HEADERS : http2::CONTINUATION, flags, stream->id, block + off, chunk);
        off += chunk;
        first = false;
    } while (off < total);
    if (endStream) stream->localClosed = true;
}

inline void Http2Connection::writeInformational(Http2Response *stream, std::string_view status) {
    unsigned char tmp[32];
    char field[10] = {':', 's', 't', 'a', 't', 'u', 's', '1', '0', '0'};
    memcpy(field + 7, status.data(), std::min<size_t>(status.size(), 3));
    lsxpack_header_t x;
    lsxpack_header_set_offset2(&x, field, 0, 7, 7, 3);
    x.indexed_type = 1;
    unsigned char *p = tmp;
    if (pendingTableSizeUpdate) {
        if (minTableSizeSinceBlock != encoderTableSize) p = http2::hpackEncodeInteger(p, 0x20, 5, minTableSizeSinceBlock);
        p = http2::hpackEncodeInteger(p, 0x20, 5, encoderTableSize);
        pendingTableSizeUpdate = false;
    }
    unsigned char *q = lshpack_enc_encode(&enc, p, tmp + sizeof(tmp), &x);
    writeFrame(http2::HEADERS, http2::END_HEADERS, stream->id, (const char *) tmp, (uint32_t)(q - tmp));
}

inline void Http2Connection::replenishStreamWindow(Http2Response *stream, uint32_t bytes) {
    stream->unackedReceive += bytes;
    /* A stream not yet granted the wide window keeps only its initial
     * allowance: that is what bounds body bytes parked per stream. */
    if (stream->wide && !stream->paused && stream->unackedReceive >= stream->receiveWindow / 2) {
        writeWindowUpdate(stream->id, stream->unackedReceive);
        stream->unackedReceive = 0;
    }
}

inline void Http2Connection::drainWritable() {
    /* Streams may re-arm or retire while we call out; iterate a snapshot.
     * Each stream gets at most one slice per pass and the ones that didn't
     * finish re-queue at the back, so a large download can't starve small
     * responses queued behind it. */
    std::vector<Http2Response *> nested, nestedAgain;
    std::vector<Http2Response *> &snapshot = drainDepth++ ? nested : draining;
    snapshot.clear();
    snapshot.swap(writable);
    for (Http2Response *stream : snapshot) stream->wantsWrite = false;
    size_t i = 0;
    size_t prevSlice = drainSlice;
    drainSlice = std::max<size_t>(peerMaxFrameSize, (http2::SOCKET_BACKPRESSURE_HIGH_WATER - std::min<size_t>(out->length(), http2::SOCKET_BACKPRESSURE_HIGH_WATER)) / std::max<size_t>(snapshot.size(), 1));
    for (; i < snapshot.size(); i++) {
        if (closed) { drainSlice = prevSlice; drainDepth--; return; }
        if (out->length() >= http2::SOCKET_BACKPRESSURE_HIGH_WATER || connSendWindow <= 0) break;
        Http2Response *stream = snapshot[i];
        if (stream->dead || stream->wantsWrite) continue;
        if (stream->sendWindow <= 0) { markWantsWrite(stream); continue; }
        if (!stream->drain()) markWantsWrite(stream);
        else streamMaybeClosed(stream);
    }
    /* Rotate: whatever re-queued itself during this pass (had its slice and
     * wants more) goes behind the streams that didn't get a turn at all. */
    if (i < snapshot.size()) {
        std::vector<Http2Response *> &again = drainDepth > 1 ? nestedAgain : drainedAgain;
        again.clear();
        again.swap(writable);
        for (; i < snapshot.size(); i++) markWantsWrite(snapshot[i]);
        for (Http2Response *stream : again) { stream->wantsWrite = false; if (!stream->dead) markWantsWrite(stream); }
        again.clear();
    }
    snapshot.clear();
    drainSlice = prevSlice;
    drainDepth--;
}

inline void Http2Connection::retireStream(Http2Response *stream, bool abortNow) {
    if (stream->dead) return;
    stream->dead = true;
    auto it = std::find(streams.begin(), streams.end(), stream);
    if (it != streams.end()) streams.erase(it);
    if (stream->wantsWrite) {
        auto wit = std::find(writable.begin(), writable.end(), stream);
        if (wit != writable.end()) writable.erase(wit);
        stream->wantsWrite = false;
    }
    stream->data.onWritable = nullptr;
    stream->data.inStream = nullptr;
    if (abortNow && stream->data.onAborted) {
        auto cb = stream->data.onAborted;
        stream->data.onAborted = nullptr;
        cb(stream, stream->data.userData);
    }
    pendingFree.push_back(stream);
    if (closed) return;
    /* Freed (and a drained going-away connection closed) after the current
     * socket event, or from the deferred pass if we're outside one; never
     * under the API call that got us here. */
    if (busy == 0) ctx->scheduleSweep(this);
    if (stream->timeoutS != 255) recomputeIdleTimeout();
}

inline void Http2Connection::streamMaybeClosed(Http2Response *stream) {
    if (stream->dead) return;
    bool localDone = stream->localClosed || stream->reset;
    bool remoteDone = stream->remoteClosed || stream->reset;
    if (localDone && !remoteDone) {
        /* Response complete while the request body is still coming: tell
         * the peer to stop (RFC 9113 §8.1) rather than sink unread bytes. */
        writeRstStream(stream->id, http2::ERR_NO_ERROR);
        stream->reset = true;
        remoteDone = true;
    }
    if (localDone && remoteDone) retireStream(stream, false);
}

inline bool Http2Connection::connectionError(http2::ErrorCode code) {
    if (!goawaySent) writeGoaway(code);
    flush();
    us_socket_shutdown(s);
    us_socket_close(s, 0, nullptr);
    return false;
}

inline bool Http2Connection::streamError(uint32_t streamId, Http2Response *stream, http2::ErrorCode code) {
    writeRstStream(streamId, code);
    scheduleFlush();
    if (stream) {
        stream->reset = true;
        retireStream(stream, true);
        if (closed) return false;
        if (!takeResetToken()) return connectionError(http2::ERR_ENHANCE_YOUR_CALM);
    }
    return true;
}

inline void Http2Connection::onData(const char *data, size_t length) {
    busy++;
    if (prefaceOffset < http2::CLIENT_PREFACE_LEN) {
        size_t n = std::min<size_t>(http2::CLIENT_PREFACE_LEN - prefaceOffset, length);
        if (memcmp(data, http2::CLIENT_PREFACE + prefaceOffset, n) != 0) {
            connectionError(http2::ERR_PROTOCOL_ERROR);
            busy--;
            Http2Context::epilogue(this, s);
            return;
        }
        prefaceOffset += (uint8_t) n;
        data += n;
        length -= n;
    }

    const unsigned char *p;
    size_t avail;
    bool buffered = in.length() != 0;
    if (buffered) {
        in.append(data, length);
        p = (const unsigned char *) in.data();
        avail = in.length();
    } else {
        p = (const unsigned char *) data;
        avail = length;
    }

    size_t consumed = 0;
    while (avail - consumed >= http2::FRAME_HEADER_SIZE) {
        const unsigned char *h = p + consumed;
        uint32_t flen = ((uint32_t) h[0] << 16) | ((uint32_t) h[1] << 8) | h[2];
        uint8_t type = h[3], flags = h[4];
        uint32_t streamId = http2::readU32BE(h + 5) & 0x7fffffff;
        if (flen > http2::LOCAL_MAX_FRAME_SIZE) {
            connectionError(http2::ERR_FRAME_SIZE_ERROR);
            busy--;
            Http2Context::epilogue(this, s);
            return;
        }
        if (avail - consumed < http2::FRAME_HEADER_SIZE + flen) break;
        if (!handleFrame(type, flags, streamId, h + http2::FRAME_HEADER_SIZE, flen) || closed) {
            busy--;
            Http2Context::epilogue(this, s);
            return;
        }
        consumed += http2::FRAME_HEADER_SIZE + flen;
    }

    if (buffered) {
        in.erase(consumed);
    } else if (consumed < avail) {
        in.append((const char *) p + consumed, avail - consumed);
    }
    /* Only frames that move a stream count as activity: a peer holding
     * streams open at a zero window can't keep the connection alive on PINGs. */
    if (progressed || streams.empty()) touch();
    progressed = false;
    busy--;
    Http2Context::epilogue(this, s);
}

inline bool Http2Connection::handleSettings(uint8_t flags, const unsigned char *payload, uint32_t length) {
    if (flags & http2::ACK) {
        return length == 0 ? true : connectionError(http2::ERR_FRAME_SIZE_ERROR);
    }
    if (length % 6 != 0) return connectionError(http2::ERR_FRAME_SIZE_ERROR);
    /* nghttp2's cap: each INITIAL_WINDOW_SIZE entry walks every open stream. */
    if (length / 6 > http2::MAX_SETTINGS_PER_FRAME) return connectionError(http2::ERR_ENHANCE_YOUR_CALM);
    for (uint32_t off = 0; off < length; off += 6) {
        uint16_t id = (uint16_t)((payload[off] << 8) | payload[off + 1]);
        uint32_t value = http2::readU32BE(payload + off + 2);
        switch (id) {
        case http2::SETTINGS_HEADER_TABLE_SIZE: {
            uint32_t newSize = std::min(value, http2::DEFAULT_HEADER_TABLE_SIZE);
            if (newSize != encoderTableSize || pendingTableSizeUpdate) {
                /* RFC 7541 §4.2: if the limit dipped below the final value
                 * between blocks, the decoder must see that minimum first. */
                minTableSizeSinceBlock = pendingTableSizeUpdate ? std::min(minTableSizeSinceBlock, newSize) : std::min(encoderTableSize, newSize);
                encoderTableSize = newSize;
                lshpack_enc_set_max_capacity(&enc, minTableSizeSinceBlock);
                if (newSize != minTableSizeSinceBlock) lshpack_enc_set_max_capacity(&enc, newSize);
                pendingTableSizeUpdate = true;
            }
            break;
        }
        case http2::SETTINGS_ENABLE_PUSH:
            if (value > 1) return connectionError(http2::ERR_PROTOCOL_ERROR);
            break;
        case http2::SETTINGS_INITIAL_WINDOW_SIZE: {
            if (value > (uint32_t) http2::MAX_WINDOW_SIZE) return connectionError(http2::ERR_FLOW_CONTROL_ERROR);
            int64_t delta = (int64_t) value - peerInitialWindowSize;
            peerInitialWindowSize = (int32_t) value;
            for (Http2Response *stream : streams) {
                int64_t w = (int64_t) stream->sendWindow + delta;
                if (w > http2::MAX_WINDOW_SIZE) return connectionError(http2::ERR_FLOW_CONTROL_ERROR);
                stream->sendWindow = (int32_t) w;
                if (delta > 0) markWantsWrite(stream);
            }
            break;
        }
        case http2::SETTINGS_MAX_FRAME_SIZE:
            if (value < 16384 || value > 16777215) return connectionError(http2::ERR_PROTOCOL_ERROR);
            peerMaxFrameSize = value;
            break;
        default:
            /* MAX_CONCURRENT_STREAMS / MAX_HEADER_LIST_SIZE bound what *we*
             * may initiate; a server that never pushes has nothing to
             * enforce. Unknown settings are ignored (§6.5.2). */
            break;
        }
    }
    settingsReceived = true;
    writeControlFrame(http2::SETTINGS, http2::ACK, 0, nullptr, 0);
    return true;
}

inline bool Http2Connection::handleFrame(uint8_t type, uint8_t flags, uint32_t streamId, const unsigned char *payload, uint32_t length) {
    if (!settingsReceived && type != http2::SETTINGS) return connectionError(http2::ERR_PROTOCOL_ERROR);
    if (queuedControl > http2::MAX_QUEUED_CONTROL) return connectionError(http2::ERR_ENHANCE_YOUR_CALM);
    if (expectingContinuation && (type != http2::CONTINUATION || streamId != headerBlockStream)) {
        return connectionError(http2::ERR_PROTOCOL_ERROR);
    }

    switch (type) {
    case http2::DATA: {
        if (streamId == 0) return connectionError(http2::ERR_PROTOCOL_ERROR);
        /* Connection-level flow control counts every DATA byte, delivered or not. */
        if (length > http2::LOCAL_CONNECTION_WINDOW_SIZE - connUnackedReceive) return connectionError(http2::ERR_FLOW_CONTROL_ERROR);
        connUnackedReceive += length;
        if (connUnackedReceive >= http2::LOCAL_CONNECTION_WINDOW_SIZE / 4) {
            writeWindowUpdate(0, connUnackedReceive);
            connUnackedReceive = 0;
        }
        const unsigned char *body = payload;
        uint32_t bodyLength = length;
        if (flags & http2::PADDED) {
            if (length < 1 || 1u + payload[0] > length) return connectionError(http2::ERR_PROTOCOL_ERROR);
            body = payload + 1;
            bodyLength = length - 1 - payload[0];
        }
        Http2Response *stream = findStream(streamId);
        if (!stream || stream->remoteClosed) {
            if (streamId > lastStreamId || (streamId & 1) == 0) return connectionError(http2::ERR_PROTOCOL_ERROR);
            if (stream) return streamError(streamId, stream, http2::ERR_STREAM_CLOSED);
            /* §5.1 closed: after the peer's RST_STREAM, more frames are a
             * stream error; frames racing an RST_STREAM we sent are ignored;
             * anything else is DATA on a stream the peer ended itself. */
            if (wasResetByPeer(streamId)) return streamError(streamId, nullptr, http2::ERR_STREAM_CLOSED);
            if (wasResetByUs(streamId)) return true;
            return connectionError(http2::ERR_STREAM_CLOSED);
        }
        return handleData(stream, (flags & http2::END_STREAM) != 0, length, body, bodyLength);
    }

    case http2::HEADERS: {
        if (streamId == 0 || (streamId & 1) == 0) return connectionError(http2::ERR_PROTOCOL_ERROR);
        uint32_t pad = 0, skip = 0;
        if (flags & http2::PADDED) {
            if (length < 1) return connectionError(http2::ERR_FRAME_SIZE_ERROR);
            pad = payload[0];
            skip = 1;
        }
        if (flags & http2::PRIORITY_FLAG) skip += 5;
        if (skip + pad > length) return connectionError(http2::ERR_PROTOCOL_ERROR);
        headerBlockSelfDependent = (flags & http2::PRIORITY_FLAG) && (http2::readU32BE(payload + ((flags & http2::PADDED) ? 1 : 0)) & 0x7fffffff) == streamId;
        const unsigned char *fragment = payload + skip;
        uint32_t fragmentLength = length - skip - pad;
        if (flags & http2::END_HEADERS) {
            return handleHeaderBlock(streamId, flags, fragment, fragmentLength);
        }
        headerBlock.clear();
        headerBlock.append((const char *) fragment, fragmentLength);
        headerBlockStream = streamId;
        headerBlockFlags = flags;
        continuationFrames = 0;
        expectingContinuation = true;
        return true;
    }

    case http2::CONTINUATION: {
        if (!expectingContinuation) return connectionError(http2::ERR_PROTOCOL_ERROR);
        if (++continuationFrames > http2::MAX_CONTINUATION_FRAMES) return connectionError(http2::ERR_ENHANCE_YOUR_CALM);
        if (headerBlock.length() + length > std::max<size_t>((size_t) maxHeaderListSize() * http2::HEADER_BLOCK_HARD_CAP_FACTOR, http2::LOCAL_MAX_FRAME_SIZE)) return connectionError(http2::ERR_ENHANCE_YOUR_CALM);
        headerBlock.append((const char *) payload, length);
        if (!(flags & http2::END_HEADERS)) return true;
        expectingContinuation = false;
        bool ok = handleHeaderBlock(headerBlockStream, headerBlockFlags, (const unsigned char *) headerBlock.data(), headerBlock.length());
        headerBlock.clear();
        return ok;
    }

    case http2::PRIORITY:
        if (streamId == 0) return connectionError(http2::ERR_PROTOCOL_ERROR);
        if (length != 5) return connectionError(http2::ERR_FRAME_SIZE_ERROR);
        /* Ignored, except that depending on itself is malformed (§5.3.1). */
        if ((http2::readU32BE(payload) & 0x7fffffff) == streamId) return streamError(streamId, findStream(streamId), http2::ERR_PROTOCOL_ERROR);
        return true;

    case http2::RST_STREAM: {
        if (streamId == 0 || streamId > lastStreamId || (streamId & 1) == 0) return connectionError(http2::ERR_PROTOCOL_ERROR);
        if (length != 4) return connectionError(http2::ERR_FRAME_SIZE_ERROR);
        noteResetByPeer(streamId);
        Http2Response *stream = findStream(streamId);
        if (stream) {
            stream->reset = true;
            retireStream(stream, true);
            if (closed) return false;
            if (!takeResetToken()) return connectionError(http2::ERR_ENHANCE_YOUR_CALM);
        }
        return true;
    }

    case http2::SETTINGS:
        if (streamId != 0) return connectionError(http2::ERR_PROTOCOL_ERROR);
        return handleSettings(flags, payload, length);

    case http2::PUSH_PROMISE:
        return connectionError(http2::ERR_PROTOCOL_ERROR);

    case http2::PING:
        if (streamId != 0) return connectionError(http2::ERR_PROTOCOL_ERROR);
        if (length != 8) return connectionError(http2::ERR_FRAME_SIZE_ERROR);
        if (!(flags & http2::ACK)) writeControlFrame(http2::PING, http2::ACK, 0, (const char *) payload, 8);
        return true;

    case http2::GOAWAY:
        if (streamId != 0) return connectionError(http2::ERR_PROTOCOL_ERROR);
        if (length < 8) return connectionError(http2::ERR_FRAME_SIZE_ERROR);
        goawayReceived = true;
        return true;

    case http2::WINDOW_UPDATE: {
        if (length != 4) return connectionError(http2::ERR_FRAME_SIZE_ERROR);
        uint32_t increment = http2::readU32BE(payload) & 0x7fffffff;
        if (streamId == 0) {
            if (increment == 0) return connectionError(http2::ERR_PROTOCOL_ERROR);
            if (connSendWindow + increment > http2::MAX_WINDOW_SIZE) return connectionError(http2::ERR_FLOW_CONTROL_ERROR);
            if (connSendWindow <= 0) progressed = true;
            connSendWindow += increment;
            return true;
        }
        Http2Response *stream = findStream(streamId);
        if (!stream) {
            if (streamId > lastStreamId || (streamId & 1) == 0) return connectionError(http2::ERR_PROTOCOL_ERROR);
            /* Closed stream: still answer the two things that are errors in
             * any state (§6.9, §6.9.1); an RST on a closed stream is harmless. */
            if (increment == 0) return streamError(streamId, nullptr, http2::ERR_PROTOCOL_ERROR);
            if ((int64_t) peerInitialWindowSize + increment > http2::MAX_WINDOW_SIZE) return streamError(streamId, nullptr, http2::ERR_FLOW_CONTROL_ERROR);
            return true;
        }
        if (increment == 0) return streamError(streamId, stream, http2::ERR_PROTOCOL_ERROR);
        if ((int64_t) stream->sendWindow + increment > http2::MAX_WINDOW_SIZE) {
            return streamError(streamId, stream, http2::ERR_FLOW_CONTROL_ERROR);
        }
        if (stream->sendWindow <= 0 && stream->sendWindow + (int32_t) increment > 0) progressed = true;
        stream->sendWindow += (int32_t) increment;
        /* Drained once per socket read by the epilogue's pump(), so a peer
         * dribbling 1-byte updates can't drive a drain pass per frame. */
        if (stream->wantsWrite || stream->data.backpressure.length() || stream->data.onWritable) markWantsWrite(stream);
        return true;
    }

    default:
        /* Unknown frame types are ignored (§5.5). */
        return true;
    }
}

inline bool Http2Connection::handleData(Http2Response *stream, bool fin, uint32_t length, const unsigned char *body, uint32_t bodyLength) {
    /* A frame with no body bytes (empty, or all padding) moves nothing. */
    if (bodyLength > 0 || fin) progressed = true;
    /* §6.9.1: the peer may not send beyond what we advertised for this stream. */
    if (length > stream->receiveWindow - stream->unackedReceive) return streamError(stream->id, stream, http2::ERR_FLOW_CONTROL_ERROR);
    stream->receivedBodyBytes += bodyLength;
    if (stream->declaredContentLength >= 0 &&
        (stream->receivedBodyBytes > (uint64_t) stream->declaredContentLength ||
         (fin && stream->receivedBodyBytes != (uint64_t) stream->declaredContentLength))) {
        return streamError(stream->id, stream, http2::ERR_PROTOCOL_ERROR);
    }
    if (fin) stream->remoteClosed = true;
    else if (length) replenishStreamWindow(stream, length);

    if (stream->data.inStream) {
        if (fin) stream->finDelivered = true;
        stream->data.inStream(stream, (const char *) body, bodyLength, fin, stream->data.userData);
        if (closed) return false;
        if (stream->dead) return true;
        if (fin) stream->data.inStream = nullptr;
    }
    if (fin) streamMaybeClosed(stream);
    return true;
}

inline bool Http2Connection::handleHeaderBlock(uint32_t streamId, uint8_t flags, const unsigned char *block, size_t length) {
    bool endStream = (flags & http2::END_STREAM) != 0;
    Http2Response *existing = findStream(streamId);

    /* Decode first whatever we decide about the stream: the HPACK dynamic
     * table is connection state and must see every block. */
    uint32_t limit = maxHeaderListSize();
    size_t hardCap = std::max<size_t>((size_t) limit * http2::HEADER_BLOCK_HARD_CAP_FACTOR, http2::LOCAL_MAX_FRAME_SIZE);
    if (length > hardCap) return connectionError(http2::ERR_ENHANCE_YOUR_CALM);
    std::vector<char> localBuffer;
    std::vector<us_quic_header_t> localList;
    bool nested = ctx->dispatchDepth > 0;
    std::vector<char> &buf = nested ? localBuffer : ctx->decodeBuffer;
    std::vector<us_quic_header_t> &list = nested ? localList : ctx->decodedHeaders;
    if (buf.size() < (size_t) limit + 64) buf.resize((size_t) limit + 64);
    list.clear();
    size_t used = 0, decoded = 0, fields = 0;
    const unsigned char *p = block, *end = block + length;
    while (p < end) {
        lsxpack_header_t x;
        size_t room = buf.size() - used;
        lsxpack_header_prepare_decode(&x, buf.data() + used, 0, room > LSXPACK_MAX_STRLEN ? LSXPACK_MAX_STRLEN : room);
        int rc = lshpack_dec_decode(&dec, &p, end, &x);
        if (rc == LSHPACK_ERR_MORE_BUF) {
            size_t need = used + x.val_len + 64;
            if (x.val_len > LSXPACK_MAX_STRLEN || buf.size() >= hardCap || room >= LSXPACK_MAX_STRLEN) {
                return connectionError(http2::ERR_ENHANCE_YOUR_CALM);
            }
            buf.resize(std::min(hardCap, std::max(buf.size() * 2, need)));
            continue;
        }
        if (rc != 0) return connectionError(http2::ERR_COMPRESSION_ERROR);
        decoded += lsxpack_header_get_dec_size(&x);
        fields++;
        /* Past the 431 thresholds we keep decoding only to keep HPACK state in
         * sync; a block that expands far beyond them is an attack, not a request. */
        if (decoded > hardCap || fields > http2::MAX_HEADER_FIELDS * 2) return connectionError(http2::ERR_ENHANCE_YOUR_CALM);
        if (list.size() > http2::MAX_HEADER_FIELDS) continue;
        /* Offsets for now; buf may still grow. */
        list.push_back({(const char *) (uintptr_t) (x.buf + x.name_offset - buf.data()), x.name_len,
                        (const char *) (uintptr_t) (x.buf + x.val_offset - buf.data()), x.val_len, x.hpack_index});
        used += lsxpack_header_get_dec_size(&x);
    }
    for (us_quic_header_t &h : list) {
        h.name = buf.data() + (uintptr_t) h.name;
        h.value = buf.data() + (uintptr_t) h.value;
    }
    bool tooLarge = used > limit || list.size() > http2::MAX_HEADER_FIELDS;
    bool selfDependent = headerBlockSelfDependent;
    headerBlockSelfDependent = false;

    if (existing) {
        /* A later HEADERS on an open stream is the trailer section: it must
         * end the stream, and trailers aren't surfaced. */
        if (existing->remoteClosed) return streamError(streamId, existing, http2::ERR_STREAM_CLOSED);
        bool badTrailer = !endStream || tooLarge;
        for (size_t i = 0; !badTrailer && i < list.size(); i++) {
            const us_quic_header_t &h = list[i];
            badTrailer = h.name[0] == ':' || !http2::validFieldName(h.name, h.name_len) || !http2::validFieldValue(h.value, h.value_len);
        }
        if (badTrailer) return streamError(streamId, existing, http2::ERR_PROTOCOL_ERROR);
        existing->remoteClosed = true;
        if (existing->declaredContentLength >= 0 && existing->receivedBodyBytes != (uint64_t) existing->declaredContentLength) {
            return streamError(streamId, existing, http2::ERR_PROTOCOL_ERROR);
        }
        if (existing->data.inStream && !existing->finDelivered) {
            existing->finDelivered = true;
            existing->data.inStream(existing, "", 0, true, existing->data.userData);
            if (closed) return false;
            if (existing->dead) return true;
            existing->data.inStream = nullptr;
        }
        streamMaybeClosed(existing);
        return true;
    }

    if (streamId <= lastStreamId) {
        /* HEADERS racing our RST_STREAM is ignored; otherwise the peer is
         * reusing a closed stream or going backwards (§5.1.1). */
        if (wasResetByPeer(streamId)) return streamError(streamId, nullptr, http2::ERR_STREAM_CLOSED);
        if (wasResetByUs(streamId)) return true;
        return connectionError(streamId == lastStreamId ? http2::ERR_STREAM_CLOSED : http2::ERR_PROTOCOL_ERROR);
    }
    lastStreamId = streamId;

    if (goawaySent) {
        /* We told the peer where we stopped; later streams and their DATA
         * are ignored as if we had refused them. */
        noteResetByUs(streamId);
        return true;
    }
    if (streams.size() >= http2::LOCAL_MAX_CONCURRENT_STREAMS) {
        return streamError(streamId, nullptr, http2::ERR_REFUSED_STREAM);
    }
    lastProcessedStreamId = streamId;
    if (tooLarge) {
        Http2Response *stream = new Http2Response(this, streamId, peerInitialWindowSize);
        stream->remoteClosed = endStream;
        streams.push_back(stream);
        stream->writeStatus("431")->end();
        return !closed;
    }

    /* Request validation (§8.3): pseudo-headers first, exactly the request
     * set, each once; connection-specific fields are malformed. */
    bool sawRegular = false, malformed = false, isConnect = false;
    unsigned seen = 0; /* 1 :method, 2 :scheme, 4 :path, 8 :authority */
    int64_t contentLength = -1;
    std::string_view authority, host, path, method;
    for (const us_quic_header_t &h : list) {
        std::string_view name{h.name, h.name_len}, value{h.value, h.value_len};
        http2::Field f = http2::classify(h.qpack_index, name);
        if (f == http2::Field::Other && !http2::validFieldName(h.name, h.name_len)) { malformed = true; break; }
        if (!http2::validFieldValue(h.value, h.value_len)) { malformed = true; break; }
        if (name[0] == ':') {
            if (sawRegular) { malformed = true; break; }
            unsigned bit;
            switch (f) {
            case http2::Field::Method: bit = 1; method = value; isConnect = value == "CONNECT"; break;
            case http2::Field::Scheme: bit = 2; break;
            case http2::Field::Path: bit = 4; path = value; break;
            case http2::Field::Authority: bit = 8; authority = value; break;
            default: bit = 0; break;
            }
            if (!bit || (seen & bit) || value.empty()) { malformed = true; break; }
            seen |= bit;
        } else {
            sawRegular = true;
            switch (f) {
            case http2::Field::ConnectionSpecific: malformed = true; break;
            case http2::Field::Te: malformed = !(value.size() == 8 && asciiIEquals(value, "trailers")); break;
            case http2::Field::Host: malformed = !host.empty(); host = value; break;
            case http2::Field::ContentLength: {
                uint64_t v = 0;
                auto r = std::from_chars(value.data(), value.data() + value.size(), v);
                malformed = r.ec != std::errc() || r.ptr != value.data() + value.size() || contentLength >= 0 || v > (uint64_t) INT64_MAX;
                contentLength = (int64_t) v;
                break;
            }
            default: break;
            }
            if (malformed) break;
        }
    }
    if (!malformed) {
        malformed = isConnect ? seen != (1 | 8) : (seen & 7) != 7;
    }
    if (!malformed && endStream && contentLength > 0) malformed = true;
    if (selfDependent) malformed = true;
    if (!malformed && !validPseudoHeaderTarget(method, path, authority, host)) malformed = true;
    if (malformed) {
        return streamError(streamId, nullptr, http2::ERR_PROTOCOL_ERROR);
    }

    Http2Response *stream = new Http2Response(this, streamId, peerInitialWindowSize);
    stream->declaredContentLength = contentLength;
    stream->remoteClosed = endStream;
    streams.push_back(stream);
    progressed = true;
    if (!http2::isKnownMethod(method)) {
        /* RFC 9110 §15.6.2. The router would dispatch it to the "any" handler,
         * which cannot represent the method and would report GET. */
        stream->writeStatus("501 Not Implemented")->end();
        return !closed;
    }
    return dispatchRequest(stream, list.data(), (unsigned) list.size());
}

inline bool Http2Connection::dispatchRequest(Http2Response *stream, const us_quic_header_t *headers, unsigned count) {
    Http2Request req(headers, count);
    if (!(ctx->parentFlags && ctx->parentFlags->usingCustomExpectHandler) && req.getHeader("expect") == "100-continue") {
        stream->writeContinue();
    }
    ctx->dispatchDepth++;
    ctx->router.getUserData() = {stream, &req};
    bool routed = ctx->router.route(req.getMethod(), req.getUrl());
    ctx->dispatchDepth--;
    if (closed) return false;
    if (!routed && !stream->dead) {
        stream->writeStatus("404 Not Found")->end();
    }
    if (stream->dead) return true;
    /* A request whose HEADERS carried END_STREAM has no body; a handler that
     * armed onData is waiting for the terminating call, so deliver it now. */
    if (stream->remoteClosed && stream->data.inStream && !stream->finDelivered) {
        stream->finDelivered = true;
        stream->data.inStream(stream, "", 0, true, stream->data.userData);
        if (closed) return false;
        if (stream->dead) return true;
        stream->data.inStream = nullptr;
    }
    streamMaybeClosed(stream);
    return true;
}

/* ─── Http2Response out-of-line ───────────────────────────────────────────── */

inline void Http2Response::writeMark() {
    if (data.state & Http2ResponseData::HTTP_WROTE_DATE_HEADER) return;
    data.state |= Http2ResponseData::HTTP_WROTE_DATE_HEADER;
    LoopData *ld = (LoopData *) us_loop_ext(us_socket_group_loop(us_socket_group(conn->s)));
    writeHeader("date", std::string_view{ld->date, 29});
}

inline Http2Response *Http2Response::writeContinue() {
    if (dead || localClosed) return this;
    conn->writeInformational(this, "100");
    conn->scheduleFlush();
    return this;
}

inline void Http2Response::flushHeaders(bool) {
    if (dead) return;
    if (!(data.state & Http2ResponseData::HTTP_WRITE_CALLED)) {
        writeStatus("200");
        writeMark();
        conn->writeHeaderBlock(this, false);
        data.state |= Http2ResponseData::HTTP_WRITE_CALLED;
        conn->scheduleFlush();
    }
}

inline bool Http2Response::write(std::string_view chunk, size_t *writtenPtr) {
    if (writtenPtr) *writtenPtr = 0;
    if (dead || localClosed) return false;
    flushHeaders();
    if (data.backpressure.length() != 0) {
        data.backpressure.append(chunk.data(), chunk.length());
        conn->markWantsWrite(this);
        conn->scheduleFlush();
        return false;
    }
    size_t w = conn->writeData(this, chunk.data(), chunk.length(), false);
    data.offset += w;
    if (writtenPtr) *writtenPtr = w;
    if (w < chunk.length()) {
        data.backpressure.append(chunk.data() + w, chunk.length() - w);
        conn->markWantsWrite(this);
    }
    conn->scheduleFlush();
    return w == chunk.length();
}

inline void Http2Response::endWithoutBody(std::optional<size_t> reportedContentLength, bool) {
    if (dead) return;
    if (reportedContentLength.has_value() && !(data.state & Http2ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER)) {
        writeHeader("content-length", (uint64_t) *reportedContentLength);
        data.state |= Http2ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER;
    }
    if (data.state & Http2ResponseData::HTTP_WRITE_CALLED) {
        if (data.backpressure.length() != 0) {
            /* Body bytes still parked behind the window: END_STREAM follows them. */
            data.endAfterDrain = true;
            conn->markWantsWrite(this);
        } else if (!localClosed) {
            conn->writeEndStream(this);
        }
    } else {
        writeStatus("200");
        writeMark();
        conn->writeHeaderBlock(this, true);
        data.state |= Http2ResponseData::HTTP_WRITE_CALLED;
    }
    markDone();
    Http2Connection *c = conn;
    c->streamMaybeClosed(this);
    c->scheduleFlush();
}

inline bool Http2Response::sendTerminatingChunk(bool) {
    if (dead) return true;
    flushHeaders();
    if (data.backpressure.length() != 0) {
        data.endAfterDrain = true;
        conn->markWantsWrite(this);
        return false;
    }
    if (!localClosed) conn->writeEndStream(this);
    markDone();
    Http2Connection *c = conn;
    c->streamMaybeClosed(this);
    c->scheduleFlush();
    return true;
}

inline bool Http2Response::internalEnd(std::string_view body, uint64_t totalSize, bool optional, bool) {
    if (dead || localClosed) return !optional;
    data.totalSize = totalSize;
    Http2Connection *c = conn;

    if (!(data.state & Http2ResponseData::HTTP_WRITE_CALLED)) {
        writeStatus("200");
        writeMark();
        if (!(data.state & Http2ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER)) {
            writeHeader("content-length", totalSize);
            data.state |= Http2ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER;
        }
        if (body.empty() && data.offset >= totalSize) {
            c->writeHeaderBlock(this, true);
            data.state |= Http2ResponseData::HTTP_WRITE_CALLED;
            markDone();
            c->streamMaybeClosed(this);
            c->scheduleFlush();
            return true;
        }
        c->writeHeaderBlock(this, false);
        data.state |= Http2ResponseData::HTTP_WRITE_CALLED;
    }

    if (data.backpressure.length() != 0) {
        if (!optional) {
            data.backpressure.append(body.data(), body.length());
            data.endAfterDrain = true;
        }
        c->markWantsWrite(this);
        c->scheduleFlush();
        return false;
    }

    bool finishes = data.offset + body.length() >= totalSize;
    size_t w = c->writeData(this, body.data(), body.length(), finishes);
    data.offset += w;
    if (w < body.length()) {
        if (!optional) {
            data.backpressure.append(body.data() + w, body.length() - w);
            data.endAfterDrain = true;
        }
        c->markWantsWrite(this);
        c->scheduleFlush();
        return false;
    }
    if (finishes) {
        if (!localClosed) c->writeEndStream(this);
        markDone();
        c->streamMaybeClosed(this);
        c->scheduleFlush();
        return true;
    }
    /* tryEnd with more to come: the caller continues from onWritable. */
    c->markWantsWrite(this);
    c->scheduleFlush();
    return false;
}

inline void Http2Response::markDone() {
    data.onWritable = nullptr;
    data.inStream = nullptr;
    /* onAborted stays armed: the stream is freed once both sides are done
     * and the sweep uses it to tell the holder (see the lifetime rule up top). */
    data.state |= Http2ResponseData::HTTP_END_CALLED;
    data.state &= ~Http2ResponseData::HTTP_RESPONSE_PENDING;
}

inline bool Http2Response::drain() {
    /* One slice per drain pass (see drainWritable); the onWritable handler
     * below is likewise bounded through sendAllowance. */
    size_t budget = conn->drainSlice ? conn->drainSlice : SIZE_MAX;
    while (data.backpressure.length() != 0) {
        if (budget == 0) return false;
        bool last = data.endAfterDrain;
        size_t w = conn->writeData(this, data.backpressure.data(), std::min(data.backpressure.length(), budget), last && data.backpressure.length() <= budget);
        if (w == 0) return false;
        data.offset += w;
        data.backpressure.erase(w);
        budget -= w;
    }
    if (data.endAfterDrain) {
        data.endAfterDrain = false;
        if (!localClosed) conn->writeEndStream(this);
        markDone();
        return true;
    }
    if (data.onWritable) {
        return data.onWritable(this, data.offset, data.writableUserData);
    }
    return true;
}

inline Http2Response *Http2Response::pause() {
    if (paused) return this;
    paused = true;
    /* Like HTTP/1: a request the app has paused doesn't idle out. */
    pausedTimeoutS = timeoutS;
    timeoutS = 0;
    conn->recomputeIdleTimeout();
    return this;
}

inline Http2Response *Http2Response::resume() {
    if (!paused) return this;
    paused = false;
    timeoutS = pausedTimeoutS;
    conn->recomputeIdleTimeout();
    if (!dead && !remoteClosed && unackedReceive) {
        conn->writeWindowUpdate(id, unackedReceive);
        unackedReceive = 0;
        conn->scheduleFlush();
    }
    return this;
}

inline void Http2Response::growReceiveWindow() {
    if (dead || remoteClosed || wide) return;
    wide = true;
    conn->writeWindowUpdate(id, http2::LOCAL_STREAM_WINDOW_SIZE - receiveWindow + unackedReceive);
    receiveWindow = http2::LOCAL_STREAM_WINDOW_SIZE;
    unackedReceive = 0;
    conn->scheduleFlush();
}

inline Http2Response *Http2Response::cork(MoveOnlyFunction<void()> &&fn) {
    Http2Connection *c = conn;
    c->busy++;
    fn();
    c->busy--;
    if (c->closed) {
        if (c->busy == 0) delete c;
        return this;
    }
    /* Outermost holder outside a socket event: whatever fn() queued (bytes
     * in out, retired streams) goes to the deferred pass. */
    if (c->busy == 0) c->ctx->scheduleSweep(c);
    return this;
}

inline void Http2Response::setTimeout(uint8_t seconds) {
    if (dead) return;
    uint8_t v = seconds == 255 ? 254 : seconds;
    /* While paused the timeout is suspended; the new value applies on resume. */
    if (paused) { pausedTimeoutS = v; return; }
    timeoutS = v;
    conn->recomputeIdleTimeout();
}

inline void Http2Response::resetTimeout() {
    if (!dead) conn->touch();
}

inline void Http2Response::close(http2::ErrorCode code) {
    if (dead) return;
    Http2Connection *c = conn;
    if (!reset && !(localClosed && remoteClosed)) {
        c->writeRstStream(id, code);
        reset = true;
    }
    c->retireStream(this, false);
    c->scheduleFlush();
}

}

#endif
