#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/Options.h>
#include <JavaScriptCore/YarrInterpreter.h>
#include <JavaScriptCore/YarrUnicodeProperties.h>
#include <unicode/uchar.h>
#include <unicode/ustring.h>
#include <wtf/BumpPointerAllocator.h>

namespace Bun {

// Yarr's bytecode interpreter, which runs without a VM. JavaScriptCore/RegularExpression.h takes only the flags i, m and v, and gives no groups.
struct RegularExpression {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(RegularExpression);
    WTF_MAKE_NONCOPYABLE(RegularExpression);

    // Mirrors `Error` in src/yarr/lib.rs.
    enum class Refusal : uint8_t {
        None = 0,
        TooLarge = 1,
        UnknownProperty = 2,
        Syntax = 3,
    };

    RegularExpression(WTF::StringView source, uint16_t flags)
    {
        // TODO: Remove this, we technically are accessing options before we finalize them.
        // This means you cannot use BUN_JSC_dumpCompiledRegExpPatterns on the flag passed to `bun test -t`
        // NOLINTBEGIN
        JSC::Options::AllowUnfinalizedAccessScope scope {};
        // NOLINTEND
        JSC::Yarr::YarrPattern pattern(source, OptionSet<JSC::Yarr::Flags>::fromRaw(flags), error);
        if (!JSC::Yarr::hasError(error))
            bytecode = JSC::Yarr::byteCompile(pattern, &allocator, error);
    }

    // Where the match starts, or JSC::Yarr::offsetNoMatch. `offsets` has room for `bytecode->m_offsetsSize`.
    unsigned exec(WTF::StringView input, unsigned start, unsigned* offsets)
    {
        return JSC::Yarr::interpret(bytecode.get(), input, start, offsets);
    }

    Refusal refusal() const
    {
        using JSC::Yarr::ErrorCode;
        switch (error) {
        case ErrorCode::NoError:
            return Refusal::None;
        case ErrorCode::PatternTooLarge:
        case ErrorCode::QuantifierTooLarge:
        case ErrorCode::OffsetTooLarge:
        case ErrorCode::TooManyCaptures:
        case ErrorCode::FrameTooLarge:
        case ErrorCode::TooManyDisjunctions:
            return Refusal::TooLarge;
        case ErrorCode::InvalidUnicodePropertyExpression:
            return Refusal::UnknownProperty;
        default:
            return Refusal::Syntax;
        }
    }

    // A match keeps what it needs to backtrack in the allocator, which is not reentrant: one match at a time.
    WTF::BumpPointerAllocator allocator;
    JSC::Yarr::ErrorCode error { JSC::Yarr::ErrorCode::NoError };
    std::unique_ptr<JSC::Yarr::BytecodePattern> bytecode;
};

}

extern "C" Bun::RegularExpression* Yarr__RegularExpression__init(const BunString* pattern, uint16_t flags)
{
    return new Bun::RegularExpression(pattern->toWTFString(BunString::ZeroCopy), flags);
}
extern "C" void Yarr__RegularExpression__deinit(Bun::RegularExpression* re)
{
    delete re;
}
extern "C" bool Yarr__RegularExpression__isValid(Bun::RegularExpression* re)
{
    return !!re->bytecode;
}
extern "C" int Yarr__RegularExpression__matches(Bun::RegularExpression* re, const BunString* string)
{
    auto input = string->toWTFString(BunString::ZeroCopy);
    if (!re->bytecode || input.isNull())
        return -1;
    WTF::Vector<unsigned, 32> offsets;
    offsets.grow(re->bytecode->m_offsetsSize);
    return static_cast<int>(re->exec(input, 0, offsets.mutableSpan().data()));
}

// The two below are for src/yarr/lib.rs. `characters` is Latin-1 if `is8Bit`, otherwise UTF-16.

// Null if Yarr refuses the pattern: then `refusal` is set, otherwise `offsetsSize`.
extern "C" Bun::RegularExpression* Yarr__RegularExpression__compile(const void* characters, uint32_t length, bool is8Bit, uint16_t flags, uint32_t* offsetsSize, uint8_t* refusal)
{
    auto* re = new Bun::RegularExpression(WTF::StringView(characters, length, is8Bit), flags);
    if (!re->bytecode) {
        *refusal = static_cast<uint8_t>(re->refusal());
        delete re;
        return nullptr;
    }
    *offsetsSize = re->bytecode->m_offsetsSize;
    return re;
}

// `offsets` has room for the `offsetsSize` of `compile`. What a match leaves there: `Compiled::exec` in src/yarr/lib.rs.
extern "C" bool Yarr__RegularExpression__exec(Bun::RegularExpression* re, const void* characters, uint32_t length, bool is8Bit, uint32_t start, uint32_t* offsets)
{
    return re->exec(WTF::StringView(characters, length, is8Bit), start, offsets) != JSC::Yarr::offsetNoMatch;
}

// The characters of `\p{name=value}`, or of `\p{name}` if `value` is null: not sorted, as they are without the flag `i`. `string` is
// called with each string of a property of strings. False if there is no such property. The names are ASCII.
extern "C" bool Yarr__unicodeProperty(const void* name, uint32_t nameLength, const void* value, uint32_t valueLength, void* context, void (*range)(void*, uint32_t, uint32_t), void (*string)(void*, const char32_t*, uint32_t))
{
    using namespace JSC::Yarr;
    auto nameString = WTF::StringView(name, nameLength, true).toString();
    auto id = value
        ? unicodeMatchPropertyValue(nameString, WTF::StringView(value, valueLength, true).toString())
        : unicodeMatchProperty(nameString, CompileMode::UnicodeSets);
    if (!id)
        return false;
    const CharacterClass* characters = sharedUnicodeCharacterClassFor(*id);
    for (char32_t it : characters->m_matches8)
        range(context, it, it);
    for (auto& it : characters->m_ranges8)
        range(context, it.begin, it.end);
    for (char32_t it : characters->m_matches32)
        range(context, it, it);
    for (auto& it : characters->m_ranges32)
        range(context, it.begin, it.end);
    for (auto& it : characters->m_strings)
        string(context, it.span().data(), it.size());
    return true;
}

// Calls `pair` with each character that `Canonicalize` of ECMAScript maps to another one, and with that one. `unicode`: with the flag
// `u` or `v`, which is simple case folding. Without them it is `toUppercase` of a UTF-16 code unit.
extern "C" void Yarr__canonicalized(bool unicode, void* context, void (*pair)(void*, uint32_t, uint32_t))
{
    if (unicode) {
        for (UChar32 it = 0; it <= UCHAR_MAX_VALUE; it++) {
            UChar32 folded = u_foldCase(it, U_FOLD_CASE_DEFAULT);
            if (folded != it)
                pair(context, it, folded);
        }
        return;
    }
    for (UChar32 it = 0; it <= 0xFFFF; it++) {
        UChar unit = static_cast<UChar>(it);
        UChar upper[4];
        UErrorCode status = U_ZERO_ERROR;
        int32_t length = u_strToUpper(upper, 4, &unit, 1, "", &status);
        if (U_SUCCESS(status) && length == 1 && upper[0] != unit && !(it >= 128 && upper[0] < 128))
            pair(context, it, upper[0]);
    }
}
