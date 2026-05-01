#ifndef UWS_H2CONTEXT_H
#define UWS_H2CONTEXT_H
// clang-format off

/* HTTP/2 server for Bun.serve(). Built on the same uSockets TLS socket as
 * the HTTP/1 context: an ALPN select cb offers "h2,http/1.1" and, after the
 * handshake, sockets that negotiated "h2" are adopted into this child
 * context. Per-connection state (HPACK codecs, flow control, stream map,
 * frame-parse buffer) lives in the socket ext; each stream is a
 * heap-allocated Http2Response.
 *
 * Public surface (Http2App/Response/Request) mirrors Http3* so Zig's
 * AnyResponse/AnyRequest `inline else` dispatch works unchanged.
 *
 * RFC 9113 (framing, flow control, §6.*), RFC 7541/lshpack (HPACK). Minimal
 * but conformant: SETTINGS/PING/WINDOW_UPDATE handled, PRIORITY and
 * PUSH_PROMISE are acknowledged-and-ignored (server push disabled), HPACK
 * errors and framing violations tear the connection down with GOAWAY. */

#include "Loop.h"
#include "AsyncSocket.h"
#include "AsyncSocketData.h"
#include "Http2ContextData.h"
#include "Http2ResponseData.h"
#include "MoveOnlyFunction.h"

#include <lshpack.h>

#include <wtf/Vector.h>
#include <map>
#include <cstring>
#include <string_view>

namespace uWS {

struct Http2Request;
struct Http2Response;
struct Http2Context;

/* ─────── wire constants (RFC 9113 §6) ─────── */
namespace h2 {
    static constexpr std::string_view PREFACE = "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";
    static constexpr int32_t DEFAULT_WINDOW   = 65535;
    static constexpr uint32_t DEFAULT_FRAME   = 16384;
    static constexpr size_t FRAME_HEADER_SIZE = 9;
    static constexpr uint32_t MAX_HEADER_LIST = 64 * 1024;
    static constexpr uint32_t MAX_STREAMS     = 128;
    /* Advertise a generous per-stream window so downloads aren't throttled
     * by the spec default. Connection window is also bumped on open. */
    static constexpr int32_t LOCAL_INIT_WINDOW = 1024 * 1024;

    enum FrameType : uint8_t {
        DATA = 0, HEADERS = 1, PRIORITY = 2, RST_STREAM = 3, SETTINGS = 4,
        PUSH_PROMISE = 5, PING = 6, GOAWAY = 7, WINDOW_UPDATE = 8, CONTINUATION = 9,
    };
    enum Flags : uint8_t {
        END_STREAM = 0x1, ACK = 0x1, END_HEADERS = 0x4, PADDED = 0x8, PRIO = 0x20,
    };
    /* Prefixed — winerror.h on Windows #defines NO_ERROR, and several of
     * the others collide with other platform headers. */
    enum ErrorCode : uint32_t {
        ERR_NO_ERROR = 0, ERR_PROTOCOL = 1, ERR_INTERNAL = 2, ERR_FLOW_CONTROL = 3,
        ERR_STREAM_CLOSED = 5, ERR_FRAME_SIZE = 6, ERR_REFUSED_STREAM = 7, ERR_CANCEL = 8,
        ERR_COMPRESSION = 9, ERR_ENHANCE_YOUR_CALM = 11,
    };

    static inline void writeFrameHeader(char *dst, uint32_t len, uint8_t type,
                                        uint8_t flags, uint32_t stream) {
        dst[0] = (char)((len >> 16) & 0xff);
        dst[1] = (char)((len >> 8) & 0xff);
        dst[2] = (char)(len & 0xff);
        dst[3] = (char) type;
        dst[4] = (char) flags;
        dst[5] = (char)((stream >> 24) & 0x7f);
        dst[6] = (char)((stream >> 16) & 0xff);
        dst[7] = (char)((stream >> 8) & 0xff);
        dst[8] = (char)(stream & 0xff);
    }
}

/* ─────── per-connection state (socket ext) ─────── */
struct Http2Connection : AsyncSocketData<true> {
    struct lshpack_enc enc;
    struct lshpack_dec dec;
    bool hpackInit = false;
    bool prefaceConsumed = false;
    bool sentPreface = false;
    bool goaway = false;

    /* Frame-parse accumulator. Bytes are appended here until a complete
     * 9-byte header + payload is available, then drained. */
    std::string rx;
    /* Header-block-fragment accumulator across HEADERS + CONTINUATION.
     * `continuationStream` is the only stream allowed to send frames until
     * END_HEADERS (§6.10). */
    std::string headerBlock;
    uint32_t continuationStream = 0;
    bool continuationEndStream = false;

    /* Flow control. */
    int32_t connSendWindow = h2::DEFAULT_WINDOW;
    int32_t connRecvWindow = h2::LOCAL_INIT_WINDOW;
    /* Peer's SETTINGS. */
    uint32_t remoteMaxFrame = h2::DEFAULT_FRAME;
    int32_t remoteInitialWindow = h2::DEFAULT_WINDOW;

    /* Highest client stream ID seen; used for GOAWAY. */
    uint32_t lastStreamId = 0;

    /* Live streams, keyed by client-initiated odd IDs. std::map over
     * HashMap for ordered iteration (drain fairness) and stable pointers
     * across insert. */
    std::map<uint32_t, Http2Response *> streams;
    /* Streams that completed while a callback was on the stack. We can't
     * `delete` inside markDone() because the caller (Zig's StaticRoute,
     * RequestContext.renderBytes, …) still holds the pointer and calls
     * clearAborted()/clearOnWritable() right after tryEnd() returns.
     * H3 gets away with this because lsquic defers stream teardown to
     * the next process_conns(); we mimic that by sweeping at the end of
     * each frame-dispatch pass. */
    WTF::Vector<Http2Response *, 4> pendingDelete;
    int dispatchDepth = 0;

