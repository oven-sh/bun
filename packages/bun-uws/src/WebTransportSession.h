#ifndef UWS_WEBTRANSPORTSESSION_H
#define UWS_WEBTRANSPORTSESSION_H

/* WebSocket-shaped façade over a WebTransport session (draft-ietf-webtrans-
 * http3). The session IS the CONNECT stream; send() ships QUIC DATAGRAMs,
 * end() emits a WT_CLOSE_SESSION capsule on the CONNECT stream then FINs it.
 * Same SendStatus / OpCode surface as WebSocket<SSL,true,USERDATA> so the C
 * ABI in libuwsockets_h3.cpp can pattern-match uws_ws_* and the Zig
 * AnyWebSocket union dispatches without per-method special cases.
 *
 * The struct is a zero-member overlay on us_quic_stream_t (the CONNECT
 * stream); per-session state lives in WebTransportSessionData stored in the
 * stream's ext (the same slot as Http3ResponseData — see Http3ResponseData::wt).
 */

#include "quic.h"
#include "TopicTree.h"
#include "WebSocketContextData.h"
#include "Http3ResponseData.h"

#include <string>
#include <string_view>

namespace uWS {

struct WebTransportSession;

/* Stored in Http3ResponseData::wt once Http3Response::upgradeWebTransport()
 * accepts the CONNECT. Heap-allocated so the per-stream ext stays the size of
 * a plain HTTP response. */
struct WebTransportSessionData {
    void *userData = nullptr;
    Subscriber *subscriber = nullptr;
    /* Reassembly buffer for in-flight client bidi streams. WebTransport
     * gives the client unlimited stream count, but the WebSocket message API
     * delivers whole frames — accumulate until FIN, hand the buffer to the
     * message handler, then drop. Keyed by QUIC stream id (not pointer): a
     * RESET_STREAM never produces a FIN read, and us_quic_stream_t lives in
     * a fixed-size calloc slot that mimalloc recycles LIFO, so a pointer key
     * could splice a dead stream's bytes onto a fresh one. */
    struct InflightStream { unsigned long long id; std::string buf; };
    std::vector<InflightStream> inflight;
    /* Sum of inflight[].buf.length(); per-stream is capped at maxPayloadLength
     * but without an aggregate the client could open N streams each at the
     * cap-minus-one. */
    size_t inflightBytes = 0;
    bool isShuttingDown = false;
    /* Set once send() reports BACKPRESSURE; cleared when the datagram queue
     * drains. Gates drainHandler so a fresh session (whose CONNECT stream
     * gets one post-upgrade wantwrite to flush the 2xx HEADERS) doesn't
     * surface a spurious drain() with bufferedAmount == 0. */
    bool hadBackpressure = false;
    /* Set once closeHandler has run so on_stream_close doesn't fire it a
     * second time after end(). Carries the code/reason for the deferred
     * path (send()'s closeOnBackpressureLimit) where closeHandler must
     * wait until on_stream_close to avoid TopicTree reentrancy. */
    bool closeFired = false;
    int closeCode = 1006;
    std::string closeReason;
    /* Incoming WT_CLOSE_SESSION capsule reassembly on the CONNECT stream. */
    std::string capsuleBuf;
};

/* One per H3App. Mirrors WebSocketContextData<SSL,USERDATA> minus the
 * compression / ping machinery that has no WT equivalent. Shares the
 * TopicTree shape (TopicTreeMessage / TopicTreeBigMessage) so a future
 * cross-transport publish can fan out from one tree if desired; for now the
 * H3App owns its own tree. */
struct WebTransportContextData {
    using Session = WebTransportSession;

    MoveOnlyFunction<void(Session *)> openHandler = nullptr;
    MoveOnlyFunction<void(Session *, std::string_view, OpCode)> messageHandler = nullptr;
    MoveOnlyFunction<void(Session *)> drainHandler = nullptr;
    MoveOnlyFunction<void(Session *, int, std::string_view)> closeHandler = nullptr;

    unsigned int maxPayloadLength = 16 * 1024;
    unsigned int maxBackpressure = 64 * 1024;
    bool closeOnBackpressureLimit = false;

    TopicTree<TopicTreeMessage, TopicTreeBigMessage> *topicTree = nullptr;

    ~WebTransportContextData() { delete topicTree; }
};

struct WebTransportSession {

    enum SendStatus : int { BACKPRESSURE, SUCCESS, DROPPED };

