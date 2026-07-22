// clang-format off
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

#pragma once

/* This class defines the main behavior of HTTP and emits various events */

#include "Loop.h"
#include "HttpContextData.h"
#include "HttpResponseData.h"
#include "AsyncSocket.h"
#include "WebSocketData.h"
#include "SocketKinds.h"

#include <string>
#include <map>
#include <string_view>
#include <iostream>
#include "MoveOnlyFunction.h"
#include "HttpParser.h"
#include <span>
#include <array>
#include <mutex>


namespace uWS {

namespace detail {

template <typename T, typename... Args>
[[nodiscard]] constexpr auto makeArray(T&& el0, Args&&... values) noexcept {
    return std::array<std::decay_t<T>, 1 + sizeof...(Args)>{
        std::forward<T>(el0), std::forward<Args>(values)...
    };
}

static constexpr auto supportedHttpMethods = makeArray<std::string_view>(
    "ACL",
    "BIND",
    "CHECKOUT",
    "CONNECT",
    "COPY",
    "DELETE",
    "GET",
    "HEAD",
    "LINK",
    "LOCK",
    "M-SEARCH",
    "MERGE",
    "MKACTIVITY",
    "MKADDRESSBOOK",
    "MKCALENDAR",
    "MKCOL",
    "MOVE",
    "NOTIFY",
    "OPTIONS",
    "PATCH",
    "POST",
    "PROPFIND",
    "PROPPATCH",
    "PURGE",
    "PUT",
    "QUERY",
    "REBIND",
    "REPORT",
    "SEARCH",
    "SOURCE",
    "SUBSCRIBE",
    "TRACE",
    "UNBIND",
    "UNLINK",
    "UNLOCK",
    "UNSUBSCRIBE"
);

} // namespace detail

template<bool> struct HttpResponse;

/* Real heap-allocated owner of one HTTP server's socket group + router state.
 * Replaces the old reinterpret_cast over us_socket_context_t — `group.ext`
 * points back to `this` so socket handlers recover the typed context via
 * `(HttpContext<SSL>*) us_socket_group_ext(us_socket_group(s))`. */
template <bool SSL>
struct HttpContext {
    template<bool> friend struct TemplatedApp;
    template<bool> friend struct HttpResponse;
private:
    HttpContext() = default;

    /* Embedded list-head for accepted sockets. The vtable is `httpVTable` below;
     * SSL_CTX comes from the listener, not from here. */
    us_socket_group_t group{};
    HttpContextData<SSL> data;

    /* fromSocket() / getSocketContextDataS() cast group.ext back to
     * HttpContext*; nothing else relies on offsetof(data), but pin group at 0
     * so a future base class or vptr doesn't quietly break the cast. */
    static void layoutAssert() {
        static_assert(!std::is_polymorphic_v<HttpContext>,
                      "HttpContext must stay non-polymorphic (group.ext = this)");
        static_assert(offsetof(HttpContext, group) == 0,
                      "HttpContext::fromSocket layout assumption broken");
    }

    /* Maximum delay allowed until an HTTP connection is terminated due to outstanding request or rejected data (slow loris protection) */
    static constexpr int HTTP_IDLE_TIMEOUT_S = 10;

    /* Minimum allowed receive throughput per second (clients uploading less than 16kB/sec get dropped) */
    static constexpr int HTTP_RECEIVE_THROUGHPUT_BYTES = 16 * 1024;

    /* Not constexpr — the ordinals are linked from `src/uws_sys/SocketKind.rs`
     * so a reorder there can't silently mis-route us. Only ever read
     * at runtime (listen/adopt). */
    static unsigned char socketKind() { return SSL ? US_SOCKET_KIND_UWS_HTTP_TLS : US_SOCKET_KIND_UWS_HTTP; }

public:
    us_socket_group_t *getSocketGroup() {
        return &group;
    }

    HttpContextData<SSL> *getSocketContextData() {
        return &data;
    }

    static HttpContext<SSL> *fromSocket(us_socket_t *s) {
        return (HttpContext<SSL> *) us_socket_group_ext(us_socket_group(s));
    }

    static HttpContextData<SSL> *getSocketContextDataS(us_socket_t *s) {
        return &fromSocket(s)->data;
    }

private:
    /* ── vtable handlers ─────────────────────────────────────────────────── */

    static void onHandshake(us_socket_t *s, int success, struct us_bun_verify_error_t verify_error, void * /*custom_data*/) {
        // if we are closing or already closed, we don't need to do anything
        if (!us_socket_is_closed(s)) {
            HttpContextData<SSL> *httpContextData = getSocketContextDataS(s);
            // Set per-socket authorization status
            auto *httpResponseData = reinterpret_cast<HttpResponseData<SSL> *>(us_socket_ext(s));
            if(httpContextData->flags.rejectUnauthorized) {
                if(!success || verify_error.error != 0) {
                    // we failed to handshake, close the socket
                    us_socket_close(s, 0, nullptr);
                    return;
                }
            }
            /* This bit backs node's `socket._secureEstablished` (via
             * JSNodeHTTPServerSocket::isAuthorized → handle.secureEstablished),
             * i.e. "TLS handshake completed", not "peer cert verified". A
             * server that doesn't requestCert will always see
             * verify_error.error != 0 (no client cert), so do NOT fold the
             * verify result in here — that would make every HTTPS request
             * report _secureEstablished = false. Peer-cert authorization is
             * surfaced separately (rejectUnauthorized above / tls.authorized). */
            httpResponseData->isAuthorized = success;

            /* Any connected socket should timeout until it has a request */
            ((HttpResponse<SSL> *) s)->resetTimeout();

            /* Call filter */
            for (auto &f : httpContextData->filterHandlers) {
                f((HttpResponse<SSL> *) s, 1);
            }
        }
    }