    /* Scratch for HPACK decode; one per connection avoids per-header
     * allocation. Sized to the advertised MAX_HEADER_LIST_SIZE. */
    char hpackBuf[h2::MAX_HEADER_LIST];

    ~Http2Connection();

    void initHpack() {
        if (hpackInit) return;
        lshpack_enc_init(&enc);
        lshpack_dec_init(&dec);
        hpackInit = true;
    }
};

}

/* Http2Response needs Http2Connection defined, and Http2Context needs both. */
#include "Http2Response.h"
#include "Http2Request.h"

namespace uWS {

inline Http2Connection::~Http2Connection() {
    for (auto &kv : streams) delete kv.second;
    streams.clear();
    for (auto *r : pendingDelete) delete r;
    pendingDelete.shrink(0);
    if (hpackInit) {
        lshpack_enc_cleanup(&enc);
        lshpack_dec_cleanup(&dec);
    }
}

/* Heap-allocated owner of one H2 server's socket group + router. Mirrors
 * HttpContext<SSL>'s shape: `group.ext` points back to `this` so vtable
 * handlers recover the typed context via fromSocket(). Sockets are adopted
 * into `group` from HttpContext<true>::onData once ALPN negotiates h2; the
 * SSL* stays on the socket, so TLS decryption continues transparently. */
struct Http2Context {

    us_socket_group_t group{};
    Http2ContextData data;

    Http2ContextData *getContextData() { return &data; }
    us_socket_group_t *getSocketGroup() { return &group; }

    static Http2Context *fromSocket(us_socket_t *s) {
        return (Http2Context *) us_socket_group_ext(us_socket_group(s));
    }
    static Http2ContextData *getContextData(us_socket_t *s) {
        return &fromSocket(s)->data;
    }
    static Http2Connection *conn(us_socket_t *s) {
        return (Http2Connection *) us_socket_ext(s);
    }

    /* ── vtable handlers ────────────────────────────────────────────── */

    static us_socket_t *onOpen(us_socket_t *s, int, char *, int) {
        new (us_socket_ext(s)) Http2Connection();
        conn(s)->initHpack();
        fromSocket(s)->sendServerPreface(s);
        us_socket_timeout(s, getContextData(s)->idleTimeoutS);
        return s;
    }

    static us_socket_t *onClose(us_socket_t *s, int, void *) {
        ((AsyncSocket<true> *) s)->uncorkWithoutSending();
        Http2Connection *c = conn(s);
        /* onAborted may re-enter JS → drainMicrotasks → resolve a
         * *sibling* stream's pending response → end() →
         * maybeDestroy() → c->streams.erase(sibling). That can free
         * the map node any map iterator points at, so snapshot the
         * response pointers first and iterate the snapshot.
         * dispatchDepth keeps the Http2Response heap objects alive
         * (parked in pendingDelete) until ~Http2Connection frees
         * everything in one pass. */
        c->dispatchDepth++;
        WTF::Vector<Http2Response *, 16> live;
        live.reserveCapacity(c->streams.size());
        for (auto &kv : c->streams) live.append(kv.second);
        for (auto *r : live) {
            if (r->dead) continue;
            Http2ResponseData *d = r->getHttpResponseData();
            if (d->onAborted) d->onAborted(r, d->userData);
        }
        c->~Http2Connection();
        return s;
    }

    static us_socket_t *onSocketData(us_socket_t *s, char *data, int length) {
        if (us_socket_is_shut_down(s)) return s;
        us_socket_ref(s);
        ((AsyncSocket<true> *) s)->cork();
        Http2Connection *c = conn(s);
        c->dispatchDepth++;
        fromSocket(s)->onData(s, data, length);
        if (!us_socket_is_closed(s)) {
            c->dispatchDepth--;
            fromSocket(s)->sweep(s);
            us_socket_unref(s);
            ((AsyncSocket<true> *) s)->uncork();
            us_socket_timeout(s, getContextData(s)->idleTimeoutS);
        }
        return s;
    }

    static us_socket_t *onWritable(us_socket_t *s) {
        auto *as = (AsyncSocket<true> *) s;
        if (as->getBufferedAmount() > 0) {
            as->flush();
            if (as->getBufferedAmount() > 0) {
                us_socket_timeout(s, getContextData(s)->idleTimeoutS);
                return s;
            }
        }
        Http2Connection *c = conn(s);
        c->dispatchDepth++;
        fromSocket(s)->drainStreams(s);
        if (!us_socket_is_closed(s)) {
            c->dispatchDepth--;
            fromSocket(s)->sweep(s);
            us_socket_timeout(s, getContextData(s)->idleTimeoutS);
        }
        return s;
    }

    static us_socket_t *onEnd(us_socket_t *s) {
        ((AsyncSocket<true> *) s)->uncorkWithoutSending();
        return us_socket_close(s, 0, nullptr);
    }

    static us_socket_t *onTimeout(us_socket_t *s) {
        Http2Connection *c = conn(s);
        /* Same iterator-safety as onClose: onTimeout can re-enter
         * JS and erase a sibling stream from the map. */
        c->dispatchDepth++;
        WTF::Vector<Http2Response *, 16> live;
        live.reserveCapacity(c->streams.size());
        for (auto &kv : c->streams) live.append(kv.second);
        for (auto *r : live) {
            if (r->dead) continue;
            Http2ResponseData *d = r->getHttpResponseData();
            if (d->onTimeout) d->onTimeout(r, d->userData);
        }
        c->dispatchDepth--;
        ((AsyncSocket<true> *) s)->uncorkWithoutSending();
        return us_socket_close(s, 0, nullptr);
    }