    Http3ResponseData *getResponseData() {
        return (Http3ResponseData *) us_quic_stream_ext((us_quic_stream_t *) this);
    }
    WebTransportSessionData *getSessionData() { return getResponseData()->wt; }
    WebTransportContextData *getContextData();

    void *getUserData() { return getSessionData()->userData; }

    /* WebTransport messaging is QUIC DATAGRAMs — unreliable, unordered, MTU-
     * bounded. compress/fin are accepted for API parity but ignored (no
     * per-frame opcode/extension on the wire, RFC 9297 §2.1); opCode is
     * used only to reject control frames. DROPPED is returned for control
     * opcodes, when the message is too large for one frame, or when the
     * per-session queue would exceed maxBackpressure. */
    /* Conservative QUIC DATAGRAM payload cap: RFC 9000's default
     * max_udp_payload_size minus short-header + AEAD + DATAGRAM-type
     * overhead. us_quic_stream_send_datagram rejects above this; pre-check
     * here so an oversize message reports DROPPED without being mistaken for
     * backpressure (and thus never trips closeOnBackpressureLimit). */
    static constexpr unsigned MAX_DATAGRAM_PAYLOAD = 1192;

    SendStatus send(std::string_view message, OpCode opCode = BINARY, bool = false, bool = true) {
        WebTransportSessionData *d = getSessionData();
        if (!d || d->isShuttingDown) return DROPPED;
        /* ws.ping()/ws.pong() route through here with a control opcode.
         * WebTransport has no control frames — QUIC owns keepalive — so
         * shipping the payload as an application datagram would surface it
         * in the peer's message() handler. Drop instead; the receive side
         * already nulls .ping/.pong in applyH3 for the same reason. */
        if (opCode != TEXT && opCode != BINARY) return DROPPED;
        if (message.length() > MAX_DATAGRAM_PAYLOAD) return DROPPED;
        WebTransportContextData *cd = getContextData();
        int r = us_quic_stream_send_datagram((us_quic_stream_t *) this,
                message.data(), (unsigned) message.length(), cd->maxBackpressure);
        if (r < 0) {
            /* -2 is the only "queue would exceed maxBackpressure" return; -1
             * means the session is gone (or OOM). closeOnBackpressureLimit
             * should never tear the session down for the latter.
             *
             * send() runs from inside TopicTree::publishBig()'s range-for
             * over the Topic (an unordered_set<Subscriber*>), so calling
             * end() here — which would freeSubscriber() and fire the JS
             * close handler synchronously — invalidates that iterator.
             * Mirror WebSocket<>::send()'s us_socket_shutdown_read(): mark
             * the session dead so subsequent sends drop, stash the close
             * code, and close the stream. lsquic schedules on_close for
             * the next service pass (maybe_schedule_call_on_close), and
             * on_stream_close does the subscriber cleanup + closeHandler
             * once we're outside the iteration. */
            if (r == -2 && cd->closeOnBackpressureLimit) {
                d->isShuttingDown = true;
                d->closeCode = 1009;
                d->closeReason = "Backpressure limit";
                us_quic_stream_close((us_quic_stream_t *) this);
            }
            return DROPPED;
        }
        /* r is the queued bytes *before* this send. Datagrams always queue
         * (they go out at the next process_conns), so the post-send buffered
         * amount is never zero; report SUCCESS when the queue was empty so a
         * single send() doesn't immediately trip the JS backpressure path. */
        if (r == 0) return SUCCESS;
        d->hadBackpressure = true;
        return BACKPRESSURE;
    }

