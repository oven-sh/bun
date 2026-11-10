#pragma once

#include <JavaScriptCore/AOTNativeTest.h>

#if ENABLE(AOT)

namespace JSC { namespace AOT {

std::span<const NativeTest> bunBuiltinCellsTests();
std::span<const NativeTest> bunBuiltinTableTests();
std::span<const NativeTest> bunClosedWorldTests();
std::span<const NativeTest> bunExportsThatStayInCompiledCodeTests();
std::span<const NativeTest> bunGlobalBindingProgramTests();
std::span<const NativeTest> bunNativeModuleExportTests();

} } // namespace JSC::AOT

#endif // ENABLE(AOT)
