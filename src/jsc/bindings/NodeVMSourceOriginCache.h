#pragma once

#include <wtf/URL.h>
#include <wtf/text/WTFString.h>

namespace Bun {

// The last filename node:vm made into a file: URL origin, and that URL, per VM; see NodeVM::sourceOriginURL().
struct NodeVMSourceOriginCache {
    WTF::String filename;
    WTF::URL url;
};

} // namespace Bun
