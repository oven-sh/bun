#pragma once

#include "v8.h"
#include "V8Local.h"

namespace v8 {

class HandleScope;
class Context;

namespace shim {
class GlobalInternals;
}

// The only fields here are "roots," which are the global locations of V8's versions of nullish and
// boolean values. These are computed as offsets from an Isolate pointer in many V8 functions so
// they need to have the correct layout.
class Isolate final {
public:
    // v8-internal.h:775
    static constexpr int kUndefinedValueRootIndex = 4;
    static constexpr int kTheHoleValueRootIndex = 5;
    static constexpr int kNullValueRootIndex = 6;
    static constexpr int kTrueValueRootIndex = 7;
    static constexpr int kFalseValueRootIndex = 8;

    Isolate(shim::GlobalInternals* globalInternals);

    // Returns the isolate inside which the current thread is running or nullptr.
    BUN_EXPORT static Isolate* TryGetCurrent();

    // Returns the isolate inside which the current thread is running.
    BUN_EXPORT static Isolate* GetCurrent();

    BUN_EXPORT Local<Context> GetCurrentContext();

    Zig::GlobalObject* globalObject() { return m_globalObject; }
    JSC::VM& vm() { return globalObject()->vm(); }
    shim::GlobalInternals* globalInternals() { return m_globalInternals; }
    HandleScope* currentHandleScope();

    TaggedPointer* undefinedSlot() { return &m_roots[Isolate::kUndefinedValueRootIndex]; }

    TaggedPointer* nullSlot() { return &m_roots[Isolate::kNullValueRootIndex]; }

    TaggedPointer* trueSlot() { return &m_roots[Isolate::kTrueValueRootIndex]; }

    TaggedPointer* falseSlot() { return &m_roots[Isolate::kFalseValueRootIndex]; }

    shim::GlobalInternals* m_globalInternals;
    Zig::GlobalObject* m_globalObject;

    uintptr_t m_padding[78];

    std::array<TaggedPointer, 9> m_roots;
};

} // namespace v8
