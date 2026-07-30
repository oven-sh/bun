#include "config.h"
// The ActiveDOMObject class was removed (every line was commented out and
// nothing referenced it). This file is kept as an empty translation unit so
// the unified-source bundle composition (scripts/build/unified.ts) does not
// shift for the ~130 other webcore/*.cpp files, which would rebuild the
// world and can surface latent include-order or using-namespace leaks.
