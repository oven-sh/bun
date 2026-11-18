#include "SupportFixtures.h"

#include <vector>

using namespace Test;

template<typename VectorType>
static bool matches(const VectorType& vector, const std::vector<int>& model)
{
    return vector.size() <= vector.capacity() && std::ranges::equal(vector, model, [](auto& element, int value) { return valueOf(element) == value; });
}

template<typename T, size_t inlineCapacity>
static void compareWithModel()
{
    using VectorType = Vector<T, inlineCapacity, CrashOnOverflow, 2>;
    Random random;
    VectorType vector, other;
    std::vector<int> model, otherModel;
    for (int step = 0; step < 20000; ++step) {
        int value = random.below(50);
        size_t size = model.size();
        size_t position = random.below(size + 1);
        switch (random.below(24)) {
        case 0:
        case 1:
            vector.append(value);
            model.push_back(value);
            break;
        case 2:
            EXPECT(vector.tryAppend(T(value)));
            model.push_back(value);
            break;
        case 3:
            vector.constructAndAppend(value);
            model.push_back(value);
            break;
        case 4:
            if (position < size) {
                vector.append(vector[position]);
                model.push_back(int { model[position] });
            }
            break;
        case 5:
            if (size < 200) {
                vector.append(vector.subspan(position));
                std::vector<int> tail(model.begin() + position, model.end());
                model.insert(model.end(), tail.begin(), tail.end());
            }
            break;
        case 6:
            vector.insert(position, value);
            model.insert(model.begin() + position, value);
            break;
        case 7:
            if (size) {
                vector.insert(position, vector.last());
                model.insert(model.begin() + position, int { model.back() });
            }
            break;
        case 8:
            if (position < size) {
                vector.removeAt(position);
                model.erase(model.begin() + position);
            }
            break;
        case 9: {
            size_t length = random.below(size - position + 1);
            vector.removeAt(position, length);
            model.erase(model.begin() + position, model.begin() + position + length);
            break;
        }
        case 10:
            if (size) {
                EXPECT(valueOf(vector.takeLast()) == model.back());
                model.pop_back();
            }
            break;
        case 11: {
            auto removed = vector.removeAllMatching([&](auto& element) { return valueOf(element) % 5 == value % 5; }, position);
            auto end = std::remove_if(model.begin() + position, model.end(), [&](int element) { return element % 5 == value % 5; });
            EXPECT(removed == model.end() - end);
            model.erase(end, model.end());
            break;
        }
        case 12: {
            auto found = std::ranges::find(model, value);
            EXPECT(vector.find(T(value)) == (found == model.end() ? notFound : found - model.begin()));
            EXPECT(vector.removeFirstMatching([&](auto& element) { return valueOf(element) == value; }) == (found != model.end()));
            if (found != model.end())
                model.erase(found);
            break;
        }
        case 13:
            vector.shrink(position);
            model.resize(position);
            break;
        case 14:
            vector.resize(value);
            std::fill(vector.begin() + std::min<size_t>(size, value), vector.end(), T(7));
            model.resize(value, 7);
            break;
        case 15:
            vector.shrinkToFit();
            EXPECT(vector.capacity() == std::max(size, inlineCapacity));
            break;
        case 16:
            vector.reserveCapacity(value);
            EXPECT(vector.capacity() >= static_cast<size_t>(value));
            break;
        case 17:
            vector.swap(other);
            model.swap(otherModel);
            break;
        case 18:
            vector = other;
            model = otherModel;
            EXPECT(vector == other);
            break;
        case 19:
            other = WTF::move(vector);
            otherModel = std::exchange(model, {});
            break;
        case 20:
            vector.appendVector(VectorType(other));
            model.insert(model.end(), otherModel.begin(), otherModel.end());
            if (model.size() > 300) {
                vector.clear();
                model.clear();
                EXPECT(vector.capacity() == inlineCapacity);
            }
            break;
        case 21:
            if (size) {
                vector.fill(vector.first(), value);
                model.assign(value, int { model.front() });
            }
            break;
        case 22:
            vector.reverse();
            std::ranges::reverse(model);
            break;
        case 23: {
            VectorType moved(WTF::move(vector));
            EXPECT(vector.isEmpty() && vector.capacity() == inlineCapacity);
            vector = WTF::move(moved);
            break;
        }
        }
        EXPECT(matches(vector, model) && matches(other, otherModel));
    }
}

template<typename T>
static void compareWithModelForEachCapacity()
{
    compareWithModel<T, 0>();
    compareWithModel<T, 1>();
    compareWithModel<T, 7>();
    EXPECT(!Pinned::liveCount);
}

