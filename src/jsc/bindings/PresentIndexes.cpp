#include "root.h"

#include <JavaScriptCore/ArrayStorage.h>
#include <JavaScriptCore/DirectArguments.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/ScopedArguments.h>
#include <JavaScriptCore/SparseArrayValueMap.h>
#include <algorithm>
#include <limits>

namespace Bun {

using namespace JSC;

// Smallest index in `start..end` that the butterfly holds, or `end`. Mirrors the walk in JSObject::getOwnIndexedPropertyNames.
static ALWAYS_INLINE uint64_t nextPresentButterflyIndex(JSC::JSObject* object, uint32_t start, uint64_t end)
{
    switch (object->indexingType()) {
    case ALL_BLANK_INDEXING_TYPES:
    case ALL_UNDECIDED_INDEXING_TYPES:
        return end;

    case ALL_INT32_INDEXING_TYPES:
    case ALL_CONTIGUOUS_INDEXING_TYPES: {
        JSC::Butterfly* butterfly = object->butterfly();
        unsigned usedLength = static_cast<unsigned>(std::min<uint64_t>(butterfly->publicLength(), end));
        for (unsigned i = start; i < usedLength; ++i) {
            if (butterfly->contiguous().at(object, i))
                return i;
        }
        return end;
    }

    case ALL_DOUBLE_INDEXING_TYPES: {
        JSC::Butterfly* butterfly = object->butterfly();
        unsigned usedLength = static_cast<unsigned>(std::min<uint64_t>(butterfly->publicLength(), end));
        for (unsigned i = start; i < usedLength; ++i) {
            double value = butterfly->contiguousDouble().at(object, i);
            // The hole is NaN in DoubleShape storage. A real NaN is never stored there: JSObject::putByIndex and putDirectIndex convert to ContiguousShape first.
            if (value == value)
                return i;
        }
        return end;
    }

    case ALL_ARRAY_STORAGE_INDEXING_TYPES: {
        JSC::ArrayStorage* storage = object->butterfly()->arrayStorage();
        unsigned usedVectorLength = static_cast<unsigned>(std::min<uint64_t>(std::min(storage->length(), storage->vectorLength()), end));
        for (unsigned i = start; i < usedVectorLength; ++i) {
            if (storage->m_vector[i])
                return i;
        }

        uint64_t result = end;
        if (JSC::SparseArrayValueMap* map = storage->m_sparseMap.get()) {
            for (const auto& entry : *map) {
                if (entry.index() >= start && entry.index() < result)
                    result = entry.index();
            }
        }
        return result;
    }

    default:
        ASSERT_NOT_REACHED();
        return start;
    }
}

// Smallest own present index of a JSArray that is >= `start`, or UINT64_MAX when every index from `start` on is a hole.
extern "C" uint64_t Bun__JSArray__nextPresentIndex(
    JSC::EncodedJSValue encodedValue,
    uint32_t start)
{
    JSC::JSArray* array = uncheckedDowncast<JSC::JSArray>(JSC::JSValue::decode(encodedValue).asCell());
    return nextPresentButterflyIndex(array, start, std::numeric_limits<uint64_t>::max());
}

// Smallest index in `start..end` whose argument is still in its slot outside the butterfly, or `end`.
template<typename Slots>
static uint32_t nextMappedArgumentIndex(const Slots* slots, uint32_t start, uint32_t end)
{
    uint32_t count = std::min(slots->internalLength(), end);
    for (uint32_t i = start; i < count; ++i) {
        if (slots->isMappedArgument(i))
            return i;
    }
    return end;
}

// One copy of the butterfly walk for the three kinds of arguments objects.
static uint32_t nextPresentButterflyIndexBelow(JSC::JSObject* object, uint32_t start, uint32_t end)
{
    return static_cast<uint32_t>(nextPresentButterflyIndex(object, start, end));
}

// Smallest own present index in `start..end` of an arguments object, or `end`.
template<typename Slots>
static uint32_t nextPresentArgumentsIndex(JSC::JSObject* object, const Slots* slots, uint32_t start, uint32_t end)
{
    if (JSC::hasAnyArrayStorage(object->indexingType())) {
        JSC::ArrayStorage* storage = object->butterfly()->arrayStorage();
        if (JSC::SparseArrayValueMap* map = storage->m_sparseMap.get()) {
            // One lookup for each key the map holds comes before a scan of the map: a short run of holes must not cost the scan.
            uint32_t stop = static_cast<uint32_t>(std::min<uint64_t>(static_cast<uint64_t>(start) + map->size(), end));
            for (; start < stop; ++start) {
                // The map holds no key below the vector's length: JSObject::getOwnPropertySlotByIndex reads the two the same way.
                ASSERT(start >= storage->vectorLength() || !map->contains(start));
                if (slots->isMappedArgument(start) || (start < storage->vectorLength() ? !!storage->m_vector[start] : map->contains(start)))
                    return start;
            }
        }
    }
    if (start >= end)
        return end;
    return nextMappedArgumentIndex(slots, start, nextPresentButterflyIndexBelow(object, start, end));
}

// Smallest own present index in `start..length` of an arguments object, or UINT64_MAX when each of them is a hole.
extern "C" uint64_t Bun__Arguments__nextPresentIndex(
    JSC::EncodedJSValue encodedValue,
    uint32_t start,
    uint64_t length)
{
    JSC::JSObject* object = JSC::asObject(JSC::JSValue::decode(encodedValue));
    uint32_t end = static_cast<uint32_t>(std::min<uint64_t>(length, static_cast<uint64_t>(MAX_ARRAY_INDEX) + 1));

    uint32_t result;
    switch (object->type()) {
    case JSC::DirectArgumentsType:
        result = nextPresentArgumentsIndex(object, uncheckedDowncast<JSC::DirectArguments>(object), start, end);
        break;
    case JSC::ScopedArgumentsType:
        result = nextPresentArgumentsIndex(object, uncheckedDowncast<JSC::ScopedArguments>(object), start, end);
        break;
    case JSC::ClonedArgumentsType: {
        // ClonedArguments keeps each argument in the butterfly.
        struct NoArgumentSlots {
            uint32_t internalLength() const { return 0; }
            bool isMappedArgument(uint32_t) const { return false; }
        } slots;
        result = nextPresentArgumentsIndex(object, &slots, start, end);
        break;
    }
    default:
        ASSERT_NOT_REACHED();
        return start;
    }
    return result < end ? result : std::numeric_limits<uint64_t>::max();
}

}
