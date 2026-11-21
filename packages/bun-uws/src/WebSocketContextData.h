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

using IdleTimeoutComponents = std::pair<unsigned short, unsigned short>;

constexpr IdleTimeoutComponents idleTimeoutComponentsFor(unsigned short idleTimeout, bool sendPingsAutomatically) {
    unsigned short margin = 4;
    /* 4, 8 or 16 seconds margin based on idleTimeout */
    while ((int) idleTimeout - margin * 2 >= margin * 2 && margin < 16) {
        margin = (unsigned short) (margin << 1);
    }
    return {
        (unsigned short) (idleTimeout && sendPingsAutomatically ? idleTimeout - margin : idleTimeout), /* reduce normal idleTimeout if it is extended by ping-timeout */
        margin /* ping-timeout - also used for end() timeout */
    };
}
static_assert(idleTimeoutComponentsFor(0, true) == IdleTimeoutComponents{0, 4});
static_assert(idleTimeoutComponentsFor(0, false) == IdleTimeoutComponents{0, 4});
static_assert(idleTimeoutComponentsFor(8, true) == IdleTimeoutComponents{4, 4});
static_assert(idleTimeoutComponentsFor(120, true) == IdleTimeoutComponents{104, 16});
static_assert(idleTimeoutComponentsFor(120, false) == IdleTimeoutComponents{120, 16});

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

    /* Server sockets of the `ws` package. end() only sends the close frame. The close handler runs when the peer's
     * close frame arrives or the connection closes, and gets -WebSocketFailureKind as its code on a protocol error. */
    bool wsPackage = false;
    bool autoPong = true;
    bool skipUTF8Validation = false;

    /* These are calculated on creation */
    IdleTimeoutComponents idleTimeoutComponents;

    /* This is run once on start-up */
    void calculateIdleTimeoutComponents(unsigned short idleTimeout) {
        idleTimeoutComponents = wsPackage ? IdleTimeoutComponents{0, 0} : idleTimeoutComponentsFor(idleTimeout, sendPingsAutomatically);
    }

    ~WebSocketContextData() {

    }

    WebSocketContextData(TopicTree<TopicTreeMessage, TopicTreeBigMessage> *topicTree) : topicTree(topicTree) {

    }
};

}

#endif // UWS_WEBSOCKETCONTEXTDATA_H
