#include "root.h"

#include "BunClientData.h"
#include "ZigGlobalObject.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <wtf/BitVector.h>
#include <wtf/FixedVector.h>
#include <wtf/HashMap.h>

namespace Bun {

namespace JSCastingHelpers = JSC::JSCastingHelpers;

// What toMatchObject() and a snapshot with property matchers print in place of the properties that matched an asymmetric matcher.
class JestMatchedRows final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;
    static constexpr uint32_t notAnIndex = std::numeric_limits<uint32_t>::max();

    // One object can meet a different pattern in each place it appears, so a place is the pair. The rows that lead to it hold the object.
    struct Place {
        JSC::WriteBarrier<JSC::JSObject> pattern;
        JSC::WriteBarrier<JSC::Unknown> merged;
        unsigned firstRow { 0 };
        unsigned rowCount { 0 };
    };

    // `value` is the matcher, or what the walk read when `childPlace` is set. `order` is the position in the walk.
    struct Row {
        JSC::Identifier name;
        JSC::WriteBarrier<JSC::Unknown> value;
        uint32_t childPlace { 0 };
        uint32_t index { notAnIndex };
        uint32_t order { 0 };
    };

    static JestMatchedRows* create(JSC::VM& vm, JSC::Structure* structure, unsigned placeCount, unsigned rowCount)
    {
        auto* cell = new (NotNull, JSC::allocateCell<JestMatchedRows>(vm)) JestMatchedRows(vm, structure, placeCount, rowCount);
        cell->finishCreation(vm);
        return cell;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return createClassStructure(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static void destroy(JSC::JSCell* cell) { static_cast<JestMatchedRows*>(cell)->~JestMatchedRows(); }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JestMatchedRows, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJestMatchedRows, m_subspaceForJestMatchedRows));
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    Place* placeAt(uint32_t place)
    {
        return place && place <= m_places.size() ? &m_places[place - 1] : nullptr;
    }

    std::span<const Row> rowsOf(uint32_t place) const
    {
        if (!place || place > m_places.size())
            return {};
        return m_rows.subspan(m_places[place - 1].firstRow, m_places[place - 1].rowCount);
    }

    // The order of the rows of a place, for the binary search: array indices first, then the other names by address.
    static bool isBefore(uint32_t index, const WTF::UniquedStringImpl* name, uint32_t otherIndex, const WTF::UniquedStringImpl* otherName)
    {
        if (index != otherIndex)
            return index < otherIndex;
        return index == notAnIndex && std::less<>()(name, otherName);
    }

    const Row* find(uint32_t place, uint32_t index, const WTF::UniquedStringImpl* name) const
    {
        auto rows = rowsOf(place);
        auto row = std::lower_bound(rows.begin(), rows.end(), name, [index](const Row& row, const WTF::UniquedStringImpl* name) {
            return isBefore(row.index, row.name.impl(), index, name);
        });
        if (row == rows.end() || isBefore(index, name, row->index, row->name.impl()))
            return nullptr;
        return std::to_address(row);
    }

    const Row* find(uint32_t place, const JSC::Identifier& name) const
    {
        return find(place, JSC::parseIndex(name).value_or(notAnIndex), name.impl());
    }

private:
    friend JSC::JSValue matchedRowsFrom(JSC::JSGlobalObject*, DeepMatchState&, JSC::JSValue, JSC::JSValue);

    JestMatchedRows(JSC::VM& vm, JSC::Structure* structure, unsigned placeCount, unsigned rowCount)
        : Base(vm, structure)
        , m_places(placeCount)
        , m_rows(rowCount)
    {
    }

    // Neither is resized after the constructor, so the collector's threads walk them without a lock.
    WTF::FixedVector<Place> m_places;
    WTF::FixedVector<Row> m_rows;
};

const JSC::ClassInfo JestMatchedRows::s_info = { "JestMatchedRows"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JestMatchedRows) };

template<typename Visitor>
void JestMatchedRows::visitChildrenImpl(JSC::JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JestMatchedRows>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    for (auto& place : thisObject->m_places) {
        visitor.append(place.pattern);
        visitor.append(place.merged);
    }
    for (auto& row : thisObject->m_rows)
        visitor.append(row.value);
}

DEFINE_VISIT_CHILDREN(JestMatchedRows);

JSC::Structure* createMatchedRowsStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return JestMatchedRows::createStructure(vm, globalObject);
}

