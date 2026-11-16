#include "root.h"

#if !OS(WINDOWS)
#include <setjmp.h>

static thread_local jmp_buf* innermost;

// False if `run` was abandoned: its frames are gone, and what they owned is leaked.
extern "C" bool Bun__DesktopRecovery__run(void (*run)(void*), void* context)
{
    jmp_buf here;
    jmp_buf* volatile outer = innermost;
    if (_setjmp(here)) {
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
    _longjmp(*innermost, 1);
}
#endif
