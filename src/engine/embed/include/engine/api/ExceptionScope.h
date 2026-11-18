#pragma once

// Throwing, and looking for what has been thrown.

#include "engine/api/Visitor.h"

namespace JSC {

#if ENABLE(EXCEPTION_SCOPE_VERIFICATION)
#define EXCEPTION_ASSERT(assertion) RELEASE_ASSERT(assertion)
#define EXCEPTION_ASSERT_UNUSED(variable, assertion) RELEASE_ASSERT(assertion)
#define ENGINE_SCOPE_ARGUMENTS(vm) \
    (vm), JSC::ExceptionEventLocation { currentStackPointer(), __FUNCTION__, __FILE__, __LINE__ }
#else
#define EXCEPTION_ASSERT(assertion) ASSERT(assertion)
#define EXCEPTION_ASSERT_UNUSED(variable, assertion) ASSERT_UNUSED(variable, assertion)
#define ENGINE_SCOPE_ARGUMENTS(vm) (vm)
#endif

// With verification, a function that has a ThrowScope counts as having thrown, and its caller has to look before it goes on.
class ExceptionScope {
    WTF_MAKE_NONCOPYABLE(ExceptionScope);

public:
    ALWAYS_INLINE VM& vm() const { return m_vm; }
    ALWAYS_INLINE Exception* exception() const
    {
        didCheck();
        return m_vm.m_exception;
    }

    void assertNoException() { EXCEPTION_ASSERT(!exception()); }
    void releaseAssertNoException() { RELEASE_ASSERT(!exception()); }
    void assertNoExceptionExceptTermination() { EXCEPTION_ASSERT(!exception() || m_vm.hasPendingTerminationException()); }

    // False if it is the one that ends execution, which stays.
    [[nodiscard]] ALWAYS_INLINE bool tryClearException()
    {
        didCheck();
        if (m_vm.hasPendingTerminationException()) [[unlikely]]
            return false;
        m_vm.m_exception = nullptr;
        return true;
    }

#if ENABLE(EXCEPTION_SCOPE_VERIFICATION)
    void didCheck() const { m_vm.m_needsExceptionCheck = false; }
    void willThrow() const { verifyThatNoCheckIsOwed(m_vm, m_location); }

protected:
    friend class Engine::MayThrow;

    ExceptionScope(VM&, ExceptionEventLocation);
    ~ExceptionScope();
    static void verifyThatNoCheckIsOwed(VM&, const ExceptionEventLocation&);
    static void simulateThrow(VM&, const ExceptionEventLocation&, const ExceptionScope* outer);

    VM& m_vm;
    ExceptionScope* m_previous;
    ExceptionEventLocation m_location;
    bool m_isReleased { false };
#else
    ALWAYS_INLINE void didCheck() const
    {
    }
    ALWAYS_INLINE void willThrow() const
    {
    }

protected:
    ALWAYS_INLINE ExceptionScope(VM& vm)
        : m_vm(vm)
    {
    }

    VM& m_vm;
#endif
};

class ThrowScope : public ExceptionScope {
public:
#if ENABLE(EXCEPTION_SCOPE_VERIFICATION)
    ThrowScope(VM&, ExceptionEventLocation);
    ~ThrowScope();
    // The caller will look.
    void release() { m_isReleased = true; }
#else
    ALWAYS_INLINE ThrowScope(VM& vm)
        : ExceptionScope(vm)
    {
    }
    ALWAYS_INLINE ~ThrowScope() {}
    ALWAYS_INLINE void release() {}
#endif

    Exception* throwException(JSGlobalObject* globalObject, JSValue value)
    {
        if (value.isCell() && value.asCell()->type() == ExceptionType)
            didCheck();
        else
            willThrow();
        return Engine::throw_value(globalObject, value);
    }
    Exception* throwException(JSGlobalObject* globalObject, Exception* exception) { return throwException(globalObject, JSValue(reinterpret_cast<JSCell*>(exception))); }
};

// Where an exception has nowhere further to go.
class TopExceptionScope : public ExceptionScope {
public:
#if ENABLE(EXCEPTION_SCOPE_VERIFICATION)
    TopExceptionScope(VM&, ExceptionEventLocation);
    ~TopExceptionScope();
#else
    ALWAYS_INLINE TopExceptionScope(VM& vm)
        : ExceptionScope(vm)
    {
    }
    ALWAYS_INLINE ~TopExceptionScope() {}
#endif

