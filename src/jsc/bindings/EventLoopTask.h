#include "root.h"
#include "ScriptExecutionContext.h"

namespace WebCore {

class EventLoopTask {
    WTF_MAKE_TZONE_ALLOCATED(EventLoopTask);

public:
    enum CleanupTaskTag { CleanupTask };

    template<typename T, typename = typename std::enable_if<!std::is_base_of<EventLoopTask, T>::value && std::is_convertible<T, Function<void(ScriptExecutionContext&)>>::value>::type>
    EventLoopTask(T task)
        : m_task(WTF::move(task))
        , m_isCleanupTask(false)
    {
    }

    EventLoopTask(Function<void()>&& task)
        : m_task([task = WTF::move(task)](ScriptExecutionContext&) { task(); })
        , m_isCleanupTask(false)
    {
    }

    template<typename T, typename = typename std::enable_if<std::is_convertible<T, Function<void(ScriptExecutionContext&)>>::value>::type>
    EventLoopTask(CleanupTaskTag, T task)
        : m_task(WTF::move(task))
        , m_isCleanupTask(true)
    {
    }

    void performTask(ScriptExecutionContext& context)
    {
        m_task(context);
        delete this;
    }
    bool isCleanupTask() const { return m_isCleanupTask; }

protected:
    Function<void(ScriptExecutionContext&)> m_task;
    bool m_isCleanupTask;
};

}