    template <bool IsNodeHttp>
    static us_socket_t *onOpen(us_socket_t *s, int /*is_client*/, char * /*ip*/, int /*ip_length*/) {
        /* Init socket ext. IsNodeHttp contexts carry the bigger
         * HttpResponseData<SSL, true> block; the listen socket was sized for it
         * (see socketExtSize()) and this handler instantiation was installed by
         * enableNodeHttpCompat(). */
        if constexpr (IsNodeHttp) {
            new (us_socket_ext(s)) HttpResponseData<SSL, true>;
        } else {
            new (us_socket_ext(s)) HttpResponseData<SSL>;
        }
          /* Any connected socket should timeout until it has a request */
        ((HttpResponse<SSL> *) s)->resetTimeout();

        HttpContextData<SSL> *httpContextData = getSocketContextDataS(s);

        /* node:http compat: the headers/request timeout window opens at accept
         * (mirrors the parser-initialize timestamp in Node's ConnectionsList),
         * so a client that connects and never sends anything still expires. */
        if constexpr (IsNodeHttp) {
            ((HttpResponseData<SSL, true> *) us_socket_ext(s))->lastMessageStartMs = nodeCompatMonotonicMs();
            /* A peer FIN must not tear the connection down at the loop level:
             * onEnd() below decides whether to close right away (idle) or to
             * keep writing the responses that are still in flight / pipelined
             * (Node's socketOnEnd semantics). Without this flag the loop
             * force-closes the socket right after dispatching onEnd. TLS
             * (openssl.c us_internal_ssl_on_end) does not consult this flag
             * and force-closes on FIN regardless, so this half of the compat
             * block is http-only for now. */
            if constexpr (!SSL) {
                s->flags.allow_half_open = 1;
            }
        }

        if(!SSL) {
            /* Call filter */
            for (auto &f : httpContextData->filterHandlers) {
                f((HttpResponse<SSL> *) s, 1);
            }
        }

        return s;
    }

    template <bool IsNodeHttp>
    static us_socket_t *onClose(us_socket_t *s, int /*code*/, void * /*reason*/) {
        ((AsyncSocket<SSL> *)s)->uncorkWithoutSending();

        /* Get socket ext */
        auto *httpResponseData = reinterpret_cast<HttpResponseData<SSL> *>(us_socket_ext(s));


        /* Call filter */
        HttpContextData<SSL> *httpContextData = getSocketContextDataS(s);

        bool nodeHttpTunnelAfterBody = false;
        if constexpr (IsNodeHttp) nodeHttpTunnelAfterBody = (httpResponseData->state & HttpResponseData<SSL>::HTTP_NODE_TUNNEL_AFTER_BODY) != 0;
        if(httpResponseData->isConnectRequest || nodeHttpTunnelAfterBody) {
            if (httpResponseData->socketData && httpContextData->onSocketData) {
                httpContextData->onSocketData(httpResponseData->socketData, SSL, s, "", 0, true);
            }
            if(httpResponseData->inStream) {
                httpResponseData->inStream(reinterpret_cast<HttpResponse<SSL> *>(s), "", 0, true, httpResponseData->userData);
                httpResponseData->inStream = nullptr;
            }
        }


        for (auto &f : httpContextData->filterHandlers) {
            f((HttpResponse<SSL> *) s, -1);
        }

        if (httpResponseData->socketData && httpContextData->onSocketClosed) {
            httpContextData->onSocketClosed(httpResponseData->socketData, SSL, s);
        }
        /* Signal broken HTTP request only if we have a pending request */
        if (httpResponseData->onAborted != nullptr && httpResponseData->userData != nullptr) {
            httpResponseData->onAborted((HttpResponse<SSL> *)s, httpResponseData->userData);
        }


        /* Destruct the type onOpen<IsNodeHttp> constructed */
        if constexpr (IsNodeHttp) {
            ((HttpResponseData<SSL, true> *) httpResponseData)->~HttpResponseData<SSL, true>();
        } else {
            httpResponseData->~HttpResponseData<SSL>();
        }

        return s;
    }

