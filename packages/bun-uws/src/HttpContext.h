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

#ifndef UWS_HTTPCONTEXT_H
#define UWS_HTTPCONTEXT_H

/* This class defines the main behavior of HTTP and emits various events */

#include "Loop.h"
#include "HttpContextData.h"
#include "HttpResponseData.h"
#include "AsyncSocket.h"
#include "WebSocketData.h"

#include <string_view>
#include <iostream>
#include "MoveOnlyFunction.h"

namespace uWS {
template<bool> struct HttpResponse;

template <bool SSL>
struct HttpContext {
    template<bool> friend struct TemplatedApp;
    template<bool> friend struct HttpResponse;
private:
    HttpContext() = delete;

    /* Maximum delay allowed until an HTTP connection is terminated due to outstanding request or rejected data (slow loris protection) */
    static const int HTTP_IDLE_TIMEOUT_S = 10;

    /* Minimum allowed receive throughput per second (clients uploading less than 16kB/sec get dropped) */
    static const int HTTP_RECEIVE_THROUGHPUT_BYTES = 16 * 1024;

    us_socket_context_t *getSocketContext() {
        return (us_socket_context_t *) this;
    }

    static us_socket_context_t *getSocketContext(us_socket_t *s) {
        return (us_socket_context_t *) us_socket_context(SSL, s);
    }

    HttpContextData<SSL> *getSocketContextData() {
        return (HttpContextData<SSL> *) us_socket_context_ext(SSL, getSocketContext());
    }

    static HttpContextData<SSL> *getSocketContextDataS(us_socket_t *s) {
        return (HttpContextData<SSL> *) us_socket_context_ext(SSL, getSocketContext(s));
    }

