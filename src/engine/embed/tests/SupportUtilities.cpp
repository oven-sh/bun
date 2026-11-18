#include "SupportFixtures.h"

#include <unistd.h>

using namespace Test;

TEST(Assertions)
{
    RELEASE_ASSERT(true, "message", 1);
    EXPECT_CRASH(CRASH());
    EXPECT_CRASH(RELEASE_ASSERT(false));
    EXPECT_CRASH(RELEASE_ASSERT(false, "message %d", 1));
    EXPECT_CRASH(RELEASE_ASSERT_NOT_REACHED());
    EXPECT_CRASH(RELEASE_ASSERT_WITH_MESSAGE(false, "message %d", 1));
    EXPECT_CRASH(RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("message"));
    EXPECT(Test::crashes([] { ASSERT(false); }) == ASSERT_ENABLED);
    EXPECT(Test::crashes([] { ASSERT_NOT_REACHED(); }) == ASSERT_ENABLED);
    EXPECT(Test::crashes([] { ASSERT_WITH_MESSAGE(false, "message"); }) == ASSERT_ENABLED);
    EXPECT_CRASH(fastFree(fastMalloc(WTF::opaque(size_t { 1 } << 62))));
}

static int twice(int value) { return value * 2; }

TEST(Function)
{
    {
        Function<int(int)> function;
        EXPECT(!function && !Function<void()>(nullptr));
        function = twice;
        EXPECT(function(2) == 4);
        function = [](int value) { return value + 1; };
        EXPECT(function(2) == 3);
        function = [boxed = Boxed(5), calls = 0](int) mutable { return boxed.value() + ++calls; };
        EXPECT(function(0) == 6 && function(0) == 7);
        auto moved = WTF::move(function);
        EXPECT(!function && moved(0) == 8);
        Function<long(int)> wrapper = WTF::move(moved);
        EXPECT(wrapper(0) == 9);
        Function<int(std::unique_ptr<int>&&, int&)> forwarding = [](std::unique_ptr<int> a, int& b) { return b = *a; };
        int result = 0;
        EXPECT(forwarding(std::make_unique<int>(3), result) == 3 && result == 3);
    }
    EXPECT(!Pinned::liveCount);

    Function<void()> function;
    function = [&, object = Object::create(0, [&] { EXPECT(!function); })] {};
    function = nullptr;
    static_assert(sizeof(function) == 8);
}

TEST(ScopedLambda)
{
    auto call = [](const ScopedLambda<int(Boxed&&)>& lambda) { return lambda(Boxed(4)); };
    int base = 1;
    EXPECT(call([&](Boxed&& boxed) { return base + boxed.value(); }) == 5);
    const auto constant = [](const Boxed&) { return 2; };
    EXPECT(call(constant) == 2);
}

TEST(Scopes)
{
    int value = 1;
    {
        SetForScope change(value, 2);
        EXPECT(value == 2);
    }
    EXPECT(value == 1);
    {
        auto runs = makeScopeExit([&] { value += 10; });
        auto moved = WTF::move(runs);
        auto released = makeScopeExit([&] { value += 100; });
        released.release();
    }
    EXPECT(value == 11);
}

TEST(NeverDestroyed)
{
    {
        NeverDestroyed<Pinned> eager(3);
        LazyNeverDestroyed<Pinned> lazy {};
        EXPECT(Pinned::liveCount == 1);
        lazy.construct(4);
        const Pinned& reference = eager;
        EXPECT(reference.value() == 3 && lazy->value() == 4);
    }
    EXPECT(std::exchange(Pinned::liveCount, 0) == 2);
}

TEST(Variant)
{
    Variant<int, Boxed> variant = Boxed(3);
    EXPECT(WTF::switchOn(variant, [](int) { return 0; }, [](const Boxed& boxed) { return boxed.value(); }) == 3);
    EXPECT(WTF::switchOn(WTF::move(variant), [](int) { return Boxed(); }, [](Boxed&& boxed) { return WTF::move(boxed); }).value() == 3);
}

