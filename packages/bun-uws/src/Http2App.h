#ifndef UWS_H2APP_H
#define UWS_H2APP_H
// clang-format off

#include "App.h"
#include "Http2Context.h"

#include <openssl/ssl.h>

namespace uWS {

/* TemplatedApp-shaped front for HTTP/2. Route registration mirrors SSLApp
 * so the C ABI in libuwsockets_h2.cpp can stay 1:1 with the existing
 * uws_app_* surface.
 *
 * Unlike H3App (which opens its own UDP socket), H2App attaches to an
 * existing SSLApp: it creates its own socket group, installs an ALPN
 * select callback offering "h2,http/1.1" on the parent's SSL_CTX (and
 * each per-SNI SSL_CTX via addServerName), and takes over sockets that
 * negotiate "h2" at the top of HttpContext<true>::onData. The SSL* stays
 * on the adopted socket, so TLS decryption continues transparently. */
struct H2App {
    Http2Context *http2Context;
    /* Kept so the destructor can null the parent's adoption hook — the
     * H1 context typically outlives H2App by a few frames (server.zig
     * destroys h2_app before app), and a late on_data on a connected
     * socket would otherwise consult freed memory. */
    HttpContextData<true> *parentData;

    /* `parentApp` is the HTTP/1 SSLApp; we read its root sslCtx and any
     * already-queued per-SNI ctxs to install the ALPN cb on each (sni_cb
     * swaps ssl->ctx before BoringSSL reads alpn_select_cb, so every
     * SSL_CTX that can serve a connection needs a copy). Subsequent SNI
     * entries are covered by TemplatedApp::addServerName. */
    static H2App *create(TemplatedApp<true> *parentApp, unsigned idleTimeoutS = 0) {
        if (!parentApp || parentApp->constructorFailed()) return nullptr;
        Http2Context *ctx = Http2Context::create(Loop::get(), idleTimeoutS);
        if (!ctx) return nullptr;
        auto *parentData = parentApp->getHttpContext()->getSocketContextData();
        installH2Alpn<true>(parentApp->getSslCtx(), parentData);
        parentApp->forEachPendingServerNameSslCtx([&](SSL_CTX *sniCtx) {
            installH2Alpn<true>(sniCtx, parentData);
        });
        parentData->h2Context = ctx;
        return new H2App{ctx, parentData};
    }

    bool constructorFailed() { return http2Context == nullptr; }
    ~H2App() {
        if (parentData && parentData->h2Context == http2Context) {
            parentData->h2Context = nullptr;
        }
        if (http2Context) http2Context->free();
    }

#define H2_METHOD(name, verb)                                                            \
    H2App &&name(std::string_view pattern,                                               \
                 MoveOnlyFunction<void(Http2Response *, Http2Request *)> &&handler) {    \
        http2Context->onHttp(verb, pattern, std::move(handler));                         \
        return std::move(*this);                                                         \
    }
    H2_METHOD(get, "get")
    H2_METHOD(post, "post")
    H2_METHOD(put, "put")
    H2_METHOD(del, "delete")
    H2_METHOD(patch, "patch")
    H2_METHOD(head, "head")
    H2_METHOD(options, "options")
    H2_METHOD(connect, "connect")
    H2_METHOD(trace, "trace")
    H2_METHOD(any, "*")
#undef H2_METHOD

    void clearRoutes() {
        http2Context->getContextData()->router =
            decltype(http2Context->getContextData()->router){};
    }
    /* GOAWAY + drain. The child context is freed in the destructor. */
    void close() { http2Context->shutdown(); }
    void *getNativeHandle() { return http2Context; }

