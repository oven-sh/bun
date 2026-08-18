#pragma once

#include "root.h"
#include <JavaScriptCore/Lookup.h>
#include <wtf/text/StringHasherInlines.h>
#include <array>
#include <bit>
#include <utility>

namespace Bun {

// Rows of a static property table. These are the initializers create_hash_table
// emits, written in C++ so that a row can sit behind the #ifdef that decides
// whether the platform has that constant at all.
constexpr JSC::HashTableValue constantInteger(ASCIILiteral name, long long value)
{
    return { name, static_cast<unsigned>(JSC::PropertyAttribute::ConstantInteger), JSC::NoIntrinsic, { JSC::HashTableValue::ConstantType, value } };
}

constexpr JSC::HashTableValue propertyCallback(ASCIILiteral name, JSC::LazyPropertyCallback callback)
{
    return { name, static_cast<unsigned>(JSC::PropertyAttribute::PropertyCallback), JSC::NoIntrinsic, { JSC::HashTableValue::LazyPropertyType, callback } };
}

constexpr JSC::HashTableValue nativeFunction(ASCIILiteral name, JSC::NativeFunction::Ptr function, intptr_t length)
{
    return { name, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, function, length } };
}

namespace StaticHashTableDetail {

template<int slotCount>
struct Layout {
    int16_t value[slotCount];
    int16_t next[slotCount];
};

constexpr bool sameKey(ASCIILiteral a, ASCIILiteral b)
{
    if (a.length() != b.length())
        return false;
    for (size_t i = 0; i < a.length(); i++) {
        if (a[i] != b[i])
            return false;
    }
    return true;
}

// Not constexpr on purpose: a table with two rows of the same name fails to
// compile, and the error names this function. (The putDirect loops this
// replaces silently let the second row overwrite the first.)
inline void duplicateRowInStaticHashTable() {}

// Same layout create_hash_table produces: a power-of-two array of buckets, then
// overflow slots that colliding buckets chain to through `next`. The bucket is
// chosen with the hash Identifier lookups use at runtime (HashTable::entry).
template<int bucketCount, int slotCount, size_t rowCount>
constexpr Layout<slotCount> layout(const JSC::HashTableValue (&rows)[rowCount])
{
    Layout<slotCount> layout {};
    for (int slot = 0; slot < slotCount; slot++) {
        layout.value[slot] = -1;
        layout.next[slot] = -1;
    }

    int overflow = bucketCount;
    for (size_t row = 0; row < rowCount; row++) {
        int slot = static_cast<int>(StringHasher::computeLiteralHashAndMaskTop8Bits(rows[row].m_key) & (bucketCount - 1));
        while (layout.value[slot] != -1) {
            if (sameKey(rows[layout.value[slot]].m_key, rows[row].m_key))
                duplicateRowInStaticHashTable();
            if (layout.next[slot] == -1)
                layout.next[slot] = static_cast<int16_t>(overflow++);
            slot = layout.next[slot];
        }
        layout.value[slot] = static_cast<int16_t>(row);
    }
    return layout;
}

template<int slotCount, size_t... slot>
constexpr std::array<JSC::CompactHashIndex, slotCount> index(const Layout<slotCount>& layout, std::index_sequence<slot...>)
{
    return { { JSC::CompactHashIndex { layout.value[slot], layout.next[slot] }... } };
}

template<size_t rowCount>
constexpr uint8_t seenPropertyAttributes(const JSC::HashTableValue (&rows)[rowCount])
{
    unsigned attributes = 0;
    for (const auto& row : rows)
        attributes |= row.m_attributes;
    return static_cast<uint8_t>(attributes);
}

} // namespace StaticHashTableDetail

// The JSC::HashTable for a `static constexpr JSC::HashTableValue rows[]`, built
// at compile time. Use it as the table of a ClassInfo.
template<const auto& rows>
struct StaticHashTable {
    static constexpr int rowCount = static_cast<int>(std::size(rows));
    static constexpr int bucketCount = static_cast<int>(std::bit_ceil(static_cast<unsigned>(2 * rowCount)));
    static constexpr int slotCount = bucketCount + rowCount;
    static_assert(slotCount <= std::numeric_limits<int16_t>::max(), "CompactHashIndex holds int16_t positions");

    static constexpr std::array<JSC::CompactHashIndex, slotCount> index = StaticHashTableDetail::index<slotCount>(
        StaticHashTableDetail::layout<bucketCount, slotCount>(rows), std::make_index_sequence<slotCount>());

    static constexpr JSC::HashTable table { rowCount, bucketCount - 1, StaticHashTableDetail::seenPropertyAttributes(rows), nullptr, rows, index.data() };
};

// An object whose own properties are a static property table, so a property
// costs nothing until it is first read. The constants bindings
// (process.binding('constants').*, process.binding('uv')) use one ClassInfo per
// table, all sharing this class.
class JSConstantsObject final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::HasStaticPropertyTable | JSC::OverridesGetOwnSpecialPropertyNames;

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSConstantsObject, Base);
        return &vm.plainObjectSpace();
    }

    // The ClassInfo that exposes `table`. Named "Object" so that inspect,
    // Object.prototype.toString and assert.deepStrictEqual see the plain object
    // this replaces.
    static constexpr JSC::ClassInfo classInfoFor(const JSC::HashTable* table)
    {
        return { "Object"_s, &s_info, table, nullptr, CREATE_METHOD_TABLE(JSConstantsObject) };
    }

    static JSConstantsObject* create(JSC::VM&, JSC::JSGlobalObject*, const JSC::ClassInfo*, JSC::JSValue prototype = JSC::jsNull());

    static void getOwnSpecialPropertyNames(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyNameArrayBuilder&, JSC::DontEnumPropertiesMode);

private:
    JSConstantsObject(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

// True for every ClassInfo made by JSConstantsObject::classInfoFor().
bool isConstantsObjectClassInfo(const JSC::ClassInfo*);

} // namespace Bun
