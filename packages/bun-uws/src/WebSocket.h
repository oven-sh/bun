/*
 * Authored by Alex Hultman, 2018-2021.
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

#ifndef UWS_WEBSOCKET_H
#define UWS_WEBSOCKET_H

#include "AsyncSocket.h"
#include "WebSocketContextData.h"
#include "WebSocketData.h"
#include "WebSocketProtocol.h"

#include <string_view>
// clang-format off
namespace uWS {

template <bool SSL, bool isServer, typename USERDATA>
struct WebSocket : AsyncSocket<SSL> {
    template <bool> friend struct TemplatedApp;
    template <bool> friend struct HttpResponse;
private:
    typedef AsyncSocket<SSL> Super;

    void *init(bool perMessageDeflate, CompressOptions compressOptions, BackPressure &&backpressure, void *socketData, WebSocketData::OnSocketClosedCallback onSocketClosed) {
        new (us_socket_ext(SSL, (us_socket_t *) this)) WebSocketData(perMessageDeflate, compressOptions, std::move(backpressure), socketData, onSocketClosed);
        return this;
    }
public:

    /* Returns pointer to the per socket user data */
    USERDATA *getUserData() {
        WebSocketData *webSocketData = (WebSocketData *) us_socket_ext(SSL, (us_socket_t *) this);
        /* We just have it overallocated by sizeof type */
        return (USERDATA *) (webSocketData + 1);
    }

    /* See AsyncSocket */
    using Super::getBufferedAmount;
    using Super::getRemoteAddress;
    using Super::getRemoteAddressAsText;
    using Super::getNativeHandle;

    /* WebSocket close cannot be an alias to AsyncSocket::close since
     * we need to check first if it was shut down by remote peer */
    us_socket_t *close() {
        if (us_socket_is_closed(SSL, (us_socket_t *) this)) {
            return nullptr;
        }
        WebSocketData *webSocketData = (WebSocketData *) Super::getAsyncSocketData();
        if (webSocketData->isShuttingDown) {
            return nullptr;
        }

        return us_socket_close(SSL, (us_socket_t *) this, 0, nullptr);
    }

    enum SendStatus : int {
        BACKPRESSURE,
        SUCCESS,
        DROPPED
    };

    size_t memoryCost() {
        return getBufferedAmount() + sizeof(WebSocket);
    }

    /* Sending fragmented messages puts a bit of effort on the user; you must not interleave regular sends
     * with fragmented sends and you must sendFirstFragment, [sendFragment], then finally sendLastFragment. */
    SendStatus sendFirstFragment(std::string_view message, OpCode opCode = OpCode::BINARY, bool compress = false) {
        return send(message, opCode, compress, false);
    }

    SendStatus sendFragment(std::string_view message, bool compress = false) {
        return send(message, CONTINUATION, compress, false);
    }

    SendStatus sendLastFragment(std::string_view message, bool compress = false) {
        return send(message, CONTINUATION, compress, true);
    }

    /* Send or buffer a WebSocket frame, compressed or not. Returns BACKPRESSURE on increased user space backpressure,
     * DROPPED on dropped message (due to backpressure) or SUCCCESS if you are free to send even more now. */
    SendStatus send(std::string_view message, OpCode opCode = OpCode::BINARY, bool compress = false, bool fin = true) {
        WebSocketContextData<SSL, USERDATA> *webSocketContextData = (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL,
            (us_socket_context_t *) us_socket_context(SSL, (us_socket_t *) this)
        );

        /* Skip sending and report success if we are over the limit of maxBackpressure */
        if (webSocketContextData->maxBackpressure && webSocketContextData->maxBackpressure < getBufferedAmount()) {
            /* Also defer a close if we should */
            if (webSocketContextData->closeOnBackpressureLimit) {
                us_socket_shutdown_read(SSL, (us_socket_t *) this);
            }
            return DROPPED;
        }

        /* If we are subscribers and have messages to drain we need to drain them here to stay synced */
        WebSocketData *webSocketData = (WebSocketData *) Super::getAsyncSocketData();

        /* Special path for long sends of non-compressed, non-SSL messages */
        if (message.length() >= 16 * 1024 && !compress && !SSL && !webSocketData->subscriber && getBufferedAmount() == 0 && Super::getLoopData()->getCorkOffset() == 0) {
            char header[10];
            int header_length = (int) protocol::formatMessage<isServer>(header, "", 0, opCode, message.length(), compress, fin);
            int written = us_socket_write2(0, (struct us_socket_t *)this, header, header_length, message.data(), (int) message.length());

            if (written != header_length + (int) message.length()) {
                /* Buffer up backpressure */
                if (written > header_length) {
                    webSocketData->buffer.append(message.data() + written - header_length, message.length() - (size_t) (written - header_length));
                } else {
                    webSocketData->buffer.append(header + written, (size_t) header_length - (size_t) written);
                    webSocketData->buffer.append(message.data(), message.length());
                }
                /* We cannot still be corked if we have backpressure.
                 * We also cannot uncork normally since it will re-write the already buffered
                 * up backpressure again. */
                Super::uncorkWithoutSending();
                return BACKPRESSURE;
            }
        } else {

            if (webSocketData->subscriber) {
                /* This will call back into us, send. */
                webSocketContextData->topicTree->drain(webSocketData->subscriber);
            }

            /* Transform the message to compressed domain if requested */
            if (compress) {
                WebSocketData *webSocketData = (WebSocketData *) Super::getAsyncSocketData();

                /* Check and correct the compress hint. It is never valid to compress 0 bytes */
                if (message.length() && opCode < 3 && webSocketData->compressionStatus == WebSocketData::ENABLED) {
                    LoopData *loopData = Super::getLoopData();
                    /* Compress using either shared or dedicated deflationStream */
                    if (webSocketData->deflationStream) {
                        message = webSocketData->deflationStream->deflate(loopData->zlibContext, message, false);
                    } else {
                        message = loopData->deflationStream->deflate(loopData->zlibContext, message, true);
                    }
                } else {
                    compress = false;
                }
            }

            /* Get size, allocate size, write if needed */
            size_t messageFrameSize = protocol::messageFrameSize(message.length());
            auto [sendBuffer, sendBufferAttribute] = Super::getSendBuffer(messageFrameSize);
            protocol::formatMessage<isServer>(sendBuffer, message.data(), message.length(), opCode, message.length(), compress, fin);

            /* Depending on size of message we have different paths */
            if (sendBufferAttribute == SendBufferAttribute::NEEDS_DRAIN) {
                /* This is a drain */
                auto[written, failed] = Super::write(nullptr, 0);
                if (failed) {
                    /* Return false for failure, skipping to reset the timeout below */
                    return BACKPRESSURE;
                }
            } else if (sendBufferAttribute == SendBufferAttribute::NEEDS_UNCORK) {
                /* Uncork if we came here uncorked */
                auto [written, failed] = Super::uncork();
                if (failed) {
                    return BACKPRESSURE;
                }
            }

        }

        /* Every successful send resets the timeout */
        if (webSocketContextData->resetIdleTimeoutOnSend) {
            Super::timeout(webSocketContextData->idleTimeoutComponents.first);
            WebSocketData *webSocketData = (WebSocketData *) Super::getAsyncSocketData();
            webSocketData->hasTimedOut = false;
        }

        /* Return success */
        return SUCCESS;
    }

    /* Send websocket close frame, emit close event, send FIN if successful.
     * Will not append a close reason if code is 0 or 1005. */
    void end(int code = 0, std::string_view message = {}) {
        /* Check if we already called this one */
        WebSocketData *webSocketData = (WebSocketData *) us_socket_ext(SSL, (us_socket_t *) this);
        if (webSocketData->isShuttingDown) {
            return;
        }

        /* We postpone any FIN sending to either drainage or uncorking */
        webSocketData->isShuttingDown = true;

        /* Format and send the close frame */
        static const int MAX_CLOSE_PAYLOAD = 123;
        size_t length = std::min<size_t>(MAX_CLOSE_PAYLOAD, message.length());
        char closePayload[MAX_CLOSE_PAYLOAD + 2];
        size_t closePayloadLength = protocol::formatClosePayload(closePayload, (uint16_t) code, message.data(), length);
        bool ok = send(std::string_view(closePayload, closePayloadLength), OpCode::CLOSE);

        /* FIN if we are ok and not corked */
        if (!this->isCorked()) {
            if (ok) {
                /* If we are not corked, and we just sent off everything, we need to FIN right here.
                 * In all other cases, we need to fin either if uncork was successful, or when drainage is complete. */
                this->shutdown();
            }
        }

        WebSocketContextData<SSL, USERDATA> *webSocketContextData = (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL,
            (us_socket_context_t *) us_socket_context(SSL, (us_socket_t *) this)
        );

        /* Set shorter timeout (use ping-timeout) to avoid long hanging sockets after end() on broken connections */
        Super::timeout(webSocketContextData->idleTimeoutComponents.second);

        /* At this point we iterate all currently held subscriptions and emit an event for all of them */
        if (webSocketData->subscriber && webSocketContextData->subscriptionHandler) {
            for (Topic *t : webSocketData->subscriber->topics) {
                webSocketContextData->subscriptionHandler(this, t->name, (int) t->size() - 1, (int) t->size());
            }
        }

        /* Make sure to unsubscribe from any pub/sub node at exit */
        webSocketContextData->topicTree->freeSubscriber(webSocketData->subscriber);
        webSocketData->subscriber = nullptr;

        /* Emit close event */
        if (webSocketContextData->closeHandler) {
            webSocketContextData->closeHandler(this, code, message);
        }
    }

    /* Corks the response if possible. Leaves already corked socket be. */
    void cork(MoveOnlyFunction<void()> &&handler) {
        if (!Super::isCorked() && Super::canCork()) {
            Super::cork();
            handler();

            /* There is no timeout when failing to uncork for WebSockets,
             * as that is handled by idleTimeout */
            auto [written, failed] = Super::uncork();
            (void)written;
            (void)failed;
        } else {
            /* We are already corked, or can't cork so let's just call the handler */
            handler();
        }
    }

    /* Subscribe to a topic according to MQTT rules and syntax. Returns success */
    bool subscribe(std::string_view topic, bool = false) {
        WebSocketContextData<SSL, USERDATA> *webSocketContextData = (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL,
            (us_socket_context_t *) us_socket_context(SSL, (us_socket_t *) this)
        );

        /* Make us a subscriber if we aren't yet */
        WebSocketData *webSocketData = (WebSocketData *) us_socket_ext(SSL, (us_socket_t *) this);
        if (!webSocketData->subscriber) {
            webSocketData->subscriber = webSocketContextData->topicTree->createSubscriber();
            webSocketData->subscriber->user = this;
        }

        /* Cannot return numSubscribers as this is only for this particular websocket context */
        Topic *topicOrNull = webSocketContextData->topicTree->subscribe(webSocketData->subscriber, topic);
        if (topicOrNull && webSocketContextData->subscriptionHandler) {
            /* Emit this socket, the topic, new count, old count */
            webSocketContextData->subscriptionHandler(this, topic, (int) topicOrNull->size(), (int) topicOrNull->size() - 1);
        }

        /* Subscribe always succeeds */
        return true;
    }

    /* Unsubscribe from a topic, returns true if we were subscribed. */
    bool unsubscribe(std::string_view topic, bool = false) {
        WebSocketContextData<SSL, USERDATA> *webSocketContextData = (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL,
            (us_socket_context_t *) us_socket_context(SSL, (us_socket_t *) this)
        );

        WebSocketData *webSocketData = (WebSocketData *) us_socket_ext(SSL, (us_socket_t *) this);

        if (!webSocketData->subscriber) { return false; }

        /* Cannot return numSubscribers as this is only for this particular websocket context */
        auto [ok, last, newCount] = webSocketContextData->topicTree->unsubscribe(webSocketData->subscriber, topic);
        /* Emit subscription event if last */
        if (ok && webSocketContextData->subscriptionHandler) {
            webSocketContextData->subscriptionHandler(this, topic, newCount, newCount + 1);
        }

        /* Free us as subscribers if we unsubscribed from our last topic */
        if (ok && last) {
            webSocketContextData->topicTree->freeSubscriber(webSocketData->subscriber);
            webSocketData->subscriber = nullptr;
        }

        return ok;
    }

    /* Returns whether this socket is subscribed to the specified topic */
    bool isSubscribed(std::string_view topic) {
        WebSocketContextData<SSL, USERDATA> *webSocketContextData = (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL,
            (us_socket_context_t *) us_socket_context(SSL, (us_socket_t *) this)
        );

        WebSocketData *webSocketData = (WebSocketData *) us_socket_ext(SSL, (us_socket_t *) this);
        if (!webSocketData->subscriber) {
            return false;
        }

        Topic *topicPtr = webSocketContextData->topicTree->lookupTopic(topic);
        if (!topicPtr) {
            return false;
        }

        return topicPtr->count(webSocketData->subscriber);
    }

    /* Iterates all topics of this WebSocket. Every topic is represented by its full name.
     * Can be called in close handler. It is possible to modify the subscription list while
     * inside the callback ONLY IF not modifying the topic passed to the callback.
     * Topic names are valid only for the duration of the callback. */
    void iterateTopics(MoveOnlyFunction<void(std::string_view)> cb) {
        WebSocketContextData<SSL, USERDATA> *webSocketContextData = (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL,
            (us_socket_context_t *) us_socket_context(SSL, (us_socket_t *) this)
        );

        WebSocketData *webSocketData = (WebSocketData *) us_socket_ext(SSL, (us_socket_t *) this);
        if (webSocketData->subscriber) {
            /* Lock this subscriber for unsubscription / subscription */
            webSocketContextData->topicTree->iteratingSubscriber = webSocketData->subscriber;

            for (Topic *topicPtr : webSocketData->subscriber->topics) {
                cb({topicPtr->name.data(), topicPtr->name.length()});
            }

            /* Unlock subscriber */
            webSocketContextData->topicTree->iteratingSubscriber = nullptr;
        }
    }

    /* Publish a message to a topic according to MQTT rules and syntax. Returns success.
     * We, the WebSocket, must be subscribed to the topic itself and if so - no message will be sent to ourselves.
     * Use App::publish for an unconditional publish that simply publishes to whomever might be subscribed. */
    bool publish(std::string_view topic, std::string_view message, OpCode opCode = OpCode::TEXT, bool compress = false) {
        WebSocketContextData<SSL, USERDATA> *webSocketContextData = (WebSocketContextData<SSL, USERDATA> *) us_socket_context_ext(SSL,
            (us_socket_context_t *) us_socket_context(SSL, (us_socket_t *) this)
        );

        /* We cannot be a subscriber of this topic if we are not a subscriber of anything */
        WebSocketData *webSocketData = (WebSocketData *) us_socket_ext(SSL, (us_socket_t *) this);
        if (!webSocketData->subscriber) {
            /* Failure, but still do return the number of subscribers */
            return false;
        }

        /* Publish as sender, does not receive its own messages even if subscribed to relevant topics */
        if (message.length() >= LoopData::CORK_BUFFER_SIZE) {
            return webSocketContextData->topicTree->publishBig(webSocketData->subscriber, topic, {message, opCode, compress}, [](Subscriber *s, TopicTreeBigMessage &message) {
                auto *ws = (WebSocket<SSL, true, int> *) s->user;

                ws->send(message.message, (OpCode)message.opCode, message.compress);
            });
        } else {
            return webSocketContextData->topicTree->publish(webSocketData->subscriber, topic, {std::string(message), opCode, compress});
        }
    }
};

}

#endif // UWS_WEBSOCKET_H