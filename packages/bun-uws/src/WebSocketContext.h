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
#include "SocketKinds.h"

namespace uWS {

template <bool SSL, bool isServer, typename USERDATA>
struct WebSocketContext {
    template <bool> friend struct TemplatedApp;
    template <bool, typename> friend struct WebSocketProtocol;
private:
    /* Real heap-allocated owner; group.ext = this. Replaces the old
     * reinterpret_cast over a us_create_child_socket_context() blob. */
    WebSocketContext(TopicTree<TopicTreeMessage, TopicTreeBigMessage> *topicTree) : data(topicTree) {}

    us_socket_group_t group{};
    WebSocketContextData<SSL, USERDATA> data;

public:
    /* Not constexpr — the ordinals are linked from `src/uws_sys/SocketKind.rs`
     * so a reorder there can't silently mis-route us. */
    static unsigned char socketKind() { return SSL ? US_SOCKET_KIND_UWS_WS_TLS : US_SOCKET_KIND_UWS_WS; }

    us_socket_group_t *getSocketGroup() {
        return &group;
    }

    WebSocketContextData<SSL, USERDATA> *getExt() {
        return &data;
    }

    static WebSocketContext *fromSocket(us_socket_t *s) {
        return (WebSocketContext *) us_socket_group_ext(us_socket_group(s));
    }

    static WebSocketContextData<SSL, USERDATA> *getExtS(us_socket_t *s) {
        return &fromSocket(s)->data;
    }

private:
    /* If we have negotiated compression, mark the message as compressed. Idempotent:
     * consume() re-validates the same header when an extended-length header straddles
     * a read boundary and is spilled, so this must keep returning true for it. */
    static bool setCompressed(WebSocketState<isServer> */*wState*/, void *s) {
        WebSocketData *webSocketData = (WebSocketData *) us_socket_ext((us_socket_t *) s);

        if (webSocketData->compressionStatus == WebSocketData::CompressionStatus::DISABLED) {
            return false;
        }
        webSocketData->compressionStatus = WebSocketData::CompressionStatus::COMPRESSED_FRAME;
        return true;
    }

    /* noinline: called from a dozen cold branches in the parser */
    __attribute__((noinline)) static void failConnection(WebSocketState<isServer> */*wState*/, void *s, const WebSocketFailure &failure, unsigned int detail = 0) {
        ((WebSocket<SSL, isServer, USERDATA> *) s)->failConnection(failure, detail);
    }

    static void handleCloseFrame(WebSocket<SSL, isServer, USERDATA> *webSocket, char *data, size_t length) {
        protocol::CloseFrame closeFrame = protocol::parseClosePayload(data, length, getExtS((us_socket_t *) webSocket)->skipUTF8Validation);
        if (closeFrame.failure) {
            webSocket->failConnection(*closeFrame.failure, closeFrame.code);
        } else {
            webSocket->conclude(closeFrame.code, closeFrame.message);
        }
    }

    /* Skip auto-pongs above 16 MiB of backpressure. The peer can send unlimited pings, so unbounded replies would let
     * it exhaust our memory. This applies even when maxBackpressure is 0 and app sends aren't capped.
     * RFC 6455 5.5.3 allows answering only the most recent ping. */
    static void sendAutomaticPong(WebSocket<SSL, isServer, USERDATA> *webSocket, std::string_view payload) {
        WebSocketData *webSocketData = (WebSocketData *) us_socket_ext((us_socket_t *) webSocket);
        if (!getExtS((us_socket_t *) webSocket)->autoPong || webSocketData->closeFrameSent || webSocket->getBufferedAmount() > 16 * 1024 * 1024) {
            return;
        }
        webSocket->send(payload, OpCode::PONG);
    }

