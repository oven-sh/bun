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

        /* A pipelined request that arrived while this (async) response was
         * still pending was stashed instead of parsed; now that the response
         * is written, feed it back through onData as if it had just arrived.
         * Swap the buffer out first so a synchronous handler's markDone sees
         * an empty buffer and does not recurse. Reserve the post-padding the
         * parser writes past end-of-input. Must be the last thing markDone
         * touches: the re-entered handler may close the socket and destruct
         * this object. */
        if (!this->deferredPipeline.empty()) {
            std::string pending;
            std::swap(pending, this->deferredPipeline);
            pending.reserve(pending.length() + MINIMUM_HTTP_POST_PADDING);
            HttpContext<SSL>::onData((us_socket_t *) uwsRes, pending.data(), (int) pending.length());
        }
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
    /* Bits of status */
    enum  : uint8_t {
        HTTP_STATUS_CALLED = 1, // used
        HTTP_WRITE_CALLED = 2, // used
        HTTP_END_CALLED = 4, // used
        HTTP_RESPONSE_PENDING = 8, // used
        HTTP_CONNECTION_CLOSE = 16, // used
        HTTP_WROTE_CONTENT_LENGTH_HEADER = 32, // used
        HTTP_WROTE_DATE_HEADER = 64, // used
        HTTP_WROTE_TRANSFER_ENCODING_HEADER = 128, // used
    };

    /* Pipelined request bytes received while an async response was still
     * pending. Cap matches the one-recv path (one per-request MAX_FALLBACK_SIZE
     * buffer worth of extra bytes); beyond that the connection is closed,
     * same as before this buffer existed. */
    static constexpr size_t MAX_DEFERRED_PIPELINE_SIZE = 64 * 1024;
    std::string deferredPipeline;

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
    uint8_t state = 0;
    uint8_t idleTimeout = 10; // default HTTP_TIMEOUT 10 seconds
    bool fromAncientRequest = false;
    bool isConnectRequest = false;
    /* 204/304 responses must not carry any body framing (no Content-Length,
     * no chunked encoding, no terminating chunk), see RFC 9110 6.4.1. */
    bool noBodyStatus = false;
    /* The response body is delimited by connection close: write it raw with
     * no Content-Length and no chunked framing, then close. Used by node:http
     * when the user removed the framing headers. */
    bool closeDelimited = false;

#ifdef UWS_WITH_PROXY
    ProxyParser proxyParser;
#endif
};

}
