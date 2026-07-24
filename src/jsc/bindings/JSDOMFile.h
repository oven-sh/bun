#pragma once

#include "root.h"
#include <JavaScriptCore/LazyClassStructure.h>

namespace Bun {
void initJSDOMFileClassStructure(JSC::LazyClassStructure::Initializer&);
}
