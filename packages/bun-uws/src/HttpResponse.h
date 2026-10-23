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
#ifndef UWS_HTTPRESPONSE_H
#define UWS_HTTPRESPONSE_H

/* An HttpResponse is the channel on which you send back a response */

#include "AsyncSocket.h"
#include "HttpResponseData.h"
#include "HttpContext.h"
#include "HttpContextData.h"
#include "Utilities.h"

#include "WebSocketExtensions.h"
#include "WebSocketHandshake.h"
#include "WebSocket.h"
#include "WebSocketContextData.h"

#include "MoveOnlyFunction.h"

/* todo: tryWrite is missing currently, only send smaller segments with write */

namespace uWS {

template <bool, bool, typename> struct WebSocketContext;

/* Some pre-defined status constants to use with writeStatus */
inline constexpr const char* HTTP_200_OK = "200 OK";

template <bool SSL>
struct HttpResponse : public AsyncSocket<SSL> {
    /* Solely used for getHttpResponseData() */
    template <bool> friend struct TemplatedApp;
    typedef AsyncSocket<SSL> Super;
public:

    HttpResponseData<SSL> *getHttpResponseData() {
        return (HttpResponseData<SSL> *) Super::getAsyncSocketData();
    }

    void setTimeout(uint8_t seconds) {
        auto* data = getHttpResponseData();
        data->idleTimeout = seconds;
        Super::timeout(data->idleTimeout);
    }

    void resetTimeout() {
        auto* data = getHttpResponseData();
        data->idleTimer.arm((us_socket_t *) this, data->idleTimeout);
    }

    /* Calls onWritable once the socket takes more, for a body that bypasses write() (sendfile). The wait counts as a blocked write. */
    void requestWritable() {
        us_socket_request_writable((us_socket_t *) this);
        resetTimeout();
    }
    /* The chunk-size line of a chunk. Returns its length. */
    static constexpr size_t CHUNK_HEAD_MAX = 10;
    static_assert(BackPressure::TAIL_ROOM >= 2 + CHUNK_HEAD_MAX);
    static size_t chunkHead(char (&buf)[CHUNK_HEAD_MAX], unsigned int chunkLength) {
        int length = utils::u32toaHex(chunkLength, buf);
        buf[length++] = '\r';
        buf[length++] = '\n';
        return (size_t) length;
    }

    /* Called only once per request */
    void writeMark() {
        if (getHttpResponseData()->state & HttpResponseData<SSL>::HTTP_WROTE_DATE_HEADER) {
            return;
        }
        /* Date is always written */
        writeHeaderLine("Date", std::string_view(((LoopData *) us_loop_ext(us_socket_group_loop(us_socket_group((us_socket_t *) this))))->date, 29));
        getHttpResponseData()->state |= HttpResponseData<SSL>::HTTP_WROTE_DATE_HEADER;
    }

    void writeHeaderLine(std::string_view key, std::string_view value) {
        if (char *line = Super::reserveCorked(key.length() + value.length() + 4)) [[likely]] {
            memcpy(line, key.data(), key.length());
            line += key.length();
            memcpy(line, ": ", 2);
            memcpy(line + 2, value.data(), value.length());
            memcpy(line + 2 + value.length(), "\r\n", 2);
            return;
        }
        Super::write(key.data(), key.length());
        Super::write(": ", 2);
        Super::write(value.data(), value.length());
        Super::write("\r\n", 2);
    }

    /* For terminateHeaders(): the body streams, so its length isn't known when the header section ends. */
    static constexpr uint64_t UNKNOWN_LENGTH = UINT64_MAX;
    /* For terminateHeaders(): uWS sends no body bytes, and the caller wrote the framing headers it wants (HEAD, 304). */
    static constexpr uint64_t NO_BODY = UINT64_MAX - 1;

    /* Decides how the body is delimited ahead of terminateHeaders(). node:http does, where its JavaScript follows Node's rules. */
    void setFraming(uint32_t mode) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();
        httpResponseData->state = (httpResponseData->state & ~HttpResponseData<SSL>::HTTP_BODY_MASK) | mode | HttpResponseData<SSL>::HTTP_FRAMING_DECIDED;
    }

    bool isChunked() {
        return (getHttpResponseData()->state & HttpResponseData<SSL>::HTTP_BODY_MASK) == HttpResponseData<SSL>::HTTP_BODY_CHUNKED;
    }

    /* Ends the header section of every HTTP/1 response. Decides the framing once, and writes the headers uWS owns unless the caller wrote them. */
    void terminateHeaders(uint64_t bodyLength) {
        using Data = HttpResponseData<SSL>;
        writeStatus(HTTP_200_OK);

        Data *httpResponseData = getHttpResponseData();
        bool writeContentLength = false, writeTransferEncoding = false;
        if (!(httpResponseData->state & Data::HTTP_FRAMING_DECIDED)) {
            const uint32_t state = httpResponseData->state;
            const bool ancient = state & Data::HTTP_ANCIENT_REQUEST;
            /* Chunks carry a body of unknown length, one the caller declared chunked, and one with trailers behind it. HTTP/1.0 has none. */
            const bool wantsChunks = bodyLength == UNKNOWN_LENGTH || (state & Data::HTTP_WROTE_TRANSFER_ENCODING_HEADER)
                || (!ancient && (state & Data::HTTP_NODE_HAS_RESPONSE_TRAILERS));
            if (bodyLength == NO_BODY) {
                setFraming(Data::HTTP_BODY_NONE);
            } else if (state & Data::HTTP_WROTE_CONTENT_LENGTH_HEADER) {
                setFraming(Data::HTTP_BODY_LENGTH);
            } else if (!wantsChunks) {
                writeContentLength = true;
                setFraming(Data::HTTP_BODY_LENGTH);
            } else if (ancient) {
                setFraming(Data::HTTP_BODY_UNTIL_CLOSE);
            } else {
                writeTransferEncoding = !(state & Data::HTTP_WROTE_TRANSFER_ENCODING_HEADER);
                setFraming(Data::HTTP_BODY_CHUNKED);
            }
        }
        if ((httpResponseData->state & Data::HTTP_BODY_MASK) == Data::HTTP_BODY_UNTIL_CLOSE) {
            httpResponseData->state |= Data::HTTP_CONNECTION_CLOSE;
        }

        writeMark();
        if (writeTransferEncoding) {
            writeHeaderLine("Transfer-Encoding", "chunked");
        }
        /* RFC 9112 9.6: a client that doesn't see "close" puts the socket back in its pool and loses the next request on it. */
        if (httpResponseData->closesAfterResponse() && !(httpResponseData->state & Data::HTTP_WROTE_CONNECTION_HEADER)) [[unlikely]] {
            writeHeaderLine("Connection", "close");
            /* Nothing may follow a response that says "close", so a graceful stop's mark becomes a hard close. */
            httpResponseData->state |= Data::HTTP_WROTE_CONNECTION_HEADER | Data::HTTP_CONNECTION_CLOSE;
        }
        if (writeContentLength) {
            char digits[utils::U64_MAX_DIGITS];
            writeHeaderLine("Content-Length", {digits, (size_t) utils::u64toa(bodyLength, digits)});
        }
        Super::write("\r\n", 2);
    }

