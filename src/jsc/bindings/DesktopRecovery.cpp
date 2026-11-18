#include "root.h"

#include <setjmp.h>

#if OS(WINDOWS) && CPU(ARM64)
// Its longjmp always unwinds.
using Mark = uint64_t[21];
#define EACH_PAIR(instruction) \
    instruction " x19, x20, [x0]\n" instruction " x21, x22, [x0, #16]\n" instruction " x23, x24, [x0, #32]\n" instruction " x25, x26, [x0, #48]\n" instruction " x27, x28, [x0, #64]\n" instruction " x29, x30, [x0, #80]\n" instruction " d8, d9, [x0, #96]\n" instruction " d10, d11, [x0, #112]\n" instruction " d12, d13, [x0, #128]\n" instruction " d14, d15, [x0, #144]\n"

__attribute__((naked, returns_twice)) static int SET_MARK(Mark)
{
    asm(EACH_PAIR("stp") "mov x1, sp\n str x1, [x0, #160]\n mov w0, wzr\n ret");
}

[[noreturn]] __attribute__((naked)) static void RETURN_TO_MARK(Mark, int)
{
    asm(EACH_PAIR("ldp") "ldr x0, [x0, #160]\n mov sp, x0\n mov w0, w1\n ret");
}
#elif OS(WINDOWS)
using Mark = jmp_buf;
#define SET_MARK setjmp
// Without a frame, it does not unwind.
#define RETURN_TO_MARK(mark, value) (reinterpret_cast<_JUMP_BUFFER*>(mark)->Frame = 0, longjmp(mark, value))
#elif CPU(X86_64) && !ASAN_ENABLED
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
