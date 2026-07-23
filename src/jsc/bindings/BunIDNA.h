#pragma once

#include "root.h"

#include <wtf/Forward.h>

namespace Bun {

// Whether any dot-separated label of `domain` starts with the Punycode ACE
// prefix "xn--" (ASCII case-insensitive). Those are the only all-ASCII
// labels that UTS-46 "domain to ASCII" can reject.
bool domainHasACELabel(WTF::StringView domain);

// UTS-46 "domain to ASCII" with the URL Standard's options (beStrict = false):
// https://url.spec.whatwg.org/#concept-domain-to-ascii
// Returns a null String when `domain` is not a valid IDNA domain.
WTF::String domainToASCII(WTF::StringView domain);

// WTF::URLParser never runs UTS-46 on an all-ASCII host, so an "xn--" label
// that does not decode to a valid IDNA label parses successfully. The URL
// Standard's host parser requires that to fail; re-check such hosts here.
bool urlHostIsValidIDNA(const WTF::URL&);

} // namespace Bun
