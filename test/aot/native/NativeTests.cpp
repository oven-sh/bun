#include "root.h"

#include "NativeTests.h"

#if ENABLE(AOT)

namespace JSC { namespace AOT {

std::span<const NativeTestProvider> nativeTestProvidersOfHost()
{
    static constexpr NativeTestProvider providers[] = {
        &bunBuiltinCellsTests,
        &bunBuiltinTableTests,
        &bunClosedWorldTests,
        &bunExportsThatStayInCompiledCodeTests,
        &bunGlobalBindingProgramTests,
        &bunNativeModuleExportTests,
    };
    return providers;
}

} } // namespace JSC::AOT

#endif // ENABLE(AOT)
