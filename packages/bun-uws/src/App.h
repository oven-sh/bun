#pragma once
/*
 * Authored by Alex Hultman, 2018-2020.
 * Intellectual property of third-party.

 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// clang-format off


#include <memory>
#include <string>
#include <string_view>

/* An app is a convenience wrapper of some of the most used fuctionalities and allows a
 * builder-pattern kind of init. Apps operate on the implicit thread local Loop */

#include "HttpContext.h"
#include "HttpResponse.h"
#include "Http2Context.h"

extern "C" void Bun__WebSockets__close(const void *webSockets);

namespace uWS {

    /* This one matches us_socket_context_options_t but has default values */
    struct SocketContextOptions {
        const char *key_file_name = nullptr;
        const char *cert_file_name = nullptr;
        const char *passphrase = nullptr;
        const char *dh_params_file_name = nullptr;
        const char *ca_file_name = nullptr;
        const char *ssl_ciphers = nullptr;
        int ssl_prefer_low_memory_usage = 0;

        const char **key = nullptr;
        unsigned int key_count = 0;
        const char **cert = nullptr;
        unsigned int cert_count = 0;
        const char **ca = nullptr;
        unsigned int ca_count = 0;
        unsigned int secure_options = 0;
        int ssl_min_version = 0;
        int ssl_max_version = 0;
        int reject_unauthorized = 0;
        int request_cert = 0;
        unsigned int client_renegotiation_limit = 3;
        unsigned int client_renegotiation_window = 600;
        int session_timeout = 0;
        const char **crl = nullptr;
        unsigned int crl_count = 0;
        int allow_partial_trust_chain = 0;
        const char *sigalgs = nullptr;
        const char *ecdh_curve = nullptr;

        /* Conversion operator used internally */
        operator struct us_bun_socket_context_options_t() const {
            struct us_bun_socket_context_options_t socket_context_options;
            memcpy(&socket_context_options, this, sizeof(SocketContextOptions));
            return socket_context_options;
        }
    };

    static_assert(sizeof(struct us_bun_socket_context_options_t) == sizeof(SocketContextOptions), "Mismatching uSockets/uWebSockets ABI");

template <bool SSL>
struct TemplatedApp {
private:
    struct SslCtxDeleter {
        void operator()(struct ssl_ctx_st *ctx) const { us_internal_ssl_ctx_unref(ctx); }
    };
    using SslCtxPtr = std::unique_ptr<struct ssl_ctx_st, SslCtxDeleter>;

    /* The app always owns at least one http context, but creates websocket contexts on demand */
    std::unique_ptr<HttpContext<SSL>> httpContext;
    /* Shared by every accepted socket; a listener takes its own ref. nullptr for plain HTTP. */
    SslCtxPtr sslCtx;
    /* SNI: the tree hangs off the listen socket, but addServerName() is allowed
     * before listen(). Queue them and replay onto each us_listen_socket_t. */
    struct PendingServerName {
        std::string hostname;
        SslCtxPtr ctx;
    };
    std::vector<PendingServerName> pendingServerNames;
    /* captureClientHello() ran: replayed onto each us_listen_socket_t, like the names above. */
    bool capturesClientHello = false;
    /* No raw us_listen_socket_t* cache here. src/runtime/server/mod.rs's stop calls
     * us_listen_socket_close(ls) directly; the listener is queued for free in
     * loop_post, so any vector we kept would dangle by the time the deferred
     * App::close() task runs. The group's intrusive head_listen_sockets list is
     * the only source of truth and is kept in sync by us_listen_socket_close(). */
    template <typename Fn>
    void forEachListenSocket(Fn &&fn) {
        for (auto *ls = us_socket_group_head_listen_socket(httpContext->getSocketGroup()); ls;
             ls = us_listen_socket_next(ls)) {
            fn(ls);
        }
    }

public:
    /* WebSockets in src/uws_sys/WebSocket.rs, which OwnedApp owns. */
    const void *webSockets = nullptr;

    /* Server name */
    TemplatedApp &&addServerName(const std::string &hostname_pattern, SocketContextOptions options = {}, bool *success = nullptr, bool applyClientCertPolicy = false) {

        /* Do nothing if not even on SSL */
        if constexpr (SSL) {
            enum create_bun_socket_error_t err = CREATE_BUN_SOCKET_ERROR_NONE;
            SslCtxPtr domainCtx{us_ssl_ctx_from_options(options, &err)};
            if (!domainCtx) {
                if (success) *success = false;
                return std::move(*this);
            }
            /* A per-serverName entry carries its own client-certificate
             * policy; the default entry's own hostname keeps the app-level
             * one. */
            if (applyClientCertPolicy) {
                us_ssl_ctx_set_sni_policy(domainCtx.get(), options.request_cert, options.reject_unauthorized);
            }
            if (httpContext->getSocketContextData()->http2Context) {
                us_ssl_ctx_enable_http2_alpn(domainCtx.get(), httpContext->getSocketContextData()->allowHttp1);
            }
            forEachListenSocket([&](us_listen_socket_t *ls) {
                us_listen_socket_add_server_name(ls, hostname_pattern.c_str(), domainCtx.get());
            });
            /* Queue for any listeners not yet created. We hold one SSL_CTX ref;
             * each listen socket took its own via SSL_CTX_up_ref. */
            pendingServerNames.push_back({hostname_pattern, std::move(domainCtx)});
            if (success) *success = true;
        }

        return std::move(*this);
    }