    template <bool IsNodeHttp>
    static us_socket_t *onData(us_socket_t *s, char *data, int length) {
        // ref the socket to make sure we process it entirely before it is closed
        us_socket_ref(s);

        // total overhead is about 210k down to 180k
        // ~210k req/sec is the original perf with write in data
        // ~200k req/sec is with cork and formatting
        // ~190k req/sec is with http parsing
        // ~180k - 190k req/sec is with varying routing

        HttpContextData<SSL> *httpContextData = getSocketContextDataS(s);

        /* Do not accept any data while in shutdown state */
        if (us_socket_is_shut_down((us_socket_t *) s)) {
            /* Balance the us_socket_ref above — every other return path
             * reaches the unref via returnedData. */
            us_socket_unref(s);
            return s;
        }

        HttpResponseData<SSL> *httpResponseData = (HttpResponseData<SSL> *) us_socket_ext(s);

        /* node:http compat: HTTP parsing stopped on this connection (a parse error
         * was already delivered to 'clientError', or the JS layer freed the
         * parser); ignore further request bytes. CONNECT/Upgrade tunnels are not
         * parsed as HTTP and keep flowing below. */
        if constexpr (IsNodeHttp) {
            if ((httpResponseData->state & HttpResponseData<SSL>::HTTP_NODE_PARSING_STOPPED) && !httpResponseData->isConnectRequest) {
                us_socket_unref(s);
                return s;
            }
        }

        /* Cork this socket */
        ((AsyncSocket<SSL> *) s)->cork();

        /* Mark that we are inside the parser now */
        httpContextData->flags.isParsingHttp = true;
        httpResponseData->isIdle = false;

        /* node:http compat: maintain the headers/request timeout window (see
         * the requestHandler/dataHandler hooks and the post-parse check). */
        const bool trackNodeHttpTimings = IsNodeHttp && !httpResponseData->isConnectRequest;

        // clients need to know the cursor after http parse, not servers!
        // how far did we read then? we need to know to continue with websocket parsing data? or?

        void *proxyParser = nullptr;
#ifdef UWS_WITH_PROXY
        proxyParser = &httpResponseData->proxyParser;
#endif

        /* The return value is entirely up to us to interpret. The HttpParser cares only for whether the returned value is DIFFERENT from passed user */

        /* node:http compat: the trailer capture lives in the IsNodeHttp=true ext
         * block; the Bun.serve instantiation passes nullptr (and its parser
         * instantiation contains no use of it). */
        std::string *nodeHttpRequestTrailers = nullptr;
        if constexpr (IsNodeHttp) {
            auto *nodeHttpResponseData = (HttpResponseData<SSL, true> *) httpResponseData;
            nodeHttpRequestTrailers = &nodeHttpResponseData->nodeHttpRequestTrailers;
        }

        auto result = httpResponseData->template consumePostPadded<IsNodeHttp>(httpContextData->maxHeaderSize, httpResponseData->isConnectRequest, httpContextData->flags.requireHostHeader,httpContextData->flags.useStrictMethodValidation, httpContextData->flags.useInsecureHTTPParser, nodeHttpRequestTrailers, &httpResponseData->chunkedExtensionsByteCount, data, (unsigned int) length, s, proxyParser, [httpContextData](void *s, HttpRequest *httpRequest) -> void * {


            /* For every request we reset the timeout and hang until user makes action */
            /* Warning: if we are in shutdown state, resetting the timer is a security issue! */
            us_socket_timeout((us_socket_t *) s, 0);

            HttpResponseData<SSL> *httpResponseData = (HttpResponseData<SSL> *) us_socket_ext((us_socket_t *) s);

            /* node:http compat: the JS layer stopped HTTP processing on this
             * connection (the user emitted 'close' on the socket - Node frees
             * the parser there); abandon the rest of the buffer. */
            if constexpr (IsNodeHttp) {
                if (httpResponseData->state & HttpResponseData<SSL>::HTTP_NODE_PARSING_STOPPED) {
                    return nullptr;
                }
            }

            /* node:http compat: the request head has been fully parsed, so only
             * requestTimeout (not headersTimeout) applies from here on. A
             * pipelined request whose head sits mid-buffer never went through
             * onData with an idle connection, so open its window here too. */
            if constexpr (IsNodeHttp) {
                auto *nodeHttpResponseData = (HttpResponseData<SSL, true> *) httpResponseData;
                if (nodeHttpResponseData->lastMessageStartMs == 0) {
                    nodeHttpResponseData->lastMessageStartMs = nodeCompatMonotonicMs();
                }
                nodeHttpResponseData->headersCompleted = true;
            }

            /* Are we not ready for another request yet? Terminate the connection.
             * Important for denying async pipelining until, if ever, we want to support it.
             * Otherwise requests can get mixed up on the same connection. We still support sync pipelining. */
            bool hasQueuedPipelinedResponses = false;
            if constexpr (IsNodeHttp) hasQueuedPipelinedResponses = httpResponseData->nodeHttpQueuedPipelinedCount > 0;
            if ((httpResponseData->state & HttpResponseData<SSL>::HTTP_RESPONSE_PENDING) || hasQueuedPipelinedResponses) {
                if constexpr (!IsNodeHttp) {
                    us_socket_close((us_socket_t *) s, 0, nullptr);
                    return nullptr;
                } else {

                /* node:http supports async pipelining: the request is dispatched
                 * while the previous response is still in flight and the JS layer
                 * queues its response (res.socket === null until it becomes the
                 * connection's current response). The per-response state reset is
                 * skipped here - it still belongs to the in-flight response - and
                 * is applied by JSNodeHTTPServerSocket::startPipelinedResponse()
                 * when the queued response is activated. Node keeps reading and
                 * dispatching pipelined requests while responses are queued (its
                 * parserOnIncoming only pauses the socket once the outgoing data
                 * backs up), so reads are paused only when this connection already
                 * has unsent outgoing backpressure; they resume once the pipeline
                 * drains and the backpressure flushes (startPipelinedResponse /
                 * onWritable). */
                httpResponseData->state |= HttpResponseData<SSL>::HTTP_NODE_PIPELINED_DISPATCH;
                httpResponseData->nodeHttpQueuedPipelinedCount++;
                if (((AsyncSocket<SSL> *) s)->getBufferedAmount() > 0) {
                    httpResponseData->state |= HttpResponseData<SSL>::HTTP_NODE_READS_PAUSED;
                    ((HttpResponse<SSL> *) s)->pause();
                }
                }
            } else {
                /* Reset httpResponse */
                httpResponseData->offset = 0;

                /* Mark pending request and emit it. This also clears the previous
                 * response's per-request framing bits (204/304, close-delimited,
                 * trailers), which writeHead only ever sets: a stale one would
                 * strip the next response's body framing. */
                httpResponseData->resetResponseState();

                /* An ancient (HTTP/1.0) request gets no keep-alive and no chunked
                 * framing; so does an explicit `Connection: close`. */
                const bool isAncient = httpRequest->isAncient();
                if (isAncient) {
                    httpResponseData->state |= HttpResponseData<SSL>::HTTP_ANCIENT_REQUEST | HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE;
                } else if (httpRequest->getHeader("connection").length() == 5) {
                    httpResponseData->state |= HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE;
                }

                /* Per-response trailer fields must not leak into the next response
                 * on this keep-alive connection (the flag itself was cleared above). */
                if constexpr (IsNodeHttp) {
                    ((HttpResponseData<SSL, true> *) httpResponseData)->nodeHttpResponseTrailers.clear();
                }
            }

            /* The listen socket is gone (Bun.serve graceful stop): refuse this
             * request with 503 + Connection: close rather than dispatching it.
             * Covers every route (static/dynamic/upgrade) in one place, before
             * any route handler runs. */
            if (httpContextData->flags.draining) [[unlikely]] {
                ((HttpResponse<SSL> *) s)->writeStatus("503 Service Unavailable");
                ((HttpResponse<SSL> *) s)->endWithoutBody(std::nullopt, true);
                return s;
            }

            /* Select the router based on SNI (only possible for SSL) */
            auto *selectedRouter = &httpContextData->router;
            if constexpr (SSL) {
                void *domainRouter = us_socket_server_name_userdata((struct us_socket_t *) s);
                if (domainRouter) {
                    selectedRouter = (decltype(selectedRouter)) domainRouter;
                }
            }

            /* Route the method and URL */
            selectedRouter->getUserData() = {(HttpResponse<SSL> *) s, httpRequest};
            if (!selectedRouter->route(httpRequest->getCaseSensitiveMethod(), httpRequest->getUrlForRouting())) {
                /* We have to force close this socket as we have no handler for it */
                us_socket_close((us_socket_t *) s, 0, nullptr);
                return nullptr;
            }

            /* First of all we need to check if this socket was deleted due to upgrade */
            if (httpContextData->upgradedWebSocket) {
                /* We differ between closed and upgraded below */
                return nullptr;
            }

            /* Was the socket closed? */
            if (us_socket_is_closed((us_socket_t *) s)) {
                return nullptr;
            }

            /* We absolutely have to terminate parsing if shutdown */
            if (us_socket_is_shut_down((us_socket_t *) s)) {
                return nullptr;
            }

            /* node:http compat: the pipelined-dispatch marker is only meaningful
             * while this dispatch is on the stack. */
            if constexpr (IsNodeHttp) {
                httpResponseData->state &= ~HttpResponseData<SSL>::HTTP_NODE_PIPELINED_DISPATCH;
            }

            /* Returning from a request handler without responding or attaching an onAborted handler is ill-use */
            if (!((HttpResponse<SSL> *) s)->hasResponded() && !httpResponseData->onAborted && !httpResponseData->socketData) {
                /* Throw exception here? */
                std::cerr << "Error: Returning from a request handler without responding or attaching an abort handler is forbidden!" << std::endl;
                std::terminate();
            }

            /* If we have not responded and we have a data handler, we need to timeout to enfore client sending the data */
            if (!((HttpResponse<SSL> *) s)->hasResponded() && httpResponseData->inStream) {
                ((HttpResponse<SSL> *) s)->resetTimeout();
            }

            /* Continue parsing */
            return s;

        }, [httpResponseData, httpContextData](void *user, std::string_view data, bool fin) -> void * {

            /* node:http compat: an accepted Upgrade request's body just completed -
             * after this fin chunk has been delivered to the request body stream
             * below, the connection switches into tunnel mode so every byte after
             * the end of the message reaches the 'upgrade' listener's socket as
             * opaque data. Deferred so the fin itself is not routed to the
             * raw-socket data path. */
            bool switchToTunnelAfterThisChunk = false;
            if constexpr (IsNodeHttp) {
                switchToTunnelAfterThisChunk = fin && !httpResponseData->isConnectRequest && (httpResponseData->state & HttpResponseData<SSL>::HTTP_NODE_TUNNEL_AFTER_BODY);
            }

            /* node:http compat: the request message (head + body) has been fully
             * received - the connection is idle for the headers/request timeout
             * sweeps until the next message starts. */
            if constexpr (IsNodeHttp) {
                if (fin && !httpResponseData->isConnectRequest) {
                    auto *nodeHttpResponseData = (HttpResponseData<SSL, true> *) httpResponseData;
                    nodeHttpResponseData->lastMessageStartMs = 0;
                    nodeHttpResponseData->headersCompleted = false;
                }
            }

            if (httpResponseData->isConnectRequest && httpResponseData->socketData && httpContextData->onSocketData) {
                httpContextData->onSocketData(httpResponseData->socketData, SSL, (struct us_socket_t *) user, data.data(), data.length(), fin);
            }

            if (switchToTunnelAfterThisChunk) {
                httpResponseData->state &= ~HttpResponseData<SSL>::HTTP_NODE_TUNNEL_AFTER_BODY;
                httpResponseData->isConnectRequest = true;
            }
            /* We always get an empty chunk even if there is no data */
            if (httpResponseData->inStream) {

                /* Todo: can this handle timeout for non-post as well? */
                if (fin) {
                    /* If we just got the last chunk (or empty chunk), disable timeout */
                    us_socket_timeout((struct us_socket_t *) user, 0);
                } else {
                    /* We still have some more data coming in later, so reset timeout */
                    /* Only reset timeout if we got enough bytes (16kb/sec) since last time we reset here */
                    httpResponseData->received_bytes_per_timeout += (unsigned int) data.length();
                    if (httpResponseData->received_bytes_per_timeout >= HTTP_RECEIVE_THROUGHPUT_BYTES * httpResponseData->idleTimeout) {
                        ((HttpResponse<SSL> *) user)->resetTimeout();
                        httpResponseData->received_bytes_per_timeout = 0;
                    }
                }

                /* We might respond in the handler, so do not change timeout after this */
                httpResponseData->inStream(static_cast<HttpResponse<SSL>*>(user), data.data(), data.length(), fin, httpResponseData->userData);

                /* Was the socket closed? */
                if (us_socket_is_closed((struct us_socket_t *) user)) {
                    return nullptr;
                }

                /* We absolutely have to terminate parsing if shutdown */
                if (us_socket_is_shut_down((us_socket_t *) user)) {
                    return nullptr;
                }

                /* If we were given the last data chunk, reset data handler to ensure following
                 * requests on the same socket won't trigger any previously registered behavior */
                if (fin) {
                    httpResponseData->inStream = nullptr;
                }
            }
            return user;
        });

        auto httpErrorStatusCode = result.httpErrorStatusCode();

        /* Mark that we are no longer parsing Http */
        httpContextData->flags.isParsingHttp = false;
        /* If we got fullptr that means the parser wants us to close the socket from error (same as calling the errorHandler) */
        if (httpErrorStatusCode) {
            /* node:http compat: parse errors surface as the server's 'clientError'
             * event and the JS layer (the user's listener or the default handler)
             * decides whether to write an error response and when to tear the
             * connection down, exactly like Node. The native layer only stops
             * parsing further requests on this connection. */
            if (IsNodeHttp && httpContextData->onClientError) {
                httpResponseData->state |= HttpResponseData<SSL>::HTTP_NODE_PARSING_STOPPED;
                httpContextData->onClientError(SSL, s, result.parserError, data, length);
                if (!us_socket_is_closed(s)) {
                    /* Balance the parsing ref taken at the top of onData (the
                     * success path does this through returnedData). */
                    us_socket_unref(s);
                }
                /* Flush anything the 'clientError' handler wrote (uncorking a
                 * closed socket is a no-op). */
                ((AsyncSocket<SSL> *) s)->uncork();
                return s;
            }
            if(httpContextData->onClientError) {
                httpContextData->onClientError(SSL, s, result.parserError, data, length);
            }
            /* For errors, we only deliver them "at most once". We don't care if they get halfways delivered or not. */
            us_socket_write(s, httpErrorResponses[httpErrorStatusCode].data(), (int) httpErrorResponses[httpErrorStatusCode].length());
            us_socket_shutdown(s);
            /* Close any socket on HTTP errors */
            us_socket_close(s, 0, nullptr);
        }

        auto returnedData = result.returnedData;
        /* We need to uncork in all cases, except for nullptr (closed socket, or upgraded socket) */
        if (returnedData != nullptr) {
            /* We don't want open sockets to keep the event loop alive between HTTP requests */
            us_socket_unref((us_socket_t *) returnedData);

            /* node:http compat: a partial request head was left in the fallback
             * buffer by this read (either fresh bytes on an idle connection or a
             * pipelined request after the previous message completed) - its
             * headers timeout window opens now. */
            if constexpr (IsNodeHttp) {
                auto *nodeHttpResponseData = (HttpResponseData<SSL, true> *) httpResponseData;
                if (trackNodeHttpTimings && nodeHttpResponseData->lastMessageStartMs == 0
                    && httpResponseData->hasBufferedPartialRequestHeaders()) {
                    nodeHttpResponseData->lastMessageStartMs = nodeCompatMonotonicMs();
                    nodeHttpResponseData->headersCompleted = false;
                }
            }

            /* Timeout on uncork failure */
            auto [written, failed] = ((AsyncSocket<SSL> *) returnedData)->uncork();
            if (written > 0 || failed) {
                /* All Http sockets timeout by this, and this behavior match the one in HttpResponse::cork */
                ((HttpResponse<SSL> *) s)->resetTimeout();
            }

            /* We need to check if we should close this socket here now */
            if (httpResponseData->shouldCloseConnection()) {
                if ((httpResponseData->state & HttpResponseData<SSL>::HTTP_RESPONSE_PENDING) == 0) {
                    if (((AsyncSocket<SSL> *) s)->getBufferedAmount() == 0) {
                        ((AsyncSocket<SSL> *) s)->shutdown();
                        /* We need to force close after sending FIN since we want to hinder
                         * clients from keeping to send their huge data */
                        ((AsyncSocket<SSL> *) s)->close();
                    }
                }
            }
            return (us_socket_t *) returnedData;
        }

        /* If we upgraded, check here (differ between nullptr close and nullptr upgrade) */
        if (httpContextData->upgradedWebSocket) {
            /* This path is only for upgraded websockets */
            AsyncSocket<SSL> *asyncSocket = (AsyncSocket<SSL> *) httpContextData->upgradedWebSocket;

            /* Uncork here as well (note: what if we failed to uncork and we then pub/sub before we even upgraded?) */
            auto [written, failed] = asyncSocket->uncork();

            /* If we succeeded in uncorking, check if we have sent WebSocket FIN */
            if (!failed) {
                WebSocketData *webSocketData = (WebSocketData *) asyncSocket->getAsyncSocketData();
                if (webSocketData->isShuttingDown) {
                    /* In that case, also send TCP FIN (this is similar to what we have in ws drain handler) */
                    asyncSocket->shutdown();
                }
            }

            /* Reset upgradedWebSocket before we return */
            httpContextData->upgradedWebSocket = nullptr;

            /* Return the new upgraded websocket */
            return (us_socket_t *) asyncSocket;
        }

        /* It is okay to uncork a closed socket and we need to */
        ((AsyncSocket<SSL> *) s)->uncork();

        /* We cannot return nullptr to the underlying stack in any case */
        return s;
    }

