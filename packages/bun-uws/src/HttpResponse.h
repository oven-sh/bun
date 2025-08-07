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

/* Some pre-defined status constants to use with writeStatus */
static const char *HTTP_200_OK = "200 OK";

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

        Super::timeout(data->idleTimeout);
    }
    /* Write an unsigned 32-bit integer in hex */
    void writeUnsignedHex(unsigned int value) {
        char buf[10];
        int length = utils::u32toaHex(value, buf);

        /* For now we do this copy */
        Super::write(buf, length);
    }

    /* Write an unsigned 64-bit integer */
    void writeUnsigned64(uint64_t value) {
        char buf[20];
        int length = utils::u64toa(value, buf);

        /* For now we do this copy */
        Super::write(buf, length);
    }

    /* Called only once per request */
    void writeMark() {
        if (getHttpResponseData()->state & HttpResponseData<SSL>::HTTP_WROTE_DATE_HEADER) {
            return;
        }
        /* Date is always written */
        writeHeader("Date", std::string_view(((LoopData *) us_loop_ext(us_socket_context_loop(SSL, (us_socket_context(SSL, (us_socket_t *) this)))))->date, 29));
        getHttpResponseData()->state |= HttpResponseData<SSL>::HTTP_WROTE_DATE_HEADER;
    }

    /* Returns true on success, indicating that it might be feasible to write more data.
     * Will start timeout if stream reaches totalSize or write failure. */
    bool internalEnd(std::string_view data, uint64_t totalSize, bool optional, bool allowContentLength = true, bool closeConnection = false) {
        /* Write status if not already done */
        writeStatus(HTTP_200_OK);

        /* If no total size given then assume this chunk is everything */
        if (!totalSize) {
            totalSize = data.length();
        }

        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        /* In some cases, such as when refusing huge data we want to close the connection when drained */
        if (closeConnection) {
            /* We can only write the header once */
            if (!(httpResponseData->state & (HttpResponseData<SSL>::HTTP_END_CALLED))) {

                /* HTTP 1.1 must send this back unless the client already sent it to us.
                * It is a connection close when either of the two parties say so but the
                * one party must tell the other one so.
                *
                * This check also serves to limit writing the header only once. */
                if ((httpResponseData->state & HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE) == 0 && !(httpResponseData->state & (HttpResponseData<SSL>::HTTP_WRITE_CALLED))) {
                    writeHeader("Connection", "close");
                }

                httpResponseData->state |= HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE;
            }
        }

        /* if write was called and there was previously no Content-Length header set */
        if (httpResponseData->state & HttpResponseData<SSL>::HTTP_WRITE_CALLED && !(httpResponseData->state & HttpResponseData<SSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER) && !httpResponseData->fromAncientRequest) {

            /* We do not have tryWrite-like functionalities, so ignore optional in this path */


            /* Write the chunked data if there is any (this will not send zero chunks) */
            this->write(data, nullptr);


            /* Terminating 0 chunk */
            Super::write("0\r\n\r\n", 5);
            httpResponseData->markDone();

            /* We need to check if we should close this socket here now */
            if (!Super::isCorked()) {
                if (httpResponseData->state & HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE) {
                    if ((httpResponseData->state & HttpResponseData<SSL>::HTTP_RESPONSE_PENDING) == 0) {
                        if (((AsyncSocket<SSL> *) this)->getBufferedAmount() == 0) {
                            ((AsyncSocket<SSL> *) this)->shutdown();
                            /* We need to force close after sending FIN since we want to hinder
                                * clients from keeping to send their huge data */
                            ((AsyncSocket<SSL> *) this)->close();
                            return true;
                        }
                    }
                }
            } else {
                this->uncork();
            }

            /* tryEnd can never fail when in chunked mode, since we do not have tryWrite (yet), only write */
            this->resetTimeout();
            return true;
        } else {
            /* Write content-length on first call */
            if (!(httpResponseData->state & (HttpResponseData<SSL>::HTTP_END_CALLED))) {
                /* Write mark, this propagates to WebSockets too */
                writeMark();

                /* WebSocket upgrades does not allow content-length */
                if (allowContentLength) {
                    /* Even zero is a valid content-length */
                    Super::write("Content-Length: ", 16);
                    writeUnsigned64(totalSize);
                    Super::write("\r\n\r\n", 4);
                    httpResponseData->state |= HttpResponseData<SSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER;
                } else if (!(httpResponseData->state & (HttpResponseData<SSL>::HTTP_WRITE_CALLED))) {
                    Super::write("\r\n", 2);
                }

                /* Mark end called */
                httpResponseData->state |= HttpResponseData<SSL>::HTTP_END_CALLED;
            }

            /* Even if we supply no new data to write, its failed boolean is useful to know
             * if it failed to drain any prior failed header writes */

            /* Write as much as possible without causing backpressure */
            size_t written = 0;
            bool failed = false;
            while (written < data.length() && !failed) {
                /* uSockets only deals with int sizes, so pass chunks of max signed int size */
                auto writtenFailed = Super::write(data.data() + written, (int) std::min<size_t>(data.length() - written, INT_MAX), optional);

                written += (size_t) writtenFailed.first;
                failed = writtenFailed.second;
            }

            httpResponseData->offset += written;

            /* Success is when we wrote the entire thing without any failures */
            bool success = written == data.length() && !failed;
            /* Reset the timeout on each tryEnd */
            this->resetTimeout();

            /* Remove onAborted function if we reach the end */
            if (httpResponseData->offset == totalSize) {
                httpResponseData->markDone();

                /* We need to check if we should close this socket here now */
                if (!Super::isCorked()) {
                    if (httpResponseData->state & HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE) {
                        if ((httpResponseData->state & HttpResponseData<SSL>::HTTP_RESPONSE_PENDING) == 0) {
                            if (((AsyncSocket<SSL> *) this)->getBufferedAmount() == 0) {
                                ((AsyncSocket<SSL> *) this)->shutdown();
                                /* We need to force close after sending FIN since we want to hinder
                                * clients from keeping to send their huge data */
                                ((AsyncSocket<SSL> *) this)->close();
                            }
                        }
                    }
                }  else {
                    this->uncork();
                }
            }

            return success;
        }
    }

