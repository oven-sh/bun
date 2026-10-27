#pragma once

#include "root.h"
#include <optional>
#include <type_traits>
#include <wtf/FastMalloc.h>
#include <wtf/RefCounted.h>
#include <wtf/Ref.h>

namespace WebCore {
class ScriptExecutionContext;
}

namespace Bun {

// What the work queue carries: the C++ half of a `WorkQueueJob` (src/jsc/CppTask.rs).
class WorkQueueTask {
public:
    virtual ~WorkQueueTask() = default;
    virtual void run() = 0;
    virtual void complete() = 0;
};

// WebCrypto's WTF::WorkQueue, on Bun's work pool.
class PhonyWorkQueue : public WTF::RefCounted<PhonyWorkQueue> {
public:
    static Ref<PhonyWorkQueue> create(WTF::ASCIILiteral name);

    // `operation` must be safe to run and to destroy on a pool thread. `completion` takes its result
    // on the context's thread and never leaves that thread, so it can own what it settles.
    template<typename Operation, typename Completion>
    void dispatch(WebCore::ScriptExecutionContext& context, Operation&& operation, Completion&& completion)
    {
        schedule(context, *new Task<std::decay_t<Operation>, std::decay_t<Completion>>(std::forward<Operation>(operation), std::forward<Completion>(completion)));
    }

private:
    template<typename Operation, typename Completion>
    class Task final : public WorkQueueTask {
        WTF_DEPRECATED_MAKE_FAST_ALLOCATED(Task);

    public:
        Task(Operation&& operation, Completion&& completion)
            : m_operation(WTF::move(operation))
            , m_completion(WTF::move(completion))
        {
        }

        void run() final
        {
            m_result.emplace((*m_operation)());
            m_operation.reset();
        }

        // A task that never ran (its VM is stopping) is destroyed whole on the context's thread, not completed.
        void complete() final
        {
            RELEASE_ASSERT(m_result);
            m_completion(WTF::move(*m_result));
        }

    private:
        std::optional<Operation> m_operation;
        Completion m_completion;
        std::optional<std::invoke_result_t<Operation&>> m_result;
    };

    static void schedule(WebCore::ScriptExecutionContext&, WorkQueueTask&);
};

}; // namespace Bun
