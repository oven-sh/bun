#pragma once

#include "JSDOMConstructorBase.h"

namespace WebCore {

// document() is on the base class in Bun: a constructor gets its document from its window, not from the global object.
using JSDOMConstructorWithDocument = JSDOMConstructorBase;

} // namespace WebCore
