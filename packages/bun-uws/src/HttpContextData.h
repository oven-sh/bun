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

namespace uWS {
template<bool> struct HttpResponse;
struct HttpRequest;

template <bool SSL>
struct alignas(16) HttpContextData {
    template <bool> friend struct HttpContext;
    template <bool> friend struct HttpResponse;
    template <bool> friend struct TemplatedApp;
private:
    std::vector<MoveOnlyFunction<void(HttpResponse<SSL> *, int)>> filterHandlers;

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
    bool isParsingHttp = false;
    bool rejectUnauthorized = false;

    // TODO: SNI
    void clearRoutes() {
        this->router = HttpRouter<RouterData>{};
        this->currentRouter = &router;
        filterHandlers.clear();
    }
};

}

#endif // UWS_HTTPCONTEXTDATA_H
