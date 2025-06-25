#include <root.h>

using JSC::CatchScope;

extern "C" void CatchScope__construct(
    void* ptr,
    JSC::JSGlobalObject* globalObject,
    const char* function,
    const char* file,
    unsigned line,
    size_t size,
    size_t alignment)
{
    // validate that Zig is correct about what the size and alignment should be
    ASSERT(size >= sizeof(CatchScope));
    ASSERT(alignment >= alignof(CatchScope));
    ASSERT((uintptr_t)ptr % alignment == 0);

#if ENABLE(EXCEPTION_SCOPE_VERIFICATION)
    new (ptr) JSC::CatchScope(JSC::getVM(globalObject),
        JSC::ExceptionEventLocation { currentStackPointer(), function, file, line });
#else
    (void)function;
    (void)file;
    (void)line;
    new (ptr) JSC::CatchScope(JSC::getVM(globalObject));
#endif
}

extern "C" JSC::Exception* CatchScope__pureException(void* ptr)
{
    ASSERT((uintptr_t)ptr % alignof(CatchScope) == 0);
    return static_cast<CatchScope*>(ptr)->exception();
}

extern "C" JSC::Exception* CatchScope__exceptionIncludingTraps(void* ptr)
{
    ASSERT((uintptr_t)ptr % alignof(CatchScope) == 0);
    auto* scope = static_cast<CatchScope*>(ptr);
    // this is different than `return scope->exception()` because `RETURN_IF_EXCEPTION` also checks
    // if there are traps that should throw an exception (like a termination request from another
    // thread)
    RETURN_IF_EXCEPTION(*scope, scope->exception());
    return nullptr;
}

extern "C" void CatchScope__destruct(void* ptr)
{
    ASSERT((uintptr_t)ptr % alignof(CatchScope) == 0);
    static_cast<CatchScope*>(ptr)->~CatchScope();
}

extern "C" void CatchScope__assertNoException(void* ptr)
{
    ASSERT((uintptr_t)ptr % alignof(CatchScope) == 0);
    static_cast<CatchScope*>(ptr)->assertNoException();
}
