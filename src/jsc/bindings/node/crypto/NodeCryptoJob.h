#pragma once

#include "root.h"
#include "JSCallbackArgs.h"

namespace Bun {

// The callback form of a node:crypto function. node_crypto_binding.rs owns it once it is scheduled.
class NodeCryptoJob {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(NodeCryptoJob);
    WTF_MAKE_NONCOPYABLE(NodeCryptoJob);

public:
    // `Ctx` is plain data, which the synchronous form keeps on the stack.
    template<typename Ctx, typename... Args>
    static void schedule(JSC::JSGlobalObject* globalObject, JSC::JSValue callback, Args&&... args)
    {
        class Job final : public NodeCryptoJob {
        public:
            explicit Job(Args&&... args)
                : m_ctx(std::forward<Args>(args)...)
            {
            }

        private:
            void runTask(JSC::JSGlobalObject* globalObject) final { m_ctx.runTask(globalObject); }
            JSCallbackArgs runFromJS(JSC::JSGlobalObject* globalObject) final { return m_ctx.runFromJS(globalObject); }

            Ctx m_ctx;
        };
        schedule(globalObject, callback, makeUnique<Job>(std::forward<Args>(args)...));
    }

    virtual ~NodeCryptoJob() = default;
    virtual void runTask(JSC::JSGlobalObject*) = 0;
    virtual JSCallbackArgs runFromJS(JSC::JSGlobalObject*) = 0;

private:
    NodeCryptoJob() = default;
    static void schedule(JSC::JSGlobalObject*, JSC::JSValue callback, std::unique_ptr<NodeCryptoJob>&&);
};

} // namespace Bun
