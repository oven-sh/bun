#include "root.h"

#include <JavaScriptCore/ArrayStorage.h>
#include <JavaScriptCore/DirectArguments.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/ScopedArguments.h>
#include <JavaScriptCore/SparseArrayValueMap.h>
#include <algorithm>

namespace Bun {
namespace PresentIndexes {

// The walk of JSObject::getOwnIndexedPropertyNames: the vector over `from..end`, ascending, until `visit` returns true, then the map of the other indexes.
template<typename Visit, typename VisitMap>
static void walk(JSC::JSObject* object, uint32_t from, uint32_t end, const Visit& visit, const VisitMap& visitMap)
{
    switch (object->indexingType()) {
    case ALL_BLANK_INDEXING_TYPES:
    case ALL_UNDECIDED_INDEXING_TYPES:
        return;

    case ALL_INT32_INDEXING_TYPES:
    case ALL_CONTIGUOUS_INDEXING_TYPES: {
        JSC::Butterfly* butterfly = object->butterfly();
        end = std::min(butterfly->publicLength(), end);
        for (uint32_t i = from; i < end; ++i) {
            if (butterfly->contiguous().at(object, i) && visit(i))
                return;
        }
        return;
    }

    case ALL_DOUBLE_INDEXING_TYPES: {
        JSC::Butterfly* butterfly = object->butterfly();
        end = std::min(butterfly->publicLength(), end);
        for (uint32_t i = from; i < end; ++i) {
            // A hole is NaN in DoubleShape storage, which never holds a real NaN.
            double value = butterfly->contiguousDouble().at(object, i);
            if (value == value && visit(i))
                return;
        }
        return;
    }

    case ALL_ARRAY_STORAGE_INDEXING_TYPES: {
        JSC::ArrayStorage* storage = object->butterfly()->arrayStorage();
        end = std::min(std::min(storage->length(), storage->vectorLength()), end);
        for (uint32_t i = from; i < end; ++i) {
            if (storage->m_vector[i] && visit(i))
                return;
        }
        if (JSC::SparseArrayValueMap* map = storage->m_sparseMap.get())
            visitMap(*map);
        return;
    }

    default:
        ASSERT_NOT_REACHED();
        return;
    }
}

struct List {
    uint32_t* out;
    size_t capacity;
    size_t count { 0 };

    ALWAYS_INLINE void add(uint32_t index)
    {
        if (count < capacity)
            out[count] = index;
        ++count;
    }
};

// Adds the indexes of the butterfly that `skip` does not name. Returns false when they are not in ascending order.
template<typename Skip>
static bool addStorage(JSC::JSObject* object, uint32_t from, uint32_t end, List& list, const Skip& skip)
{
    bool ascending = true;
    walk(
        object, from, end,
        [&](uint32_t index) {
            if (!skip(index))
                list.add(index);
            return false;
        },
        [&](JSC::SparseArrayValueMap& map) {
            for (const auto& entry : map) {
                uint32_t index = entry.index();
                if (index >= from && index < end && !skip(index)) {
                    list.add(index);
                    ascending = false;
                }
            }
        });
    return ascending;
}

// A DirectArguments or ScopedArguments keeps its arguments in slots outside the butterfly. One with a redefined descriptor is in both.
template<typename Arguments>
static bool addArguments(Arguments* arguments, uint32_t from, uint32_t end, List& list)
{
    uint32_t slots = std::min(arguments->internalLength(), end);
    for (uint32_t i = from; i < slots; ++i) {
        if (arguments->isMappedArgument(i))
            list.add(i);
    }
    size_t mapped = list.count;
    bool ascending = addStorage(arguments, from, end, list, [&](uint32_t index) { return arguments->isMappedArgument(index); });
    return ascending && (!mapped || list.count == mapped);
}

}
}

// Smallest own present index of a JSArray that is >= `start`, or UINT64_MAX when the rest of the array is holes.
extern "C" uint64_t Bun__JSArray__nextPresentIndex(JSC::EncodedJSValue encodedValue, uint32_t start)
{
    JSC::JSArray* array = uncheckedDowncast<JSC::JSArray>(JSC::JSValue::decode(encodedValue).asCell());
    uint64_t result = std::numeric_limits<uint64_t>::max();
    Bun::PresentIndexes::walk(
        array, start, std::numeric_limits<uint32_t>::max(),
        [&](uint32_t index) {
            result = index;
            return true;
        },
        [&](JSC::SparseArrayValueMap& map) {
            for (const auto& entry : map) {
                if (entry.index() >= start && entry.index() < result)
                    result = entry.index();
            }
        });
    return result;
}

// Returns how many indexes in `from..end` an array or an arguments object holds and, when they fit in `capacity`, writes them to `out` in ascending order. Runs no JS.
extern "C" size_t Bun__JSObject__presentIndexesInRange(JSC::EncodedJSValue encodedValue, uint32_t from, uint32_t end, uint32_t* out, size_t capacity)
{
    JSC::JSObject* object = JSC::JSValue::decode(encodedValue).getObject();
    Bun::PresentIndexes::List list { out, capacity };
    bool ascending;

    switch (object->type()) {
    case JSC::DirectArgumentsType:
        ascending = Bun::PresentIndexes::addArguments(uncheckedDowncast<JSC::DirectArguments>(object), from, end, list);
        break;
    case JSC::ScopedArgumentsType:
        ascending = Bun::PresentIndexes::addArguments(uncheckedDowncast<JSC::ScopedArguments>(object), from, end, list);
        break;
    default:
        ascending = Bun::PresentIndexes::addStorage(object, from, end, list, [](uint32_t) { return false; });
        break;
    }

    if (!ascending && list.count <= capacity)
        std::sort(out, out + list.count);
    return list.count;
}