TEST(CheckedArithmetic)
{
    CheckedUint32 sum = 0xfffffffeu;
    sum += 1;
    EXPECT(!sum.hasOverflowed() && sum.value() == 0xffffffff);
    sum += 1;
    EXPECT(sum.hasOverflowed());
    EXPECT_CRASH(sum.value());
    EXPECT(CheckedUint32(size_t { 1 } << 32).hasOverflowed() && CheckedSize(-1).hasOverflowed());
}

TEST(MathExtras)
{
    static_assert(clampTo<uint8_t>(300.0) == 255 && clampTo<uint8_t>(-1.0) == 0 && clampTo<int8_t>(-1.5) == -1);
    static_assert(clampTo<int64_t>(1e30) == INT64_MAX && clampTo<int32_t>(__builtin_nan("")) == INT32_MIN);
    static_assert(hasOneBitSet(64u) && !hasOneBitSet(0) && !hasOneBitSet(6) && roundUpToPowerOfTwo(33u) == 64);
    static_assert(roundUpToMultipleOf<16>(17) == 32 && roundUpToMultipleOf(8, 16) == 16);

    auto modulo = [](double number) {
        unsigned long long result;
        doubleToInteger(number, result);
        return result;
    };
    EXPECT(modulo(3.9) == 3 && modulo(-1) == UINT64_MAX && modulo(-0.5) == 0 && modulo(0x1p64) == 0 && modulo(0x1p64 + 4096) == 4096);
    EXPECT(modulo(-0x1p63) == 1ull << 63 && !modulo(NAN) && !modulo(-INFINITY));

    EXPECT(truncateDoubleToInt64(-3.7) == -3 && truncateDoubleToInt64(-1e30) == INT64_MIN);
    EXPECT(truncateDoubleToUint64(3.7) == 3 && truncateDoubleToUint64(0x1p63) == 1ull << 63 && truncateDoubleToUint64(0x1.fffffffffffffp63) == -2048ull);
}

TEST(ByteOrder)
{
    static_assert(flipBytes<uint32_t>(0x01020304) == 0x04030201 && flipBytesIfLittleEndian<uint16_t>(0x0102, true) == 0x0102 && flipBytesIfLittleEndian<uint16_t>(0x0102, false) == 0x0201);
    uint8_t bytes[9] {};
    WTF::unalignedStore<uint64_t>(bytes + 1, 0x0102030405060708);
    EXPECT(bytes[1] == 8 && WTF::unalignedLoad<uint16_t>(bytes + 7) == 0x0102);
}

TEST(Float16)
{
    for (unsigned bits = 0; bits <= 0xffff; ++bits) {
        double value = std::bit_cast<Float16>(static_cast<uint16_t>(bits));
        double expected = std::bit_cast<_Float16>(static_cast<uint16_t>(bits));
        if (std::isnan(expected))
            EXPECT(std::isnan(value));
        else
            EXPECT(std::bit_cast<uint64_t>(value) == std::bit_cast<uint64_t>(expected));
    }
    auto half = [](uint16_t bits) { return std::bit_cast<Float16>(bits); };
    EXPECT(half(0) == half(0x8000) && half(0x7e00) != half(0x7e00));
}

TEST(Spans)
{
    std::array<uint16_t, 2> units { 0x0201, 0x0403 };
    EXPECT(hasValues(asByteSpan(std::span { units }), { 1, 2, 3, 4 }) && asByteSpan(units).size() == 4);
    EXPECT(spanReinterpretCast<const uint32_t>(std::span { units })[0] == 0x04030201);
    EXPECT_CRASH(spanReinterpretCast<const uint32_t>(asByteSpan(units).first(3)));
    std::array<uint16_t, 3> copy {};
    memcpySpan(std::span { copy }, std::span { units });
    EXPECT(equalSpans(std::span { copy }.first(2), std::span { units }) && !equalSpans(std::span { copy }, std::span { units }));
    EXPECT_CRASH(memcpySpan(std::span { units }, std::span { copy }));
    memsetSpan(std::span { copy }, 0xff);
    EXPECT(copy[2] == 0xffff);
    static_assert(std::same_as<decltype(byteCast<char>(asByteSpan(units))), std::span<const char>>);
    static_assert(std::same_as<decltype(byteCast<Latin1Character>(static_cast<char*>(nullptr))), Latin1Character*> && byteCast<uint8_t>('\xff') == 255);
}

