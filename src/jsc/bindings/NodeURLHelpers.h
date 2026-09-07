#pragma once

// IDNA/punycode helpers implemented in NodeURL.cpp, declared separately so
// WebCore-layer consumers (URLDecomposition.cpp, DOMURL.cpp) do not pull in
// ZigGlobalObject.h via NodeURL.h.

#include <wtf/Forward.h>

namespace Bun {

// True when every xn-- label in `host` is valid UTS #46 punycode.
bool hasValidPunycodeHost(WTF::StringView host);

} // namespace Bun