    /* Keep the ClientHello of every TLS connection this app accepts (us_socket_client_hello). */
    TemplatedApp &&captureClientHello() {
        if constexpr (SSL) {
            if (!constructorFailed()) {
                capturesClientHello = true;
                forEachListenSocket([](us_listen_socket_t *ls) {
                    us_listen_socket_capture_client_hello(ls);
                });
            }
        }
        return std::move(*this);
    }

    TemplatedApp &&missingServerName(MoveOnlyFunction<void(const char *hostname)> &&handler) {
        if (!constructorFailed()) {
            httpContext->getSocketContextData()->missingServerNameHandler = std::move(handler);
            forEachListenSocket([&](us_listen_socket_t *ls) {
                us_listen_socket_on_server_name(ls, &onMissingServerName);
            });
        }
        return std::move(*this);
    }

    /* Returns the SSL_CTX* of this app, or nullptr. */
    void *getNativeHandle() {
        return sslCtx.get();
    }

    /* Attaches a "filter" function to track socket connections/disconnections */
    TemplatedApp &&filter(MoveOnlyFunction<void(HttpResponse<SSL> *, int)> &&filterHandler) {
        httpContext->filter(std::move(filterHandler));

        return std::move(*this);
    }

    ~TemplatedApp() {
        if (httpContext) {
            if (Http2Context *h2 = httpContext->getSocketContextData()->http2Context) {
                h2->detach(httpContext->getSocketContextData());
            }
        }
    }

    /* Disallow copying, only move */
    TemplatedApp(const TemplatedApp &other) = delete;

    /* Heap-only — group.ext / SNI callback userdata point at `this`, so a move
     * would dangle. Bun always uses TemplatedApp::create() anyway. */
    TemplatedApp(TemplatedApp &&other) = delete;

private:
    static struct ssl_ctx_st *onMissingServerName(struct us_listen_socket_t *ls, const char *hostname, int *abort_handshake, struct us_socket_t *socket) {
        /* Bun.serve's missingServerName handler registers a context or lets the
         * default serve the request - it never aborts or suspends the handshake. */
        (void) abort_handshake;
        (void) socket;
        if (!ls) return nullptr;
        auto *httpContext = (HttpContext<SSL> *) us_socket_group_ext(us_listen_socket_group(ls));
        httpContext->getSocketContextData()->missingServerNameHandler(hostname);
        /* The handler is expected to have registered the name via
         * addServerName(); hand the newly-registered context back so the
         * in-flight handshake uses it (the resolver no longer re-checks the
         * SNI tree after this callback returns). The handler may also have
         * closed the listener, freeing the tree. */
        return us_listen_socket_find_server_name_ctx(ls, hostname);
    }

    TemplatedApp(SocketContextOptions options) {
        if constexpr (SSL) {
            enum create_bun_socket_error_t err = CREATE_BUN_SOCKET_ERROR_NONE;
            sslCtx.reset(us_ssl_ctx_from_options(options, &err));
            if (!sslCtx) return;
        }
        httpContext = std::make_unique<HttpContext<SSL>>(Loop::get(), options.request_cert, options.reject_unauthorized);
    }
public:

    static TemplatedApp<SSL>* create(SocketContextOptions options = {}) {
        std::unique_ptr<TemplatedApp<SSL>> app{new TemplatedApp<SSL>(options)};
        return app->constructorFailed() ? nullptr : app.release();
    }

    bool constructorFailed() {
        return !httpContext;
    }

    /* Closes all sockets including listen sockets. */
    TemplatedApp &&close() {
        /* close_all() walks head_listen_sockets first, so listeners are closed
         * here without us holding raw pointers to them across loop ticks. */
        us_socket_group_close_all(httpContext->getSocketGroup());
        Bun__WebSockets__close(webSockets);
        if (Http2Context *h2 = httpContext->getSocketContextData()->http2Context) {
            h2->closeAll();
        }

        return std::move(*this);
    }