    /* On error, fails the connection and returns false */
    static bool inflateMessage(void *s, char *&data, size_t &length) {
        WebSocketContextData<SSL, USERDATA> *webSocketContextData = getExtS((us_socket_t *) s);
        WebSocketData *webSocketData = (WebSocketData *) us_socket_ext((us_socket_t *) s);
        LoopData *loopData = (LoopData *) us_loop_ext(us_socket_group_loop(us_socket_group((us_socket_t *) s)));

        /* Decompress using shared or dedicated decompressor */
        InflateResult inflated = webSocketData->inflationStream
            ? webSocketData->inflationStream->inflate(loopData->zlibContext, {data, length}, webSocketContextData->maxPayloadLength, false)
            : loopData->inflationStream->inflate(loopData->zlibContext, {data, length}, webSocketContextData->maxPayloadLength, true);

        if (inflated.closeCode == FAIL_OUT_OF_MEMORY.closeCode) {
            failOutOfMemory(s);
            return false;
        }
        if (inflated.closeCode) {
            failConnection(nullptr, s, inflated.closeCode == FAIL_TOO_BIG_MESSAGE.closeCode ? FAIL_TOO_BIG_MESSAGE : FAIL_INVALID_COMPRESSED_DATA);
            return false;
        }
        data = (char *) inflated.data.data();
        length = inflated.data.length();
        return true;
    }

    /* Frees the partially buffered message and fails the connection. Returns true, like handleFragment() on breakage. */
    __attribute__((noinline)) static bool failOutOfMemory(void *s) {
        ((WebSocketData *) us_socket_ext((us_socket_t *) s))->fragmentBuffer.release();
        ((WebSocket<SSL, isServer, USERDATA> *) s)->failOutOfMemory();
        return true;
    }

    /* Returns true if the message handler closed the connection or started shutting it down. A connection that's
     * shutting down doesn't read anymore, so free its fragment buffer right away. */
    static bool stoppedByHandler(void *s) {
        if (us_socket_is_closed((us_socket_t *) s)) {
            return true;
        }
        WebSocketData *webSocketData = (WebSocketData *) us_socket_ext((us_socket_t *) s);
        if (!webSocketData->isShuttingDown) {
            return false;
        }
        webSocketData->fragmentBuffer.release();
        return true;
    }

