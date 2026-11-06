#include "root.h"

#include "BunSignalActions.h"

#if !OS(WINDOWS)

#include <algorithm>
#include <atomic>
#include <cstring>
#include <dlfcn.h>
#include <iterator>
#include <pthread.h>
#include <unistd.h>

// macOS hands an access fault to the engine on a Mach port, before there is a signal.
#if ENABLE(AOT) && (OS(LINUX) || OS(FREEBSD))
#define HANDLES_ACCESS_FAULTS_BY_SIGNAL 1
#include <JavaScriptCore/AOTFaultHandler.h>
#include <JavaScriptCore/AOTImage.h>
#include <sched.h>
#include <ucontext.h>
#include <wtf/PlatformRegisters.h>
#else
#define HANDLES_ACCESS_FAULTS_BY_SIGNAL 0
#endif

// With glibc and musl the executable defines the functions of libc that set a signal's action or block it, so that a library's
// call arrives here. A sanitizer's run time defines them itself.
#if HANDLES_ACCESS_FAULTS_BY_SIGNAL && OS(LINUX) && !OS(ANDROID) && !ASAN_ENABLED
#define DEFINES_SIGNAL_FUNCTIONS_OF_LIBC 1
#else
#define DEFINES_SIGNAL_FUNCTIONS_OF_LIBC 0
#endif

