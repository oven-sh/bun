#pragma once

// clang-format off

#define HTTP2_COMMON_STRINGS_EACH_NAME(macro) \
   macro(authority, ":authority"_s, ""_s, 0) \
macro(methodGet, ":method"_s, "GET"_s, 1) \
macro(methodPost, ":method"_s, "POST"_s, 2) \
macro(pathRoot, ":path"_s, "/"_s, 3) \
macro(pathIndex, ":path"_s, "/index.html"_s, 4) \
macro(schemeHttp, ":scheme"_s, "http"_s, 5) \
macro(schemeHttps, ":scheme"_s, "https"_s, 6) \
macro(status200, ":status"_s, "200"_s, 7) \
macro(status204, ":status"_s, "204"_s, 8) \
macro(status206, ":status"_s, "206"_s, 9) \
macro(status304, ":status"_s, "304"_s, 10) \
macro(status400, ":status"_s, "400"_s, 11) \
macro(status404, ":status"_s, "404"_s, 12) \
macro(status500, ":status"_s, "500"_s, 13) \
macro(acceptCharset, "accept-charset"_s, ""_s, 14) \
macro(acceptEncoding, "accept-encoding"_s, "gzip, deflate"_s, 15) \
macro(acceptLanguage, "accept-language"_s, ""_s, 16) \
macro(acceptRanges, "accept-ranges"_s, ""_s, 17) \
macro(accept, "accept"_s, ""_s, 18) \
macro(accessControlAllowOrigin, "access-control-allow-origin"_s, ""_s, 19) \
macro(age, "age"_s, ""_s, 20) \
macro(allow, "allow"_s, ""_s, 21) \
macro(authorization, "authorization"_s, ""_s, 22) \
macro(cacheControl, "cache-control"_s, ""_s, 23) \
macro(contentDisposition, "content-disposition"_s, ""_s, 24) \
macro(contentEncoding, "content-encoding"_s, ""_s, 25) \
macro(contentLanguage, "content-language"_s, ""_s, 26) \
macro(contentLength, "content-length"_s, ""_s, 27) \
macro(contentLocation, "content-location"_s, ""_s, 28) \
macro(contentRange, "content-range"_s, ""_s, 29) \
macro(contentType, "content-type"_s, ""_s, 30) \
macro(cookie, "cookie"_s, ""_s, 31) \
macro(date, "date"_s, ""_s, 32) \
macro(etag, "etag"_s, ""_s, 33) \
macro(expect, "expect"_s, ""_s, 34) \
macro(expires, "expires"_s, ""_s, 35) \
macro(from, "from"_s, ""_s, 36) \
macro(host, "host"_s, ""_s, 37) \
macro(ifMatch, "if-match"_s, ""_s, 38) \
macro(ifModifiedSince, "if-modified-since"_s, ""_s, 39) \
macro(ifNoneMatch, "if-none-match"_s, ""_s, 40) \
macro(ifRange, "if-range"_s, ""_s, 41) \
macro(ifUnmodifiedSince, "if-unmodified-since"_s, ""_s, 42) \
macro(lastModified, "last-modified"_s, ""_s, 43) \
macro(link, "link"_s, ""_s, 44) \
macro(location, "location"_s, ""_s, 45) \
macro(maxForwards, "max-forwards"_s, ""_s, 46) \
macro(proxyAuthenticate, "proxy-authenticate"_s, ""_s, 47) \
macro(proxyAuthorization, "proxy-authorization"_s, ""_s, 48) \
macro(range, "range"_s, ""_s, 49) \
macro(referer, "referer"_s, ""_s, 50) \
macro(refresh, "refresh"_s, ""_s, 51) \
macro(retryAfter, "retry-after"_s, ""_s, 52) \
macro(server, "server"_s, ""_s, 53) \
macro(setCookie, "set-cookie"_s, ""_s, 54) \
macro(strictTransportSecurity, "strict-transport-security"_s, ""_s, 55) \
macro(transferEncoding, "transfer-encoding"_s, ""_s, 56) \
macro(userAgent, "user-agent"_s, ""_s, 57) \
macro(vary, "vary"_s, ""_s, 58) \
macro(via, "via"_s, ""_s, 59) \
macro(wwwAuthenticate, "www-authenticate"_s, ""_s, 60)

// clang-format on

#define HTTP2_COMMON_STRINGS_ACCESSOR_DEFINITION(name, key, value, idx) \
    JSC::JSString* name##String(JSC::JSGlobalObject* globalObject)      \
    {                                                                   \
        return m_names[idx].getInitializedOnMainThread(globalObject);   \
    }

namespace Bun {

using namespace JSC;

class Http2CommonStrings {

public:
    typedef JSC::JSString* (*commonStringInitializer)(Http2CommonStrings*, JSC::JSGlobalObject* globalObject);

    HTTP2_COMMON_STRINGS_EACH_NAME(HTTP2_COMMON_STRINGS_ACCESSOR_DEFINITION)

    void initialize();

    template<typename Visitor>
    void visit(Visitor& visitor);

    JSC::JSString* getStringFromHPackIndex(uint16_t index, JSC::JSGlobalObject* globalObject)
    {
        if (index > 60) {
            return nullptr;
        }
        return m_names[index].getInitializedOnMainThread(globalObject);
    }

private:
    JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSString> m_names[61];
};

} // namespace Bun

#undef BUN_COMMON_STRINGS_ACCESSOR_DEFINITION
#undef BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION
