#pragma once

#include <wtf/URL.h>
#include <wtf/text/WTFString.h>

namespace Bun {

// node:vm gives every Script and compiled function a file: URL origin made from its filename. A program that
// compiles many of them usually gives them all one filename, or none, which is one default name. The last filename
// made into a URL is kept here, one per VM (JSVMClientData); see NodeVM::sourceOriginURL().
struct NodeVMSourceOriginCache {
    WTF::String filename;
    WTF::URL url;
};

} // namespace Bun
