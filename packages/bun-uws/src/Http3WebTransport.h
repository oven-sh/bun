#ifndef UWS_H3WEBTRANSPORT_H
#define UWS_H3WEBTRANSPORT_H

#include "quic.h"
#include "Http3ResponseData.h"

#include <cstdint>
#include <cstring>
#include <string_view>

namespace uWS {

/* A WebTransport session over HTTP/3 (draft-ietf-webtrans-http3).
 *
 * Like Http3Response, a session *is* the us_quic_stream_t the extended
 * CONNECT arrived on. There is no separate object because the draft gives a
 * session no identity beyond that stream: its id is the stream's, its
 * lifetime is the stream's, and closing it is closing the stream. The one
 * thing that does not follow from the stream is the datagram framing, and
 * that lives a layer down in quic.c.
 *
 * Only datagrams are implemented. A stream the peer opens on a session is
 * refused in quic.c with WEBTRANSPORT_SESSION_GONE rather than left hanging;
 * carrying one would need the 0x41 stream type routed back to the session that
 * owns it, which lsquic parses but nothing above here asks for yet.
 */

/* Capsule types, draft-ietf-webtrans-http3 §5. Everything else on the CONNECT
 * stream is skipped by its length -- an unknown capsule is explicitly not an
 * error, which is what lets the draft add them. */
static constexpr uint64_t WT_CLOSE_SESSION = 0x2843;

/* The draft caps a close reason at 1024 bytes; the four in front of it are the
 * error code. Anything claiming more than this is refused rather than
 * buffered. */
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

    /* Returns the bytes that will go on the wire -- the payload plus the
     * session's quarter-stream-id prefix, so that an empty payload reports
     * success rather than colliding with the 0 below -- or 0 when the
     * connection's queue is full (drop it; this path is unreliable by
     * construction), or -1 when the payload is larger than the peer will
     * accept. */
    int sendDatagram(const char *data, unsigned len) {
        return us_quic_wt_send_datagram(stream(), data, len);
    }

    /* What this server will queue, which is the limit that actually binds:
     * lsquic exposes the peer's max_datagram_frame_size only as a setter that
     * accepts or refuses a size, and every implementation that offers
     * datagrams at all advertises far more than this. A peer that somehow
     * advertised less would refuse the send rather than be surprised by it. */
    unsigned maxDatagramSize() { return US_QUIC_WT_MAX_DATAGRAM; }

    /* CLOSE_WEBTRANSPORT_SESSION followed by FIN, which is what the draft
     * defines an orderly close as. The peer's own close arrives the same way
     * and is parsed by feedCapsules below. */
    void close(uint32_t code, std::string_view reason) {
        if (reason.size() > 1024) {
            /* Back off the cut to a character boundary. Half a UTF-8 sequence
             * makes the peer fail the session over the reason for closing it,
             * which is a poor last word. */
            size_t cut = 1024;
            while (cut && ((unsigned char) reason[cut] & 0xc0) == 0x80) cut--;
            reason = reason.substr(0, cut);
        }
        /* One buffer and one write. Split across two, a short first write
         * leaves a header promising a body that never follows, and the FIN
         * below would then present a truncated capsule as an orderly close. */
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
            /* Connection-level flow control is shared, so a large response
             * body on the same connection can leave no room for this. The
             * partial capsule goes with the reset, which drops the stream's
             * buffered bytes, so the peer never sees a truncated one -- it
             * learns the session is over abruptly instead, which is the truth.
             *
             * The report still happens: locally this session is finished
             * either way, and skipping it would leave `closed` false and
             * `sendDatagram` queueing for a peer that has just been reset.
             *
             * Untested, and not for want of trying: lsquic refuses any
             * flow-control window under LSQUIC_MIN_FCW (16 KB), so no client
             * can advertise one small enough to make a 1032-byte capsule come
             * back short, and a session stream has no body write to consume a
             * real one with. */
            us_quic_stream_reset(stream());
            reportClose(code, reason);
            return;
        }
        /* Flush, then FIN the write half and nothing else. The capsule is
         * buffered until something pushes it out — a session has no body write
         * to do that. Shutting the read half too would be a STOP_SENDING on
         * the CONNECT stream, which the draft gives no meaning to and which
         * Chrome reports as `Connection lost` instead of the code and reason
         * just written. */
        us_quic_stream_flush(stream());
        us_quic_stream_shutdown(stream());
        reportClose(code, reason);
    }

    /* Report a close the server itself made, now rather than when the stream
     * finally goes. Waiting would mean waiting for the peer's answering FIN,
     * and a peer that never sends one holds the handler back until the idle
     * timeout — on exactly the path where a server is trying to let go of a
     * session promptly.
     *
     * Detaching is what makes that safe: the callback releases the JS
     * wrapper's last reference, so once it has run nothing may route a
     * datagram here again. Clearing wtOnClose is what keeps the stream's own
     * on_close, still to come, from reporting the same session twice. */
    void reportClose(uint32_t code, std::string_view reason) {
        Http3ResponseData *rd = getData();
        auto cb = rd->wtOnClose;
        rd->wtOnClose = nullptr;
        us_quic_wt_detach(stream());
        if (cb) cb(this, code, reason.data(), reason.size());
        rd->wtUserData = nullptr;
    }

    /* Drop the session without a capsule. For the cases where the peer is not
     * going to read one: a handler that threw, or a server going away. */
    void abort() { us_quic_stream_reset(stream()); }

    /* Feed CONNECT-stream bytes through the capsule parser. Returns false once
     * the session has been closed, after which the caller must not touch it. */
    /* How many bytes a capsule header needs, given the `have` of it already in
     * hand. Each varint says its own length in its top two bits, so this is
     * exact rather than a guess, and nothing beyond the header is ever
     * speculatively buffered. */
    static size_t headerNeed(const unsigned char *p, size_t have) {
        if (!have) return 1;
        size_t tn = 1u << (p[0] >> 6);
        if (have < tn + 1) return tn + 1;
        return tn + (1u << (p[tn] >> 6));
    }

    /* Feed CONNECT-stream bytes through the capsule parser. Returns false once
     * the session has been closed, after which the caller must not touch it.
     *
     * Only a close capsule is ever buffered. Everything else is skipped
     * against the arriving bytes, so an unknown capsule with a megabyte of
     * body — which the draft requires be ignored, not treated as an error —
     * costs a header's worth of buffer and nothing more. */
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

            /* Take exactly the header, never more: what follows it is either a
             * body to skip or a close body, and the two are handled apart. */
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
                /* Longer than the draft allows, or too short to hold a code.
                 * Neither is recoverable, so the session ends without one. */
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