    /* write() and flushHeaders() end the header section and set the first bit, the end() family sets the second. */
    bool isHeaderSectionOpen() {
        return !(getHttpResponseData()->state & (HttpResponseData<SSL>::HTTP_WRITE_CALLED | HttpResponseData<SSL>::HTTP_END_CALLED));
    }

    /* The close mark has to be set before the header section ends, or the response can't say "close". */
    void markCloseConnection(bool closeConnection) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();
        if (closeConnection && !(httpResponseData->state & HttpResponseData<SSL>::HTTP_END_CALLED)) {
            httpResponseData->state |= HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE;
        }
    }

    /* The connection's last byte is out. Whatever the peer still sends must not reset the connection under it, so Bun.serve lingers. node:http closes, like Node's destroySoon(). */
    void closeAfterLastByte() {
        if (HttpContext<SSL>::fromSocket((us_socket_t *) this)->isNodeHttp()) {
            Super::shutdown();
            Super::close();
        } else {
            Super::uncork();
            /* How long the peer takes to answer the FIN holds up neither stop() nor the process. */
            reportGone();
            us_socket_close_lingering((us_socket_t *) this);
        }
    }

    /* Tells the context's filters, once, that this connection no longer counts: it closed, left for another owner, or only lingers. */
    void reportGone() {
        AsyncSocketData<SSL> *data = Super::getAsyncSocketData();
        auto &filterHandlers = HttpContext<SSL>::getSocketContextDataS((us_socket_t *) this)->filterHandlers;
        if (std::exchange(data->filteredOpen, false)) {
            for (auto &f : filterHandlers) {
                f(this, -1);
            }
        }
        if (std::exchange(data->filteredAccept, false)) {
            for (auto &f : filterHandlers) {
                f(this, data->filteredParked ? -4 : -2);
            }
        }
    }

    /* Once the connection is marked to close, the response is complete and every byte is out. Returns true if it closed: the socket isn't the caller's any more. */
    bool closeIfDoneAndMarked(HttpResponseData<SSL> *httpResponseData) {
        if (httpResponseData->shouldCloseConnection() && !(httpResponseData->state & HttpResponseData<SSL>::HTTP_RESPONSE_PENDING) && Super::hasFullyDrained()) {
            closeAfterLastByte();
            return true;
        }
        return false;
    }

    /* Called when a response completes. Returns true when the
     * caller has to run the close gate now, false when onData runs it.
     *
     * The socket onData is parsing gets onData's uncork and close gate once the
     * read is consumed: false. A Bun.serve response that needed no JavaScript
     * (a static route) leaves the cork to onData, so such responses to requests
     * pipelined in one read share one send(). Bun sends them earlier, with
     * sendCorked(), when the handler of a later request is about to run
     * JavaScript. A response that JavaScript produced (sendWhenComplete()) is
     * sent now, and so is a node:http response: its 'finish' event and end()
     * callback run before onData gets control back and expect the bytes to be
     * out.
     *
     * Any other socket (an async handler completing, possibly inside another
     * socket's parse window via a drained microtask) is uncorked here and gets
     * no later uncork or gate: true. */
    bool uncorkCompletedResponse() {
        HttpContext<SSL> *httpContext = HttpContext<SSL>::fromSocket((us_socket_t *) this);
        const bool parsingThis = httpContext->getSocketContextData()->parsingSocket == (us_socket_t *) this;
        if (!Super::isCorked()) {
            /* A write larger than the cork buffer released the cork. The rest of this read can hold the body of a node:http request. */
            return !(parsingThis && httpContext->isNodeHttp());
        }
        if (!parsingThis) {
            this->uncork();
            return true;
        }
        if (httpContext->isNodeHttp() || (getHttpResponseData()->state & HttpResponseData<SSL>::HTTP_SEND_WHEN_COMPLETE)) {
            this->uncork();
        }
        return false;
    }

    /* node:http socket.destroy() during this socket's parse: onData closes it after the current message. False when the caller must close it now. */
    bool closeAfterMessageIfParsing() {
        if (!HttpContext<SSL>::getSocketContextDataS((us_socket_t *) this)->isParsing((us_socket_t *) this)) {
            return false;
        }
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();
        if (httpResponseData->isConnectRequest) {
            return false;
        }
        httpResponseData->state |= HttpResponseData<SSL>::HTTP_NODE_CLOSE_AFTER_MESSAGE;
        return true;
    }

    /* node:http: Node's parser.finish() at the peer's FIN. Returns whether the stream ended inside a message, which is a parse error. The socket can be closed when this returns. */
    bool finishParsing() {
        HttpResponseData<SSL> *data = getHttpResponseData();
        if (data->state & HttpResponseData<SSL>::HTTP_NODE_PARSING_STOPPED) {
            return false;
        }
        /* The FIN completes a request body with no framing (HttpParser::nodeHttpBodyUntilEof). */
        if (data->nodeHttpBodyUntilEof) {
            data->nodeHttpBodyUntilEof = false;
            auto *nodeHttpResponseData = (HttpResponseData<SSL, true> *) data;
            nodeHttpResponseData->lastMessageStartMs = 0;
            nodeHttpResponseData->headersCompleted = false;
            nodeHttpResponseData->requestTimeoutReported = false;
            if (data->inStream) {
                us_socket_timeout((us_socket_t *) this, 0);
                data->inStream(this, nullptr, 0, true, data->userData);
                if (us_socket_is_closed((us_socket_t *) this)) {
                    return false;
                }
                data->inStream = nullptr;
            }
        }
        if (!data->hasBufferedPartialRequestHeaders() && !data->hasIncompleteRequestBody()) {
            return false;
        }
        data->state |= HttpResponseData<SSL>::HTTP_NODE_PARSING_STOPPED;
        return true;
    }

    /* Closes this connection if it is idle: no request is being received, and no response is in flight or queued. Returns whether it closed it. */
    bool closeIfIdle() {
        HttpResponseData<SSL> *data = getHttpResponseData();
        bool idle = data->isIdle;
        if (idle && HttpContext<SSL>::fromSocket((us_socket_t *) this)->isNodeHttp()) {
            /* node:http: a connection that still receives a request (a body, or the head of the next one) is not idle, also after its
             * response ended (Node.js: last_message_start_). In the request handler the parser has not entered a chunked body yet, so the armed body handler tells. */
            const bool messageOpen = ((HttpResponseData<SSL, true> *) data)->lastMessageStartMs != 0;
            idle = !(messageOpen && data->inStream != nullptr) && !data->hasIncompleteRequestBody() && !data->hasBufferedPartialRequestHeaders();
            if (idle && messageOpen && !Super::hasFullyDrained()) {
                /* The handler of this request still runs and its response has unsent bytes: close when they are out. */
                data->state |= HttpResponseData<SSL>::HTTP_CLOSE_WHEN_IDLE;
                idle = false;
            }
        } else if (idle && !Super::hasFullyDrained()) {
            /* Bun.serve: close() would drop the bytes of a finished response that are still in the backpressure buffer.
             * Not idle until they are out: the graceful stop() marks the connection, and onWritable closes it. */
            idle = false;
        }
        if (!idle) {
            return false;
        }
        /* A socket is idle from the moment its response completes. When
         * that happens inside onData's parse loop the response can still
         * sit in the cork buffer, and JS that runs before the loop ends
         * (a graceful stop() from a microtask) gets here. close() sends
         * it first. */
        Super::close();
        return true;
    }

    /* node:http: the connection of a parked request (NodeHTTPResponse::update_parked) doesn't read and has nothing left to send. Like a libuv handle in that state, it doesn't hold the event loop. The filter hears -3, and +3 when that ends. */
    void setParked(bool parked) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();
        if (!httpResponseData->filteredAccept || httpResponseData->filteredParked == parked) {
            return;
        }
        httpResponseData->filteredParked = parked;
        for (auto &f : HttpContext<SSL>::getSocketContextDataS((us_socket_t *) this)->filterHandlers) {
            f(this, parked ? -3 : 3);
        }
    }

    /* Marks the response in flight as one that user JavaScript produces. See
     * HTTP_SEND_WHEN_COMPLETE. */
    void sendWhenComplete() {
        getHttpResponseData()->state |= HttpResponseData<SSL>::HTTP_SEND_WHEN_COMPLETE;
    }

    /* Returns true on success, indicating that it might be feasible to write more data.
     * Will start timeout if stream reaches totalSize or write failure. */
    bool internalEnd(std::string_view data, uint64_t totalSize, bool optional, bool closeConnection) {
        /* If no total size given then assume this chunk is everything */
        if (!totalSize) {
            totalSize = data.length();
        }

        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        /* In some cases, such as when refusing huge data we want to close the connection when drained */
        markCloseConnection(closeConnection);

        if (isHeaderSectionOpen()) {
            terminateHeaders(totalSize);
        }

        if (isChunked()) {
            httpResponseData->state |= HttpResponseData<SSL>::HTTP_WRITE_CALLED;

            /* We do not have tryWrite-like functionalities, so ignore optional in this path */

            /* Write the chunked data if there is any (this will not send zero chunks) */
            const bool terminated = !data.empty() && !(httpResponseData->state & HttpResponseData<SSL>::HTTP_NODE_HAS_RESPONSE_TRAILERS);
            this->write(data, nullptr, terminated);


            /* Terminating 0 chunk; node:http response trailers (RFC 9112 7.1.2) sit
             * between it and the final CRLF. */
            if (httpResponseData->state & HttpResponseData<SSL>::HTTP_NODE_HAS_RESPONSE_TRAILERS) [[unlikely]] {
                /* Only a node:http compat connection can set the flag, so the
                 * downcast to the bigger IsNodeHttp=true block is safe.
                 * (HttpResponse<SSL> is not templated on IsNodeHttp - it is the
                 * type the C API casts to from a runtime `int ssl` - so this
                 * one shared read stays a runtime bit test.) */
                auto *nodeHttpResponseData = (HttpResponseData<SSL, true> *) httpResponseData;
                /* Emit the terminating chunk, the trailer section and the final CRLF as
                 * ONE write: when the response is not corked (cork slots are contended
                 * under high connection counts), separate writes become separate tiny
                 * TCP segments on the tail of every response. The buffer is about to be
                 * cleared anyway, so build the frame in place. */
                std::string &trailers = nodeHttpResponseData->nodeHttpResponseTrailers;
                trailers.insert(0, "0\r\n", 3);
                trailers.append("\r\n", 2);
                Super::write(trailers.data(), trailers.length());
                trailers.clear();
                httpResponseData->state &= ~HttpResponseData<SSL>::HTTP_NODE_HAS_RESPONSE_TRAILERS;
            } else if (!terminated) {
                Super::write("0\r\n\r\n", 5);
            }
            httpResponseData->markDone(this);

            /* We need to check if we should close this socket here now */
            if (uncorkCompletedResponse()) {
                if (closeIfDoneAndMarked(httpResponseData)) {
                    return true;
                }
            }

            /* tryEnd can never fail when in chunked mode, since we do not have tryWrite (yet), only write */
            this->resetTimeout();
            return true;
        } else {
            if ((httpResponseData->state & HttpResponseData<SSL>::HTTP_BODY_MASK) == HttpResponseData<SSL>::HTTP_BODY_NONE) {
                data = {};
                totalSize = 0;
            }

            httpResponseData->state |= HttpResponseData<SSL>::HTTP_END_CALLED;

            /* tryEnd() stops at a short write and end() buffers the rest. Skip the call when there's no data,
             * because write(src, 0) would retry flushing the backpressure buffer. */
            auto [written, failed] = data.empty() ? std::pair<size_t, bool>{0, false} : Super::write(data.data(), data.length(), optional);
            ASSERT(optional || written == data.length());

            httpResponseData->offset += written;

            /* Success is when we wrote the entire thing without any failures */
            bool success = written == data.length() && !failed;
            /* Reset the timeout on each tryEnd */
            this->resetTimeout();

            /* Remove onAborted function if we reach the end */
            if (httpResponseData->offset == totalSize) {
                httpResponseData->markDone(this);

                /* We need to check if we should close this socket here now */
                if (uncorkCompletedResponse()) {
                    closeIfDoneAndMarked(httpResponseData);
                }
            }

            return success;
        }
    }

    /* Manually upgrade to WebSocket. Typically called in upgrade handler. Immediately calls open handler.
     * NOTE: Will invalidate 'this' as socket might change location in memory. Throw away after use.
     * Returns nullptr and leaves userData untouched if the socket is closed or shut down. Nothing was written in
     * that case, unless the 101 overflowed the cork buffer and that write is what closed the socket. */
    template <typename UserData>
    us_socket_t *upgrade(UserData&& userData, std::string_view secWebSocketKey, std::string_view secWebSocketProtocol,
            std::string_view secWebSocketExtensions,
            WebSocketContext<SSL, true, UserData> *webSocketContext) {

        /* Check up front: us_socket_adopt() rejects these sockets, but by then HttpResponseData is already destructed */
        if (us_socket_is_closed((us_socket_t *) this) || us_socket_is_shut_down((us_socket_t *) this)) {
            return nullptr;
        }

        /* Cork so the 101 and anything the open handler sends are flushed in one write */
        Super::cork();

        /* Extract needed parameters from WebSocketContextData */
        WebSocketContextData<SSL, UserData> *webSocketContextData = webSocketContext->getExt();

        char secWebSocketAccept[29] = {};
        char secWebSocketKeyBuffer[24] = {};
        secWebSocketKey.copy(secWebSocketKeyBuffer, 24);
        WebSocketHandshake::generate(secWebSocketKeyBuffer, secWebSocketAccept);

        writeStatus("101 Switching Protocols")
            ->writeHeader("Upgrade", "websocket")
            ->writeHeader("Connection", "Upgrade")
            ->writeHeader("Sec-WebSocket-Accept", secWebSocketAccept);

        /* Select first subprotocol if present */
        if (secWebSocketProtocol.length()) {
            writeHeader("Sec-WebSocket-Protocol", secWebSocketProtocol.substr(0, secWebSocketProtocol.find(',')));
        }

        /* Negotiate compression */
        bool perMessageDeflate = false;
        CompressOptions compressOptions = CompressOptions::DISABLED;
        if (secWebSocketExtensions.length() && webSocketContextData->compression != DISABLED) {

            /* Make sure to map SHARED_DECOMPRESSOR to windowBits = 0, not 1  */
            int wantedInflationWindow = 0;
            if ((webSocketContextData->compression & CompressOptions::_DECOMPRESSOR_MASK) != CompressOptions::SHARED_DECOMPRESSOR) {
                wantedInflationWindow = (webSocketContextData->compression & CompressOptions::_DECOMPRESSOR_MASK) >> 8;
            }

            /* Map from selected compressor (this automatically maps SHARED_COMPRESSOR to windowBits 0, not 1) */
            int wantedCompressionWindow = (webSocketContextData->compression & CompressOptions::_COMPRESSOR_MASK) >> 4;

            auto [negCompression, negCompressionWindow, negInflationWindow, negResponse] =
            negotiateCompression(true, wantedCompressionWindow, wantedInflationWindow,
                                        secWebSocketExtensions);

            if (negCompression) {
                perMessageDeflate = true;

                /* A negotiated window of 0 means no context takeover */
                compressOptions = compressOptionsFor({
                    .serverMaxWindowBits = negCompressionWindow ? negCompressionWindow : 15,
                    .clientMaxWindowBits = negInflationWindow ? negInflationWindow : 15,
                    .serverNoContextTakeover = !negCompressionWindow,
                    .clientNoContextTakeover = !negInflationWindow,
                });

                /* If we are dedicated and have the 3kb then correct any 4kb to 3kb,
                 * (they both share the windowBits = 9) */
                if (negCompressionWindow && (webSocketContextData->compression & CompressOptions::_COMPRESSOR_MASK) == CompressOptions::DEDICATED_COMPRESSOR_3KB) {
                    compressOptions = CompressOptions((compressOptions & ~CompressOptions::_COMPRESSOR_MASK) | CompressOptions::DEDICATED_COMPRESSOR_3KB);
                }

                writeHeader("Sec-WebSocket-Extensions", negResponse);
            }
        }

        terminateHeaders(NO_BODY);

        return adoptWebSocket(std::forward<UserData>(userData), perMessageDeflate, compressOptions, webSocketContext);
    }

    /* What an HTTP connection leaves to the next owner of its socket. */
    struct Leftovers {
        /* Bytes that were accepted for sending and that the kernel hasn't taken. */
        BackPressure backpressure;
        /* Bytes that were received behind the last request and not parsed. */
        WTF::Vector<char> parkedBytes;
        size_t parkedBytesStart;
        uint64_t bytesRead;
        /* us_socket_adopt() keeps the pause, and every reason for it belonged to the HTTP connection. */
        bool readsPaused;
    };

    /* Ends the socket's time as an HTTP connection and destructs its HttpResponseData. The caller gives the ext its next owner at once. */
    Leftovers leaveHttp() {
        /* Not internalEnd(): Connection: close, HTTP/1.0 and close-when-idle describe the HTTP connection, not the socket's next owner. */
        auto* responseData = getHttpResponseData();

        /* Take the parked bytes before markDone() requests a replay. */
        WTF::Vector<char> parkedBytes = std::exchange(responseData->parkedRequestBytes, {});
        size_t parkedBytesStart = std::exchange(responseData->parkedRequestBytesStart, 0);
        const bool readsPaused = responseData->readPauseReasons != 0;

        responseData->state |= HttpResponseData<SSL>::HTTP_END_CALLED;
        responseData->markDone(this);

        Leftovers left = {
            .backpressure = std::move(((AsyncSocketData<SSL> *) responseData)->buffer),
            .parkedBytes = std::move(parkedBytes),
            .parkedBytesStart = parkedBytesStart,
            .bytesRead = 0,
            .readsPaused = readsPaused,
        };

        HttpContext<SSL> *httpContext = HttpContext<SSL>::fromSocket((struct us_socket_t *) this);

        /* The socket is leaving this context, so its onClose never runs. */
        reportGone();

        /* Destroy HttpResponseData (the IsNodeHttp=true type on node:http
         * compat contexts; upgrade() is not on a templated handler path, so it
         * selects at runtime like socketExtSize()). */
        if (httpContext->isNodeHttp()) {
            left.bytesRead = ((HttpResponseData<SSL, true> *) responseData)->bytesRead;
            ((HttpResponseData<SSL, true> *) responseData)->~HttpResponseData();
        } else {
            responseData->~HttpResponseData();
        }
        return left;
    }

