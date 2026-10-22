#ifndef UWS_H3REQUEST_H
#define UWS_H3REQUEST_H

#include "quic.h"
#include "QueryParser.h"
#include "Utilities.h"

#include <lshpack.h>

#include <string_view>
#include <utility>

namespace uWS {

/* Mirrors uWS::HttpRequest's surface so the same router/handler shape works.
 * Backed by an already-decoded header list (QPACK for HTTP/3, HPACK for
 * HTTP/2 — both hand us the same us_quic_header_t array); pseudo headers
 * (:method, :path, :authority) become method/url/host. */
struct Http3Request {

    Http3Request(us_quic_stream_t *s)
        : Http3Request(us_quic_stream_header(s, 0), us_quic_stream_header_count(s)) {}

    /* Reads the list once and checks it against RFC 9113 §8.2 and §8.3, which RFC 9114 §4.2 and §4.3 repeat. */
    Http3Request(const us_quic_header_t *list, unsigned int count) : headers(list), headerCount(count) {
        bool sawRegular = false;
        unsigned int seen = 0;
        std::string_view host;
        for (unsigned int i = 0; i < headerCount; i++) {
            const us_quic_header_t *h = &headers[i];
            std::string_view name{h->name, h->name_len};
            std::string_view value{h->value, h->value_len};
            Field field = classify(h->qpack_index, name);
            if ((field == Field::Other && !validFieldName(name)) || !validFieldValue(value)) return;
            if (name[0] == ':') {
                /* Pseudo-headers come first, each at most once and never empty. */
                if (field > Field::Authority || sawRegular || (seen & bit(field)) || value.empty()) return;
                seen |= bit(field);
            } else {
                sawRegular = true;
            }
            switch (field) {
            case Field::Method: method = value; break;
            case Field::Path: {
                fullUrl = value;
                size_t q = value.find('?');
                url = q == std::string_view::npos ? value : value.substr(0, q);
                /* Keep the leading '?' — getDecodedQueryValue expects it and
                 * unconditionally drops the first byte. */
                query = q == std::string_view::npos ? std::string_view{} : value.substr(q);
                break;
            }
            case Field::Authority: authority = value; break;
            case Field::Host:
                if (!host.empty()) return;
                host = value;
                break;
            case Field::ContentLength:
                if (contentLength != NO_CONTENT_LENGTH || (contentLength = parseContentLength(value)) == NO_CONTENT_LENGTH) return;
                break;
            case Field::Te:
                if (!(value.size() == 8 && asciiIEquals(value, "trailers"))) return;
                break;
            case Field::Expect: expectsContinue = isExpect100Continue(value); break;
            case Field::ConnectionSpecific: return;
            case Field::Scheme:
            case Field::Other: break;
            }
        }

        /* CONNECT has :method and :authority alone. Every other request has :method, :scheme and :path. */
        const unsigned int required = bit(Field::Method) | bit(Field::Scheme) | bit(Field::Path);
        if (method == "CONNECT" ? seen != (bit(Field::Method) | bit(Field::Authority)) : (seen & required) != required) return;
        if (!isToken(method)) return;
        /* :path is origin-form, or "*" for OPTIONS, with no byte an HTTP/1 request line couldn't carry. HttpRouter skips its first byte unseen. */
        if (seen & bit(Field::Path)) {
            if (fullUrl[0] != '/' && !(fullUrl == "*" && method == "OPTIONS")) return;
            for (unsigned char c : fullUrl) if (c <= 0x20) return;
        }
        /* :authority has no userinfo, and a Host field either repeats it or stands in for it. */
        if (authority.find('@') != std::string_view::npos) return;
        if (authority.empty()) authority = host;
        else if (!host.empty() && host != authority) return;
        if (authority.empty()) return;
        malformed = false;
    }

    /* A trailer section has no pseudo-header (RFC 9113 §8.1, RFC 9114 §4.3). */
    static bool validTrailers(const us_quic_header_t *list, size_t count) {
        for (size_t i = 0; i < count; i++) {
            std::string_view name{list[i].name, list[i].name_len};
            if (!validFieldName(name) || name[0] == ':' || !validFieldValue({list[i].value, list[i].value_len})) return false;
        }
        return true;
    }

    /* Nothing but this is meaningful on a malformed request. */
    bool isMalformed() { return malformed; }
    bool getExpectsContinue() { return expectsContinue; }
    static constexpr uint64_t NO_CONTENT_LENGTH = UINT64_MAX;
    uint64_t getContentLength() { return contentLength; }

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
        for (unsigned int i = 0; i < headerCount; i++) {
            const us_quic_header_t *h = &headers[i];
            if (std::string_view{h->name, h->name_len} == lowerCasedHeader) {
                return {h->value, h->value_len};
            }
        }
        return {};
    }

