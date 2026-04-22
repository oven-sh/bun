#pragma once

// PCH source — see scripts/build/bun.ts. This is what actually gets
// precompiled; .cpp files include "root.h", and the build force-includes
// this via -Xclang -include so the PCH covers it.
//
// Kept separate from root.h so the heavy headers below are only pulled when
// root.h is guaranteed to be the first thing parsed (the PCH wrapper
// force-includes it). If they lived in root.h itself, a TU whose first
// explicit include is BunClientData.h would re-enter root.h mid-parse and
// reach ZigGlobalObject.h before WebCore::clientData() is declared. The PCH
// path is fine; Windows (no PCH yet) and --unifiedSources=false would not be.

#include "root.h"

// #include'd by the vast majority of TUs and cost ~1.1s each to parse
// (-ftime-trace). Editing either already triggers a near-full rebuild via
// depfiles, so precompiling them costs nothing extra incrementally.
#include "BunClientData.h"
#include "ZigGlobalObject.h"