JSC::JSValue matchedRowsFrom(JSC::JSGlobalObject* globalObject, DeepMatchState& state, JSC::JSValue root, JSC::JSValue rootPattern)
{
    using PlaceKey = std::pair<JSC::JSCell*, JSC::JSCell*>;
    constexpr unsigned none = std::numeric_limits<unsigned>::max();
    size_t records = state.recordedNames.size();
    auto isMatcher = [&](size_t record) { return state.recorded.at(record * 4 + 3).isUndefined(); };

    // Most walks record no matched matcher, and then there is nothing to show.
    size_t firstMatcher = 0;
    while (firstMatcher < records && !isMatcher(firstMatcher))
        firstMatcher++;
    if (firstMatcher == records)
        return {};

    // Every (holder, pattern) pair that holds a record gets a number.
    WTF::HashMap<PlaceKey, unsigned> numbers;
    WTF::Vector<unsigned, 32> holderOf;
    holderOf.reserveInitialCapacity(records);
    for (size_t i = 0; i < records; i++)
        holderOf.append(numbers.add(PlaceKey { state.recorded.at(i * 4).asCell(), state.recorded.at(i * 4 + 1).asCell() }, numbers.size()).iterator->value);

    // Kept (not 0) are the places with a matched matcher and, to a fixed point because of cycles, the places that lead to one.
    WTF::Vector<unsigned, 32> handleOf(WTF::FillWith {}, numbers.size(), 0u);
    WTF::Vector<unsigned, 32> childOf(WTF::FillWith {}, records, none);
    for (size_t i = 0; i < records; i++) {
        if (isMatcher(i)) {
            handleOf[holderOf[i]] = 1;
            continue;
        }
        auto child = numbers.find(PlaceKey { state.recorded.at(i * 4 + 2).asCell(), state.recorded.at(i * 4 + 3).asCell() });
        if (child != numbers.end())
            childOf[i] = child->value;
    }
    for (bool changed = true; changed;) {
        changed = false;
        for (size_t i = records; i-- > 0;) {
            if (childOf[i] != none && handleOf[childOf[i]] && !handleOf[holderOf[i]]) {
                handleOf[holderOf[i]] = 1;
                changed = true;
            }
        }
    }

    // The root is place 1. Without it the printer reaches no row.
    auto rootNumber = numbers.find(PlaceKey { root.asCell(), rootPattern.asCell() });
    if (rootNumber == numbers.end() || !handleOf[rootNumber->value])
        return {};
    unsigned placeCount = 1;
    for (unsigned number = 0; number < handleOf.size(); number++) {
        if (handleOf[number] && number != rootNumber->value)
            handleOf[number] = ++placeCount;
    }

    struct Pending {
        unsigned place;
        uint32_t index;
        WTF::UniquedStringImpl* name;
        unsigned record;
    };
    WTF::Vector<Pending, 32> pending;
    for (size_t i = 0; i < records; i++) {
        unsigned place = handleOf[holderOf[i]];
        // A nested record whose place is not kept is no row: the printer reads that property from the object.
        if (!place || (!isMatcher(i) && (childOf[i] == none || !handleOf[childOf[i]])))
            continue;
        auto& name = state.recordedNames[i];
        // The printer lists no private names.
        if (name.isPrivateName())
            continue;
        pending.append(Pending { place, JSC::parseIndex(name).value_or(JestMatchedRows::notAnIndex), name.impl(), static_cast<unsigned>(i) });
    }
    std::sort(pending.begin(), pending.end(), [](const Pending& a, const Pending& b) {
        if (a.place != b.place)
            return a.place < b.place;
        if (JestMatchedRows::isBefore(a.index, a.name, b.index, b.name))
            return true;
        return !JestMatchedRows::isBefore(b.index, b.name, a.index, a.name) && a.record < b.record;
    });
    // A cycle back to the root walks the root place twice. The last record of a name wins, as when the records were applied in order.
    unsigned rowCount = 0;
    for (size_t i = 0; i < pending.size(); i++) {
        bool isLastOfName = i + 1 == pending.size() || pending[i].place != pending[i + 1].place || JestMatchedRows::isBefore(pending[i].index, pending[i].name, pending[i + 1].index, pending[i + 1].name);
        if (isLastOfName)
            pending[rowCount++] = pending[i];
    }

    // `state.recorded` roots every value until the cell holds it.
    auto& vm = JSC::getVM(globalObject);
    auto* zigGlobal = defaultGlobalObject(globalObject);
    auto* cell = JestMatchedRows::create(vm, zigGlobal->mockModule.matchedRowsStructure.getInitializedOnMainThread(zigGlobal), placeCount, rowCount);
    for (auto& entry : numbers) {
        if (unsigned place = handleOf[entry.value])
            cell->m_places[place - 1].pattern.set(vm, cell, JSC::asObject(entry.key.second));
    }
    for (unsigned i = 0; i < rowCount; i++) {
        unsigned record = pending[i].record;
        auto& row = cell->m_rows[i];
        row.name = WTF::move(state.recordedNames[record]);
        row.value.set(vm, cell, state.recorded.at(record * 4 + 2));
        row.index = pending[i].index;
        row.order = record;
        if (!isMatcher(record))
            row.childPlace = handleOf[childOf[record]];
        auto& place = cell->m_places[pending[i].place - 1];
        if (!place.rowCount++)
            place.firstRow = i;
    }
    return cell;
}

