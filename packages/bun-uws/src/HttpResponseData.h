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
    /* When set, the response carries no body framing at all: no Content-Length,
     * no chunked encoding, no terminating chunk. writeStatus() sets it for 1xx
     * and 204 (RFC 9110 8.6); node:http additionally sets it for 304. */
    bool noBodyStatus = false;
    /* The response body is delimited by connection close: write it raw with
     * no Content-Length and no chunked framing, then close. Used by node:http
     * when the user removed the framing headers. */
    bool closeDelimited = false;

    /* node:http server compat (HttpFlags::usingNodeHttpCompat only).
     * lastMessageStartMs: when the request currently being received started
     * arriving (or when the connection was accepted, before its first
     * request); 0 once the message has been fully received (idle).
     * headersCompleted: whether that request's head has been fully parsed.
     * Mirrors last_message_start_/headers_completed_ in Node's http parser
     * ConnectionsList, which back server.headersTimeout/requestTimeout. */
    uint64_t lastMessageStartMs = 0;
    bool headersCompleted = false;

    /* node:http server compat: the request currently being routed arrived
     * while an earlier response on this connection is still in flight
     * (HTTP/1.1 pipelining). NodeHTTP.cpp queues it on the server socket
     * instead of making it the connection's current response; the per-response
     * state reset is applied later by
     * JSNodeHTTPServerSocket::startPipelinedResponse(). Only meaningful while
     * the request handler dispatch is on the stack. */
    bool isNodeHttpPipelinedDispatch = false;
    /* node:http server compat: the JS layer stopped HTTP processing on this
     * connection (Node frees the parser when 'close' is emitted on the
     * socket); any further request data in the buffer is not parsed. */
    bool nodeHttpParsingStopped = false;
    /* node:http server compat: number of pipelined responses dispatched to JS
     * that have not yet become this connection's current response. While
     * non-zero, newly parsed requests keep being queued (preserving response
     * order) and socket reads stay paused (bounding memory under a pipeline
     * flood). */
    uint32_t nodeHttpQueuedPipelinedCount = 0;
    /* node:http server compat: socket reads were paused because pipelined
     * responses are (or were) queued. Reads resume once the queue has drained
     * AND the socket has no outgoing backpressure left (Node's flood
     * prevention pauses the socket while responses back up). */
    bool nodeHttpReadsPaused = false;
    /* node:http server compat: an accepted Upgrade request with a body. The
     * body is parsed and delivered through the request as usual; once it
     * completes, the connection switches into CONNECT-style tunnel mode
     * (isConnectRequest) and everything after the end of the message is
     * opaque data for the 'upgrade' listener's socket. */
    bool nodeHttpTunnelAfterBody = false;
    /* node:http server compat: trailer fields set via response.addTrailers(),
     * pre-rendered as "name: value\r\n" lines. Written between the terminating
     * 0 chunk and the final CRLF of a chunked response (RFC 9112 7.1.2);
     * non-empty also forces chunked framing for the response body. */
    std::string nodeHttpResponseTrailers;
    /* node:http server compat: the peer half-closed (FIN) while pipelined
     * responses were still queued behind the in-flight one. Like Node's http
     * server, the connection stays open so those responses can still be
     * written; it is shut down once the pipeline has drained (see
     * shouldCloseConnection()). */
    bool nodeHttpReceivedFIN = false;

    /* Whether the connection should be torn down once the in-flight response (if
     * any) has completed and all buffered outgoing data has been flushed. */
    bool shouldCloseConnection() const {
        return (state & HTTP_CONNECTION_CLOSE)
            || (nodeHttpReceivedFIN && nodeHttpQueuedPipelinedCount == 0);
    }

#ifdef UWS_WITH_PROXY
    ProxyParser proxyParser;
#endif
};

}
