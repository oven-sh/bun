#pragma once

#include "root.h"

// bionic has no dlinfo(), and its dlopen() fails when an import is not defined.
#if (OS(LINUX) && !OS(ANDROID)) || OS(FREEBSD)

#include <wtf/text/WTFString.h>

namespace Bun {

// Binds the zlib imports of a dlopen()ed addon that nothing defines to Bun's zlib. Returns the first other lazily bound import that nothing defines, or a null String.
WTF::String unresolvedAddonImport(void* handle);

} // namespace Bun

#endif