    template <bool IsNodeHttp>
    static us_socket_t *onWritable(us_socket_t *s) {
        auto *asyncSocket = reinterpret_cast<AsyncSocket<SSL> *>(s);
        auto *httpResponseData = reinterpret_cast<HttpResponseData<SSL> *>(asyncSocket->getAsyncSocketData());

        /* Attempt to drain the socket buffer before triggering onWritable callback */
        size_t bufferedAmount = asyncSocket->getBufferedAmount();
        if (bufferedAmount > 0) {
            /* Try to flush pending data from the socket's buffer to the network */
            size_t flushed = asyncSocket->flush();
            /* Check if there's still data waiting to be sent after flush attempt */
            if (asyncSocket->getBufferedAmount() > 0) {
                if constexpr (IsNodeHttp) {
                    /* onEnd deferred close for these bytes; a writable event that
                     * moves nothing (EPIPE) means the peer is gone and this would
                     * otherwise spin onWritable/onEnd until idle timeout. */
                    if (flushed == 0
                        && (httpResponseData->state & HttpResponseData<SSL>::HTTP_NODE_RECEIVED_FIN)) {
                        return asyncSocket->close();
                    }
                }
                /* Socket buffer is not completely empty yet
                * - Reset the timeout to prevent premature connection closure
                * - This allows time for another writable event or new request
                * - Return the socket to indicate we're still processing
                */
                reinterpret_cast<HttpResponse<SSL> *>(s)->resetTimeout();
                return s;
            }
            /* If bufferedAmount is now 0, we've successfully flushed everything
            * and will fall through to the next section of code
            */
        }

        auto *httpContextData = getSocketContextDataS(s);


        if (httpResponseData->isConnectRequest && httpResponseData->socketData && httpContextData->onSocketDrain) {
            httpContextData->onSocketDrain(httpResponseData->socketData, SSL, (struct us_socket_t *) s);
        }
        /* Ask the developer to write data and return success (true) or failure (false), OR skip sending anything and return success (true). */
        if (httpResponseData->onWritable) {
            /* We are now writable, so hang timeout again, the user does not have to do anything so we should hang until end or tryEnd rearms timeout */
            us_socket_timeout(s, 0);

            /* We expect the developer to return whether or not write was successful (true).
             * If write was never called, the developer should still return true so that we may drain. */
            bool success = httpResponseData->callOnWritable(reinterpret_cast<HttpResponse<SSL> *>(asyncSocket), httpResponseData->offset);

            /* The developer indicated that their onWritable failed. */
            if (!success) {
                /* Skip testing if we can drain anything since that might perform an extra syscall */
                return s;
            }

            /* We need to drain any remaining buffered data if success == true*/
        }

        /* Drain any socket buffer, this might empty our backpressure and thus finish the request */
        asyncSocket->flush();

        /* node:http compat: reads were paused while pipelined responses were
         * queued and stayed paused because the socket still had outgoing
         * backpressure when the queue drained; now that it has flushed, read
         * new requests again. */
        if constexpr (IsNodeHttp) {
            if ((httpResponseData->state & HttpResponseData<SSL>::HTTP_NODE_READS_PAUSED) && httpResponseData->nodeHttpQueuedPipelinedCount == 0
                && asyncSocket->getBufferedAmount() == 0) {
                httpResponseData->state &= ~HttpResponseData<SSL>::HTTP_NODE_READS_PAUSED;
                reinterpret_cast<HttpResponse<SSL> *>(s)->resume();
            }
        }

        /* Should we close this connection after a response - and is this response really done? */
        if (httpResponseData->shouldCloseConnection()) {
            bool responseDone = (httpResponseData->state & HttpResponseData<SSL>::HTTP_RESPONSE_PENDING) == 0;
            if constexpr (IsNodeHttp) {
                /* Node's socketOnEnd (!httpAllowHalfOpen) issues socket.end():
                 * once already-queued bytes have drained the connection shuts
                 * down regardless of whether res.end() was ever called. A
                 * re-armed onWritable (a 'drain' listener wrote again) means a
                 * fresh pinned write that bufferedAmount does not count. */
                if ((httpResponseData->state & HttpResponseData<SSL>::HTTP_NODE_RECEIVED_FIN)
                    && !httpContextData->flags.httpAllowHalfOpen
                    && httpResponseData->onWritable == nullptr) {
                    responseDone = true;
                }
            }
            if (responseDone && asyncSocket->getBufferedAmount() == 0) {
                asyncSocket->shutdown();
                /* We need to force close after sending FIN since we want to hinder
                 * clients from keeping to send their huge data */
                asyncSocket->close();
            }
        }

        /* Expect another writable event, or another request within the timeout */
        reinterpret_cast<HttpResponse<SSL> *>(s)->resetTimeout();

        return s;
    }

