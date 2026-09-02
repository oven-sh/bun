#pragma once

#include "root.h"

namespace Bun {

// defineLazyProperties(target, keys, loader): defines each key on target as a
// lazy data property. The first read calls loader(key) and stores the result
// as a plain writable, enumerable, configurable data property. Until then the
// property is a JSC CustomValue, which Object.getOwnPropertyDescriptor reports
// as a data descriptor, so descriptor-based wrappers (sinon, spyOn) see a
// function `value` and not an accessor. Mirrors node's SetLazyDataProperty.
JSC_DECLARE_HOST_FUNCTION(jsFunctionDefineLazyProperties);

} // namespace Bun
