#pragma once

// IDNA/punycode helpers implemented in NodeURL.cpp, declared separately so
// WebCore-layer consumers (URLDecomposition.cpp, DOMURL.cpp) do not pull in
// ZigGlobalObject.h via NodeURL.h.

#include <wtf/Forward.h>

namespace Bun {

// True when every xn-- label in `host` is valid UTS #46 punycode.
bool hasValidPunycodeHost(WTF::StringView host);

// The WHATWG parser (WebKit) fast-paths all-ASCII hosts without validating
// xn-- labels; Node's ada rejects invalid punycode in special-scheme hosts.
// `input` is the string `url` was parsed from (a base URL's host was checked
// when the base was parsed). Every URL intake that must agree with `new URL`
// (fetch, Request, WebSocket) calls this after `isValid()`.
bool hasValidParsedHost(const WTF::URL& url, const WTF::String& input);

} // namespace Bun
