#pragma once

// IDNA/punycode helpers implemented in NodeURL.cpp, declared separately so
// WebCore-layer consumers (URLDecomposition.cpp, DOMURL.cpp) do not pull in
// ZigGlobalObject.h via NodeURL.h.

#include <wtf/Forward.h>

namespace Bun {

// True when every xn-- label in `host` is valid UTS #46 punycode.
bool hasValidPunycodeHost(WTF::StringView host);

// True when `view` contains a source code unit of the Unicode 15.1/16.0
// IdnaMappingTable delta (see applyUnicode16IDNADelta in NodeURL.cpp).
bool containsUnicode16IDNADeltaSource(WTF::StringView view);

// Applies the Unicode 15.1/16.0 IdnaMappingTable delta so IDNA results match
// node v26 (ada::idna) regardless of the platform ICU data version. Returns
// the input unchanged when no delta source is present.
WTF::String applyUnicode16IDNADelta(const WTF::String& input);

} // namespace Bun
