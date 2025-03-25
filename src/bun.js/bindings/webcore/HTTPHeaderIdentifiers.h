#pragma once

#include <wtf/Forward.h>
#include "HTTPHeaderNames.h"

namespace WebCore {
// clang-format off
#define HTTP_HEADERS_EACH_NAME(macro)                                                       \
    macro("Accept", Accept)                                                                \
    macro("Accept-Charset", AcceptCharset)                                                 \
    macro("Accept-Encoding", AcceptEncoding)                                               \
    macro("Accept-Language", AcceptLanguage)                                               \
    macro("Accept-Ranges", AcceptRanges)                                                   \
    macro("Access-Control-Allow-Credentials", AccessControlAllowCredentials)               \
    macro("Access-Control-Allow-Headers", AccessControlAllowHeaders)                       \
    macro("Access-Control-Allow-Methods", AccessControlAllowMethods)                       \
    macro("Access-Control-Allow-Origin", AccessControlAllowOrigin)                         \
    macro("Access-Control-Expose-Headers", AccessControlExposeHeaders)                     \
    macro("Access-Control-Max-Age", AccessControlMaxAge)                                   \
    macro("Access-Control-Request-Headers", AccessControlRequestHeaders)                   \
    macro("Access-Control-Request-Method", AccessControlRequestMethod)                     \
    macro("Age", Age)                                                                      \
    macro("Authorization", Authorization)                                                  \
    macro("Cache-Control", CacheControl)                                                   \
    macro("Connection", Connection)                                                        \
    macro("Content-Disposition", ContentDisposition)                                       \
    macro("Content-Encoding", ContentEncoding)                                             \
    macro("Content-Language", ContentLanguage)                                             \
    macro("Content-Length", ContentLength)                                                 \
    macro("Content-Location", ContentLocation)                                             \
    macro("Content-Range", ContentRange)                                                   \
    macro("Content-Security-Policy", ContentSecurityPolicy)                                \
    macro("Content-Security-Policy-Report-Only", ContentSecurityPolicyReportOnly)          \
    macro("Content-Type", ContentType)                                                     \
    macro("Cookie", Cookie)                                                                \
    macro("Cookie2", Cookie2)                                                              \
    macro("Cross-Origin-Embedder-Policy", CrossOriginEmbedderPolicy)                       \
    macro("Cross-Origin-Embedder-Policy-Report-Only", CrossOriginEmbedderPolicyReportOnly) \
    macro("Cross-Origin-Opener-Policy", CrossOriginOpenerPolicy)                           \
    macro("Cross-Origin-Opener-Policy-Report-Only", CrossOriginOpenerPolicyReportOnly)     \
    macro("Cross-Origin-Resource-Policy", CrossOriginResourcePolicy)                       \
    macro("DNT", DNT)                                                                      \
    macro("Date", Date)                                                                    \
    macro("Default-Style", DefaultStyle)                                                   \
    macro("ETag", ETag)                                                                    \
    macro("Expect", Expect)                                                                \
    macro("Expires", Expires)                                                              \
    macro("Host", Host)                                                                    \
    macro("Icy-MetaInt", IcyMetaInt)                                                       \
    macro("Icy-Metadata", IcyMetadata)                                                     \
    macro("If-Match", IfMatch)                                                             \
    macro("If-Modified-Since", IfModifiedSince)                                            \
    macro("If-None-Match", IfNoneMatch)                                                    \
    macro("If-Range", IfRange)                                                             \
    macro("If-Unmodified-Since", IfUnmodifiedSince)                                        \
    macro("Keep-Alive", KeepAlive)                                                         \
    macro("Last-Event-ID", LastEventID)                                                    \
    macro("Last-Modified", LastModified)                                                   \
    macro("Link", Link)                                                                    \
    macro("Location", Location)                                                            \
    macro("Origin", Origin)                                                                \
    macro("Ping-From", PingFrom)                                                           \
    macro("Ping-To", PingTo)                                                               \
    macro("Pragma", Pragma)                                                                \
    macro("Proxy-Authorization", ProxyAuthorization)                                       \
    macro("Purpose", Purpose)                                                              \
    macro("Range", Range)                                                                  \
    macro("Referer", Referer)                                                              \
    macro("Referrer-Policy", ReferrerPolicy)                                               \
    macro("Refresh", Refresh)                                                              \
    macro("Report-To", ReportTo)                                                           \
    macro("Sec-Fetch-Dest", SecFetchDest)                                                  \
    macro("Sec-Fetch-Mode", SecFetchMode)                                                  \
    macro("Sec-WebSocket-Accept", SecWebSocketAccept)                                      \
    macro("Sec-WebSocket-Extensions", SecWebSocketExtensions)                              \
    macro("Sec-WebSocket-Key", SecWebSocketKey)                                            \
    macro("Sec-WebSocket-Protocol", SecWebSocketProtocol)                                  \
    macro("Sec-WebSocket-Version", SecWebSocketVersion)                                    \
    macro("Server-Timing", ServerTiming)                                                   \
    macro("Service-Worker", ServiceWorker)                                                 \
    macro("Service-Worker-Allowed", ServiceWorkerAllowed)                                  \
    macro("Service-Worker-Navigation-Preload", ServiceWorkerNavigationPreload)             \
    macro("Set-Cookie", SetCookie)                                                         \
    macro("Set-Cookie2", SetCookie2)                                                       \
    macro("SourceMap", SourceMap)                                                          \
    macro("Strict-Transport-Security", StrictTransportSecurity)                            \
    macro("TE", TE)                                                                        \
    macro("Timing-Allow-Origin", TimingAllowOrigin)                                        \
    macro("Trailer", Trailer)                                                              \
    macro("Transfer-Encoding", TransferEncoding)                                           \
    macro("Upgrade", Upgrade)                                                              \
    macro("Upgrade-Insecure-Requests", UpgradeInsecureRequests)                            \
    macro("User-Agent", UserAgent)                                                         \
    macro("Vary", Vary)                                                                    \
    macro("Via", Via)                                                                      \
    macro("X-Content-Type-Options", XContentTypeOptions)                                   \
    macro("X-DNS-Prefetch-Control", XDNSPrefetchControl)                                   \
    macro("X-Frame-Options", XFrameOptions)                                                \
    macro("X-SourceMap", XSourceMap)                                                       \
    macro("X-Temp-Tablet", XTempTablet)                                                    \
    macro("X-XSS-Protection", XXSSProtection)
// clang-format on

#define HTTP_HEADERS_ACCESSOR_DECLARATIONS(literal, name) \
    JSC::Identifier& name##Identifier(JSC::VM& vm);       \
    JSC::JSString* name##String(JSC::JSGlobalObject* globalObject);

#define HTTP_HEADERS_PROPERTY_DECLARATIONS(literal, name)                   \
    JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSString> m_##name##String; \
    JSC::Identifier m_##name##Identifier;

class HTTPHeaderIdentifiers {
public:
    HTTP_HEADERS_EACH_NAME(HTTP_HEADERS_ACCESSOR_DECLARATIONS)

    HTTPHeaderIdentifiers();

    JSC::Identifier& identifierFor(JSC::VM&, HTTPHeaderName);
    JSC::JSString* stringFor(JSC::JSGlobalObject*, HTTPHeaderName);

    template<typename Visitor>
    void visit(Visitor& visitor);

private:
    HTTP_HEADERS_EACH_NAME(HTTP_HEADERS_PROPERTY_DECLARATIONS)
};

} // namespace WebCore

#undef HTTP_HEADERS_ACCESSOR_DECLARATIONS
#undef HTTP_HEADERS_PROPERTY_DECLARATIONS