    template <bool IsNodeHttp>
    static us_socket_t *onEnd(us_socket_t *s) {
        auto *asyncSocket = reinterpret_cast<AsyncSocket<SSL> *>(s);

        /* node:http compat: an EOF in the middle of a request head is a parse error.
         * Node calls parser.finish() when the socket ends and surfaces it as
         * HPE_INVALID_EOF_STATE through 'clientError'; the JS layer decides what
         * (if anything) to write and when to destroy the connection. */
        if constexpr (IsNodeHttp) {
            HttpContextData<SSL> *httpContextData = getSocketContextDataS(s);
            HttpResponseData<SSL> *httpResponseData = (HttpResponseData<SSL> *) us_socket_ext(s);

            /* CONNECT/Upgrade tunnels allow half-open: the peer finishing its
             * writable side ends the JS socket's readable side ('end' event) but
             * the server can keep writing until it ends the socket itself, like
             * Node's http server (allowHalfOpen: true). This includes an accepted
             * Upgrade whose body never completed (HTTP_NODE_TUNNEL_AFTER_BODY): the
             * EOF ends the upgrade socket, exactly like Node's UpgradeStream. */
            if (httpResponseData->isConnectRequest || (httpResponseData->state & HttpResponseData<SSL>::HTTP_NODE_TUNNEL_AFTER_BODY)) {
                if (httpResponseData->socketData && httpContextData->onSocketData) {
                    httpContextData->onSocketData(httpResponseData->socketData, SSL, s, "", 0, true);
                }
                return s;
            }

            if (httpContextData->onClientError && !(httpResponseData->state & HttpResponseData<SSL>::HTTP_NODE_PARSING_STOPPED)
                && (httpResponseData->hasBufferedPartialRequestHeaders()
                    || httpResponseData->hasIncompleteRequestBody())) {
                httpResponseData->state |= HttpResponseData<SSL>::HTTP_NODE_PARSING_STOPPED;
                httpContextData->onClientError(SSL, s, HTTP_PARSER_ERROR_INVALID_EOF, nullptr, 0);
                if (us_socket_is_closed(s)) {
                    return s;
                }
            }

            /* Node's socketOnEnd: with httpAllowHalfOpen, in-flight and queued
             * responses keep writing (Node marks the last one `_last` so
             * resOnFinish destroySoon()s after it). Without it, Node does
             * `socket.end()`, which drains bytes already handed to the socket
             * before FIN. Either way, response bytes already queued
             * (AsyncSocketData::buffer, or a pinned write an onWritable
             * callback is still draining) must not be discarded by the close()
             * below; the connection shuts down from the shouldCloseConnection()
             * gates once they have flushed. */
            bool hasQueuedOutgoing = asyncSocket->getBufferedAmount() > 0
                || httpResponseData->onWritable != nullptr;
            bool responseInFlight = httpResponseData->nodeHttpQueuedPipelinedCount > 0
                || (httpResponseData->state & HttpResponseData<SSL>::HTTP_RESPONSE_PENDING);
            if (hasQueuedOutgoing || (httpContextData->flags.httpAllowHalfOpen && responseInFlight)) {
                httpResponseData->state |= HttpResponseData<SSL>::HTTP_NODE_RECEIVED_FIN;
                return s;
            }
        }

        asyncSocket->uncorkWithoutSending();

        /* We do not care for half closed sockets */
        return asyncSocket->close();
    }