    static inline const us_socket_vtable_t h2VTable = {
        /* on_open */         &onOpen,
        /* on_data */         &onSocketData,
        /* on_fd */           nullptr,
        /* on_writable */     &onWritable,
        /* on_close */        &onClose,
        /* on_timeout */      &onTimeout,
        /* on_long_timeout */ nullptr,
        /* on_end */          &onEnd,
        /* on_connect_error */nullptr,
        /* on_connecting_error */ nullptr,
        /* on_handshake */    nullptr,
        /* is_low_prio */     nullptr,
    };

    /* No listener of its own — sockets are adopted from the parent
     * HttpContext<true> once ALPN picks h2. The group just carries the
     * vtable and collects adopted sockets for close-all/timeout-sweep. */
    static Http2Context *create(Loop *loop, unsigned int idleTimeoutS) {
        auto *ctx = new Http2Context;
        us_socket_group_init(&ctx->group, (us_loop_t *) loop, &h2VTable, ctx);
        ctx->data.idleTimeoutS = idleTimeoutS ? idleTimeoutS : 10;
        return ctx;
    }

    void free() {
        us_socket_group_deinit(&group);
        delete this;
    }

    /* GOAWAY every live connection. The group itself is freed in free(). */
    void shutdown() {
        for (us_socket_t *s = group.head_sockets; s;) {
            us_socket_t *next = s->next;
            if (!us_socket_is_closed(s)) {
                writeGoaway(s, conn(s)->lastStreamId, h2::ERR_NO_ERROR);
                ((AsyncSocket<true> *) s)->flush();
                if (conn(s)->streams.empty()) us_socket_close(s, 0, nullptr);
                else conn(s)->goaway = true;
            }
            s = next;
        }
    }

    void onHttp(std::string_view method, std::string_view pattern,
                MoveOnlyFunction<void(Http2Response *, Http2Request *)> &&handler) {
        Http2ContextData *cd = getContextData();
        std::vector<std::string_view> methods =
            method == "*" ? std::vector<std::string_view>{"*"} : std::vector<std::string_view>{method};
        cd->router.add(methods, pattern, [handler = std::move(handler)](auto *router) mutable {
            auto &ud = router->getUserData();
            ud.httpRequest->setYield(false);
            ud.httpRequest->setParameters(router->getParameters());
            handler(ud.httpResponse, ud.httpRequest);
            return !ud.httpRequest->getYield();
        }, method == "*" ? cd->router.LOW_PRIORITY : cd->router.MEDIUM_PRIORITY);
    }

    /* ─────── outbound framing ─────── */

    void writeFrame(us_socket_t *s, uint8_t type, uint8_t flags,
                    uint32_t stream, const char *payload, uint32_t len) {
        char hdr[h2::FRAME_HEADER_SIZE];
        h2::writeFrameHeader(hdr, len, type, flags, stream);
        auto *as = (AsyncSocket<true> *) s;
        as->write(hdr, (int) sizeof(hdr), false, (int) len);
        if (len) as->write(payload, (int) len, false, 0);
    }

    void sendServerPreface(us_socket_t *s) {
        Http2Connection *c = conn(s);
        if (c->sentPreface) return;
        c->sentPreface = true;
        /* SETTINGS_MAX_CONCURRENT_STREAMS, SETTINGS_INITIAL_WINDOW_SIZE,
         * SETTINGS_MAX_FRAME_SIZE (matches the 1 MiB enforced in onData so
         * §4.2's advertised↔enforced limits agree), SETTINGS_MAX_HEADER_LIST_SIZE.
         * Push stays at its default (1) but a PUSH_PROMISE from a client is
         * a protocol error regardless. */
        unsigned char p[24];
        auto put = [&](int off, uint16_t id, uint32_t v) {
            p[off] = (unsigned char)(id >> 8); p[off+1] = (unsigned char) id;
            p[off+2] = (unsigned char)(v >> 24); p[off+3] = (unsigned char)(v >> 16);
            p[off+4] = (unsigned char)(v >> 8); p[off+5] = (unsigned char) v;
        };
        put(0, 3, h2::MAX_STREAMS);
        put(6, 4, (uint32_t) h2::LOCAL_INIT_WINDOW);
        put(12, 5, 1u << 20);
        put(18, 6, h2::MAX_HEADER_LIST);
        writeFrame(s, h2::SETTINGS, 0, 0, (const char *) p, sizeof(p));
        /* Connection window starts at 64KiB regardless of SETTINGS; open it
         * to match the per-stream window so the first upload isn't
         * throttled before our first WINDOW_UPDATE. */
        writeWindowUpdate(s, 0, (uint32_t)(h2::LOCAL_INIT_WINDOW - h2::DEFAULT_WINDOW));
    }

    void writeWindowUpdate(us_socket_t *s, uint32_t stream, uint32_t inc) {
        if (inc == 0) return;
        unsigned char p[4] = {(unsigned char)(inc >> 24), (unsigned char)(inc >> 16),
                              (unsigned char)(inc >> 8), (unsigned char) inc};
        writeFrame(s, h2::WINDOW_UPDATE, 0, stream, (const char *) p, 4);
    }

    void writeRstStream(us_socket_t *s, uint32_t stream, uint32_t code) {
        unsigned char p[4] = {(unsigned char)(code >> 24), (unsigned char)(code >> 16),
                              (unsigned char)(code >> 8), (unsigned char) code};
        writeFrame(s, h2::RST_STREAM, 0, stream, (const char *) p, 4);
    }

