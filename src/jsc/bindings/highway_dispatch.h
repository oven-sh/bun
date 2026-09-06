#pragma once

// Include after <hwy/highway.h>.

namespace bun {

inline void highwayChooseTarget()
{
    static const bool chosen = (hwy::GetChosenTarget().Update(hwy::SupportedTargets()), true);
    (void)chosen;
}

} // namespace bun

// Like HWY_DYNAMIC_DISPATCH(FUNC), but resolves the per-CPU table entry once
// per call site; later calls are a guard load and an indirect call instead of
// an out-of-line hwy::GetChosenTarget() call plus a table index every time.
#define BUN_HWY_DISPATCH(FUNC) \
    (*([]() { static const auto fn = (::bun::highwayChooseTarget(), HWY_DYNAMIC_POINTER(FUNC)); return fn; }()))