    void clearException()
    {
        didCheck();
        m_vm.m_exception = nullptr;
    }
    bool clearExceptionExceptTermination() { return tryClearException(); }
};

#define DECLARE_THROW_SCOPE(vm) JSC::ThrowScope(ENGINE_SCOPE_ARGUMENTS(vm))
#define DECLARE_TOP_EXCEPTION_SCOPE(vm) JSC::TopExceptionScope(ENGINE_SCOPE_ARGUMENTS(vm))

#define RETURN_IF_EXCEPTION(scope__, value__)              \
    do {                                                   \
        JSC::VM& vm = (scope__).vm();                      \
        (scope__).didCheck();                              \
        if (vm.traps().maybeNeedHandling()) [[unlikely]] { \
            if (vm.hasExceptionsAfterHandlingTraps())      \
                return value__;                            \
        }                                                  \
    } while (false)

#define TRY_CLEAR_EXCEPTION(scope__, value__)            \
    do {                                                 \
        if (!(scope__).tryClearException()) [[unlikely]] \
            return value__;                              \
    } while (false)

#define CLEAR_AND_RETURN_IF_EXCEPTION(scope__, value__) \
    do {                                                \
        if ((scope__).exception()) [[unlikely]] {       \
            (scope__).clearException();                 \
            return value__;                             \
        }                                               \
    } while (false)

#define RELEASE_AND_RETURN(scope__, expression__) \
    do {                                          \
        scope__.release();                        \
        return expression__;                      \
    } while (false)

inline Exception* throwException(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value) { return scope.throwException(globalObject, value); }
inline Exception* throwException(JSGlobalObject* globalObject, ThrowScope& scope, Exception* exception) { return scope.throwException(globalObject, exception); }

class SuspendExceptionScope {
    WTF_MAKE_NONCOPYABLE(SuspendExceptionScope);

public:
    SuspendExceptionScope(VM& vm)
        : m_exception(vm.m_exception, nullptr)
        , m_lastException(vm.m_lastException, nullptr)
    {
    }

private:
    SetForScope<Exception*> m_exception;
    SetForScope<Exception*> m_lastException;
};

// A request to end execution throws when the scope ends.
class DeferTermination {
    WTF_MAKE_NONCOPYABLE(DeferTermination);

public:
    DeferTermination(VM& vm)
        : m_vm(vm)
    {
        Engine::vm_begin_termination_deferral(vm);
    }
    ~DeferTermination() { Engine::vm_end_termination_deferral(m_vm, true); }

private:
    VM& m_vm;
};

// The same, but at the next look for exceptions.
class DeferTerminationForAWhile {
    WTF_MAKE_NONCOPYABLE(DeferTerminationForAWhile);

public:
    DeferTerminationForAWhile(VM& vm)
        : m_vm(vm)
    {
        Engine::vm_begin_termination_deferral(vm);
    }
    ~DeferTerminationForAWhile() { Engine::vm_end_termination_deferral(m_vm, false); }

private:
    VM& m_vm;
};

// Requests stay pending.
class DeferTraps {
public:
    ALWAYS_INLINE DeferTraps(VM& vm)
        : m_areDeferred(vm.traps().m_areDeferred, true)
    {
    }

private:
    SetForScope<bool> m_areDeferred;
};

// Making an error may use some of the stack that is otherwise held back.
class ErrorHandlingScope {
    WTF_MAKE_NONCOPYABLE(ErrorHandlingScope);

public:
    ErrorHandlingScope(VM& vm)
        : m_vm(vm)
        , m_previous(Engine::vm_replace_is_handling_error(vm, true))
    {
    }
    ~ErrorHandlingScope() { Engine::vm_replace_is_handling_error(m_vm, m_previous); }

private:
    VM& m_vm;
    bool m_previous;
};

} // namespace JSC