    void writeGoaway(us_socket_t *s, uint32_t lastStream, uint32_t code) {
        unsigned char p[8] = {
            (unsigned char)((lastStream >> 24) & 0x7f), (unsigned char)(lastStream >> 16),
            (unsigned char)(lastStream >> 8), (unsigned char) lastStream,
            (unsigned char)(code >> 24), (unsigned char)(code >> 16),
            (unsigned char)(code >> 8), (unsigned char) code,
        };
        writeFrame(s, h2::GOAWAY, 0, 0, (const char *) p, 8);
    }

    /* Serialise a HEADERS frame via HPACK. Headers larger than
     * remoteMaxFrame are split into HEADERS + CONTINUATION. */
    void writeHeaders(us_socket_t *s, uint32_t stream, Http2ResponseData *d,
                      bool endStream) {
        Http2Connection *c = conn(s);
        static thread_local WTF::Vector<unsigned char, 4096> buf;
        buf.shrink(0);
        const char *base = d->hdrBuf.span().data();
        for (auto &h : d->hdrs) {
            /* lsxpack wants name+value contiguous; hdrBuf is laid out that
             * way (appendHeader lowercases the name in-place). lshpack
             * narrows offsets/lengths to lsxpack_strlen_t (uint16_t), so
             * pass a per-header base instead of a cumulative offset —
             * otherwise crossing 64 KiB of response headers wraps the
             * offset and encodes garbage. A single header whose name+
             * value exceeds 64 KiB is clamped for the same reason. */
            size_t nameOff = (size_t)(uintptr_t) h.name;
            unsigned nlen = h.name_len;
            unsigned vlen = h.value_len;
            if (nlen > LSXPACK_MAX_STRLEN) nlen = LSXPACK_MAX_STRLEN;
            if ((size_t) nlen + vlen > LSXPACK_MAX_STRLEN)
                vlen = (unsigned)(LSXPACK_MAX_STRLEN - nlen);
            struct lsxpack_header xh;
            lsxpack_header_set_offset2(&xh, base + nameOff, 0, nlen, nlen, vlen);
            /* Worst case is one literal byte per input byte plus ~6 bytes
             * of varint framing. */
            size_t need = buf.size() + h.name_len + h.value_len + 32;
            if (buf.capacity() < need) buf.reserveCapacity(need);
            buf.grow(buf.capacity());
            unsigned char *out = buf.mutableSpan().data();
            unsigned char *p = lshpack_enc_encode(&c->enc, out + (need - (h.name_len + h.value_len + 32)),
                                                  out + buf.size(), &xh);
            buf.shrink((size_t)(p - out));
        }
        d->hdrBuf.shrink(0);
        d->hdrs.shrink(0);

        const unsigned char *block = buf.span().data();
        size_t remaining = buf.size();
        bool first = true;
        do {
            size_t chunk = remaining < c->remoteMaxFrame ? remaining : c->remoteMaxFrame;
            bool last = chunk == remaining;
            uint8_t flags = last ? h2::END_HEADERS : 0;
            if (first && endStream) flags |= h2::END_STREAM;
            writeFrame(s, first ? h2::HEADERS : h2::CONTINUATION, flags, stream,
                       (const char *) block, (uint32_t) chunk);
            block += chunk; remaining -= chunk; first = false;
        } while (remaining);
    }

    /* Push body bytes into DATA frames under both flow-control windows and
     * the socket's backpressure. Returns bytes framed; END_STREAM is set on
     * the final frame only if `end` and everything fit. */
    size_t writeData(us_socket_t *s, Http2Response *r, const char *data,
                     size_t len, bool end) {
        Http2Connection *c = conn(s);
        size_t sent = 0;
        while (true) {
            int32_t window = c->connSendWindow < r->sendWindow ? c->connSendWindow : r->sendWindow;
            if (window <= 0 && len > sent) break;
            size_t room = (size_t)(window < 0 ? 0 : window);
            size_t chunk = len - sent;
            if (chunk > room) chunk = room;
            if (chunk > c->remoteMaxFrame) chunk = c->remoteMaxFrame;
            bool last = (sent + chunk == len);
            uint8_t flags = (last && end) ? h2::END_STREAM : 0;
            writeFrame(s, h2::DATA, flags, r->id, data + sent, (uint32_t) chunk);
            c->connSendWindow -= (int32_t) chunk;
            r->sendWindow -= (int32_t) chunk;
            sent += chunk;
            if (last) break;
            /* Don't keep copying into AsyncSocket backpressure once the
             * kernel stopped accepting — onWritable resumes us. */
            if (((AsyncSocket<true> *) s)->getBufferedAmount() > 256 * 1024) break;
        }
        return sent;
    }

    /* Free streams that completed while a handler was on the stack, and
     * close the connection if GOAWAY was sent and the last stream just
     * drained. The close check is independent of pendingDelete so a
     * late event can still close after the list drained earlier. */
    void sweep(us_socket_t *s) {
        Http2Connection *c = conn(s);
        if (c->dispatchDepth > 0) return;
        if (!c->pendingDelete.isEmpty()) {
            for (auto *r : c->pendingDelete) delete r;
            c->pendingDelete.shrink(0);
        }
        if (c->goaway && c->streams.empty() && !us_socket_is_closed(s)) {
            ((AsyncSocket<true> *) s)->uncork();
            us_socket_close(s, 0, nullptr);
        }
    }

    /* Called from on_writable once TCP drained. Flush each stream's
     * backpressure then give onWritable a turn. drain() → onWritable
     * can re-enter JS → drainMicrotasks → complete a *sibling* stream
     * → c->streams.erase(sibling), so iterate a snapshot instead of
     * the live map. dispatchDepth (set in the caller) keeps the heap
     * objects alive in pendingDelete until sweep(). */
    void drainStreams(us_socket_t *s) {
        Http2Connection *c = conn(s);
        WTF::Vector<Http2Response *, 16> live;
        live.reserveCapacity(c->streams.size());
        for (auto &kv : c->streams) live.append(kv.second);
        for (auto *r : live) {
            if (r->dead) continue;
            if (!r->drain()) continue;
            /* drain() may have completed the response and closed the
             * socket via GOAWAY-last-stream. */
            if (us_socket_is_closed(s)) return;
        }
    }

