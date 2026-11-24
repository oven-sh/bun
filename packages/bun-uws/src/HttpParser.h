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

/* Owners for src/uws_sys/http1.rs. */

/* MAX_FIELDS in src/http1/request/head.rs is 2 fewer. */
#define UWS_HTTP_MAX_HEADERS_COUNT 200

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <string_view>
#include <utility>

extern "C" size_t BUN_DEFAULT_MAX_HTTP_HEADER_SIZE;

namespace uWS {

/* Declared here (the common include of HttpResponseData.h and HttpContext.h,
 * which include each other) so the IsNodeHttp default is visible exactly once
 * and before either of them. IsNodeHttp=false is the Bun.serve layout; the
 * true specialization adds the node:http-only per-connection state. */
template <bool SSL, bool IsNodeHttp = false>
struct HttpResponseData;

/* Monotonic millisecond clock used for the node:http headers/request
 * timeout tracking (HttpResponseData::lastMessageStartMs). Kept separate
 * from the second-granular us_socket_timeout machinery because Node's
 * timeouts are millisecond-based. */
static inline uint64_t nodeCompatMonotonicMs() {
    return (uint64_t) std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}

/* The others are RequestError in src/http1/request/error.rs. */
enum HttpParserError : uint8_t {
    HTTP_PARSER_ERROR_NONE = 0,
    HTTP_PARSER_ERROR_INVALID_EOF = 8,
};

struct HttpParser;

namespace http1 {

struct Request;

struct Bytes {
    const char *data;
    size_t length;

    operator std::string_view() const { return {data, length}; }
};

struct Options {
    uint64_t maxHeaderSize;
    uint32_t maxHeadersCount;
    bool requireHostHeader, useInsecureHTTPParser, useLenientTransferEncoding;
};

/* A handler that upgraded or closed the socket, which destroys the parser, has to return nullptr. */
struct Socket {
    HttpParser *parser;
    void *user;
    void *(*onRequest)(void *user, const Request *);
    void *(*onBody)(void *user, Bytes, bool fin);
};

struct Result {
    HttpParserError error;
    /* By an error or a handler. */
    bool isStopped;
    /* By parkAtNextBoundary. */
    bool isParked;
    /* When a handler stopped it, or it parked: the bytes behind are the caller's. */
    size_t consumed;
    Bytes errorResponse;
};

extern "C" void Bun__RequestParser__construct(HttpParser *, size_t defaultMaxHeadLength);
extern "C" void Bun__RequestParser__destruct(HttpParser *);
extern "C" Result Bun__RequestParser__read(Socket *, const char *data, size_t length, const Options *);
extern "C" Result Bun__RequestParser__readForNode(Socket *, const char *data, size_t length, const Options *);
extern "C" bool Bun__RequestParser__hasPartialHead(const HttpParser *);
extern "C" bool Bun__RequestParser__hasIncompleteBody(const HttpParser *);
extern "C" void Bun__Http1Request__method(const Request *, Bytes *);
extern "C" void Bun__Http1Request__target(const Request *, Bytes *);
extern "C" void Bun__Http1Request__path(const Request *, Bytes *);
extern "C" void Bun__Http1Request__afterHead(const Request *, Bytes *);
extern "C" bool Bun__Http1Request__isHttp10(const Request *);
extern "C" uint64_t Bun__Http1Request__contentLength(const Request *);
extern "C" void Bun__Http1Request__field(const Request *, const char *name, size_t length, Bytes *);
extern "C" bool Bun__Http1Request__fieldAt(const Request *, size_t index, Bytes *name, Bytes *value);

}

/* A parsed request and what the router adds to it. */
struct HttpRequest {
    const http1::Request *parsed;

    explicit HttpRequest(const http1::Request *parsed) : parsed(parsed) {}

    bool isAncient() { return http1::Bun__Http1Request__isHttp10(parsed); }
    /* The number the parser frames the body by, or NO_CONTENT_LENGTH. */
    uint64_t getContentLength() { return http1::Bun__Http1Request__contentLength(parsed); }
    std::string_view getCaseSensitiveMethod() { return get<http1::Bun__Http1Request__method>(); }
    std::string_view getFullUrl() { return get<http1::Bun__Http1Request__target>(); }
    std::string_view getUrlForRouting() { return get<http1::Bun__Http1Request__path>(); }
    /* The `head` argument of node:http's 'connect' and 'upgrade' events. */
    std::string_view getBytesAfterHead() { return get<http1::Bun__Http1Request__afterHead>(); }
    std::string_view getHeader(std::string_view name) { return get<http1::Bun__Http1Request__field>(name.data(), name.length()); }

    template <typename Fn> void forEachHeader(Fn &&fn) {
        http1::Bytes name, value;
        for (size_t i = 0; http1::Bun__Http1Request__fieldAt(parsed, i, &name, &value); i++) {
            fn(name, value);
        }
    }

    bool getYield() { return didYield; }
    /* If you do not want to handle this route */
    void setYield(bool yield) { didYield = yield; }

    void setParameters(std::pair<int, std::string_view *> parameters) { currentParameters = parameters; }
    std::string_view getParameter(unsigned short index) {
        return currentParameters.first < (int) index ? std::string_view() : currentParameters.second[index];
    }

private:
    template <auto getter, typename... Arguments> std::string_view get(Arguments... arguments) {
        http1::Bytes bytes;
        getter(parsed, arguments..., &bytes);
        return bytes;
    }

    bool didYield = false;
    std::pair<int, std::string_view *> currentParameters;
};

/* RequestParser in src/http1/request/mod.rs. */
struct alignas(8) HttpParser {
    /* A request on this connection was its last one. */
    bool sawConnectionClose;
    /* node:http: every byte until the peer's FIN is body. onEnd delivers the fin and clears this. */
    bool nodeHttpBodyUntilEof;
    bool isConnectRequest;
    /* Bun.serve: the read stops at the next request boundary. HttpContext::onData derives it, and parks the rest. */
    bool parkAtNextBoundary;

    HttpParser() { http1::Bun__RequestParser__construct(this, BUN_DEFAULT_MAX_HTTP_HEADER_SIZE); }
    ~HttpParser() { http1::Bun__RequestParser__destruct(this); }
    HttpParser(const HttpParser &) = delete;
    HttpParser &operator=(const HttpParser &) = delete;

    bool hasBufferedPartialRequestHeaders() const { return http1::Bun__RequestParser__hasPartialHead(this); }
    bool hasIncompleteRequestBody() const { return http1::Bun__RequestParser__hasIncompleteBody(this); }

private:
    [[maybe_unused]] unsigned char rest[76];
};
static_assert(sizeof(HttpParser) == 80);

}
