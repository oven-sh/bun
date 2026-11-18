#include "Test.h"

static String wide(std::u16string_view text) { return std::span { text.data(), text.size() }; }

static String repeated(char character, unsigned count)
{
    std::span<Latin1Character> characters;
    auto string = String::createUninitialized(count, characters);
    std::ranges::fill(characters, character);
    return string;
}

TEST(MakeString)
{
    EXPECT(makeString(INT32_MIN, ' ', UINT32_MAX, ' ', INT64_MIN, ' ', UINT64_MAX, ' ', int8_t { -128 }, uint8_t { 255 }, true) == "-2147483648 4294967295 -9223372036854775808 18446744073709551615 -1282551"_s);
    for (uint64_t power = 1, digits = 1; digits <= 20; power *= 10, ++digits)
        EXPECT(makeString(power).length() == digits && makeString(power - 1).length() == std::max<uint64_t>(digits - 1, 1));
    EXPECT(makeString(0.1, ' ', -0.0, ' ', 1e21, ' ', std::numeric_limits<double>::infinity()) == "0.1 0 1e+21 Infinity"_s);
    EXPECT(makeString(hex(0xABu), hex(u'\n', 4), hex(Latin1Character { 0xE9 }, 2), hex(1, 99)) == "AB000AE90000000000000001"_s);
    EXPECT(makeString(String(), ""_s, StringView()) == ""_s && !makeString(String()).isNull());

    String narrow = makeString("a"_s, u'\u00e9', U'\u00ff', '\xE9', AtomString("b"_s), "c"_span);
    EXPECT(narrow.is8Bit() && narrow == wide(u"a\u00e9\u00ff\u00e9bc"));
    String mixed = makeString("a"_s, -12, U'\U0001F600', '\xE9', 1.5, narrow.impl(), base64Encoded(asByteSpan("ab"_span)));
    EXPECT(!mixed.is8Bit() && mixed == wide(u"a-12\U0001F600\u00e91.5a\u00e9\u00ff\u00e9bcYWI="));
    EXPECT(makeAtomString(repeated('x', 64), 'y') == AtomString(makeString(repeated('x', 64), 'y')) && makeAtomString(u'\u20ac') == wide(u"\u20ac"));
}

TEST(BuilderGrowsAndWidens)
{
    for (unsigned length : { 0, 1, 62, 63, 64, 125, 126, 127, 1000 }) {
        StringBuilder builder;
        for (unsigned i = 0; i < length; ++i)
            builder.append('x');
        EXPECT(builder.length() == length && builder.is8Bit() && builder.span8().size() == length);
        builder.append(u'\u20ac');
        builder.append("ab"_s);
        builder.append(Latin1Character { 0xE9 });
        builder.append('c', 12);
        builder.appendQuotedJSONString("\n"_s);
        EXPECT(!builder.is8Bit() && builder.toString() == makeString(repeated('x', length), wide(u"\u20acab\u00e9c12\"\\n\"")));
    }
}

TEST(BuilderSharesStrings)
{
    for (unsigned length : { 1, 5, 500 }) {
        String first = repeated('a', length);
        StringBuilder builder;
        builder.append(first);
        EXPECT(builder.toString().impl() == first.impl());
        builder.append('b');
        String second = builder.toString();
        EXPECT(builder.toString().impl() == second.impl());
        builder.shrink(length);
        builder.append('c');
        String third = builder.toString();
        builder.shrink(0);
        EXPECT(builder.isEmpty() && builder.toString() == ""_s);
        builder.append(u'\u20ac');
        EXPECT(first == repeated('a', length) && second == makeString(first, 'b') && third == makeString(first, 'c') && builder.toString() == wide(u"\u20ac"));
    }
    EXPECT(!StringBuilder().toString().isNull());
}

TEST(BuilderMoves)
{
    for (unsigned length : { 3, 300 }) {
        StringBuilder source;
        source.append(StringView { repeated('a', length) });
        StringBuilder target { WTF::move(source) };
        source.append("new"_s);
        target.append('b');
        EXPECT(source.toString() == "new"_s && WTF::move(target).toString() == makeString(repeated('a', length), 'b') && target.isEmpty());
    }
}

TEST(BuilderOverflows)
{
    StringView huge { "", StringImpl::MaxLength, true };
    StringBuilder recording { OverflowPolicy::RecordOverflow };
    recording.append('a');
    recording.append(huge);
    EXPECT(recording.hasOverflowed() && !recording.isEmpty());
    recording.append('a');
    recording.append(u'\u20ac');
    recording.append("ab"_s);
    recording.append(""_s);
    recording.append("a"_str);
    recording.append(wide(u"ab"));
    recording.append('a', 1);
    recording.appendQuotedJSONString("a"_s);
    recording.reserveCapacity(10);
    recording.shrinkToFit();
    EXPECT(recording.hasOverflowed());
    EXPECT_CRASH(recording.toString());
    EXPECT_CRASH(recording.length());
    recording.clear();
    recording.append("ab"_s);
    EXPECT(recording.toString() == "ab"_s);
    recording.didOverflow();
    EXPECT(recording.hasOverflowed());

    EXPECT_CRASH({
        StringBuilder crashing;
        crashing.append('a', huge);
    });
}

TEST(Printing)
{
    EXPECT(toString("a", 1, ' ', 2u, uint8_t { 3 }, true, 0.5, "b"_s, wide(u"\u20ac"), "c"_str.utf8()) == wide(u"a1 23true0.500000b\u20acc"));
    EXPECT(toString(RawPointer(reinterpret_cast<void*>(0x10))).endsWith("10"_s) && toString(static_cast<StringImpl*>(nullptr)) == "(null StringImpl*)"_s);
    EXPECT(toUTF8CString(repeated('a', 500)).length() == 500 && toString() == ""_s);
}