    /* ─────── inbound framing ─────── */

    void protocolError(us_socket_t *s, uint32_t code) {
        writeGoaway(s, conn(s)->lastStreamId, code);
        ((AsyncSocket<true> *) s)->uncork();
        us_socket_shutdown(s);
        us_socket_close(s, 0, nullptr);
    }

    void onData(us_socket_t *s, const char *data, int length) {
        Http2Connection *c = conn(s);
        c->rx.append(data, (size_t) length);

        if (!c->prefaceConsumed) {
            if (c->rx.size() < h2::PREFACE.size()) return;
            if (memcmp(c->rx.data(), h2::PREFACE.data(), h2::PREFACE.size()) != 0) {
                return protocolError(s, h2::ERR_PROTOCOL);
            }
            c->rx.erase(0, h2::PREFACE.size());
            c->prefaceConsumed = true;
        }

        size_t off = 0;
        while (c->rx.size() - off >= h2::FRAME_HEADER_SIZE) {
            const unsigned char *p = (const unsigned char *) c->rx.data() + off;
            uint32_t len = ((uint32_t) p[0] << 16) | ((uint32_t) p[1] << 8) | p[2];
            uint8_t type = p[3], flags = p[4];
            uint32_t stream = (((uint32_t) p[5] & 0x7f) << 24) |
                              ((uint32_t) p[6] << 16) | ((uint32_t) p[7] << 8) | p[8];
            if (len > (1u << 20)) { /* hard cap regardless of advertised */
                return protocolError(s, h2::ERR_FRAME_SIZE);
            }
            if (c->rx.size() - off < h2::FRAME_HEADER_SIZE + len) break;
            const char *payload = c->rx.data() + off + h2::FRAME_HEADER_SIZE;

            /* §6.10: once a HEADERS without END_HEADERS is received, only
             * CONTINUATION for that stream is allowed until END_HEADERS. */
            if (c->continuationStream &&
                !(type == h2::CONTINUATION && stream == c->continuationStream)) {
                return protocolError(s, h2::ERR_PROTOCOL);
            }

            switch (type) {
            case h2::SETTINGS:
                /* §6.5: stream ID MUST be 0. */
                if (stream != 0) return protocolError(s, h2::ERR_PROTOCOL);
                handleSettings(s, flags, payload, len);
                break;
            case h2::WINDOW_UPDATE: handleWindowUpdate(s, stream, payload, len); break;
            case h2::PING:
                /* §6.7: stream ID MUST be 0. */
                if (stream != 0) return protocolError(s, h2::ERR_PROTOCOL);
                handlePing(s, flags, payload, len);
                break;
            case h2::HEADERS: handleHeaders(s, stream, flags, payload, len); break;
            case h2::CONTINUATION: handleContinuation(s, stream, flags, payload, len); break;
            case h2::DATA: handleData(s, stream, flags, payload, len); break;
            case h2::RST_STREAM:
                /* §6.4: stream ID MUST NOT be 0. */
                if (stream == 0) return protocolError(s, h2::ERR_PROTOCOL);
                handleRstStream(s, stream, payload, len);
                break;
            case h2::GOAWAY:
                /* §6.8: stream ID MUST be 0; payload ≥ 8 (debug data
                 * MAY follow the 8-byte fixed prefix). */
                if (stream != 0 || len < 8) return protocolError(s, h2::ERR_PROTOCOL);
                conn(s)->goaway = true;
                if (conn(s)->streams.empty()) {
                    ((AsyncSocket<true> *) s)->uncork();
                    us_socket_close(s, 0, nullptr);
                    return;
                }
                break;
            case h2::PRIORITY:
                /* §6.3: stream ID MUST NOT be 0. */
                if (stream == 0) return protocolError(s, h2::ERR_PROTOCOL);
                if (len != 5) return protocolError(s, h2::ERR_FRAME_SIZE);
                break;
            case h2::PUSH_PROMISE:
                return protocolError(s, h2::ERR_PROTOCOL);
            default: /* §4.1: unknown types MUST be ignored. */ break;
            }
            if (us_socket_is_closed(s)) return;
            off += h2::FRAME_HEADER_SIZE + len;
        }
        if (off) c->rx.erase(0, off);
    }

