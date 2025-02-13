#include "root.h"

namespace Bun {
namespace ProcessBindingTimers {

// Node.js has some tests that check whether timers fire at the right time. They check this with
// the internal binding `getLibuvNow()`, which returns an integer in milliseconds. This works
// because `getLibuvNow()` is also the clock that their timers implementation uses to choose when to
// schedule timers.
//
// I've tried changing those tests to use `performance.now()` or `Date.now()`. But that always
// introduces spurious failures, because neither of those functions use the same clock that the
// timers implementation uses (for Bun this is `bun.timespec.now()`), so the tests end up thinking
// that the timing is wrong (this also happens when I run the modified test in Node.js). So the best
// course of action is for Bun to also expose a function that reveals the clock that is used to
// schedule timers.
//
// In Node.js, this is accessed via:
//
//     const { internalBinding } = require("internal/test/binding");
//     const binding = internalBinding("timers");
//     binding.getLibuvNow();
//
// Bun doesn't have `require("internal/test/binding")`, so I've instead exposed this as
// `process.binding("timers").getLibuvNow()`. Node.js doesn't have `process.binding("timers")`, so
// it doesn't conflict with anything, and there is already precedent ("crypto/x509") for us
// supporting `process.binding` modules that Node.js doesn't.
JSC_DECLARE_HOST_FUNCTION(jsGetLibuvNow);

// Create an object containing the `getLibuvNow()` function (the object that
// `process.binding("timers")` should return)
JSC::JSObject* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

} // namespace ProcessBindingTimers
} // namespace Bun
