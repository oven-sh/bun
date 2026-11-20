#include "root.h"

#include "BunClientData.h"
#include "GeneratedExpect.h"
#include "JSDOMWrapper.h"
#include "ZigGlobalObject.h"
#include "headers-handwritten.h"
#include "headers.h"
#include <JavaScriptCore/AOTCompiledCallee.h>
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
#include <wtf/HashSet.h>

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

// expect.rs. Whether `value` is one of the five kinds of matcher that the walk below asks, with no promise to read.
extern "C" bool Expect__diffMayAskMatcher(JSC::EncodedJSValue value);

namespace Bun {

// The walk after a comparison that failed, for its message alone. It adds the matchers of the pattern that pass after the first mismatch to the records of the comparison.
struct DiffWalk {
    using RecordKey = std::tuple<JSC::JSCell*, JSC::JSCell*, UniquedStringImpl*>;
    // A getter can give a new object each time, with no end. The walk goes into this many objects that the received value does not hold as listed data of its own.
    static constexpr unsigned maxGivenObjects = 4096;
    // The printer shows what is below such an object only for its rows, so deeper than it did. The walk goes this many levels below one.
    static constexpr unsigned maxLevelsBelowGiven = 64;

    DeepMatchState& comparison;
    // The number of the record of the comparison for a holder, the pattern of that holder and a name. At such a key the walk takes what the comparison found, and reads neither value again.
    HashMap<RecordKey, unsigned> recordOfComparison;
    // The received objects and the objects of the pattern that the walk was in. It goes into two values only if one of them is new. So it goes into no more pairs than the two values have objects, also where they lead around to themselves at another pace.
    WTF::HashSet<JSC::JSCell*> receivedIn;
    WTF::HashSet<JSC::JSCell*> patternsIn;
    // What leadsToMatcher() found for an object of the pattern. `waitsAt` is set while the answer waits for an object that this one leads around to: its place in `waiting`, plus one.
    struct Looked {
        bool leads { false };
        unsigned waitsAt { 0 };
    };
    UncheckedKeyHashMap<JSC::JSObject*, Looked> patternLeadsToMatcher;
    // The objects that leadsToMatcher() is still inside of, and the ones that lead around to one of those.
    Vector<JSC::JSObject*, 16> waiting;
    unsigned givenObjectsLeft { maxGivenObjects };
    // Set where the walk is past a limit. It ends there, and the message gets the rows of the comparison alone.
    bool gaveUp { false };
    // For toEqual and the like, which on their fast path read only the keys that an object lists as its own: the walk gives a row at no other key of the received value.
    bool readsListedKeysOnly { false };
};

// The kinds of object whose keys the walk reads: a plain object, a class instance and an array. At most other kinds the printer shows no row, and a read can be a native getter that changes the object.
static bool diffWalkReadsKeysOf(JSC::JSType type)
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

// The walk asks five kinds of matcher and no other: expect.any(), expect.anything(), expect.stringContaining(), expect.stringMatching() and expect.closeTo(). None of them compares with what another value holds, so an ask starts no function of expect.extend(), no asymmetricMatch() method and no equality tester. expect.any() of a class still runs its Symbol.hasInstance.
bool diffMayAsk(JSC::JSObject* matcher)
{
    if (matcher->type() != JSC::JSType(WebCore::JSDOMWrapperType))
        return false;
    if (auto* matching = dynamicDowncast<Bun::Bindgen::Generated::JSExpectStringMatching>(matcher)) {
        auto* pattern = dynamicDowncast<JSC::RegExpObject>(matching->m_pattern.get());
        // With a g or y flag the expression keeps where it matched, so a question changes the next answer. A lastIndex that is no number is an object of the user, and a match reads it.
        if (pattern && (pattern->regExp()->globalOrSticky() || !pattern->getLastIndex().isNumber()))
            return false;
    } else if (auto* containing = dynamicDowncast<Bun::Bindgen::Generated::JSExpectStringContaining>(matcher)) {
        // A String object has a toString() of the user, and the matcher calls it.
        if (!containing->m_stringValue.get().isString())
            return false;
    }
    return Expect__diffMayAskMatcher(JSC::JSValue::encode(matcher));
}

// Whether the user wrote `getter`. A native function or a function of a built-in module can change its object in ways that the user does not see.
static bool isGetterOfTheUser(JSC::JSObject* getter)
{
#if ENABLE(AOT)
    if (JSC::AOT::CompiledCallee::isCompiledCallee(getter))
        return !JSC::AOT::belongsToBuiltinModule(getter);
#endif
    auto* function = dynamicDowncast<JSC::JSFunction>(getter);
    return function && !function->isHostOrBuiltinFunction();
}

// What a read of a property finds: a value, or a getter that the user wrote.
struct FoundForDiff {
    JSC::JSValue value;
    JSC::JSObject* getter { nullptr };
    // Whether the object has the property as its own, at a key that it lists.
    bool isListed { false };
    explicit operator bool() const { return value || getter; }
    // Whether it is data that the object lists as its own. The printer shows such a value also where it has no row.
    bool isHeld() const { return isListed && !getter; }
};

// What `slot` found. Nothing where a read would run code that the user did not write: a native getter, or a getter of a built-in module.
static FoundForDiff foundInSlot(JSC::JSGlobalObject* globalObject, JSC::PropertyName name, const JSC::PropertySlot& slot, bool isOwn)
{
    bool isListed = isOwn && !(slot.attributes() & JSC::PropertyAttribute::DontEnum);
    if (slot.isValue())
        return { slot.getValue(globalObject, name), nullptr, isListed };
    if (!slot.isAccessor())
        return {};
    JSC::JSObject* getter = slot.getterSetter()->getter();
    return { {}, getter && isGetterOfTheUser(getter) ? getter : nullptr, isListed };
}

// Looks `name` up in `object` and, unless `ownOnly`, up its prototypes, as a read does. A VMInquiry slot forbids entering the VM while it is alive. It looks only at a plain object, a class instance and an array: at an object of another kind, such as `process`, a look-up can make the engine build the property. Nothing if it finds no property.
static FoundForDiff lookUpForDiff(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* object, JSC::PropertyName name, bool ownOnly = false)
{
    JSC::VM& vm = globalObject->vm();
    for (JSC::JSObject* holder = object; diffWalkReadsKeysOf(holder->type());) {
        JSC::PropertySlot slot(object, JSC::PropertySlot::InternalMethodType::VMInquiry, &vm);
        bool has = holder->methodTable()->getOwnPropertySlot(holder, globalObject, name, slot);
        RETURN_IF_EXCEPTION(scope, {});
        if (has)
            return foundInSlot(globalObject, name, slot, holder == object);
        JSC::JSValue prototype = holder->getPrototypeDirect();
        if (ownOnly || !prototype.isObject())
            break;
        holder = asObject(prototype);
    }
    return {};
}

// The value that `found` stands for. Calls the getter, if it is one.
static JSC::JSValue valueForDiff(JSC::JSGlobalObject* globalObject, JSC::JSObject* object, const FoundForDiff& found)
{
    return found.getter ? JSC::call(globalObject, found.getter, JSC::getCallData(found.getter), object, JSC::ArgList()) : found.value;
}

// The own keys that a for-in loop over `object` lists, and its symbols. Runs no user code for the kinds of object that the walk reads.
static void listOwnKeysForDiff(JSC::JSGlobalObject* globalObject, JSC::JSObject* object, JSC::PropertyNameArrayBuilder& names)
{
    object->methodTable()->getOwnPropertyNames(object, globalObject, names, JSC::DontEnumPropertiesMode::Exclude);
}

// Appends each value that `object` holds as data of its own, at a key that it lists. It can append other things that are no object. Runs no user code.
static void appendHeldValues(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* object, Vector<JSC::JSValue, 16>& held)
{
    using namespace JSC;
    VM& vm = globalObject->vm();
    // Most objects and arrays have their values in a row, and a read of that row needs no list of the keys. A compiled object does not.
    bool inARow = object->type() == FinalObjectType || object->type() == ArrayType || object->type() == DerivedArrayType;
    if (inARow) {
        switch (object->indexingType()) {
        case ALL_BLANK_INDEXING_TYPES:
        case ALL_UNDECIDED_INDEXING_TYPES:
        case ALL_INT32_INDEXING_TYPES:
        case ALL_DOUBLE_INDEXING_TYPES:
            break;
        case ALL_CONTIGUOUS_INDEXING_TYPES: {
            Butterfly* butterfly = object->butterfly();
            for (unsigned index = 0, length = butterfly->publicLength(); index < length; index++)
                held.append(butterfly->contiguous().at(object, index).get());
            break;
        }
        default:
            inARow = false;
        }
    }
    if (inARow) {
        object->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
            bool isPrivateName = entry.key()->isSymbol() && static_cast<SymbolImpl*>(entry.key())->isPrivate();
            if (!isPrivateName && !(entry.attributes() & PropertyAttribute::DontEnum))
                held.append(object->getDirect(entry.offset()));
            return true;
        });
        return;
    }
    PropertyNameArrayBuilder names(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    listOwnKeysForDiff(globalObject, object, names);
    RETURN_IF_EXCEPTION(scope, );
    for (const auto& name : names) {
        FoundForDiff found = lookUpForDiff(globalObject, scope, object, name);
        RETURN_IF_EXCEPTION(scope, );
        held.append(found.value);
    }
}

