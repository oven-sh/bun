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

extern "C" void Bun__WebSockets__close(const void *webSockets, int threadEnds);

namespace uWS {

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
        bool ownClientAuth;
    };
    std::vector<PendingServerName> pendingServerNames;
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

    /* Server name. See us_listen_socket_add_server_name for ownClientAuth. */
    TemplatedApp &&addServerName(const std::string &hostname_pattern, struct ssl_ctx_st *domainCtx, bool ownClientAuth) {
        static_assert(SSL);
        forEachListenSocket([&](us_listen_socket_t *ls) {
            us_listen_socket_add_server_name(ls, hostname_pattern.c_str(), domainCtx, ownClientAuth);
        });
        /* Queue for any listeners not yet created. We hold one SSL_CTX ref;
         * each listen socket took its own via SSL_CTX_up_ref. */
        us_internal_ssl_ctx_up_ref(domainCtx);
        pendingServerNames.push_back({hostname_pattern, SslCtxPtr{domainCtx}, ownClientAuth});

        return std::move(*this);
    }

    /* Attaches a "filter" function to track socket connections/disconnections */
    TemplatedApp &&filter(MoveOnlyFunction<void(HttpResponse<SSL> *, int)> &&filterHandler) {
        httpContext->filter(std::move(filterHandler));

        return std::move(*this);
    }

    ~TemplatedApp() {
        if (Http2Context *h2 = httpContext->getSocketContextData()->http2Context) {
            h2->detach(httpContext->getSocketContextData());
        }
    }

    /* Disallow copying, only move */
    TemplatedApp(const TemplatedApp &other) = delete;

    /* Heap-only — group.ext / SNI callback userdata point at `this`, so a move
     * would dangle. Bun always uses TemplatedApp::create() anyway. */
    TemplatedApp(TemplatedApp &&other) = delete;

private:
    /* `ctx` is what every accepted socket starts from, nullptr exactly when !SSL. */
    TemplatedApp(struct ssl_ctx_st *ctx) : httpContext(std::make_unique<HttpContext<SSL>>(Loop::get())), sslCtx(ctx) {
        if constexpr (SSL) us_internal_ssl_ctx_up_ref(ctx);
    }