    static us_socket_t *onTimeout(us_socket_t *s) {
        /* Force close rather than gracefully shutdown and risk confusing the client with a complete download */
        AsyncSocket<SSL> *asyncSocket = reinterpret_cast<AsyncSocket<SSL> *>(s);
        // Node.js by default closes the connection but they emit the timeout event before that
        HttpResponseData<SSL> *httpResponseData = reinterpret_cast<HttpResponseData<SSL> *>(asyncSocket->getAsyncSocketData());

        if (httpResponseData->onTimeout) {
            httpResponseData->onTimeout((HttpResponse<SSL> *)s, httpResponseData->userData);
        }
        return asyncSocket->close();
    }

    /* Static .rodata vtables — one per (SSL, IsNodeHttp), shared by every
     * HttpContext. The IsNodeHttp=true set is swapped in by enableNodeHttpCompat()
     * before listen(), so a Bun.serve context's handler instantiations contain
     * no node:http code at all. */
    template <bool IsNodeHttp>
    static inline const us_socket_vtable_t httpVTable = {
        /* on_open */         &onOpen<IsNodeHttp>,
        /* on_data */         &onData<IsNodeHttp>,
        /* on_fd */           nullptr,
        /* on_writable */     &onWritable<IsNodeHttp>,
        /* on_close */        &onClose<IsNodeHttp>,
        /* on_timeout */      &onTimeout,
        /* on_long_timeout */ nullptr,
        /* on_end */          &onEnd<IsNodeHttp>,
        /* on_connect_error */nullptr,
        /* on_connecting_error */ nullptr,
        /* on_handshake */    SSL ? &onHandshake : nullptr,
    };

public:
    /* Construct a new HttpContext using specified loop. SSL_CTX is built and
     * owned by TemplatedApp; we only learn about it at listen() time. */
    static HttpContext *create(Loop *loop, bool requestCert = false, bool rejectUnauthorized = false) {
        HttpContext *httpContext = new HttpContext;
        us_socket_group_init(&httpContext->group, (us_loop_t *) loop, &httpVTable<false>, httpContext);
        if (requestCert && rejectUnauthorized) {
            httpContext->data.flags.rejectUnauthorized = true;
        }
        return httpContext;
    }

