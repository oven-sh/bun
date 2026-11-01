// HWY_TARGET=<name> in the environment makes every program here use the kernels for that target (SSSE3, AVX2) and not
// the best one the CPU has. The CPU has to have it. For a target that highway_jpeg.cpp leaves out, that is SSSE3.
#include <hwy/targets.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

namespace {
struct ChooseTarget {
    ChooseTarget()
    {
        const char* name = getenv("HWY_TARGET");
        if (!name) return;
        for (int bit = 0; bit < 63; bit++) {
            if (!strcmp(hwy::TargetName(int64_t { 1 } << bit), name)) {
                if (!(hwy::SupportedTargets() & int64_t { 1 } << bit)) break;
                hwy::SetSupportedTargetsForTest(int64_t { 1 } << bit);
                return;
            }
        }
        fprintf(stderr, "HWY_TARGET=%s: not a target of this CPU\n", name);
        abort();
    }
} chooseTarget;
}
