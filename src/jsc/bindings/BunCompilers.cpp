#include "root.h"

#include "BunAOTCompile.h"

extern "C" bool Bun__AOT__hasCompiler()
{
#if ENABLE(AOT)
    return !JSC::isFeatureRemoved(Bun::Feature::ImageCompiler);
#else
    return false;
#endif
}
