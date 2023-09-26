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

/* The general timeout for HTTP sockets */
static const int HTTP_TIMEOUT_S = 10;

template <bool SSL>
struct HttpResponse : public AsyncSocket<SSL> {
    /* Solely used for getHttpResponseData() */
    template <bool> friend struct TemplatedApp;
    typedef AsyncSocket<SSL> Super;
public:
    HttpResponseData<SSL> *getHttpResponseData() {
        return (HttpResponseData<SSL> *) Super::getAsyncSocketData();
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
        /* Date is always written */
        writeHeader("Date", std::string_view(((LoopData *) us_loop_ext(us_socket_context_loop(SSL, (us_socket_context(SSL, (us_socket_t *) this)))))->date, 29));

        /* You can disable this altogether */
#ifndef UWS_HTTPRESPONSE_NO_WRITEMARK
        if (!Super::getLoopData()->noMark) {
            /* We only expose major version */
            writeHeader("uWebSockets", "20");
        }
#endif
    }

    /* Returns true on success, indicating that it might be feasible to write more data.
     * Will start timeout if stream reaches totalSize or write failure. */
    bool internalEnd(std::string_view data, uintmax_t totalSize, bool optional, bool allowContentLength = true, bool closeConnection = false) {
        /* Write status if not already done */
        writeStatus(HTTP_200_OK);

        /* If no total size given then assume this chunk is everything */
        if (!totalSize) {
            totalSize = data.length();
        }

        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        /* In some cases, such as when refusing huge data we want to close the connection when drained */
        if (closeConnection) {

            /* HTTP 1.1 must send this back unless the client already sent it to us.
             * It is a connection close when either of the two parties say so but the
             * one party must tell the other one so.
             *
             * This check also serves to limit writing the header only once. */
            if ((httpResponseData->state & HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE) == 0) {
                writeHeader("Connection", "close");
            }

            httpResponseData->state |= HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE;
        }

        if (httpResponseData->state & HttpResponseData<SSL>::HTTP_WRITE_CALLED) {

            /* We do not have tryWrite-like functionalities, so ignore optional in this path */

            /* Do not allow sending 0 chunk here */
            if (data.length()) {
                Super::write("\r\n", 2);
                writeUnsignedHex((unsigned int) data.length());
                Super::write("\r\n", 2);

                /* Ignoring optional for now */
                Super::write(data.data(), (int) data.length());
            }

            /* Terminating 0 chunk */
            Super::write("\r\n0\r\n\r\n", 7);

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
            }

            /* tryEnd can never fail when in chunked mode, since we do not have tryWrite (yet), only write */
            Super::timeout(HTTP_TIMEOUT_S);
            return true;
        } else {
            /* Write content-length on first call */
            if (!(httpResponseData->state & HttpResponseData<SSL>::HTTP_END_CALLED)) {
                /* Write mark, this propagates to WebSockets too */
                writeMark();

                /* WebSocket upgrades does not allow content-length */
                if (allowContentLength) {
                    /* Even zero is a valid content-length */
                    Super::write("Content-Length: ", 16);
                    writeUnsigned64(totalSize);
                    Super::write("\r\n\r\n", 4);
                } else {
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

            /* If we are now at the end, start a timeout. Also start a timeout if we failed. */
            if (!success || httpResponseData->offset == totalSize) {
                Super::timeout(HTTP_TIMEOUT_S);
            }

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
    void upgrade(UserData &&userData, std::string_view secWebSocketKey, std::string_view secWebSocketProtocol,
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
        WebSocket<SSL, true, UserData> *webSocket = (WebSocket<SSL, true, UserData> *) us_socket_context_adopt_socket(SSL,
                    (us_socket_context_t *) webSocketContext, (us_socket_t *) this, sizeof(WebSocketData) + sizeof(UserData));

        /* For whatever reason we were corked, update cork to the new socket */
        if (wasCorked) {
            webSocket->AsyncSocket<SSL>::corkUnchecked();
        }

        /* Initialize websocket with any moved backpressure intact */
        webSocket->init(perMessageDeflate, compressOptions, std::move(backpressure));

        /* We should only mark this if inside the parser; if upgrading "async" we cannot set this */
        HttpContextData<SSL> *httpContextData = httpContext->getSocketContextData();
        if (httpContextData->isParsingHttp) {
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
        Super::timeout(HTTP_TIMEOUT_S);
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
        internalEnd(data, data.length(), false, true, closeConnection);
    }

    /* Try and end the response. Returns [true, true] on success.
     * Starts a timeout in some cases. Returns [ok, hasResponded] */
    std::pair<bool, bool> tryEnd(std::string_view data, uintmax_t totalSize = 0, bool closeConnection = false) {
        return {internalEnd(data, totalSize, true, true, closeConnection), hasResponded()};
    }

    /* Write the end of chunked encoded stream */
    bool sendTerminatingChunk(bool closeConnection = false) {
        writeStatus(HTTP_200_OK);
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();
        if (!(httpResponseData->state & HttpResponseData<SSL>::HTTP_WRITE_CALLED)) {
            /* Write mark on first call to write */
            writeMark();

            writeHeader("Transfer-Encoding", "chunked");
            httpResponseData->state |= HttpResponseData<SSL>::HTTP_WRITE_CALLED; 
        }

        /* Terminating 0 chunk */
        Super::write("\r\n0\r\n\r\n", 7);

        return internalEnd({nullptr, 0}, 0, false, false, closeConnection);
    }

    /* Write parts of the response in chunking fashion. Starts timeout if failed. */
    bool write(std::string_view data) {
        writeStatus(HTTP_200_OK);

        /* Do not allow sending 0 chunks, they mark end of response */
        if (!data.length()) {
            /* If you called us, then according to you it was fine to call us so it's fine to still call us */
            return true;
        }

        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        if (!(httpResponseData->state & HttpResponseData<SSL>::HTTP_WRITE_CALLED)) {
            /* Write mark on first call to write */
            writeMark();

            writeHeader("Transfer-Encoding", "chunked");
            httpResponseData->state |= HttpResponseData<SSL>::HTTP_WRITE_CALLED;
        }

        Super::write("\r\n", 2);
        writeUnsignedHex((unsigned int) data.length());
        Super::write("\r\n", 2);

        auto [written, failed] = Super::write(data.data(), (int) data.length());
        if (failed) {
            Super::timeout(HTTP_TIMEOUT_S);
        }

        /* If we did not fail the write, accept more */
        return !failed;
    }

    /* Get the current byte write offset for this Http response */
    uintmax_t getWriteOffset() {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        return httpResponseData->offset;
    }

    /* If you are messing around with sendfile you might want to override the offset. */
    void overrideWriteOffset(uintmax_t offset) {
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
            Super::cork();
            handler();

            /* The only way we could possibly have changed the corked socket during handler call, would be if 
             * the HTTP socket was upgraded to WebSocket and caused a realloc. Because of this we cannot use "this"
             * from here downwards. The corking is done with corkUnchecked() in upgrade. It steals cork. */
            auto *newCorkedSocket = Super::corkedSocket();

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

            if (failed) {
                /* For now we only have one single timeout so let's use it */
                /* This behavior should equal the behavior in HttpContext when uncorking fails */
                Super::timeout(HTTP_TIMEOUT_S);
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
    HttpResponse *onWritable(MoveOnlyFunction<bool(uintmax_t)> &&handler) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        httpResponseData->onWritable = std::move(handler);
        return this;
    }

    /* Attach handler for aborted HTTP request */
    HttpResponse *onAborted(MoveOnlyFunction<void()> &&handler) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        httpResponseData->onAborted = std::move(handler);
        return this;
    }

    /* Attach a read handler for data sent. Will be called with FIN set true if last segment. */
    void onData(MoveOnlyFunction<void(std::string_view, bool)> &&handler) {
        HttpResponseData<SSL> *data = getHttpResponseData();
        data->inStream = std::move(handler);

        /* Always reset this counter here */
        data->received_bytes_per_timeout = 0;
    }


    void setWriteOffset(uintmax_t offset) {
        HttpResponseData<SSL> *httpResponseData = getHttpResponseData();

        httpResponseData->offset = offset;
    }

};

}

#endif // UWS_HTTPRESPONSE_H
