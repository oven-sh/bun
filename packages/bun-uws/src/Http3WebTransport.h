#ifndef UWS_H3WEBTRANSPORT_H
#define UWS_H3WEBTRANSPORT_H

#include "quic.h"
#include "Http3ResponseData.h"

#include <cstdint>
#include <cstring>
#include <string_view>

namespace uWS {

/* A WebTransport session (draft-ietf-webtrans-http3), a zero-member overlay on
 * the us_quic_stream_t its extended CONNECT arrived on: the draft gives a
 * session no id or lifetime beyond that stream's. Datagram framing is the one
 * part that doesn't follow from the stream; it lives in quic.c.
 *
 * Datagrams only. Peer-opened streams are refused in quic.c with
 * WEBTRANSPORT_SESSION_GONE. */

/* draft-ietf-webtrans-http3 §5. An unknown capsule is explicitly not an error,
 * so everything else on the CONNECT stream is skipped by its length. */
static constexpr uint64_t WT_CLOSE_SESSION = 0x2843;
/* Advisory and empty: both sides MAY keep using a drained session, so this
 * neither closes anything nor counts as a close when the peer sends one. */
static constexpr uint64_t WT_DRAIN_SESSION = 0x78ae;

/* The draft caps a close reason at 1024 bytes, behind a 4-byte error code. */
static constexpr size_t WT_MAX_CAPSULE_BODY = 1024 + 4;

/* Two varints, each at most eight bytes. */
static constexpr size_t WT_CAPSULE_HEADER_MAX = 16;

struct Http3WebTransportSession {

    /* Bytes consumed, or 0 when `len` stops short of a whole varint. */
    static unsigned readVarint(const unsigned char *p, size_t len, uint64_t *out) {
        if (!len) return 0;
        unsigned n = 1u << (p[0] >> 6);
        if (len < n) return 0;
        uint64_t v = p[0] & 0x3f;
        for (unsigned i = 1; i < n; i++) v = (v << 8) | p[i];
        *out = v;
        return n;
    }

    static unsigned varintLen(uint64_t v) {
        return v <= 63 ? 1 : v <= 16383 ? 2 : v <= 1073741823 ? 4 : 8;
    }

    static unsigned writeVarint(unsigned char *p, uint64_t v) {
        unsigned n = varintLen(v);
        for (unsigned i = 0; i < n; i++) p[n - 1 - i] = (unsigned char) (v >> (i * 8));
        p[0] = (unsigned char) (p[0] | (n == 1 ? 0x00 : n == 2 ? 0x40 : n == 4 ? 0x80 : 0xc0));
        return n;
    }

    us_quic_stream_t *stream() { return (us_quic_stream_t *) this; }

    Http3ResponseData *getData() {
        return (Http3ResponseData *) us_quic_stream_ext(stream());
    }

    void *getUserData() { return getData()->wtUserData; }
    void setUserData(void *ud) { getData()->wtUserData = ud; }

    /* Bytes queued, prefix included so an empty payload doesn't report 0; 0
     * when the connection's queue is full; -1 when over maxDatagramSize. */
    int sendDatagram(const char *data, unsigned len) {
        return us_quic_wt_send_datagram(stream(), data, len);
    }

    /* Largest payload this session carries; 0 when the peer offered no
     * datagrams at all. */
    unsigned maxDatagramSize() { return us_quic_wt_max_datagram_size(stream()); }

    /* Smoothed RTT of the underlying connection, microseconds; 0 when the
     * connection has gone. */
    unsigned rtt() {
        us_quic_socket_t *qs = us_quic_stream_socket(stream());
        return qs ? us_quic_socket_rtt(qs) : 0;
    }

    /* Ask the peer to wind up without ending the session: capsule only, no
     * FIN and no close report. Browsers surface it as WebTransport.draining. */
    void drain() {
        unsigned char buf[WT_CAPSULE_HEADER_MAX];
        unsigned n = writeVarint(buf, WT_DRAIN_SESSION);
        n += writeVarint(buf + n, 0);
        /* A short write has already flushed part of the capsule, which leaves
         * the capsule stream desynchronised: a later close would append after
         * an orphaned header and the peer would read a bogus type and length.
         * So the session ends here rather than silently corrupting, even
         * though a drain that could not be sent is otherwise ignorable. */
        int w = us_quic_stream_write(stream(), (const char *) buf, n);
        if (w < (int) n) {
            if (w > 0) {
                us_quic_stream_reset(stream());
                reportClose(0, std::string_view{});
            }
            return;
        }
        us_quic_stream_flush(stream());
    }

