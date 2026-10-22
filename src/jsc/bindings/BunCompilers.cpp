#include "root.h"

#include "BunAOTCompile.h"

extern "C" bool Bun__AOT__hasCompiler()
{
    return !JSC::isFeatureRemoved(JSC::RemovableFeature::ImageCompiler);
}
