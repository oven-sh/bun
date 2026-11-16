#include "root.h"

#include "BunClientData.h"
#include "GeneratedExpect.h"
#include "ZigGlobalObject.h"
#include "headers-handwritten.h"
#include "headers.h"
#include <JavaScriptCore/AOTPropertyWalk.h>
#include <JavaScriptCore/ExceptionHelpers.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/RegExpObject.h>
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
    static constexpr uint32_t rootPlace = 1;

    // One object can meet a different pattern in each place it appears. `merged` is what mergedOf() made for the place.
    struct Place {
        JSC::WriteBarrier<JSC::JSObject> holder;
        JSC::WriteBarrier<JSC::JSObject> merged;
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

    // Null unless `rows` is a cell that matchedRowsFrom() made.
    static JestMatchedRows* from(JSC::EncodedJSValue rows)
    {
        JSC::JSValue value = JSC::JSValue::decode(rows);
        return value ? dynamicDowncast<JestMatchedRows>(value) : nullptr;
    }

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

    const Row* find(uint32_t place, JSC::PropertyName name) const
    {
        return find(place, JSC::parseIndex(name).value_or(notAnIndex), name.uid());
    }

    static MatchedRow toMatchedRow(const Row* row)
    {
        return row ? MatchedRow { row->value.get(), row->childPlace } : MatchedRow {};
    }

    // The bytes of the places and the rows, which are not in the GC heap. The collector counts them for this cell.
    size_t extraMemory() const { return m_places.byteSize() + m_rows.byteSize(); }

    // What snapshot serializers are offered for the object of `place`, which is a place of this cell. Empty only with an exception pending.
    JSC::JSValue forSerializers(JSC::JSGlobalObject*, uint32_t place);

private:
    friend JSC::JSValue matchedRowsFrom(JSC::JSGlobalObject*, DeepMatchState&, JSC::JSValue, JSC::JSValue);

    JestMatchedRows(JSC::VM& vm, JSC::Structure* structure, unsigned placeCount, unsigned rowCount)
        : Base(vm, structure)
        , m_places(placeCount)
        , m_rows(rowCount)
    {
    }

    using PlacesToFill = WTF::Vector<uint32_t, 16>;
    JSC::JSObject* mergedOf(JSC::JSGlobalObject*, uint32_t place, PlacesToFill&);
    void fillMergedOf(JSC::JSGlobalObject*, uint32_t place, PlacesToFill&);

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
        visitor.append(place.holder);
        visitor.append(place.merged);
    }
    for (auto& row : thisObject->m_rows)
        visitor.append(row.value);
    visitor.reportExtraMemoryVisited(thisObject->extraMemory());
}

DEFINE_VISIT_CHILDREN(JestMatchedRows);

JSC::Structure* createMatchedRowsStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return JestMatchedRows::createStructure(vm, globalObject);
}

