#pragma once

#include <wtf/URL.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

// new URL(input, base) is very often called with the same base string over and over (a configured origin, the
// current request's URL); the last base that parsed and validated is kept here, one per VM (JSVMClientData).
struct DOMURLBaseCache {
    WTF::String input;
    WTF::URL url;
};

} // namespace WebCore