    /* :authority, or the Host field that stands in for it, comes last as "host". */
    template <typename Fn> void forEachHeader(Fn &&fn) {
        for (unsigned int i = 0; i < headerCount; i++) {
            const us_quic_header_t *h = &headers[i];
            std::string_view name{h->name, h->name_len};
            if (name[0] == ':' || name == "host") continue;
            fn(name, std::string_view{h->value, h->value_len});
        }
        fn(std::string_view{"host"}, authority);
    }

    void setParameters(std::pair<int, std::string_view *> p) { params = p; }
    std::string_view getParameter(unsigned short index) {
        /* HttpRouter::getParameters() returns {paramsTop, params} where
         * paramsTop is the INDEX of the last param (-1 when empty). */
        return (int) index > params.first ? std::string_view{} : params.second[index];
    }

private:
    /* The fields the checks care about. The four request pseudo-headers come first. */
    enum class Field : uint8_t { Method, Scheme, Path, Authority, Host, ContentLength, Te, Expect, ConnectionSpecific, Other };
    static constexpr unsigned int bit(Field field) { return 1u << (unsigned int) field; }

    /* lshpack reports the HPACK static-table index when the peer used one for the name, which is nearly always. HTTP/3 passes -1. */
    static Field classify(int hpackIndex, std::string_view name) {
        switch (hpackIndex > 0 ? hpackIndex : LSHPACK_HDR_UNKNOWN) {
        case LSHPACK_HDR_AUTHORITY: return Field::Authority;
        case LSHPACK_HDR_METHOD_GET: case LSHPACK_HDR_METHOD_POST: return Field::Method;
        case LSHPACK_HDR_PATH: case LSHPACK_HDR_PATH_INDEX_HTML: return Field::Path;
        case LSHPACK_HDR_SCHEME_HTTP: case LSHPACK_HDR_SCHEME_HTTPS: return Field::Scheme;
        case LSHPACK_HDR_HOST: return Field::Host;
        case LSHPACK_HDR_CONTENT_LENGTH: return Field::ContentLength;
        case LSHPACK_HDR_EXPECT: return Field::Expect;
        case LSHPACK_HDR_TRANSFER_ENCODING: return Field::ConnectionSpecific;
        case LSHPACK_HDR_UNKNOWN: break;
        default: return Field::Other;
        }
        switch (name.size()) {
        case 2: if (name == "te") return Field::Te; break;
        case 4: if (name == "host") return Field::Host; break;
        case 5: if (name == ":path") return Field::Path; break;
        case 6: if (name == "expect") return Field::Expect; break;
        case 7: if (name == ":method") return Field::Method; if (name == ":scheme") return Field::Scheme; if (name == "upgrade") return Field::ConnectionSpecific; break;
        case 10: if (name == ":authority") return Field::Authority; if (name == "connection") return Field::ConnectionSpecific; if (name == "keep-alive") return Field::ConnectionSpecific; break;
        case 14: if (name == "content-length") return Field::ContentLength; break;
        case 16: if (name == "proxy-connection") return Field::ConnectionSpecific; break;
        case 17: if (name == "transfer-encoding") return Field::ConnectionSpecific; break;
        }
        return Field::Other;
    }

    /* A token with no uppercase letter, optionally behind the single ':' of a pseudo-header. */
    static bool validFieldName(std::string_view name) {
        size_t i = !name.empty() && name[0] == ':';
        if (i == name.size()) return false;
        for (; i < name.size(); i++) {
            unsigned char c = (unsigned char) name[i];
            if (!isTokenByte(c) || (c >= 'A' && c <= 'Z')) return false;
        }
        return true;
    }

    /* No whitespace at either end, and HTAB is the only control byte. DEL and obs-text pass, as they do through the HTTP/1 parser. */
    static bool validFieldValue(std::string_view value) {
        if (!value.empty() && (value.front() == ' ' || value.front() == '\t' || value.back() == ' ' || value.back() == '\t')) return false;
        for (unsigned char c : value) if (c < 0x20 && c != '\t') return false;
        return true;
    }

    const us_quic_header_t *headers;
    unsigned int headerCount;
    std::string_view method, url, fullUrl, query, authority;
    uint64_t contentLength = NO_CONTENT_LENGTH;
    std::pair<int, std::string_view *> params{-1, nullptr};
    char methodLower[32];
    bool yield = false;
    bool malformed = true;
    bool expectsContinue = false;
};

}

#endif
