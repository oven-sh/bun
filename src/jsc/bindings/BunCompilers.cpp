#include "root.h"

#include "BunAOTCompile.h"

#if defined(BUN_WEBKIT_ENABLE_AOT) && BUN_WEBKIT_ENABLE_AOT != ENABLE_AOT
#error "This JavaScriptCore was built with another ENABLE_AOT than Bun is being built with (--aot)"
#endif

extern "C" bool Bun__AOT__hasCompiler()
{
#if ENABLE(AOT)
    return !JSC::isFeatureRemoved(JSC::RemovableFeature::ImageCompiler);
#else
    return false;
#endif
}
