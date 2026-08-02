#pragma once

#include "root.h"

#include <wtf/Forward.h>

namespace Bun {

// Does any dot-separated label start with "xn--" (ASCII case-insensitive)?
bool domainHasACELabel(WTF::StringView domain);

// https://url.spec.whatwg.org/#concept-domain-to-ascii (beStrict = false); null on failure.
WTF::String domainToASCII(WTF::StringView domain);

// WTF::URLParser skips UTS-46 for all-ASCII hosts, so an invalid "xn--" label parses; re-check it here.
bool urlHostIsValidIDNA(const WTF::URL&);

} // namespace Bun
