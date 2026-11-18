#include "Test.h"

#include <thread>

static std::span<const char16_t> units(std::u16string_view text) { return { text.data(), text.size() }; }
static String wide(std::u16string_view text) { return units(text); }
static String latin1(std::string_view text) { return byteCast<Latin1Character>(std::span { text.data(), text.size() }); }

TEST(LiteralLayout)
{
    static constexpr auto literal = "abc"_s;
    static_assert(literal.length() == 3 && literal[1] == 'b' && !literal.isNull() && !literal.isEmpty());
    static_assert(ASCIILiteral {}.isNull() && ""_s.isEmpty() && !""_s.isNull());
    static_assert("a\0b"_s.length() == 1);
    static_assert("a"_s == "a"_s && "a"_s != "b"_s && ASCIILiteral {} != ""_s);
    struct {
        const char* characters;
        size_t size;
    } raw;
    static_assert(sizeof(raw) == sizeof(literal));
    memcpy(&raw, &literal, sizeof(raw));
    EXPECT(raw.characters == literal.characters() && raw.size == 4);
}

TEST(CharacterClasses)
{
    for (unsigned code = 0; code < 0x300; ++code) {
        char16_t character = code;
        bool ascii = code < 0x80;
        EXPECT(isASCII(character) == ascii);
        EXPECT(isLatin1(character) == (code < 0x100));
        EXPECT(isASCIIDigit(character) == (ascii && isdigit(code)));
        EXPECT(isASCIIAlpha(character) == (ascii && isalpha(code)));
        EXPECT(isASCIIAlphanumeric(character) == (ascii && isalnum(code)));
        EXPECT(isASCIIHexDigit(character) == (ascii && isxdigit(code)));
        EXPECT(isASCIIUpper(character) == (ascii && isupper(code)));
        EXPECT(isASCIIWhitespace(character) == (ascii && isspace(code) && code != '\v'));
        EXPECT(toASCIILower(character) == (ascii ? tolower(code) : code));
        EXPECT(toASCIIUpper(character) == (ascii ? toupper(code) : code));
        if (code < 0x100) {
            EXPECT(isASCIIAlpha(static_cast<char>(code)) == isASCIIAlpha(character));
            EXPECT(isASCII(static_cast<char>(code)) == ascii);
            EXPECT(toASCIILower(Latin1Character { code }) == toASCIILower(character));
            EXPECT(toASCIIUpper(Latin1Character { code }) == toASCIIUpper(character));
        }
    }
    EXPECT(toASCIIHexValue('f', '0') == 0xF0 && toASCIIHexValue(u'0', u'A') == 0x0A);
}

template<size_t length> static void expectSameHash()
{
    static constexpr char text[] = "The quick brown fox jumps over the lazy dog, and then it does so again and again until there is no dog to jump over any more.";
    constexpr unsigned atCompileTime = StringHasher::computeLiteralHash({ text, length });
    EXPECT(atCompileTime == String { byteCast<Latin1Character>(std::span { text, length }) }.impl()->hash());
}

TEST(HashAtCompileTime)
{
    []<size_t... lengths>(std::index_sequence<lengths...>) { (expectSameHash<lengths>(), ...); }(std::make_index_sequence<120>());
    EXPECT(wide(u"abcdef").impl()->hash() == String("abcdef"_s).impl()->hash());
}

TEST(StaticStrings)
{
    String string = MAKE_STATIC_STRING_IMPL("static text");
    EXPECT(string.impl()->isStatic() && !string.impl()->hasOneRef() && string.impl()->hasHash());
    EXPECT(string == "static text"_s && string.impl()->costDuringGC() == 0);
    String copy = string;
    EXPECT(copy.impl() == string.impl() && copy.impl()->refCount() == 0);
    string.impl()->setNeverAtomize();
    AtomString atom { string };
    EXPECT(atom.impl()->isAtom() && atom == string && atom.impl() != string.impl());
    EXPECT(emptyString().impl() == StringImpl::empty() && StringImpl::empty()->isAtom() && nullString().isNull());
}

TEST(ReferenceCount)
{
    String string = latin1("counted");
    EXPECT(string.impl()->hasOneRef());
    {
        String copy = string;
        EXPECT(string.impl()->refCount() == 2);
    }
    EXPECT(string.impl()->hasOneRef());
    string.impl()->setNeverAtomize();
    auto churn = [&] {
        for (int i = 0; i < 20000; ++i)
            String copy = string;
    };
    std::thread first(churn), second(churn);
    first.join();
    second.join();
    EXPECT(string.impl()->hasOneRef());
    EXPECT_CRASH({
        uint32_t nearlyFull = 0xFFF00000;
        memcpy(static_cast<void*>(string.impl()), &nearlyFull, sizeof(nearlyFull));
        string.impl()->ref();
    });
}

