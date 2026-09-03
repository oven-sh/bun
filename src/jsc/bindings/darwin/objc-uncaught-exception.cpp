// The std::terminate side of Objective-C exceptions (the catch side is
// objc-try-invoke.cpp). An Objective-C exception is a C++ exception whose
// type_info lives inside the thrown object, right after the `id` (objc4's
// `struct objc_exception`). When one reaches std::terminate, say what it was
// and where it was raised: the Objective-C runtime's own handler that would
// have printed it was displaced by JSCInitialize's set_terminate. If a script
// let it escape through the bun:objc bridge it is the program's exception,
// ended the way an uncaught error is; raised anywhere else (a napi addon,
// bun's own framework calls) it is a crash and goes to the crash reporter.
// Plain C++ with dlsym so that bun links no Objective-C runtime: the symbols
// are there only when something in the process loaded libobjc.

#include <cxxabi.h>
#include <dlfcn.h>
#include <pthread.h>
#include <stdio.h>
#include <typeinfo>

extern "C" [[noreturn]] void Zig__GlobalObject__onUncaughtObjCException(bool onMainThread);
// src/appkit/objc/mod.rs
extern "C" bool Bun__objcBridgeLoaded();

static bool describeUncaughtObjCException()
{
    const std::type_info* type = abi::__cxa_current_exception_type();
    if (!type)
        return false;
    void* thrown = abi::__cxa_current_primary_exception();
    if (!thrown)
        return false;
    if (reinterpret_cast<const char*>(type) != static_cast<const char*>(thrown) + sizeof(void*)) {
        abi::__cxa_decrement_exception_refcount(thrown);
        return false;
    }
    void* exception = *static_cast<void**>(thrown);
    using Send = void* (*)(void*, void*);
    auto msgSend = reinterpret_cast<Send>(dlsym(RTLD_DEFAULT, "objc_msgSend"));
    auto registerName = reinterpret_cast<void* (*)(const char*)>(dlsym(RTLD_DEFAULT, "sel_registerName"));
    auto getClass = reinterpret_cast<void* (*)(void*)>(dlsym(RTLD_DEFAULT, "object_getClass"));
    // `BOOL` is `signed char` on x86_64 and `bool` on arm64; `signed char`
    // reads both correctly.
    auto respondsTo = reinterpret_cast<signed char (*)(void*, void*)>(dlsym(RTLD_DEFAULT, "class_respondsToSelector"));
    auto className = reinterpret_cast<const char* (*)(void*)>(dlsym(RTLD_DEFAULT, "class_getName"));
    const char* name = type->name();
    const char* reason = "";
    const char* stack = nullptr;
    if (exception && msgSend && registerName && getClass && respondsTo && className) {
        // Anything may be thrown (`@throw someString`), so only what the
        // object's class answers is sent to it.
        auto send = [&](void* object, const char* selector) -> void* {
            void* sel = registerName(selector);
            void* cls = object ? getClass(object) : nullptr;
            return cls && respondsTo(cls, sel) != 0 ? msgSend(object, sel) : nullptr;
        };
        auto utf8 = [&](const char* selector) -> const char* {
            void* value = send(exception, selector);
            if (!value)
                return nullptr;
            if (const char* text = static_cast<const char*>(send(value, "UTF8String")))
                return text;
            return static_cast<const char*>(send(send(value, "description"), "UTF8String"));
        };
        if (void* cls = getClass(exception))
            if (const char* n = className(cls))
                name = n;
        if (const char* n = utf8("name"))
            name = n;
        if (const char* r = utf8("reason"))
            reason = r;
        else if (const char* d = utf8("description"))
            reason = d;
        stack = utf8("callStackSymbols");
    }
    fprintf(stderr, "error: uncaught Objective-C exception %s: %s\n", name, reason);
    if (stack)
        fprintf(stderr, "%s\n", stack);
    fflush(stderr);
    return true;
}

/// Called first from the terminate handler. Returns unless a script's
/// Objective-C exception escaped the bridge; the caller then crashes as before.
extern "C" void Bun__reportUncaughtObjCException()
{
    if (describeUncaughtObjCException() && Bun__objcBridgeLoaded())
        Zig__GlobalObject__onUncaughtObjCException(pthread_main_np() == 1);
}
