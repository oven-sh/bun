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

#pragma once

/* What C++ sees of a request in src/uws_sys/http1/mod.rs. */

/* MAX_FIELDS in src/http1/request/head.rs is 2 fewer. */
#define UWS_HTTP_MAX_HEADERS_COUNT 200

#include <cstddef>
#include <string_view>

namespace uWS {

namespace http1 {

struct Request;
struct RouteParameters;

struct Bytes {
    const char *data;
    size_t length;

    operator std::string_view() const { return {data, length}; }
};

extern "C" void Bun__Http1Request__target(const Request *, Bytes *);
extern "C" void Bun__Http1Request__afterHead(const Request *, Bytes *);
extern "C" bool Bun__Http1Request__isHttp10(const Request *);
extern "C" bool Bun__Http1Request__nextField(const Request *, size_t *index, Bytes *name, Bytes *value);
extern "C" void Bun__RouteParameters__at(const RouteParameters *, size_t index, Bytes *);

}

/* The start of Routed in src/uws_sys/Request.rs. */
struct HttpRequest {
    const http1::Request *parsed;

    bool isAncient() { return http1::Bun__Http1Request__isHttp10(parsed); }
    std::string_view getFullUrl() { return get<http1::Bun__Http1Request__target>(); }
    /* The `head` argument of node:http's 'connect' and 'upgrade' events. */
    std::string_view getBytesAfterHead() { return get<http1::Bun__Http1Request__afterHead>(); }

private:
    template <auto getter> std::string_view get() {
        http1::Bytes bytes;
        getter(parsed, &bytes);
        return bytes;
    }
};

}
