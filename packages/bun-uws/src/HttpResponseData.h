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

#include <type_traits>

namespace uWS {

template <bool, bool>
struct HttpContext;

template <bool, bool>
struct HttpResponse;

/* Per-connection state that only node:http compatibility servers use. Compiled
 * out entirely (via std::conditional_t + [[no_unique_address]]) for Bun.serve
 * so that instantiation carries none of these bytes and none of the branches
 * that read them. */
struct NodeHttpResponseFields {
    /* lastMessageStartMs: when the request currently being received started
     * arriving (or when the connection was accepted, before its first
     * request); 0 once the message has been fully received (idle). Mirrors
     * last_message_start_ in Node's http parser ConnectionsList, which backs
     * server.headersTimeout / requestTimeout. */
    uint64_t lastMessageStartMs = 0;
    /* Opaque JS-side per-socket handle (JSNodeHTTPServerSocket). */
    void* socketData = nullptr;
    /* Trailer fields set via response.addTrailers(), pre-rendered as
     * "name: value\r\n" lines. Written between the terminating 0 chunk and the
     * final CRLF of a chunked response (RFC 9112 7.1.2); non-empty also forces
     * chunked framing for the response body. */
    std::string nodeHttpResponseTrailers;
    /* Number of pipelined responses dispatched to JS that have not yet become
     * this connection's current response. While non-zero, newly parsed
     * requests keep being queued (preserving response order) and socket reads
     * stay paused (bounding memory under a pipeline flood). */
    uint32_t nodeHttpQueuedPipelinedCount = 0;
    /* Whether the currently-being-received request's head has been fully
     * parsed. Mirrors headers_completed_ in Node's ConnectionsList. */
    uint8_t headersCompleted : 1 = false;
    /* The request currently being routed arrived while an earlier response on
     * this connection is still in flight (HTTP/1.1 pipelining). NodeHTTP.cpp
     * queues it on the server socket instead of making it the connection's
     * current response; the per-response state reset is applied later by
     * JSNodeHTTPServerSocket::startPipelinedResponse(). Only meaningful while
     * the request handler dispatch is on the stack. */
    uint8_t isNodeHttpPipelinedDispatch : 1 = false;
    /* The JS layer stopped HTTP processing on this connection (Node frees the
     * parser when 'close' is emitted on the socket); any further request data
     * in the buffer is not parsed. */
    uint8_t nodeHttpParsingStopped : 1 = false;
    /* Socket reads were paused because pipelined responses are (or were)
     * queued. Reads resume once the queue has drained AND the socket has no
     * outgoing backpressure left (Node's flood prevention pauses the socket
     * while responses back up). */
    uint8_t nodeHttpReadsPaused : 1 = false;
    /* An accepted Upgrade request with a body. The body is parsed and
     * delivered through the request as usual; once it completes, the
     * connection switches into CONNECT-style tunnel mode (isConnectRequest)
     * and everything after the end of the message is opaque data for the
     * 'upgrade' listener's socket. */
    uint8_t nodeHttpTunnelAfterBody : 1 = false;
    /* The peer half-closed (FIN) while pipelined responses were still queued
     * behind the in-flight one. Like Node's http server, the connection stays
     * open so those responses can still be written; it is shut down once the
     * pipeline has drained (see shouldCloseConnection()). */
    uint8_t nodeHttpReceivedFIN : 1 = false;
};

/* Empty stand-in selected when NODE_HTTP is false. With
 * [[no_unique_address]] this occupies zero bytes in HttpResponseData. */
struct EmptyNodeHttp {};

template <bool SSL, bool NODE_HTTP = false>
struct HttpResponseData : AsyncSocketData<SSL>, HttpParser<NODE_HTTP> {
    template <bool, bool> friend struct HttpResponse;
    template <bool, bool> friend struct HttpContext;
    public:
    using OnWritableCallback = bool (*)(uWS::HttpResponse<SSL, NODE_HTTP>*, uint64_t, void*);
    using OnAbortedCallback = void (*)(uWS::HttpResponse<SSL, NODE_HTTP>*, void*);
    using OnTimeoutCallback = void (*)(uWS::HttpResponse<SSL, NODE_HTTP>*, void*);
    using OnDataCallback = void (*)(uWS::HttpResponse<SSL, NODE_HTTP>* response, const char* chunk, size_t chunk_length, bool, void*);

