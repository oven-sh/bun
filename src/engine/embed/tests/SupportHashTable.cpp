#include "SupportFixtures.h"

#include <map>
#include <set>

using namespace Test;

struct CollidingHash {
    static unsigned hash(const auto& key) { return valueOf(key) % 3; }
    static bool equal(const auto& a, const auto& b) { return a == b; }
};

template<typename Key, typename Value, typename Hash = DefaultHash<Key>>
static void compareWithModel(unsigned keyRange, int steps)
{
    Random random;
    HashMap<Key, Value, Hash> map;
    std::map<int, int> model;
    for (int step = 0; step < steps; ++step) {
        int key = random.below(keyRange);
        int value = random.below(1000);
        bool isPresent = model.contains(key);
        // Long runs of growth and of shrinkage.
        bool isGrowing = step / (steps / 8) % 2 == 0;
        switch (random.below(8) + (isGrowing ? 0 : 3)) {
        case 0:
        case 1: {
            auto result = map.add(key, value);
            model.emplace(key, value);
            EXPECT(result.isNewEntry == !isPresent && valueOf(result.iterator->key) == key && valueOf(result.iterator->value) == model[key]);
            break;
        }
        case 2:
        case 3:
            EXPECT(map.set(key, value).isNewEntry == !isPresent);
            model[key] = value;
            break;
        case 4: {
            bool wasCalled = false;
            auto result = map.ensure(key, [&] { wasCalled = true; return Value(value); });
            model.emplace(key, value);
            EXPECT(wasCalled == !isPresent && valueOf(result.iterator->value) == model[key]);
            break;
        }
        case 5:
            EXPECT(map.contains(key) == isPresent && (map.find(key) != map.end()) == isPresent);
            EXPECT(valueOf(map.get(key)) == (isPresent ? model[key] : 0));
            EXPECT(map.getOptional(key).has_value() == isPresent);
            break;
        case 6:
        case 7:
            EXPECT(map.remove(key) == isPresent);
            model.erase(key);
            break;
        case 8:
            EXPECT(valueOf(map.take(key)) == (isPresent ? model[key] : 0));
            model.erase(key);
            break;
        case 9:
            EXPECT(map.takeOptional(key).has_value() == isPresent);
            model.erase(key);
            break;
        case 10:
            EXPECT(map.remove(map.find(key)) == isPresent);
            model.erase(key);
            break;
        }
        EXPECT(map.size() == model.size());
        if (step % 997)
            continue;
        if (!random.below(4)) {
            bool didRemove = map.removeIf([&](auto& entry) { return valueOf(entry.value) % 4 == 0; });
            EXPECT(didRemove == !!std::erase_if(model, [](auto& entry) { return entry.second % 4 == 0; }));
        }
        auto copy = map;
        map = random.below(2) ? WTF::move(copy) : copy;
        std::map<int, int> seen;
        for (auto& [key, value] : std::as_const(map))
            EXPECT(seen.emplace(valueOf(key), valueOf(value)).second);
        EXPECT(seen == model);
    }
    map.clear();
    EXPECT(map.isEmpty() && !map.capacity() && !map.byteSize() && map.begin() == map.end() && !Pinned::liveCount);
}

TEST(HashMapOfIntegersFollowsModel)
{
    compareWithModel<int, int>(20, 40000);
    compareWithModel<int, int>(5000, 200000);
}
TEST(HashMapOfPinnedObjectsFollowsModel) { compareWithModel<Pinned, Pinned>(600, 40000); }
TEST(HashMapOfBoxesFollowsModel) { compareWithModel<Boxed, Boxed>(600, 40000); }
TEST(HashMapWithCollisionsFollowsModel) { compareWithModel<int, Boxed, CollidingHash>(100, 40000); }

TEST(HashMapTakesEveryKey)
{
    HashMap<uint64_t, int> map;
    for (uint64_t key : { 0ull, 1ull, -1ull, -2ull })
        EXPECT(!map.contains(key) && map.add(key, 1).isNewEntry && map.contains(key));
    HashSet<void*> set { nullptr, reinterpret_cast<void*>(-1) };
    EXPECT(set.size() == 2 && set.contains(nullptr));
}

TEST(HashMapGrowsAndShrinks)
{
    HashMap<int, int> map;
    Vector<int> sizesAtChange;
    auto note = [&, capacity = 0u]() mutable {
        if (std::exchange(capacity, map.capacity()) != map.capacity())
            sizesAtChange.append(map.size());
    };
    for (int i = 0; i < 2100; ++i, note())
        map.add(i, i);
    for (int i = 0; i < 2100; ++i, note())
        map.remove(i);
    EXPECT(hasValues(sizesAtChange, { 1, 6, 12, 24, 48, 96, 192, 384, 768, 1024, 2048, 1365, 682, 341, 170, 85, 42, 21, 10, 5, 2 }));
    Vector<int> capacities;
    for (unsigned count : { 0, 1, 4, 5, 9, 10, 618, 619, 853, 854, 1706, 1707 }) {
        HashSet<int> set;
        set.reserveInitialCapacity(count);
        capacities.append(set.capacity());
    }
    EXPECT(hasValues(capacities, { 8, 8, 8, 16, 16, 32, 1024, 2048, 2048, 4096, 4096, 8192 }));
    EXPECT_CRASH(HashSet<int>().reserveInitialCapacity(-1));
}