TEST(VectorOfBytesFollowsModel) { compareWithModelForEachCapacity<uint8_t>(); }
TEST(VectorOfIntegersFollowsModel) { compareWithModelForEachCapacity<int>(); }
TEST(VectorOfPinnedObjectsFollowsModel) { compareWithModelForEachCapacity<Pinned>(); }
TEST(VectorOfBoxesFollowsModel) { compareWithModelForEachCapacity<Boxed>(); }

TEST(VectorConstructors)
{
    EXPECT(hasValues(Vector<int> { 1, 2, 3 }, { 1, 2, 3 }));
    EXPECT(hasValues(Vector<Pinned>(2), { 0, 0 }));
    EXPECT(hasValues(Vector<int>(FillWith {}, 3, 9), { 9, 9, 9 }));
    EXPECT(hasValues(Vector<int>(3, [](size_t i) { return i * 2; }), { 0, 2, 4 }));
    std::array<uint8_t, 2> bytes { 5, 6 };
    EXPECT(hasValues(Vector<int>(std::span { bytes }), { 5, 6 }));
    EXPECT(hasValues(Vector<int, 4>(Vector<int> { 1, 2 }), { 1, 2 }));
    static_assert(std::same_as<decltype(Vector(std::span<const char>())), Vector<char>>);
    EXPECT(!Vector<int>(0).capacity());
}

TEST(VectorInitializesAllButPlainData)
{
    Vector<double> doubles(FillWith {}, 8, 1.0);
    doubles.shrink(0);
    doubles.grow(8);
    EXPECT(!doubles.contains(1.0));
    Vector<RefPtr<Object>> pointers(3);
    EXPECT(!pointers[0] && !pointers[2]);
    Vector<uint8_t> bytes;
    bytes.reserveInitialCapacity(4);
    memset(bytes.begin(), 3, 4);
    bytes.grow(4);
    EXPECT(hasValues(bytes, { 3, 3, 3, 3 }));
}

TEST(VectorChecksBounds)
{
    Vector<int, 2> vector { 1, 2 };
    Vector<int> empty;
    EXPECT_CRASH((void)vector[2]);
    EXPECT_CRASH((void)std::as_const(vector).at(-1));
    EXPECT_CRASH((void)empty.first());
    EXPECT_CRASH((void)empty.last());
    EXPECT_CRASH(empty.removeLast());
    EXPECT_CRASH(empty.takeLast());
    EXPECT_CRASH(vector.removeAt(2));
    EXPECT_CRASH(vector.removeAt(1, 2));
    EXPECT_CRASH(vector.removeAt(1, -1));
    EXPECT_CRASH(vector.insert(3, 0));
    EXPECT_CRASH(vector.shrink(3));
    EXPECT_CRASH(vector.grow(1));
    EXPECT_CRASH((void)vector.subspan(3));
    EXPECT_CRASH((void)vector.subspan(1, 2));
}

TEST(VectorLimitsItsCapacity)
{
    constexpr size_t limit = 0x7fffffff / sizeof(int);
    static_assert(WTF::isValidCapacityForVector<int>(limit) && !WTF::isValidCapacityForVector<int>(limit + 1));
    Vector<int> vector { 1 };
    for (size_t size : { limit + 1, size_t { 1 } << 32, (size_t { 1 } << 32) + 1, size_t { 1 } << 62, notFound }) {
        EXPECT(!vector.tryReserveCapacity(size));
        EXPECT(!vector.tryGrow(size));
        EXPECT(!vector.tryAppend(std::span<const int> { vector.begin(), size }));
        EXPECT(!Vector<int>().tryReserveInitialCapacity(size));
        EXPECT_CRASH(vector.reserveCapacity(size));
        EXPECT_CRASH(vector.grow(size));
        EXPECT_CRASH(vector.append(std::span<const int> { vector.begin(), size }));
        EXPECT_CRASH(Vector<int> tooLarge(size));
    }
    EXPECT(hasValues(vector, { 1 }));
}

struct ExhaustedMalloc : FastMalloc {
    static void* tryMalloc(size_t) { return nullptr; }
    static void* tryRealloc(void*, size_t) { return nullptr; }
};

TEST(VectorIsUnchangedWhenMemoryRunsOut)
{
    Vector<Boxed, 0, CrashOnOverflow, 1, ExhaustedMalloc> vector { 1 };
    Boxed element(2);
    EXPECT(!vector.tryAppend(WTF::move(element)));
    EXPECT(element.value() == 2);
    EXPECT(!vector.tryGrow(5) && !vector.tryReserveCapacity(5));
    EXPECT(hasValues(vector, { 1 }));
}