    void handleSettings(us_socket_t *s, uint8_t flags, const char *p, uint32_t len) {
        Http2Connection *c = conn(s);
        if (flags & h2::ACK) {
            if (len != 0) return protocolError(s, h2::ERR_FRAME_SIZE);
            return;
        }
        if (len % 6 != 0) return protocolError(s, h2::ERR_FRAME_SIZE);
        bool windowGrew = false;
        for (uint32_t i = 0; i < len; i += 6) {
            const unsigned char *e = (const unsigned char *) p + i;
            uint16_t id = ((uint16_t) e[0] << 8) | e[1];
            uint32_t v = ((uint32_t) e[2] << 24) | ((uint32_t) e[3] << 16) |
                         ((uint32_t) e[4] << 8) | e[5];
            switch (id) {
            case 1: /* HEADER_TABLE_SIZE */
                lshpack_enc_set_max_capacity(&c->enc, v); break;
            case 4: { /* INITIAL_WINDOW_SIZE — §6.9.2 also adjusts open streams */
                if (v > 0x7fffffff) return protocolError(s, h2::ERR_FLOW_CONTROL);
                int32_t delta = (int32_t) v - c->remoteInitialWindow;
                c->remoteInitialWindow = (int32_t) v;
                for (auto &kv : c->streams) {
                    /* §6.9.2: a delta that pushes any window past 2³¹-1
                     * is a connection FLOW_CONTROL_ERROR. Widen to
                     * int64 like the WINDOW_UPDATE paths so a prior
                     * WINDOW_UPDATE to INT32_MAX can't drive this add
                     * into signed overflow. Going negative is
                     * explicitly allowed. */
                    if ((int64_t) kv.second->sendWindow + delta > 0x7fffffff)
                        return protocolError(s, h2::ERR_FLOW_CONTROL);
                    kv.second->sendWindow += delta;
                }
                if (delta > 0) windowGrew = true;
                break;
            }
            case 5: /* MAX_FRAME_SIZE */
                if (v < h2::DEFAULT_FRAME || v > 0xffffff)
                    return protocolError(s, h2::ERR_PROTOCOL);
                c->remoteMaxFrame = v; break;
            default: break; /* §6.5.2: unknown settings MUST be ignored */
            }
        }
        writeFrame(s, h2::SETTINGS, h2::ACK, 0, nullptr, 0);
        /* A raised INITIAL_WINDOW_SIZE is the SETTINGS-path equivalent
         * of a per-stream WINDOW_UPDATE (§6.9.2 is explicit that both
         * adjust the same window). Clients that BDP-autotune —
         * nghttp2, Chrome — open the window this way. Drain now so
         * streams parked on flow-control backpressure resume,
         * mirroring handleWindowUpdate. */
        if (windowGrew) drainStreams(s);
    }

    void handlePing(us_socket_t *s, uint8_t flags, const char *p, uint32_t len) {
        if (len != 8) return protocolError(s, h2::ERR_FRAME_SIZE);
        if (flags & h2::ACK) return;
        writeFrame(s, h2::PING, h2::ACK, 0, p, 8);
    }

    /* Server-initiated stream reset: emit RST_STREAM on the wire AND tear
     * the stream down locally (erase, fire onAborted so the handler drops
     * its pointer, park for sweep). Called from on_data so dispatchDepth
     * keeps the heap object alive in pendingDelete; sweep() runs the
     * goaway-last-stream close at a safe point. */
    void abortStream(us_socket_t *s, uint32_t stream, uint32_t code) {
        writeRstStream(s, stream, code);
        Http2Connection *c = conn(s);
        auto it = c->streams.find(stream);
        if (it == c->streams.end()) return;
        Http2Response *r = it->second;
        Http2ResponseData *d = r->getHttpResponseData();
        c->streams.erase(it);
        r->dead = true;
        d->remoteClosed = true;
        /* Park in pendingDelete *before* the JS-reentrant callback so a
         * server.stop() in an abort listener that happened to fire
         * on_close synchronously would still free `r` cleanly via
         * ~Http2Connection — same defensive shape as handleRstStream's
         * is_closed guard. dispatchDepth>0 keeps sweep() from freeing
         * it mid-callback. */
        c->pendingDelete.append(r);
        if (d->onAborted) {
            auto cb = d->onAborted;
            d->onAborted = nullptr;
            cb(r, d->userData);
        }
    }

    void handleWindowUpdate(us_socket_t *s, uint32_t stream, const char *p, uint32_t len) {
        if (len != 4) return protocolError(s, h2::ERR_FRAME_SIZE);
        uint32_t inc = (((uint32_t)(unsigned char) p[0] & 0x7f) << 24) |
                       ((uint32_t)(unsigned char) p[1] << 16) |
                       ((uint32_t)(unsigned char) p[2] << 8) |
                       (uint32_t)(unsigned char) p[3];
        if (inc == 0) {
            if (stream == 0) return protocolError(s, h2::ERR_PROTOCOL);
            abortStream(s, stream, h2::ERR_PROTOCOL);
            return;
        }
        Http2Connection *c = conn(s);
        if (stream == 0) {
            if ((int64_t) c->connSendWindow + inc > 0x7fffffff)
                return protocolError(s, h2::ERR_FLOW_CONTROL);
            c->connSendWindow += (int32_t) inc;
            drainStreams(s);
        } else if (auto it = c->streams.find(stream); it != c->streams.end()) {
            if ((int64_t) it->second->sendWindow + inc > 0x7fffffff) {
                abortStream(s, stream, h2::ERR_FLOW_CONTROL);
                return;
            }
            it->second->sendWindow += (int32_t) inc;
            it->second->drain();
        }
    }

    void handleHeaders(us_socket_t *s, uint32_t stream, uint8_t flags,
                       const char *p, uint32_t len) {
        Http2Connection *c = conn(s);
        if (stream == 0 || (stream & 1) == 0)
            return protocolError(s, h2::ERR_PROTOCOL);
        /* Strip PADDED and PRIORITY prefixes before collecting the HPACK block. */
        uint32_t pad = 0;
        if (flags & h2::PADDED) {
            if (len < 1) return protocolError(s, h2::ERR_FRAME_SIZE);
            pad = (uint8_t) p[0]; p++; len--;
        }
        if (flags & h2::PRIO) {
            if (len < 5) return protocolError(s, h2::ERR_FRAME_SIZE);
            p += 5; len -= 5;
        }
        if (pad > len) return protocolError(s, h2::ERR_PROTOCOL);
        len -= pad;

        c->headerBlock.assign(p, len);
        c->continuationEndStream = (flags & h2::END_STREAM) != 0;
        if (!(flags & h2::END_HEADERS)) {
            c->continuationStream = stream;
            return;
        }
        dispatchHeaders(s, stream, c->continuationEndStream);
    }

