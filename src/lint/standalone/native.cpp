// For the binaries that scripts/build/lint-standalone-native.ts links. In Bun this is `__bun_yarr_initialize` of src/jsc/RegularExpression.rs, which starts all of JavaScriptCore with Bun's options.
#include "root.h"
#include <JavaScriptCore/Options.h>
#include <wtf/Threading.h>

// A match asks WTF for the bounds of the stack and JavaScriptCore's options for how much it may remember.
extern "C" void __bun_yarr_initialize()
{
    WTF::initialize();
    JSC::Options::initialize([] {});
    JSC::Options::finalize();
}
