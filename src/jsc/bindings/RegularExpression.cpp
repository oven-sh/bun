#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/Options.h>
#include <JavaScriptCore/YarrInterpreter.h>
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