    /* Route h2-negotiated (or prior-knowledge) connections to `ctx`. With
     * allowHttp1 == false, ALPN offers only "h2" and cleartext connections
     * that don't open with the preface get a 505. */
    void attachHttp2(Http2Context *ctx, bool allowHttp1) {
        ctx->attach(httpContext->getSocketContextData(), allowHttp1);
        if constexpr (SSL) {
            us_ssl_ctx_enable_http2_alpn(sslCtx.get(), allowHttp1);
            /* Bun attaches before addServerName(), which enables ALPN itself;
             * this covers embedders that add names first. */
            for (auto &p : pendingServerNames) {
                us_ssl_ctx_enable_http2_alpn(p.ctx.get(), allowHttp1);
            }
        }
    }

    /** Closes all connections connected to this server which are not sending a request or waiting for a response. Does not close the listen socket.
     * With closeWhenIdle set, connections that are busy right now are marked to close as soon as their in-flight work completes (graceful shutdown);
     * upgraded WebSockets and CONNECT/Upgrade tunnels never become idle, so they are left alone either way.
     * Returns the number of connections closed. */
    size_t closeIdle(bool closeWhenIdle = false) {
        auto *group = httpContext->getSocketGroup();
        struct us_socket_t *s = group->head_sockets;
        size_t closed = 0;
        while (s) {
            /* The HTTP group only holds HTTP sockets (an upgraded WebSocket is
             * adopted into its own group), so the ext block is an HttpResponseData. */
            auto *data = (HttpResponseData<SSL> *) ((AsyncSocket<SSL> *) s)->getAsyncSocketData();
            struct us_socket_t *next = s->next;
            if (((HttpResponse<SSL> *) s)->closeIfIdle()) {
                closed++;
            } else if (closeWhenIdle) {
                data->state |= HttpResponseData<SSL>::HTTP_CLOSE_WHEN_IDLE;
            }
            s = next;
        }
        /* A handshake parked in the loop's low-priority queue is unlinked from head_sockets. Never idle: it only needs the mark. */
        if (closeWhenIdle && group->low_prio_count) {
            for (s = group->loop->data.low_prio_head; s; s = s->next) {
                if (s->group == group) {
                    auto *data = (HttpResponseData<SSL> *) ((AsyncSocket<SSL> *) s)->getAsyncSocketData();
                    data->state |= HttpResponseData<SSL>::HTTP_CLOSE_WHEN_IDLE;
                }
            }
        }
        if (Http2Context *h2 = httpContext->getSocketContextData()->http2Context) {
            closed += h2->closeIdle(closeWhenIdle);
        }
        return closed;
    }

    /* Goes before get() */
    void ws(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        httpContext->onHttp("GET", pattern, std::move(handler), true);
    }

    TemplatedApp &&get(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        if (httpContext) {
            httpContext->onHttp("GET", pattern, std::move(handler));
        }
        return std::move(*this);
    }

    TemplatedApp &&post(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        if (httpContext) {
            httpContext->onHttp("POST", pattern, std::move(handler));
        }
        return std::move(*this);
    }

    TemplatedApp &&options(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        if (httpContext) {
            httpContext->onHttp("OPTIONS", pattern, std::move(handler));
        }
        return std::move(*this);
    }

    TemplatedApp &&del(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        if (httpContext) {
            httpContext->onHttp("DELETE", pattern, std::move(handler));
        }
        return std::move(*this);
    }

    TemplatedApp &&patch(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        if (httpContext) {
            httpContext->onHttp("PATCH", pattern, std::move(handler));
        }
        return std::move(*this);
    }

    TemplatedApp &&put(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        if (httpContext) {
            httpContext->onHttp("PUT", pattern, std::move(handler));
        }
        return std::move(*this);
    }

    void clearRoutes() {
        if (httpContext) {
            httpContext->getSocketContextData()->clearRoutes();
        }
    }


    TemplatedApp &&head(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        if (httpContext) {
            httpContext->onHttp("HEAD", pattern, std::move(handler));
        }
        return std::move(*this);
    }

    TemplatedApp &&connect(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        if (httpContext) {
            httpContext->onHttp("CONNECT", pattern, std::move(handler));
        }
        return std::move(*this);
    }

    TemplatedApp &&trace(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        if (httpContext) {
            httpContext->onHttp("TRACE", pattern, std::move(handler));
        }
        return std::move(*this);
    }

    /* This one catches any method */
    TemplatedApp &&any(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        if (httpContext) {
            httpContext->onHttp("*", pattern, std::move(handler));
        }
        return std::move(*this);
    }

private:
    /* Replay queued SNI entries onto a fresh listener. The listener is already
     * linked into the http group's head_listen_sockets by us_socket_group_listen,
     * which is the only owner — we don't (and must not) cache the raw pointer. */
    us_listen_socket_t *trackListenSocket(us_listen_socket_t *ls) {
        if (!ls) return nullptr;
        if constexpr (SSL) {
            for (auto &p : pendingServerNames) {
                us_listen_socket_add_server_name(ls, p.hostname.c_str(), p.ctx.get());
            }
            if (httpContext->getSocketContextData()->missingServerNameHandler) {
                us_listen_socket_on_server_name(ls, &onMissingServerName);
            }
            if (capturesClientHello) us_listen_socket_capture_client_hello(ls);
        }
        return ls;
    }