    void handleContinuation(us_socket_t *s, uint32_t stream, uint8_t flags,
                            const char *p, uint32_t len) {
        Http2Connection *c = conn(s);
        /* §6.10: CONTINUATION without a preceding HEADERS-in-progress
         * is a connection PROTOCOL_ERROR. The equality check below
         * doesn't cover this when both are 0 (idle), which would
         * otherwise fall through to dispatchHeaders(s, 0, …) and
         * emit RST_STREAM on stream 0 — itself a §6.4 violation. */
        if (c->continuationStream == 0 || stream != c->continuationStream)
            return protocolError(s, h2::ERR_PROTOCOL);
        c->headerBlock.append(p, len);
        if (c->headerBlock.size() > h2::MAX_HEADER_LIST)
            return protocolError(s, h2::ERR_ENHANCE_YOUR_CALM);
        if (flags & h2::END_HEADERS) {
            c->continuationStream = 0;
            dispatchHeaders(s, stream, c->continuationEndStream);
        }
    }

    void dispatchHeaders(us_socket_t *s, uint32_t stream, bool endStream) {
        Http2Connection *c = conn(s);

        /* Trailers on an open stream: decode (HPACK state is connection-
         * scoped) but only deliver the FIN. */
        if (auto it = c->streams.find(stream); it != c->streams.end()) {
            Http2Response *r = it->second;
            if (!decodeHeaderBlock(s, nullptr)) return;
            if (r->getHttpResponseData()->remoteClosed) {
                /* §5.1: HEADERS in half-closed(remote) → STREAM_CLOSED.
                 * Tear down locally too: once we RST we MUST NOT write
                 * further frames (§6.4), so the handler's eventual
                 * response would be a protocol violation. */
                abortStream(s, stream, h2::ERR_STREAM_CLOSED);
            } else if (endStream) {
                deliverFin(s, r);
            } else {
                /* §8.1: a second HEADERS that doesn't terminate the
                 * stream is a malformed request (trailers MUST carry
                 * END_STREAM). */
                writeRstStream(s, stream, h2::ERR_PROTOCOL);
                deliverFin(s, r);
            }
            return;
        }

        if (stream <= c->lastStreamId) {
            /* §5.1.1: new stream IDs MUST monotonically increase; an
             * unexpected stream identifier is a connection error of
             * type PROTOCOL_ERROR (h2spec 5.1.1/2 expects GOAWAY). */
            return protocolError(s, h2::ERR_PROTOCOL);
        }
        c->lastStreamId = stream;

        if (c->goaway || c->streams.size() >= h2::MAX_STREAMS) {
            if (!decodeHeaderBlock(s, nullptr)) return;
            writeRstStream(s, stream, h2::ERR_REFUSED_STREAM);
            return;
        }

        WTF::Vector<Http2Header, 32> hdrs;
        std::string store;
        if (!decodeHeaderBlock(s, &hdrs, &store)) return;

        auto *res = new Http2Response(s, stream, c->remoteInitialWindow);
        res->getHttpResponseData()->reset();
        res->getHttpResponseData()->remoteClosed = endStream;
        c->streams.emplace(stream, res);

        Http2Request req(hdrs, store, res);
        /* §8.3.1: :method and :path MUST be present (unless CONNECT,
         * which this server doesn't support). A request omitting
         * either is malformed → stream PROTOCOL_ERROR per §8.1.1. */
        if (req.getCaseSensitiveMethod().empty() || req.getFullUrl().empty()) {
            abortStream(s, stream, h2::ERR_PROTOCOL);
            return;
        }
        if (req.getHeader("expect") == "100-continue") res->writeContinue();

        Http2ContextData *cd = getContextData();
        cd->router.getUserData() = {res, &req};
        if (!cd->router.route(req.getMethod(), req.getUrl())) {
            res->writeStatus("404 Not Found");
            res->end({}, false);
            return;
        }
        if (us_socket_is_closed(s)) return;

        /* The handler may have responded synchronously, in which case
         * markDone() → maybeDestroy() already freed `res`. Re-look it
         * up; if gone, we're done. */
        auto it = c->streams.find(stream);
        if (it == c->streams.end()) return;
        Http2ResponseData *d = it->second->getHttpResponseData();
        if (endStream && d->inStream) {
            d->inStream(it->second, "", 0, true, d->userData);
        }
    }

    /* Decode the accumulated header block into `out` (name/value views into
     * `store`). Returns false on HPACK error (connection already torn down).
     * When out==nullptr only the decoder state is advanced. */
    bool decodeHeaderBlock(us_socket_t *s, WTF::Vector<Http2Header, 32> *out,
                           std::string *store = nullptr) {
        Http2Connection *c = conn(s);
        const unsigned char *src = (const unsigned char *) c->headerBlock.data();
        const unsigned char *end = src + c->headerBlock.size();
        if (store) store->reserve(c->headerBlock.size() * 2 + 256);
        size_t used = 0;
        while (src < end) {
            struct lsxpack_header xh;
            lsxpack_header_prepare_decode(&xh, c->hpackBuf, 0, sizeof(c->hpackBuf));
            int rc = lshpack_dec_decode(&c->dec, &src, end, &xh);
            if (rc != 0) {
                protocolError(s, h2::ERR_COMPRESSION);
                return false;
            }
            if (!out) continue;
            size_t nlen = xh.name_len, vlen = xh.val_len;
            if (used + nlen + vlen > h2::MAX_HEADER_LIST) {
                protocolError(s, h2::ERR_ENHANCE_YOUR_CALM);
                return false;
            }
            store->append(c->hpackBuf + xh.name_offset, nlen);
            store->append(c->hpackBuf + xh.val_offset, vlen);
            out->append({(const char *)(uintptr_t) used, (unsigned) nlen,
                         (const char *)(uintptr_t)(used + nlen), (unsigned) vlen});
            used += nlen + vlen;
        }
        c->headerBlock.clear();
        if (out) {
            const char *base = store->data();
            for (auto &h : *out) {
                h.name = base + (uintptr_t) h.name;
                h.value = base + (uintptr_t) h.value;
            }
        }
        return true;
    }

