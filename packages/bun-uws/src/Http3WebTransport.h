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
 * Only datagrams are implemented. WebTransport streams would need the peer's
 * 0x41 stream type routed back to the session that owns it; lsquic parses
 * that much, but nothing above here asks for it yet.
 */

/* Capsule types, draft-ietf-webtrans-http3 §5. Everything else on the CONNECT
 * stream is skipped by its length -- an unknown capsule is explicitly not an
 * error, which is what lets the draft add them. */
static constexpr uint64_t WT_CLOSE_SESSION = 0x2843;

/* The draft caps a close reason at 1024 bytes. One more than the largest
 * legal capsule body, so "did not fit" and "not yet arrived" stay distinct. */
static constexpr size_t WT_MAX_CAPSULE_BODY = 1024 + 4;

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

    /* Returns the payload length when queued, 0 when the connection's queue
     * is full (drop it -- this path is unreliable by construction), or -1 when
     * the payload is larger than the peer will accept. */
    int sendDatagram(const char *data, unsigned len) {
        return us_quic_wt_send_datagram(stream(), data, len);
    }

    unsigned maxDatagramSize() { return US_QUIC_WT_MAX_DATAGRAM; }

    /* CLOSE_WEBTRANSPORT_SESSION followed by FIN, which is what the draft
     * defines an orderly close as. The peer's own close arrives the same way
     * and is parsed by feedCapsules below. */
    void close(uint32_t code, std::string_view reason) {
        if (reason.size() > 1024) reason = reason.substr(0, 1024);
        unsigned char buf[16];
        unsigned n = writeVarint(buf, WT_CLOSE_SESSION);
        n += writeVarint(buf + n, 4 + reason.size());
        buf[n++] = (unsigned char) (code >> 24);
        buf[n++] = (unsigned char) (code >> 16);
        buf[n++] = (unsigned char) (code >> 8);
        buf[n++] = (unsigned char) code;
        us_quic_stream_write(stream(), (const char *) buf, n);
        if (!reason.empty()) {
            us_quic_stream_write(stream(), reason.data(), (unsigned) reason.size());
        }
        us_quic_stream_shutdown(stream());
    }

    /* Drop the session without a capsule. For the cases where the peer is not
     * going to read one: a handler that threw, or a server going away. */
    void abort() { us_quic_stream_reset(stream()); }

    /* Feed CONNECT-stream bytes through the capsule parser. Returns false once
     * the session has been closed, after which the caller must not touch it. */
    template <typename OnClose>
    bool feedCapsules(const char *data, size_t len, OnClose &&onClose) {
        Http3ResponseData *rd = getData();
        while (len) {
            if (rd->wtSkip) {
                size_t n = rd->wtSkip < len ? (size_t) rd->wtSkip : len;
                rd->wtSkip -= n;
                data += n;
                len -= n;
                continue;
            }

            /* Header and body are accumulated in one buffer: a capsule can be
             * split anywhere, including inside either varint, and a partial
             * header is far more common than a partial body. */
            size_t take = len;
            if (rd->wtCapsule.size() + take > WT_MAX_CAPSULE_BODY + 16) {
                take = WT_MAX_CAPSULE_BODY + 16 - rd->wtCapsule.size();
            }
            rd->wtCapsule.append(std::span<const char>(data, take));
            data += take;
            len -= take;

            const unsigned char *p = (const unsigned char *) rd->wtCapsule.span().data();
            size_t have = rd->wtCapsule.size();
            uint64_t type, blen;
            unsigned tn = readVarint(p, have, &type);
            if (!tn) return true;
            unsigned ln = readVarint(p + tn, have - tn, &blen);
            if (!ln) return true;

            if (type != WT_CLOSE_SESSION) {
                /* Unknown or uninteresting: drop the body as it arrives
                 * rather than buffering it. */
                size_t buffered = have - tn - ln;
                rd->wtSkip = blen > buffered ? blen - buffered : 0;
                size_t overshoot = buffered > blen ? buffered - blen : 0;
                rd->wtCapsule.shrink(0);
                if (overshoot) {
                    /* The next capsule started inside what we already read. */
                    rd->wtCapsule.append(
                        std::span<const char>((const char *) p + have - overshoot, overshoot));
                }
                continue;
            }

            if (blen > WT_MAX_CAPSULE_BODY || blen < 4) {
                /* Longer than the draft allows, or too short to hold a code.
                 * Neither is recoverable: stop reading and drop the session. */
                onClose((uint32_t) 0, std::string_view{});
                return false;
            }
            if (have - tn - ln < blen) return true; /* body still arriving */

            const unsigned char *body = p + tn + ln;
            uint32_t code = ((uint32_t) body[0] << 24) | ((uint32_t) body[1] << 16) |
                            ((uint32_t) body[2] << 8) | (uint32_t) body[3];
            onClose(code, std::string_view{(const char *) body + 4, (size_t) blen - 4});
            return false;
        }
        return true;
    }
};

}

#endif
