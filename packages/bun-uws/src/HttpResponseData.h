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
#ifndef UWS_HTTPRESPONSEDATA_H
#define UWS_HTTPRESPONSEDATA_H

/* This data belongs to the HttpResponse */

#include "HttpParser.h"
#include "AsyncSocketData.h"
#include "ProxyParser.h"

#include "MoveOnlyFunction.h"

namespace uWS {

template <bool SSL>
struct HttpResponseData : AsyncSocketData<SSL>, HttpParser {
    template <bool> friend struct HttpResponse;
    template <bool> friend struct HttpContext;
    public:
    using OnWritableCallback = bool (*)(uWS::HttpResponse<SSL>*, uint64_t, void*);
    using OnAbortedCallback = void (*)(uWS::HttpResponse<SSL>*, void*);
    using OnTimeoutCallback = void (*)(uWS::HttpResponse<SSL>*, void*);
    using OnDataCallback = void (*)(uWS::HttpResponse<SSL>* response, const char* chunk, size_t chunk_length, bool, void*);
    
    /* When we are done with a response we mark it like so */
    void markDone() {
        onAborted = nullptr;
        /* Also remove onWritable so that we do not emit when draining behind the scenes. */
        onWritable = nullptr;
        /* Ignore data after this point */
        inStream = nullptr;

        // Ensure we don't call a timeout callback
        onTimeout = nullptr;

        /* We are done with this request */
        this->state &= ~HttpResponseData<SSL>::HTTP_RESPONSE_PENDING;
    }

    /* Caller of onWritable. It is possible onWritable calls markDone so we need to borrow it. */
    bool callOnWritable( uWS::HttpResponse<SSL>* response, uint64_t offset) {
        /* Borrow real onWritable */
        auto* borrowedOnWritable = std::move(onWritable);

        /* Set onWritable to placeholder */
        onWritable = [](uWS::HttpResponse<SSL>*, uint64_t, void*) {return true;};

        /* Run borrowed onWritable */
        bool ret = borrowedOnWritable(response, offset, userData);

        /* If we still have onWritable (the placeholder) then move back the real one */
        if (onWritable) {
            /* We haven't reset onWritable, so give it back */
            onWritable = std::move(borrowedOnWritable);
        }

        return ret;
    }
    /* Bits of status */
    enum  : uint8_t {
        HTTP_STATUS_CALLED = 1, // used
        HTTP_WRITE_CALLED = 2, // used
        HTTP_END_CALLED = 4, // used
        HTTP_RESPONSE_PENDING = 8, // used
        HTTP_CONNECTION_CLOSE = 16 // used
    };

    /* Shared context pointer */
    void* userData = nullptr;

    /* Per socket event handlers */
    OnWritableCallback onWritable = nullptr;
    OnAbortedCallback onAborted = nullptr;
    OnDataCallback inStream = nullptr;
    OnTimeoutCallback onTimeout = nullptr;
    /* Outgoing offset */
    uint64_t offset = 0;

    /* Let's track number of bytes since last timeout reset in data handler */
    unsigned int received_bytes_per_timeout = 0;

    /* Current state (content-length sent, status sent, write called, etc */
    uint8_t state = 0;
    uint8_t idleTimeout = 10; // default HTTP_TIMEOUT 10 seconds

#ifdef UWS_WITH_PROXY
    ProxyParser proxyParser;
#endif
};

}

#endif // UWS_HTTPRESPONSEDATA_H
