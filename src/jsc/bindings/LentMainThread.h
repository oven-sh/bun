#pragma once

// src/runtime/desktop/main_thread.rs. Native addons run on the main thread, and what they call runs on JavaScript's.

#include "root.h"

extern "C" std::atomic<bool> Bun__isMainThreadLent;
extern "C" bool Bun__isOnLentMainThread();
extern "C" void Bun__enterLentMainThread(void (*)(void*), void*);
extern "C" void Bun__leaveLentMainThread(void (*)(void*), void*);

namespace Bun {

ALWAYS_INLINE bool isOnLentMainThread()
{
    return Bun__isMainThreadLent.load(std::memory_order_relaxed) && Bun__isOnLentMainThread();
}

template<typename Function>
auto callThrough(void (*door)(void (*)(void*), void*), const Function& function)
{
    decltype(function()) result {};
    auto call = [&] { result = function(); };
    door([](void* context) { (*static_cast<decltype(call)*>(context))(); }, &call);
    return result;
}

template<typename Function>
NEVER_INLINE auto onJSThread(const Function& function)
{
    return callThrough(Bun__leaveLentMainThread, function);
}

template<typename Function>
ALWAYS_INLINE auto onAddonThread(const Function& function)
{
    if (Bun__isMainThreadLent.load(std::memory_order_relaxed)) [[unlikely]]
        return callThrough(Bun__enterLentMainThread, function);
    return function();
}

}