    /* Destruct the HttpContext, it does not follow RAII */
    void free() {
        us_socket_group_deinit(&group);
        delete this;
    }

    void filter(MoveOnlyFunction<void(HttpResponse<SSL> *, int)> &&filterHandler) {
        getSocketContextData()->filterHandlers.emplace_back(std::move(filterHandler));
    }

    /* Register an HTTP route handler acording to URL pattern */
    void onHttp(std::string_view method, std::string_view pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler, bool upgrade = false) {
        HttpContextData<SSL> *httpContextData = getSocketContextData();

        std::span<const std::string_view> methods;
        std::string method_buffer;
        std::string_view method_sv_buffer;
        // When it's NOT node:http, allow the uWS default precedence ordering.
        if (method == "*" && !httpContextData->flags.useStrictMethodValidation) {
            methods = detail::supportedHttpMethods;
        } else {
            method_buffer = std::string(method);
            method_sv_buffer = std::string_view(method_buffer);
            methods = {&method_sv_buffer, 1};
        }

        uint32_t priority = method == "*" ? httpContextData->currentRouter->LOW_PRIORITY : (upgrade ? httpContextData->currentRouter->HIGH_PRIORITY : httpContextData->currentRouter->MEDIUM_PRIORITY);

        /* If we are passed nullptr then remove this */
        if (!handler) {
            for (const auto &method : methods) {
                httpContextData->currentRouter->remove(method, pattern, priority);
            }
            return;
        }

        /* Record this route's parameter offsets */
        std::map<std::string, unsigned short, std::less<>> parameterOffsets;
        unsigned short offset = 0;
        for (unsigned int i = 0; i < pattern.length(); i++) {
            if (pattern[i] == ':') {
                i++;
                unsigned int start = i;
                while (i < pattern.length() && pattern[i] != '/') {
                    i++;
                }
                parameterOffsets[std::string(pattern.data() + start, i - start)] = offset;
                offset++;
            }
        }



        httpContextData->currentRouter->add(methods, pattern, [handler = std::move(handler), parameterOffsets = std::move(parameterOffsets), httpContextData](auto *r) mutable {
            auto user = r->getUserData();
            user.httpRequest->setYield(false);
            user.httpRequest->setParameters(r->getParameters());
            user.httpRequest->setParameterOffsets(&parameterOffsets);

            if (!httpContextData->flags.usingCustomExpectHandler) {
                /* Middleware? Automatically respond to expectations */
                std::string_view expect = user.httpRequest->getHeader("expect");
                if (expect.length() && expect == "100-continue") {
                    user.httpResponse->writeContinue();
                }
            }

            handler(user.httpResponse, user.httpRequest);

            /* If any handler yielded, the router will keep looking for a suitable handler. */
            if (user.httpRequest->getYield()) {
                return false;
            }
            return true;
        }, priority);
    }

