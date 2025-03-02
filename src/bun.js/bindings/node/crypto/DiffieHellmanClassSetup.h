#pragma once

#include "root.h"
#include <JavaScriptCore/LazyClassStructure.h>

namespace Bun {

void setupDiffieHellmanClassStructure(JSC::LazyClassStructure::Initializer& init);
void setupDiffieHellmanGroupClassStructure(JSC::LazyClassStructure::Initializer& init);

} // namespace Bun