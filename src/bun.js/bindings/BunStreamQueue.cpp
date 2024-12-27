#include "root.h"

#include "BunStreamQueue.h"
#include <JavaScriptCore/JSArray.h>
#include "JSByteLengthQueuingStrategy.h"
#include "JSCountQueuingStrategy.h"
#include "ErrorCode.h"

namespace Bun {

using namespace JSC;

static int64_t byteLength(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSValue value)
{
    if (auto* arrayBufferView = jsDynamicCast<JSArrayBufferView*>(value)) {
        return arrayBufferView->byteLength();
    }

    if (auto* arrayBuffer = jsDynamicCast<JSArrayBuffer*>(value)) {
        if (auto* impl = arrayBuffer->impl()) {
            return impl->byteLength();
        } else {
            return 0;
        }
    }

    if (auto* object = value.getObject()) {
        JSValue byteLengthProperty = object->getIfPropertyExists(globalObject, vm.propertyNames->byteLength);
        if (byteLengthProperty) {
            return byteLengthProperty.toLength(globalObject);
        }
    }

    return 0;
}

void StreamQueue::initialize(JSC::VM& vm, JSC::JSGlobalObject* globalObject, double highWaterMark, JSObject* owner, JSObject* sizeAlgorithm)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    this->highWaterMark = highWaterMark;
    m_queue.clear();
    this->queueTotalSize = 0;

    if (sizeAlgorithm) {
        if (auto* byteLengthStrategy = jsDynamicCast<JSByteLengthQueuingStrategy*>(sizeAlgorithm)) {
            this->type = StreamQueueType::ByteLengthQueuingStrategy;
            m_userDefinedStrategy.clear();
        } else if (auto* countStrategy = jsDynamicCast<JSCountQueuingStrategy*>(sizeAlgorithm)) {
            this->type = StreamQueueType::CountQueuingStrategy;
            m_userDefinedStrategy.clear();
        } else if (auto sizeFunction = sizeAlgorithm->getIfPropertyExists(globalObject, vm.propertyNames->size)) {
            if (!sizeFunction.isUndefinedOrNull()) {
                if (!sizeFunction.isCallable()) {
                    Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "Expected 'size' to be a function"_s);
                    return;
                }

                m_userDefinedStrategy.set(vm, owner, sizeFunction.getObject());
                this->type = StreamQueueType::UserDefined;
            }
        }
    }
}

void StreamQueue::resetQueue()
{
    {
        WTF::Locker locker { gcLock };
        m_queue.clear();
    }
    this->queueTotalSize = 0;
    m_userDefinedQueueSizes.clear();
}

void StreamQueue::clearAlgorithms()
{
    m_userDefinedStrategy.clear();
}

void StreamQueue::enqueueValueWithSize(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSObject* owner, JSValue value, double size)
{
    {
        WTF::Locker locker { gcLock };
        m_queue.append(value);
    }
    vm.heap.writeBarrier(owner, value);

    this->queueTotalSize += size;

    if (type == StreamQueueType::UserDefined) {
        m_userDefinedQueueSizes.append(size);
    }
}

JSValue StreamQueue::peekQueueValue(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    WTF::Locker locker { gcLock };
    return queue().first();
}

void StreamQueue::enqueueValueAndGetSize(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* owner, JSC::JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    double size;
    switch (type) {
    case StreamQueueType::UserDefined: {
        auto* userDefinedStrategy = m_userDefinedStrategy.get();
        JSC::CallData callData = JSC::getCallData(userDefinedStrategy);
        ASSERT_WITH_MESSAGE(callData.type != JSC::CallData::Type::None, "User defined strategy is not callable");
        MarkedArgumentBuffer args;
        args.append(value);
        JSValue result = JSC::call(globalObject, userDefinedStrategy, callData, jsUndefined(), args);
        RETURN_IF_EXCEPTION(scope, void());
        size = result.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, void());
        if (size < 0) {
            Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "Expected 'size' to be a non-negative number"_s);
            return;
        } else if (size == PNaN) {
            size = 0;
        } else if (size == std::numeric_limits<double>::infinity()) {
            Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "Expected 'size' to be a finite number"_s);
            return;
        }
        break;
    }
    case StreamQueueType::CountQueuingStrategy:
        size = 1;
        break;
    case StreamQueueType::ByteLengthQueuingStrategy:
        size = byteLength(vm, globalObject, value);
        RETURN_IF_EXCEPTION(scope, void());
        break;
    }

    this->enqueueValueWithSize(vm, globalObject, owner, value, size);
}

JSValue StreamQueue::dequeueValue(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* owner)
{
    JSValue result = {};
    {
        WTF::Locker locker { gcLock };
        result = queue().takeFirst();
    }
    vm.heap.writeBarrier(owner, result);

    auto scope = DECLARE_THROW_SCOPE(vm);

    RETURN_IF_EXCEPTION(scope, {});

    if (!result) {
        return {};
    }

    if (type == StreamQueueType::UserDefined) {
        auto size = m_userDefinedQueueSizes.takeFirst();
        this->queueTotalSize -= size;
    } else if (type == StreamQueueType::CountQueuingStrategy) {
        this->queueTotalSize -= 1;
    } else if (type == StreamQueueType::ByteLengthQueuingStrategy) {
        // This can technically throw because we call .byteLength on the value
        // and that value could be a JSObject with a getter for "byteLength"
        // that throws.
        this->queueTotalSize -= byteLength(vm, globalObject, result);
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (UNLIKELY(this->queueTotalSize < 0)) {
        this->queueTotalSize = 0;
    }

    return result;
}

}