TEST(NullAndEmpty)
{
    EXPECT(String().isNull() && String().isEmpty() && String().is8Bit() && !String().length() && !String()[0]);
    EXPECT(String(ASCIILiteral {}).isNull() && !String(""_s).isNull());
    EXPECT(String(std::span<const Latin1Character> {}).isNull() && String::fromUTF8(static_cast<const char*>(nullptr)).isNull());
    EXPECT(String() != emptyString() && String() != ""_s && emptyString() == ""_s && String() == String());
    EXPECT(StringView() == emptyString() && StringView() == ""_s);
    EXPECT(StringView().toString().isNull() && !StringView().toStringWithoutCopying().isNull() && !StringView().substring(0).isNull());
    EXPECT(String().substring(1).isNull() && String().isolatedCopy().isNull() && String().convertToASCIILowercase().isNull());
    EXPECT(String().substringSharingImpl(0).isNull() && String().trim(isASCIIWhitespace).isNull());
    EXPECT(String().find(""_str) == notFound && String("a"_s).find(StringView()) == notFound && StringView("a"_s).find(StringView()) == 0);
    EXPECT(!String().utf8().isNull() && !String().utf8().length() && !String().latin1().isNull());
    EXPECT(StringView().toAtomString().isNull() && AtomString(String()).isNull() && AtomString(""_s).impl() == StringImpl::empty());
}

TEST(EqualityAtEveryLength)
{
    for (unsigned length = 0; length < 100; ++length) {
        std::string text;
        for (unsigned i = 0; i < length; ++i)
            text += static_cast<char>('a' + i % 26);
        String narrow = latin1(text);
        String widened = narrow;
        widened.convertTo16Bit();
        EXPECT(narrow == latin1(text) && narrow == widened && widened == narrow && StringView(widened) == StringView(widened.isolatedCopy()));
        EXPECT(equalIgnoringASCIICase(narrow.convertToASCIIUppercase(), widened));
        EXPECT(StringView(narrow).startsWith(widened) && StringView(widened).endsWith(narrow));
        for (unsigned i = 0; i < length; ++i) {
            std::string other = text;
            other[i] = '_';
            String different = latin1(other);
            EXPECT(narrow != different && widened != different && StringView(narrow) != StringView(different));
            EXPECT(codePointCompareLessThan(different, narrow) && codePointCompare(widened, different) > 0);
            EXPECT(different.find('_') == i && different.reverseFind('_') == i && different.find('_', i + 1) == notFound);
            different.convertTo16Bit();
            EXPECT(widened != different && different.find('_') == i && different.reverseFind('_') == i);
            other[i] = '\xE9';
            EXPECT(!latin1(other).containsOnlyASCII());
        }
        EXPECT(narrow.containsOnlyASCII() && widened.containsOnlyASCII() && widened.containsOnlyLatin1());
    }
}

TEST(Search)
{
    String text = "one two one two"_s;
    EXPECT(text.find("two"_s) == 4 && text.find("two"_s, 5) == 12 && text.find("two"_s, 13) == notFound && text.find("x"_s, 99) == notFound);
    EXPECT(text.find(wide(u"two")) == 4 && text.find(wide(u"twĀ")) == notFound && text.find(u'ů') == notFound);
    EXPECT(text.reverseFind('o', 7) == 6 && text.reverseFind('o', 8) == 8 && text.reverseFind('o', 0) == 0 && text.reverseFind('n', 0) == notFound);
    EXPECT(text.findIgnoringASCIICase("TWO"_s, 5) == 12 && text.findIgnoringASCIICase("TWO"_s, 99) == notFound);
    EXPECT(text.startsWithIgnoringASCIICase("ONE"_s) && !text.startsWithIgnoringASCIICase("ONE TWO ONE TWO "_s));
    EXPECT(text.startsWith('o') && text.endsWith('o') && text.startsWith("one"_s) && text.endsWith("two"_s) && !text.endsWith("one"_s));
    EXPECT(StringView(text).find([](char16_t character) { return character == ' '; }, 4) == 7);
    EXPECT(text.containsOnly<isASCII>() && !text.containsOnly<isASCIIAlpha>());
    EXPECT(equalLettersIgnoringASCIICase("A-B"_str, "a-b"_s) && !equalLettersIgnoringASCIICase("A\rB"_str, "a-b"_s));
}