JSC::JSValue matchedRowsFrom(JSC::JSGlobalObject* globalObject, DeepMatchState& state, JSC::JSValue root, JSC::JSValue rootPattern)
{
    // Most walks record no matched matcher, and then there is nothing to show.
    if (!state.recordedMatcher)
        return {};
    // A record that ran out of memory lacks values.
    if (state.recorded.hasOverflowed()) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    using PlaceKey = std::pair<JSC::JSCell*, JSC::JSCell*>;
    constexpr unsigned none = std::numeric_limits<unsigned>::max();
    size_t records = state.recordedNames.size();
    auto isMatcher = [&](size_t record) { return state.recorded.at(record * 4 + 3).isUndefined(); };

    // Every (holder, pattern) pair that holds a record gets a number.
    WTF::HashMap<PlaceKey, unsigned> numbers;
    WTF::Vector<unsigned, 32> holderOf;
    holderOf.reserveInitialCapacity(records);
    for (size_t i = 0; i < records; i++)
        holderOf.append(numbers.add(PlaceKey { state.recorded.at(i * 4).asCell(), state.recorded.at(i * 4 + 1).asCell() }, numbers.size()).iterator->value);

    // Kept (not 0) are the places with a matched matcher and the places that lead to one, also through a cycle.
    WTF::Vector<unsigned, 32> handleOf(WTF::FillWith {}, numbers.size(), 0u);
    WTF::Vector<unsigned, 32> childOf(WTF::FillWith {}, records, none);
    // Counts at `number + 2` the records that lead to a pair. Below, it becomes where the holders of that pair are in `holders`.
    WTF::Vector<unsigned, 32> holdersAt(WTF::FillWith {}, numbers.size() + 2, 0u);
    unsigned leadingRecords = 0;
    for (size_t i = 0; i < records; i++) {
        // The printer lists no private names.
        if (state.recordedNames[i].isPrivateName())
            continue;
        if (isMatcher(i)) {
            handleOf[holderOf[i]] = 1;
            continue;
        }
        auto child = numbers.find(PlaceKey { state.recorded.at(i * 4 + 2).asCell(), state.recorded.at(i * 4 + 3).asCell() });
        if (child != numbers.end()) {
            childOf[i] = child->value;
            holdersAt[child->value + 2]++;
            leadingRecords++;
        }
    }
    if (leadingRecords) {
        for (size_t number = 2; number < holdersAt.size(); number++)
            holdersAt[number] += holdersAt[number - 1];
        // The holders of a pair are from holdersAt[number] up to holdersAt[number + 1], once this loop has put them there.
        WTF::Vector<unsigned, 32> holders(WTF::FillWith {}, leadingRecords, 0u);
        for (size_t i = 0; i < records; i++) {
            if (childOf[i] != none)
                holders[holdersAt[childOf[i] + 1]++] = holderOf[i];
        }
        // Each kept place is taken once and each record is read once, so a pair that the walk met again costs no pass of its own.
        WTF::Vector<unsigned, 32> toKeepHoldersOf;
        for (unsigned number = 0; number < handleOf.size(); number++) {
            if (handleOf[number])
                toKeepHoldersOf.append(number);
        }
        while (!toKeepHoldersOf.isEmpty()) {
            unsigned number = toKeepHoldersOf.takeLast();
            for (unsigned at = holdersAt[number]; at < holdersAt[number + 1]; at++) {
                unsigned holder = holders[at];
                if (!handleOf[holder]) {
                    handleOf[holder] = 1;
                    toKeepHoldersOf.append(holder);
                }
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
        auto& name = state.recordedNames[i];
        // A nested record whose place is not kept is no row: the printer reads that property from the object.
        if (!place || name.isPrivateName() || (!isMatcher(i) && (childOf[i] == none || !handleOf[childOf[i]])))
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

    auto& vm = JSC::getVM(globalObject);
    // `state.recorded` roots every value until the cell holds it.
    auto* zigGlobal = defaultGlobalObject(globalObject);
    auto* cell = JestMatchedRows::create(vm, zigGlobal->mockModule.matchedRowsStructure.getInitializedOnMainThread(zigGlobal), placeCount, rowCount);
    for (auto& entry : numbers) {
        if (unsigned place = handleOf[entry.value])
            cell->m_places[place - 1].holder.set(vm, cell, JSC::asObject(entry.key.first));
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
    vm.heap.reportExtraMemoryAllocated(cell, cell->extraMemory());
    return cell;
}

MatchedRow matchedRow(JSC::JSCell* rows, uint32_t place, JSC::PropertyName name)
{
    return JestMatchedRows::toMatchedRow(uncheckedDowncast<JestMatchedRows>(rows)->find(place, name));
}

MatchedRow matchedRowAtIndex(JSC::JSCell* rows, uint32_t place, uint32_t index)
{
    return JestMatchedRows::toMatchedRow(uncheckedDowncast<JestMatchedRows>(rows)->find(place, index, nullptr));
}

MatchedRow matchedRow(JSC::JSCell* rows, uint32_t place, JSC::PropertyName name, MatchedRowsTaken taken)
{
    MatchedRow row = matchedRow(rows, place, name);
    if (taken == MatchedRowsTaken::AsOlderBunPrinted && row.childPlace)
        return {};
    return row;
}

uint32_t matchedPlaceOfRead(JSC::JSCell* rows, uint32_t place, JSC::PropertyName name, JSC::JSValue read)
{
    MatchedRow row = matchedRow(rows, place, name);
    return row.value == read ? row.childPlace : 0;
}

void appendMissingMatchedRowNames(JSC::JSCell* cell, uint32_t place, std::span<const JSC::Identifier> names, WTF::Vector<JSC::Identifier>& missing, MatchedRowsTaken taken)
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
    // In the order of the walk, so that what is appended does not depend on addresses. Few names are missing, so each is put in its place.
    WTF::Vector<const JestMatchedRows::Row*, 8> unlisted;
    for (size_t i = 0; i < rows.size(); i++) {
        if (listed.quickGet(i) || (taken != MatchedRowsTaken::All && rows[i].childPlace))
            continue;
        size_t at = unlisted.size();
        while (at && unlisted[at - 1]->order > rows[i].order)
            at--;
        unlisted.insert(at, &rows[i]);
    }
    for (auto* row : unlisted)
        missing.append(row->name);
}

// The object that serializers get for `place`, made on first use. `toFill` gets the places that still lack their properties.
JSC::JSObject* JestMatchedRows::mergedOf(JSC::JSGlobalObject* globalObject, uint32_t place, PlacesToFill& toFill)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& found = m_places[place - 1];
    if (JSC::JSObject* merged = found.merged.get())
        return merged;
    JSC::JSObject* holder = found.holder.get();
    JSC::JSObject* object = holder;
    bool isArray = JSC::isJSArray(holder);
    // A stand-in is for an array, a plain object or an instance of a class. A holder of another type, as a Map, a Response or a function, is offered as it is.
    if (found.rowCount && (isArray || holder->type() == JSC::FinalObjectType || JSC::AOT::PropertyWalk::isCompiledObject(holder))) {
        if (isArray) {
            object = JSC::constructEmptyArray(globalObject, nullptr);
            RETURN_IF_EXCEPTION(scope, nullptr);
        } else
            object = JSC::constructEmptyObject(globalObject);
        toFill.append(place);
    }
    found.merged.set(vm, this, object);
    return object;
}

// Gives the object of mergedOf() the holder's own enumerable properties, with each row in place of its property, which is not read.
void JestMatchedRows::fillMergedOf(JSC::JSGlobalObject* globalObject, uint32_t place, PlacesToFill& toFill)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSObject* holder = m_places[place - 1].holder.get();
    JSC::JSObject* merged = m_places[place - 1].merged.get();

    JSC::PropertyNameArrayBuilder names(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
    holder->methodTable()->getOwnPropertyNames(holder, globalObject, names, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, );
    WTF::Vector<JSC::Identifier> missing;
    appendMissingMatchedRowNames(this, place, names.data()->propertyNameVector().span(), missing);
    for (auto& name : missing)
        names.add(name);

    auto* array = dynamicDowncast<JSC::JSArray>(merged);
    for (const auto& name : names) {
        JSC::JSValue value;
        if (auto* row = find(place, name)) {
            // An array keeps its own length.
            if (array && name == vm.propertyNames->length)
                continue;
            if (row->childPlace) {
                JSC::JSObject* child = mergedOf(globalObject, row->childPlace, toFill);
                RETURN_IF_EXCEPTION(scope, );
                value = child;
            } else
                value = row->value.get();
        } else {
            value = holder->get(globalObject, name);
            // A getter that throws leaves its property out.
            if (scope.exception()) [[unlikely]] {
                TRY_CLEAR_EXCEPTION(scope, );
                continue;
            }
        }
        merged->putDirectMayBeIndex(globalObject, name, value);
        RETURN_IF_EXCEPTION(scope, );
    }
    if (array) {
        array->setLength(globalObject, uncheckedDowncast<JSC::JSArray>(holder)->length());
        RETURN_IF_EXCEPTION(scope, );
    }
}

JSC::JSValue JestMatchedRows::forSerializers(JSC::JSGlobalObject* globalObject, uint32_t place)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    // Filled from a list and not by recursion, so a long chain of places takes no stack.
    PlacesToFill toFill;
    JSC::JSObject* merged = mergedOf(globalObject, place, toFill);
    RETURN_IF_EXCEPTION(scope, {});
    for (size_t next = 0; next < toFill.size(); next++) {
        fillMergedOf(globalObject, toFill[next], toFill);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return merged;
}

} // namespace Bun

// expect.rs. -1 if `value` is no asymmetric matcher. Else whether it is of expect.resolvesTo or expect.rejectsTo.
extern "C" int8_t Expect__asymmetricMatcherReadsPromise(JSC::EncodedJSValue value);

namespace Bun {

// A plain object, a class instance and an array. A read at a key of any other kind can be a native getter that changes the object, and at most of them the printer shows no row.
bool diffAsksAtKeysOf(JSC::JSType type)
{
    switch (type) {
    case JSC::FinalObjectType:
    case JSC::ArrayType:
    case JSC::DerivedArrayType:
#if ENABLE(AOT)
    case JSC::CompiledObjectType:
#endif
        return true;
    default:
        return false;
    }
}

// Whether `object` is a plain object or array with no getter, so that a read of what it holds runs no user code.
static bool isPlainWithNoGetter(JSC::JSGlobalObject* globalObject, JSC::JSObject* object)
{
    JSC::JSType type = object->type();
#if ENABLE(AOT)
    // The structure of a compiled object does not say what it holds. The engine says that when it lists them.
    if (type == JSC::CompiledObjectType)
        return object->getPrototypeDirect() == globalObject->objectPrototype();
#endif
    if (type == JSC::ArrayType ? object->getPrototypeDirect() != globalObject->arrayPrototype() : type != JSC::FinalObjectType || object->getPrototypeDirect() != globalObject->objectPrototype())
        return false;
    return !object->structure()->hasAnyKindOfGetterSetterProperties();
}

// Calls `visit` with each value that such an object holds. False, before any call, if it cannot list them with no user code. `visit` must run no user code and must not change `object`.
template<typename Visit>
[[nodiscard]] static bool visitValuesOfPlain(JSC::JSGlobalObject* globalObject, JSC::JSObject* object, const Visit& visit)
{
    using namespace JSC;
    VM& vm = globalObject->vm();
#if ENABLE(AOT)
    if (object->type() == CompiledObjectType) {
        // A compiled object stands in the place of a plain one. The engine lists what it holds, and runs no code for that.
        MarkedArgumentBuffer values;
        bool hasAccessor = false;
        auto listed = AOT::PropertyWalk::forEachOwnProperty(vm, object, AOT::PropertyWalk::Filter::StringsAndSymbols, [&](const AOT::PropertyWalk::OwnProperty& own) -> IterationStatus {
            hasAccessor |= !!(own.attributes & (PropertyAttribute::Accessor | PropertyAttribute::CustomAccessorOrValue));
            values.append(own.value);
            return IterationStatus::Continue;
        });
        if (listed != AOT::PropertyWalk::Result::Completed || hasAccessor || values.hasOverflowed())
            return false;
        for (size_t index = 0; index < values.size(); index++)
            visit(values.at(index));
        return true;
    }
#endif
    // The engine keeps the items of a frozen array in place under --aot only. The scan reads none, so that it answers the same in both modes.
    if (object->hasFrozenElementsInPlace())
        return false;
    switch (object->indexingType()) {
    case ALL_BLANK_INDEXING_TYPES:
    case ALL_UNDECIDED_INDEXING_TYPES:
    case ALL_INT32_INDEXING_TYPES:
    case ALL_DOUBLE_INDEXING_TYPES:
        break;
    case ALL_CONTIGUOUS_INDEXING_TYPES: {
        Butterfly* butterfly = object->butterfly();
        for (unsigned index = 0, length = butterfly->publicLength(); index < length; index++)
            visit(butterfly->contiguous().at(object, index).get());
        break;
    }
    default:
        return false;
    }
    object->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
        visit(object->getDirect(entry.offset()));
        return true;
    });
    return true;
}