private:
    /* Moves the socket into webSocketContext. It must be corked, with the 101 already written. */
    template <typename UserData>
    us_socket_t *adoptWebSocket(UserData&& userData, bool perMessageDeflate, CompressOptions compressOptions,
            WebSocketContext<SSL, true, UserData> *webSocketContext) {

        /* If TLS rejected the 101 write, the socket is closed or shut down by now. It stays an HTTP socket, and the next writable event closes it. */
        if (us_socket_is_closed((us_socket_t *) this) || us_socket_is_shut_down((us_socket_t *) this)) {
            return nullptr;
        }

        WebSocketContextData<SSL, UserData> *webSocketContextData = webSocketContext->getExt();
        HttpContextData<SSL> *httpContextData = HttpContext<SSL>::fromSocket((struct us_socket_t *) this)->getSocketContextData();

        /* The cork stays, so the handshake batches with the first frames written from open(). */
        Leftovers left = leaveHttp();

        /* Before we adopt and potentially change socket, check which cork slot
         * we occupy so we can transfer it to the new WebSocket. */
        LoopData *loopData = Super::getLoopData();
        int corkedSlot = loopData->findCorkSlot(this);

        /* Read before the adoption below, which can move this socket. An upgrade of another connection must leave the parsed socket alone. */
        const bool upgradingParsedSocket = httpContextData->isParsing((us_socket_t *) this);

        /* Adopting a socket invalidates it, do not rely on it directly to carry any data */
        /* The old ext size is only used as an upper bound to keep the block in
         * place (and as the copy length when it cannot be). The base size is
         * always correct here: a node:http compat socket's block is bigger, so
         * under-stating it is an in-bounds under-copy of an already-destructed
         * ext, while over-stating it for a Bun.serve socket would read out of
         * bounds. */
        us_socket_t *usSocket = us_socket_adopt((us_socket_t *) this, webSocketContext->getSocketGroup(),
            WebSocketContext<SSL, true, UserData>::socketKind(),
            sizeof(HttpResponseData<SSL>), sizeof(WebSocketData) + sizeof(UserData));
        WebSocket<SSL, true, UserData> *webSocket = (WebSocket<SSL, true, UserData> *) usSocket;

        /* For whatever reason we were corked, update cork to the new socket */
        if (corkedSlot != LoopData::INVALID_CORK_SLOT) {
            loopData->transferCorkSlot(corkedSlot, webSocket, SSL);
        }

        /* Initialize websocket with any moved backpressure intact */
        webSocket->init(perMessageDeflate, compressOptions, std::move(left.backpressure), nullptr, nullptr);

        /* We should only mark this if inside the parser; if upgrading "async" we cannot set this */
        if (upgradingParsedSocket) {
            /* We need to tell the Http parser that we changed socket */
            httpContextData->upgradedWebSocket = webSocket;
        }

        /* Arm idleTimeout */
        us_socket_timeout((us_socket_t *) webSocket, webSocketContextData->idleTimeoutComponents.first);

        /* Move construct the UserData right before calling open handler */
        new (webSocket->getUserData()) UserData(std::forward<UserData>(userData));

        /* Emit open event and start the timeout */
        if (webSocketContextData->openHandler) {
            webSocketContextData->openHandler(webSocket);
        }

        if (left.readsPaused) [[unlikely]] {
            /* Resuming can close the socket, which is an ordinary WebSocket close by now. */
            us_socket_resume(usSocket);
        }

        /* Frames from a client that didn't wait for the 101 (RFC 6455 4.1). */
        if (!left.parkedBytes.isEmpty()) [[unlikely]] {
            if (!us_socket_is_closed(usSocket) && !us_socket_is_shut_down(usSocket)) {
                /* The frame parser writes on both sides of its input, like it can in the loop's padded receive buffer. */
                size_t length = left.parkedBytes.size() - left.parkedBytesStart;
                WTF::Vector<char> padded;
                padded.grow(LIBUS_RECV_BUFFER_PADDING + length + LIBUS_RECV_BUFFER_PADDING);
                char *frames = padded.mutableSpan().data() + LIBUS_RECV_BUFFER_PADDING;
                memcpy(frames, left.parkedBytes.span().data() + left.parkedBytesStart, length);
                us_dispatch_data(usSocket, frames, (int) length);
            }
        }

        /* Uncork here. An enclosing HttpResponse::cork() can't uncork a WebSocket, and after an await there isn't one. */
        ((AsyncSocket<SSL> *) webSocket)->uncork();

        return usSocket;
    }

