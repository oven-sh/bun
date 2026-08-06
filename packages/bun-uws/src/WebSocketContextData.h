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

#ifndef UWS_WEBSOCKETCONTEXTDATA_H
#define UWS_WEBSOCKETCONTEXTDATA_H

#include "Loop.h"
#include "AsyncSocket.h"

#include "MoveOnlyFunction.h"
#include <string_view>
#include <vector>

#include "WebSocketProtocol.h"
#include "TopicTree.h"
#include "WebSocketData.h"

namespace uWS {

/* Type queued up when publishing */
struct TopicTreeMessage {
    std::string message;
    /*OpCode*/ int opCode;
    bool compress;
};
struct TopicTreeBigMessage {
    std::string_view message;
    /*OpCode*/ int opCode;
    bool compress;
};

template <bool, bool, typename> struct WebSocket;

/* todo: this looks identical to WebSocketBehavior, why not just std::move that entire thing in? */

template <bool SSL, typename USERDATA>
struct WebSocketContextData {
private:

public:
    /* This one points to the App's shared topicTree */
    TopicTree<TopicTreeMessage, TopicTreeBigMessage> *topicTree;

    /* The callbacks for this context */
    MoveOnlyFunction<void(WebSocket<SSL, true, USERDATA> *)> openHandler = nullptr;
    MoveOnlyFunction<void(WebSocket<SSL, true, USERDATA> *, std::string_view, OpCode)> messageHandler = nullptr;
    MoveOnlyFunction<void(WebSocket<SSL, true, USERDATA> *)> drainHandler = nullptr;
    MoveOnlyFunction<void(WebSocket<SSL, true, USERDATA> *, std::string_view, int, int)> subscriptionHandler = nullptr;
    MoveOnlyFunction<void(WebSocket<SSL, true, USERDATA> *, int, std::string_view)> closeHandler = nullptr;
    MoveOnlyFunction<void(WebSocket<SSL, true, USERDATA> *, std::string_view)> pingHandler = nullptr;
    MoveOnlyFunction<void(WebSocket<SSL, true, USERDATA> *, std::string_view)> pongHandler = nullptr;

    /* Settings for this context */
    size_t maxPayloadLength = 0;

    /* We do need these for async upgrade */
    CompressOptions compression;

    /* There needs to be a maxBackpressure which will force close everything over that limit */
    size_t maxBackpressure = 0;
    bool closeOnBackpressureLimit;
    bool resetIdleTimeoutOnSend;
    bool sendPingsAutomatically;
    unsigned short maxLifetime;

    /* These are calculated on creation */
    std::pair<unsigned short, unsigned short> idleTimeoutComponents;

    /* This is run once on start-up */
    void calculateIdleTimeoutComponents(unsigned short idleTimeout) {
        unsigned short margin = 4;
        /* 4, 8 or 16 seconds margin based on idleTimeout */
        while ((int) idleTimeout - margin * 2 >= margin * 2 && margin < 16) {
            margin = (unsigned short) (margin << 1);
        }
        idleTimeoutComponents = {
            /* idleTimeout == 0 is an intentional, distinct "off" value, not
             * an ordinary small timeout: App.h's ws() validation terminates
             * with "Error: idleTimeout must be either 0 or greater than 8!"
             * if a caller passes anything in (0, 8) (see App.h:414-416),
             * and Bun's own WebSocketServerContext.rs config-translation
             * layer explicitly exempts 0 from its "round up to 8" clamp for
             * the same reason. Special-case it rather than let it fall into
             * the subtraction below: idleTimeout - margin
             * underflows the unsigned short (0 - 4 == 65532), which
             * us_socket_timeout would then treat as a very real ~252-second
             * timeout (65532 seconds, tick-wheel-rounded) instead of no
             * timeout at all. us_socket_timeout(s, 0) already means
             * "disabled" (see socket.c), so pass 0 straight through.
             * Only .first (the idle-detection arm) is affected: .second
             * keeps its normal margin value below unchanged, since it also
             * doubles as the post-end() force-close grace period (see
             * WebSocket.h's end()), which is unrelated to idle-timeout and
             * must keep firing regardless of idleTimeout. */
            idleTimeout == 0 ? 0 : idleTimeout - (sendPingsAutomatically ? margin : 0), /* reduce normal idleTimeout if it is extended by ping-timeout */
            margin /* ping-timeout - also used for end() timeout */
        };
    }

    ~WebSocketContextData() {

    }

    WebSocketContextData(TopicTree<TopicTreeMessage, TopicTreeBigMessage> *topicTree) : topicTree(topicTree) {

    }
};

}

#endif // UWS_WEBSOCKETCONTEXTDATA_H
