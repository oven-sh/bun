#pragma once

#include "Test.h"

namespace Test {

class Random {
public:
    unsigned below(unsigned limit)
    {
        m_state = m_state * 6364136223846793005 + 1442695040888963407;
        return (m_state >> 33) % limit;
    }

private:
    uint64_t m_state { 1 };
};

// Notices when it is copied as bytes, used after its end or not destroyed.
class Pinned {
public:
    static inline int liveCount;

    Pinned(int value = 0)
        : m_value(value)
    {
        ++liveCount;
    }
    Pinned(const Pinned& other)
        : Pinned(other.value())
    {
    }
    Pinned(Pinned&& other)
        : Pinned(other.value())
    {
        other.m_value = movedFrom;
    }
    ~Pinned()
    {
        RELEASE_ASSERT(m_self == this);
        m_self = nullptr;
        --liveCount;
    }

    Pinned& operator=(const Pinned& other)
    {
        RELEASE_ASSERT(m_self == this);
        m_value = other.value();
        return *this;
    }

    int value() const
    {
        RELEASE_ASSERT(m_self == this && m_value != movedFrom);
        return m_value;
    }
    unsigned hash() const { return intHash(value()); }

    friend bool operator==(const Pinned& a, const Pinned& b) { return a.value() == b.value(); }

private:
    static constexpr int movedFrom = -12345;

    Pinned* m_self { this };
    int m_value;
};

// Owns memory, and can be moved as bytes.
class Boxed {
public:
    Boxed(int value = 0)
        : m_box(std::make_unique<Pinned>(value))
    {
    }
    Boxed(const Boxed& other)
        : Boxed(other.value())
    {
    }
    Boxed(Boxed&&) = default;
    Boxed& operator=(const Boxed& other) { return *this = Boxed(other); }
    Boxed& operator=(Boxed&&) = default;

    int value() const { return m_box->value(); }
    unsigned hash() const { return intHash(value()); }

    friend bool operator==(const Boxed& a, const Boxed& b) { return a.value() == b.value(); }

private:
    std::unique_ptr<Pinned> m_box;
};

int valueOf(const std::integral auto& value) { return value; }
int valueOf(const auto& object) { return object.value(); }

class Object : public RefCounted<Object>, public CanMakeWeakPtr<Object> {
public:
    static Ref<Object> create(int value = 0, Function<void()>&& willBeDestroyed = nullptr) { return adoptRef(*new Object(value, WTF::move(willBeDestroyed))); }

    virtual ~Object()
    {
        if (m_willBeDestroyed)
            m_willBeDestroyed();
    }

    int value() const { return m_value.value(); }
    virtual bool isDerived() const { return false; }

protected:
    Object(int value, Function<void()>&& willBeDestroyed)
        : m_value(value)
        , m_willBeDestroyed(WTF::move(willBeDestroyed))
    {
    }

private:
    Pinned m_value;
    Function<void()> m_willBeDestroyed;
};

class Derived final : public Object {
public:
    static Ref<Derived> create(int value = 0) { return adoptRef(*new Derived(value)); }

private:
    explicit Derived(int value)
        : Object(value, nullptr)
    {
    }

    bool isDerived() const final { return true; }
};

bool hasValues(auto&& container, std::initializer_list<int> values)
{
    auto expected = values.begin();
    for (const auto& element : container) {
        if (expected == values.end() || valueOf(element) != *expected++)
            return false;
    }
    return expected == values.end();
}

}

namespace Test {

template<typename T> struct HashOfValue {
    static unsigned hash(const T& key) { return key.hash(); }
    static bool equal(const T& a, const T& b) { return a == b; }
};

}

template<> struct WTF::DefaultHash<Test::Pinned> : Test::HashOfValue<Test::Pinned> {};
template<> struct WTF::DefaultHash<Test::Boxed> : Test::HashOfValue<Test::Boxed> {};

template<> struct WTF::VectorTraits<Test::Boxed> : WTF::VectorTraitsBase<false, void> {
    static constexpr bool canMoveWithMemcpy = true;
};

SPECIALIZE_TYPE_TRAITS_BEGIN(Test::Derived)
static bool isType(const Test::Object& object) { return object.isDerived(); }
SPECIALIZE_TYPE_TRAITS_END()
