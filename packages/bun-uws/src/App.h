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


#include <string>
#include <charconv>
#include <string_view>

namespace uWS {
    /* Safari 15.0 - 15.3 has a completely broken compression implementation (client_no_context_takeover not
     * properly implemented) - so we fully disable compression for this browser :-(
     * see https://github.com/uNetworking/uWebSockets/issues/1347 */
    inline bool hasBrokenCompression(std::string_view userAgent) {
        size_t posStart = userAgent.find(" Version/15.");
        if (posStart == std::string_view::npos) return false;
        posStart += 12;

        size_t posEnd = userAgent.find(' ', posStart);
        if (posEnd == std::string_view::npos) return false;

        unsigned int minorVersion = 0;
        auto result = std::from_chars(userAgent.data() + posStart, userAgent.data() + posEnd, minorVersion);
        if (result.ec != std::errc()) return false;
        if (result.ptr != userAgent.data() + posEnd) return false; // do not accept trailing chars
        if (minorVersion > 3) return false; // we target just Safari 15.0 - 15.3

        if (userAgent.find(" Safari/", posEnd) == std::string_view::npos) return false;

        return true;
    }
}

/* An app is a convenience wrapper of some of the most used fuctionalities and allows a
 * builder-pattern kind of init. Apps operate on the implicit thread local Loop */

#include "HttpContext.h"
#include "HttpResponse.h"
#include "WebSocketContext.h"
#include "WebSocket.h"
#include "PerMessageDeflate.h"

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
        int reject_unauthorized = 0;
        int request_cert = 0;
        unsigned int client_renegotiation_limit = 3;
        unsigned int client_renegotiation_window = 600;

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
    /* The app always owns at least one http context, but creates websocket contexts on demand */
    HttpContext<SSL> *httpContext;
    /* WebSocketContexts are of differing type, but we as owners and creators must delete them correctly */
    std::vector<MoveOnlyFunction<void()>> webSocketContextDeleters;

    std::vector<void *> webSocketContexts;

