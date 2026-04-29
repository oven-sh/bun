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

    /* Maximum delay allowed until an HTTP connection is terminated due to outstanding request or rejected data (slow loris protection) */
    static constexpr int HTTP_IDLE_TIMEOUT_S = 10;

    /* Minimum allowed receive throughput per second (clients uploading less than 16kB/sec get dropped) */
    static constexpr int HTTP_RECEIVE_THROUGHPUT_BYTES = 16 * 1024;

    static constexpr unsigned char SOCKET_KIND = SSL ? US_SOCKET_KIND_UWS_HTTP_TLS : US_SOCKET_KIND_UWS_HTTP;

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
            httpResponseData->isAuthorized = success;

            /* Any connected socket should timeout until it has a request */
            ((HttpResponse<SSL> *) s)->resetTimeout();

            /* Call filter */
            for (auto &f : httpContextData->filterHandlers) {
                f((HttpResponse<SSL> *) s, 1);
            }
        }
    }

    static us_socket_t *onOpen(us_socket_t *s, int /*is_client*/, char * /*ip*/, int /*ip_length*/) {
        /* Init socket ext */
        new (us_socket_ext(s)) HttpResponseData<SSL>;
          /* Any connected socket should timeout until it has a request */
        ((HttpResponse<SSL> *) s)->resetTimeout();

        if(!SSL) {
            /* Call filter */
            HttpContextData<SSL> *httpContextData = getSocketContextDataS(s);
            for (auto &f : httpContextData->filterHandlers) {
                f((HttpResponse<SSL> *) s, 1);
            }
        }

        return s;
    }

    static us_socket_t *onClose(us_socket_t *s, int /*code*/, void * /*reason*/) {
        ((AsyncSocket<SSL> *)s)->uncorkWithoutSending();

        /* Get socket ext */
        auto *httpResponseData = reinterpret_cast<HttpResponseData<SSL> *>(us_socket_ext(s));


        /* Call filter */
        HttpContextData<SSL> *httpContextData = getSocketContextDataS(s);

        if(httpResponseData && httpResponseData->isConnectRequest) {
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


        /* Destruct socket ext */
        httpResponseData->~HttpResponseData<SSL>();

        return s;
    }

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
            return s;
        }

        HttpResponseData<SSL> *httpResponseData = (HttpResponseData<SSL> *) us_socket_ext(s);

        /* Cork this socket */
        ((AsyncSocket<SSL> *) s)->cork();

        /* Mark that we are inside the parser now */
        httpContextData->flags.isParsingHttp = true;
        httpResponseData->isIdle = false;

        // clients need to know the cursor after http parse, not servers!
        // how far did we read then? we need to know to continue with websocket parsing data? or?

        void *proxyParser = nullptr;
#ifdef UWS_WITH_PROXY
        proxyParser = &httpResponseData->proxyParser;
