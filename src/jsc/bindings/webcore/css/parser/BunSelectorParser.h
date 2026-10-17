#pragma once

#include "CSSSelectorList.h"
#include <optional>
#include <wtf/Forward.h>

namespace WebCore {

// Parses with Bun's CSS parser. Returns nothing if the string is not a valid selector list.
// The result depends on the document's mode: ids and classes are lowercased in quirks mode.
std::optional<CSSSelectorList> parseCSSSelectorList(const String&, bool inQuirksMode);

} // namespace WebCore
