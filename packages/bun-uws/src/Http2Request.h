#ifndef UWS_H2REQUEST_H
#define UWS_H2REQUEST_H
// clang-format off

#include "Http2ResponseData.h"
#include "QueryParser.h"

#include <wtf/Vector.h>
#include <string_view>
#include <utility>

namespace uWS {

struct Http2Response;

/* Mirrors Http3Request so the router/handler shape is identical. Backed by
 * a decoded HPACK header list; pseudo headers (:method, :path, :authority)
 * become method/url/host. */
struct Http2Request {

    Http2Request(WTF::Vector<Http2Header, 32> &headers, std::string & /*store*/,
                 Http2Response *r)
        : hdrs(headers), response(r) {
        for (auto &h : hdrs) {
            std::string_view name{h.name, h.name_len};
            std::string_view value{h.value, h.value_len};
            if (name == ":method") {
                method = value;
            } else if (name == ":path") {
                fullUrl = value;
                size_t q = value.find('?');
                url = q == std::string_view::npos ? value : value.substr(0, q);
                /* Keep the leading '?' — getDecodedQueryValue drops it. */
                query = q == std::string_view::npos ? std::string_view{} : value.substr(q);
            } else if (name == ":authority") {
                authority = value;
            } else if (authority.empty() && name.size() == 4 && equalsIgnoreCase(name, "host")) {
                /* RFC 9113 §8.3.1: a request MUST include :authority OR a
                 * Host field. Promote the literal Host so getHeader("host"),
                 * req.url, and the forEachHeader synthesis all agree. HPACK
                 * delivers pseudo-headers first, so :authority (if any)
                 * always wins. */
                authority = value;
            }
        }
    }

    bool isAncient() { return false; }
    bool getYield() { return yield; }
    void setYield(bool y) { yield = y; }

    std::string_view getUrl() { return url; }
    std::string_view getFullUrl() { return fullUrl; }
    std::string_view getQuery() { return query.empty() ? query : query.substr(1); }
    std::string_view getQuery(std::string_view key) { return getDecodedQueryValue(key, query); }
    std::string_view getCaseSensitiveMethod() { return method; }
    Http2Response *getResponse() { return response; }

    /* HttpRequest::getMethod() lowercases in place; we own no writable
     * buffer, so write into a per-request scratch instead. */
    std::string_view getMethod() {
        size_t n = method.size() < sizeof(methodLower) ? method.size() : sizeof(methodLower);
        for (size_t i = 0; i < n; i++) {
            char c = method[i];
            methodLower[i] = (char)(c | ((unsigned char)(c - 'A') < 26 ? 0x20 : 0));
        }
        return {methodLower, n};
    }

    std::string_view getHeader(std::string_view lowerCasedHeader) {
        if (lowerCasedHeader == "host") return authority;
        for (auto &h : hdrs) {
            if (h.name_len == lowerCasedHeader.size() &&
                equalsIgnoreCase({h.name, h.name_len}, lowerCasedHeader)) {
                return {h.value, h.value_len};
            }
        }
        return {};
    }

    template <typename Fn> void forEachHeader(Fn &&fn) {
        for (auto &h : hdrs) {
            std::string_view name{h.name, h.name_len};
            if (!name.empty() && name[0] == ':') continue;
            /* Drop the literal Host — :authority is synthesised below so
             * req.headers.get('host') matches req.url and isn't
             * comma-joined. */
            if (!authority.empty() && name.size() == 4 && equalsIgnoreCase(name, "host")) continue;
            fn(name, std::string_view{h.value, h.value_len});
        }
        if (!authority.empty()) fn(std::string_view{"host"}, authority);
    }

    void setParameters(std::pair<int, std::string_view *> p) { params = p; }
    std::string_view getParameter(unsigned short index) {
        return (int) index > params.first ? std::string_view{} : params.second[index];
    }

private:
    static bool equalsIgnoreCase(std::string_view a, std::string_view b) {
        if (a.size() != b.size()) return false;
        for (size_t i = 0; i < a.size(); i++) {
            if ((a[i] | 0x20) != (b[i] | 0x20)) return false;
        }
        return true;
    }

    WTF::Vector<Http2Header, 32> &hdrs;
    Http2Response *response;
    std::string_view method, url, fullUrl, query, authority;
    std::pair<int, std::string_view *> params{-1, nullptr};
    char methodLower[32];
    bool yield = false;
};

}

#endif
