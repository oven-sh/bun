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
#ifndef UWS_WEBSOCKETCONTEXT_H
#define UWS_WEBSOCKETCONTEXT_H

#include "WebSocketContextData.h"
#include "WebSocketProtocol.h"
#include "WebSocketData.h"
#include "WebSocket.h"

namespace uWS {

template <bool SSL, bool isServer, typename USERDATA>
struct WebSocketContext {
    template <bool> friend struct TemplatedApp;
    template <bool, typename> friend struct WebSocketProtocol;
private:
    WebSocketContext() = delete;

    us_socket_context_t *getSocketContext() {
        return (us_socket_context_t *) this;
    }

    WebSocketContextData<SSL, USERDATA> *getExt() {
        return (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL, (us_socket_context_t *) this);
    }

    /* If we have negotiated compression, set this frame compressed */
    static bool setCompressed(WebSocketState<isServer> */*wState*/, void *s) {
        WebSocketData *webSocketData = (WebSocketData *) us_socket_ext(SSL, (us_socket_t *) s);

        if (webSocketData->compressionStatus == WebSocketData::CompressionStatus::ENABLED) {
            webSocketData->compressionStatus = WebSocketData::CompressionStatus::COMPRESSED_FRAME;
            return true;
        } else {
            return false;
        }
    }

    static void forceClose(WebSocketState<isServer> */*wState*/, void *s, std::string_view reason = {}) {
        us_socket_close(SSL, (us_socket_t *) s, (int) reason.length(), (void *) reason.data());
    }