    /* Called from HttpContext<true>::onData (declared extern there so
     * HttpContext.h doesn't include this file). Inspects ALPN and, if
     * "h2", destructs the H1 ext, adopts the socket into our group,
     * and dispatches the initial bytes (the preface + client SETTINGS
     * that arrived in the same read). Returns the possibly relocated
     * socket, or null if the socket stays in the H1 group untouched. */
    static us_socket_t *adoptIfNegotiated(Http2Context *ctx,
                                          us_socket_t *s, int oldExtSize,
                                          char *data, int length) {
        SSL *ssl = (SSL *) us_socket_get_native_handle(s);
        if (!ssl) return nullptr;
        const unsigned char *proto = nullptr; unsigned int protoLen = 0;
        SSL_get0_alpn_selected(ssl, &proto, &protoLen);
        if (!(protoLen == 2 && proto[0] == 'h' && proto[1] == '2')) return nullptr;

        /* Tear down the H1 per-socket state before realloc. */
        ((HttpResponseData<true> *) us_socket_ext(s))->~HttpResponseData<true>();

        /* kind .dynamic → dispatch via group.vtable (h2VTable). The SSL*
         * stays on the socket, so TLS decryption continues. */
        us_socket_t *ns = us_socket_adopt(s, ctx->getSocketGroup(),
            US_SOCKET_KIND_DYNAMIC, oldExtSize, sizeof(Http2Connection));
        /* us_socket_adopt doesn't fire on_open for an already-open
         * socket, so initialise the new ext and send our SETTINGS here. */
        new (us_socket_ext(ns)) Http2Connection();
        auto *c = Http2Context::conn(ns);
        c->initHpack();
        ((AsyncSocket<true> *) ns)->cork();
        ctx->sendServerPreface(ns);
        c->dispatchDepth++;
        if (length > 0) ctx->onData(ns, data, length);
        if (!us_socket_is_closed(ns)) {
            c->dispatchDepth--;
            ctx->sweep(ns);
            ((AsyncSocket<true> *) ns)->uncork();
            us_socket_timeout(ns, ctx->getContextData()->idleTimeoutS);
        }
        return ns;
    }
};

/* ─────── Http2Response out-of-line methods that need Http2Context ─────── */

inline void Http2Response::sendBufferedHeaders(bool endStream) {
    context()->writeHeaders(socket, id, &data, endStream);
}

inline Http2Response *Http2Response::writeContinue() {
    /* RFC 9113 §8.1: a 1xx is its own HEADERS frame without END_STREAM. */
    Http2ResponseData tmp;
    tmp.appendHeader(":status", 7, "100", 3);
    context()->writeHeaders(socket, id, &tmp, false);
    return this;
}

inline Http2Response *Http2Response::cork(MoveOnlyFunction<void()> &&fn) {
    /* Cache the socket: once fn() returns, `this` may be in
     * pendingDelete. We do NOT sweep here — the caller above cork()
     * (StaticRoute.on, RequestContext paths) still holds `resp` and
     * touches it right after cork returns, and sweep()'s
     * goaway-close would fire on_close → ~Http2Connection → free
     * pendingDelete (including `this`) under the caller. H3 gets the
     * same guarantee because lsquic defers stream teardown to the next
     * process_conns(). */
    us_socket_t *s = socket;
    Http2Connection *c = Http2Context::conn(s);
    auto *as = (AsyncSocket<true> *) s;
    bool was = as->isCorked();
    if (!was) as->cork();
    fn();
    if (!us_socket_is_closed(s)) {
        if (!was && as->isCorked()) as->uncork();
        /* The async-resolve path reaches here outside any uSockets
         * event (dispatchDepth == 0), so there is no on_data/on_writable
         * epilogue to call sweep() for us. If this response was the
         * last stream on a GOAWAY connection, close the write side now
         * so the client receives EOF after the final END_STREAM and
         * hangs up, which in turn fires on_end → on_close → cleanup.
         * Shutdown is safe here where sweep()'s us_socket_close() is
         * not: it doesn't free anything or fire on_close synchronously,
         * so the caller can still touch `this` after cork() returns. */
        if (c->dispatchDepth == 0 && c->goaway && c->streams.empty() &&
            !us_socket_is_shut_down(s)) {
            us_socket_shutdown(s);
        }
    }
    return this;
}

inline Http2Response *Http2Response::resume() {
    if (!paused) return this;
    paused = false;
    if (recvWindow < h2::LOCAL_INIT_WINDOW / 2) {
        uint32_t inc = (uint32_t)(h2::LOCAL_INIT_WINDOW - recvWindow);
        context()->writeWindowUpdate(socket, id, inc);
        recvWindow = h2::LOCAL_INIT_WINDOW;
        ((AsyncSocket<true> *) socket)->uncork();
    }
    return this;
}

inline bool Http2Response::write(std::string_view body, size_t *writtenPtr) {
    flushHeaders();
    if (data.backpressure.length() != 0) {
        data.backpressure.append(body.data(), body.length());
        if (writtenPtr) *writtenPtr = 0;
        return false;
    }
    size_t w = context()->writeData(socket, this, body.data(), body.length(), false);
    data.offset += (uint64_t) w;
    if (writtenPtr) *writtenPtr = w;
    if (w < body.length()) {
        data.backpressure.append(body.data() + w, body.length() - w);
        return false;
    }
    return ((AsyncSocket<true> *) socket)->getBufferedAmount() < 256 * 1024;
}

inline void Http2Response::endWithoutBody(std::optional<size_t> cl, bool) {
    if (cl.has_value() && !(data.state & Http2ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER)) {
        writeHeader("content-length", (uint64_t) *cl);
    }
    if (data.state & Http2ResponseData::HTTP_WRITE_CALLED) {
        context()->writeData(socket, this, "", 0, true);
    } else {
        writeStatus("200 OK");
        sendBufferedHeaders(true);
    }
    markDone();
}

inline bool Http2Response::sendTerminatingChunk(bool) {
    flushHeaders();
    if (data.backpressure.length() != 0) {
        data.endAfterDrain = true;
        return false;
    }
    context()->writeData(socket, this, "", 0, true);
    markDone();
    return true;
}

inline bool Http2Response::internalEnd(std::string_view body, uint64_t totalSize,
                                        bool optional, bool, bool) {
    data.totalSize = totalSize;
    if (!(data.state & Http2ResponseData::HTTP_WRITE_CALLED)) {
        writeStatus("200 OK");
        if (!(data.state & Http2ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER) && totalSize) {
            writeHeader("content-length", totalSize);
            data.state |= Http2ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER;
        }
        if (body.empty() && data.offset == totalSize) {
            sendBufferedHeaders(true);
            markDone();
            return true;
        }
        sendBufferedHeaders(false);
        data.state |= Http2ResponseData::HTTP_WRITE_CALLED;
    }

    if (data.backpressure.length() != 0) {
        if (optional) return false;
        data.backpressure.append(body.data(), body.length());
        data.endAfterDrain = true;
        return false;
    }

    size_t w = body.empty() ? 0
        : context()->writeData(socket, this, body.data(), body.length(), false);
    data.offset += (uint64_t) w;
    if (w < body.length()) {
        if (optional) return false;
        data.backpressure.append(body.data() + w, body.length() - w);
        data.endAfterDrain = true;
        return false;
    }

    if (data.offset >= totalSize) {
        context()->writeData(socket, this, "", 0, true);
        markDone();
        return true;
    }
    return false;
}

inline bool Http2Response::drain() {
    while (data.backpressure.length() != 0) {
        size_t w = context()->writeData(socket, this, data.backpressure.data(),
                                         data.backpressure.length(), false);
        if (w == 0) return false;
        data.offset += (uint64_t) w;
        data.backpressure.erase((unsigned) w);
    }
    if (data.endAfterDrain) {
        data.endAfterDrain = false;
        context()->writeData(socket, this, "", 0, true);
        markDone();
        return true;
    }
    if (data.onWritable) {
        return data.onWritable(this, data.offset, data.writableUserData);
    }
    return true;
}

inline void Http2Response::markDone() {
    data.onWritable = nullptr;
    data.inStream = nullptr;
    data.state |= Http2ResponseData::HTTP_END_CALLED;
    data.state &= ~Http2ResponseData::HTTP_RESPONSE_PENDING;
    /* §8.1: a server MAY send RST_STREAM(NO_ERROR) after a complete
     * response to stop the client pushing a body we won't read. */
    if (!data.remoteClosed) {
        context()->writeRstStream(socket, id, h2::ERR_NO_ERROR);
        data.remoteClosed = true;
    }
    maybeDestroy();
}

inline void Http2Response::close() {
    if (!us_socket_is_closed(socket)) {
        context()->writeRstStream(socket, id, h2::ERR_CANCEL);
    }
    data.remoteClosed = true;
    data.state &= ~Http2ResponseData::HTTP_RESPONSE_PENDING;
    data.state |= Http2ResponseData::HTTP_END_CALLED;
    maybeDestroy();
}

inline void Http2Response::maybeDestroy() {
    if (!hasResponded() || !data.remoteClosed) return;
    if (dead) return;
    dead = true;
    Http2Connection *c = Http2Context::conn(socket);
    c->streams.erase(id);
    /* Like H3: fire onAborted so the holder drops its pointer — it
     * distinguishes via hasResponded(). */
    if (data.onAborted) {
        auto cb = data.onAborted;
        data.onAborted = nullptr;
        cb(this, data.userData);
    }
    /* The caller may still hold `this` on its stack (e.g. Zig's
     * StaticRoute calls clearAborted() right after tryEnd(), and the
     * async render path touches `resp` after the promise resolves).
     * Always defer the free to the next sweep() — on_data/on_writable
     * exit for the sync path, connection close for anything that
     * slips through. The GOAWAY last-stream close also stays in
     * sweep(): closing here would run on_close → ~Http2Connection →
     * free pendingDelete (including `this`) while the caller is still
     * on the stack. */
    c->pendingDelete.append(this);
}

}

#endif
