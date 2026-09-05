#pragma once

#include <cstdint>
#include <wtf/Noncopyable.h>

// Layout of `NativeModule` in src/crash_handler/lib.rs.
struct CrashHandlerNativeModule {
    uint8_t kind;
    const char* name;
};

extern "C" CrashHandlerNativeModule CrashHandler__enterNativeModule(uint8_t kind, const char* name);
extern "C" void CrashHandler__leaveNativeModule(CrashHandlerNativeModule previous);

namespace Bun {

// Names the native module whose code this thread runs until the scope ends, for the crash report; `name` has to outlive the scope.
class NativeModuleCrashScope {
    WTF_MAKE_NONCOPYABLE(NativeModuleCrashScope);

public:
    enum Kind : uint8_t {
        Loading = 1,
        Running = 2,
    };

    NativeModuleCrashScope(Kind kind, const char* name)
        : m_previous(CrashHandler__enterNativeModule(kind, name))
    {
    }

    ~NativeModuleCrashScope()
    {
        CrashHandler__leaveNativeModule(m_previous);
    }

private:
    CrashHandlerNativeModule m_previous;
};

} // namespace Bun