    /* Returns true on breakage */
    static bool handleFragment(char *data, size_t length, unsigned int remainingBytes, int opCode, bool fin, WebSocketState<isServer> *webSocketState, void *s) {
        /* WebSocketData and WebSocketContextData */
        WebSocketContextData<SSL, USERDATA> *webSocketContextData = (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL, us_socket_context(SSL, (us_socket_t *) s));
        WebSocketData *webSocketData = (WebSocketData *) us_socket_ext(SSL, (us_socket_t *) s);

        /* Is this a non-control frame? */
        if (opCode < 3) {
            /* Did we get everything in one go? */
            if (!remainingBytes && fin && !webSocketData->fragmentBuffer.length()) {

                /* Handle compressed frame */
                if (webSocketData->compressionStatus == WebSocketData::CompressionStatus::COMPRESSED_FRAME) {
                        webSocketData->compressionStatus = WebSocketData::CompressionStatus::ENABLED;

                        LoopData *loopData = (LoopData *) us_loop_ext(us_socket_context_loop(SSL, us_socket_context(SSL, (us_socket_t *) s)));
                        /* Decompress using shared or dedicated decompressor */
                        std::optional<std::string_view> inflatedFrame;
                        if (webSocketData->inflationStream) {
                            inflatedFrame = webSocketData->inflationStream->inflate(loopData->zlibContext, {data, length}, webSocketContextData->maxPayloadLength, false);
                        } else {
                            inflatedFrame = loopData->inflationStream->inflate(loopData->zlibContext, {data, length}, webSocketContextData->maxPayloadLength, true);
                        }

                        if (!inflatedFrame.has_value()) {
                            forceClose(webSocketState, s, ERR_TOO_BIG_MESSAGE_INFLATION);
                            return true;
                        } else {
                            data = (char *) inflatedFrame->data();
                            length = inflatedFrame->length();
                        }
                }

                /* Check text messages for Utf-8 validity */
                if (opCode == 1 && !protocol::isValidUtf8((unsigned char *) data, length)) {
                    forceClose(webSocketState, s, ERR_INVALID_TEXT);
                    return true;
                }

                /* Emit message event & break if we are closed or shut down when returning */
                if (webSocketContextData->messageHandler) {
                    webSocketContextData->messageHandler((WebSocket<SSL, isServer, USERDATA> *) s, std::string_view(data, length), (OpCode) opCode);
                    if (us_socket_is_closed(SSL, (us_socket_t *) s) || webSocketData->isShuttingDown) {
                        return true;
                    }
                }
            } else {
                /* Allocate fragment buffer up front first time */
                if (!webSocketData->fragmentBuffer.length()) {
                    webSocketData->fragmentBuffer.reserve(length + remainingBytes);
                }
                /* Fragments forming a big message are not caught until appending them */
                if (refusePayloadLength(length + webSocketData->fragmentBuffer.length(), webSocketState, s)) {
                    forceClose(webSocketState, s, ERR_TOO_BIG_MESSAGE);
                    return true;
                }
                webSocketData->fragmentBuffer.append(data, length);

                /* Are we done now? */
                // todo: what if we don't have any remaining bytes yet we are not fin? forceclose!
                if (!remainingBytes && fin) {

                    /* Handle compression */
                    if (webSocketData->compressionStatus == WebSocketData::CompressionStatus::COMPRESSED_FRAME) {
                            webSocketData->compressionStatus = WebSocketData::CompressionStatus::ENABLED;

                            /* 9 bytes of padding for libdeflate, 4 for zlib */
                            webSocketData->fragmentBuffer.append("123456789");

                            LoopData *loopData = (LoopData *) us_loop_ext(
                                us_socket_context_loop(SSL,
                                    us_socket_context(SSL, (us_socket_t *) s)
                                )
                            );

                            /* Decompress using shared or dedicated decompressor */
                            std::optional<std::string_view> inflatedFrame;
                            if (webSocketData->inflationStream) {
                                inflatedFrame = webSocketData->inflationStream->inflate(loopData->zlibContext, {webSocketData->fragmentBuffer.data(), webSocketData->fragmentBuffer.length() - 9}, webSocketContextData->maxPayloadLength, false);
                            } else {
                                inflatedFrame = loopData->inflationStream->inflate(loopData->zlibContext, {webSocketData->fragmentBuffer.data(), webSocketData->fragmentBuffer.length() - 9}, webSocketContextData->maxPayloadLength, true);
                            }

                            if (!inflatedFrame.has_value()) {
                                forceClose(webSocketState, s, ERR_TOO_BIG_MESSAGE_INFLATION);
                                return true;
                            } else {
                                data = (char *) inflatedFrame->data();
                                length = inflatedFrame->length();
                            }


                    } else {
                        // reset length and data ptrs
                        length = webSocketData->fragmentBuffer.length();
                        data = webSocketData->fragmentBuffer.data();
                    }

                    /* Check text messages for Utf-8 validity */
                    if (opCode == 1 && !protocol::isValidUtf8((unsigned char *) data, length)) {
                        forceClose(webSocketState, s, ERR_INVALID_TEXT);
                        return true;
                    }

                    /* Emit message and check for shutdown or close */
                    if (webSocketContextData->messageHandler) {
                        webSocketContextData->messageHandler((WebSocket<SSL, isServer, USERDATA> *) s, std::string_view(data, length), (OpCode) opCode);
                        if (us_socket_is_closed(SSL, (us_socket_t *) s) || webSocketData->isShuttingDown) {
                            return true;
                        }
                    }

                    /* If we shutdown or closed, this will be taken care of elsewhere */
                    webSocketData->fragmentBuffer.clear();
                }
            }
        } else {
            /* Control frames need the websocket to send pings, pongs and close */
            WebSocket<SSL, isServer, USERDATA> *webSocket = (WebSocket<SSL, isServer, USERDATA> *) s;

            if (!remainingBytes && fin && !webSocketData->controlTipLength) {
                if (opCode == CLOSE) {
                    auto closeFrame = protocol::parseClosePayload(data, length);
                    webSocket->end(closeFrame.code, std::string_view(closeFrame.message, closeFrame.length));
                    return true;
                } else {
                    if (opCode == PING) {
                        webSocket->send(std::string_view(data, length), (OpCode) OpCode::PONG);
                        if (webSocketContextData->pingHandler) {
                            webSocketContextData->pingHandler(webSocket, {data, length});
                            if (us_socket_is_closed(SSL, (us_socket_t *) s) || webSocketData->isShuttingDown) {
                                return true;
                            }
                        }
                    } else if (opCode == PONG) {
                        if (webSocketContextData->pongHandler) {
                            webSocketContextData->pongHandler(webSocket, {data, length});
                            if (us_socket_is_closed(SSL, (us_socket_t *) s) || webSocketData->isShuttingDown) {
                                return true;
                            }
                        }
                    }
                }
            } else {
                /* Here we never mind any size optimizations as we are in the worst possible path */
                webSocketData->fragmentBuffer.append(data, length);
                webSocketData->controlTipLength += (unsigned int) length;

                if (!remainingBytes && fin) {
                    char *controlBuffer = (char *) webSocketData->fragmentBuffer.data() + webSocketData->fragmentBuffer.length() - webSocketData->controlTipLength;
                    if (opCode == CLOSE) {
                        protocol::CloseFrame closeFrame = protocol::parseClosePayload(controlBuffer, webSocketData->controlTipLength);
                        webSocket->end(closeFrame.code, std::string_view(closeFrame.message, closeFrame.length));
                        return true;
                    } else {
                        if (opCode == PING) {
                            webSocket->send(std::string_view(controlBuffer, webSocketData->controlTipLength), (OpCode) OpCode::PONG);
                            if (webSocketContextData->pingHandler) {
                                webSocketContextData->pingHandler(webSocket, std::string_view(controlBuffer, webSocketData->controlTipLength));
                                if (us_socket_is_closed(SSL, (us_socket_t *) s) || webSocketData->isShuttingDown) {
                                    return true;
                                }
                            }
                        } else if (opCode == PONG) {
                            if (webSocketContextData->pongHandler) {
                                webSocketContextData->pongHandler(webSocket, std::string_view(controlBuffer, webSocketData->controlTipLength));
                                if (us_socket_is_closed(SSL, (us_socket_t *) s) || webSocketData->isShuttingDown) {
                                    return true;
                                }
                            }
                        }
                    }

                    /* Same here, we do not care for any particular smart allocation scheme */
                    webSocketData->fragmentBuffer.resize((unsigned int) webSocketData->fragmentBuffer.length() - webSocketData->controlTipLength);
                    webSocketData->controlTipLength = 0;
                }
            }
        }
        return false;
    }