public:

    TopicTree<TopicTreeMessage, TopicTreeBigMessage> *topicTree = nullptr;


    /* Server name */
    TemplatedApp &&addServerName(const std::string &hostname_pattern, SocketContextOptions options = {}, bool *success = nullptr) {

        /* Do nothing if not even on SSL */
        if constexpr (SSL) {
            /* First we create a new router for this domain */
            auto *domainRouter = new HttpRouter<typename HttpContextData<SSL>::RouterData>();

            int result = us_bun_socket_context_add_server_name(SSL, (struct us_socket_context_t *) httpContext, hostname_pattern.c_str(), options, domainRouter);
            if (success) {
                *success = result == 0;
            }
        }

        return std::move(*this);
    }

    TemplatedApp &&removeServerName(const std::string &hostname_pattern) {

        /* This will do for now, would be better if us_socket_context_remove_server_name returned the user data */
        auto *domainRouter = us_socket_context_find_server_name_userdata(SSL, (struct us_socket_context_t *) httpContext, hostname_pattern.c_str());
        if (domainRouter) {
            delete (HttpRouter<typename HttpContextData<SSL>::RouterData> *) domainRouter;
        }

        us_socket_context_remove_server_name(SSL, (struct us_socket_context_t *) httpContext, hostname_pattern.c_str());
        return std::move(*this);
    }

    TemplatedApp &&missingServerName(MoveOnlyFunction<void(const char *hostname)> &&handler) {

        if (!constructorFailed()) {
            httpContext->getSocketContextData()->missingServerNameHandler = std::move(handler);

            us_socket_context_on_server_name(SSL, (struct us_socket_context_t *) httpContext, [](struct us_socket_context_t *context, const char *hostname) {

                /* This is the only requirements of being friends with HttpContextData */
                HttpContext<SSL> *httpContext = (HttpContext<SSL> *) context;
                httpContext->getSocketContextData()->missingServerNameHandler(hostname);
            });
        }

        return std::move(*this);
    }

    /* Returns the SSL_CTX of this app, or nullptr. */
    void *getNativeHandle() {
        return us_socket_context_get_native_handle(SSL, (struct us_socket_context_t *) httpContext);
    }

    /* Attaches a "filter" function to track socket connections/disconnections */
    TemplatedApp &&filter(MoveOnlyFunction<void(HttpResponse<SSL> *, int)> &&filterHandler) {
        httpContext->filter(std::move(filterHandler));

        return std::move(*this);
    }

    /* Publishes a message to all websocket contexts - conceptually as if publishing to the one single
     * TopicTree of this app (technically there are many TopicTrees, however the concept is that one
     * app has one conceptual Topic tree) */
    bool publish(std::string_view topic, std::string_view message, unsigned char opCode, bool compress = false) {
        return this->publish(topic, message, (OpCode)opCode, compress);
    }

    /* Publishes a message to all websocket contexts - conceptually as if publishing to the one single
     * TopicTree of this app (technically there are many TopicTrees, however the concept is that one
     * app has one conceptual Topic tree) */
    bool publish(std::string_view topic, std::string_view message, OpCode opCode, bool compress = false) {
        /* Anything big bypasses corking efforts */
        if (message.length() >= LoopData::CORK_BUFFER_SIZE) {
            return topicTree->publishBig(nullptr, topic, {message, opCode, compress}, [](Subscriber *s, TopicTreeBigMessage &message) {
                auto *ws = (WebSocket<SSL, true, int> *) s->user;

                /* Send will drain if needed */
                ws->send(message.message, (OpCode)message.opCode, message.compress);
            });
        } else {
            return topicTree->publish(nullptr, topic, {std::string(message), opCode, compress});
        }
    }

    /* Returns number of subscribers for this topic, or 0 for failure.
     * This function should probably be optimized a lot in future releases,
     * it could be O(1) with a hash map of fullnames and their counts. */
    unsigned int numSubscribers(std::string_view topic) {
        if (!topicTree) {
            return 0;
        }

        Topic *t = topicTree->lookupTopic(topic);
        if (t) {
            return (unsigned int) t->size();
        }

        return 0;
    }

    ~TemplatedApp() {
        /* Let's just put everything here */
        if (httpContext) {
            httpContext->free();

            /* Free all our webSocketContexts in a type less way */
            for (auto &webSocketContextDeleter : webSocketContextDeleters) {
                webSocketContextDeleter();
            }
        }

        /* Delete TopicTree */
        if (topicTree) {
            /* And unregister loop callbacks */
            /* We must unregister any loop post handler here */
            Loop::get()->removePostHandler(topicTree);
            Loop::get()->removePreHandler(topicTree);
            delete topicTree;
        }
    }

    /* Disallow copying, only move */
    TemplatedApp(const TemplatedApp &other) = delete;

    TemplatedApp(TemplatedApp &&other) {
        /* Move HttpContext */
        httpContext = other.httpContext;
        other.httpContext = nullptr;

        /* Move webSocketContextDeleters */
        webSocketContextDeleters = std::move(other.webSocketContextDeleters);

        webSocketContexts = std::move(other.webSocketContexts);

        /* Move TopicTree */
        topicTree = other.topicTree;
        other.topicTree = nullptr;
    }

    TemplatedApp(SocketContextOptions options = {}) {
        httpContext = HttpContext<SSL>::create(Loop::get(), options);
    }

    TemplatedApp(HttpContext<SSL> &context) {
        httpContext = &context;
    }

    static TemplatedApp<SSL>* create(SocketContextOptions options = {}) {

        auto* httpContext = HttpContext<SSL>::create(Loop::get(), options);
        if (!httpContext) {
            return nullptr;
        }
        return new TemplatedApp<SSL>(*httpContext);
    }

    bool constructorFailed() {
        return !httpContext;
    }

    template <typename UserData>
    struct WebSocketBehavior {
        /* Disabled compression by default - probably a bad default */
        CompressOptions compression = DISABLED;
        /* Maximum message size we can receive */
        unsigned int maxPayloadLength = 16 * 1024;
        /* 2 minutes timeout is good */
        unsigned short idleTimeout = 120;
        /* 64kb backpressure is probably good */
        unsigned int maxBackpressure = 64 * 1024;
        bool closeOnBackpressureLimit = false;
        /* This one depends on kernel timeouts and is a bad default */
        bool resetIdleTimeoutOnSend = false;
        /* A good default, esp. for newcomers */
        bool sendPingsAutomatically = true;
        /* Maximum socket lifetime in minutes before forced closure (defaults to disabled) */
        unsigned short maxLifetime = 0;
        MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *, struct us_socket_context_t *)> upgrade = nullptr;
        MoveOnlyFunction<void(WebSocket<SSL, true, UserData> *)> open = nullptr;
        MoveOnlyFunction<void(WebSocket<SSL, true, UserData> *, std::string_view, OpCode)> message = nullptr;
        MoveOnlyFunction<void(WebSocket<SSL, true, UserData> *)> drain = nullptr;
        MoveOnlyFunction<void(WebSocket<SSL, true, UserData> *, std::string_view)> ping = nullptr;
        MoveOnlyFunction<void(WebSocket<SSL, true, UserData> *, std::string_view)> pong = nullptr;
        MoveOnlyFunction<void(WebSocket<SSL, true, UserData> *, std::string_view, int, int)> subscription = nullptr;
        MoveOnlyFunction<void(WebSocket<SSL, true, UserData> *, int, std::string_view)> close = nullptr;
    };

    /* Closes all sockets including listen sockets. */
    TemplatedApp &&close() {
        us_socket_context_close(SSL, (struct us_socket_context_t *) httpContext);
        for (void *webSocketContext : webSocketContexts) {
            us_socket_context_close(SSL, (struct us_socket_context_t *) webSocketContext);
        }

        return std::move(*this);
    }

    template <typename UserData>
    TemplatedApp &&ws(std::string_view pattern, WebSocketBehavior<UserData> &&behavior) {
        /* Don't compile if alignment rules cannot be satisfied */
        static_assert(alignof(UserData) <= LIBUS_EXT_ALIGNMENT,
        "µWebSockets cannot satisfy UserData alignment requirements. You need to recompile µSockets with LIBUS_EXT_ALIGNMENT adjusted accordingly.");

        if (!httpContext) {
            return std::move(*this);
        }

        /* Terminate on misleading idleTimeout values */
        if (behavior.idleTimeout && behavior.idleTimeout < 8) {
            std::cerr << "Error: idleTimeout must be either 0 or greater than 8!" << std::endl;
            std::terminate();
        }

        /* Maximum idleTimeout is 16 minutes */
        if (behavior.idleTimeout > 240 * 4) {
            std::cerr << "Error: idleTimeout must not be greater than 960 seconds!" << std::endl;
            std::terminate();
        }

        /* Maximum maxLifetime is 4 hours */
        if (behavior.maxLifetime > 240) {
            std::cerr << "Error: maxLifetime must not be greater than 240 minutes!" << std::endl;
            std::terminate();
        }

        /* If we don't have a TopicTree yet, create one now */
        if (!topicTree) {

            bool needsUncork = false;
            topicTree = new TopicTree<TopicTreeMessage, TopicTreeBigMessage>([needsUncork](Subscriber *s, TopicTreeMessage &message, TopicTree<TopicTreeMessage, TopicTreeBigMessage>::IteratorFlags flags) mutable {
                /* Subscriber's user is the socket */
                /* Unfortunately we need to cast is to PerSocketData = int
                 * since many different WebSocketContexts use the same
                 * TopicTree now */
                auto *ws = (WebSocket<SSL, true, int> *) s->user;

                /* If this is the first message we try and cork */
                if (flags & TopicTree<TopicTreeMessage, TopicTreeBigMessage>::IteratorFlags::FIRST) {
                    if (ws->canCork() && !ws->isCorked()) {
                        ((AsyncSocket<SSL> *)ws)->cork();
                        needsUncork = true;
                    }
                }

                /* If we ever overstep maxBackpresure, exit immediately */
                if (WebSocket<SSL, true, int>::SendStatus::DROPPED == ws->send(message.message, (OpCode)message.opCode, message.compress)) {
                    if (needsUncork) {
                        ((AsyncSocket<SSL> *)ws)->uncork();
                        needsUncork = false;
                    }
                    /* Stop draining */
                    return true;
                }

                /* If this is the last message we uncork if we are corked */
                if (flags & TopicTree<TopicTreeMessage, TopicTreeBigMessage>::IteratorFlags::LAST) {
                    /* We should not uncork in all cases? */
                    if (needsUncork) {
                        ((AsyncSocket<SSL> *)ws)->uncork();
                    }
                }

                /* Success */
                return false;
            });

            /* And hook it up with the loop */
            /* We empty for both pre and post just to make sure */
            Loop::get()->addPostHandler(topicTree, [topicTree = topicTree](Loop */*loop*/) {
                /* Commit pub/sub batches every loop iteration */
                topicTree->drain();
            });

            Loop::get()->addPreHandler(topicTree, [topicTree = topicTree](Loop */*loop*/) {
                /* Commit pub/sub batches every loop iteration */
                topicTree->drain();
            });
        }

        /* Every route has its own websocket context with its own behavior and user data type */
        auto *webSocketContext = WebSocketContext<SSL, true, UserData>::create(Loop::get(), (us_socket_context_t *) httpContext, topicTree);

        /* We need to clear this later on */
        webSocketContextDeleters.push_back([webSocketContext]() {
            webSocketContext->free();
        });

        /* We also keep this list for easy closing */
        webSocketContexts.push_back((void *)webSocketContext);

        /* Quick fix to disable any compression if set */
#ifdef UWS_NO_ZLIB
        behavior.compression = DISABLED;
#endif

        /* If we are the first one to use compression, initialize it */
        if (behavior.compression) {
            LoopData *loopData = (LoopData *) us_loop_ext(us_socket_context_loop(SSL, webSocketContext->getSocketContext()));

            /* Initialize loop's deflate inflate streams */
            if (!loopData->zlibContext) {
                loopData->zlibContext = new ZlibContext;
                loopData->inflationStream = new InflationStream(CompressOptions::DEDICATED_DECOMPRESSOR);
                loopData->deflationStream = new DeflationStream(CompressOptions::DEDICATED_COMPRESSOR);
            }
        }

        /* Copy all handlers */
        webSocketContext->getExt()->openHandler = std::move(behavior.open);
        webSocketContext->getExt()->messageHandler = std::move(behavior.message);
        webSocketContext->getExt()->drainHandler = std::move(behavior.drain);
        webSocketContext->getExt()->subscriptionHandler = std::move(behavior.subscription);
        webSocketContext->getExt()->closeHandler = [closeHandler = std::move(behavior.close)](WebSocket<SSL, true, UserData> *ws, int code, std::string_view message) mutable {
            if (closeHandler) {
                closeHandler(ws, code, message);
            }

            /* Destruct user data after returning from close handler */
            ((UserData *) ws->getUserData())->~UserData();
        };
        webSocketContext->getExt()->pingHandler = std::move(behavior.ping);
        webSocketContext->getExt()->pongHandler = std::move(behavior.pong);

        /* Copy settings */
        webSocketContext->getExt()->maxPayloadLength = behavior.maxPayloadLength;
        webSocketContext->getExt()->maxBackpressure = behavior.maxBackpressure;
        webSocketContext->getExt()->closeOnBackpressureLimit = behavior.closeOnBackpressureLimit;
        webSocketContext->getExt()->resetIdleTimeoutOnSend = behavior.resetIdleTimeoutOnSend;
        webSocketContext->getExt()->sendPingsAutomatically = behavior.sendPingsAutomatically;
        webSocketContext->getExt()->maxLifetime = behavior.maxLifetime;
        webSocketContext->getExt()->compression = behavior.compression;

        /* Calculate idleTimeoutComponents */
        webSocketContext->getExt()->calculateIdleTimeoutComponents(behavior.idleTimeout);

        httpContext->onHttp("GET", pattern, [webSocketContext, behavior = std::move(behavior)](auto *res, auto *req) mutable {

            /* If we have this header set, it's a websocket */
            std::string_view secWebSocketKey = req->getHeader("sec-websocket-key");
            if (secWebSocketKey.length() == 24) {

                /* Emit upgrade handler */
                if (behavior.upgrade) {

                    /* Nasty, ugly Safari 15 hack */
                    if (hasBrokenCompression(req->getHeader("user-agent"))) {
                        std::string_view secWebSocketExtensions = req->getHeader("sec-websocket-extensions");
                        memset((void *) secWebSocketExtensions.data(), ' ', secWebSocketExtensions.length());
                    }

                    behavior.upgrade(res, req, (struct us_socket_context_t *) webSocketContext);
                } else {
                    /* Default handler upgrades to WebSocket */
                    std::string_view secWebSocketProtocol = req->getHeader("sec-websocket-protocol");
                    std::string_view secWebSocketExtensions = req->getHeader("sec-websocket-extensions");

                    /* Safari 15 hack */
                    if (hasBrokenCompression(req->getHeader("user-agent"))) {
                        secWebSocketExtensions = "";
                    }

                    res->template upgrade<UserData>({}, secWebSocketKey, secWebSocketProtocol, secWebSocketExtensions, (struct us_socket_context_t *) webSocketContext);
                }

                /* We are going to get uncorked by the Http get return */

                /* We do not need to check for any close or shutdown here as we immediately return from get handler */

            } else {
                /* Tell the router that we did not handle this request */
                req->setYield(true);
            }
        }, true);
        return std::move(*this);
    }

    /* Browse to a server name, changing the router to this domain */
    TemplatedApp &&domain(const std::string &serverName) {
        HttpContextData<SSL> *httpContextData = httpContext->getSocketContextData();

        void *domainRouter = us_socket_context_find_server_name_userdata(SSL, (struct us_socket_context_t *) httpContext, serverName.c_str());
        if (domainRouter) {
            httpContextData->currentRouter = (decltype(httpContextData->currentRouter)) domainRouter;
        } else {
            httpContextData->currentRouter = &httpContextData->router;
        }

        return std::move(*this);
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

    /* Host, port, callback */
    TemplatedApp &&listen(const std::string &host, int port, MoveOnlyFunction<void(us_listen_socket_t *)> &&handler) {
        if (host.empty()) {
            return listen(port, std::move(handler));
        }
        handler(httpContext ? httpContext->listen(host.c_str(), port, 0) : nullptr);
        return std::move(*this);
    }

    /* Host, port, options, callback */
    TemplatedApp &&listen(const std::string &host, int port, int options, MoveOnlyFunction<void(us_listen_socket_t *)> &&handler) {
        if (host.empty()) {
            return listen(port, options, std::move(handler));
        }
        handler(httpContext ? httpContext->listen(host.c_str(), port, options) : nullptr);
        return std::move(*this);
    }

    /* Port, callback */
    TemplatedApp &&listen(int port, MoveOnlyFunction<void(us_listen_socket_t *)> &&handler) {
        handler(httpContext ? httpContext->listen(nullptr, port, 0) : nullptr);
        return std::move(*this);
    }

    /* Port, options, callback */
    TemplatedApp &&listen(int port, int options, MoveOnlyFunction<void(us_listen_socket_t *)> &&handler) {
        handler(httpContext ? httpContext->listen(nullptr, port, options) : nullptr);
        return std::move(*this);
    }

    /* options, callback, path to unix domain socket */
    TemplatedApp &&listen(int options, MoveOnlyFunction<void(us_listen_socket_t *)> &&handler, std::string_view path) {
        handler(httpContext ? httpContext->listen_unix(path.data(), path.length(), options) : nullptr);
        return std::move(*this);
    }

    /* callback, path to unix domain socket */
    TemplatedApp &&listen(MoveOnlyFunction<void(us_listen_socket_t *)> &&handler, std::string_view path, int options) {
        handler(httpContext ? httpContext->listen_unix(path.data(), path.length(), options) : nullptr);
        return std::move(*this);
    }

    void setOnClose(HttpContextData<SSL>::OnSocketClosedCallback onClose) {
        httpContext->getSocketContextData()->onSocketClosed = onClose;
    }

    void setOnClientError(HttpContextData<SSL>::OnClientErrorCallback onClientError) {
        httpContext->getSocketContextData()->onClientError = std::move(onClientError);
    }

    TemplatedApp &&run() {
        uWS::run();
        return std::move(*this);
    }

    TemplatedApp &&setUsingCustomExpectHandler(bool value) {
        httpContext->getSocketContextData()->flags.usingCustomExpectHandler = value;
        return std::move(*this);
    }

    TemplatedApp &&setFlags(bool requireHostHeader, bool useStrictMethodValidation) {
        httpContext->getSocketContextData()->flags.requireHostHeader = requireHostHeader;
        httpContext->getSocketContextData()->flags.useStrictMethodValidation = useStrictMethodValidation;
        return std::move(*this);
    }

    TemplatedApp &&setMaxHTTPHeaderSize(uint64_t maxHeaderSize) {
        httpContext->getSocketContextData()->maxHeaderSize = maxHeaderSize;
        return std::move(*this);
    }

};

typedef TemplatedApp<false> App;
typedef TemplatedApp<true> SSLApp;

}
