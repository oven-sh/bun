#ifndef UWS_H3CONTEXT_H
#define UWS_H3CONTEXT_H

#include "quic.h"
#include "Loop.h"
#include "Http3ContextData.h"
#include "Http3Request.h"
#include "Http3Response.h"
#include "Http3ResponseData.h"

namespace uWS {

struct Http3Context {

    static Http3Context *create(Loop *loop, us_bun_socket_context_options_t options, unsigned idleTimeoutSecs = 0) {
        us_quic_socket_context_t *ctx = us_create_quic_socket_context(
            (us_loop_t *) loop, options, sizeof(Http3ContextData), idleTimeoutSecs);
        if (!ctx) return nullptr;
        new (us_quic_socket_context_ext(ctx)) Http3ContextData();

        us_quic_socket_context_on_stream_open(ctx, [](us_quic_stream_t *s, int) {
            new (us_quic_stream_ext(s)) Http3ResponseData();
        });

        us_quic_socket_context_on_stream_headers(ctx, [](us_quic_stream_t *s) {
            Http3ContextData *cd = (Http3ContextData *) us_quic_socket_context_ext(us_quic_stream_context(s));
            Http3Response *res = (Http3Response *) s;
            Http3ResponseData *rd = res->getHttpResponseData();
            rd->reset();

            Http3Request req(s);
            if (req.getHeader("expect") == "100-continue") res->writeContinue();
            cd->router.getUserData() = {res, &req};
            if (!cd->router.route(req.getMethod(), req.getUrl())) {
                res->writeStatus("404 Not Found")->end();
            }
        });

        us_quic_socket_context_on_stream_data(ctx, [](us_quic_stream_t *s, const char *data, unsigned len, int fin) {
            Http3Response *res = (Http3Response *) s;
            Http3ResponseData *rd = res->getHttpResponseData();
            if (rd->wt) {
                /* CONNECT-stream body after upgrade is the Capsule Protocol
                 * (RFC 9297). The only capsule we act on is WT_CLOSE_SESSION;
                 * everything else (WT_DRAIN_SESSION, flow-control capsules,
                 * unknown types) is parsed for length and skipped. */
                Http3ContextData *cd = (Http3ContextData *) us_quic_socket_context_ext(us_quic_stream_context(s));
                handleConnectStreamData(cd, (WebTransportSession *) s, rd->wt, data, len, fin != 0);
                return;
            }
            if (rd->inStream) rd->inStream(res, data, len, fin != 0, rd->userData);
        });

        us_quic_socket_context_on_wt_stream_data(ctx, [](us_quic_stream_t *s, us_quic_stream_t *session,
                                                         const char *data, unsigned len, int fin) {
            Http3ContextData *cd = (Http3ContextData *) us_quic_socket_context_ext(us_quic_stream_context(s));
            WebTransportSessionData *d = session
                ? ((Http3ResponseData *) us_quic_stream_ext(session))->wt : nullptr;
            if (!d || d->isShuttingDown) {
                /* §4.6: stream arrived before its CONNECT (or after the
                 * session closed). We don't buffer; reject with
                 * WT_BUFFERED_STREAM_REJECTED semantics by closing now —
                 * waiting for FIN would let a hostile client hold the slot
                 * and stream indefinitely. */
                us_quic_stream_close(s);
                return;
            }
            /* Reassemble into a per-stream buffer until FIN, then deliver as
             * one BINARY message — the WebSocket message handler expects
             * whole frames. inflight is keyed by stream id (not pointer):
             * a RESET_STREAM never delivers fin=1 so the entry would
             * otherwise survive, and the next calloc'd us_quic_stream_t can
             * reuse the same address, splicing two streams' bytes together. */
            unsigned long long sid = us_quic_stream_id(s);
            std::string *buf = nullptr;
            for (auto &i : d->inflight) if (i.id == sid) { buf = &i.buf; break; }
            if (!buf) { d->inflight.push_back({sid, {}}); buf = &d->inflight.back().buf; }
            if (buf->length() + len > cd->wt.maxPayloadLength) {
                us_quic_stream_close(s);
                for (auto it = d->inflight.begin(); it != d->inflight.end(); ++it)
                    if (it->id == sid) { d->inflight.erase(it); break; }
                return;
            }
            buf->append(data, len);
            if (fin) {
                std::string msg = std::move(*buf);
                for (auto it = d->inflight.begin(); it != d->inflight.end(); ++it)
                    if (it->id == sid) { d->inflight.erase(it); break; }
                if (cd->wt.messageHandler)
                    cd->wt.messageHandler((WebTransportSession *) session, msg, BINARY);
                us_quic_stream_shutdown(s);
            }
        });

        us_quic_socket_context_on_wt_stream_close(ctx, [](us_quic_stream_t *s, us_quic_stream_t *session) {
            if (!session) return;
            WebTransportSessionData *d = ((Http3ResponseData *) us_quic_stream_ext(session))->wt;
            if (!d) return;
            unsigned long long sid = us_quic_stream_id(s);
            for (auto it = d->inflight.begin(); it != d->inflight.end(); ++it)
                if (it->id == sid) { d->inflight.erase(it); break; }
        });

        us_quic_socket_context_on_datagram(ctx, [](us_quic_stream_t *session, const char *data, unsigned len) {
            Http3ContextData *cd = (Http3ContextData *) us_quic_socket_context_ext(us_quic_stream_context(session));
            WebTransportSessionData *d = ((Http3ResponseData *) us_quic_stream_ext(session))->wt;
            if (!d || d->isShuttingDown || !cd->wt.messageHandler) return;
            cd->wt.messageHandler((WebTransportSession *) session, std::string_view{data, len}, BINARY);
        });

        us_quic_socket_context_on_stream_writable(ctx, [](us_quic_stream_t *s) {
            Http3Response *res = (Http3Response *) s;
            Http3ResponseData *rd = res->getHttpResponseData();
            if (rd->wt) {
                Http3ContextData *cd = (Http3ContextData *) us_quic_socket_context_ext(us_quic_stream_context(s));
                if (cd->wt.drainHandler && !rd->wt->isShuttingDown)
                    cd->wt.drainHandler((WebTransportSession *) s);
                return;
            }
            if (!res->drain()) us_quic_stream_want_write(s, 1);
        });

        us_quic_socket_context_on_stream_close(ctx, [](us_quic_stream_t *s) {
            Http3Response *res = (Http3Response *) s;
            Http3ResponseData *rd = res->getHttpResponseData();
            if (rd->wt) {
                Http3ContextData *cd = (Http3ContextData *) us_quic_socket_context_ext(us_quic_stream_context(s));
                WebTransportSession *ws = (WebTransportSession *) s;
                WebTransportSessionData *d = rd->wt;
                if (!d->isShuttingDown) {
                    d->isShuttingDown = true;
                    if (d->subscriber) {
                        cd->wt.topicTree->freeSubscriber(d->subscriber);
                        d->subscriber = nullptr;
                    }
                    if (cd->wt.closeHandler) cd->wt.closeHandler(ws, 1006, {});
                }
                delete d;
                rd->wt = nullptr;
            } else if (rd->onAborted) {
                /* Fire onAborted for both real aborts and post-completion stream
                 * teardown. The handler distinguishes via hasResponded(); for the
                 * completed case it just drops its pointer so it doesn't outlive
                 * this destructor. */
                rd->onAborted(res, rd->userData);
            }
            rd->~Http3ResponseData();
        });

        return (Http3Context *) ctx;
    }