    /* WT_CLOSE_SESSION then FIN, which is the draft's orderly close. The
     * peer's own arrives the same way and is parsed by feedCapsules. */
    void close(uint32_t code, std::string_view reason) {
        if (reason.size() > 1024) {
            /* Back off to a character boundary: half a UTF-8 sequence makes
             * the peer fail the session over the reason for closing it. */
            size_t cut = 1024;
            while (cut && ((unsigned char) reason[cut] & 0xc0) == 0x80) cut--;
            reason = reason.substr(0, cut);
        }
        /* One buffer, one write: split in two, a short first write leaves a
         * header promising a body that never follows. */
        char buf[16 + 1024];
        unsigned n = writeVarint((unsigned char *) buf, WT_CLOSE_SESSION);
        n += writeVarint((unsigned char *) buf + n, 4 + reason.size());
        buf[n++] = (char) (code >> 24);
        buf[n++] = (char) (code >> 16);
        buf[n++] = (char) (code >> 8);
        buf[n++] = (char) code;
        memcpy(buf + n, reason.data(), reason.size());
        n += (unsigned) reason.size();

        if (us_quic_stream_write(stream(), buf, n) < (int) n) {
            /* Connection-level flow control is shared, so a large body on the
             * same connection can leave no room. The reset drops the partial
             * capsule so the peer never reads a truncated one, and the report
             * still runs — locally the session is over either way.
             *
             * Untested: lsquic refuses any window under LSQUIC_MIN_FCW (16 KB),
             * so no client can advertise one small enough to trigger it. */
            us_quic_stream_reset(stream());
            reportClose(code, reason);
            return;
        }
        /* Flush (a session has no body write to push the capsule out), then
         * FIN the write half only. Shutting the read half too sends
         * STOP_SENDING, which Chrome reports as "Connection lost" instead of
         * the code and reason just written. */
        us_quic_stream_flush(stream());
        us_quic_stream_shutdown(stream());
        reportClose(code, reason);
    }

    /* Report a server-made close now rather than at stream teardown, which
     * waits on the peer's answering FIN and a peer need never send one.
     * Detaching first is what makes it safe — the callback releases the JS
     * wrapper's last reference — and clearing wtOnClose keeps the stream's own
     * on_close from reporting the same session twice. */
    void reportClose(uint32_t code, std::string_view reason) {
        Http3ResponseData *rd = getData();
        auto cb = rd->wtOnClose;
        /* Nothing is written to `rd` after the callback: a caller that reset
         * the stream has already queued its on_close, and the callback's own
         * event-loop exit can drain the engine and free this ext block.
         * `wtUserData` stays set because it is how the callback finds its
         * session, and nothing reads it once `wtOnClose` is null and the
         * session is detached. */
        rd->wtOnClose = nullptr;
        us_quic_wt_detach(stream());
        if (cb) cb(this, code, reason.data(), reason.size());
    }

    /* Bytes a capsule header needs given the `have` already in hand. Each
     * varint states its own length in its top two bits, so this is exact and
     * nothing past the header is ever speculatively buffered. */
    static size_t headerNeed(const unsigned char *p, size_t have) {
        if (!have) return 1;
        size_t tn = 1u << (p[0] >> 6);
        if (have < tn + 1) return tn + 1;
        return tn + (1u << (p[tn] >> 6));
    }

    /* Feed CONNECT-stream bytes to the capsule parser. Returns false once the
     * session is closed, after which the caller must not touch it.
     *
     * Only a close capsule is buffered; everything else is skipped against the
     * arriving bytes, so an unknown capsule with a megabyte of body costs a
     * header's worth of buffer. */
    template <typename OnClose>
    bool feedCapsules(const char *data, size_t len, OnClose &&onClose) {
        Http3ResponseData *rd = getData();
        for (;;) {
            if (rd->wtSkip) {
                size_t n = rd->wtSkip < len ? (size_t) rd->wtSkip : len;
                rd->wtSkip -= n;
                data += n;
                len -= n;
                if (rd->wtSkip) return true;
            }

            /* Exactly the header: what follows is either a body to skip or a
             * close body, handled apart. */
            size_t need = headerNeed(
                (const unsigned char *) rd->wtCapsule.span().data(), rd->wtCapsule.size());
            while (rd->wtCapsule.size() < need && len) {
                size_t take = need - rd->wtCapsule.size();
                if (take > len) take = len;
                rd->wtCapsule.append(std::span<const char>(data, take));
                data += take;
                len -= take;
                need = headerNeed(
                    (const unsigned char *) rd->wtCapsule.span().data(), rd->wtCapsule.size());
            }
            if (rd->wtCapsule.size() < need) return true; /* header still arriving */

            const unsigned char *p = (const unsigned char *) rd->wtCapsule.span().data();
            uint64_t type, blen;
            unsigned tn = readVarint(p, rd->wtCapsule.size(), &type);
            unsigned ln = readVarint(p + tn, rd->wtCapsule.size() - tn, &blen);

            if (type != WT_CLOSE_SESSION) {
                rd->wtCapsule.shrink(0);
                rd->wtSkip = blen;
                if (!len && rd->wtSkip) return true;
                continue;
            }

            if (blen > WT_MAX_CAPSULE_BODY || blen < 4) {
                /* Longer than the draft allows, or too short for a code;
                 * neither is recoverable. */
                onClose((uint32_t) 0, std::string_view{});
                return false;
            }

            size_t header = (size_t) tn + ln;
            size_t bodyHave = rd->wtCapsule.size() - header;
            if (bodyHave < blen) {
                size_t take = blen - bodyHave;
                if (take > len) take = len;
                rd->wtCapsule.append(std::span<const char>(data, take));
                data += take;
                len -= take;
                if (rd->wtCapsule.size() - header < blen) return true; /* body still arriving */
            }

            const unsigned char *body =
                (const unsigned char *) rd->wtCapsule.span().data() + header;
            uint32_t code = ((uint32_t) body[0] << 24) | ((uint32_t) body[1] << 16) |
                            ((uint32_t) body[2] << 8) | (uint32_t) body[3];
            onClose(code, std::string_view{(const char *) body + 4, (size_t) blen - 4});
            return false;
        }
    }

};

}

#endif
