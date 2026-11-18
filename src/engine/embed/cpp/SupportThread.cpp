#include "engine/Support.h"

extern "C" void* Support__Thread__spawn(const char* name, size_t length, void (*run)(void*), void* context);
extern "C" void Support__Thread__join(void* handle);
extern "C" void Support__Thread__detach(void* handle);

namespace WTF {

thread_local constinit uint32_t Detail::idOfCurrentThread = 0;
thread_local constinit Thread* Thread::s_current = nullptr;

static uint32_t takeNextID()
{
    static std::atomic<uint32_t> lastID;
    uint32_t id = ++lastID;
    RELEASE_ASSERT(id);
    return id;
}

uint32_t Detail::assignIDToCurrentThread()
{
    return idOfCurrentThread = takeNextID();
}

Ref<Thread> Thread::create(ASCIILiteral name, Function<void()>&& entryPoint)
{
    Ref thread = adoptRef(*new Thread(takeNextID()));
    thread->m_entryPoint = WTF::move(entryPoint);
    auto run = [](void* context) {
        auto& thread = makeCurrent(adoptRef(*static_cast<Thread*>(context)));
        std::exchange(thread.m_entryPoint, nullptr)();
    };
    thread->m_joinHandle = Support__Thread__spawn(name.characters(), name.length(), run, &thread.copyRef().leakRef());
    RELEASE_ASSERT(thread->m_joinHandle);
    return thread;
}

Thread::~Thread()
{
    Support__Thread__detach(m_joinHandle);
}

Thread& Thread::createForCurrentThread()
{
    return makeCurrent(adoptRef(*new Thread(currentThreadID())));
}

Thread& Thread::makeCurrent(Ref<Thread>&& thread)
{
    static const uintptr_t key = Support__ThreadKey__create([](void* thread) {
        s_current = nullptr;
        static_cast<Thread*>(thread)->deref();
    });
    Detail::idOfCurrentThread = thread->uid();
    s_current = &thread.leakRef();
    Support__ThreadKey__set(key, s_current);
    return *s_current;
}

void Thread::waitForCompletion()
{
    RELEASE_ASSERT(m_joinHandle && this != s_current);
    Support__Thread__join(std::exchange(m_joinHandle, nullptr));
}

}