TEST(VectorGrowsByHalf)
{
    Vector<int> vector;
    Vector<int> capacities;
    for (int i = 0; i < 60; ++i) {
        vector.append(i);
        if (!capacities.contains(static_cast<int>(vector.capacity())))
            capacities.append(vector.capacity());
    }
    EXPECT(hasValues(capacities, { 16, 24, 36, 54, 81 }));
}

TEST(VectorReleasesItsBuffer)
{
    Vector<int, 2> vector { 1, 2 };
    EXPECT(hasValues(vector.releaseBuffer().span(), { 1, 2 }));
    EXPECT(vector.isEmpty() && vector.capacity() == 2);
    EXPECT(!vector.releaseBuffer());
    vector = { 1, 2, 3 };
    int* buffer = vector.begin();
    auto released = vector.releaseBuffer();
    EXPECT(released.span().data() == buffer && released.sizeInBytes() == 12);
    vector.append(4);
    EXPECT(hasValues(vector, { 4 }));
}

TEST(VectorIsConsistentWhenAnElementIsDestroyed)
{
    Vector<Ref<Object>> vector;
    Vector<int> sizes;
    auto fill = [&] {
        for (int i = 0; i < 3; ++i)
            vector.append(Object::create(i, [&] { sizes.append(vector.size()); }));
    };
    fill();
    vector.removeAt(0);
    vector.removeLast();
    vector.clear();
    fill();
    vector = {};
    EXPECT(hasValues(sizes, { 2, 1, 0, 0, 0, 0 }));
}

TEST(VectorRemovesWhatHasBeenMovedFrom)
{
    Vector<Pinned> vector { 1, 2, 3 };
    Pinned taken = WTF::move(vector[1]);
    vector.removeAt(1);
    EXPECT(hasValues(vector, { 1, 3 }));
}

TEST(VectorTakesTheElementsOfAnElement)
{
    struct Node {
        Vector<Node> children;
        Pinned name;
        int value() const { return name.value(); }
    };
    Vector<Node> nodes;
    nodes.append(Node { { Node { {}, 2 }, Node { {}, 3 } }, 1 });
    nodes = WTF::move(nodes[0].children);
    EXPECT(hasValues(nodes, { 2, 3 }));
    auto& same = nodes;
    nodes = WTF::move(same);
    EXPECT(hasValues(nodes, { 2, 3 }));
}

TEST(VectorPassesReferencesOnWhenItGrows)
{
    struct Pointer {
        Pointer(int& target)
            : target(&target)
        {
        }
        ~Pointer() {}
        int* target;
    };
    int target = 0;
    Vector<Pointer> pointers;
    pointers.append(target);
    Vector<std::reference_wrapper<int>> references;
    references.append(target);
    EXPECT(pointers[0].target == &target && &references[0].get() == &target);
}

TEST(VectorSearches)
{
    Vector<int> vector { 1, 2, 1 };
    EXPECT(vector.find(1) == 0 && vector.reverseFind(1) == 2 && vector.reverseFind(3) == notFound);
    EXPECT(vector.findIf([](int value) { return value > 1; }) == 1);
    EXPECT(!vector.containsIf([](int value) { return value > 2; }));
    Ref object = Object::create();
    Vector<RefPtr<Object>> pointers { nullptr, object.ptr() };
    EXPECT(pointers.find(object.ptr()) == 1);
}

TEST(VectorMaps)
{
    Vector<Boxed> vector { 1, 2 };
    EXPECT(hasValues(vector.map([](auto& element) { return element.value() * 2; }), { 2, 4 }));
    EXPECT(hasValues(WTF::map(vector, [](Boxed& element) { return element.value() + 1; }), { 2, 3 }));
    EXPECT(hasValues(WTF::map(WTF::move(vector), [](Boxed&& element) { return Boxed(WTF::move(element)); }), { 1, 2 }));
    EXPECT(hasValues(copyToVector(ListHashSet<int>()), {}));
    EXPECT(hasValues(copyToVectorOf<Pinned>(Vector<int> { 4, 5 }), { 4, 5 }));
}

#if ASAN_ENABLED
extern "C" int __asan_address_is_poisoned(const volatile void*);

TEST(VectorPoisonsWhatIsNotInUse)
{
    Vector<uint64_t> vector { 1, 2, 3 };
    vector.append(4);
    EXPECT(!__asan_address_is_poisoned(vector.end() - 1) && __asan_address_is_poisoned(vector.end()));
    vector.removeLast();
    EXPECT(__asan_address_is_poisoned(vector.end()));
    struct {
        Vector<char, 5> vector { 'a', 'b', 'c' };
        char next[16];
    } neighbors;
    neighbors.vector.shrink(0);
    EXPECT(!__asan_address_is_poisoned(neighbors.next));
}
#endif

static_assert(sizeof(Vector<int>) == 16 && sizeof(Vector<int, 4>) == 32);