    /* When we are done with a response we mark it like so */
    void markDone(uWS::HttpResponse<SSL, NODE_HTTP> *uwsRes) {
        onAborted = nullptr;
        /* Also remove onWritable so that we do not emit when draining behind the scenes. */
        onWritable = nullptr;
        writableUserData = nullptr;
        /* Ignore data after this point */
        inStream = nullptr;

        // Ensure we don't call a timeout callback
        onTimeout = nullptr;

        /* We are done with this request */
        this->state &= ~HttpResponseData::HTTP_RESPONSE_PENDING;

        HttpResponseData *httpResponseData = uwsRes->getHttpResponseData();
        httpResponseData->isIdle = true;
    }

    /* Caller of onWritable. It is possible onWritable calls markDone so we need to borrow it. */
    bool callOnWritable(uWS::HttpResponse<SSL, NODE_HTTP>* response, uint64_t offset) {
        /* Borrow real onWritable */
        auto* borrowedOnWritable = std::move(onWritable);

        /* Set onWritable to placeholder */
        onWritable = [](uWS::HttpResponse<SSL, NODE_HTTP>*, uint64_t, void*) {return true;};

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

    /* Shared context pointer for onAborted/onTimeout/onData */
    void* userData = nullptr;
    /* onWritable can be owned by a different object (the streaming body
     * writer, e.g. Bun's HTTPServerWritable sink) than the one owning
     * onAborted/onTimeout/onData (the RequestContext), and it can be armed
     * mid-response when tryEnd() reports backpressure. Keep its context
     * pointer in its own slot so arming it does not redirect the other
     * callbacks to the wrong object. Mirrors Http3ResponseData. */
    void* writableUserData = nullptr;

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
    /* When set, the response carries no body framing at all: no Content-Length,
     * no chunked encoding, no terminating chunk. writeStatus() sets it for 1xx
     * and 204 (RFC 9110 8.6); node:http additionally sets it for 304. */
    bool noBodyStatus = false;
    /* The response body is delimited by connection close: write it raw with
     * no Content-Length and no chunked framing, then close. Used by node:http
     * when the user removed the framing headers. */
    bool closeDelimited = false;
    /* CONNECT-method request (or a completed Upgrade tunnel): everything on
     * the wire is opaque data, not HTTP. Coupled with HttpParser's persisted
     * remainingStreamingBytes across onData calls, so it must persist for both
     * NODE_HTTP instantiations (not in nodeCompat). */
    bool isConnectRequest = false;

    /* node:http server compat state. When NODE_HTTP is false this is
     * EmptyNodeHttp (zero bytes via [[no_unique_address]]) and every access is
     * gated behind `if constexpr (NODE_HTTP)`, so Bun.serve pays nothing. */
    [[no_unique_address]] std::conditional_t<NODE_HTTP, NodeHttpResponseFields, EmptyNodeHttp> nodeCompat;

    /* Whether the connection should be torn down once the in-flight response (if
     * any) has completed and all buffered outgoing data has been flushed. */
    bool shouldCloseConnection() const {
        if constexpr (!NODE_HTTP) {
            return state & HTTP_CONNECTION_CLOSE;
        } else {
            return (state & HTTP_CONNECTION_CLOSE)
                || (nodeCompat.nodeHttpReceivedFIN && nodeCompat.nodeHttpQueuedPipelinedCount == 0);
        }
    }

#ifdef UWS_WITH_PROXY
    ProxyParser proxyParser;
#endif
};

/* Bun.serve's per-socket allocation must not exceed what it was on main before
 * the node:http compat state landed. Bound is main's measured layout expressed
 * relative to sizeof(std::string) so it holds across libc++ and libstdc++. */
static_assert(sizeof(HttpResponseData<false, false>) <= 112 + 2 * sizeof(std::string),
    "HttpResponseData<SSL, NODE_HTTP=false> grew past its size on main; the Bun.serve per-socket allocation regressed");

}
