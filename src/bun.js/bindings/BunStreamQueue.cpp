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
    m_queue.setMayBeNull(vm, owner, JSC::constructEmptyArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), 0));
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

void StreamQueue::resetQueue(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* owner)
{
    m_queue.set(vm, owner, JSC::constructEmptyArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), 0));
    this->queueTotalSize = 0;
    m_userDefinedQueueSizes.clear();
}

void StreamQueue::clearAlgorithms()
{
    m_userDefinedStrategy.clear();
}

void StreamQueue::enqueueValueWithSize(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSObject* owner, JSValue value, double size)
{
    m_queue->push(globalObject, value);

    this->queueTotalSize += size;

    if (type == StreamQueueType::UserDefined) {
        m_userDefinedQueueSizes.append(size);
    }

    vm.writeBarrier(owner);
}

JSValue StreamQueue::peekQueueValue(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    if (m_queue) {
        return m_queue.get()->getIndex(globalObject, 0);
    }
    return {};
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

template<JSArray::ShiftCountMode shiftCountMode>
static void shift(JSGlobalObject* globalObject, JSObject* thisObj, uint64_t header, uint64_t currentCount, uint64_t resultCount, uint64_t length)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    RELEASE_ASSERT(currentCount > resultCount);
    uint64_t count = currentCount - resultCount;

    RELEASE_ASSERT(header <= length);
    RELEASE_ASSERT(currentCount <= (length - header));

    if (isJSArray(thisObj)) {
        JSArray* array = asArray(thisObj);
        uint32_t header32 = static_cast<uint32_t>(header);
        ASSERT(header32 == header);
        if (array->length() == length && array->shiftCount<shiftCountMode>(globalObject, header32, static_cast<uint32_t>(count)))
            return;
        header = header32;
    }

    for (uint64_t k = header; k < length - currentCount; ++k) {
        uint64_t from = k + currentCount;
        uint64_t to = k + resultCount;
        JSValue value = getProperty(globalObject, thisObj, from);
        RETURN_IF_EXCEPTION(scope, void());
        if (value) {
            thisObj->putByIndexInline(globalObject, to, value, true);
            RETURN_IF_EXCEPTION(scope, void());
        } else {
            bool success = thisObj->deleteProperty(globalObject, to);
            RETURN_IF_EXCEPTION(scope, void());
            if (!success) {
                throwTypeError(globalObject, scope, UnableToDeletePropertyError);
                return;
            }
        }
    }
    for (uint64_t k = length; k > length - count; --k) {
        bool success = thisObj->deleteProperty(globalObject, k - 1);
        RETURN_IF_EXCEPTION(scope, void());
        if (!success) {
            throwTypeError(globalObject, scope, UnableToDeletePropertyError);
            return;
        }
    }
}

JSValue StreamQueue::dequeueValue(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* owner)
{
    if (!m_queue) {
        return {};
    }

    JSValue result = m_queue.get()->getIndex(globalObject, 0);
    unsigned index = 0;
    uint64_t length = m_queue->getArrayLength();
    shift<JSC::JSArray::ShiftCountMode::ShiftCountForShift>(globalObject, m_queue.get(), index, 1, 0, length);
    m_queue->setLength(globalObject, length > 0 ? length - 1 : 0);

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
