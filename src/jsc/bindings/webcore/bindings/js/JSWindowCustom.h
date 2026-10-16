#pragma once

#include "root.h"

namespace WebCore {

class Window;

// Has the window run its animation frame callbacks in a sixtieth of a second, on one of the runtime's timers.
void scheduleAnimationFrame(Window&, double delayInMilliseconds);

// setGlobalObjectWindow(window or null, isGlobalThis), for Bun's own JavaScript: `$newCppFunction("JSWindowCustom.cpp", "jsFunctionSetGlobalObjectWindow", 2)`.
// From then on the caller's global object is accepted wherever a Window is expected, and means that window.
// With `isGlobalThis` it also goes the other way: where native code hands that window to script, script gets `globalThis`.
// It is for test environments, where `window === globalThis`: `new MouseEvent("click", { view: window }).view === window`.
JSC_DECLARE_HOST_FUNCTION(jsFunctionSetGlobalObjectWindow);

} // namespace WebCore
