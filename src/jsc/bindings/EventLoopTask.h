#include "root.h"
#include "ScriptExecutionContext.h"

namespace WebCore {

class EventLoopTask {
    WTF_MAKE_TZONE_ALLOCATED(EventLoopTask);

public:
    template<typename T, typename = typename std::enable_if<!std::is_base_of<EventLoopTask, T>::value && std::is_convertible<T, Function<void(ScriptExecutionContext&)>>::value>::type>
    EventLoopTask(T task)
        : m_task(WTF::move(task))
    {
    }

    EventLoopTask(Function<void()>&& task)
        : m_task([task = WTF::move(task)](ScriptExecutionContext&) { task(); })
    {
    }

    void performTask(ScriptExecutionContext& context)
    {
        m_task(context);
        delete this;
    }

protected:
    Function<void(ScriptExecutionContext&)> m_task;
};

}