MatchedRow matchedRow(JSC::JSCell* rows, uint32_t place, const JSC::Identifier& name)
{
    auto* row = uncheckedDowncast<JestMatchedRows>(rows)->find(place, name);
    return row ? MatchedRow { row->value.get(), row->childPlace } : MatchedRow {};
}

void appendMissingMatchedRowNames(JSC::JSCell* cell, uint32_t place, std::span<const JSC::Identifier> names, WTF::Vector<JSC::Identifier>& missing)
{
    auto* matchedRows = uncheckedDowncast<JestMatchedRows>(cell);
    auto rows = matchedRows->rowsOf(place);
    if (rows.empty())
        return;
    WTF::BitVector listed(rows.size());
    for (auto& name : names) {
        if (auto* row = matchedRows->find(place, name))
            listed.quickSet(row - rows.data());
    }
    // In the order of the walk, so that what is appended does not depend on addresses.
    WTF::Vector<const JestMatchedRows::Row*, 8> unlisted;
    for (size_t i = 0; i < rows.size(); i++) {
        if (!listed.quickGet(i))
            unlisted.append(&rows[i]);
    }
    std::sort(unlisted.begin(), unlisted.end(), [](const JestMatchedRows::Row* a, const JestMatchedRows::Row* b) { return a->order < b->order; });
    for (auto* row : unlisted)
        missing.append(row->name);
}

} // namespace Bun

// For the functions below, `rows` is a cell that JSC__JSValue__jestDeepMatch handed out. None of them enters JavaScript.
extern "C" JSC::EncodedJSValue Bun__JestMatchedRows__get(JSC::EncodedJSValue rows, uint32_t place, const BunString* name, uint32_t* childPlace)
{
    auto* cell = uncheckedDowncast<Bun::JestMatchedRows>(JSC::JSValue::decode(rows));
    auto* row = cell->find(place, Bun::toIdentifier(cell->vm(), *name));
    *childPlace = row ? row->childPlace : 0;
    return JSC::JSValue::encode(row ? row->value.get() : JSC::JSValue());
}

extern "C" JSC::EncodedJSValue Bun__JestMatchedRows__getIndex(JSC::EncodedJSValue rows, uint32_t place, uint32_t index, uint32_t* childPlace)
{
    auto* row = uncheckedDowncast<Bun::JestMatchedRows>(JSC::JSValue::decode(rows))->find(place, index, nullptr);
    *childPlace = row ? row->childPlace : 0;
    return JSC::JSValue::encode(row ? row->value.get() : JSC::JSValue());
}

extern "C" JSC::EncodedJSValue Bun__JestMatchedRows__pattern(JSC::EncodedJSValue rows, uint32_t place)
{
    auto* found = uncheckedDowncast<Bun::JestMatchedRows>(JSC::JSValue::decode(rows))->placeAt(place);
    return JSC::JSValue::encode(found ? JSC::JSValue(found->pattern.get()) : JSC::JSValue());
}

// The empty value until Bun__JestMatchedRows__setMerged.
extern "C" JSC::EncodedJSValue Bun__JestMatchedRows__merged(JSC::EncodedJSValue rows, uint32_t place)
{
    auto* found = uncheckedDowncast<Bun::JestMatchedRows>(JSC::JSValue::decode(rows))->placeAt(place);
    return JSC::JSValue::encode(found ? found->merged.get() : JSC::JSValue());
}

extern "C" void Bun__JestMatchedRows__setMerged(JSC::EncodedJSValue rows, uint32_t place, JSC::EncodedJSValue merged)
{
    auto* cell = uncheckedDowncast<Bun::JestMatchedRows>(JSC::JSValue::decode(rows));
    if (auto* found = cell->placeAt(place))
        found->merged.set(cell->vm(), cell, JSC::JSValue::decode(merged));
}