TEST(Parts)
{
    String text = "  a long enough text to be shared \n"_s;
    EXPECT(text.trim(isASCIIWhitespace) == "a long enough text to be shared"_s);
    EXPECT(" \t"_str.trim(isASCIIWhitespace) == ""_s && text.substring(0).impl() == text.impl() && text.substring(99) == ""_s);
    EXPECT(text.left(3) == "  a"_s && text.substring(4, 4) == "long"_s && !text.substring(2, 30).impl()->isSubString());
    String shared = text.substringSharingImpl(2, 30);
    EXPECT(shared.impl()->isSubString() && shared.span8().data() == text.span8().data() + 2);
    EXPECT(!WTF::move(shared).isolatedCopy().impl()->isSubString());

    Vector<String> parts;
    for (auto part : StringView(",a,,bc,"_s).split(','))
        parts.append(part.toString());
    "x\n\ny"_str.split('\n', [&](StringView part) { parts.append(part.toString()); });
    EXPECT(parts == Vector<String> { "a"_s, "bc"_s, "x"_s, "y"_s });
    EXPECT(StringView(",,"_s).split(',').begin() == StringView(",,"_s).split(',').end());

    std::u32string codePoints;
    String mixed = wide(u"a\U0001F600\xD800z\xDC00\xD83D");
    for (char32_t codePoint : StringView(mixed).codePoints())
        codePoints += codePoint;
    EXPECT(codePoints == std::u32string { U'a', 0x1F600, 0xD800, U'z', 0xDC00, 0xD83D });
    EXPECT(WTF::replaceUnpairedSurrogatesWithReplacementCharacter(String(mixed)) == wide(u"a\U0001F600�z��"));
}

TEST(Conversions)
{
    String text = wide(u"aé€\U0001F600");
    EXPECT(equalSpans(text.utf8().span(), std::span { u8"aé€\U0001F600" }.first(10)) && !text.utf8().data()[10]);
    EXPECT(String::fromUTF8(text.utf8().span()) == text);
    EXPECT(latin1("\xE9").utf8().length() == 2 && wide(u"\xD800").utf8().length() == 3);
    EXPECT(String::fromUTF8("a\xC3").isNull() && String::fromUTF8("\xED\xA0\x80").isNull());
    EXPECT(String::fromUTF8ReplacingInvalidSequences("a\xF0\x9F\x98z\xFF"_span8) == wide(u"a�z�"));
    EXPECT(String::tryFromUTF8ReplacingInvalidSequences(byteCast<char8_t>("\xC3"_span8)) == wide(u"\uFFFD") && String::tryFromUTF8ReplacingInvalidSequences({}).isNull());
    char16_t target[3];
    auto converts = [&](std::span<const Latin1Character> bytes, size_t length) { return StringImpl::tryConvertUTF8ToUTF16(byteCast<char8_t>(bytes), std::span { target }.first(length)); };
    EXPECT(converts("a\xC3\xA9"_span8, 2) && target[1] == 0xE9 && !converts("a\xC3\xA9"_span8, 1) && !converts("a\xC3\xA9"_span8, 3) && !converts("a\xC3"_span8, 1));
    EXPECT(String(text.latin1().span()) == latin1("a\xE9???"));
    EXPECT(latin1("stra\xDF"
                  "e")
               .convertToUppercaseWithoutLocale()
        == "STRASSE"_s);
    EXPECT(latin1("\xC9Z").convertToASCIILowercase() == latin1("\xC9z") && StringView("AB"_s).convertToASCIILowercaseAtom() == "ab"_s);
    String lower = latin1("lower");
    EXPECT(lower.convertToASCIILowercase().impl() == lower.impl());
    EXPECT(makeStringByReplacingAll("a%b%"_s, "%"_s, "%25"_s) == "a%25b%25"_s && makeStringByReplacingAll("a b"_s, ' ', '_') == "a_b"_s);
    EXPECT(makeStringByReplacingAll("#a"_s, '#', "%23"_s) == "%23a"_s && makeStringByReplacingAll(lower, 'x', 'y').impl() == lower.impl());

    auto copy = text.utf8();
    auto original = copy;
    copy.mutableSpan()[0] = 'b';
    EXPECT(original.data()[0] == 'a' && copy.data()[0] == 'b' && UTF8CString().isNull() && !UTF8CString().data());
}

