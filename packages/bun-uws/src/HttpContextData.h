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
#include <type_traits>
#include "MoveOnlyFunction.h"
#include "HttpParser.h"
namespace uWS {
template<bool, bool> struct HttpResponse;
struct HttpRequest;

struct HttpFlags {
    bool isParsingHttp: 1 = false;
    bool rejectUnauthorized: 1 = false;
    bool usingCustomExpectHandler: 1 = false;
    bool requireHostHeader: 1 = true;
    bool isAuthorized: 1 = false;
    bool useStrictMethodValidation: 1 = false;
    /* node:http insecureHTTPParser server option. NOTE: unlike Node's server
     * (which fans kLenientAll out to all 10 llhttp lenient setters), the uWS
     * parser only implements the LENIENT_HEADERS bit (control bytes accepted
     * in field values); TE+CL conflict, chunked-size/CRLF strictness, version
     * and header-token checks are still enforced. */
    bool useInsecureHTTPParser: 1 = false;
    /* node:http server.httpAllowHalfOpen: when true, a peer FIN with in-flight
     * or queued responses keeps the connection open until they drain (Node's
     * socketOnEnd); when false (the default), the connection ends right away. */
    bool httpAllowHalfOpen: 1 = false;
};

template <bool SSL, bool NODE_HTTP>
struct alignas(16) HttpContextData {
    template <bool, bool> friend struct HttpContext;
    template <bool, bool> friend struct HttpResponse;
    template <bool, bool> friend struct TemplatedApp;
public:
    using OnSocketDataCallback = void (*)(void* userData, int is_ssl, struct us_socket_t *rawSocket, const char *data, int length, bool last);
    using OnSocketDrainCallback = void (*)(void* userData, int is_ssl, struct us_socket_t *rawSocket);
    using OnSocketUpgradedCallback = void (*)(void* userData, int is_ssl, struct us_socket_t *rawSocket);
    using OnClientErrorCallback = MoveOnlyFunction<void(int is_ssl, struct us_socket_t *rawSocket, uWS::HttpParserError errorCode, char *rawPacket, int rawPacketLength)>;
    using OnSocketClosedCallback = void (*)(void* userData, int is_ssl, struct us_socket_t *rawSocket);

private:
    std::vector<MoveOnlyFunction<void(HttpResponse<SSL, NODE_HTTP> *, int)>> filterHandlers;

    MoveOnlyFunction<void(const char *hostname)> missingServerNameHandler;

    struct RouterData {
        HttpResponse<SSL, NODE_HTTP> *httpResponse;
        HttpRequest *httpRequest;
    };

    /* This is the currently browsed-to router when using SNI */
    HttpRouter<RouterData> *currentRouter = &router;

    /* This is the default router for default SNI or non-SSL */
    HttpRouter<RouterData> router;
    void *upgradedWebSocket = nullptr;
    /* Used to simulate Node.js socket events. */
    OnSocketClosedCallback onSocketClosed = nullptr;
    OnSocketDrainCallback onSocketDrain = nullptr;
    OnSocketUpgradedCallback onSocketUpgraded = nullptr;

    /* node:http-only callback slots. Compiled out for the Bun.serve
     * instantiation so per-context storage stays minimal. */
    struct NodeHttpContextFields {
        OnSocketDataCallback onSocketData = nullptr;
        OnClientErrorCallback onClientError = nullptr;
    };
    struct EmptyNodeHttpContext {};
    [[no_unique_address]] std::conditional_t<NODE_HTTP, NodeHttpContextFields, EmptyNodeHttpContext> nodeCompat;

    uint64_t maxHeaderSize = 0; // 0 means no limit

    // TODO: SNI
    void clearRoutes() {
        this->router = HttpRouter<RouterData>{};
        this->currentRouter = &router;
        filterHandlers.clear();
    }

public:

    HttpFlags flags;
};

}

#endif // UWS_HTTPCONTEXTDATA_H
