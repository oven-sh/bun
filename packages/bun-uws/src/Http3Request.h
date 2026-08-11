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
            if (isMalformedField(name, value)) malformed = true;
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
            } else if (authority.empty() && name.size() == 4 && equalsIgnoreCase(name, "host")) {
                /* RFC 9114 §4.3.1: a request must contain :authority OR a
                 * Host field. Promote the literal Host so getHeader("host"),
                 * req.url, and the forEachHeader synthesis all agree. QPACK
                 * delivers pseudo-headers first, so :authority (if any)
                 * always wins. */
                authority = value;
            }
        }
    }

    bool isMalformed() { return malformed; }

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
            char c = method[i];
            methodLower[i] = (char) (c | ((unsigned char) (c - 'A') < 26 ? 0x20 : 0));
        }
        return {methodLower, n};
    }

    std::string_view getHeader(std::string_view lowerCasedHeader) {
        if (lowerCasedHeader == "host") return authority;
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
    /* RFC 9110 tchar minus uppercase; RFC 9114 §4.2 makes a message with an
     * uppercase field name malformed. */
    static bool isLowercaseTokenByte(unsigned char c) {
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') return true;
        switch (c) {
            case '!': case '#': case '$': case '%': case '&': case '\'': case '*':
            case '+': case '.': case '^': case '_': case '`': case '|': case '~':
                return true;
            default:
                return false;
        }
    }

    /* RFC 9114 §4.1.2 / §4.2, the same rules the HTTP/2 and HTTP/3 clients
     * apply to response fields (is_malformed_response_field / _value). QPACK
     * is length-prefixed, so nothing below this layer rejects a CR, LF or NUL
     * the way HttpParser does for HTTP/1; whatever passes here is what
     * Request.headers hands back to be re-serialized by fetch() et al. */
    static bool isMalformedField(std::string_view name, std::string_view value) {
        std::string_view token = name;
        if (!token.empty() && token[0] == ':') token.remove_prefix(1);
        if (token.empty()) return true;
        for (unsigned char c : token) {
            if (!isLowercaseTokenByte(c)) return true;
        }
        for (unsigned char c : value) {
            if (c == '\0' || c == '\r' || c == '\n') return true;
        }
        /* Connection-specific fields have no meaning outside HTTP/1 (§4.2). */
        return name == "connection" || name == "keep-alive" || name == "proxy-connection"
            || name == "transfer-encoding" || name == "upgrade";
    }

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
    char methodLower[32];
    bool yield = false;
    bool malformed = false;
};

}

#endif
