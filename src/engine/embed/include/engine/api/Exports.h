#pragma once

// The functions of embed/api/*.rs.

#include "engine/api/Identifier.h"

namespace Engine {

ALWAYS_INLINE WTF::StringImpl* implOrEmpty(const WTF::String& string) { return string.impl() ? string.impl() : WTF::StringImpl::empty(); }
ALWAYS_INLINE WTF::StringImpl* leak(WTF::String&& string) { return string.releaseImpl().leakRef(); }
ALWAYS_INLINE WTF::StringImpl* leakOrEmpty(WTF::String&& string) { return string.impl() ? leak(WTF::move(string)) : WTF::StringImpl::empty(); }
ALWAYS_INLINE WTF::UniquedStringImpl* const* addressOrNull(const JSC::Identifier& name) { return name.isNull() ? nullptr : reinterpret_cast<WTF::UniquedStringImpl* const*>(&name); }
ALWAYS_INLINE WTF::UniquedStringImpl* const* addressOrEmpty(const JSC::Identifier& name) { return addressOrNull(name.isNull() ? CommonNamesPointer()->emptyIdentifier : name); }

// Around a call that may leave an exception, which the caller has to look for. If the engine itself cannot throw, that
// leaves the functions of the embedder which it calls.
class MayThrow {
public:
#if ENABLE(EXCEPTION_SCOPE_VERIFICATION)
    MayThrow(const JSC::JSGlobalObject*, bool canThrow, const char* function = __builtin_FUNCTION());
    ~MayThrow();

private:
    JSC::VM& m_vm;
    const char* m_function;
    unsigned m_throwCountBefore;
    bool m_canThrow;
#else
    ALWAYS_INLINE MayThrow(const JSC::JSGlobalObject*, bool)
    {
    }
#endif
};

// The last argument of such a call.
#if ENABLE(EXCEPTION_SCOPE_VERIFICATION)
#define ENGINE_THROWS_ONLY_IF(condition) (condition)
#else
#define ENGINE_THROWS_ONLY_IF(condition) true
#endif

inline bool hasNoEmptyValue(std::span<const JSC::EncodedJSValue> values) { return !std::ranges::contains(values, JSC::encodedJSValue()); }

} // namespace Engine

#include "EngineExports.h"
