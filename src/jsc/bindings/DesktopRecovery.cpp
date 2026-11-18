#include "root.h"

#if !OS(WINDOWS)
#include <setjmp.h>

#if CPU(X86_64) && !ASAN_ENABLED
using Mark = void* [5];
#define SET_MARK __builtin_setjmp
#define RETURN_TO_MARK __builtin_longjmp
#else
using Mark = jmp_buf;
#define SET_MARK _setjmp
#define RETURN_TO_MARK _longjmp
#endif

static thread_local Mark* innermost;

// False if `run` was abandoned: its frames are gone, and what they owned is leaked.
// The optimizer does not know that __builtin_setjmp returns twice, so this frame is shared neither with the caller nor with `run`.
extern "C" NEVER_INLINE bool Bun__DesktopRecovery__run(void (*run)(void*), void* context)
{
    asm("" : "+r"(run));
    Mark here;
    Mark* volatile outer = innermost;
    if (SET_MARK(here)) {
        innermost = outer;
        return false;
    }
    innermost = &here;
    run(context);
    innermost = outer;
    return true;
}

extern "C" bool Bun__DesktopRecovery__isRunning()
{
    return innermost;
}

extern "C" [[noreturn]] void Bun__DesktopRecovery__abandon()
{
    RETURN_TO_MARK(*innermost, 1);
}
#endif