public:
    /* Immediately terminate this Http response */
    using Super::close;

    /* See AsyncSocket */
    using Super::getRemoteAddress;
    using Super::getNativeHandle;

    /* Stops reading for a READ_PAUSE_* reason. The idle timeout keeps running, because a blocked response write has nothing else to end it. */
    void pauseReads(uint8_t reason) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();
        /* The other reasons hold back the parsing of more HTTP, and none is left. */
        if (reason != HttpResponseData<SSL>::READ_PAUSE_SOCKET && httpResponseData->isParserDetached()) {
            return;
        }
        if (!httpResponseData->readPauseReasons) {
            Super::pause();
        }
        httpResponseData->readPauseReasons |= reason;
    }

    /* Reads start again once the last reason is gone. */
    void resumeReads(uint8_t reason) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();
        if (!(httpResponseData->readPauseReasons & reason)) {
            return;
        }
        httpResponseData->readPauseReasons &= ~reason;
        if (httpResponseData->readPauseReasons) {
            return;
        }
        Super::resume();
        this->resetTimeout();
        setParked(false);
    }

    /* node:http: unsent response bytes and queued responses hold the reads. */
    void endFloodPauseIfDrained() {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();
        if (Super::getBufferedAmount() == 0 && httpResponseData->nodeHttpQueuedPipelinedCount == 0) {
            resumeReads(HttpResponseData<SSL>::READ_PAUSE_FLOOD);
        }
    }

    /* Note: Headers are not checked in regards to timeout.
     * We only check when you actively push data or end the request */

    /* Write 100 Continue, can be done any amount of times */
    HttpResponse *writeContinue() {
        Super::write("HTTP/1.1 100 Continue\r\n\r\n", 25);
        return this;
    }

    /* Write a caller-built 1xx informational response line + headers. Shares
     * the AsyncSocket write path (and buffer) writeStatus/end use, so a
     * pipelined replay stays ordered ahead of the final response bytes. */
    HttpResponse *writeRawInformational(std::string_view data) {
        Super::write(data.data(), data.length());
        return this;
    }

    /* Write the HTTP status */
    HttpResponse *writeStatus(std::string_view status) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        /* Do not allow writing more than one status */
        if (httpResponseData->state & HttpResponseData<SSL>::HTTP_STATUS_CALLED) {
            return this;
        }

        /* RFC 9110 8.6: a 1xx or 204 has no body and MUST NOT carry Content-Length. A 304 MAY carry one, so its caller decides. */
        if (status.length() >= 3 && (status.length() == 3 || status[3] == ' ')
            && (status[0] == '1' || (status[0] == '2' && status[1] == '0' && status[2] == '4'))) {
            setFraming(HttpResponseData<SSL>::HTTP_BODY_NONE);
        }

        /* Update status */
        httpResponseData->state |= HttpResponseData<SSL>::HTTP_STATUS_CALLED;

        if (char *line = Super::reserveCorked(status.length() + 11)) [[likely]] {
            memcpy(line, "HTTP/1.1 ", 9);
            memcpy(line + 9, status.data(), status.length());
            memcpy(line + 9 + status.length(), "\r\n", 2);
            return this;
        }
        Super::write("HTTP/1.1 ", 9);
        Super::write(status.data(), status.length());
        Super::write("\r\n", 2);
        return this;
    }

    /* Write an HTTP header with string value */
    HttpResponse *writeHeader(std::string_view key, std::string_view value) {
        using Data = HttpResponseData<SSL>;
        writeStatus(HTTP_200_OK);

        Data *httpResponseData = getHttpResponseData();
        switch (classifyResponseField(key, value)) {
        case ResponseField::Date:
            httpResponseData->state |= Data::HTTP_WROTE_DATE_HEADER;
            break;
        case ResponseField::Connection:
            /* node:http sets the bit before its headers: its JavaScript decides when the connection closes. */
            if (!(httpResponseData->state & Data::HTTP_WROTE_CONNECTION_HEADER)) {
                httpResponseData->state |= Data::HTTP_WROTE_CONNECTION_HEADER | (fieldValueHasToken(value, "close") ? Data::HTTP_CONNECTION_CLOSE : 0);
            }
            break;
        case ResponseField::ContentLength:
        case ResponseField::TransferEncoding:
            /* Bun.serve frames the body it sends, whatever the handler's headers say. node:http frames by them, like Node. */
            if (!HttpContext<SSL>::fromSocket((us_socket_t *) this)->isNodeHttp()) {
                return this;
            }
            httpResponseData->state |= key.length() == 14 ? Data::HTTP_WROTE_CONTENT_LENGTH_HEADER : Data::HTTP_WROTE_TRANSFER_ENCODING_HEADER;
            break;
        default:
            break;
        }

        writeHeaderLine(key, value);
        return this;
    }

    /* Write an HTTP header with unsigned int value. As Content-Length it declares the length of the body, which then goes out as it is. */
    HttpResponse *writeHeader(std::string_view key, uint64_t value) {
        writeStatus(HTTP_200_OK);

        if (key.length() == 14 && asciiIEquals(key, "content-length")) {
            HttpResponseData<SSL> *httpResponseData = getHttpResponseData();
            /* A 1xx or 204 must not carry one (RFC 9110 8.6). */
            if ((httpResponseData->state & HttpResponseData<SSL>::HTTP_BODY_MASK) == HttpResponseData<SSL>::HTTP_BODY_NONE) {
                return this;
            }
            httpResponseData->state |= HttpResponseData<SSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER;
        }

        char digits[utils::U64_MAX_DIGITS];
        writeHeaderLine(key, {digits, (size_t) utils::u64toa(value, digits)});
        return this;
    }

    /* End the response with an optional data chunk. Always starts a timeout. */
    void end(std::string_view data = {}, bool closeConnection = false) {
        internalEnd(data, data.length(), false, closeConnection);
    }

    /* Ends a response that sends no body bytes. `bodyLength` is NO_BODY, or what the GET for this HEAD would have passed to terminateHeaders(). */
    void endWithoutBody(uint64_t bodyLength, bool closeConnection) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();
        if (closeConnection) {
            httpResponseData->state |= HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE;
        }
        if (isHeaderSectionOpen()) {
            terminateHeaders(bodyLength);
        }
        httpResponseData->state |= HttpResponseData<SSL>::HTTP_END_CALLED;
        httpResponseData->markDone(this);
        this->resetTimeout();
    }

    /* For a handler that can read the request body: maxRequestBodySize holds from here on. Returns false, with the request answered, if its Content-Length is already over it. */
    bool acceptRequestBody() {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();
        if (httpResponseData->state & HttpResponseData<SSL>::HTTP_REQUEST_BODY_TOO_LARGE) [[unlikely]] {
            writeStatus("413 Request Entity Too Large");
            endWithoutBody(NO_BODY, true);
            return false;
        }
        httpResponseData->requestBodyBudget = HttpContext<SSL>::getSocketContextDataS((us_socket_t *) this)->maxRequestBodySize;
        return true;
    }

    /* The body outgrew maxRequestBodySize. The handler lets go in onAborted, where it finds HTTP_REQUEST_BODY_TOO_LARGE set. */
    void refuseRequestBody() {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();
        httpResponseData->state |= HttpResponseData<SSL>::HTTP_REQUEST_BODY_TOO_LARGE;
        httpResponseData->inStream = nullptr;
        if (auto onAborted = std::exchange(httpResponseData->onAborted, nullptr)) {
            onAborted(this, httpResponseData->userData);
        }
        if (us_socket_is_closed((us_socket_t *) this)) {
            return;
        }
        if (httpResponseData->state & HttpResponseData<SSL>::HTTP_STATUS_CALLED) {
            /* Never the terminating chunk: it would make a truncated body look complete. */
            us_socket_close((us_socket_t *) this, LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET, nullptr);
            return;
        }
        writeStatus("413 Payload Too Large");
        endWithoutBody(NO_BODY, true);
    }

    /* Try and end the response. Returns [true, true] on success.
     * Starts a timeout in some cases. Returns [ok, hasResponded] */
    std::pair<bool, bool> tryEnd(std::string_view data, uintmax_t totalSize = 0, bool closeConnection = false) {
        bool ok = internalEnd(data, totalSize, true, closeConnection);
        /* internalEnd's close gate may have closed the socket (destructing the
         * ext hasResponded() reads); that only happens once the response has
         * completed, so report responded without touching it. */
        if (us_socket_is_closed((us_socket_t *) this)) {
            return {ok, true};
        }
        return {ok, hasResponded()};
    }

    /* Ends a body that was streamed with write(). */
    bool sendTerminatingChunk(bool closeConnection = false) {
        markCloseConnection(closeConnection);
        startBody();
        return internalEnd({nullptr, 0}, 0, false, closeConnection);
    }

    /* Ends the header section ahead of a body of unknown length, if it's still open. */
    void startBody() {
        if (isHeaderSectionOpen()) {
            terminateHeaders(UNKNOWN_LENGTH);
            getHttpResponseData()->state |= HttpResponseData<SSL>::HTTP_WRITE_CALLED;
        }
    }

    void flushHeaders(bool flushImmediately = false) {
        startBody();
        if (flushImmediately) {
            /* Uncork the socket to send data to the client immediately */
            this->uncork();
        }
    }
    /* Write parts of the response in chunking fashion. Starts timeout if failed. */
    /* isLast: the terminating chunk of a chunked body goes out with this one. */
    bool write(std::string_view data, size_t *writtenPtr = nullptr, bool isLast = false) {
        writeStatus(HTTP_200_OK);

        /* Do not allow sending 0 chunks, they mark end of response */
        if (data.empty()) {
            if (writtenPtr) {
                *writtenPtr = 0;
            }
            /* If you called us, then according to you it was fine to call us so it's fine to still call us */
            return true;
        }

        size_t length = data.length();

        // Special handling for extremely large data (greater than UINT_MAX bytes)
        // most clients expect a max of UINT_MAX, so we need to split the write into multiple writes
        if (length > UINT_MAX) {
            bool has_failed = false;
            size_t total_written = 0;
            // Process full-sized chunks until remaining data is less than UINT_MAX
            while (length > UINT_MAX) {
                size_t written = 0;
                // Write a UINT_MAX-sized chunk and check for failure
                // even after failure we continue writing because the data will be buffered
                if(!this->write(data.substr(0, UINT_MAX), &written)) {
                    has_failed = true;
                }
                total_written += written;
                length -= UINT_MAX;
                data = data.substr(UINT_MAX);
            }
            // Handle the final chunk (less than UINT_MAX bytes)
            if (length > 0) {
                size_t written = 0;
                if(!this->write(data, &written, isLast)) {
                    has_failed = true;
                }
                total_written += written;
            }
            if (writtenPtr) {
                *writtenPtr = total_written;
            }
            return !has_failed;
        }


        char chunkHeadBuffer[CHUNK_HEAD_MAX];
        size_t chunkHeadLength = 0;
        std::string_view chunkTail;

        startBody();
        if (isChunked()) {
            chunkHeadLength = chunkHead(chunkHeadBuffer, (unsigned int) data.length());
            chunkTail = isLast ? "\r\n0\r\n\r\n" : "\r\n";
        }
        auto [written, failed] = Super::writeFramed({chunkHeadBuffer, chunkHeadLength}, data.data(), length, chunkTail);

        /* Reset timeout on each sended chunk */
        this->resetTimeout();

        if (writtenPtr) {
            *writtenPtr = written;
        }
        /* If we did not fail the write, accept more */
        return !failed;
    }

    /* Like write(), but the body payload is written with optionally=true so the
     * unwritten tail is NOT copied into the backpressure buffer. The caller keeps
     * the bytes alive and retries the remainder on onWritable. Framing (chunk-size
     * line, trailing CRLF) is still written non-optionally.
     * isFirst=false skips framing and is used for continuation writes.
     * Returns the number of body bytes accepted. */
    size_t tryWriteBody(std::string_view data, bool isFirst) {
        char chunkHeadBuffer[CHUNK_HEAD_MAX];
        size_t chunkHeadLength = 0;

        if (isFirst) {
            startBody();
        }
        const bool chunked = isChunked();
        if (isFirst && chunked) {
            chunkHeadLength = chunkHead(chunkHeadBuffer, (unsigned int) data.length());
        }

        size_t consumed = Super::writeFramed({chunkHeadBuffer, chunkHeadLength}, data.data(), data.length(), chunked ? "\r\n" : "", true).first;
        this->resetTimeout();
        return consumed;
    }

    /* Copy the remaining body tail into the backpressure buffer (non-optional),
     * then the trailing chunk CRLF. Used when a new write arrives while a
     * tryWriteBody() tail is still held externally. */
    void spillBodyTail(std::string_view data) {
        if (!data.empty()) {
            Super::write(data.data(), data.length());
        }
        if (isChunked()) {
            Super::write("\r\n", 2);
        }
    }

    /* Checking if we have fully responded and are ready for another request */
    bool hasResponded() {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        return !(httpResponseData->state & HttpResponseData<SSL>::HTTP_RESPONSE_PENDING);
    }

     /* Corks the response if possible. Leaves already corked socket be. */
    HttpResponse *cork(MoveOnlyFunction<void()> &&handler) {
        if (!Super::isCorked()) {
            LoopData *loopData = Super::getLoopData();
            Super::cork();
            handler();

            /* If we're no longer in a cork slot, either: (a) the handler wrote
             * large data that triggered an internal uncork, (b) our empty slot
             * was stolen by another request during an await, or (c) we were
             * upgraded to a WebSocket (upgrade() uncorked it). In all cases
             * our data (if any) was already flushed; nothing to do. After an
             * upgrade HttpResponseData is already destructed, so don't read it. */
            if (loopData->findCorkSlot(this) == LoopData::INVALID_CORK_SLOT) {
                return this;
            }

            /* Timeout on uncork failure, since most writes will succeed while corked */
            auto [written, failed] = Super::uncork();

            if (written > 0 || failed) {
                /* For now we only have one single timeout so let's use it */
                /* This behavior should equal the behavior in HttpContext when uncorking fails */
                this->resetTimeout();
            }

            closeIfDoneAndMarked(getHttpResponseData());
        } else {
            /* We are already corked, or can't cork so let's just call the handler */
            handler();
        }

        return this;
    }

    /* Attach handler for writable HTTP response */
    HttpResponse *onWritable(void* userData, HttpResponseData<SSL>::OnWritableCallback handler) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        httpResponseData->writableUserData = userData;
        httpResponseData->onWritable = handler;
        return this;
    }

    /* Remove handler for writable HTTP response */
    HttpResponse *clearOnWritable() {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        httpResponseData->onWritable = nullptr;
        httpResponseData->writableUserData = nullptr;
        return this;
    }

    /* Attach handler for aborted HTTP request */
    HttpResponse *onAborted(void* userData,  HttpResponseData<SSL>::OnAbortedCallback handler) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        httpResponseData->userData = userData;
        httpResponseData->onAborted = handler;
        return this;
    }

    HttpResponse *onTimeout(void* userData,  HttpResponseData<SSL>::OnTimeoutCallback handler) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        httpResponseData->userData = userData;
        httpResponseData->onTimeout = handler;
        return this;
    }

    HttpResponse* clearOnWritableAndAborted() {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        httpResponseData->onWritable = nullptr;
        httpResponseData->writableUserData = nullptr;
        httpResponseData->onAborted = nullptr;
        httpResponseData->onTimeout = nullptr;

        return this;
    }

    HttpResponse* clearOnAborted() {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        httpResponseData->onAborted = nullptr;
        return this;
    }

    HttpResponse* clearOnTimeout() {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        httpResponseData->onTimeout = nullptr;
        return this;
    }

    /* Remove the handlers that were attached with this user data. A handler that another owner attached since stays. */
    void clearHandlersOf(void* userData) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        if (httpResponseData->writableUserData == userData) {
            httpResponseData->onWritable = nullptr;
            httpResponseData->writableUserData = nullptr;
        }
        if (httpResponseData->userData == userData) {
            httpResponseData->onAborted = nullptr;
            httpResponseData->onTimeout = nullptr;
            httpResponseData->inStream = nullptr;
            httpResponseData->userData = nullptr;
        }
    }
    /* Attach a read handler for data sent. Will be called with FIN set true if last segment. */
    void onData(void* userData, HttpResponseData<SSL>::OnDataCallback handler) {
        HttpResponseData<SSL> *data = getHttpResponseData();
        data->userData = userData;
        data->inStream = handler;

        /* Always reset this counter here */
        data->received_bytes_per_timeout = 0;
    }

};

}

#endif // UWS_HTTPRESPONSE_H