// Whether `value` can lead to a matcher. Runs no user code: it reads plain objects and arrays as they are, and says yes for any other kind of object, which sets `sawOne`. `scanned` gets the answer for each object that it read all of.
static bool leadsToMatcher(JSC::JSGlobalObject* globalObject, JSC::JSValue value, UncheckedKeyHashMap<JSC::JSObject*, bool>& scanned, bool& sawOne)
{
    // An array has an empty value where it has a hole.
    if (!value || !value.isObject())
        return false;
    JSC::JSObject* object = asObject(value);
    // The elements of a typed array are numbers.
    if (JSC::isTypedArrayType(object->type())) {
        scanned.add(object, false);
        return false;
    }
    if (!isPlainWithNoGetter(globalObject, object) || !globalObject->vm().isSafeToRecurse()) {
        sawOne = true;
        return true;
    }
    // An object that the scan is still inside of counts as one that leads to a matcher. So does each object of a pattern that leads around to it.
    auto added = scanned.add(object, true);
    if (!added.isNewEntry)
        return added.iterator->value;

    bool leads = false;
    bool listed = visitValuesOfPlain(globalObject, object, [&](JSC::JSValue held) {
        leads |= leadsToMatcher(globalObject, held, scanned, sawOne);
    });
    if (!listed) {
        scanned.remove(object);
        sawOne = true;
        return true;
    }
    scanned.set(object, leads);
    return leads;
}