TEST(LengthLimits)
{
    std::span<Latin1Character> narrow;
    std::span<char16_t> units;
    EXPECT(!StringImpl::tryCreateUninitialized(size_t { StringImpl::MaxLength } + 1, narrow) && !narrow.data());
    EXPECT(!StringImpl::tryCreateUninitialized(StringImpl::MaxLength, units));
    EXPECT(StringImpl::tryCreateUninitialized(0, narrow).get() == StringImpl::empty());
    StringView huge { "", StringImpl::MaxLength, true };
    EXPECT(tryMakeString(huge, 'a').isNull() && tryMakeString(huge, huge, huge).isNull() && !huge.tryGetUTF8());
    EXPECT_CRASH(makeString(huge, 'a'));
}

TEST(Atoms)
{
    String text = latin1("not an atom yet");
    AtomString atom { text };
    EXPECT(atom.impl() == text.impl() && text.impl()->isAtom());
    EXPECT(atom == AtomString("not an atom yet"_s) && atom == AtomString(units(u"not an atom yet")) && atom == makeAtomString("not an "_s, "atom yet"_s));
    EXPECT(AtomString::fromUTF8("\xC3\xA9"_span) == latin1("\xE9") && AtomString::fromUTF8("\xC3"_span).isNull());
    EXPECT(makeAtomString(4294967294u).impl()->isArrayIndexAtom() && !makeAtomString(4294967295u).impl()->isArrayIndexAtom());
    EXPECT(!String(atom).isolatedCopy().impl()->isAtom());

    char lent[] = "lent for a short time";
    AtomString kept { String { StringImpl::createWithoutCopying(unsafeSpan(lent)) } };
    lent[0] = 'r';
    EXPECT(kept == "lent for a short time"_s);
}

TEST(Symbols)
{
    static constexpr SymbolImpl::StaticSymbolImpl staticSymbol { "name"_s, SymbolImpl::s_flagIsPrivate };
    SymbolImpl& symbol = staticSymbol;
    EXPECT(symbol.isSymbol() && symbol.isStatic() && symbol.isPrivate() && !symbol.isRegistered() && equal(&symbol, "name"_s));
    EXPECT(symbol.existingSymbolAwareHash() == String("name"_s).impl()->hash());

    String description = latin1("description");
    Ref first = PrivateSymbolImpl::create(*description.impl());
    Ref second = PrivateSymbolImpl::create(*description.impl());
    EXPECT(first->hashForSymbol() != second->hashForSymbol() && first->isPrivate() && !first->isNullSymbol() && equal(first.ptr(), description.impl()));

    SymbolRegistry registry;
    Ref registered = registry.symbolForKey("key"_s);
    EXPECT(registered->isRegistered() && registered == registry.symbolForKey(wide(u"key")) && registered != registry.symbolForKey("other"_s));
}

static unsigned freed;
static void countFree(void* context, void* buffer, size_t byteLength)
{
    EXPECT(context == &freed && !memcmp(buffer, u"ab", 4) && byteLength == 4);
    ++freed;
}

TEST(ExternalStrings)
{
    static constexpr char16_t characters[] = u"ab";
    {
        String function = ExternalStringImpl::create({ characters, 2 }, &freed, countFree);
        String stateless = ExternalStringImpl::create({ characters, 2 }, &freed, [](void* context, void* buffer, unsigned length) { countFree(context, buffer, length); });
        String closure = ExternalStringImpl::create({ characters, 2 }, &freed, [held = latin1("held")](void* context, void* buffer, unsigned length) {
            EXPECT(held == "held"_s);
            countFree(context, buffer, length);
        });
        EXPECT(function.impl()->isExternal() && function == stateless && closure == "ab"_s && !freed);
    }
    EXPECT(freed == 3);
}

TEST(StringsAsKeys)
{
    HashMap<String, int> map;
    map.add("a"_s, 1);
    map.add(wide(u"a"), 2);
    EXPECT(map.size() == 1 && map.get("a"_s) == 1 && !map.contains(String()));
    HashSet<String, ASCIICaseInsensitiveHash> set;
    set.add("Name"_s);
    EXPECT(set.contains(wide(u"nAME")) && !set.contains("Names"_s));

    static constexpr SortedArrayMap sorted { std::to_array<std::pair<ComparableASCIILiteral, int>>({ { "a"_s, 1 }, { "b"_s, 2 } }) };
    EXPECT(*sorted.tryGet("b"_str) == 2 && !sorted.tryGet("c"_str));
}