    static bool refusePayloadLength(uint64_t length, WebSocketState<isServer> */*wState*/, void *s) {
        auto *webSocketContextData = (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL, us_socket_context(SSL, (us_socket_t *) s));

        /* Return true for refuse, false for accept */
        return webSocketContextData->maxPayloadLength < length;
    }

    WebSocketContext<SSL, isServer, USERDATA> *init() {
        /* Adopting a socket does not trigger open event.
         * We arreive as WebSocket with timeout set and
         * any backpressure from HTTP state kept. */

        /* Handle socket disconnections */
        us_socket_context_on_close(SSL, getSocketContext(), [](auto *s, int code, void *reason) {
            ((AsyncSocket<SSL> *)s)->uncorkWithoutSending();

            /* For whatever reason, if we already have emitted close event, do not emit it again */
            WebSocketData *webSocketData = (WebSocketData *) (us_socket_ext(SSL, s));
            if (!webSocketData->isShuttingDown) {
                /* Emit close event */
                auto *webSocketContextData = (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL, us_socket_context(SSL, (us_socket_t *) s));

                /* At this point we iterate all currently held subscriptions and emit an event for all of them */
                if (webSocketData->subscriber && webSocketContextData->subscriptionHandler) {
                    for (Topic *t : webSocketData->subscriber->topics) {
                        webSocketContextData->subscriptionHandler((WebSocket<SSL, isServer, USERDATA> *) s, t->name, (int) t->size() - 1, (int) t->size());
                    }
                }

                /* Make sure to unsubscribe from any pub/sub node at exit */
                webSocketContextData->topicTree->freeSubscriber(webSocketData->subscriber);
                webSocketData->subscriber = nullptr;

                if (webSocketContextData->closeHandler) {
                    webSocketContextData->closeHandler((WebSocket<SSL, isServer, USERDATA> *) s, 1006, reason != NULL && code > 0 ? std::string_view{(char *) reason, (size_t) code} : std::string_view());
                }
            }

            /* Destruct in-placed data struct */
            webSocketData->~WebSocketData();

            return s;
        });

        /* Handle WebSocket data streams */
        us_socket_context_on_data(SSL, getSocketContext(), [](auto *s, char *data, int length) {

            /* We need the websocket data */
            WebSocketData *webSocketData = (WebSocketData *) (us_socket_ext(SSL, s));

            /* When in websocket shutdown mode, we do not care for ANY message, whether responding close frame or not.
             * We only care for the TCP FIN really, not emitting any message after closing is key */
            if (webSocketData->isShuttingDown) {
                return s;
            }

            auto *webSocketContextData = (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL, us_socket_context(SSL, (us_socket_t *) s));
            auto *asyncSocket = (AsyncSocket<SSL> *) s;

            /* Every time we get data and not in shutdown state we simply reset the timeout */
            asyncSocket->timeout(webSocketContextData->idleTimeoutComponents.first);
            webSocketData->hasTimedOut = false;

            /* We always cork on data */
            asyncSocket->cork();

            /* This parser has virtually no overhead */
            WebSocketProtocol<isServer, WebSocketContext<SSL, isServer, USERDATA>>::consume(data, (unsigned int) length, (WebSocketState<isServer> *) webSocketData, s);

            /* Uncorking a closed socekt is fine, in fact it is needed */
            asyncSocket->uncork();

            /* If uncorking was successful and we are in shutdown state then send TCP FIN */
            if (asyncSocket->getBufferedAmount() == 0) {
                /* We can now be in shutdown state */
                if (webSocketData->isShuttingDown) {
                    /* Shutting down a closed socket is handled by uSockets and just fine */
                    asyncSocket->shutdown();
                }
            }

            return s;
        });

        /* Handle HTTP write out (note: SSL_read may trigger this spuriously, the app need to handle spurious calls) */
        us_socket_context_on_writable(SSL, getSocketContext(), [](auto *s) {

            /* NOTE: Are we called here corked? If so, the below write code is broken, since
             * we will have 0 as getBufferedAmount due to writing to cork buffer, then sending TCP FIN before
             * we actually uncorked and sent off things */

            /* It makes sense to check for us_is_shut_down here and return if so, to avoid shutting down twice */
            if (us_socket_is_shut_down(SSL, (us_socket_t *) s)) {
                return s;
            }

            AsyncSocket<SSL> *asyncSocket = (AsyncSocket<SSL> *) s;
            WebSocketData *webSocketData = (WebSocketData *)(us_socket_ext(SSL, s));

            /* We store old backpressure since it is unclear whether write drained anything,
             * however, in case of coming here with 0 backpressure we still need to emit drain event */
            unsigned int backpressure = asyncSocket->getBufferedAmount();

            /* Drain as much as possible */
            asyncSocket->write(nullptr, 0);

            /* Behavior: if we actively drain backpressure, always reset timeout (even if we are in shutdown) */
            /* Also reset timeout if we came here with 0 backpressure */
            if (!backpressure || backpressure > asyncSocket->getBufferedAmount()) {
                auto *webSocketContextData = (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL, us_socket_context(SSL, (us_socket_t *) s));
                asyncSocket->timeout(webSocketContextData->idleTimeoutComponents.first);
                webSocketData->hasTimedOut = false;
            }

            /* Are we in (WebSocket) shutdown mode? */
            if (webSocketData->isShuttingDown) {
                /* Check if we just now drained completely */
                if (asyncSocket->getBufferedAmount() == 0) {
                    /* Now perform the actual TCP/TLS shutdown which was postponed due to backpressure */
                    asyncSocket->shutdown();
                }
            } else if (!backpressure || backpressure > asyncSocket->getBufferedAmount()) {
                /* Only call drain if we actually drained backpressure or if we came here with 0 backpressure */
                auto *webSocketContextData = (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL, us_socket_context(SSL, (us_socket_t *) s));
                if (webSocketContextData->drainHandler) {
                    webSocketContextData->drainHandler((WebSocket<SSL, isServer, USERDATA> *) s);
                }
                /* No need to check for closed here as we leave the handler immediately*/
            }

            return s;
        });

        /* Handle FIN, HTTP does not support half-closed sockets, so simply close */
        us_socket_context_on_end(SSL, getSocketContext(), [](auto *s) {
            ((AsyncSocket<SSL> *)s)->uncorkWithoutSending();

            /* If we get a fin, we just close I guess */
            us_socket_close(SSL, (us_socket_t *) s, 0, nullptr);

            return s;
        });

        us_socket_context_on_long_timeout(SSL, getSocketContext(), [](auto *s) {
            ((WebSocket<SSL, isServer, USERDATA> *) s)->end(1000, "please reconnect");

            return s;
        });

        /* Handle socket timeouts, simply close them so to not confuse client with FIN */
        us_socket_context_on_timeout(SSL, getSocketContext(), [](auto *s) {

            auto *webSocketData = (WebSocketData *)(us_socket_ext(SSL, s));
            auto *webSocketContextData = (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL, us_socket_context(SSL, (us_socket_t *) s));

            if (webSocketContextData->sendPingsAutomatically && !webSocketData->isShuttingDown && !webSocketData->hasTimedOut) {
                webSocketData->hasTimedOut = true;
                us_socket_timeout(SSL, s, webSocketContextData->idleTimeoutComponents.second);
                /* Send ping without being corked */
                ((AsyncSocket<SSL> *) s)->write("\x89\x00", 2);
                return s;
            }

            /* Timeout is very simple; we just close it */
            /* Warning: we happen to know forceClose will not use first parameter so pass nullptr here */
            forceClose(nullptr, s, ERR_WEBSOCKET_TIMEOUT);

            return s;
        });

        return this;
    }

    void free() {
        WebSocketContextData<SSL, USERDATA> *webSocketContextData = (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL, (us_socket_context_t *) this);
        webSocketContextData->~WebSocketContextData();

        us_socket_context_free(SSL, (us_socket_context_t *) this);
    }

public:
    /* WebSocket contexts are always child contexts to a HTTP context so no SSL options are needed as they are inherited */
    static WebSocketContext *create(Loop */*loop*/, us_socket_context_t *parentSocketContext, TopicTree<TopicTreeMessage, TopicTreeBigMessage> *topicTree) {
        WebSocketContext *webSocketContext = (WebSocketContext *) us_create_child_socket_context(SSL, parentSocketContext, sizeof(WebSocketContextData<SSL, USERDATA>));
        if (!webSocketContext) {
            return nullptr;
        }

        /* Init socket context data */
        new ((WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL, (us_socket_context_t *)webSocketContext)) WebSocketContextData<SSL, USERDATA>(topicTree);
        return webSocketContext->init();
    }
};

}

#endif // UWS_WEBSOCKETCONTEXT_H
