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

#ifndef UWS_HTTPCONTEXTDATA_H
#define UWS_HTTPCONTEXTDATA_H

#include "HttpRouter.h"

#include <vector>
#include "MoveOnlyFunction.h"
#include "HttpParser.h"
namespace uWS {
template<bool> struct HttpResponse;
struct HttpRequest;
struct Http2Context;

struct HttpFlags {
    bool usingCustomExpectHandler: 1 = false;
    /* node:http parser leniency. Two llhttp lenient bits: useInsecureHTTPParser = LENIENT_HEADERS
     * ("relaxed"+"insecure"); useLenientTransferEncoding = LENIENT_TRANSFER_ENCODING ("insecure"
     * only). TE+CL conflict, chunked-size/CRLF, version, header-token checks stay enforced. */
    bool useInsecureHTTPParser: 1 = false;
    bool useLenientTransferEncoding: 1 = false;
    /* node:http server.httpAllowHalfOpen: when true, a peer FIN with in-flight
     * or queued responses keeps the connection open until they drain (Node's
     * socketOnEnd); when false (the default), the connection ends right away. */
    bool httpAllowHalfOpen: 1 = false;
};

/* What node:http hears about a connection. socketData is HttpResponseData::socketData. */
struct NodeHttpSocketHooks {
    /* readError: 0, or the error of the failed read (a peer RST). peerEnded: the peer sent its FIN first. */
    void (*onClosed)(void *socketData, int readError, bool peerEnded);
    void (*onDrain)(void *socketData);
    void (*onRawRead)(void *socketData, const char *data, int length);
    void (*onReadParsed)(void *socketData);
    void (*onParseFailed)(void *socketData);
    /* A read ended inside a request head. The socket can be closed when this returns. */
    void (*onPartialHead)(void *socketData);
    /* The body of an accepted Upgrade request has ended. The socket can have left this context when this returns. */
    void (*onUpgradeBodyEnded)(void *socketData);
    /* A TLS handshake ended, or an established session failed. The socket can be closed when this returns. */
    void (*onHandshake)(void *socketData, int success, struct us_bun_verify_error_t verifyError);
    /* The peer sent its FIN. The socket can be closed when this returns. Returns whether the socket's 'end' listener calls HttpResponse::finishParsing(). */
    bool (*onPeerEnded)(void *socketData);
    /* The bytes a socket.end() waited for are out. The socket can be closed when this returns. */
    void (*halfCloseAfterDrain)(void *socketData);
};

template <bool SSL>
struct alignas(16) HttpContextData {
    template <bool> friend struct HttpContext;
    template <bool> friend struct HttpResponse;
    template <bool> friend struct TemplatedApp;
    friend struct Http2Context;
private:
    std::vector<MoveOnlyFunction<void(HttpResponse<SSL> *, int)>> filterHandlers;
    using OnClientErrorCallback = MoveOnlyFunction<void(int is_ssl, struct us_socket_t *rawSocket, uWS::HttpParserError errorCode, char *rawPacket, int rawPacketLength)>;

    struct RouterData {
        HttpResponse<SSL> *httpResponse;
        HttpRequest *httpRequest;
    };

    /* A read that HttpContext::onData() is parsing. */
    struct Parse {
        struct us_socket_t *socket;
        /* A handler of that one ticks the loop (waitForPromise). */
        Parse *outer;
        /* The new owner already has what follows the request head in this read. */
        bool restOfReadTaken = false;
    };
    /* The innermost one, nullptr outside a parse. */
    Parse *parsing = nullptr;

    HttpRouter<RouterData> router;
    /* Set by enableNodeHttpCompat(). A socket only has socketData in such a context. */
    const NodeHttpSocketHooks *nodeHttpHooks = nullptr;
    OnClientErrorCallback onClientError = nullptr;

    /* Seconds a connection may stay silent before it's closed, 0 for never. node:http runs its own timers and leaves it at 0. */
    uint8_t idleTimeout = 0;
    uint64_t maxHeaderSize = 0; // 0 means no limit
    /* Bun.serve answers 413 to a larger Content-Length, so such a request gets no automatic 100 Continue. */
    uint64_t maxRequestBodySize = UINT64_MAX;
    uint32_t maxHeadersCount = 0; // node:http server.maxHeadersCount; 0 means not set

    /* HTTP/2: set by Http2Context::attach(). A connection that negotiated h2
     * (ALPN) or opened with the prior-knowledge preface is handed over via
     * onHttp2, which destructs our ext, adopts the socket and feeds it the
     * bytes already read. */
    Http2Context *http2Context = nullptr;
    us_socket_t *(*onHttp2)(void *http2Context, us_socket_t *s, char *data, int length, unsigned prefaceConsumed) = nullptr;
    /* With HTTP/2 attached: whether HTTP/1.x is still served (ALPN fallback
     * and non-preface cleartext). */
    bool allowHttp1 = true;

    void clearRoutes() {
        this->router = HttpRouter<RouterData>{};
        /* Not filterHandlers: filters are per-context open/close hooks, not
         * routes. server.reload() never re-registers them, so wiping them here
         * leaves Bun's active_connection_count (and node:http's 'connection'
         * event) decoupled for the rest of the server's life. */
    }

public:
    
    HttpFlags flags;

    /* Per socket: the response of another one can complete under a parse, in a microtask of the dispatch. */
    bool isParsing(struct us_socket_t *s) const {
        for (Parse *parse = parsing; parse; parse = parse->outer) {
            if (parse->socket == s) {
                return true;
            }
        }
        return false;
    }

    void markRestOfReadTaken(struct us_socket_t *s) {
        for (Parse *parse = parsing; parse; parse = parse->outer) {
            parse->restOfReadTaken |= parse->socket == s;
        }
    }
};

}

#endif // UWS_HTTPCONTEXTDATA_H
