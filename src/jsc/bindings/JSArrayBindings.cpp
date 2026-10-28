#include "root.h"

#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>

extern "C" uint32_t Bun__JSArray__length(JSC::EncodedJSValue encodedValue)
{
    return uncheckedDowncast<JSC::JSArray>(JSC::JSValue::decode(encodedValue).asCell())->length();
}

// Own storage only: the empty value for a hole, an index past the end, or sparse storage.
extern "C" JSC::EncodedJSValue Bun__JSArray__tryGetIndexQuickly(JSC::EncodedJSValue encodedValue, uint32_t index)
{
    JSC::JSArray* array = uncheckedDowncast<JSC::JSArray>(JSC::JSValue::decode(encodedValue).asCell());
    return JSC::JSValue::encode(array->tryGetIndexQuickly(index));
}

// Writes the own present indexes in ascending order, at most `capacity` of them. Returns how many there are.
extern "C" uint32_t Bun__JSArray__presentIndexes(JSC::EncodedJSValue encodedValue, uint32_t* out, uint32_t capacity)
{
    JSC::JSArray* array = uncheckedDowncast<JSC::JSArray>(JSC::JSValue::decode(encodedValue).asCell());
    uint32_t count = 0;
    auto add = [&](uint32_t index) {
        if (count < capacity)
            out[count] = index;
        count++;
    };

    switch (array->indexingType()) {
    case ALL_BLANK_INDEXING_TYPES:
    case ALL_UNDECIDED_INDEXING_TYPES:
        break;

    case ALL_INT32_INDEXING_TYPES:
    case ALL_CONTIGUOUS_INDEXING_TYPES: {
        JSC::Butterfly* butterfly = array->butterfly();
        for (unsigned i = 0, usedLength = butterfly->publicLength(); i < usedLength; ++i) {
            if (butterfly->contiguous().at(array, i))
                add(i);
        }
        break;
    }

    case ALL_DOUBLE_INDEXING_TYPES: {
        JSC::Butterfly* butterfly = array->butterfly();
        for (unsigned i = 0, usedLength = butterfly->publicLength(); i < usedLength; ++i) {
            // A hole is NaN in DoubleShape storage.
            double value = butterfly->contiguousDouble().at(array, i);
            if (value == value)
                add(i);
        }
        break;
    }

    case ALL_ARRAY_STORAGE_INDEXING_TYPES: {
        JSC::ArrayStorage* storage = array->butterfly()->arrayStorage();
        for (unsigned i = 0, usedLength = std::min(storage->length(), storage->vectorLength()); i < usedLength; ++i) {
            if (storage->m_vector[i])
                add(i);
        }
        JSC::SparseArrayValueMap* map = storage->m_sparseMap.get();
        if (map && !map->isEmpty()) {
            for (const auto& entry : *map)
                add(entry.index());
            if (count <= capacity)
                std::sort(out, out + count);
        }
        break;
    }

    default:
        ASSERT_NOT_REACHED();
        break;
    }

    return count;
}
