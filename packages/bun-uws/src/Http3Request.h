#ifndef UWS_H3REQUEST_H
#define UWS_H3REQUEST_H

#include "quic.h"
#include "QueryParser.h"

#include <cctype>
#include <string_view>
#include <utility>

namespace uWS {

/* Mirrors uWS::HttpRequest's surface so the same router/handler shape works.
 * Backed by a us_quic_stream_t whose header set is already parsed; pseudo
 * headers (:method, :path, :authority) become method/url/host. */
struct Http3Request {

    Http3Request(us_quic_stream_t *s) : stream(s) {
        unsigned int n = us_quic_stream_header_count(s);
        for (unsigned int i = 0; i < n; i++) {
            const us_quic_header_t *h = us_quic_stream_header(s, i);
            std::string_view name{h->name, h->name_len};
            std::string_view value{h->value, h->value_len};
            if (name == ":method") {
                method = value;
            } else if (name == ":path") {
                fullUrl = value;
                size_t q = value.find('?');
                url = q == std::string_view::npos ? value : value.substr(0, q);
                /* Keep the leading '?' — getDecodedQueryValue expects it and
                 * unconditionally drops the first byte. */
                query = q == std::string_view::npos ? std::string_view{} : value.substr(q);
            } else if (name == ":authority") {
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
    std::string_view getQuery(std::string_view key) {
        return getDecodedQueryValue(key, query);
    }
    std::string_view getCaseSensitiveMethod() { return method; }

    /* HttpRequest::getMethod() lowercases in place; we own no writable
     * buffer, so write into a per-request scratch instead. */
    std::string_view getMethod() {
        size_t n = method.size() < sizeof(methodLower) ? method.size() : sizeof(methodLower);
        for (size_t i = 0; i < n; i++) {
            methodLower[i] = (char) (method[i] | 0x20);
        }
        return {methodLower, n};
    }

    std::string_view getHeader(std::string_view lowerCasedHeader) {
        if (lowerCasedHeader == "host") lowerCasedHeader = ":authority";
        unsigned int n = us_quic_stream_header_count(stream);
        for (unsigned int i = 0; i < n; i++) {
            const us_quic_header_t *h = us_quic_stream_header(stream, i);
            if (h->name_len == lowerCasedHeader.size() &&
                equalsIgnoreCase({h->name, h->name_len}, lowerCasedHeader)) {
                return {h->value, h->value_len};
            }
        }
        return {};
    }

    template <typename Fn> void forEachHeader(Fn &&fn) {
        unsigned int n = us_quic_stream_header_count(stream);
        for (unsigned int i = 0; i < n; i++) {
            const us_quic_header_t *h = us_quic_stream_header(stream, i);
            std::string_view name{h->name, h->name_len};
            if (!name.empty() && name[0] == ':') continue;
            /* RFC 9114 §4.3.1: a request MAY include both :authority and a
             * literal Host. :authority is synthesized as host below; drop
             * the literal so req.headers.get('host') matches req.url and
             * isn't comma-joined. */
            if (!authority.empty() && name.size() == 4 && equalsIgnoreCase(name, "host")) continue;
            fn(name, std::string_view{h->value, h->value_len});
        }
        if (!authority.empty()) fn(std::string_view{"host"}, authority);
    }

    void setParameters(std::pair<int, std::string_view *> p) { params = p; }
    std::string_view getParameter(unsigned short index) {
        /* HttpRouter::getParameters() returns {paramsTop, params} where
         * paramsTop is the INDEX of the last param (-1 when empty). */
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

    us_quic_stream_t *stream;
    std::string_view method, url, fullUrl, query, authority;
    std::pair<int, std::string_view *> params{-1, nullptr};
    char methodLower[16];
    bool yield = false;
};

}

#endif