#endif

        /* The return value is entirely up to us to interpret. The HttpParser cares only for whether the returned value is DIFFERENT from passed user */

        auto result = httpResponseData->consumePostPadded(httpContextData->maxHeaderSize, httpResponseData->isConnectRequest, httpContextData->flags.requireHostHeader,httpContextData->flags.useStrictMethodValidation, data, (unsigned int) length, s, proxyParser, [httpContextData](void *s, HttpRequest *httpRequest) -> void * {


            /* For every request we reset the timeout and hang until user makes action */
            /* Warning: if we are in shutdown state, resetting the timer is a security issue! */
            us_socket_timeout((us_socket_t *) s, 0);

            /* Reset httpResponse */
            HttpResponseData<SSL> *httpResponseData = (HttpResponseData<SSL> *) us_socket_ext((us_socket_t *) s);
            httpResponseData->offset = 0;

            /* Are we not ready for another request yet? Terminate the connection.
             * Important for denying async pipelining until, if ever, we want to support it.
             * Otherwise requests can get mixed up on the same connection. We still support sync pipelining. */
            if (httpResponseData->state & HttpResponseData<SSL>::HTTP_RESPONSE_PENDING) {
                us_socket_close((us_socket_t *) s, 0, nullptr);
                return nullptr;
            }

            /* Mark pending request and emit it */
            httpResponseData->state = HttpResponseData<SSL>::HTTP_RESPONSE_PENDING;


            /* Mark this response as connectionClose if ancient or connection: close */
            if (httpRequest->isAncient() || httpRequest->getHeader("connection").length() == 5) {
                httpResponseData->state |= HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE;
            }

            httpResponseData->fromAncientRequest = httpRequest->isAncient();

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
            if (!selectedRouter->route(httpRequest->getCaseSensitiveMethod(), httpRequest->getUrl())) {
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


            if (httpResponseData->isConnectRequest && httpResponseData->socketData && httpContextData->onSocketData) {
                httpContextData->onSocketData(httpResponseData->socketData, SSL, (struct us_socket_t *) user, data.data(), data.length(), fin);
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

            /* Timeout on uncork failure */
            auto [written, failed] = ((AsyncSocket<SSL> *) returnedData)->uncork();
            if (written > 0 || failed) {
                /* All Http sockets timeout by this, and this behavior match the one in HttpResponse::cork */
                ((HttpResponse<SSL> *) s)->resetTimeout();
            }

            /* We need to check if we should close this socket here now */
            if (httpResponseData->state & HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE) {
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

    static us_socket_t *onWritable(us_socket_t *s) {
        auto *asyncSocket = reinterpret_cast<AsyncSocket<SSL> *>(s);
        auto *httpResponseData = reinterpret_cast<HttpResponseData<SSL> *>(asyncSocket->getAsyncSocketData());

        /* Attempt to drain the socket buffer before triggering onWritable callback */
        size_t bufferedAmount = asyncSocket->getBufferedAmount();
        if (bufferedAmount > 0) {
            /* Try to flush pending data from the socket's buffer to the network */
            asyncSocket->flush();
            /* Check if there's still data waiting to be sent after flush attempt */
            if (asyncSocket->getBufferedAmount() > 0) {
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

        /* Should we close this connection after a response - and is this response really done? */
        if (httpResponseData->state & HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE) {
            if ((httpResponseData->state & HttpResponseData<SSL>::HTTP_RESPONSE_PENDING) == 0) {
                if (asyncSocket->getBufferedAmount() == 0) {

                    asyncSocket->shutdown();
                    /* We need to force close after sending FIN since we want to hinder
                     * clients from keeping to send their huge data */
                    asyncSocket->close();
                }
            }
        }

        /* Expect another writable event, or another request within the timeout */
        reinterpret_cast<HttpResponse<SSL> *>(s)->resetTimeout();

        return s;
    }

    static us_socket_t *onEnd(us_socket_t *s) {
        auto *asyncSocket = reinterpret_cast<AsyncSocket<SSL> *>(s);
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

    /* Static .rodata vtable — one per SSL value, shared by every HttpContext. */
    static inline const us_socket_vtable_t httpVTable = {
        /* on_open */         &onOpen,
        /* on_data */         &onData,
        /* on_fd */           nullptr,
        /* on_writable */     &onWritable,
        /* on_close */        &onClose,
        /* on_timeout */      &onTimeout,
        /* on_long_timeout */ nullptr,
        /* on_end */          &onEnd,
        /* on_connect_error */nullptr,
        /* on_connecting_error */ nullptr,
        /* on_handshake */    SSL ? &onHandshake : nullptr,
        /* is_low_prio */     nullptr,
    };

public:
    /* Construct a new HttpContext using specified loop. SSL_CTX is built and
     * owned by TemplatedApp; we only learn about it at listen() time. */
    static HttpContext *create(Loop *loop, bool requestCert = false, bool rejectUnauthorized = false) {
        HttpContext *httpContext = new HttpContext;
        us_socket_group_init(&httpContext->group, (us_loop_t *) loop, &httpVTable, httpContext);
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

    /* Listen to port using this HttpContext. ssl_ctx may be nullptr for plain HTTP. */
    us_listen_socket_t *listen(struct ssl_ctx_st *sslCtx, const char *host, int port, int options) {
        int error = 0;
        /* HTTP clients always send first (the request, or ClientHello for TLS), so defer
         * accept() until data arrives and dispatch the read immediately after accept. */
        auto socket = us_socket_group_listen(&group, SOCKET_KIND, sslCtx, host, port, options | LIBUS_LISTEN_DEFER_ACCEPT, sizeof(HttpResponseData<SSL>), &error);
        // we dont depend on libuv ref for keeping it alive
        if (socket) {
          us_socket_unref(&socket->s);
        }
        return socket;
    }

    /* Listen to unix domain socket using this HttpContext */
    us_listen_socket_t *listen_unix(struct ssl_ctx_st *sslCtx, const char *path, size_t pathlen, int options) {
        int error = 0;
        auto* socket = us_socket_group_listen_unix(&group, SOCKET_KIND, sslCtx, path, pathlen, options, sizeof(HttpResponseData<SSL>), &error);
        // we dont depend on libuv ref for keeping it alive
        if (socket) {
            us_socket_unref(&socket->s);
        }

        return socket;
    }
};

}
