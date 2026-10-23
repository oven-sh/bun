#include "root.h"

#include "BunAOTCompile.h"

extern "C" bool Bun__AOT__hasCompiler()
{
#if ENABLE(AOT)
    return !JSC::isFeatureRemoved(JSC::RemovableFeature::ImageCompiler);
#else
    return false;
#endif
}
