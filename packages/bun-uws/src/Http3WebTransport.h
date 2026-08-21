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
            /* The peer is not going to see a well-formed capsule, so do not
             * dress it up as a close. */
            us_quic_stream_reset(stream());
            return;
        }
        /* Flush, then end both halves. The capsule is buffered until something
         * pushes it out — a session has no body write to do that — and lsquic
         * only schedules on_close once neither half is live, so shutting only
         * the write side leaves the session waiting on a peer that has no
         * reason to answer. */
        us_quic_stream_flush(stream());
        us_quic_stream_shutdown(stream());
        us_quic_stream_shutdown_read(stream());
    }

    /* Drop the session without a capsule. For the cases where the peer is not
     * going to read one: a handler that threw, or a server going away. */
    void abort() { us_quic_stream_reset(stream()); }

    /* Feed CONNECT-stream bytes through the capsule parser. Returns false once
     * the session has been closed, after which the caller must not touch it. */
    template <typename OnClose>
    bool feedCapsules(const char *data, size_t len, OnClose &&onClose) {
        Http3ResponseData *rd = getData();

        /* An uninteresting capsule's body is spent against the arriving bytes
         * before any of them reach the buffer, so it is never stored. */
        if (rd->wtSkip) {
            size_t n = rd->wtSkip < len ? (size_t) rd->wtSkip : len;
            rd->wtSkip -= n;
            data += n;
            len -= n;
        }
        if (!len) return true;

        /* A capsule can split anywhere, including inside either varint, so
         * whatever has not been parsed is kept whole. The buffer only ever
         * holds a header plus at most one close body — a longer body is
         * refused below and an unknown one is skipped rather than stored — so
         * running out of room means the peer sent something malformed. */
        size_t room = WT_MAX_CAPSULE_BODY + 16 - rd->wtCapsule.size();
        if (len > room) {
            onClose((uint32_t) 0, std::string_view{});
            return false;
        }
        rd->wtCapsule.append(std::span<const char>(data, len));

        /* Parse every whole capsule the buffer now holds, rather than one per
         * arriving chunk: the close that ends a session usually shares a read
         * with whatever came before it. */
        size_t at = 0;
        for (;;) {
            const unsigned char *p = (const unsigned char *) rd->wtCapsule.span().data() + at;
            size_t have = rd->wtCapsule.size() - at;
            uint64_t type, blen;
            unsigned tn = readVarint(p, have, &type);
            if (!tn) break;
            unsigned ln = readVarint(p + tn, have - tn, &blen);
            if (!ln) break;

            if (type == WT_CLOSE_SESSION) {
                if (blen > WT_MAX_CAPSULE_BODY || blen < 4) {
                    /* Longer than the draft allows, or too short to hold a
                     * code. Neither is recoverable, so the session ends
                     * without one. */
                    onClose((uint32_t) 0, std::string_view{});
                    return false;
                }
                if (have - tn - ln < blen) break; /* body still arriving */
                const unsigned char *body = p + tn + ln;
                uint32_t code = ((uint32_t) body[0] << 24) | ((uint32_t) body[1] << 16) |
                                ((uint32_t) body[2] << 8) | (uint32_t) body[3];
                onClose(code, std::string_view{(const char *) body + 4, (size_t) blen - 4});
                return false;
            }

            size_t buffered = have - tn - ln;
            size_t consumed = blen < buffered ? (size_t) blen : buffered;
            rd->wtSkip = blen - consumed;
            at += tn + ln + consumed;
            if (rd->wtSkip) break; /* the rest of this body has not arrived */
        }

        /* Drop what was parsed. What is left is the head of a capsule still on
         * its way, moved down rather than copied over itself. */
        if (at) {
            size_t rest = rd->wtCapsule.size() - at;
            if (rest) {
                memmove(rd->wtCapsule.mutableSpan().data(),
                        rd->wtCapsule.span().data() + at, rest);
            }
            rd->wtCapsule.shrink(rest);
        }
        return true;
    }
};

}

#endif
