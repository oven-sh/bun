#include "root.h"
#include "EventLoopTask.h"

namespace WebCore {
class DeleteCallbackDataTask : public EventLoopTask {
public:
    template<typename CallbackDataType>
    explicit DeleteCallbackDataTask(CallbackDataType* data)
        : EventLoopTask(EventLoopTask::CleanupTask, [data](ScriptExecutionContext&) mutable {
            delete data;
        })
    {
    }
};

}