bool scanPatternForMatchers(JSC::JSGlobalObject* globalObject, JSC::JSValue received, JSC::JSValue pattern, DeepMatchStateOfCollector& state)
{
    if (!received.isObject() || !diffAsksAtKeysOf(asObject(received)->type()))
        return false;
    // An object that leads around to itself counts as one that leads to a matcher. A pattern of such objects alone has none, and `sawOne` tells.
    bool sawOne = false;
    if (!leadsToMatcher(globalObject, pattern, state.patternLeadsToMatcher, sawOne) || !sawOne)
        return false;
    // A matcher that the walk asks can take an object out of the pattern. Kept alive, no other object gets the address of one that the scan read.
    for (JSC::JSObject* object : state.patternLeadsToMatcher.keys())
        state.gcBuffer.append(object);
    if (state.gcBuffer.hasOverflowed()) [[unlikely]]
        state.patternLeadsToMatcher.clear();
    return true;
}

// The walk for the diff asks these five kinds of matcher and no other. None of them compares with what another value holds, so an ask starts no function of expect.extend(), no asymmetricMatch() method and no equality tester. expect.any() of a class still runs its Symbol.hasInstance.
bool diffMayAsk(JSC::JSObject* matcher)
{
    using namespace Bun::Bindgen::Generated;
    // A matcher of expect.resolvesTo or expect.rejectsTo reads a promise: it can have to wait for it, and it marks it as handled.
    if (Expect__asymmetricMatcherReadsPromise(JSC::JSValue::encode(matcher)))
        return false;
    // A regular expression with a g or y flag keeps where it matched, so a question changes the next answer.
    if (auto* matching = dynamicDowncast<JSExpectStringMatching>(matcher)) {
        auto* pattern = dynamicDowncast<JSC::RegExpObject>(matching->m_pattern.get());
        return !pattern || !pattern->regExp()->globalOrSticky();
    }
    return matcher->inherits<JSExpectAny>() || matcher->inherits<JSExpectAnything>() || matcher->inherits<JSExpectStringContaining>() || matcher->inherits<JSExpectCloseTo>();
}

} // namespace Bun