TEST(HashMapIteratesOnFromAnEntry)
{
    HashMap<int, int> map;
    for (int i = 0; i < 100; ++i)
        map.add(i, i);
    auto keys = copyToVector(map.keys());
    for (size_t i = 0; i < keys.size(); ++i) {
        auto position = map.find(keys[i]);
        EXPECT(static_cast<size_t>(std::distance(position, map.end())) == keys.size() - i);
        EXPECT(i + 1 == keys.size() || (++position)->key == keys[i + 1]);
    }
    for (int& value : map.values())
        value = 1;
    EXPECT(map.values().size() == 100 && std::ranges::count(std::as_const(map).values(), 1) == 100);
}

TEST(HashMapOfSmartPointers)
{
    Ref object = Object::create(1);
    HashMap<RefPtr<Object>, Ref<Object>> map;
    map.add(object.ptr(), Object::create(2));
    const Object* key = object.ptr();
    static_assert(std::same_as<decltype(map.get(key)), Object*> && std::same_as<decltype(map.take(key)), RefPtr<Object>>);
    EXPECT(map.contains(key) && map.find(key)->value->value() == 2 && map.get(key)->value() == 2);
    EXPECT(object->refCount() == 2);
    EXPECT(map.take(key)->value() == 2 && !map.take(key) && !map.get(key) && !map.remove(key));
    EXPECT(object->hasOneRef());

    HashSet<Ref<Object>> set;
    EXPECT(set.add(object.copyRef()) && !set.add(object.get()) && set.contains(key));
    EXPECT(set.takeAny() == object.ptr() && !set.takeAny());
}

TEST(HashMapLeavesArgumentsAloneIfTheKeyIsThere)
{
    HashMap<Boxed, Boxed> map;
    map.add(1, 2);
    Boxed key(1), value(3);
    map.add(WTF::move(key), WTF::move(value));
    EXPECT(key.value() == 1 && value.value() == 3);
}

TEST(HashMapTakesArgumentsFromItself)
{
    HashMap<Pinned, Pinned> map;
    map.add(0, 1);
    for (int i = 0; i < 50; ++i) {
        auto& value = map.find(i)->value;
        map.add(value, Pinned(i + 2));
    }
    EXPECT(map.size() == 51);
    while (!map.isEmpty())
        map.remove(map.begin()->key);
}

TEST(HashMapMayChangeWhileAValueIsMade)
{
    HashMap<int, int> map;
    auto fibonacci = [&](this auto& self, int n) -> int {
        return map.ensure(n, [&] { return n < 2 ? n : self(n - 1) + self(n - 2); }).iterator->value;
    };
    EXPECT(fibonacci(30) == 832040 && map.size() == 31);
}

TEST(HashMapIsConsistentWhenAnEntryIsDestroyed)
{
    HashMap<int, Ref<Object>> map;
    for (int i = 0; i < 40; ++i)
        map.add(i, Object::create(i, [&, i] { EXPECT(!map.contains(i)); map.remove(i + 1); }));
    map.remove(0);
    EXPECT(map.isEmpty());
    map.add(1, Object::create(1, [&] { map.add(2, Object::create(2)); }));
    map.clear();
    EXPECT(map.size() == 1 && map.contains(2));
}

TEST(HashSetTranslates)
{
    struct Translator {
        static unsigned hash(int value) { return intHash(value); }
        static bool equal(const Boxed& element, int value) { return element.value() == value; }
        static void translate(Boxed* slot, int value, unsigned hash)
        {
            EXPECT(hash == intHash(value));
            std::construct_at(slot, value);
        }
    };
    HashSet<Boxed> set;
    EXPECT(set.add<Translator>(5).isNewEntry && !set.add<Translator>(5).isNewEntry);
    EXPECT(set.contains(Boxed(5)) && set.contains<Translator>(5) && set.find<Translator>(6) == set.end());
    HashMap<Boxed, int> map { { 1, 2 } };
    EXPECT(map.get<Translator>(1) == 2 && map.remove<Translator>(1) && !map.contains<Translator>(1));
}

TEST(HashMapAlignsItsEntries)
{
    HashMap<int, Int128> map;
    for (int i = 0; i < 20; ++i)
        EXPECT(!(reinterpret_cast<uintptr_t>(&map.add(i, i).iterator->value) % 16));
}

TEST(HashFunctions)
{
    EXPECT(DefaultHash<int>::hash(-1) == intHash(0xffffffff));
    EXPECT(computeHash(1, 2) != computeHash(2, 1));
}

TEST(HashCountedSetCounts)
{
    HashCountedSet<int> set;
    EXPECT(set.add(1).isNewEntry && !set.add(1, 2).isNewEntry);
    EXPECT(set.size() == 1 && set.begin()->value == 3);
}

#if ASSERT_ENABLED
TEST(HashMapNoticesStaleIterators)
{
    HashMap<int, int> map { { 1, 1 }, { 2, 2 } };
    auto position = map.find(1);
    map.remove(2);
    EXPECT_CRASH((void)position->value);
    EXPECT_CRASH(++position);
}
#endif

static_assert(sizeof(HashMap<int, int>) == 8 && sizeof(HashSet<int>) == 8);
static_assert(std::forward_iterator<HashMap<int, int>::iterator> && std::forward_iterator<decltype(HashMap<int, int>().keys().begin())>);