// Whether the walk comes to a matcher that it asks through `value` of the pattern. Runs no user code: it reads the data that plain objects, class instances and arrays hold, and calls no getter. `lowestOfHolder` is for the call from inside: the lowest place in `waiting` that the holder of `value` leads around to.
static bool leadsToMatcher(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, DiffWalk& walk, JSC::JSValue value, unsigned* lowestOfHolder = nullptr)
{
    using namespace JSC;
    // An array has an empty value where it has a hole, and so has a key with a getter here.
    if (!value || !value.isObject())
        return false;
    // The engine checks that nothing below enters JavaScript.
    DisallowVMEntry noUserCode(globalObject->vm());
    JSObject* object = asObject(value);
    if (diffMayAsk(object))
        return true;
    if (!diffWalkReadsKeysOf(object->type()) || !globalObject->vm().isSafeToRecurse())
        return false;
    unsigned place = walk.waiting.size() + 1;
    auto added = walk.patternLeadsToMatcher.add(object, DiffWalk::Looked { false, place });
    if (!added.isNewEntry) {
        // An object that this is still inside of has no answer yet, nor has one that leads around to it. The holder waits with it.
        if (added.iterator->value.waitsAt && lowestOfHolder)
            *lowestOfHolder = std::min(*lowestOfHolder, added.iterator->value.waitsAt);
        return added.iterator->value.leads;
    }
    walk.waiting.append(object);
    // What the walk runs can take an object out of the pattern. Kept alive, no other object gets the address of one that has an answer.
    walk.comparison.gcBuffer.append(object);

    Vector<JSValue, 16> held;
    appendHeldValues(globalObject, scope, object, held);
    RETURN_IF_EXCEPTION(scope, false);
    bool leads = false;
    unsigned lowest = place;
    for (JSValue heldValue : held) {
        bool heldLeads = leadsToMatcher(globalObject, scope, walk, heldValue, &lowest);
        RETURN_IF_EXCEPTION(scope, false);
        leads |= heldLeads;
    }
    if (lowest < place) {
        // It leads around to an object that this is still inside of, and gets the answer of that one.
        walk.patternLeadsToMatcher.find(object)->value.leads = leads;
        if (lowestOfHolder)
            *lowestOfHolder = std::min(*lowestOfHolder, lowest);
        return leads;
    }
    // Each object that waits from here on leads around to this one, so it leads to what this one leads to.
    for (unsigned index = place - 1; index < walk.waiting.size(); index++)
        walk.patternLeadsToMatcher.set(walk.waiting[index], DiffWalk::Looked { leads, 0 });
    walk.waiting.shrink(place - 1);
    return leads;
}

