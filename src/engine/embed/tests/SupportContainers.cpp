#include "SupportFixtures.h"

#include <deque>
#include <list>

using namespace Test;

template<typename T, size_t inlineCapacity>
static void compareDequeWithModel()
{
    Random random;
    Deque<T, inlineCapacity> deque;
    std::deque<int> model;
    for (int step = 0; step < 30000; ++step) {
        int value = random.below(100);
        unsigned operation = random.below(model.empty() ? 2 : 11);
        switch (operation) {
        case 0:
            deque.append(value);
            model.push_back(value);
            break;
        case 1:
            deque.prepend(T(value));
            model.push_front(value);
            break;
        case 2:
            deque.append(deque.first());
            model.push_back(int { model.front() });
            break;
        case 3:
            deque.prepend(deque.last());
            model.push_front(int { model.back() });
            break;
        case 4:
        case 5:
            EXPECT(valueOf(deque.takeFirst()) == model.front());
            model.pop_front();
            break;
        case 6:
            EXPECT(valueOf(deque.takeLast()) == model.back());
            model.pop_back();
            break;
        case 7:
            deque.removeFirst();
            model.pop_front();
            break;
        case 8:
            deque.removeLast();
            model.pop_back();
            break;
        case 9: {
            auto moved = std::exchange(deque, {});
            EXPECT(deque.isEmpty());
            deque.append(value);
            deque = WTF::move(moved);
            EXPECT(moved.isEmpty());
            break;
        }
        case 10:
            if (value < 3) {
                deque.clear();
                model.clear();
            } else {
                for (int i = 0; i < value % 9; ++i) {
                    deque.append(i);
                    model.push_back(i);
                }
            }
            break;
        }
        EXPECT(deque.size() == model.size() && std::ranges::equal(std::as_const(deque), model, [](auto& element, int value) { return valueOf(element) == value; }));
    }
}

TEST(DequeFollowsModel)
{
    compareDequeWithModel<int, 0>();
    compareDequeWithModel<Pinned, 0>();
    compareDequeWithModel<Pinned, 4>();
    compareDequeWithModel<Boxed, 8>();
    EXPECT(!Pinned::liveCount);
}

TEST(DequeChecksBounds)
{
    Deque<int, 4> deque;
    EXPECT_CRASH(deque.first());
    EXPECT_CRASH(deque.last());
    EXPECT_CRASH(deque.takeFirst());
    EXPECT_CRASH(deque.takeLast());
    EXPECT_CRASH(deque.removeFirst());
    EXPECT_CRASH(deque.removeLast());
}

TEST(DequeIsConsistentWhenAnElementIsDestroyed)
{
    Deque<Ref<Object>, 4> deque;
    Vector<int> sizes;
    for (int i = 0; i < 4; ++i)
        deque.append(Object::create(i, [&] { sizes.append(deque.size()); }));
    deque.removeFirst();
    deque.removeLast();
    deque.clear();
    EXPECT(hasValues(sizes, { 3, 2, 0, 0 }));
}

TEST(FixedVector)
{
    EXPECT(FixedVector<int>(0).isEmpty() && !FixedVector<int>().byteSize());
    EXPECT(hasValues(FixedVector<Pinned>(2), { 0, 0 }));
    EXPECT(hasValues(FixedVector<char>(FillWith {}, 3, 4), { 4, 4, 4 }));
    Vector<Pinned, 2> source { 1, 2, 3 };
    FixedVector<Pinned> vector(WTF::move(source));
    EXPECT(source.isEmpty() && hasValues(vector, { 1, 2, 3 }) && vector.byteSize() == 3 * sizeof(Pinned));
    auto copy = vector;
    vector[0] = 9;
    EXPECT(hasValues(copy.span(), { 1, 2, 3 }));
    copy = WTF::move(vector);
    EXPECT(vector.isEmpty() && copy.at(0).value() == 9);
    EXPECT_CRASH(copy[3]);
    EXPECT_CRASH(vector[0]);
    EXPECT_CRASH(FixedVector<char> tooLarge(size_t { 1 } << 32));
    EXPECT(!(reinterpret_cast<uintptr_t>(FixedVector<Int128>(1).begin()) % 16));
    static_assert(sizeof(vector) == 8);
}