    struct ssl_ctx_st *sslCtxOrNull() { return SSL ? sslCtx.get() : nullptr; }

public:
    /* Host, port, options, callback */
    TemplatedApp &&listen(const std::string &host, int port, int options, MoveOnlyFunction<void(us_listen_socket_t *)> &&handler) {
        if (host.empty()) {
            return listen(port, options, std::move(handler));
        }
        handler(httpContext ? trackListenSocket(httpContext->listen(sslCtxOrNull(), host.c_str(), port, options)) : nullptr);
        return std::move(*this);
    }

    /* Port, callback */
    TemplatedApp &&listen(int port, MoveOnlyFunction<void(us_listen_socket_t *)> &&handler) {
        handler(httpContext ? trackListenSocket(httpContext->listen(sslCtxOrNull(), nullptr, port, 0)) : nullptr);
        return std::move(*this);
    }

    /* Port, options, callback */
    TemplatedApp &&listen(int port, int options, MoveOnlyFunction<void(us_listen_socket_t *)> &&handler) {
        handler(httpContext ? trackListenSocket(httpContext->listen(sslCtxOrNull(), nullptr, port, options)) : nullptr);
        return std::move(*this);
    }

    /* options, callback, path to unix domain socket */
    TemplatedApp &&listen(int options, MoveOnlyFunction<void(us_listen_socket_t *)> &&handler, std::string_view path) {
        handler(httpContext ? trackListenSocket(httpContext->listen_unix(sslCtxOrNull(), path.data(), path.length(), options)) : nullptr);
        return std::move(*this);
    }

    void setOnSocketClosed(HttpContextData<SSL>::OnSocketClosedCallback onClose) {
        httpContext->getSocketContextData()->onSocketClosed = onClose;
    }
    void setOnSocketDrain(HttpContextData<SSL>::OnSocketDrainCallback onDrain) {
        httpContext->getSocketContextData()->onSocketDrain = onDrain;
    }
    void setOnSocketData(HttpContextData<SSL>::OnSocketDataCallback onData) {
        httpContext->getSocketContextData()->onSocketData = onData;
    }

    void setOnClientError(HttpContextData<SSL>::OnClientErrorCallback onClientError) {
        httpContext->getSocketContextData()->onClientError = std::move(onClientError);
    }

    void setOnSocketUpgraded(HttpContextData<SSL>::OnSocketUpgradedCallback onUpgraded) {
        httpContext->getSocketContextData()->onSocketUpgraded = onUpgraded;
    }

    /* Switch this app into node:http compat mode (see HttpContext::enableNodeHttpCompat). */
    void enableNodeHttpCompat() {
        httpContext->enableNodeHttpCompat();
    }

    TemplatedApp &&run() {
        uWS::run();
        return std::move(*this);
    }

    TemplatedApp &&setUsingCustomExpectHandler(bool value) {
        httpContext->getSocketContextData()->flags.usingCustomExpectHandler = value;
        return std::move(*this);
    }

    /* lenientHttpFlags: bit 0 = lenient header values (llhttp LENIENT_HEADERS),
     * bit 1 = lenient transfer-encoding (llhttp LENIENT_TRANSFER_ENCODING). */
    TemplatedApp &&setFlags(bool requireHostHeader, bool useStrictMethodValidation, uint8_t lenientHttpFlags, bool httpAllowHalfOpen) {
        httpContext->getSocketContextData()->flags.requireHostHeader = requireHostHeader;
        httpContext->getSocketContextData()->flags.useStrictMethodValidation = useStrictMethodValidation;
        httpContext->getSocketContextData()->flags.useInsecureHTTPParser = (lenientHttpFlags & 1) != 0;
        httpContext->getSocketContextData()->flags.useLenientTransferEncoding = (lenientHttpFlags & 2) != 0;
        httpContext->getSocketContextData()->flags.httpAllowHalfOpen = httpAllowHalfOpen;
        return std::move(*this);
    }

    TemplatedApp &&setMaxHTTPHeaderSize(uint64_t maxHeaderSize) {
        httpContext->getSocketContextData()->maxHeaderSize = maxHeaderSize;
        return std::move(*this);
    }

    TemplatedApp &&setMaxHeadersCount(uint32_t maxHeadersCount) {
        httpContext->getSocketContextData()->maxHeadersCount = maxHeadersCount;
        return std::move(*this);
    }

};

typedef TemplatedApp<false> App;
typedef TemplatedApp<true> SSLApp;


}
