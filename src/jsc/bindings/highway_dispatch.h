#pragma once

// Include after <hwy/highway.h>.

#include <atomic>
#include <type_traits>

namespace bun {

inline void highwayChooseTarget()
{
    static const bool chosen = (hwy::GetChosenTarget().Update(hwy::SupportedTargets()), true);
    (void)chosen;
}

#if defined(__has_attribute)
#if __has_attribute(cold)
#define BUN_HWY_COLD __attribute__((cold))
#endif
#endif
#ifndef BUN_HWY_COLD
#define BUN_HWY_COLD
#endif

template<typename Choose, typename Pointer = std::remove_cvref_t<std::invoke_result_t<Choose>>>
struct HighwayDispatch;

template<typename Choose, typename Result, typename... Arguments, bool isNoexcept>
struct HighwayDispatch<Choose, Result (*)(Arguments...) noexcept(isNoexcept)> {
    // What `fn` is until the first call. Threads that get here at the same time store the same pointer.
    BUN_HWY_COLD HWY_NOINLINE static Result resolve(Arguments... arguments) noexcept(isNoexcept)
    {
        highwayChooseTarget();
        auto chosen = Choose {}();
        fn.store(chosen, std::memory_order_relaxed);
        return chosen(arguments...);
    }

    static constinit inline std::atomic<Result (*)(Arguments...) noexcept(isNoexcept)> fn { &resolve };
};

} // namespace bun

// Like HWY_DYNAMIC_DISPATCH(FUNC), but resolves the per-CPU table entry once
// per call site; later calls are a load and an indirect call instead of an
// out-of-line hwy::GetChosenTarget() call plus a table index every time.
// Resolving is a function of its own: LTO inlines the wrappers around this into
// thousands of callers, which get the load and the call and nothing else.
#define BUN_HWY_DISPATCH(FUNC) \
    (*::bun::HighwayDispatch<decltype([] { return HWY_DYNAMIC_POINTER(FUNC); })>::fn.load(std::memory_order_relaxed))
