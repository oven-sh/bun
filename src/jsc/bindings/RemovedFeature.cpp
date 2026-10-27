#include "root.h"
#include <JavaScriptCore/AOTRemovableFeature.h>

// JavaScriptCore asks the program that links it which of its features were removed from the executable.
// Nothing removes any from Bun, so nothing calls these functions.
namespace JSC {

extern "C" const char* Bun__removableFeatureName(uint16_t feature);

extern "C" const RemovableFeatureState Bun__removableFeatureState {};

extern "C" void Bun__abortForRemovedFeature(uint16_t)
{
    CRASH();
}

extern "C" EncodedJSValue Bun__throwForRemovedFeature(JSGlobalObject*, uint16_t)
{
    CRASH();
}

extern "C" EncodedJSValue Bun__throwForRemovedBuiltin(JSGlobalObject*, uint16_t, uint32_t)
{
    CRASH();
}

extern "C" EncodedJSValue Bun__throwForRemovedFunction(JSGlobalObject*, uint16_t, StringImpl*)
{
    CRASH();
}

extern "C" const char* Bun__removableFeatureName(uint16_t)
{
    return nullptr;
}

} // namespace JSC
