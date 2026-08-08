#include "root.h"
#include "ZigSourceProvider.h"
#include "CodeCoverage.h"
#include <JavaScriptCore/ControlFlowProfiler.h>

using namespace JSC;

extern "C" bool CodeCoverage__withBlocksAndFunctions(
    JSC::VM* vmPtr,
    JSC::SourceID sourceID,
    void* ctx,
    bool ignoreSourceMap,
    void (*blockCallback)(void* ctx, JSC::BasicBlockRange* range, size_t len, size_t functionOffset, bool ignoreSourceMap))
{

    VM& vm = *vmPtr;

    auto basicBlocks = vm.controlFlowProfiler()->getBasicBlocksForSourceIDWithoutFunctionRange(
        sourceID, vm);

    if (basicBlocks.isEmpty()) {
        blockCallback(ctx, nullptr, 0, 0, ignoreSourceMap);
        return true;
    }

    size_t functionStartOffset = basicBlocks.size();

    Bun::appendFunctionRangesForCoverage(basicBlocks, vm, sourceID);

    blockCallback(ctx, basicBlocks.begin(), basicBlocks.size(), functionStartOffset, ignoreSourceMap);
    return true;
}
