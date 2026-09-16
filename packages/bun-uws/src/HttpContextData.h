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
    bool isParsingHttp: 1 = false;
    bool rejectUnauthorized: 1 = false;
    bool usingCustomExpectHandler: 1 = false;
    bool requireHostHeader: 1 = true;
    bool useStrictMethodValidation: 1 = false;
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

template <bool SSL>
struct alignas(16) HttpContextData {
    template <bool> friend struct HttpContext;
    template <bool> friend struct HttpResponse;
    template <bool> friend struct TemplatedApp;
    friend struct Http2Context;
private:
    std::vector<MoveOnlyFunction<void(HttpResponse<SSL> *, int)>> filterHandlers;
    using OnSocketDataCallback = void (*)(void* userData, int is_ssl, struct us_socket_t *rawSocket, const char *data, int length, bool last);
    using OnSocketDrainCallback = void (*)(void* userData, int is_ssl, struct us_socket_t *rawSocket);
    using OnSocketUpgradedCallback = void (*)(void* userData, int is_ssl, struct us_socket_t *rawSocket);
    using OnClientErrorCallback = MoveOnlyFunction<void(int is_ssl, struct us_socket_t *rawSocket, uWS::HttpParserError errorCode, char *rawPacket, int rawPacketLength)>;
    using OnSocketClosedCallback = void (*)(void* userData, int is_ssl, struct us_socket_t *rawSocket);

    MoveOnlyFunction<void(const char *hostname)> missingServerNameHandler;

    struct RouterData {
        HttpResponse<SSL> *httpResponse;
        HttpRequest *httpRequest;
    };

    /* This is the currently browsed-to router when using SNI */
    HttpRouter<RouterData> *currentRouter = &router;

    /* The socket onData is currently parsing, nullptr outside a parse. The
     * close gates in internalEnd need the per-socket identity: a DIFFERENT
     * socket's response can complete inside this window (a microtask drained
     * during a request dispatch), and the context-wide isParsingHttp bit
     * alone would wrongly defer its close to a post-parse gate that only
     * checks the parsed socket. */
    struct us_socket_t *parsingSocket = nullptr;

    /* This is the default router for default SNI or non-SSL */
    HttpRouter<RouterData> router;
    void *upgradedWebSocket = nullptr;
    /* Used to simulate Node.js socket events. */
    OnSocketClosedCallback onSocketClosed = nullptr;
    OnSocketDrainCallback onSocketDrain = nullptr;
    OnSocketDataCallback onSocketData = nullptr;
    OnSocketUpgradedCallback onSocketUpgraded = nullptr;
    OnClientErrorCallback onClientError = nullptr;

    uint64_t maxHeaderSize = 0; // 0 means no limit

    /* HTTP/2: set by Http2Context::attach(). A connection that negotiated h2
     * (ALPN) or opened with the prior-knowledge preface is handed over via
     * onHttp2, which destructs our ext, adopts the socket and feeds it the
     * bytes already read. */
    Http2Context *http2Context = nullptr;
    us_socket_t *(*onHttp2)(void *http2Context, us_socket_t *s, char *data, int length, unsigned prefaceConsumed) = nullptr;
    /* With HTTP/2 attached: whether HTTP/1.x is still served (ALPN fallback
     * and non-preface cleartext). */
    bool allowHttp1 = true;

    // TODO: SNI
    void clearRoutes() {
        this->router = HttpRouter<RouterData>{};
        this->currentRouter = &router;
        /* Not filterHandlers: filters are per-context open/close hooks, not
         * routes. server.reload() never re-registers them, so wiping them here
         * leaves Bun's active_connection_count (and node:http's 'connection'
         * event) decoupled for the rest of the server's life. */
    }

public:
    
    HttpFlags flags;
};

}

#endif // UWS_HTTPCONTEXTDATA_H
