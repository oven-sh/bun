#pragma once

// Regular expressions.

#include "engine/api/GlobalObject.h"

namespace JSC {

namespace Yarr {

enum class Flags : uint8_t {
    HasIndices = Engine::Flags::HAS_INDICES,
    Global = Engine::Flags::GLOBAL,
    IgnoreCase = Engine::Flags::IGNORE_CASE,
    Multiline = Engine::Flags::MULTILINE,
    DotAll = Engine::Flags::DOT_ALL,
    Unicode = Engine::Flags::UNICODE,
    UnicodeSets = Engine::Flags::UNICODE_SETS,
    Sticky = Engine::Flags::STICKY,
};

inline std::optional<OptionSet<Flags>> parseFlags(StringView text)
{
    uint8_t flags;
    return Engine::regexp_parse_flags(text, flags) ? std::optional(OptionSet<Flags>::fromRaw(flags)) : std::nullopt;
}

inline String flagsString(OptionSet<Flags> flags) { return Engine::regexp_flags_to_string(flags.toRaw()); }

} // namespace Yarr

struct MatchResult {
    explicit operator bool() const { return start != notFound; }

    size_t start { notFound };
    size_t end { 0 };
};

// A pattern with its flags.
class RegExp final : public JSCell {
public:
    ENGINE_DECLARE_CLASS(RegExp)

    // Null if the pattern is not valid.
    static RegExp* tryCreate(VM& vm, const String& pattern, OptionSet<Yarr::Flags> flags) { return Engine::regexp_try_create(vm, pattern, flags.toRaw()); }
    // Throws in that case.
    static RegExp* create(JSGlobalObject* globalObject, const String& pattern, OptionSet<Yarr::Flags> flags) { return Engine::regexp_create(globalObject, pattern, flags.toRaw()); }

    const String& pattern() const { return Engine::fieldAt<String>(this, Engine::Layout::RegExp_pattern); }
    OptionSet<Yarr::Flags> flags() const { return OptionSet<Yarr::Flags>::fromRaw(Engine::fieldAt<uint8_t>(this, Engine::Layout::RegExp_flags)); }

    MatchResult match(JSGlobalObject* globalObject, StringView subject, unsigned start)
    {
        unsigned matchStart, matchEnd;
        if (!Engine::regexp_find(this, globalObject, subject, start, matchStart, matchEnd))
            return {};
        return { matchStart, matchEnd };
    }
    // Where the match and each group start and end, -1 for a group that has taken no part. Empty if there is no match.
    Vector<int, 32> matchWithGroups(JSGlobalObject* globalObject, StringView subject, unsigned start)
    {
        Vector<int, 32> offsets;
        auto append = [](void* offsets, const uint32_t* first, size_t count) { static_cast<Vector<int, 32>*>(offsets)->append(std::span(reinterpret_cast<const int*>(first), count)); };
        Engine::regexp_exec(this, globalObject, subject, start, append, &offsets);
        return offsets;
    }
};

class RegExpObject final : public JSNonFinalObject {
public:
    ENGINE_DECLARE_CLASS(RegExpObject)

    static RegExpObject* create(VM& vm, Structure* structure, RegExp* regExp) { return Engine::regexp_object_create(vm, structure, regExp); }

    RegExp* regExp() const { return std::bit_cast<RegExp*>(Engine::fieldAt<uintptr_t>(this, Engine::Layout::RegExpObject_regexp_and_flags) & ~Engine::Layout::regExpObjectFlagMask); }
    JSValue getLastIndex() const { return Engine::regexp_object_last_index(this); }
    // Reads and updates `lastIndex`.
    bool match(JSGlobalObject* globalObject, JSString* string) { return Engine::regexp_object_test(this, globalObject, string); }
};
ENGINE_CLASS_HAS_TYPE(RegExpObject, RegExpObjectType);

} // namespace JSC