namespace Bun {

// The second walk is for the message alone: whatever it throws, the match has failed. Out of line: its one caller is the entry of every toMatchObject().
NEVER_INLINE JSC::JSValue matchedRowsOfFailedMatch(JSC::JSGlobalObject* globalObject, DeepMatchState& comparison, JSC::JSValue received, JSC::JSValue pattern)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    DeepMatchStateOfCollector state;
    // Most patterns are plain objects and arrays with no matcher. The walk has none to ask then.
    if (comparison.recorded.hasOverflowed() || !scanPatternForMatchers(globalObject, received, pattern, state))
        RELEASE_AND_RETURN(scope, matchedRowsFrom(globalObject, comparison, received, pattern));

    state.records = true;
    state.comparison = &comparison;
    for (unsigned record = 0, count = comparison.recordedNames.size(); record < count; record++) {
        JSC::JSObject* patternOfHolder = asObject(comparison.recordedAt(record, DeepMatchState::PatternOfHolder));
        // The walk goes into no object of the pattern that leads to no matcher, so it looks up no record there.
        auto scanned = state.patternLeadsToMatcher.find(patternOfHolder);
        if (scanned != state.patternLeadsToMatcher.end() && !scanned->value)
            continue;
        state.recordOfComparison.set(DeepMatchStateOfCollector::RecordKey { comparison.recordedAt(record, DeepMatchState::Holder).asCell(), patternOfHolder, comparison.recordedNames[record].impl() }, record);
    }