TEST(SegmentedVector)
{
    {
        SegmentedVector<Pinned, 4> vector;
        vector.append(0);
        Pinned* first = &vector.last();
        for (int i = 1; i < 10; ++i)
            vector.append(i);
        EXPECT(first == &vector[0]);
        for (int i = 0; i < 7; ++i)
            vector.removeLast();
        vector.append(7);
        vector.append(8);
        EXPECT(hasValues(vector, { 0, 1, 2, 7, 8 }));
        EXPECT_CRASH(vector[5]);
    }
    EXPECT(!Pinned::liveCount);
}

TEST(ListHashSetFollowsModel)
{
    Random random;
    ListHashSet<Pinned> set;
    std::list<int> model;
    for (int step = 0; step < 20000; ++step) {
        int value = random.below(60);
        bool isPresent = std::ranges::find(model, value) != model.end();
        switch (random.below(8)) {
        case 0:
        case 1:
        case 2: {
            auto result = set.add(value);
            EXPECT(result.isNewEntry == !isPresent && result.iterator->value() == value);
            if (!isPresent)
                model.push_back(value);
            break;
        }
        case 3:
            EXPECT(set.remove(value) == isPresent);
            model.remove(value);
            break;
        case 4:
            if (!model.empty()) {
                EXPECT(set.takeFirst().value() == model.front());
                model.pop_front();
            }
            break;
        case 5:
            if (!model.empty()) {
                EXPECT(set.last().value() == model.back() && set.remove(set.last()));
                model.pop_back();
            }
            break;
        case 6:
            EXPECT(set.contains(value) == isPresent);
            set = ListHashSet<Pinned>(set);
            break;
        case 7:
            if (value < 5) {
                set.removeIf([](auto& element) { return element.value() % 2; });
                model.remove_if([](int element) { return element % 2; });
            }
            break;
        }
        EXPECT(set.size() == model.size() && std::ranges::equal(set, model, [](auto& element, int value) { return element.value() == value; }));
    }
    set.clear();
    EXPECT(set.isEmpty() && !Pinned::liveCount);
    EXPECT_CRASH(set.last());
    EXPECT_CRASH(set.takeFirst());
}

TEST(ListHashSetKeepsItsElementsInPlace)
{
    ListHashSet<int> set;
    int* first = &*set.add(0).iterator;
    int count = 0;
    for (int value : set) {
        ++count;
        if (value < 99)
            set.add(value + 1);
    }
    EXPECT(count == 100 && first == &set.first());

    Ref object = Object::create();
    ListHashSet<RefPtr<Object>> pointers;
    pointers.add(object.ptr());
    EXPECT(pointers.remove(object.ptr()) && object->hasOneRef());
}

template<typename Set>
static void checkWeakSet()
{
    Set set;
    Ref first = Object::create(1);
    RefPtr second = Object::create(2);
    Ref stranger = Object::create(3);
    EXPECT(set.isEmptyIgnoringNullReferences());
    EXPECT(set.add(first).isNewEntry && !set.add(first).isNewEntry && set.add(*second).isNewEntry);
    EXPECT(set.contains(first) && !set.contains(stranger) && !set.remove(stranger) && !stranger->weakImplIfExists());
    second = nullptr;
    EXPECT(hasValues(set, { 1 }) && set.computeSize() == 1);
    EXPECT(copyToVectorOf<WeakPtr<Object>>(set)[0].get() == first.ptr());
    for (int i = 0; i < 10000; ++i)
        set.add(Object::create());
    EXPECT(set.capacity() <= 32);
    EXPECT(set.remove(first) && set.isEmptyIgnoringNullReferences());
    Ref leaving = Object::create(4, nullptr);
    set.add(leaving);
    EXPECT(hasValues(std::exchange(set, {}), { 4 }) && set.isEmptyIgnoringNullReferences());
}