    /* Init the HttpContext by registering libusockets event handlers */
    HttpContext<SSL> *init() {
        
        if(SSL) {
            // if we are SSL we need to handle the handshake properly
            us_socket_context_on_handshake(SSL, getSocketContext(), [](us_socket_t *s, int success,  struct us_bun_verify_error_t verify_error, void* custom_data) {
                // if we are closing or already closed, we don't need to do anything
                if (!us_socket_is_closed(SSL, s) && !us_socket_is_shut_down(SSL, s)) {        
                    HttpContextData<SSL> *httpContextData = getSocketContextDataS(s);
                    
                    if(httpContextData->rejectUnauthorized) {
                        if(!success || verify_error.error != 0) {
                            // we failed to handshake, close the socket
                            us_socket_close(SSL, s, 0, nullptr);
                            return;
                        }
                    }

                    /* Any connected socket should timeout until it has a request */
                    us_socket_timeout(SSL, s, HTTP_IDLE_TIMEOUT_S);

                    /* Call filter */
                    for (auto &f : httpContextData->filterHandlers) {
                        f((HttpResponse<SSL> *) s, 1);
                    }
                }
            }, nullptr);
        }
            
        /* Handle socket connections */
        us_socket_context_on_open(SSL, getSocketContext(), [](us_socket_t *s, int /*is_client*/, char */*ip*/, int /*ip_length*/) {
            /* Any connected socket should timeout until it has a request */
            us_socket_timeout(SSL, s, HTTP_IDLE_TIMEOUT_S);

            /* Init socket ext */
            new (us_socket_ext(SSL, s)) HttpResponseData<SSL>;

            if(!SSL) {
                /* Call filter */
                HttpContextData<SSL> *httpContextData = getSocketContextDataS(s);
                for (auto &f : httpContextData->filterHandlers) {
                    f((HttpResponse<SSL> *) s, 1);
                }
            }

            return s;
        });

        /* Handle socket disconnections */
        us_socket_context_on_close(SSL, getSocketContext(), [](us_socket_t *s, int /*code*/, void */*reason*/) {
            /* Get socket ext */
            HttpResponseData<SSL> *httpResponseData = (HttpResponseData<SSL> *) us_socket_ext(SSL, s);

            /* Call filter */
            HttpContextData<SSL> *httpContextData = getSocketContextDataS(s);
            for (auto &f : httpContextData->filterHandlers) {
                f((HttpResponse<SSL> *) s, -1);
            }

            /* Signal broken HTTP request only if we have a pending request */
            if (httpResponseData->onAborted) {
                httpResponseData->onAborted();
            }

            /* Destruct socket ext */
            httpResponseData->~HttpResponseData<SSL>();

            return s;
        });

        /* Handle HTTP data streams */
        us_socket_context_on_data(SSL, getSocketContext(), [](us_socket_t *s, char *data, int length) {
            // ref the socket to make sure we process it entirely before it is closed
            us_socket_ref(s);

            // total overhead is about 210k down to 180k
            // ~210k req/sec is the original perf with write in data
            // ~200k req/sec is with cork and formatting
            // ~190k req/sec is with http parsing
            // ~180k - 190k req/sec is with varying routing

            HttpContextData<SSL> *httpContextData = getSocketContextDataS(s);

            /* Do not accept any data while in shutdown state */
            if (us_socket_is_shut_down(SSL, (us_socket_t *) s)) {
                return s;
            }

            HttpResponseData<SSL> *httpResponseData = (HttpResponseData<SSL> *) us_socket_ext(SSL, s);

            /* Cork this socket */
            ((AsyncSocket<SSL> *) s)->cork();

            /* Mark that we are inside the parser now */
            httpContextData->isParsingHttp = true;

            // clients need to know the cursor after http parse, not servers!
            // how far did we read then? we need to know to continue with websocket parsing data? or?

            void *proxyParser = nullptr;
#ifdef UWS_WITH_PROXY
            proxyParser = &httpResponseData->proxyParser;
#endif

            /* The return value is entirely up to us to interpret. The HttpParser only care for whether the returned value is DIFFERENT or not from passed user */
            void *returnedSocket = httpResponseData->consumePostPadded(data, (unsigned int) length, s, proxyParser, [httpContextData](void *s, HttpRequest *httpRequest) -> void * {
                /* For every request we reset the timeout and hang until user makes action */
                /* Warning: if we are in shutdown state, resetting the timer is a security issue! */
                us_socket_timeout(SSL, (us_socket_t *) s, 0);

                /* Reset httpResponse */
                HttpResponseData<SSL> *httpResponseData = (HttpResponseData<SSL> *) us_socket_ext(SSL, (us_socket_t *) s);
                httpResponseData->offset = 0;

                /* Are we not ready for another request yet? Terminate the connection. */
                if (httpResponseData->state & HttpResponseData<SSL>::HTTP_RESPONSE_PENDING) {
                    us_socket_close(SSL, (us_socket_t *) s, 0, nullptr);
                    return nullptr;
                }

                /* Mark pending request and emit it */
                httpResponseData->state = HttpResponseData<SSL>::HTTP_RESPONSE_PENDING;

                /* Mark this response as connectionClose if ancient or connection: close */
                if (httpRequest->isAncient() || httpRequest->getHeader("connection").length() == 5) {
                    httpResponseData->state |= HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE;
                }

                /* Select the router based on SNI (only possible for SSL) */
                auto *selectedRouter = &httpContextData->router;
                if constexpr (SSL) {
                    void *domainRouter = us_socket_server_name_userdata(SSL, (struct us_socket_t *) s);
                    if (domainRouter) {
                        selectedRouter = (decltype(selectedRouter)) domainRouter;
                    }
                }

                /* Route the method and URL */
                selectedRouter->getUserData() = {(HttpResponse<SSL> *) s, httpRequest};
                if (!selectedRouter->route(httpRequest->getCaseSensitiveMethod(), httpRequest->getUrl())) {
                    /* We have to force close this socket as we have no handler for it */
                    us_socket_close(SSL, (us_socket_t *) s, 0, nullptr);
                    return nullptr;
                }

                /* First of all we need to check if this socket was deleted due to upgrade */
                if (httpContextData->upgradedWebSocket) {
                    /* We differ between closed and upgraded below */
                    return nullptr;
                }

                /* Was the socket closed? */
                if (us_socket_is_closed(SSL, (struct us_socket_t *) s)) {
                    return nullptr;
                }

                /* We absolutely have to terminate parsing if shutdown */
                if (us_socket_is_shut_down(SSL, (us_socket_t *) s)) {
                    return nullptr;
                }

                /* Returning from a request handler without responding or attaching an onAborted handler is ill-use */
                if (!((HttpResponse<SSL> *) s)->hasResponded() && !httpResponseData->onAborted) {
                    /* Throw exception here? */
                    std::cerr << "Error: Returning from a request handler without responding or attaching an abort handler is forbidden!" << std::endl;
                    std::terminate();
                }

                /* If we have not responded and we have a data handler, we need to timeout to enfore client sending the data */
                if (!((HttpResponse<SSL> *) s)->hasResponded() && httpResponseData->inStream) {
                    us_socket_timeout(SSL, (us_socket_t *) s, HTTP_IDLE_TIMEOUT_S);
                }

                /* Continue parsing */
                return s;

            }, [httpResponseData](void *user, std::string_view data, bool fin) -> void * {
                /* We always get an empty chunk even if there is no data */
                if (httpResponseData->inStream) {

                    /* Todo: can this handle timeout for non-post as well? */
                    if (fin) {
                        /* If we just got the last chunk (or empty chunk), disable timeout */
                        us_socket_timeout(SSL, (struct us_socket_t *) user, 0);
                    } else {
                        /* We still have some more data coming in later, so reset timeout */
                        /* Only reset timeout if we got enough bytes (16kb/sec) since last time we reset here */
                        httpResponseData->received_bytes_per_timeout += (unsigned int) data.length();
                        if (httpResponseData->received_bytes_per_timeout >= HTTP_RECEIVE_THROUGHPUT_BYTES * HTTP_IDLE_TIMEOUT_S) {
                            us_socket_timeout(SSL, (struct us_socket_t *) user, HTTP_IDLE_TIMEOUT_S);
                            httpResponseData->received_bytes_per_timeout = 0;
                        }
                    }

                    /* We might respond in the handler, so do not change timeout after this */
                    httpResponseData->inStream(data, fin);

                    /* Was the socket closed? */
                    if (us_socket_is_closed(SSL, (struct us_socket_t *) user)) {
                        return nullptr;
                    }

                    /* We absolutely have to terminate parsing if shutdown */
                    if (us_socket_is_shut_down(SSL, (us_socket_t *) user)) {
                        return nullptr;
                    }

                    /* If we were given the last data chunk, reset data handler to ensure following
                     * requests on the same socket won't trigger any previously registered behavior */
                    if (fin) {
                        httpResponseData->inStream = nullptr;
                    }
                }
                return user;
            }, [](void *user) {
                 /* Close any socket on HTTP errors */
                us_socket_close(SSL, (us_socket_t *) user, 0, nullptr);
                return nullptr;
            });

            /* Mark that we are no longer parsing Http */
            httpContextData->isParsingHttp = false;

            /* If we got fullptr that means the parser wants us to close the socket from error (same as calling the errorHandler) */
            if (returnedSocket == FULLPTR) {
                /* Close any socket on HTTP errors */
                us_socket_close(SSL, s, 0, nullptr);
                /* This just makes the following code act as if the socket was closed from error inside the parser. */
                returnedSocket = nullptr;
            }

            /* We need to uncork in all cases, except for nullptr (closed socket, or upgraded socket) */
            if (returnedSocket != nullptr) {
                us_socket_t* returnedSocketPtr = (us_socket_t*) returnedSocket; 
                /* We don't want open sockets to keep the event loop alive between HTTP requests */
                us_socket_unref(returnedSocketPtr);

                /* Timeout on uncork failure */
                auto [written, failed] = ((AsyncSocket<SSL> *) returnedSocket)->uncork();
                if (failed) {
                    /* All Http sockets timeout by this, and this behavior match the one in HttpResponse::cork */
                    /* Warning: both HTTP_IDLE_TIMEOUT_S and HTTP_TIMEOUT_S are 10 seconds and both are used the same */
                    ((AsyncSocket<SSL> *) s)->timeout(HTTP_IDLE_TIMEOUT_S);
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
                return returnedSocketPtr;
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
        });

        /* Handle HTTP write out (note: SSL_read may trigger this spuriously, the app need to handle spurious calls) */
        us_socket_context_on_writable(SSL, getSocketContext(), [](us_socket_t *s) {

            AsyncSocket<SSL> *asyncSocket = (AsyncSocket<SSL> *) s;
            HttpResponseData<SSL> *httpResponseData = (HttpResponseData<SSL> *) asyncSocket->getAsyncSocketData();

            /* Ask the developer to write data and return success (true) or failure (false), OR skip sending anything and return success (true). */
            if (httpResponseData->onWritable) {
                /* We are now writable, so hang timeout again, the user does not have to do anything so we should hang until end or tryEnd rearms timeout */
                us_socket_timeout(SSL, s, 0);

                /* We expect the developer to return whether or not write was successful (true).
                 * If write was never called, the developer should still return true so that we may drain. */
                bool success = httpResponseData->callOnWritable(httpResponseData->offset);

                /* The developer indicated that their onWritable failed. */
                if (!success) {
                    /* Skip testing if we can drain anything since that might perform an extra syscall */
                    return s;
                }

                /* We need to drain any remaining buffered data if success == true*/    
            }

            /* Drain any socket buffer, this might empty our backpressure and thus finish the request */
            /*auto [written, failed] = */asyncSocket->write(nullptr, 0, true, 0);

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
            asyncSocket->timeout(HTTP_IDLE_TIMEOUT_S);

            return s;
        });

        /* Handle FIN, HTTP does not support half-closed sockets, so simply close */
        us_socket_context_on_end(SSL, getSocketContext(), [](us_socket_t *s) {

            /* We do not care for half closed sockets */
            AsyncSocket<SSL> *asyncSocket = (AsyncSocket<SSL> *) s;
            return asyncSocket->close();

        });

        /* Handle socket timeouts, simply close them so to not confuse client with FIN */
        us_socket_context_on_timeout(SSL, getSocketContext(), [](us_socket_t *s) {

            /* Force close rather than gracefully shutdown and risk confusing the client with a complete download */
            AsyncSocket<SSL> *asyncSocket = (AsyncSocket<SSL> *) s;
            return asyncSocket->close();

        });

        return this;
    }

public:
    /* Construct a new HttpContext using specified loop */
    static HttpContext *create(Loop *loop, us_bun_socket_context_options_t options = {}) {
        HttpContext *httpContext;

        httpContext = (HttpContext *) us_create_bun_socket_context(SSL, (us_loop_t *) loop, sizeof(HttpContextData<SSL>), options);

        if (!httpContext) {
            return nullptr;
        }
        // for servers this is only valid when request cert is enabled
        
        /* Init socket context data */
        auto* httpContextData = new ((HttpContextData<SSL> *) us_socket_context_ext(SSL, (us_socket_context_t *) httpContext)) HttpContextData<SSL>();
        if(options.request_cert && options.reject_unauthorized) {
            httpContextData->rejectUnauthorized = true;
        }
        return httpContext->init();
    }

    /* Destruct the HttpContext, it does not follow RAII */
    void free() {
        /* Destruct socket context data */
        HttpContextData<SSL> *httpContextData = getSocketContextData();
        httpContextData->~HttpContextData<SSL>();

        /* Free the socket context in whole */
        us_socket_context_free(SSL, getSocketContext());
    }

    void filter(MoveOnlyFunction<void(HttpResponse<SSL> *, int)> &&filterHandler) {
        getSocketContextData()->filterHandlers.emplace_back(std::move(filterHandler));
    }

    /* Register an HTTP route handler acording to URL pattern */
    void onHttp(std::string method, std::string pattern, MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *)> &&handler, bool upgrade = false) {
        HttpContextData<SSL> *httpContextData = getSocketContextData();

        /* Todo: This is ugly, fix */
        std::vector<std::string> methods;
        if (method == "*") {
            methods = httpContextData->currentRouter->upperCasedMethods;
        } else {
            methods = {method};
        }

        uint32_t priority = method == "*" ? httpContextData->currentRouter->LOW_PRIORITY : (upgrade ? httpContextData->currentRouter->HIGH_PRIORITY : httpContextData->currentRouter->MEDIUM_PRIORITY);

        /* If we are passed nullptr then remove this */
        if (!handler) {
            httpContextData->currentRouter->remove(methods[0], pattern, priority);
            return;
        }

        httpContextData->currentRouter->add(methods, pattern, [handler = std::move(handler)](auto *r) mutable {
            auto user = r->getUserData();
            user.httpRequest->setYield(false);
            user.httpRequest->setParameters(r->getParameters());

            /* Middleware? Automatically respond to expectations */
            std::string_view expect = user.httpRequest->getHeader("expect");
            if (expect.length() && expect == "100-continue") {
                user.httpResponse->writeContinue();
            }

            handler(user.httpResponse, user.httpRequest);

            /* If any handler yielded, the router will keep looking for a suitable handler. */
            if (user.httpRequest->getYield()) {
                return false;
            }
            return true;
        }, priority);
    }

    /* Listen to port using this HttpContext */
    us_listen_socket_t *listen(const char *host, int port, int options) {
        auto socket = us_socket_context_listen(SSL, getSocketContext(), host, port, options, sizeof(HttpResponseData<SSL>));
        // we dont depend on libuv ref for keeping it alive
        if (socket) {
          us_socket_unref(&socket->s);
        } 
        return socket;
    }

    /* Listen to unix domain socket using this HttpContext */
    us_listen_socket_t *listen_unix(const char *path, size_t pathlen, int options) {
        auto* socket =  us_socket_context_listen_unix(SSL, getSocketContext(), path, pathlen, options, sizeof(HttpResponseData<SSL>));
        // we dont depend on libuv ref for keeping it alive
        if (socket) {
            us_socket_unref(&socket->s);
        }

        return socket;
    }
};

}

#endif // UWS_HTTPCONTEXT_H
