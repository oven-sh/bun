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

struct HttpFlags {
    bool isParsingHttp: 1 = false;
    bool rejectUnauthorized: 1 = false;
    bool usingCustomExpectHandler: 1 = false;
    bool requireHostHeader: 1 = true;
    bool isAuthorized: 1 = false;
    bool useStrictMethodValidation: 1 = false;
};

template <bool SSL>
struct alignas(16) HttpContextData {
    template <bool> friend struct HttpContext;
    template <bool> friend struct HttpResponse;
    template <bool> friend struct TemplatedApp;
private:
    std::vector<MoveOnlyFunction<void(HttpResponse<SSL> *, int)>> filterHandlers;
    using OnSocketClosedCallback = void (*)(void* userData, int is_ssl, struct us_socket_t *rawSocket);
    using OnClientErrorCallback = MoveOnlyFunction<void(int is_ssl, struct us_socket_t *rawSocket, uWS::HttpParserError errorCode, char *rawPacket, int rawPacketLength)>;

    MoveOnlyFunction<void(const char *hostname)> missingServerNameHandler;

    struct RouterData {
        HttpResponse<SSL> *httpResponse;
        HttpRequest *httpRequest;
    };

    /* This is the currently browsed-to router when using SNI */
    HttpRouter<RouterData> *currentRouter = &router;

    /* This is the default router for default SNI or non-SSL */
    HttpRouter<RouterData> router;
    void *upgradedWebSocket = nullptr;
    /* Used to simulate Node.js socket events. */
    OnSocketClosedCallback onSocketClosed = nullptr;
    OnClientErrorCallback onClientError = nullptr;

    HttpFlags flags;
    uint64_t maxHeaderSize = 0; // 0 means no limit

    // TODO: SNI
    void clearRoutes() {
        this->router = HttpRouter<RouterData>{};
        this->currentRouter = &router;
        filterHandlers.clear();
    }

    public:
    bool isAuthorized() const {
        return flags.isAuthorized;
    }
};

}

#endif // UWS_HTTPCONTEXTDATA_H
