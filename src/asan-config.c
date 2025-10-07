#include "wtf/Compiler.h"

#if ASAN_ENABLED
const char* __asan_default_options(void)
{
    // detect_stack_use_after_return causes some stack allocations to be made on the heap instead,
    // which breaks some JSC classes that have to be on the stack:
    // ASSERTION FAILED: Thread::currentSingleton().stack().contains(this)
    // cache/webkit-eda8b0fb4fb1aa23/include/JavaScriptCore/JSGlobalObjectInlines.h(63) : JSC::JSGlobalObject::GlobalPropertyInfo::GlobalPropertyInfo(const Identifier &, JSValue, unsigned int)
    return "detect_stack_use_after_return=0";
}
#endif