    /* Returns true on breakage */
    static bool handleFragment(char *data, size_t length, unsigned int remainingBytes, int opCode, bool fin, WebSocketState<isServer> *webSocketState, void *s) {
        /* WebSocketData and WebSocketContextData */
        WebSocketContextData<SSL, USERDATA> *webSocketContextData = getExtS((us_socket_t *) s);
        WebSocketData *webSocketData = (WebSocketData *) us_socket_ext((us_socket_t *) s);

        /* Is this a non-control frame? */
        if (opCode < 3) {
            /* Did we get everything in one go? */
            if (!remainingBytes && fin && !webSocketData->fragmentBuffer.length()) {

                /* Handle compressed frame */
                if (webSocketData->compressionStatus == WebSocketData::CompressionStatus::COMPRESSED_FRAME) {
                        webSocketData->compressionStatus = WebSocketData::CompressionStatus::ENABLED;

                        if (!inflateMessage(s, data, length)) {
                            return true;
                        }
                }

                /* Check text messages for Utf-8 validity */
                if (opCode == 1 && !webSocketContextData->skipUTF8Validation && !protocol::isValidUtf8((unsigned char *) data, length)) {
                    failConnection(webSocketState, s, FAIL_INVALID_TEXT);
                    return true;
                }

                /* Emit message event & break if we are closed or shut down when returning */
                if (webSocketContextData->messageHandler) {
                    webSocketContextData->messageHandler((WebSocket<SSL, isServer, USERDATA> *) s, std::string_view(data, length), (OpCode) opCode);
                    if (stoppedByHandler(s)) {
                        return true;
                    }
                }
            } else {
                /* Reserve the whole frame up front the first time, capped at 16 MiB because the peer controls the
                 * length. If that fails, the buffer grows as bytes arrive. */
                if (!webSocketData->fragmentBuffer.length()) {
                    (void) webSocketData->fragmentBuffer.tryReserve(std::min<size_t>(length + remainingBytes, 16 * 1024 * 1024));
                }
                /* Fragments forming a big message are not caught until appending them */
                if (refusePayloadLength(length + webSocketData->fragmentBuffer.length(), webSocketState, s)) {
                    failConnection(webSocketState, s, FAIL_TOO_BIG_MESSAGE);
                    return true;
                }
                if (!webSocketData->fragmentBuffer.tryAppend(data, length)) {
                    return failOutOfMemory(s);
                }

                /* Are we done now? */
                // todo: what if we don't have any remaining bytes yet we are not fin? forceclose!
                if (!remainingBytes && fin) {

                    /* Handle compression */
                    if (webSocketData->compressionStatus == WebSocketData::CompressionStatus::COMPRESSED_FRAME) {
                            webSocketData->compressionStatus = WebSocketData::CompressionStatus::ENABLED;

                            /* 9 bytes of padding for libdeflate, 4 for zlib */
                            if (!webSocketData->fragmentBuffer.tryAppend("123456789", 9)) {
                                return failOutOfMemory(s);
                            }

                            data = webSocketData->fragmentBuffer.data();
                            length = webSocketData->fragmentBuffer.length() - 9;
                            if (!inflateMessage(s, data, length)) {
                                return true;
                            }
                    } else {
                        // reset length and data ptrs
                        length = webSocketData->fragmentBuffer.length();
                        data = webSocketData->fragmentBuffer.data();
                    }

                    /* Check text messages for Utf-8 validity */
                    if (opCode == 1 && !webSocketContextData->skipUTF8Validation && !protocol::isValidUtf8((unsigned char *) data, length)) {
                        failConnection(webSocketState, s, FAIL_INVALID_TEXT);
                        return true;
                    }

                    /* Emit message and check for shutdown or close */
                    if (webSocketContextData->messageHandler) {
                        webSocketContextData->messageHandler((WebSocket<SSL, isServer, USERDATA> *) s, std::string_view(data, length), (OpCode) opCode);
                        if (stoppedByHandler(s)) {
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
                    handleCloseFrame(webSocket, data, length);
                    return true;
                } else {
                    if (opCode == PING) {
                        sendAutomaticPong(webSocket, std::string_view(data, length));
                        if (webSocketContextData->pingHandler) {
                            webSocketContextData->pingHandler(webSocket, {data, length});
                            if (us_socket_is_closed((us_socket_t *) s) || webSocketData->isShuttingDown) {
                                return true;
                            }
                        }
                    } else if (opCode == PONG) {
                        if (webSocketContextData->pongHandler) {
                            webSocketContextData->pongHandler(webSocket, {data, length});
                            if (us_socket_is_closed((us_socket_t *) s) || webSocketData->isShuttingDown) {
                                return true;
                            }
                        }
                    }
                }
            } else {
                /* Here we never mind any size optimizations as we are in the worst possible path */
                if (!webSocketData->fragmentBuffer.tryAppend(data, length)) {
                    return failOutOfMemory(s);
                }
                webSocketData->controlTipLength += (unsigned int) length;

                if (!remainingBytes && fin) {
                    char *controlBuffer = (char *) webSocketData->fragmentBuffer.data() + webSocketData->fragmentBuffer.length() - webSocketData->controlTipLength;
                    if (opCode == CLOSE) {
                        handleCloseFrame(webSocket, controlBuffer, webSocketData->controlTipLength);
                        return true;
                    } else {
                        if (opCode == PING) {
                            sendAutomaticPong(webSocket, std::string_view(controlBuffer, webSocketData->controlTipLength));
                            if (webSocketContextData->pingHandler) {
                                webSocketContextData->pingHandler(webSocket, std::string_view(controlBuffer, webSocketData->controlTipLength));
                                if (us_socket_is_closed((us_socket_t *) s) || webSocketData->isShuttingDown) {
                                    return true;
                                }
                            }
                        } else if (opCode == PONG) {
                            if (webSocketContextData->pongHandler) {
                                webSocketContextData->pongHandler(webSocket, std::string_view(controlBuffer, webSocketData->controlTipLength));
                                if (us_socket_is_closed((us_socket_t *) s) || webSocketData->isShuttingDown) {
                                    return true;
                                }
                            }
                        }
                    }

                    /* Same here, we do not care for any particular smart allocation scheme */
                    webSocketData->fragmentBuffer.truncate(webSocketData->fragmentBuffer.length() - webSocketData->controlTipLength);
                    webSocketData->controlTipLength = 0;
                }
            }
        }
        return false;
    }

    static bool refusePayloadLength(uint64_t length, WebSocketState<isServer> */*wState*/, void *s) {
        auto *webSocketContextData = getExtS((us_socket_t *) s);

        /* Return true for refuse, false for accept */
        return webSocketContextData->maxPayloadLength < length;
    }

    /* ── vtable handlers (adopted sockets only — never on_open) ──────────── */

    static us_socket_t *onClose(us_socket_t *s, int code, void *reason) {
        ((AsyncSocket<SSL> *)s)->uncorkWithoutSending();

        /* For whatever reason, if we already have emitted close event, do not emit it again */
        WebSocketData *webSocketData = (WebSocketData *) (us_socket_ext(s));
        if (webSocketData->socketData && webSocketData->onSocketClosed) {
            webSocketData->onSocketClosed(webSocketData->socketData, SSL, (us_socket_t *) s, 0, false);
        }
        if (!webSocketData->isShuttingDown) {
            /* Emit close event */
            auto *webSocketContextData = getExtS(s);

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
    }

    static us_socket_t *onData(us_socket_t *s, char *data, int length) {
        /* We need the websocket data */
        WebSocketData *webSocketData = (WebSocketData *) (us_socket_ext(s));

        /* When in websocket shutdown mode, we do not care for ANY message, whether responding close frame or not.
         * We only care for the TCP FIN really, not emitting any message after closing is key */
        if (webSocketData->isShuttingDown) {
            return s;
        }

        auto *webSocketContextData = getExtS(s);
        auto *asyncSocket = (AsyncSocket<SSL> *) s;

        /* Every time we get data and not in shutdown state we simply reset the timeout.
         * We can still get data while paused (the rest of a TLS read); keep the timeout disabled then. */
        if (!s->flags.is_paused) {
            asyncSocket->timeout(webSocketContextData->idleTimeoutComponents.first);
        }
        webSocketData->hasTimedOut = false;

        /* We always cork on data */
        asyncSocket->cork();

        /* This parser has virtually no overhead */
        WebSocketProtocol<isServer, WebSocketContext<SSL, isServer, USERDATA>>::consume(data, (unsigned int) length, (WebSocketState<isServer> *) webSocketData, s);

        /* Uncorking a closed socekt is fine, in fact it is needed */
        asyncSocket->uncork();

        return s;
    }

    static us_socket_t *onWritable(us_socket_t *s) {
        /* NOTE: Are we called here corked? If so, the below write code is broken, since
         * we will have 0 as getBufferedAmount due to writing to cork buffer, then sending TCP FIN before
         * we actually uncorked and sent off things */

        /* It makes sense to check for us_is_shut_down here and return if so, to avoid shutting down twice */
        if (us_socket_is_shut_down((us_socket_t *) s)) {
            return s;
        }

        AsyncSocket<SSL> *asyncSocket = (AsyncSocket<SSL> *) s;
        WebSocketData *webSocketData = (WebSocketData *)(us_socket_ext(s));

        /* We store old backpressure since it is unclear whether write drained anything */
        size_t backpressure = asyncSocket->getBufferedAmount();

        /* Drain as much as possible */
        asyncSocket->write(nullptr, 0);

        /* Behavior: if we actively drain backpressure, always reset timeout (even if we are in shutdown) */
        /* Also reset timeout if we came here with 0 backpressure */
        if (!backpressure || backpressure > asyncSocket->getBufferedAmount()) {
            auto *webSocketContextData = getExtS(s);
            if (webSocketData->isShuttingDown) {
                asyncSocket->timeout(webSocketContextData->idleTimeoutComponents.second);
            } else if (!s->flags.is_paused) {
                asyncSocket->timeout(webSocketContextData->idleTimeoutComponents.first);
                webSocketData->hasTimedOut = false;
            }
        }

        /* Are we in (WebSocket) shutdown mode? */
        if (webSocketData->isShuttingDown) {
            /* Check if we just now drained completely */
            if (asyncSocket->getBufferedAmount() == 0) {
                /* Now perform the actual TCP/TLS shutdown which was postponed due to backpressure */
                asyncSocket->shutdown();
            }
        } else if (backpressure > asyncSocket->getBufferedAmount() || (!backpressure && webSocketData->needsDrainEvent)) {
            /* Only call drain if we actually drained backpressure, or a later send() already did. Coming here with
             * 0 backpressure isn't enough: pause() and resume() also make the socket poll for writable. */
            webSocketData->needsDrainEvent = asyncSocket->getBufferedAmount() != 0;
            auto *webSocketContextData = getExtS(s);
            if (webSocketContextData->drainHandler) {
                webSocketContextData->drainHandler((WebSocket<SSL, isServer, USERDATA> *) s);
            }
            /* No need to check for closed here as we leave the handler immediately*/
        }

        return s;
    }

    static us_socket_t *onEnd(us_socket_t *s) {
        ((AsyncSocket<SSL> *)s)->uncorkWithoutSending();

        /* If we get a fin, we just close I guess */
        us_socket_close((us_socket_t *) s, 0, nullptr);

        return s;
    }

    static us_socket_t *onLongTimeout(us_socket_t *s) {
        ((WebSocket<SSL, isServer, USERDATA> *) s)->end(1000, "please reconnect");

        return s;
    }

    static us_socket_t *onTimeout(us_socket_t *s) {
        auto *webSocketData = (WebSocketData *)(us_socket_ext(s));
        auto *webSocketContextData = getExtS(s);

        if (webSocketContextData->sendPingsAutomatically && !webSocketData->isShuttingDown && !webSocketData->hasTimedOut) {
            webSocketData->hasTimedOut = true;
            us_socket_timeout(s, webSocketContextData->idleTimeoutComponents.second);
            /* Send ping without being corked */
            ((AsyncSocket<SSL> *) s)->write("\x89\x00", 2);
            return s;
        }

        /* Assume the peer is unreachable and skip the close frame. The reason length doubles as the close code. */
        us_socket_close(s, (int) ERR_WEBSOCKET_TIMEOUT.length(), (void *) ERR_WEBSOCKET_TIMEOUT.data());

        return s;
    }

    static inline const us_socket_vtable_t wsVTable = {
        /* on_open */         nullptr,
        /* on_data */         &onData,
        /* on_fd */           nullptr,
        /* on_writable */     &onWritable,
        /* on_close */        &onClose,
        /* on_timeout */      &onTimeout,
        /* on_long_timeout */ &onLongTimeout,
        /* on_end */          &onEnd,
        /* on_connect_error */nullptr,
        /* on_connecting_error */ nullptr,
        /* on_handshake */    nullptr,
    };

    void free() {
        us_socket_group_deinit(&group);
        delete this;
    }

public:
    /* WebSocket contexts adopt sockets from a parent HTTP context's loop. No
     * SSL_CTX needed — the socket already has its `s->ssl` from accept time. */
    static WebSocketContext *create(Loop *loop, TopicTree<TopicTreeMessage, TopicTreeBigMessage> *topicTree) {
        WebSocketContext *webSocketContext = new WebSocketContext(topicTree);
        /* WebSocket::getContextData() recovers &data as
         * (us_socket_group_t*)group.ext + 1 to avoid pulling this header into
         * WebSocket.h. That's only sound if `group` is the first member and `data`
         * sits immediately after it with no inserted base/field. (offsetof is not
         * usable here: the struct is not standard-layout.) The layout can differ
         * per ABI, so check it in every build; this runs once per context. */
        RELEASE_ASSERT((void *) &webSocketContext->data == (void *) ((us_socket_group_t *) webSocketContext + 1));
        us_socket_group_init(&webSocketContext->group, (us_loop_t *) loop, &wsVTable, webSocketContext);
        return webSocketContext;
    }
};

}

#endif // UWS_WEBSOCKETCONTEXT_H
