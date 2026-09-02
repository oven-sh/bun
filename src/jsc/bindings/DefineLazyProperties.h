#pragma once

#include "root.h"

namespace Bun {

// defineLazyProperties(target, keys, loader): like V8's SetLazyDataProperty, the first read stores loader(key).
JSC_DECLARE_HOST_FUNCTION(jsFunctionDefineLazyProperties);

} // namespace Bun