static void collectMatchersIn(JSC::JSGlobalObject*, JSC::ThrowScope&, DiffWalk&, JSC::JSObject*, JSC::JSObject*, unsigned levelsBelowGiven);

// What the walk does at a key of the pattern.
static void collectMatchersAtKey(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, DiffWalk& walk, JSC::JSObject* obj, JSC::JSObject* subsetObj, const JSC::Identifier& property, unsigned levelsBelowGiven)
{
    using namespace JSC;
    DeepMatchState& comparison = walk.comparison;
    JSValue prop;
    JSValue subsetProp;
    FoundForDiff found;
    auto recorded = walk.recordOfComparison.find(DiffWalk::RecordKey { obj, subsetObj, property.impl() });
    bool wasRecorded = recorded != walk.recordOfComparison.end();
    if (wasRecorded) {
        prop = comparison.recordedAt(recorded->value, DeepMatchState::Value);
        subsetProp = comparison.recordedAt(recorded->value, DeepMatchState::PatternOfValue);
        // A matcher that passed has no pattern beside it. A matcher that said no is beside itself, and the walk does not ask it again.
        if (!subsetProp.isObject() || prop == subsetProp)
            return;
    } else {
        // The comparison left no record here: it did not come to this key, or it stopped at it with a value that is no object. The walk has to read it.
        subsetProp = lookUpForDiff(globalObject, scope, subsetObj, property).value;
        RETURN_IF_EXCEPTION(scope, );
        if (!subsetProp || !subsetProp.isObject())
            return;
        found = lookUpForDiff(globalObject, scope, obj, property, walk.readsListedKeysOnly);
        RETURN_IF_EXCEPTION(scope, );
        if (!found || (walk.readsListedKeysOnly && !found.isListed))
            return;
        // Before the read: a getter runs only for a matcher that the walk asks.
        if (diffMayAsk(asObject(subsetProp))) {
            prop = valueForDiff(globalObject, obj, found);
            RETURN_IF_EXCEPTION(scope, );
            auto passed = askMatcherOfDiff(globalObject, scope, asObject(subsetProp), prop);
            RETURN_IF_EXCEPTION(scope, );
            if (passed && *passed)
                comparison.recordIfAsked(obj, subsetObj, property, subsetProp, jsUndefined());
            return;
        }
    }
    // And for an object of the pattern that leads to such a matcher.
    bool leads = leadsToMatcher(globalObject, scope, walk, subsetProp);
    RETURN_IF_EXCEPTION(scope, );
    if (!leads)
        return;
    unsigned levels = levelsBelowGiven ? levelsBelowGiven + 1 : 0;
    if (!wasRecorded) {
        prop = valueForDiff(globalObject, obj, found);
        RETURN_IF_EXCEPTION(scope, );
        // The comparison looks inside two values key by key. It does not where they are one object, nor where an asymmetricMatch() method answers for them.
        if (!prop.isObject() || prop == subsetProp || oneAnswersByAsymmetricMatch(globalObject, prop, subsetProp))
            return;
        if (!found.isHeld()) {
            levels = levelsBelowGiven + 1;
            if (!walk.givenObjectsLeft) {
                walk.gaveUp = true;
                return;
            }
            walk.givenObjectsLeft--;
        }
        comparison.gcBuffer.append(prop);
        comparison.gcBuffer.append(subsetProp);
        comparison.recordIfAsked(obj, subsetObj, property, prop, subsetProp);
    }
    if (levels > DiffWalk::maxLevelsBelowGiven) {
        walk.gaveUp = true;
        return;
    }
    bool receivedIsNew = walk.receivedIn.add(prop.asCell()).isNewEntry;
    bool patternIsNew = walk.patternsIn.add(subsetProp.asCell()).isNewEntry;
    if (!receivedIsNew && !patternIsNew)
        return;
    collectMatchersIn(globalObject, scope, walk, asObject(prop), asObject(subsetProp), levels);
}

