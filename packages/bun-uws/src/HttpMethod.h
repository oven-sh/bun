#ifndef UWS_HTTPMETHOD_H
#define UWS_HTTPMETHOD_H

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace uWS {

/* The request methods Bun can represent. The index of a name is the method's
 * id: the discriminant of bun_http_types::Method (src/http_types/Method.rs).
 * Both lists are in ascending byte order of the name. */
inline constexpr std::array<std::string_view, 36> HTTP_METHOD_NAMES = {
    "ACL",
    "BIND",
    "CHECKOUT",
    "CONNECT",
    "COPY",
    "DELETE",
    "GET",
    "HEAD",
    "LINK",
    "LOCK",
    "M-SEARCH",
    "MERGE",
    "MKACTIVITY",
    "MKADDRESSBOOK",
    "MKCALENDAR",
    "MKCOL",
    "MOVE",
    "NOTIFY",
    "OPTIONS",
    "PATCH",
    "POST",
    "PROPFIND",
    "PROPPATCH",
    "PURGE",
    "PUT",
    "QUERY",
    "REBIND",
    "REPORT",
    "SEARCH",
    "SOURCE",
    "SUBSCRIBE",
    "TRACE",
    "UNBIND",
    "UNLINK",
    "UNLOCK",
    "UNSUBSCRIBE",
};

inline constexpr uint8_t HTTP_METHOD_COUNT = (uint8_t) HTTP_METHOD_NAMES.size();

/* The id of a token that is none of HTTP_METHOD_NAMES. */
inline constexpr uint8_t HTTP_METHOD_NONE = 0xff;

namespace detail {

template <size_t N>
constexpr bool methodIs(const char *method, const char (&name)[N]) {
    return __builtin_memcmp(method, name, N - 1) == 0;
}

} // namespace detail

/* The id of a method as the request line or :method carries it. A method is
 * case-sensitive (RFC 9110 9.1), so "get" has no id. One switch on the length,
 * then compares of that fixed width, the common methods first. */
constexpr uint8_t methodIdFromWire(std::string_view method) {
    using detail::methodIs;
    const char *m = method.data();
    switch (method.length()) {
    case 3:
        if (methodIs(m, "GET")) return 6;
        if (methodIs(m, "PUT")) return 24;
        if (methodIs(m, "ACL")) return 0;
        break;
    case 4:
        if (methodIs(m, "POST")) return 20;
        if (methodIs(m, "HEAD")) return 7;
        if (methodIs(m, "BIND")) return 1;
        if (methodIs(m, "COPY")) return 4;
        if (methodIs(m, "LINK")) return 8;
        if (methodIs(m, "LOCK")) return 9;
        if (methodIs(m, "MOVE")) return 16;
        break;
    case 5:
        if (methodIs(m, "PATCH")) return 19;
        if (methodIs(m, "TRACE")) return 31;
        if (methodIs(m, "MERGE")) return 11;
        if (methodIs(m, "MKCOL")) return 15;
        if (methodIs(m, "PURGE")) return 23;
        if (methodIs(m, "QUERY")) return 25;
        break;
    case 6:
        if (methodIs(m, "DELETE")) return 5;
        if (methodIs(m, "NOTIFY")) return 17;
        if (methodIs(m, "REBIND")) return 26;
        if (methodIs(m, "REPORT")) return 27;
        if (methodIs(m, "SEARCH")) return 28;
        if (methodIs(m, "SOURCE")) return 29;
        if (methodIs(m, "UNBIND")) return 32;
        if (methodIs(m, "UNLINK")) return 33;
        if (methodIs(m, "UNLOCK")) return 34;
        break;
    case 7:
        if (methodIs(m, "OPTIONS")) return 18;
        if (methodIs(m, "CONNECT")) return 3;
        break;
    case 8:
        if (methodIs(m, "PROPFIND")) return 21;
        if (methodIs(m, "CHECKOUT")) return 2;
        if (methodIs(m, "M-SEARCH")) return 10;
        break;
    case 9:
        if (methodIs(m, "PROPPATCH")) return 22;
        if (methodIs(m, "SUBSCRIBE")) return 30;
        break;
    case 10:
        if (methodIs(m, "MKACTIVITY")) return 12;
        if (methodIs(m, "MKCALENDAR")) return 14;
        break;
    case 11:
        if (methodIs(m, "UNSUBSCRIBE")) return 35;
        break;
    case 13:
        if (methodIs(m, "MKADDRESSBOOK")) return 13;
        break;
    }
    return HTTP_METHOD_NONE;
}

static_assert([] {
    for (uint8_t id = 0; id < HTTP_METHOD_COUNT; id++) {
        if (methodIdFromWire(HTTP_METHOD_NAMES[id]) != id) {
            return false;
        }
        if (id && !(HTTP_METHOD_NAMES[id - 1] < HTTP_METHOD_NAMES[id])) {
            return false;
        }
    }
    return methodIdFromWire("") == HTTP_METHOD_NONE
        && methodIdFromWire("get") == HTTP_METHOD_NONE
        && methodIdFromWire("Get") == HTTP_METHOD_NONE
        && methodIdFromWire("GETS") == HTTP_METHOD_NONE
        && methodIdFromWire("BREW") == HTTP_METHOD_NONE;
}(), "methodIdFromWire() returns each name's index in HTTP_METHOD_NAMES and no id for any other token");

} // namespace uWS

#endif // UWS_HTTPMETHOD_H