    collectMatchersAfterMismatch(globalObject, scope, state, received, pattern);
    JSC::JSValue completed;
    if (!scope.exception() && state.stepsLeft) [[likely]]
        completed = matchedRowsFrom(globalObject, state, received, pattern);
    if (scope.exception() || !state.stepsLeft) [[unlikely]] {
        // The walk gave up (the stack ran out, the two roots threw, or getters made new objects with no end): the message gets the rows of the comparison. A termination stays.
        if (scope.exception() && !scope.tryClearException())
            return {};
        RELEASE_AND_RETURN(scope, matchedRowsFrom(globalObject, comparison, received, pattern));
    }
    return completed;
}

} // namespace Bun

// These answer for any `rows` and `place`: a value that is not a rows cell has no place.
extern "C" [[ZIG_EXPORT(nothrow)]] uint32_t Bun__JestMatchedRows__root(JSC::EncodedJSValue rows)
{
    return Bun::JestMatchedRows::from(rows) ? Bun::JestMatchedRows::rootPlace : 0;
}

// Rust declares the two that take pointers by hand, with references. cppbind would hand out raw pointers.
extern "C" JSC::EncodedJSValue Bun__JestMatchedRows__get(JSC::EncodedJSValue rows, uint32_t place, const BunString* name, uint32_t* childPlace)
{
    auto* cell = Bun::JestMatchedRows::from(rows);
    auto row = cell ? Bun::matchedRow(cell, place, Bun::toIdentifier(cell->vm(), *name)) : Bun::MatchedRow {};
    *childPlace = row.childPlace;
    return JSC::JSValue::encode(row.value);
}

extern "C" JSC::EncodedJSValue Bun__JestMatchedRows__getIndex(JSC::EncodedJSValue rows, uint32_t place, uint32_t index, uint32_t* childPlace)
{
    auto* cell = Bun::JestMatchedRows::from(rows);
    auto row = cell ? Bun::matchedRowAtIndex(cell, place, index) : Bun::MatchedRow {};
    *childPlace = row.childPlace;
    return JSC::JSValue::encode(row.value);
}

// What snapshot serializers get for the object of `place`: a plain stand-in with its rows in place, or the object itself. Undefined if there is no such place.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Bun__JestMatchedRows__forSerializers(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue rows, uint32_t place)
{
    auto* cell = Bun::JestMatchedRows::from(rows);
    if (!cell || !cell->placeAt(place))
        return JSC::JSValue::encode(JSC::jsUndefined());
    return JSC::JSValue::encode(cell->forSerializers(globalObject, place));
}