public:
    /* If we have proxy support; returns the proxed source address as reported by the proxy. */
#ifdef UWS_WITH_PROXY
    std::string_view getProxiedRemoteAddress() {
        return getHttpResponseData()->proxyParser.getSourceAddress();
    }

    std::string_view getProxiedRemoteAddressAsText() {
        return Super::addressAsText(getProxiedRemoteAddress());
    }


#endif

    /* Manually upgrade to WebSocket. Typically called in upgrade handler. Immediately calls open handler.
     * NOTE: Will invalidate 'this' as socket might change location in memory. Throw away after use. */
    template <typename UserData>
    us_socket_t *upgrade(UserData &&userData, std::string_view secWebSocketKey, std::string_view secWebSocketProtocol,
            std::string_view secWebSocketExtensions,
            struct us_socket_context_t *webSocketContext) {

        /* Extract needed parameters from WebSocketContextData */
        WebSocketContextData<SSL, UserData> *webSocketContextData = (WebSocketContextData<SSL, UserData> *) us_socket_context_ext(SSL, webSocketContext);

        /* Note: OpenSSL can be used here to speed this up somewhat */
        char secWebSocketAccept[29] = {};
        WebSocketHandshake::generate(secWebSocketKey.data(), secWebSocketAccept);

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

                /* Map from negotiated windowBits to compressor and decompressor */
                if (negCompressionWindow == 0) {
                    compressOptions = CompressOptions::SHARED_COMPRESSOR;
                } else {
                    compressOptions = (CompressOptions) ((uint32_t) (negCompressionWindow << 4)
                                                        | (uint32_t) (negCompressionWindow - 7));

                    /* If we are dedicated and have the 3kb then correct any 4kb to 3kb,
                     * (they both share the windowBits = 9) */
                    if (webSocketContextData->compression & DEDICATED_COMPRESSOR_3KB) {
                        compressOptions = DEDICATED_COMPRESSOR_3KB;
                    }
                }

                /* Here we modify the above compression with negotiated decompressor */
                if (negInflationWindow == 0) {
                    compressOptions = CompressOptions(compressOptions | CompressOptions::SHARED_DECOMPRESSOR);
                } else {
                    compressOptions = CompressOptions(compressOptions | (negInflationWindow << 8));
                }

                writeHeader("Sec-WebSocket-Extensions", negResponse);
            }
        }

        internalEnd({nullptr, 0}, 0, false, false);

        /* Grab the httpContext from res */
        HttpContext<SSL> *httpContext = (HttpContext<SSL> *) us_socket_context(SSL, (struct us_socket_t *) this);

        /* Move any backpressure out of HttpResponse */
        BackPressure backpressure(std::move(((AsyncSocketData<SSL> *) getHttpResponseData())->buffer));

        /* Destroy HttpResponseData */
        getHttpResponseData()->~HttpResponseData();

        /* Before we adopt and potentially change socket, check if we are corked */
        bool wasCorked = Super::isCorked();

        /* Adopting a socket invalidates it, do not rely on it directly to carry any data */
        us_socket_t *usSocket = us_socket_context_adopt_socket(SSL, (us_socket_context_t *) webSocketContext, (us_socket_t *) this, sizeof(WebSocketData) + sizeof(UserData));
        WebSocket<SSL, true, UserData> *webSocket = (WebSocket<SSL, true, UserData> *) usSocket;

        /* For whatever reason we were corked, update cork to the new socket */
        if (wasCorked) {
            webSocket->AsyncSocket<SSL>::corkUnchecked();
        }

        /* Initialize websocket with any moved backpressure intact */
        webSocket->init(perMessageDeflate, compressOptions, std::move(backpressure));

        /* We should only mark this if inside the parser; if upgrading "async" we cannot set this */
        HttpContextData<SSL> *httpContextData = httpContext->getSocketContextData();
        if (httpContextData->flags.isParsingHttp) {
            /* We need to tell the Http parser that we changed socket */
            httpContextData->upgradedWebSocket = webSocket;
        }

        /* Arm maxLifetime timeout */
        us_socket_long_timeout(SSL, (us_socket_t *) webSocket, webSocketContextData->maxLifetime);

        /* Arm idleTimeout */
        us_socket_timeout(SSL, (us_socket_t *) webSocket, webSocketContextData->idleTimeoutComponents.first);

        /* Move construct the UserData right before calling open handler */
        new (webSocket->getUserData()) UserData(std::move(userData));

        /* Emit open event and start the timeout */
        if (webSocketContextData->openHandler) {
            webSocketContextData->openHandler(webSocket);
        }

        return usSocket;
    }

    /* Immediately terminate this Http response */
    using Super::close;

    /* See AsyncSocket */
    using Super::getRemoteAddress;
    using Super::getRemoteAddressAsText;
    using Super::getNativeHandle;

    /* Throttle reads and writes */
    HttpResponse *pause() {
        Super::pause();
        Super::timeout(0);
        return this;
    }

    HttpResponse *resume() {
        Super::resume();
        this->resetTimeout();
        return this;
    }

    /* Note: Headers are not checked in regards to timeout.
     * We only check when you actively push data or end the request */

    /* Write 100 Continue, can be done any amount of times */
    HttpResponse *writeContinue() {
        Super::write("HTTP/1.1 100 Continue\r\n\r\n", 25);
        return this;
    }

    /* Write the HTTP status */
    HttpResponse *writeStatus(std::string_view status) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        /* Do not allow writing more than one status */
        if (httpResponseData->state & HttpResponseData<SSL>::HTTP_STATUS_CALLED) {
            return this;
        }

        /* Update status */
        httpResponseData->state |= HttpResponseData<SSL>::HTTP_STATUS_CALLED;

        Super::write("HTTP/1.1 ", 9);
        Super::write(status.data(), (int) status.length());
        Super::write("\r\n", 2);
        return this;
    }

    /* Write an HTTP header with string value */
    HttpResponse *writeHeader(std::string_view key, std::string_view value) {
        writeStatus(HTTP_200_OK);

        Super::write(key.data(), (int) key.length());
        Super::write(": ", 2);
        Super::write(value.data(), (int) value.length());
        Super::write("\r\n", 2);
        return this;
    }

    /* Write an HTTP header with unsigned int value */
    HttpResponse *writeHeader(std::string_view key, uint64_t value) {
        writeStatus(HTTP_200_OK);

        Super::write(key.data(), (int) key.length());
        Super::write(": ", 2);
        writeUnsigned64(value);
        Super::write("\r\n", 2);
        return this;
    }

    /* End without a body (no content-length) or end with a spoofed content-length. */
    void endWithoutBody(std::optional<size_t> reportedContentLength = std::nullopt, bool closeConnection = false) {
        if (reportedContentLength.has_value()) {
            internalEnd({nullptr, 0}, reportedContentLength.value(), false, true, closeConnection);
        } else {
            internalEnd({nullptr, 0}, 0, false, false, closeConnection);
        }
    }

    /* End the response with an optional data chunk. Always starts a timeout. */
    void end(std::string_view data = {}, bool closeConnection = false) {
        internalEnd(data, data.length(), false, !(this->getHttpResponseData()->state & HttpResponseData<SSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER), closeConnection);
    }

    /* Try and end the response. Returns [true, true] on success.
     * Starts a timeout in some cases. Returns [ok, hasResponded] */
    std::pair<bool, bool> tryEnd(std::string_view data, uintmax_t totalSize = 0, bool closeConnection = false) {
        bool ok = internalEnd(data, totalSize, true, true, closeConnection);
        return {ok, hasResponded()};
    }

    /* Write the end of chunked encoded stream */
    bool sendTerminatingChunk(bool closeConnection = false) {
        writeStatus(HTTP_200_OK);
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();
        if (!(httpResponseData->state & (HttpResponseData<SSL>::HTTP_WRITE_CALLED | HttpResponseData<SSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER))) {
            /* Write mark on first call to write */
            writeMark();

            writeHeader("Transfer-Encoding", "chunked");
            Super::write("\r\n", 2);
            httpResponseData->state |= HttpResponseData<SSL>::HTTP_WRITE_CALLED;
        }

        /* This will be sent always when state is HTTP_WRITE_CALLED inside internalEnd, so no need to write the terminating 0 chunk here */
        /* Super::write("\r\n0\r\n\r\n", 7); */

        return internalEnd({nullptr, 0}, 0, false, false, closeConnection);
    }

    void flushHeaders() {

        writeStatus(HTTP_200_OK);

        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        if (!(httpResponseData->state & HttpResponseData<SSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER) && !httpResponseData->fromAncientRequest) {
            if (!(httpResponseData->state & HttpResponseData<SSL>::HTTP_WRITE_CALLED)) {
                /* Write mark on first call to write */
                writeMark();

                writeHeader("Transfer-Encoding", "chunked");
                Super::write("\r\n", 2);
                httpResponseData->state |= HttpResponseData<SSL>::HTTP_WRITE_CALLED;
            }

         } else if (!(httpResponseData->state & HttpResponseData<SSL>::HTTP_WRITE_CALLED)) {
            writeMark();
            Super::write("\r\n", 2);
            httpResponseData->state |= HttpResponseData<SSL>::HTTP_WRITE_CALLED;
        }
    }
    /* Write parts of the response in chunking fashion. Starts timeout if failed. */
    bool write(std::string_view data, size_t *writtenPtr = nullptr) {
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
                if(!this->write(data, &written)) {
                    has_failed = true;
                }
                total_written += written;
            }
            if (writtenPtr) {
                *writtenPtr = total_written;
            }
            return !has_failed;
        }


        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        if (!(httpResponseData->state & HttpResponseData<SSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER) && !httpResponseData->fromAncientRequest) {
            if (!(httpResponseData->state & HttpResponseData<SSL>::HTTP_WRITE_CALLED)) {
                /* Write mark on first call to write */
                writeMark();

                writeHeader("Transfer-Encoding", "chunked");
                Super::write("\r\n", 2);
                httpResponseData->state |= HttpResponseData<SSL>::HTTP_WRITE_CALLED;
            }

            writeUnsignedHex((unsigned int) data.length());
            Super::write("\r\n", 2);
        } else if (!(httpResponseData->state & HttpResponseData<SSL>::HTTP_WRITE_CALLED)) {
            writeMark();
            Super::write("\r\n", 2);
            httpResponseData->state |= HttpResponseData<SSL>::HTTP_WRITE_CALLED;
        }
        size_t total_written = 0;
        bool has_failed = false;

        // Handle data larger than INT_MAX by writing it in chunks of INT_MAX bytes
        while (length > INT_MAX) {
            // Write the maximum allowed chunk size (INT_MAX)
            auto [written, failed] = Super::write(data.data(), INT_MAX);
            // If the write failed, set the has_failed flag we continue writting because the data will be buffered
            has_failed = has_failed || failed;
            total_written += written;
            length -= INT_MAX;
            data = data.substr(INT_MAX);
        }
        // Handle the remaining data (less than INT_MAX bytes)
        if (length > 0) {
            // Write the final chunk with exact remaining length
            auto [written, failed] = Super::write(data.data(), (int) length);
            has_failed = has_failed || failed;
            total_written += written;
        }

        if (!(httpResponseData->state & HttpResponseData<SSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER) && !httpResponseData->fromAncientRequest) {
            // Write End of Chunked Encoding after data has been written
            Super::write("\r\n", 2);
        }

        /* Reset timeout on each sended chunk */
        this->resetTimeout();

        if (writtenPtr) {
            *writtenPtr = total_written;
        }
        /* If we did not fail the write, accept more */
        return !has_failed;
    }

    /* Get the current byte write offset for this Http response */
    uint64_t getWriteOffset() {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        return httpResponseData->offset;
    }

    /* If you are messing around with sendfile you might want to override the offset. */
    void overrideWriteOffset(uint64_t offset) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        httpResponseData->offset = offset;
    }

    /* Checking if we have fully responded and are ready for another request */
    bool hasResponded() {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        return !(httpResponseData->state & HttpResponseData<SSL>::HTTP_RESPONSE_PENDING);
    }

     /* Corks the response if possible. Leaves already corked socket be. */
    HttpResponse *cork(MoveOnlyFunction<void()> &&handler) {
        if (!Super::isCorked() && Super::canCork()) {
            LoopData *loopData = Super::getLoopData();
            Super::cork();
            handler();

            /* The only way we could possibly have changed the corked socket during handler call, would be if
             * the HTTP socket was upgraded to WebSocket and caused a realloc. Because of this we cannot use "this"
             * from here downwards. The corking is done with corkUnchecked() in upgrade. It steals cork. */
            auto *newCorkedSocket = loopData->getCorkedSocket();

            /* If nobody is corked, it means most probably that large amounts of data has
             * been written and the cork buffer has already been sent off and uncorked.
             * We are done here, if that is the case. */
            if (!newCorkedSocket) {
                return this;
            }

            /* Timeout on uncork failure, since most writes will succeed while corked */
            auto [written, failed] = static_cast<Super *>(newCorkedSocket)->uncork();

            /* If we are no longer an HTTP socket then early return the new "this".
             * We don't want to even overwrite timeout as it is set in upgrade already. */
            if (this != newCorkedSocket) {
                return static_cast<HttpResponse *>(newCorkedSocket);
            }

            if (written > 0 || failed) {
                /* For now we only have one single timeout so let's use it */
                /* This behavior should equal the behavior in HttpContext when uncorking fails */
                this->resetTimeout();
            }

            /* If we have no backbuffer and we are connection close and we responded fully then close */
            HttpResponseData<SSL> *httpResponseData = getHttpResponseData();
            if (httpResponseData->state & HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE) {
                if ((httpResponseData->state & HttpResponseData<SSL>::HTTP_RESPONSE_PENDING) == 0) {
                    if (((AsyncSocket<SSL> *) this)->getBufferedAmount() == 0) {
                        ((AsyncSocket<SSL> *) this)->shutdown();
                        /* We need to force close after sending FIN since we want to hinder
                        * clients from keeping to send their huge data */
                        ((AsyncSocket<SSL> *) this)->close();
                    }
                }
            }
        } else {
            /* We are already corked, or can't cork so let's just call the handler */
            handler();
        }

        return this;
    }

    /* Attach handler for writable HTTP response */
    HttpResponse *onWritable(void* userData, HttpResponseData<SSL>::OnWritableCallback handler) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        httpResponseData->userData = userData;
        httpResponseData->onWritable = handler;
        return this;
    }

    /* Remove handler for writable HTTP response */
    HttpResponse *clearOnWritable() {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        httpResponseData->onWritable = nullptr;
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
    /* Attach a read handler for data sent. Will be called with FIN set true if last segment. */
    void onData(void* userData, HttpResponseData<SSL>::OnDataCallback handler) {
        HttpResponseData<SSL> *data = getHttpResponseData();
        data->userData = userData;
        data->inStream = handler;

        /* Always reset this counter here */
        data->received_bytes_per_timeout = 0;
    }

    void* getSocketData() {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        return httpResponseData->socketData;
    }

    void setWriteOffset(uint64_t offset) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        httpResponseData->offset = offset;
    }

};

}

#endif // UWS_HTTPRESPONSE_H