    /* Whether this context runs the node:http compat instantiation. The installed
     * vtable is the mode: enableNodeHttpCompat() swaps in the IsNodeHttp=true handler
     * set, so the choice of template instantiation is the single source of truth
     * and there is no separate flag to keep in sync with it. The few paths that
     * are not templated on IsNodeHttp (socketExtSize, HttpResponse::upgrade - the
     * type the C API casts to from a runtime `int ssl`) read it back from here. */
    bool isNodeHttp() const {
        return group.vtable == &httpVTable<true>;
    }

    /* The per-socket ext block this context's connections need: node:http
     * compat contexts (enableNodeHttpCompat, called before listen) carry the
     * bigger HttpResponseData<SSL, true>; onOpen<IsNodeHttp> constructs the
     * same type. */
    unsigned int socketExtSize() {
        return (unsigned int) (isNodeHttp() ? sizeof(HttpResponseData<SSL, true>) : sizeof(HttpResponseData<SSL>));
    }

    /* Switch this context (and every socket it accepts from now on) into node:http
     * compat mode by installing the IsNodeHttp=true handler instantiations; listen()
     * sizes the ext block from the vtable that is in place. Called before listen(),
     * so no socket exists yet. There is no way back: a context whose sockets were
     * sized and constructed for one instantiation cannot be handed to the other. */
    void enableNodeHttpCompat() {
        /* Idempotent: a reload of an existing node:http server (server.reload(),
         * `bun --hot`) re-runs set_routes and lands here again on a context that is
         * already listening - same layout, same vtable, nothing to do. The no-socket
         * precondition below only applies to a real switch. */
        if (isNodeHttp()) {
            return;
        }
        /* Swapping the group vtable retargets dispatch for every socket in the
         * group, and the ext block of an already-accepted socket was sized and
         * constructed by the other instantiation. */
        ASSERT(group.head_sockets == nullptr && group.head_listen_sockets == nullptr);
        group.vtable = &httpVTable<true>;
    }

    /* Listen to port using this HttpContext. ssl_ctx may be nullptr for plain HTTP. */
    us_listen_socket_t *listen(struct ssl_ctx_st *sslCtx, const char *host, int port, int options) {
        int error = 0;
        /* HTTP clients always send first (the request, or ClientHello for TLS), so defer
         * accept() until data arrives and dispatch the read immediately after accept. */
        auto socket = us_socket_group_listen(&group, socketKind(), sslCtx, host, port, options | LIBUS_LISTEN_DEFER_ACCEPT, socketExtSize(), &error);
        // we dont depend on libuv ref for keeping it alive
        if (socket) {
          us_socket_unref(&socket->s);
        }
        return socket;
    }

    /* Listen to unix domain socket using this HttpContext */
    us_listen_socket_t *listen_unix(struct ssl_ctx_st *sslCtx, const char *path, size_t pathlen, int options) {
        int error = 0;
        auto* socket = us_socket_group_listen_unix(&group, socketKind(), sslCtx, path, pathlen, options, socketExtSize(), &error);
        // we dont depend on libuv ref for keeping it alive
        if (socket) {
            us_socket_unref(&socket->s);
        }

        return socket;
    }
};

}