namespace Bun {

using SignalHandler = void (*)(int);

#if DEFINES_SIGNAL_FUNCTIONS_OF_LIBC

enum class LibcFunction : uint8_t {
    Sigaction,
    Signal,
    BsdSignal,
    SysvSignal,
    UnderscoredSysvSignal,
    Sigset,
    Sigignore,
    PthreadSigmask,
    Sigprocmask,
};
static constexpr const char* namesOfLibcFunctions[] = { "sigaction", "signal", "bsd_signal", "sysv_signal", "__sysv_signal", "sigset", "sigignore", "pthread_sigmask", "sigprocmask" };
static constexpr size_t numberOfLibcFunctions = std::size(namesOfLibcFunctions);
static constinit std::atomic<void*> nextDefinitions[numberOfLibcFunctions];

// The definition that a call would have reached if the executable had none: libc's, or that of a library loaded in front of it.
template<typename Function>
static Function* findNextDefinition(LibcFunction function)
{
    auto& definition = nextDefinitions[static_cast<size_t>(function)];
    void* found = definition.load(std::memory_order_relaxed);
    if (!found) [[unlikely]] {
        found = dlsym(RTLD_NEXT, namesOfLibcFunctions[static_cast<size_t>(function)]);
        definition.store(found, std::memory_order_relaxed);
    }
    return reinterpret_cast<Function*>(found);
}

// A signal handler cannot call dlsym().
static void findDefinitionsForSignalHandler()
{
    for (auto function : { LibcFunction::Sigaction, LibcFunction::Signal, LibcFunction::PthreadSigmask })
        findNextDefinition<void>(function);
}

static int callLibcSigaction(int signalNumber, const struct sigaction* action, struct sigaction* previousAction)
{
    return findNextDefinition<int(int, const struct sigaction*, struct sigaction*)>(LibcFunction::Sigaction)(signalNumber, action, previousAction);
}

static SignalHandler callLibcSignal(int signalNumber, SignalHandler handler)
{
    return findNextDefinition<SignalHandler(int, SignalHandler)>(LibcFunction::Signal)(signalNumber, handler);
}

#else // !DEFINES_SIGNAL_FUNCTIONS_OF_LIBC

static void findDefinitionsForSignalHandler() {}

static int callLibcSigaction(int signalNumber, const struct sigaction* action, struct sigaction* previousAction)
{
    return sigaction(signalNumber, action, previousAction);
}

static SignalHandler callLibcSignal(int signalNumber, SignalHandler handler)
{
    return signal(signalNumber, handler);
}

#endif // DEFINES_SIGNAL_FUNCTIONS_OF_LIBC

#if HANDLES_ACCESS_FAULTS_BY_SIGNAL

extern "C" [[noreturn]] void Bun__raiseDefaultAction(int signalNumber);

using SignalHandlerWithInfo = void (*)(int, siginfo_t*, void*);

// Linux has 64 signals and FreeBSD 128, however wide sigset_t is.
static constexpr size_t wordsInMask = std::min<size_t>(sizeof(sigset_t), 16) / sizeof(uint64_t);

// Once anything but the engine sets an action for the signal, the kernel has handleAccessFaultSignal() for good, and this is the
// action that the rest of the process set and sees. A handler on any thread reads it while another thread sets it.
struct AccessFaultSignal {
    enum class State : uint8_t { NotInstalled,
        Installing,
        Installed };
    std::atomic<State> state { State::NotInstalled };
    std::atomic<SignalHandlerWithInfo> handler { nullptr };
    std::atomic<int> flags { 0 };
    std::atomic<uint64_t> mask[wordsInMask] {};
    sigset_t maskOfEngine {};
};
static constinit AccessFaultSignal accessFaultSignals[2];

static AccessFaultSignal& accessFaultSignal(int signalNumber)
{
    return accessFaultSignals[signalNumber == SIGBUS];
}

static AccessFaultSignal* findAccessFaultSignalOfCompiledCode(int signalNumber)
{
    if ((signalNumber != SIGSEGV && signalNumber != SIGBUS) || !JSC::AOT::Image::isRegistered()) [[likely]]
        return nullptr;
    return &accessFaultSignal(signalNumber);
}

static bool isRaisedByInstruction(const siginfo_t& info)
{
#if OS(FREEBSD)
    return info.si_code > 0 && info.si_code < SI_USER;
#else
    return info.si_code > 0;
#endif
}

static bool isHandler(SignalHandlerWithInfo handler, SignalHandler other)
{
    return reinterpret_cast<SignalHandler>(handler) == other;
}

static void handleAccessFaultSignal(int signalNumber, siginfo_t* info, void* context)
{
    auto* userContext = static_cast<ucontext_t*>(context);
    bool isFault = isRaisedByInstruction(*info);
    if (isFault && JSC::AOT::handleAccessFault(info->si_addr, WTF::registersFromUContext(userContext)))
        return;

    AccessFaultSignal& signal = accessFaultSignal(signalNumber);
    SignalHandlerWithInfo handler = signal.handler.load(std::memory_order_relaxed);
    int flags = signal.flags.load(std::memory_order_relaxed);
    if (isHandler(handler, SIG_DFL) || isHandler(handler, SIG_IGN)) {
        if (isFault) {
            // The instruction runs again under the default action: a fault cannot be ignored.
            callLibcSignal(signalNumber, SIG_DFL);
            return;
        }
        // The kernel drops a signal whose action is the default one if it is sent to the first process of a PID namespace.
        if (isHandler(handler, SIG_IGN) || getpid() == 1)
            return;
        Bun__raiseDefaultAction(signalNumber);
    }

    if (flags & SA_RESETHAND)
        signal.handler.store(reinterpret_cast<SignalHandlerWithInfo>(SIG_DFL), std::memory_order_relaxed);

    // The handler runs under the mask the kernel would have given it.
    sigset_t blocked = userContext->uc_sigmask;
    uint64_t words[wordsInMask];
    memcpy(words, &blocked, sizeof(words));
    for (size_t i = 0; i < wordsInMask; i++)
        words[i] |= signal.mask[i].load(std::memory_order_relaxed);
    memcpy(&blocked, words, sizeof(words));
    if (!(flags & SA_NODEFER))
        sigaddset(&blocked, signalNumber);
    pthread_sigmask(SIG_SETMASK, &blocked, nullptr);
    handler(signalNumber, info, context);
}

static constexpr int flagsTheKernelActsOn = SA_ONSTACK | SA_RESTART;

static void installHandlerInKernel(int signalNumber, const AccessFaultSignal& signal, int flagsOfAction)
{
    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_sigaction = handleAccessFaultSignal;
    action.sa_mask = signal.maskOfEngine;
    action.sa_flags = SA_SIGINFO | (flagsOfAction & flagsTheKernelActsOn);
    callLibcSigaction(signalNumber, &action, nullptr);
}

static struct sigaction exchangeAction(AccessFaultSignal& signal, const struct sigaction* action)
{
    struct sigaction previous;
    memset(&previous, 0, sizeof(previous));
    uint64_t words[wordsInMask];
    if (action) {
        memcpy(words, &action->sa_mask, sizeof(words));
        previous.sa_sigaction = signal.handler.exchange(action->sa_sigaction, std::memory_order_relaxed);
        previous.sa_flags = signal.flags.exchange(action->sa_flags, std::memory_order_relaxed);
        for (size_t i = 0; i < wordsInMask; i++)
            words[i] = signal.mask[i].exchange(words[i], std::memory_order_relaxed);
    } else {
        previous.sa_sigaction = signal.handler.load(std::memory_order_relaxed);
        previous.sa_flags = signal.flags.load(std::memory_order_relaxed);
        for (size_t i = 0; i < wordsInMask; i++)
            words[i] = signal.mask[i].load(std::memory_order_relaxed);
    }
    memcpy(&previous.sa_mask, words, sizeof(words));
    return previous;
}

static void installHandlerOnce(int signalNumber, AccessFaultSignal& signal)
{
    using State = AccessFaultSignal::State;
    if (signal.state.load(std::memory_order_acquire) == State::Installed) [[likely]]
        return;
    State expected = State::NotInstalled;
    if (!signal.state.compare_exchange_strong(expected, State::Installing, std::memory_order_acquire)) {
        while (signal.state.load(std::memory_order_acquire) != State::Installed)
            sched_yield();
        return;
    }
    findDefinitionsForSignalHandler();
    struct sigaction actionOfEngine;
    callLibcSigaction(signalNumber, nullptr, &actionOfEngine);
    signal.maskOfEngine = actionOfEngine.sa_mask;
    exchangeAction(signal, &actionOfEngine);
    installHandlerInKernel(signalNumber, signal, actionOfEngine.sa_flags);
    signal.state.store(State::Installed, std::memory_order_release);
}

static struct sigaction setActionBehindCompiledCode(int signalNumber, AccessFaultSignal& signal, const struct sigaction& action)
{
    installHandlerOnce(signalNumber, signal);
    struct sigaction previous = exchangeAction(signal, &action);
    if ((previous.sa_flags ^ action.sa_flags) & flagsTheKernelActsOn)
        installHandlerInKernel(signalNumber, signal, action.sa_flags);
    return previous;
}

static SignalHandler setHandlerBehindCompiledCode(int signalNumber, AccessFaultSignal& signal, SignalHandler handler, int flags)
{
    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_handler = handler;
    action.sa_flags = flags;
    return setActionBehindCompiledCode(signalNumber, signal, action).sa_handler;
}

int setSignalAction(int signalNumber, const struct sigaction* action, struct sigaction* previousAction)
{
    AccessFaultSignal* signal = findAccessFaultSignalOfCompiledCode(signalNumber);
    if (!signal || (!action && signal->state.load(std::memory_order_acquire) != AccessFaultSignal::State::Installed)) [[likely]]
        return callLibcSigaction(signalNumber, action, previousAction);
    struct sigaction previous = action ? setActionBehindCompiledCode(signalNumber, *signal, *action) : exchangeAction(*signal, nullptr);
    if (previousAction)
        *previousAction = previous;
    return 0;
}

SignalHandler setSignalHandler(int signalNumber, SignalHandler handler)
{
    AccessFaultSignal* signal = findAccessFaultSignalOfCompiledCode(signalNumber);
    if (!signal || handler == SIG_ERR) [[likely]]
        return callLibcSignal(signalNumber, handler);
    return setHandlerBehindCompiledCode(signalNumber, *signal, handler, SA_RESTART);
}

#else // !HANDLES_ACCESS_FAULTS_BY_SIGNAL

int setSignalAction(int signalNumber, const struct sigaction* action, struct sigaction* previousAction)
{
    return callLibcSigaction(signalNumber, action, previousAction);
}

SignalHandler setSignalHandler(int signalNumber, SignalHandler handler)
{
    return callLibcSignal(signalNumber, handler);
}

#endif // HANDLES_ACCESS_FAULTS_BY_SIGNAL

#if DEFINES_SIGNAL_FUNCTIONS_OF_LIBC

static SignalHandler setSysvSignalHandler(int signalNumber, SignalHandler handler)
{
    AccessFaultSignal* signal = findAccessFaultSignalOfCompiledCode(signalNumber);
    if (!signal || handler == SIG_ERR) [[likely]]
        return findNextDefinition<SignalHandler(int, SignalHandler)>(LibcFunction::UnderscoredSysvSignal)(signalNumber, handler);
    return setHandlerBehindCompiledCode(signalNumber, *signal, handler, SA_RESETHAND | SA_NODEFER);
}

static SignalHandler setSignalDisposition(int signalNumber, SignalHandler disposition)
{
    AccessFaultSignal* signal = findAccessFaultSignalOfCompiledCode(signalNumber);
    if (!signal || disposition == SIG_ERR) [[likely]]
        return findNextDefinition<SignalHandler(int, SignalHandler)>(LibcFunction::Sigset)(signalNumber, disposition);
    if (disposition == SIG_HOLD) {
        struct sigaction current;
        setSignalAction(signalNumber, nullptr, &current);
        return current.sa_handler;
    }
    sigset_t one;
    sigset_t blockedBefore;
    sigemptyset(&one);
    sigaddset(&one, signalNumber);
    pthread_sigmask(SIG_UNBLOCK, &one, &blockedBefore);
    SignalHandler previous = setHandlerBehindCompiledCode(signalNumber, *signal, disposition, 0);
    return sigismember(&blockedBefore, signalNumber) ? SIG_HOLD : previous;
}

static int ignoreSignal(int signalNumber)
{
    AccessFaultSignal* signal = findAccessFaultSignalOfCompiledCode(signalNumber);
    if (!signal) [[likely]]
        return findNextDefinition<int(int)>(LibcFunction::Sigignore)(signalNumber);
    setHandlerBehindCompiledCode(signalNumber, *signal, SIG_IGN, 0);
    return 0;
}

// Compiled code raises the two on every thread that runs it, so a library's call leaves them unblocked.
template<LibcFunction function>
static int setSignalMask(int how, const sigset_t* set, sigset_t* previousSet)
{
    auto* next = findNextDefinition<int(int, const sigset_t*, sigset_t*)>(function);
    if (!set || how == SIG_UNBLOCK || !JSC::AOT::Image::isRegistered()) [[likely]]
        return next(how, set, previousSet);
    sigset_t withoutAccessFaults = *set;
    sigdelset(&withoutAccessFaults, SIGSEGV);
    sigdelset(&withoutAccessFaults, SIGBUS);
    return next(how, &withoutAccessFaults, previousSet);
}

static void* const replacementsOfLibcFunctions[numberOfLibcFunctions] = {
    reinterpret_cast<void*>(setSignalAction),
    reinterpret_cast<void*>(setSignalHandler),
    reinterpret_cast<void*>(setSignalHandler),
    reinterpret_cast<void*>(setSysvSignalHandler),
    reinterpret_cast<void*>(setSysvSignalHandler),
    reinterpret_cast<void*>(setSignalDisposition),
    reinterpret_cast<void*>(ignoreSignal),
    reinterpret_cast<void*>(setSignalMask<LibcFunction::PthreadSigmask>),
    reinterpret_cast<void*>(setSignalMask<LibcFunction::Sigprocmask>),
};

extern "C" char __executable_start[];
extern "C" char _end[];

// Bun's own calls mean the kernel's action.
static ALWAYS_INLINE bool isInExecutable(void* address)
{
    return reinterpret_cast<uintptr_t>(address) - reinterpret_cast<uintptr_t>(__executable_start) < static_cast<uintptr_t>(_end - __executable_start);
}

#endif // DEFINES_SIGNAL_FUNCTIONS_OF_LIBC

} // namespace Bun