    void handleData(us_socket_t *s, uint32_t stream, uint8_t flags,
                    const char *p, uint32_t len) {
        Http2Connection *c = conn(s);
        if (stream == 0) return protocolError(s, h2::ERR_PROTOCOL);
        uint32_t flowLen = len;
        uint32_t pad = 0;
        if (flags & h2::PADDED) {
            if (len < 1) return protocolError(s, h2::ERR_FRAME_SIZE);
            pad = (uint8_t) p[0]; p++; len--;
        }
        if (pad > len) return protocolError(s, h2::ERR_PROTOCOL);
        len -= pad;

        /* §6.9: connection window is consumed even for unknown/reset streams. */
        c->connRecvWindow -= (int32_t) flowLen;
        if (c->connRecvWindow < h2::LOCAL_INIT_WINDOW / 2) {
            writeWindowUpdate(s, 0, (uint32_t)(h2::LOCAL_INIT_WINDOW - c->connRecvWindow));
            c->connRecvWindow = h2::LOCAL_INIT_WINDOW;
        }

        auto it = c->streams.find(stream);
        if (it == c->streams.end()) {
            /* DATA for a stream we already finished or refused. §6.1:
             * STREAM_CLOSED. Don't blow the connection. */
            if (stream <= c->lastStreamId)
                writeRstStream(s, stream, h2::ERR_STREAM_CLOSED);
            else
                return protocolError(s, h2::ERR_PROTOCOL);
            return;
        }
        Http2Response *r = it->second;
        Http2ResponseData *d = r->getHttpResponseData();
        if (d->remoteClosed) {
            /* §5.1: DATA in half-closed(remote) is a STREAM_CLOSED stream
             * error. The stream is still in c->streams because the
             * server's response hasn't completed yet. Tear down locally
             * too so the handler sees an abort — once we RST we MUST
             * NOT write further frames on this stream (§6.4). */
            abortStream(s, stream, h2::ERR_STREAM_CLOSED);
            return;
        }
        bool fin = (flags & h2::END_STREAM) != 0;
        r->recvWindow -= (int32_t) flowLen;
        /* Flag half-closed(remote) *before* dispatching the final chunk so
         * a handler that responds synchronously inside inStream reaches
         * markDone() with remoteClosed set and doesn't emit the §8.1
         * early-RST(NO_ERROR) for a body the client already ended. */
        if (fin) d->remoteClosed = true;

        if (d->inStream) {
            d->inStream(r, p, len, fin, d->userData);
            if (us_socket_is_closed(s)) return;
            /* inStream may have responded synchronously and freed `r`. */
            it = c->streams.find(stream);
            if (it == c->streams.end()) return;
            r = it->second;
            if (!fin && r->recvWindow < h2::LOCAL_INIT_WINDOW / 2 && !r->paused) {
                writeWindowUpdate(s, stream, (uint32_t)(h2::LOCAL_INIT_WINDOW - r->recvWindow));
                r->recvWindow = h2::LOCAL_INIT_WINDOW;
            }
        } else if (!fin && len > 0) {
            /* Handler never armed onData (GET/HEAD/… per
             * hasRequestBody()); drop the upload rather than buffer
             * unboundedly. Route through abortStream so the local
             * side is torn down too — deliverFin would only set
             * remoteClosed, and with hasResponded()==false
             * maybeDestroy() returns early, so the handler's later
             * response would write to a stream we already RST'd. */
            abortStream(s, stream, h2::ERR_CANCEL);
            return;
        }
        if (fin) r->maybeDestroy();
    }

    /* Terminate the request body: mark half-closed(remote), deliver
     * last=true to inStream so `await req.text()`/ReadableStream
     * resolve, then maybeDestroy. remoteClosed is set *before* the
     * dispatch so a handler that responds synchronously inside
     * inStream reaches markDone() with the client side marked closed
     * and doesn't emit the §8.1 early RST(NO_ERROR). */
    void deliverFin(us_socket_t *s, Http2Response *r) {
        Http2ResponseData *d = r->getHttpResponseData();
        d->remoteClosed = true;
        if (d->inStream) {
            d->inStream(r, "", 0, true, d->userData);
            if (us_socket_is_closed(s)) return;
            /* inStream may have responded synchronously; maybeDestroy()
             * is idempotent via `dead`. */
        }
        r->maybeDestroy();
    }

    void handleRstStream(us_socket_t *s, uint32_t stream, const char *, uint32_t len) {
        if (len != 4) return protocolError(s, h2::ERR_FRAME_SIZE);
        Http2Connection *c = conn(s);
        auto it = c->streams.find(stream);
        if (it == c->streams.end()) return;
        Http2Response *r = it->second;
        Http2ResponseData *d = r->getHttpResponseData();
        c->streams.erase(it);
        if (d->onAborted) d->onAborted(r, d->userData);
        delete r;
        /* onAborted re-enters JS; a server.stop() in an abort listener
         * can close this socket. Check before touching `c` — `r` is
         * ours regardless (erased from the map before the callback),
         * so delete it above either way. */
        if (us_socket_is_closed(s)) return;
        if (c->goaway && c->streams.empty()) {
            ((AsyncSocket<true> *) s)->uncork();
            us_socket_close(s, 0, nullptr);
        }
    }
};

}

#endif
