#include "SupportFixtures.h"

using namespace Test;

TEST(RefCountsReferences)
{
    {
        Ref object = Object::create(1);
        Ref copy = object;
        EXPECT(object->refCount() == 2 && copy == object);
        Ref moved = WTF::move(copy);
        EXPECT(object->refCount() == 2);
        copy = object.get();
        moved = Derived::create(2);
        EXPECT(object->refCount() == 2 && moved->value() == 2);
        copy = copy.copyRef();
        Ref<Object> base = Derived::create(3);
        EXPECT(unsafeRefDowncast<Derived>(WTF::move(base))->value() == 3);
        adoptRef(copy.leakRef());
        EXPECT(object->hasOneRef());
    }
    EXPECT(!Pinned::liveCount);
}

TEST(RefPtrCountsReferences)
{
    {
        RefPtr<Object> pointer;
        EXPECT(!pointer && pointer == nullptr);
        pointer = Derived::create(1);
        RefPtr copy = pointer;
        EXPECT(copy == pointer && copy == pointer.get() && pointer->refCount() == 2);
        auto& same = copy;
        copy = same;
        copy = WTF::move(same);
        EXPECT(pointer->refCount() == 2);
        Ref reference = copy.releaseNonNull();
        EXPECT(!copy && pointer->refCount() == 2);
        RefPtr<Derived> derived = Derived::create(2);
        copy = derived;
        pointer = WTF::move(derived);
        EXPECT(!derived && copy == pointer && reference->hasOneRef());
        copy = nullptr;
        swap(copy, pointer);
        EXPECT(!pointer && copy->hasOneRef());
    }
    EXPECT(!Pinned::liveCount);
}

TEST(SmartPointersReleaseTheOldObjectLast)
{
    RefPtr<Object> pointer;
    pointer = Object::create(1, [&] { EXPECT(pointer->value() == 2); });
    pointer = Object::create(2, [&] { EXPECT(!pointer); });
    pointer = nullptr;
}

TEST(DestructorsMayTakeReferencesAndGiveThemBack)
{
    Object* self = nullptr;
    RefPtr object = Object::create(0, [&] { Ref protect { *self }; });
    self = object.get();
    object = nullptr;
    EXPECT(!Pinned::liveCount);
    EXPECT_CRASH(RefPtr object = Object::create(0, [&] { self->ref(); }); self = object.get());
}

TEST(RefPtrWithItsOwnTraits)
{
    struct Traits {
        static int& ref(int& count) { return ++count; }
        static int* refIfNotNull(int* count) { return count ? &ref(*count) : nullptr; }
        static void derefIfNotNull(int* count)
        {
            if (count)
                --*count;
        }
    };
    int count = 1;
    {
        auto pointer = adoptRef<int, RawPtrTraits<int>, Traits>(&count);
        auto copy = pointer;
        EXPECT(count == 2);
    }
    EXPECT(!count);
}

TEST(TypeCasts)
{
    Ref<Object> base = Object::create();
    Ref<Object> derived = Derived::create();
    const Object* null = nullptr;
    EXPECT(is<Derived>(derived.get()) && !is<Derived>(base.ptr()) && !is<Derived>(null));
    EXPECT(dynamicDowncast<Derived>(derived.get()) == derived.ptr() && !dynamicDowncast<Derived>(base.ptr()) && !dynamicDowncast<Derived>(null));
    EXPECT(&downcast<Derived>(derived.get()) == derived.ptr() && !downcast<Derived>(null) && !uncheckedDowncast<Derived>(null));
    static_assert(std::same_as<decltype(downcast<Derived>(null)), const Derived*>);
    EXPECT_CRASH(downcast<Derived>(base.get()));
    EXPECT_CRASH(downcast<Derived>(base.ptr()));
}

TEST(WeakPtr)
{
    RefPtr object = Derived::create(1);
    WeakPtr weak { *object };
    static_assert(std::same_as<decltype(weak), WeakPtr<Derived>>);
    WeakPtr<Object> fromPointer = object.get();
    auto copy = weak;
    EXPECT(weak && weak->value() == 1 && fromPointer.get() == object.get());
    {
        RefPtr strong = weak;
        EXPECT(object->refCount() == 2);
    }
    object = nullptr;
    EXPECT(!weak && !copy.get() && !fromPointer && !WeakPtr<Object>(static_cast<Object*>(nullptr)));
    EXPECT_CRASH((void)weak->value());
    EXPECT_CRASH(*weak);
}

class TargetImpl final : public WTF::WeakPtrImplBaseSingleThread<TargetImpl> {
public:
    using WeakPtrImplBaseSingleThread::WeakPtrImplBaseSingleThread;
    Pinned data { 7 };
};

struct Target : CanMakeWeakPtrWithBitField<Target, WeakPtrFactoryInitialization::Lazy, TargetImpl> {
    using CanMakeWeakPtr::initializeWeakPtrFactory;
    using CanMakeWeakPtr::weakPtrFactory;
};

TEST(WeakPtrFactoryHasSpareBits)
{
    {
        Target target;
        target.weakPtrFactory().setBitfield(0xffff);
        EXPECT(!target.weakPtrFactory().impl());
        target.initializeWeakPtrFactory();
        EXPECT(target.weakPtrFactory().bitfield() == 0xffff && target.weakPtrFactory().impl()->data.value() == 7);
        static_assert(sizeof(target) == 8 || ASAN_ENABLED);
    }
    EXPECT(!Pinned::liveCount);
}

TEST(UniqueRef)
{
    struct Base {
        WTF_MAKE_STRUCT_TZONE_ALLOCATED(Base);
        virtual ~Base() = default;
    };
    struct Leaf final : Base {
        Pinned member { 3 };
    };
    {
        auto leaf = makeUniqueRef<Leaf>();
        EXPECT(leaf->member.value() == 3);
        UniqueRef<Base> base = WTF::move(leaf);
    }
    EXPECT(!Pinned::liveCount);
}

TEST(CompactPointerTuple)
{
    enum class Tag : int8_t { Low = 1,
        High = -1 };
    int a, b;
    CompactPointerTuple<int*, Tag> tuple { &a, Tag::High };
    EXPECT(tuple.pointer() == &a && tuple.type() == Tag::High);
    tuple.setPointer(&b);
    EXPECT(tuple.type() == Tag::High);
    tuple.setType(Tag::Low);
    EXPECT(tuple.pointer() == &b && tuple.type() == Tag::Low);
}

TEST(OverAlignedObjects)
{
    struct alignas(256) Aligned {
        WTF_MAKE_STRUCT_TZONE_ALLOCATED(Aligned);
    };
    EXPECT(!(reinterpret_cast<uintptr_t>(makeUnique<Aligned>().get()) % 256));
}