public:

    static TemplatedApp<SSL>* create(struct ssl_ctx_st *ctx) {
        return new TemplatedApp<SSL>(ctx);
    }

    /* Closes all sockets including listen sockets. `thread_ends`: see us_socket_group_close_all_ex. */
    TemplatedApp &&close(int thread_ends) {
        /* A close handler can tick the loop (waitForPromise). That tick must not free the sockets closed here, which the walks below still read. */
        us_loop_t *loop = httpContext->getSocketGroup()->loop;
        loop->data.tick_depth++;
        std::vector<us_socket_t *> connections;
        for (us_socket_t *s = httpContext->getSocketGroup()->head_sockets; s; s = s->next) {
            connections.push_back(s);
        }
        for (us_socket_t *s : connections) {
            /* An earlier close ran JavaScript. */
            if (us_socket_is_closed(s) || us_socket_group(s) != httpContext->getSocketGroup()) {
                continue;
            }
            auto *res = (HttpResponse<SSL> *) s;
            /* The group's close looks like the end of a whole stream. Not over a response that isn't finished or isn't sent. */
            if ((SSL && (!res->hasResponded() || !((AsyncSocket<SSL> *) s)->hasFullyDrained())) || res->isCloseDelimitedAndUnfinished()) {
                us_socket_close(s, LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET, nullptr);
            }
        }
        /* close_all() walks head_listen_sockets first, so listeners are closed
         * here without us holding raw pointers to them across loop ticks. */
        us_socket_group_close_all_ex(httpContext->getSocketGroup(), 1, thread_ends);
        Bun__WebSockets__close(webSockets, thread_ends);
        if (Http2Context *h2 = httpContext->getSocketContextData()->http2Context) {
            h2->closeAll(thread_ends);
        }
        loop->data.tick_depth--;

        return std::move(*this);
    }

    /* Route h2-negotiated (or prior-knowledge) connections to `ctx`. With
     * allowHttp1 == false, ALPN offers only "h2" and cleartext connections
     * that don't open with the preface get a 505. */
    void attachHttp2(Http2Context *ctx, bool allowHttp1) {
        ctx->attach(httpContext->getSocketContextData(), allowHttp1);
        if constexpr (SSL) {
            forEachListenSocket([&](us_listen_socket_t *ls) {
                offerHttp2(ls);
            });
        }
    }

    /** Closes all connections connected to this server which are not sending a request or waiting for a response. Does not close the listen socket.
     * With closeWhenIdle set, connections that are busy right now are marked to close as soon as their in-flight work completes (graceful shutdown);
     * upgraded WebSockets are in another group, so they are left alone either way.
     * Returns the number of connections closed. */
    size_t closeIdle(bool closeWhenIdle = false) {
        auto *group = httpContext->getSocketGroup();
        struct us_socket_t *s = group->head_sockets;
        size_t closed = 0;
        while (s) {
            /* The HTTP group only holds HTTP sockets (an upgraded WebSocket is
             * adopted into its own group), so the ext block is an HttpResponseData. */
            struct us_socket_t *next = s->next;
            /* A program that exits once stop() resolves would reset what the kernel hasn't delivered. */
            if (((HttpResponse<SSL> *) s)->closeIfIdle(closeWhenIdle)) {
                closed++;
            } else if (closeWhenIdle) {
                ((HttpResponse<SSL> *) s)->closeWhenIdle();
            }
            s = next;
        }
        /* A handshake parked in the loop's low-priority queue is unlinked from head_sockets. Never idle: it only needs the mark. */
        if (closeWhenIdle && group->low_prio_count) {
            for (s = group->loop->data.low_prio_head; s; s = s->next) {
                if (s->group == group) {
                    ((HttpResponse<SSL> *) s)->closeWhenIdle();
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
        httpContext->onHttp("GET", pattern, std::move(handler));
        return std::move(*this);
    }

    TemplatedApp &&post(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        httpContext->onHttp("POST", pattern, std::move(handler));
        return std::move(*this);
    }

    TemplatedApp &&options(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        httpContext->onHttp("OPTIONS", pattern, std::move(handler));
        return std::move(*this);
    }

    TemplatedApp &&del(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        httpContext->onHttp("DELETE", pattern, std::move(handler));
        return std::move(*this);
    }

    TemplatedApp &&patch(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        httpContext->onHttp("PATCH", pattern, std::move(handler));
        return std::move(*this);
    }

    TemplatedApp &&put(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        httpContext->onHttp("PUT", pattern, std::move(handler));
        return std::move(*this);
    }

    void clearRoutes() {
        httpContext->getSocketContextData()->clearRoutes();
    }


    TemplatedApp &&head(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        httpContext->onHttp("HEAD", pattern, std::move(handler));
        return std::move(*this);
    }

    TemplatedApp &&connect(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        httpContext->onHttp("CONNECT", pattern, std::move(handler));
        return std::move(*this);
    }

    TemplatedApp &&trace(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        httpContext->onHttp("TRACE", pattern, std::move(handler));
        return std::move(*this);
    }

    /* This one catches any method */
    TemplatedApp &&any(std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler) {
        httpContext->onHttp("*", pattern, std::move(handler));
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
                us_listen_socket_add_server_name(ls, p.hostname.c_str(), p.ctx.get(), p.ownClientAuth);
            }
            offerHttp2(ls);
        }
        return ls;
    }

    /* With an HTTP/2 context attached, TLS connections prefer "h2", then "http/1.1" if HTTP/1 is allowed. */
    void offerHttp2(us_listen_socket_t *ls) {
        auto *data = httpContext->getSocketContextData();
        if (data->http2Context) {
            us_listen_socket_set_alpn(ls, (const unsigned char *) "\x02h2\x08http/1.1", data->allowHttp1 ? 12 : 3, !data->allowHttp1);
        }
    }

    struct ssl_ctx_st *sslCtxOrNull() { return SSL ? sslCtx.get() : nullptr; }

public:
    /* A nullptr host listens on every address. See us_socket_group_listen for the out-params. */
    us_listen_socket_t *listen(const char *host, int port, int options, int *error, int *dnsError) {
        return httpContext ? trackListenSocket(httpContext->listen(sslCtxOrNull(), host, port, options, error, dnsError)) : nullptr;
    }

    us_listen_socket_t *listen_unix(std::string_view path, int options, int *error) {
        return httpContext ? trackListenSocket(httpContext->listen_unix(sslCtxOrNull(), path.data(), path.length(), options, error)) : nullptr;
    }

    /* already-bound descriptor, backlog, options, errno out */
    us_listen_socket_t *listen_fd(LIBUS_SOCKET_DESCRIPTOR fd, int options, int *error) {
        return httpContext ? trackListenSocket(httpContext->listen_fd(sslCtxOrNull(), fd, options, error)) : nullptr;
    }

    void setOnClientError(HttpContextData<SSL>::OnClientErrorCallback onClientError) {
        httpContext->getSocketContextData()->onClientError = std::move(onClientError);
    }

    /* Switch this app into node:http compat mode (see HttpContext::enableNodeHttpCompat). */
    void enableNodeHttpCompat(const NodeHttpSocketHooks *hooks) {
        httpContext->enableNodeHttpCompat(hooks);
    }

    TemplatedApp &&setUsingCustomExpectHandler(bool value) {
        httpContext->getSocketContextData()->flags.usingCustomExpectHandler = value;
        return std::move(*this);
    }

    /* lenientHttpFlags: bit 0 = lenient header values (llhttp LENIENT_HEADERS),
     * bit 1 = lenient transfer-encoding (llhttp LENIENT_TRANSFER_ENCODING). */
    TemplatedApp &&setFlags(uint8_t lenientHttpFlags, bool httpAllowHalfOpen) {
        httpContext->getSocketContextData()->flags.useInsecureHTTPParser = (lenientHttpFlags & 1) != 0;
        httpContext->getSocketContextData()->flags.useLenientTransferEncoding = (lenientHttpFlags & 2) != 0;
        httpContext->getSocketContextData()->flags.httpAllowHalfOpen = httpAllowHalfOpen;
        return std::move(*this);
    }

    TemplatedApp &&setIdleTimeout(uint8_t seconds) {
        httpContext->getSocketContextData()->idleTimeout = seconds;
        return std::move(*this);
    }

    TemplatedApp &&setMaxHTTPHeaderSize(uint64_t maxHeaderSize) {
        httpContext->getSocketContextData()->maxHeaderSize = maxHeaderSize;
        return std::move(*this);
    }

    TemplatedApp &&setMaxRequestBodySize(uint64_t maxRequestBodySize) {
        httpContext->getSocketContextData()->maxRequestBodySize = maxRequestBodySize;
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
