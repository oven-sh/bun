#include <root.h>

using JSC::TopExceptionScope;

#if ENABLE(EXCEPTION_SCOPE_VERIFICATION)
#define ExpectedTopExceptionScopeSize 56
#define ExpectedTopExceptionScopeAlignment 8
#else
#define ExpectedTopExceptionScopeSize 8
#define ExpectedTopExceptionScopeAlignment 8
#endif

static_assert(sizeof(TopExceptionScope) == ExpectedTopExceptionScopeSize, "TopExceptionScope.zig assumes TopExceptionScope is 56 bytes");
static_assert(alignof(TopExceptionScope) == ExpectedTopExceptionScopeAlignment, "TopExceptionScope.zig assumes TopExceptionScope is 8-byte aligned");

extern "C" void TopExceptionScope__construct(
    void* ptr,
    JSC::JSGlobalObject* globalObject,
    const char* function,
    const char* file,
    unsigned line,
    size_t size,
    size_t alignment)
{
    // validate that Zig is correct about what the size and alignment should be
    ASSERT(size >= sizeof(TopExceptionScope));
    ASSERT(alignment >= alignof(TopExceptionScope));
    ASSERT((uintptr_t)ptr % alignment == 0);

#if ENABLE(EXCEPTION_SCOPE_VERIFICATION)
    new (ptr) JSC::TopExceptionScope(JSC::getVM(globalObject),
        JSC::ExceptionEventLocation { currentStackPointer(), function, file, line });
#else
    (void)function;
    (void)file;
    (void)line;
    new (ptr) JSC::TopExceptionScope(JSC::getVM(globalObject));
#endif
}

extern "C" JSC::Exception* TopExceptionScope__pureException(void* ptr)
{
    ASSERT((uintptr_t)ptr % alignof(TopExceptionScope) == 0);
    return static_cast<TopExceptionScope*>(ptr)->exception();
}

extern "C" JSC::Exception* TopExceptionScope__exceptionIncludingTraps(void* ptr)
{
    ASSERT((uintptr_t)ptr % alignof(TopExceptionScope) == 0);
    auto* scope = static_cast<TopExceptionScope*>(ptr);
    // this is different than `return scope->exception()` because `RETURN_IF_EXCEPTION` also checks
    // if there are traps that should throw an exception (like a termination request from another
    // thread)
    RETURN_IF_EXCEPTION(*scope, scope->exception());
    return nullptr;
}

extern "C" void TopExceptionScope__clearException(void* ptr)
{
    ASSERT((uintptr_t)ptr % alignof(TopExceptionScope) == 0);
    auto* scope = static_cast<TopExceptionScope*>(ptr);
    scope->clearException();
}

extern "C" void TopExceptionScope__destruct(void* ptr)
{
    ASSERT((uintptr_t)ptr % alignof(TopExceptionScope) == 0);
    static_cast<TopExceptionScope*>(ptr)->~TopExceptionScope();
}

extern "C" void TopExceptionScope__assertNoException(void* ptr)
{
    ASSERT((uintptr_t)ptr % alignof(TopExceptionScope) == 0);
    // this function assumes it should assert in all build modes, anything else would be confusing.
    // Zig should only call TopExceptionScope__assertNoException if it wants the assertion.
    static_cast<TopExceptionScope*>(ptr)->releaseAssertNoException();
}
