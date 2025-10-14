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

#ifndef UWS_WEBSOCKETDATA_H
#define UWS_WEBSOCKETDATA_H

#include "WebSocketProtocol.h"
#include "AsyncSocketData.h"
#include "PerMessageDeflate.h"
#include "TopicTree.h"

#include <string>

namespace uWS {

struct WebSocketData : AsyncSocketData<false>, WebSocketState<true> {
    /* This guy has a lot of friends - why? */
    template <bool, bool, typename> friend struct WebSocketContext;
    template <bool, typename> friend struct WebSocketContextData;
    template <bool, bool, typename> friend struct WebSocket;
    template <bool> friend struct HttpContext;
private:
    std::string fragmentBuffer;
    unsigned int controlTipLength = 0;
    bool isShuttingDown = 0;
    bool hasTimedOut = false;
    
    enum CompressionStatus : char {
        DISABLED,
        ENABLED,
        COMPRESSED_FRAME
    } compressionStatus;

    /* We might have a dedicated compressor */
    DeflationStream *deflationStream = nullptr;
    /* And / or a dedicated decompressor */
    InflationStream *inflationStream = nullptr;

    /* We could be a subscriber */
    Subscriber *subscriber = nullptr;
public:
    using OnSocketClosedCallback = void (*)(void* userData, int is_ssl, struct us_socket_t *rawSocket);
    void *socketData = nullptr;
    /* node http compatibility callbacks */
    OnSocketClosedCallback onSocketClosed = nullptr;

    WebSocketData(bool perMessageDeflate, CompressOptions compressOptions, BackPressure &&backpressure, void *socketData, OnSocketClosedCallback onSocketClosed) : AsyncSocketData<false>(std::move(backpressure)), WebSocketState<true>() {
        compressionStatus = perMessageDeflate ? ENABLED : DISABLED;

        /* Initialize the dedicated sliding window(s) */
        if (perMessageDeflate) {
            if ((compressOptions & CompressOptions::_COMPRESSOR_MASK) != CompressOptions::SHARED_COMPRESSOR) {
                deflationStream = new DeflationStream(compressOptions);
            }
            if ((compressOptions & CompressOptions::_DECOMPRESSOR_MASK) != CompressOptions::SHARED_DECOMPRESSOR) {
                inflationStream = new InflationStream(compressOptions);
            }
        }
        // never close websocket sockets when closing idle connections
        this->isIdle = false;
        this->socketData = socketData;
        this->onSocketClosed = onSocketClosed;
    }

    ~WebSocketData() {
        if (deflationStream) {
            delete deflationStream;
        }

        if (inflationStream) {
            delete inflationStream;
        }

        if (subscriber) {
            delete subscriber;
        }
    }
};

}

#endif // UWS_WEBSOCKETDATA_H