// The walk over a received object and its pattern. It goes on where the comparison returns false. It needs no check of the stack: leadsToMatcher() has one, and says no where the stack ends.
static void collectMatchersIn(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, DiffWalk& walk, JSC::JSObject* obj, JSC::JSObject* subsetObj, unsigned levelsBelowGiven)
{
    using namespace JSC;
    VM& vm = globalObject->vm();
    // The printer shows a row of an array only at an index.
    bool holderIsArray = obj->type() == ArrayType || obj->type() == DerivedArrayType;
    // toEqual and the like refuse an array beside what is no array before they read a key.
    if (walk.readsListedKeysOnly && holderIsArray != (subsetObj->type() == ArrayType || subsetObj->type() == DerivedArrayType))
        return;
    // The comparison leaves two DOM nodes to isEqualNode(), and does not look inside them. The walk takes two values that both have one for such nodes, and does not call it.
    const Identifier& isEqualNode = WebCore::builtinNames(vm).isEqualNodePublicName();
    FoundForDiff ofObj = lookUpForDiff(globalObject, scope, obj, isEqualNode);
    RETURN_IF_EXCEPTION(scope, );
    if (ofObj) {
        FoundForDiff ofPattern = lookUpForDiff(globalObject, scope, subsetObj, isEqualNode);
        RETURN_IF_EXCEPTION(scope, );
        if (ofPattern)
            return;
    }

    PropertyNameArrayBuilder names(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    {
        DisallowVMEntry noUserCode(vm);
        listOwnKeysForDiff(globalObject, subsetObj, names);
        RETURN_IF_EXCEPTION(scope, );
    }
    for (const auto& property : names) {
        if (holderIsArray && !parseIndex(property))
            continue;
        collectMatchersAtKey(globalObject, scope, walk, obj, subsetObj, property, levelsBelowGiven);
        // What a getter or Symbol.hasInstance throws costs this key its row, and no more. A termination ends the walk.
        if ((scope.exception() && !scope.tryClearException()) || walk.gaveUp) [[unlikely]]
            return;
    }
}

// Out of line: one caller is the entry of every toMatchObject().
NEVER_INLINE JSC::JSValue matchedRowsOfFailedMatch(JSC::JSGlobalObject* globalObject, DeepMatchState& comparison, JSC::JSValue received, JSC::JSValue pattern, bool readsListedKeysOnly)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (!comparison.recorded.hasOverflowed()) {
        DiffWalk walk { comparison };
        walk.readsListedKeysOnly = readsListedKeysOnly;
        unsigned recordsOfComparison = comparison.recordedNames.size();
        bool leads = leadsToMatcher(globalObject, scope, walk, pattern);
        // Most patterns have no matcher that the walk asks, and then it reads nothing of the received value.
        if (!scope.exception() && leads) {
            for (unsigned record = 0; record < recordsOfComparison; record++) {
                JSC::JSObject* patternOfHolder = asObject(comparison.recordedAt(record, DeepMatchState::PatternOfHolder));
                // The walk goes into no object of the pattern that leads to no matcher, so it looks up no record there. Most records of a long list are of those.
                auto looked = walk.patternLeadsToMatcher.find(patternOfHolder);
                if (looked == walk.patternLeadsToMatcher.end() || looked->value.leads)
                    walk.recordOfComparison.set(DiffWalk::RecordKey { comparison.recordedAt(record, DeepMatchState::Holder).asCell(), patternOfHolder, comparison.recordedNames[record].impl() }, record);
            }
            walk.receivedIn.add(received.asCell());
            walk.patternsIn.add(pattern.asCell());
            collectMatchersIn(globalObject, scope, walk, asObject(received), asObject(pattern), 0);
        }
        // Whatever the walk throws, the match has failed, and the message is the one of the assertion. A termination stays.
        if (scope.exception() && !scope.tryClearException()) [[unlikely]]
            return {};
        if (walk.gaveUp)
            comparison.recordedNames.shrink(recordsOfComparison);
    }
    RELEASE_AND_RETURN(scope, matchedRowsFrom(globalObject, comparison, received, pattern));
}

} // namespace Bun

// The rows for the diff of two values that a comparison with no records found unequal (toEqual, toStrictEqual, toHaveProperty, toHaveBeenCalledWith): the matchers in `expected` that pass. Empty if there is none. Asks those, so it enters JavaScript and can throw.
extern "C" void Bun__JestMatchedRows__ofFailedEquals(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedReceived, JSC::EncodedJSValue encodedExpected, JSC::EncodedJSValue* rows)
{
    JSC::JSValue received = JSC::JSValue::decode(encodedReceived);
    JSC::JSValue expected = JSC::JSValue::decode(encodedExpected);
    // The walk is over two objects that the comparison looks inside, key by key.
    if (!received.isObject() || !expected.isObject() || Bun::oneAnswersByAsymmetricMatch(globalObject, received, expected))
        return;
    Bun::DeepMatchState noRecords;
    noRecords.records = true;
    *rows = JSC::JSValue::encode(Bun::matchedRowsOfFailedMatch(globalObject, noRecords, received, expected, true));
}

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