    /* Capsule Protocol parsing on the CONNECT stream body. Only
     * WT_CLOSE_SESSION (0x2843) is acted on; everything else is skipped by
     * length. The wire is varint type, varint length, payload — but we may
     * receive it in arbitrary chunks, so accumulate in d->capsuleBuf until a
     * full capsule is available. */
    static void handleConnectStreamData(Http3ContextData *cd, WebTransportSession *ws,
                                        WebTransportSessionData *d,
                                        const char *data, unsigned len, bool fin) {
        if (d->isShuttingDown) return;
        /* RFC 9297 §3.3: an endpoint MUST reset the data stream if it
         * receives a Capsule Length exceeding what it is willing to buffer.
         * The same cap applies to slow-dripping a capsule body — without
         * this a single client can append forever and OOM the process. */
        if (d->capsuleBuf.length() + len > cd->wt.maxPayloadLength) {
            d->isShuttingDown = true;
            if (d->subscriber) {
                cd->wt.topicTree->freeSubscriber(d->subscriber);
                d->subscriber = nullptr;
            }
            if (cd->wt.closeHandler) cd->wt.closeHandler(ws, 1009, {});
            us_quic_stream_close((us_quic_stream_t *) ws);
            return;
        }
        d->capsuleBuf.append(data, len);
        const unsigned char *p = (const unsigned char *) d->capsuleBuf.data();
        const unsigned char *end = p + d->capsuleBuf.size();
        auto readVarint = [](const unsigned char *&p, const unsigned char *end, uint64_t &out) -> bool {
            if (p >= end) return false;
            unsigned n = 1u << (*p >> 6);
            if ((unsigned)(end - p) < n) return false;
            out = *p & 0x3f;
            for (unsigned i = 1; i < n; i++) out = (out << 8) | p[i];
            p += n; return true;
        };
        while (p < end) {
            const unsigned char *start = p;
            uint64_t type, clen;
            if (!readVarint(p, end, type) || !readVarint(p, end, clen)) { p = start; break; }
            if ((uint64_t)(end - p) < clen) { p = start; break; }
            if (type == 0x2843 /* WT_CLOSE_SESSION */) {
                int code = 0; std::string_view msg;
                if (clen >= 4) {
                    code = (int)((uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 |
                                 (uint32_t)p[2] << 8  | (uint32_t)p[3]);
                    msg = {(const char *)(p + 4), (size_t)(clen - 4)};
                }
                d->isShuttingDown = true;
                if (d->subscriber) {
                    cd->wt.topicTree->freeSubscriber(d->subscriber);
                    d->subscriber = nullptr;
                }
                if (cd->wt.closeHandler) cd->wt.closeHandler(ws, code, msg);
                us_quic_stream_shutdown((us_quic_stream_t *) ws);
                d->capsuleBuf.clear();
                return;
            }
            p += clen;
        }
        d->capsuleBuf.erase(0, (size_t)(p - (const unsigned char *) d->capsuleBuf.data()));
        if (fin) {
            /* Clean FIN with no WT_CLOSE_SESSION ≡ {0, ""}. Mirror the
             * capsule branch above and shut our write side too — lsquic only
             * schedules on_close once both U_READ_DONE and U_WRITE_DONE are
             * set, so leaving the write side open would leak the stream and
             * its WebTransportSessionData until connection teardown. */
            d->isShuttingDown = true;
            if (d->subscriber) {
                cd->wt.topicTree->freeSubscriber(d->subscriber);
                d->subscriber = nullptr;
            }
            if (cd->wt.closeHandler) cd->wt.closeHandler(ws, 0, {});
            us_quic_stream_shutdown((us_quic_stream_t *) ws);
        }
    }

    void free() {
        getContextData()->~Http3ContextData();
        us_quic_socket_context_free((us_quic_socket_context_t *) this);
    }

    Http3ContextData *getContextData() {
        return (Http3ContextData *) us_quic_socket_context_ext((us_quic_socket_context_t *) this);
    }

    void onHttp(std::string_view method, std::string_view pattern,
                MoveOnlyFunction<void(Http3Response *, Http3Request *)> &&handler) {
        Http3ContextData *cd = getContextData();
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

    us_quic_listen_socket_t *listen(const char *host, int port) {
        return us_quic_socket_context_listen((us_quic_socket_context_t *) this,
            host, port, sizeof(Http3ResponseData));
    }

    void shutdown() { us_quic_socket_context_shutdown((us_quic_socket_context_t *) this); }

    bool addServerName(const char *hostname, us_bun_socket_context_options_t options) {
        return us_quic_socket_context_add_server_name((us_quic_socket_context_t *) this, hostname, options) == 0;
    }
};

}

#endif
