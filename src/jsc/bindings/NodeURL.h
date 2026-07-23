#include "config.h"
#include "ZigGlobalObject.h"

namespace Bun {

JSC::JSValue createNodeURLBinding(Zig::GlobalObject*);
JSC::JSValue createNodeICUBinding(Zig::GlobalObject*);

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