#if DEFINES_SIGNAL_FUNCTIONS_OF_LIBC

#if defined(__THROW)
#define LIBC_THROW __THROW
#else
#define LIBC_THROW
#endif
#define LIBC_FUNCTION extern "C" __attribute__((visibility("default")))

LIBC_FUNCTION int sigaction(int signalNumber, const struct sigaction* __restrict action, struct sigaction* __restrict previousAction) LIBC_THROW
{
    if (Bun::isInExecutable(__builtin_return_address(0))) [[likely]]
        return Bun::callLibcSigaction(signalNumber, action, previousAction);
    return Bun::setSignalAction(signalNumber, action, previousAction);
}

LIBC_FUNCTION Bun::SignalHandler signal(int signalNumber, Bun::SignalHandler handler) LIBC_THROW
{
    if (Bun::isInExecutable(__builtin_return_address(0))) [[likely]]
        return Bun::callLibcSignal(signalNumber, handler);
    return Bun::setSignalHandler(signalNumber, handler);
}

LIBC_FUNCTION Bun::SignalHandler bsd_signal(int signalNumber, Bun::SignalHandler handler) LIBC_THROW
{
    return Bun::setSignalHandler(signalNumber, handler);
}

LIBC_FUNCTION Bun::SignalHandler sysv_signal(int signalNumber, Bun::SignalHandler handler) LIBC_THROW
{
    return Bun::setSysvSignalHandler(signalNumber, handler);
}

