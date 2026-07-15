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
#pragma once

/* This data belongs to the HttpResponse */

#include "HttpParser.h"
#include "AsyncSocketData.h"
#include "ProxyParser.h"
#include "HttpContext.h"

#include "MoveOnlyFunction.h"

namespace uWS {

template <bool SSL>
struct HttpContext;

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
    void markDone(uWS::HttpResponse<SSL> *uwsRes) {
        onAborted = nullptr;
        /* Also remove onWritable so that we do not emit when draining behind the scenes. */
        onWritable = nullptr;
        writableUserData = nullptr;
        /* Ignore data after this point */
        inStream = nullptr;

        // Ensure we don't call a timeout callback
        onTimeout = nullptr;

        /* We are done with this request */
        this->state &= ~HttpResponseData<SSL>::HTTP_RESPONSE_PENDING;

        HttpResponseData<SSL> *httpResponseData = uwsRes->getHttpResponseData();
        httpResponseData->isIdle = true;
    }

    /* Caller of onWritable. It is possible onWritable calls markDone so we need to borrow it. */
    bool callOnWritable(uWS::HttpResponse<SSL>* response, uint64_t offset) {
        /* Borrow real onWritable */
        auto* borrowedOnWritable = std::move(onWritable);

        /* Set onWritable to placeholder */
        onWritable = [](uWS::HttpResponse<SSL>*, uint64_t, void*) {return true;};

        /* Run borrowed onWritable */
        bool ret = borrowedOnWritable(response, offset, writableUserData);

        /* If we still have onWritable (the placeholder) then move back the real one */
        if (onWritable) {
            /* We haven't reset onWritable, so give it back */
            onWritable = std::move(borrowedOnWritable);
        }

        return ret;
    }
    /* Bits of status. HttpContext's request handler resets `state` wholesale
     * at the start of every request, so only per-response facts live here. */
    enum  : uint16_t {
        HTTP_STATUS_CALLED = 1, // used
        HTTP_WRITE_CALLED = 2, // used
        HTTP_END_CALLED = 4, // used
        HTTP_RESPONSE_PENDING = 8, // used
        HTTP_CONNECTION_CLOSE = 16, // used
        HTTP_WROTE_CONTENT_LENGTH_HEADER = 32, // used
        HTTP_WROTE_DATE_HEADER = 64, // used
        HTTP_WROTE_TRANSFER_ENCODING_HEADER = 128, // used
        /* The request was HTTP/1.0 (no chunked transfer coding). */
        HTTP_FROM_ANCIENT_REQUEST = 256,
        /* No body framing at all: no Content-Length, no chunked encoding, no
         * terminating chunk. writeStatus() sets it for 1xx and 204 (RFC 9110
         * 8.6); node:http additionally sets it for 304. */
        HTTP_NO_BODY_STATUS = 512,
        /* The body is delimited by connection close: written raw with no
         * Content-Length and no chunked framing, then closed. Used by
         * node:http when the user removed the framing headers. */
        HTTP_CLOSE_DELIMITED = 1024,
        /* The application already wrote a Connection header (e.g. node:http's
         * own "Connection: close"); suppresses the automatic one. */
        HTTP_WROTE_CONNECTION_HEADER = 2048,
    };

    /* Shared context pointer for onAborted/onTimeout/onData */
    void* userData = nullptr;
    /* onWritable can be owned by a different object (the streaming body
     * writer, e.g. Bun's HTTPServerWritable sink) than the one owning
     * onAborted/onTimeout/onData (the RequestContext), and it can be armed
     * mid-response when tryEnd() reports backpressure. Keep its context
     * pointer in its own slot so arming it does not redirect the other
     * callbacks to the wrong object. Mirrors Http3ResponseData. */
    void* writableUserData = nullptr;
    void* socketData = nullptr;

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
    uint16_t state = 0;
    uint8_t idleTimeout = 10; // default HTTP_TIMEOUT 10 seconds
    /* Not a `state` bit: it is per connection, not per response, and
     * consumePostPadded() takes it by reference (HttpContext::onData) so
     * upgradeToTunnelMode()'s write reaches the in-flight parse. */
    bool isConnectRequest = false;
    /* Not a `state` bit: it brackets one onData call, which can span several
     * pipelined requests; set/cleared by onData around the parser. */
    bool isParsingHttp = false;

#ifdef UWS_WITH_PROXY
    ProxyParser proxyParser;
#endif
};

}
