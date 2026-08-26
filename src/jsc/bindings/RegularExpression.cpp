#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/RegularExpression.h>
#include <JavaScriptCore/Options.h>
#include <JavaScriptCore/Yarr.h>
#include <JavaScriptCore/YarrFlags.h>
#include <JavaScriptCore/YarrInterpreter.h>
#include <JavaScriptCore/YarrPattern.h>
#include <wtf/BumpPointerAllocator.h>

using namespace JSC;
using namespace JSC::Yarr;

extern "C" RegularExpression* Yarr__RegularExpression__init(const BunString* pattern, uint16_t flags)
{
    // TODO: Remove this, we technically are accessing options before we finalize them.
    // This means you cannot use BUN_JSC_dumpCompiledRegExpPatterns on the flag passed to `bun test -t`
    // NOLINTBEGIN
    Options::AllowUnfinalizedAccessScope scope {};
    // NOLINTEND
    return new RegularExpression(pattern->toWTFString(BunString::ZeroCopy), OptionSet<Flags>(static_cast<Flags>(flags)));
}
extern "C" void Yarr__RegularExpression__deinit(RegularExpression* re)
{
    delete re;
}
extern "C" bool Yarr__RegularExpression__isValid(RegularExpression* re)
{
    return re->isValid();
}
extern "C" int Yarr__RegularExpression__matchedLength(RegularExpression* re)
{
    return re->matchedLength();
}
extern "C" int Yarr__RegularExpression__matches(RegularExpression* re, const BunString* string)
{
    return re->match(string->toWTFString(BunString::ZeroCopy), 0, 0);
}

namespace Bun {

// A RegExp (source + flags) compiled for `regexp.test(input)` matching without
// a VM. Accepts every RegExp flag, unlike `Yarr::RegularExpression` above (i, m
// and v only). One thread at a time. Yarr names are fully qualified because the
// unified build can put `Bun::ErrorCode` in this translation unit.
class RegExpMatcher {
public:
    static RegExpMatcher* create(const BunString* pattern, const BunString* flagsString)
    {
        auto flags = JSC::Yarr::parseFlags(flagsString->toWTFString(BunString::ZeroCopy));
        if (!flags)
            return nullptr;

        // Yarr reads JSC::Options (e.g. dumpCompiledRegExpPatterns); this may run
        // before the runtime has finalized them, like Yarr__RegularExpression__init.
        // NOLINTBEGIN
        JSC::Options::AllowUnfinalizedAccessScope scope {};
        // NOLINTEND

        auto* matcher = new RegExpMatcher();
        JSC::Yarr::ErrorCode error = JSC::Yarr::ErrorCode::NoError;
        JSC::Yarr::YarrPattern yarrPattern(pattern->toWTFString(BunString::NonNull), *flags, error);
        if (!JSC::Yarr::hasError(error))
            matcher->m_bytecode = JSC::Yarr::byteCompile(yarrPattern, &matcher->m_allocator, error);
        if (JSC::Yarr::hasError(error) || !matcher->m_bytecode) {
            delete matcher;
            return nullptr;
        }
        return matcher;
    }

    bool matches(const BunString* input)
    {
        WTF::String string = input->toWTFString(BunString::NonNull);
        // The interpreter expects the start offset of every subpattern to be
        // initialized to "no match".
        WTF::Vector<unsigned, 32> offsets;
        offsets.fill(JSC::Yarr::offsetNoMatch, m_bytecode->m_offsetsSize);
        return JSC::Yarr::interpret(m_bytecode.get(), string, 0, offsets.mutableSpan().data()) != JSC::Yarr::offsetNoMatch;
    }

private:
    RegExpMatcher() = default;

    // Declared before the bytecode, which is allocated out of it, so that it
    // outlives the bytecode during destruction.
    WTF::BumpPointerAllocator m_allocator;
    std::unique_ptr<JSC::Yarr::BytecodePattern> m_bytecode;
};

} // namespace Bun

extern "C" Bun::RegExpMatcher* Bun__RegExpMatcher__create(const BunString* pattern, const BunString* flags)
{
    return Bun::RegExpMatcher::create(pattern, flags);
}
extern "C" bool Bun__RegExpMatcher__matches(Bun::RegExpMatcher* matcher, const BunString* input)
{
    return matcher->matches(input);
}
extern "C" void Bun__RegExpMatcher__destroy(Bun::RegExpMatcher* matcher)
{
    delete matcher;
}
