// The catch frames around Objective-C in bun: a message sent under try, so
// an exception raised inside the method comes back to the bun:objc bridge
// (src/appkit/objc/dynamic.rs) as a value instead of ending the process.
// One frame sends `-[NSInvocation invokeWithTarget:]`; the other makes a
// libffi `ffi_call` of `objc_msgSend` (src/appkit/objc/ffi.rs). Plain C++ so
// that bun links no Objective-C runtime and carries no Objective-C image
// info: the bridge loads the runtime and libffi itself and hands these
// frames the entry points they need. An Objective-C exception is a C++
// exception whose type_info sits inside the thrown buffer right after the
// `id` (objc4's `struct objc_exception`), which is how the object is
// recovered here and in ZigGlobalObject.cpp's terminate handler.

#include <cxxabi.h>
#include <typeinfo>

using Send = void (*)(void* receiver, void* selector, void* argument);
using Retain = void* (*)(void* object);
using FfiCall = void (*)(void* cif, void (*function)(), void* rvalue, void** avalue);
using Throw = void (*)(void* object);

// Release builds strip __TEXT,__unwind_info, and ld64.lld drops a frame's
// DWARF FDE whenever it can encode the frame compactly, which would leave a
// catch frame nowhere. Compact unwind cannot describe CFI it does not model,
// so these two no-op directives make the compiler mark the enclosing frame
// DWARF-only on every architecture: the FDE stays in __eh_frame and
// libunwind finds it there.
#define KEEP_DWARF_UNWIND_INFO() __asm__ volatile(".cfi_remember_state\n\t.cfi_restore_state")

/// Inside a `catch (...)` handler: what an Objective-C `@throw` threw
/// (usually an NSException), with a +1 reference from `retain` that the
/// caller releases, or nullptr when `nil` was thrown. Anything else thrown
/// keeps unwinding.
/// Inside a `catch (...)` handler: whether what was thrown is an
/// Objective-C object, and which (nil included).
static inline __attribute__((always_inline)) bool thrownObject(void** object)
{
    const std::type_info* type = abi::__cxa_current_exception_type();
    void* thrown = abi::__cxa_current_primary_exception();
    bool objc = type && thrown && reinterpret_cast<const char*>(type) == static_cast<const char*>(thrown) + sizeof(void*);
    *object = objc ? *static_cast<void**>(thrown) : nullptr;
    if (thrown)
        abi::__cxa_decrement_exception_refcount(thrown);
    return objc;
}

static inline __attribute__((always_inline)) void* caughtObject(Retain retain)
{
    void* object;
    if (!thrownObject(&object))
        throw;
    return object ? retain(object) : nullptr;
}

/// Throws `object` with `objcThrow`, libobjc's `objc_exception_throw`, and
/// reports whether the frames below would know it again: false when this
/// Objective-C runtime lays its exceptions out some other way, so that the
/// bridge refuses to load rather than let a caught exception end the process.
extern "C" bool Bun__objc__recognizesException(Throw objcThrow, void* object)
{
    KEEP_DWARF_UNWIND_INFO();
    try {
        objcThrow(object);
        return false;
    } catch (...) {
        void* thrown;
        return thrownObject(&thrown) && thrown == object;
    }
}

/// Sends [invocation invokeWithTarget:target] through `msgSend`. On an
/// Objective-C exception, stores what was thrown in *exception (see
/// caughtObject) and returns false.
extern "C" bool Bun__NSInvocation__tryInvoke(Send msgSend, Retain retain, void* invocation, void* invokeWithTarget, void* target, void** exception)
{
    KEEP_DWARF_UNWIND_INFO();
    try {
        msgSend(invocation, invokeWithTarget, target);
        return true;
    } catch (...) {
        *exception = caughtObject(retain);
        return false;
    }
}

/// ffi_call(cif, function, rvalue, avalue) through `call`, libffi's
/// `ffi_call`. On an Objective-C exception raised under `function`, stores
/// what was thrown in *exception (see caughtObject) and returns false.
extern "C" bool Bun__ffi__tryCall(FfiCall call, Retain retain, void* cif, void (*function)(), void* rvalue, void** avalue, void** exception)
{
    KEEP_DWARF_UNWIND_INFO();
    try {
        call(cif, function, rvalue, avalue);
        return true;
    } catch (...) {
        *exception = caughtObject(retain);
        return false;
    }
}