    /* draft-ietf-webtrans-http3 §6: WT_CLOSE_SESSION (0x2843) capsule —
     * 32-bit application error code + UTF-8 message (≤1024 bytes) — then FIN
     * the CONNECT stream. WebSocket close codes are 16-bit; map 0/1005 to 0
     * to match WebSocket::end's "no payload" behaviour. */
    void end(int code = 0, std::string_view message = {}) {
        WebTransportSessionData *d = getSessionData();
        if (!d || d->isShuttingDown) return;
        d->isShuttingDown = true;

        if (message.length() > 1024) message = message.substr(0, 1024);
        unsigned char capsule[2 + 8 + 4 + 1024];
        unsigned char *p = capsule;
        *p++ = 0x80 | (0x2843 >> 24); *p++ = (0x2843 >> 16) & 0xff;
        *p++ = (0x2843 >> 8) & 0xff;  *p++ = 0x2843 & 0xff;
        /* Only RFC 6455 close codes that have a wire payload carry an
         * application error code; 0/1005/1006 mean "none supplied", which the
         * spec says is equivalent to {0, ""}. */
        bool hasCode = code != 0 && code != 1005 && code != 1006;
        uint64_t bodyLen = hasCode ? 4 + message.length() : 0;
        if (bodyLen < 64) { *p++ = (unsigned char) bodyLen; }
        else { *p++ = 0x40 | (unsigned char)(bodyLen >> 8); *p++ = (unsigned char) bodyLen; }
        if (hasCode) {
            uint32_t c = (uint32_t) code;
            *p++ = (unsigned char)(c >> 24); *p++ = (unsigned char)(c >> 16);
            *p++ = (unsigned char)(c >> 8);  *p++ = (unsigned char) c;
            memcpy(p, message.data(), message.length()); p += message.length();
        }
        unsigned total = (unsigned)(p - capsule);
        int w = us_quic_stream_write((us_quic_stream_t *) this, (const char *) capsule, total);
        if (w < 0) w = 0;
        if ((unsigned) w < total) {
            /* lsquic_stream_write may accept fewer bytes under flow control.
             * Reuse the Http3ResponseData backpressure path so the WT
             * on_stream_writable handler (which now calls drain()) flushes
             * the tail and FINs once empty. */
            Http3ResponseData *rd = getResponseData();
            rd->backpressure.append((const char *) capsule + w, total - (unsigned) w);
            rd->endAfterDrain = true;
            us_quic_stream_want_write((us_quic_stream_t *) this, 1);
        } else {
            us_quic_stream_shutdown((us_quic_stream_t *) this);
        }

        WebTransportContextData *cd = getContextData();
        if (d->subscriber) {
            cd->topicTree->freeSubscriber(d->subscriber);
            d->subscriber = nullptr;
        }
        d->closeFired = true;
        if (cd->closeHandler) cd->closeHandler(this, code, message);
    }

    void close() {
        WebTransportSessionData *d = getSessionData();
        if (d && !d->isShuttingDown) end(1006, {});
        us_quic_stream_close((us_quic_stream_t *) this);
    }

    void cork(MoveOnlyFunction<void()> &&fn) { fn(); }

    size_t getBufferedAmount() {
        return getResponseData()->backpressure.length()
             + us_quic_stream_datagram_buffered((us_quic_stream_t *) this);
    }

    size_t memoryCost() {
        return getBufferedAmount() + sizeof(WebTransportSessionData);
    }

    /* TopicTree hookup mirrors WebSocket<>; only the send path differs. */
    bool subscribe(std::string_view topic, bool = false) {
        WebTransportContextData *cd = getContextData();
        WebTransportSessionData *d = getSessionData();
        if (!d) return false;
        if (!d->subscriber) {
            d->subscriber = cd->topicTree->createSubscriber();
            d->subscriber->user = this;
        }
        cd->topicTree->subscribe(d->subscriber, topic);
        return true;
    }

    bool unsubscribe(std::string_view topic, bool = false) {
        WebTransportContextData *cd = getContextData();
        WebTransportSessionData *d = getSessionData();
        if (!d || !d->subscriber) return false;
        auto [ok, last, newCount] = cd->topicTree->unsubscribe(d->subscriber, topic);
        (void) newCount;
        if (ok && last) {
            cd->topicTree->freeSubscriber(d->subscriber);
            d->subscriber = nullptr;
        }
        return ok;
    }

    bool isSubscribed(std::string_view topic) {
        WebTransportContextData *cd = getContextData();
        WebTransportSessionData *d = getSessionData();
        if (!d || !d->subscriber) return false;
        Topic *t = cd->topicTree->lookupTopic(topic);
        return t && t->count(d->subscriber);
    }

    void iterateTopics(MoveOnlyFunction<void(std::string_view)> cb) {
        WebTransportSessionData *d = getSessionData();
        if (!d || !d->subscriber) return;
        for (Topic *t : d->subscriber->topics) cb({t->name.data(), t->name.length()});
    }

    bool publish(std::string_view topic, std::string_view message, OpCode opCode = BINARY, bool = false) {
        WebTransportContextData *cd = getContextData();
        WebTransportSessionData *d = getSessionData();
        if (!d || !d->subscriber) return false;
        return cd->topicTree->publishBig(d->subscriber, topic, {message, opCode, false},
            [](Subscriber *s, TopicTreeBigMessage &m) {
                ((WebTransportSession *) s->user)->send(m.message, (OpCode) m.opCode);
            });
    }
};

}

#endif
