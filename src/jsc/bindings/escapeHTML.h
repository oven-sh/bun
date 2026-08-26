#pragma once

#include "root.h"

namespace Bun {

// `Bun.escapeHTML(input)` — escape the five HTML metacharacters
// (& < > " ') in `input`, coercing non-string arguments to a string first.
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunEscapeHTML);

} // namespace Bun