LIBC_FUNCTION Bun::SignalHandler __sysv_signal(int signalNumber, Bun::SignalHandler handler) LIBC_THROW
{
    return Bun::setSysvSignalHandler(signalNumber, handler);
}

LIBC_FUNCTION Bun::SignalHandler sigset(int signalNumber, Bun::SignalHandler disposition) LIBC_THROW
{
    return Bun::setSignalDisposition(signalNumber, disposition);
}

LIBC_FUNCTION int sigignore(int signalNumber) LIBC_THROW
{
    return Bun::ignoreSignal(signalNumber);
}

LIBC_FUNCTION int pthread_sigmask(int how, const sigset_t* __restrict set, sigset_t* __restrict previousSet) LIBC_THROW
{
    if (Bun::isInExecutable(__builtin_return_address(0))) [[likely]]
        return Bun::findNextDefinition<int(int, const sigset_t*, sigset_t*)>(Bun::LibcFunction::PthreadSigmask)(how, set, previousSet);
    return Bun::setSignalMask<Bun::LibcFunction::PthreadSigmask>(how, set, previousSet);
}

LIBC_FUNCTION int sigprocmask(int how, const sigset_t* __restrict set, sigset_t* __restrict previousSet) LIBC_THROW
{
    if (Bun::isInExecutable(__builtin_return_address(0))) [[likely]]
        return Bun::findNextDefinition<int(int, const sigset_t*, sigset_t*)>(Bun::LibcFunction::Sigprocmask)(how, set, previousSet);
    return Bun::setSignalMask<Bun::LibcFunction::Sigprocmask>(how, set, previousSet);
}

#endif // DEFINES_SIGNAL_FUNCTIONS_OF_LIBC

#endif // !OS(WINDOWS)

// A function that bun:ffi found by name in libc itself.
extern "C" void* Bun__FFI__replaceSignalFunction(void* function)
{
#if DEFINES_SIGNAL_FUNCTIONS_OF_LIBC
    if (!JSC::AOT::Image::isRegistered()) [[likely]]
        return function;
    for (size_t i = 0; i < Bun::numberOfLibcFunctions; i++) {
        if (function == Bun::findNextDefinition<void>(static_cast<Bun::LibcFunction>(i)))
            return Bun::replacementsOfLibcFunctions[i];
    }
#endif
    return function;
}