TEST(WeakHashSet) { checkWeakSet<WeakHashSet<Object>>(); }

TEST(WeakListHashSet)
{
    checkWeakSet<WeakListHashSet<Object>>();
    WeakListHashSet<Object> set;
    Vector<RefPtr<Object>> objects;
    for (int i = 0; i < 5; ++i) {
        objects.append(Object::create(i));
        set.add(*objects.last());
    }
    objects[0] = objects[2] = objects[4] = nullptr;
    EXPECT(hasValues(set, { 1, 3 }));
}

TEST(SentinelLinkedList)
{
    struct Node : BasicRawSentinelNode<Node> {
        int number;
        int value() const { return number; }
    };
    SentinelLinkedList<Node, BasicRawSentinelNode<Node>> list;
    Node nodes[] { { {}, 0 }, { {}, 1 }, { {}, 2 } };
    EXPECT(list.isEmpty() && !nodes[0].isOnList());
    for (auto& node : nodes)
        list.append(&node);
    nodes[1].remove();
    EXPECT(!nodes[1].isOnList() && nodes[2].isOnList());
    Vector<int> values;
    for (auto& node : list)
        values.append(node.number);
    EXPECT(hasValues(values, { 0, 2 }));
    while (!list.isEmpty())
        list.begin()->remove();
}

TEST(BitSet)
{
    WTF::BitSet<130> bits;
    EXPECT(bits.findBit(0, true) == 130 && bits.findBit(5, false) == 5 && bits.findBit(130, false) == 130);
    for (size_t i : { 0, 63, 64, 129 })
        EXPECT(!bits.testAndSet(i) && bits.testAndSet(i));
    EXPECT(bits.findBit(1, true) == 63 && bits.findBit(63, false) == 65 && bits.findBit(65, true) == 129 && bits.findBit(129, false) == 130);
    bits.clear(63);
    Vector<int> set;
    bits.forEachSetBit([&](size_t i) { set.append(i); });
    EXPECT(hasValues(set, { 0, 64, 129 }));
    static_assert([] { WTF::BitSet<8> bits; bits.set(3); return bits.get(3) && !bits.get(2); }());
    static_assert(sizeof(WTF::BitSet<32>) == 4 && sizeof(WTF::BitSet<256>) == 32);
}

TEST(BitVector)
{
    BitVector bits;
    bits.ensureSize(65);
    EXPECT(!bits.quickSet(64) && bits.quickSet(64));
    bits.ensureSize(1000);
    EXPECT(bits.quickGet(64) && !bits.quickGet(0) && !bits.quickGet(999));
    EXPECT_CRASH(bits.quickSet(1024));
}

TEST(OptionSet)
{
    enum class Flag : uint8_t { A = 1,
        B = 2,
        C = 128 };
    constexpr OptionSet<Flag> all { Flag::A, Flag::B, Flag::C };
    static_assert(all.toRaw() == 131);
    OptionSet<Flag> flags;
    EXPECT(flags.isEmpty());
    flags.add(Flag::C);
    flags.set(Flag::A, true);
    flags.set(Flag::C, false);
    EXPECT(flags == Flag::A && flags.contains(Flag::A) && !flags.containsAny({ Flag::B, Flag::C }));
}

TEST(OwnedSpans)
{
    auto span = MallocSpan<uint16_t>::malloc(8);
    EXPECT(span.span().size() == 4 && span.sizeInBytes() == 8);
    auto moved = WTF::move(span);
    EXPECT(!span && moved);
    fastFree(moved.leakSpan().data());
    auto failed = MallocSpan<uint8_t>::tryMalloc(size_t { 1 } << 62);
    EXPECT(!failed && !failed.sizeInBytes());
    EXPECT_CRASH(MallocSpan<uint16_t>::malloc(3));

    auto pages = MmapSpan<uint8_t>::mmap(nullptr, 4096, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1);
    pages.mutableSpan()[4095] = 1;
    EXPECT(!MmapSpan<uint8_t>::mmap(nullptr, 4096, PROT_READ, MAP_PRIVATE, -1));
}
