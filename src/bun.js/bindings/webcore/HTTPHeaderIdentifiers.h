#pragma once

#include <wtf/Forward.h>
#include "HTTPHeaderNames.h"

namespace WebCore {
// clang-format off
#define HTTP_HEADERS_EACH_NAME(macro)                                                       \
    macro("accept", Accept)                                                                \
    macro("accept-charset", AcceptCharset)                                                 \
    macro("accept-encoding", AcceptEncoding)                                               \
    macro("accept-language", AcceptLanguage)                                               \
    macro("accept-ranges", AcceptRanges)                                                   \
    macro("access-control-allow-credentials", AccessControlAllowCredentials)               \
    macro("access-control-allow-headers", AccessControlAllowHeaders)                       \
    macro("access-control-allow-methods", AccessControlAllowMethods)                       \
    macro("access-control-allow-origin", AccessControlAllowOrigin)                         \
    macro("access-control-expose-headers", AccessControlExposeHeaders)                     \
    macro("access-control-max-age", AccessControlMaxAge)                                   \
    macro("access-control-request-headers", AccessControlRequestHeaders)                   \
    macro("access-control-request-method", AccessControlRequestMethod)                     \
    macro("age", Age)                                                                      \
    macro("authorization", Authorization)                                                  \
    macro("cache-control", CacheControl)                                                   \
    macro("connection", Connection)                                                        \
    macro("content-disposition", ContentDisposition)                                       \
    macro("content-encoding", ContentEncoding)                                             \
    macro("content-language", ContentLanguage)                                             \
    macro("content-length", ContentLength)                                                 \
    macro("content-location", ContentLocation)                                             \
    macro("content-range", ContentRange)                                                   \
    macro("content-security-policy", ContentSecurityPolicy)                                \
    macro("content-security-policy-report-only", ContentSecurityPolicyReportOnly)          \
    macro("content-type", ContentType)                                                     \
    macro("cookie", Cookie)                                                                \
    macro("cookie2", Cookie2)                                                              \
    macro("cross-origin-embedder-policy", CrossOriginEmbedderPolicy)                       \
    macro("cross-origin-embedder-policy-report-only", CrossOriginEmbedderPolicyReportOnly) \
    macro("cross-origin-opener-policy", CrossOriginOpenerPolicy)                           \
    macro("cross-origin-opener-policy-report-only", CrossOriginOpenerPolicyReportOnly)     \
    macro("cross-origin-resource-policy", CrossOriginResourcePolicy)                       \
    macro("dnt", DNT)                                                                      \
    macro("date", Date)                                                                    \
    macro("default-style", DefaultStyle)                                                   \
    macro("etag", ETag)                                                                    \
    macro("expect", Expect)                                                                \
    macro("expires", Expires)                                                              \
    macro("host", Host)                                                                    \
    macro("icy-metaint", IcyMetaInt)                                                       \
    macro("icy-metadata", IcyMetadata)                                                     \
    macro("if-match", IfMatch)                                                             \
    macro("if-modified-since", IfModifiedSince)                                            \
    macro("if-none-match", IfNoneMatch)                                                    \
    macro("if-range", IfRange)                                                             \
    macro("if-unmodified-since", IfUnmodifiedSince)                                        \
    macro("keep-alive", KeepAlive)                                                         \
    macro("last-event-id", LastEventID)                                                    \
    macro("last-modified", LastModified)                                                   \
    macro("link", Link)                                                                    \
    macro("location", Location)                                                            \
    macro("origin", Origin)                                                                \
    macro("ping-from", PingFrom)                                                           \
    macro("ping-to", PingTo)                                                               \
    macro("pragma", Pragma)                                                                \
    macro("proxy-authorization", ProxyAuthorization)                                       \
    macro("purpose", Purpose)                                                              \
    macro("range", Range)                                                                  \
    macro("referer", Referer)                                                              \
    macro("referrer-policy", ReferrerPolicy)                                               \
    macro("refresh", Refresh)                                                              \
    macro("report-to", ReportTo)                                                           \
    macro("sec-fetch-dest", SecFetchDest)                                                  \
    macro("sec-fetch-mode", SecFetchMode)                                                  \
    macro("sec-websocket-accept", SecWebSocketAccept)                                      \
    macro("sec-websocket-extensions", SecWebSocketExtensions)                              \
    macro("sec-websocket-key", SecWebSocketKey)                                            \
    macro("sec-websocket-protocol", SecWebSocketProtocol)                                  \
    macro("sec-websocket-version", SecWebSocketVersion)                                    \
    macro("server-timing", ServerTiming)                                                   \
    macro("service-worker", ServiceWorker)                                                 \
    macro("service-worker-allowed", ServiceWorkerAllowed)                                  \
    macro("service-worker-navigation-preload", ServiceWorkerNavigationPreload)             \
    macro("set-cookie", SetCookie)                                                         \
    macro("set-cookie2", SetCookie2)                                                       \
    macro("sourcemap", SourceMap)                                                          \
    macro("strict-transport-security", StrictTransportSecurity)                            \
    macro("te", TE)                                                                        \
    macro("timing-allow-origin", TimingAllowOrigin)                                        \
    macro("trailer", Trailer)                                                              \
    macro("transfer-encoding", TransferEncoding)                                           \
    macro("upgrade", Upgrade)                                                              \
    macro("upgrade-insecure-requests", UpgradeInsecureRequests)                            \
    macro("user-agent", UserAgent)                                                         \
    macro("vary", Vary)                                                                    \
    macro("via", Via)                                                                      \
    macro("x-content-type-options", XContentTypeOptions)                                   \
    macro("x-dns-prefetch-control", XDNSPrefetchControl)                                   \
    macro("x-frame-options", XFrameOptions)                                                \
    macro("x-sourcemap", XSourceMap)                                                       \
    macro("x-temp-tablet", XTempTablet)                                                    \
    macro("x-xss-protection", XXSSProtection)
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
