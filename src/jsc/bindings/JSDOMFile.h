#pragma once

#include "root.h"
#include <JavaScriptCore/LazyClassStructure.h>

namespace Bun {
void setupJSDOMFileClassStructure(JSC::LazyClassStructure::Initializer&);
}