TEST(ConstantTimeComparison)
{
    std::array<uint8_t, 3> a { 1, 2, 3 }, b { 1, 2, 131 };
    EXPECT(!constantTimeMemcmp(a, a) && constantTimeMemcmp(a, b));
    EXPECT_CRASH(constantTimeMemcmp(a, std::span { b }.first(2)));
}

TEST(TypeLists)
{
    using List = brigand::list<int, float, char>;
    static_assert(brigand::size<List>::value == 3 && std::same_as<brigand::front<List>, int> && std::same_as<brigand::at<List, brigand::ptrdiff_t<2>>, char>);
    static_assert(std::same_as<brigand::filter<List, std::is_integral<brigand::_1>>, brigand::list<int, char>>);
    static_assert(std::same_as<brigand::filter<List, std::is_same<void, brigand::_1>>, brigand::list<>>);
    static_assert(brigand::any<List, std::is_same<float, brigand::_1>>::value && !brigand::any<brigand::list<>, std::is_integral<brigand::_1>>::value);
    Vector<int> seen;
    brigand::for_each<brigand::make_sequence<brigand::ptrdiff_t<1>, 3>>([&](auto&& type) { seen.append(std::remove_cvref_t<decltype(type)>::type::value); });
    EXPECT(hasValues(seen, { 1, 2, 3 }));

    struct Leaf : std::optional<int> {};
    static_assert(WTF::IsTemplate<std::optional<int>, std::optional>::value && !WTF::IsTemplate<Leaf, std::optional>::value);
    static_assert(WTF::IsBaseOfTemplate<std::optional, const Leaf>::value && !WTF::IsBaseOfTemplate<std::optional, int>::value);
}

TEST(Time)
{
    static_assert((1500_ms).seconds() == 1.5 && Seconds::fromMicroseconds(2000).milliseconds() == 2 && Seconds::infinity().microsecondsAs<int64_t>() == INT64_MAX);
    static_assert(!MonotonicTime() && MonotonicTime::fromRawSeconds(-1) == MonotonicTime() - Seconds(1));
    auto inAnHour = (MonotonicTime::now() + Seconds(3600)).approximate<WallTime>();
    EXPECT(std::abs((inAnHour - WallTime::now()).seconds() - 3600) < 5);
    EXPECT(std::abs(WallTime::now().secondsSinceEpoch().seconds() - time(nullptr)) < 5);
}

TEST(CrossThreadCopy)
{
    struct Isolated {
        Isolated isolatedCopy() const& { return { 1 }; }
        Isolated isolatedCopy() && { return { 2 }; }
        int value() const { return number; }
        int number;
    };
    Isolated object { 0 };
    EXPECT(crossThreadCopy(object).number == 1 && crossThreadCopy(WTF::move(object)).number == 2 && crossThreadCopy(true));
    EXPECT(hasValues(crossThreadCopy(Vector<Isolated> { { 0 } }), { 1 }) && hasValues(crossThreadCopy(Vector<uint8_t> { 3 }), { 3 }));
}

TEST(Machine)
{
    EXPECT(WTF::numberOfProcessorCores() >= 1 && WTF::numberOfProcessorCores() <= sysconf(_SC_NPROCESSORS_ONLN) && ramSize() > MB);
}

TEST(StackTrace)
{
    auto text = StackTrace::captureStackTrace(2)->toString();
    EXPECT(text.startsWith("1   0x"_s) && text.contains("\n2   0x"_s) && !text.contains("\n3 "_s) && text.endsWith('\n'));
}

TEST(FileSystem)
{
    auto contents = WTF::FileSystemImpl::readEntireFile(String::fromUTF8(__FILE__));
    EXPECT(contents && contents->size() > 1000 && contents->first() == '#');
    EXPECT(!WTF::FileSystemImpl::readEntireFile("/does/not/exist"_s));
}
