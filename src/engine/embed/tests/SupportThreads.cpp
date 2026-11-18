#include "SupportFixtures.h"

using namespace Test;

static void runOnThreads(unsigned count, const ScopedLambda<void(unsigned)>& body)
{
    Vector<Ref<Thread>> threads;
    for (unsigned i = 0; i < count; ++i)
        threads.append(Thread::create("Test"_s, [&body, i] { body(i); }));
    for (auto& thread : threads)
        thread->waitForCompletion();
}

TEST(LockExcludes)
{
    Lock lock;
    unsigned counter = 0;
    runOnThreads(6, [&](unsigned) {
        for (int i = 0; i < 50000; ++i) {
            Locker locker { lock };
            ++counter;
        }
    });
    EXPECT(counter == 300000 && !lock.isLocked());

    Locker locker { lock };
    EXPECT(lock.isLocked());
    locker.unlockEarly();
    EXPECT(!lock.isLocked());
}

TEST(ConditionHandsOver)
{
    Lock lock;
    Condition condition;
    unsigned turn = 0;
    runOnThreads(3, [&](unsigned thread) {
        for (int i = 0; i < 2000; ++i) {
            Locker locker { lock };
            while (turn % 3 != thread)
                condition.wait(lock);
            ++turn;
            condition.notifyAll();
        }
    });
    EXPECT(turn == 6000);
}

TEST(ConditionTimesOut)
{
    Lock lock;
    Condition condition;
    Locker locker { lock };
    auto start = MonotonicTime::now();
    EXPECT(!condition.waitFor(lock, 5_ms));
    EXPECT(MonotonicTime::now() - start >= 5_ms && lock.isLocked());
    EXPECT(!condition.waitFor(lock, Seconds(-1)) && !condition.waitFor(lock, Seconds(NAN)));
}

TEST(ThreadsHaveIdentities)
{
    uint32_t id = currentThreadID();
    EXPECT(id && Thread::currentSingleton().uid() == id && Thread::currentMayBeNull() == &Thread::currentSingleton());
    EXPECT(canCurrentThreadIDAccessThreadLocalData(id) && !Thread::mayBeGCThread());
    Thread* seen = nullptr;
    uint32_t seenID = 0;
    Ref thread = Thread::create("Identity"_s, [&, captured = Boxed(1)] {
        seen = Thread::currentMayBeNull();
        seenID = currentThreadID();
    });
    thread->waitForCompletion();
    EXPECT(seen == thread.ptr() && seenID == thread->uid() && seenID != id);
    EXPECT(thread->hasOneRef() && !Pinned::liveCount);
    EXPECT_CRASH(thread->waitForCompletion());
}

TEST(ThreadSpecificValuesEndWithTheirThreads)
{
    static std::atomic<int> liveCount;
    struct Value {
        Value() { ++liveCount; }
        ~Value() { --liveCount; }
    };
    static NeverDestroyed<ThreadSpecific<Value>> value;
    Value* mine = value.get();
    runOnThreads(3, [&](unsigned) {
        Value* theirs = value.get();
        EXPECT(theirs != mine && theirs == value.get());
    });
    EXPECT(liveCount == 1 && mine == value.get());
}

struct Shared : ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr<Shared> {
    ~Shared()
    {
        Ref protect { *this };
        EXPECT(!ThreadSafeWeakPtr<Shared> { *this }.get());
        isAlive = false;
    }
    bool isAlive { true };
};

TEST(ThreadSafeWeakPtr)
{
    EXPECT(!ThreadSafeWeakPtr<Shared>().get());
    for (int round = 0; round < 300; ++round) {
        RefPtr object = adoptRef(new Shared);
        ThreadSafeWeakPtr<Shared> weak { *object };
        EXPECT(weak.get() == object);
        EXPECT(object->hasOneRef());
        runOnThreads(3, [&](unsigned thread) {
            if (!thread) {
                object = nullptr;
                return;
            }
            auto copy = weak;
            for (int i = 0; i < 200; ++i) {
                if (RefPtr strong = copy.get())
                    EXPECT(strong->isAlive);
            }
        });
        EXPECT(!weak.get());
        weak = nullptr;
    }
}

TEST(SharedTaskIsSharedBetweenThreads)
{
    std::atomic<int> sum { 0 };
    Ref task = createSharedTask<void(int)>([&, owned = std::make_unique<int>(2)](int value) { sum += value * *owned; });
    runOnThreads(4, [&](unsigned) {
        for (int i = 0; i < 10000; ++i)
            task.copyRef()->run(1);
    });
    EXPECT(sum == 80000 && task->hasOneRef());
}

TEST(ThreadSuspendLockerExcludes)
{
    WTF::initializeMainThread();
    unsigned counter = 0;
    runOnThreads(3, [&](unsigned) {
        for (int i = 0; i < 1000; ++i) {
            ThreadSuspendLocker locker;
            ++counter;
        }
    });
    EXPECT(counter == 3000);
#if OS(LINUX)
    struct sigaction action;
    EXPECT(!sigaction(g_wtfConfig.sigThreadSuspendResume, nullptr, &action) && action.sa_handler != SIG_DFL);
#endif
}

#if ENABLE(SECURITY_ASSERTIONS)
TEST(WeakPtrBelongsToOneThread)
{
    Ref object = Object::create();
    WeakPtr weak { object };
    WeakPtr anywhere { object.ptr(), EnableWeakPtrThreadingAssertions::No };
    runOnThreads(1, [&](unsigned) { EXPECT(weak && anywhere.get()); });
    EXPECT_CRASH(runOnThreads(1, [&](unsigned) { weak.get(); }));
}
#endif
