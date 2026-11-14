#pragma once

#include "root.h"

#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSStringInlines.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/PropertySlot.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/StructureInlines.h>
#include <optional>
#include <span>
#include <wtf/ScopedLambda.h>
#include <wtf/Vector.h>

#if ENABLE(AOT)
#include <JavaScriptCore/AOTPropertyWalk.h>
#include <JavaScriptCore/AOTPropertyWalkInlines.h>
#endif

// The own properties of two objects in node's strict deep equality (util.isDeepStrictEqual, assert.deepStrictEqual).
//
// node's objEquiv lists the keys of both objects once and reads each value when it compares that pair. A comparison of two
// objects can run code of the program (a getter or a Proxy trap below them), so every later key sees what that code did to
// either object. What an object is made of (one Structure or two, an object of compiled code) must not change an answer: it
// only says where a value is found without a lookup, for as long as nothing has changed the object.
//
// One pair of objects is compared inside another, so what is rare here is kept out of line: the stack is what limits how
// deeply two values may be nested.
namespace Bun::NodeStrictOwnProperties {

// Whether two different objects, the first read from the first operand, are deeply equal. This can run code of the program.
using CompareObjects = WTF::ScopedLambda<bool(JSC::JSValue, JSC::JSValue)>;

// What is known of a pair of values without a call. A call can allocate, and two different objects are compared by code of the program.
enum class Pair : uint8_t {
    Equal,
    Unequal,
    Open,
};

ALWAYS_INLINE Pair pairWithoutCalls(JSC::JSGlobalObject* globalObject, JSC::JSValue left, JSC::JSValue right)
{
    // An empty value is for the walk that reads by name.
    if (left == right)
        return left ? Pair::Equal : Pair::Open;
    if (!left || !right)
        return Pair::Open;
    if (!left.isCell() || !right.isCell())
        return JSC::sameValue(globalObject, left, right) ? Pair::Equal : Pair::Unequal;
    if (left.isString() && right.isString()) {
        JSC::JSString* leftString = JSC::asString(left);
        JSC::JSString* rightString = JSC::asString(right);
        if (leftString->isRope() || rightString->isRope())
            return Pair::Open;
        return leftString->equal(globalObject, rightString) ? Pair::Equal : Pair::Unequal;
    }
    return Pair::Open;
}

NEVER_INLINE inline JSC::JSValue readFirstByName(JSC::JSGlobalObject* globalObject, JSC::JSObject* o1, WTF::UniquedStringImpl* name)
{
    return o1->get(globalObject, JSC::PropertyName(name));
}

// The value of the second object under a key of the first, read by name. Empty: the objects are not equal, or an exception is pending.
NEVER_INLINE inline JSC::JSValue readSecondByName(JSC::JSGlobalObject* globalObject, JSC::JSObject* o2, WTF::UniquedStringImpl* uid, bool haveSameKeys)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSC::PropertyName name(uid);
    // An own enumerable property of the second object answers for a key of the first.
    JSC::PropertySlot slot(o2, JSC::PropertySlot::InternalMethodType::GetOwnProperty);
    bool owns = o2->methodTable()->getOwnPropertySlot(o2, globalObject, name, slot);
    RETURN_IF_EXCEPTION(scope, {});
    if (owns && !(slot.attributes() & JSC::PropertyAttribute::DontEnum))
        RELEASE_AND_RETURN(scope, slot.getValue(globalObject, name));
    // Where both lists name the same keys in the same order, node compares a[key] with b[key] whatever has become of the key by then.
    if (haveSameKeys)
        RELEASE_AND_RETURN(scope, o2->get(globalObject, name));
    return {};
}

// The rest of a walk of two objects that listed the same keys, once a value is no longer where it was listed: every value by name.
NEVER_INLINE inline bool restEqualByName(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, std::span<WTF::UniquedStringImpl* const> names, const CompareObjects& compareObjects)
{
    for (WTF::UniquedStringImpl* name : names) {
        JSC::JSValue left = readFirstByName(globalObject, o1, name);
        RETURN_IF_EXCEPTION(scope, false);
        JSC::JSValue right = readSecondByName(globalObject, o2, name, true);
        RETURN_IF_EXCEPTION(scope, false);
        if (!left || !right)
            return false;
        if (left == right)
            continue;
        bool isEqual = left.isObject() && right.isObject() ? compareObjects(left, right) : JSC::sameValue(globalObject, left, right);
        RETURN_IF_EXCEPTION(scope, false);
        if (!isEqual)
            return false;
    }
    return true;
}

// Whether the offsets of a Structure say where the values of an ordinary object are for as long as it has that Structure.
// A Structure that objects share never changes, and the one of a dictionary only gains keys while it keeps its id.
ALWAYS_INLINE bool listsSlots(JSC::Structure* structure)
{
    return !structure->hasNonReifiedStaticProperties() && structure->canPerformFastPropertyEnumeration();
}

// node compares what is under the symbol keys behind what is under the string keys.
NEVER_INLINE inline void forEachSlotUnderASymbolKey(JSC::VM& vm, JSC::Structure* structure, const WTF::ScopedLambda<void(WTF::UniquedStringImpl*, JSC::PropertyOffset)>& functor)
{
    structure->forEachProperty(vm, [&](const auto& entry) -> bool {
        if (!(entry.attributes() & JSC::PropertyAttribute::DontEnum) && entry.key()->isSymbol() && !JSC::PropertyName(entry.key()).isPrivateName())
            functor(entry.key(), entry.offset());
        return true;
    });
}

NEVER_INLINE inline bool slotsRestEqualByName(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::Structure* structure, JSC::JSObject* o1, JSC::JSObject* o2, std::span<const JSC::PropertyOffset> offsets, const CompareObjects& compareObjects)
{
    // The Structure still names the key at each of its offsets.
    WTF::Vector<WTF::UniquedStringImpl*, 8> names(WTF::FillWith {}, offsets.size(), static_cast<WTF::UniquedStringImpl*>(nullptr));
    structure->forEachProperty(globalObject->vm(), [&](const auto& entry) -> bool {
        for (size_t i = 0; i < offsets.size(); i++) {
            if (offsets[i] == entry.offset())
                names[i] = entry.key();
        }
        return true;
    });
    bool areEqual = restEqualByName(globalObject, scope, o1, o2, names.span(), compareObjects);
    JSC::ensureStillAliveHere(structure);
    return areEqual;
}

// Two ordinary objects of one Structure: both hold the value of a key at the same offset.
template<typename Compare>
ALWAYS_INLINE bool slotsEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::Structure* structure, JSC::JSObject* o1, JSC::JSObject* o2, const Compare& compareObjects)
{
    JSC::VM& vm = globalObject->vm();
    // The offsets of the keys from the first pair on that needs a call.
    WTF::Vector<JSC::PropertyOffset, 8> rest;
    bool areUnequal = false;
    bool hasSymbolKey = false;
    // Nothing in this walk allocates in the heap of the program or runs its code, so nothing changes the table under it.
    structure->forEachProperty(vm, [&](const auto& entry) -> bool {
        if (entry.attributes() & JSC::PropertyAttribute::DontEnum)
            return true;
        if (entry.key()->isSymbol()) [[unlikely]] {
            hasSymbolKey |= !JSC::PropertyName(entry.key()).isPrivateName();
            return true;
        }
        if (rest.isEmpty()) [[likely]] {
            Pair pair = pairWithoutCalls(globalObject, o1->getDirect(entry.offset()), o2->getDirect(entry.offset()));
            if (pair == Pair::Equal)
                return true;
            if (pair == Pair::Unequal) {
                areUnequal = true;
                return false;
            }
        }
        rest.append(entry.offset());
        return true;
    });
    if (areUnequal)
        return false;
    if (hasSymbolKey) [[unlikely]] {
        forEachSlotUnderASymbolKey(vm, structure, [&](WTF::UniquedStringImpl*, JSC::PropertyOffset offset) {
            rest.append(offset);
        });
    }
    if (rest.isEmpty()) [[likely]]
        return true;

    JSC::StructureID id = structure->id();
    for (size_t i = 0; i < rest.size(); i++) {
        JSC::JSValue left = o1->getDirect(rest[i]);
        JSC::JSValue right = o2->getDirect(rest[i]);
        if (!left || !right) [[unlikely]]
            return slotsRestEqualByName(globalObject, scope, structure, o1, o2, rest.span().subspan(i), compareObjects);
        if (left == right)
            continue;
        if (!left.isObject() || !right.isObject()) {
            bool areSame = JSC::sameValue(globalObject, left, right);
            RETURN_IF_EXCEPTION(scope, false);
            if (!areSame)
                return false;
            continue;
        }
        bool isEqual = compareObjects(left, right);
        RETURN_IF_EXCEPTION(scope, false);
        if (!isEqual)
            return false;
        if (o1->structureID() != id || o2->structureID() != id) [[unlikely]]
            return slotsRestEqualByName(globalObject, scope, structure, o1, o2, rest.span().subspan(i + 1), compareObjects);
    }
    // The offsets and the id are this Structure's, and an object may leave it.
    JSC::ensureStillAliveHere(structure);
    return true;
}

#if ENABLE(AOT)
// The fields of an object of compiled code in the order of its keys, where every key of the object is such a field. The list
// lives as long as the program, and it is the list of the object for as long as the object answers with it: JSON.stringify
// reads such an object so.
ALWAYS_INLINE std::optional<std::span<const JSC::AOT::FieldAsProperty>> listedFields(JSC::JSObject* compiledObject)
{
    namespace PropertyWalk = JSC::AOT::PropertyWalk;
    // The list leaves out a field under a symbol key.
    if (PropertyWalk::hasExtraProperties(compiledObject) || uncheckedDowncast<JSC::AOT::Object>(compiledObject)->layout().hasFieldsWithSymbolKeys)
        return std::nullopt;
    return PropertyWalk::fieldsInKeyOrder(compiledObject);
}

ALWAYS_INLINE bool hasListedFields(JSC::JSObject* compiledObject, std::span<const JSC::AOT::FieldAsProperty> fields)
{
    auto now = JSC::AOT::PropertyWalk::fieldsInKeyOrder(compiledObject);
    return now && now->data() == fields.data();
}

NEVER_INLINE inline bool fieldsRestEqualByName(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, std::span<const JSC::AOT::FieldAsProperty> fields, const CompareObjects& compareObjects)
{
    WTF::Vector<WTF::UniquedStringImpl*, 8> names;
    for (auto& field : fields)
        names.append(field.name);
    return restEqualByName(globalObject, scope, o1, o2, names.span(), compareObjects);
}

// Two objects of compiled code with one list of fields.
template<typename Compare>
ALWAYS_INLINE bool fieldsEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, std::span<const JSC::AOT::FieldAsProperty> fields, JSC::JSObject* o1, JSC::JSObject* o2, const Compare& compareObjects)
{
    namespace PropertyWalk = JSC::AOT::PropertyWalk;
    for (size_t i = 0; i < fields.size(); i++) {
        JSC::JSValue left = PropertyWalk::readListedField(o1, fields[i]);
        JSC::JSValue right = PropertyWalk::readListedField(o2, fields[i]);
        if (!left || !right) [[unlikely]]
            return fieldsRestEqualByName(globalObject, scope, o1, o2, fields.subspan(i), compareObjects);
        if (left == right)
            continue;
        if (!left.isObject() || !right.isObject()) {
            bool areSame = JSC::sameValue(globalObject, left, right);
            RETURN_IF_EXCEPTION(scope, false);
            if (!areSame)
                return false;
            continue;
        }
        bool isEqual = compareObjects(left, right);
        RETURN_IF_EXCEPTION(scope, false);
        if (!isEqual)
            return false;
        if (!hasListedFields(o1, fields) || !hasListedFields(o2, fields)) [[unlikely]]
            return fieldsRestEqualByName(globalObject, scope, o1, o2, fields.subspan(i + 1), compareObjects);
    }
    return true;
}
#endif

struct Key {
    WTF::UniquedStringImpl* name;
    // The offset of the value in an ordinary object, or its index among `Lists::roots`.
    int32_t place;
};

// What both operands of the walk below list into.
struct Lists {
    WTF_FORBID_HEAP_ALLOCATION;
    WTF_MAKE_NONCOPYABLE(Lists);

public:
    explicit Lists(JSC::MarkedArgumentBuffer& roots)
        : roots(roots)
        , firstRoot(roots.size())
    {
    }

    ~Lists()
    {
        while (roots.size() > firstRoot)
            roots.removeLast();
    }

    WTF::Vector<Key, 8> keys;
    // The values that the listing of an object of compiled code read are kept here, as the pairs that are being compared are.
    JSC::MarkedArgumentBuffer& roots;
    size_t firstRoot;
#if ENABLE(AOT)
    WTF::Vector<RefPtr<WTF::UniquedStringImpl>> heldNames;
#endif
};

// One of two objects that are not made alike: its own enumerable keys, and where its values are while nothing has changed it.
class Operand {
    WTF_FORBID_HEAP_ALLOCATION;
    WTF_MAKE_NONCOPYABLE(Operand);

public:
    explicit Operand(JSC::JSObject* object)
        : m_object(object)
    {
    }

    ~Operand()
    {
        // The names and the offsets of an ordinary object's keys are this Structure's, and the object may have left it.
        JSC::ensureStillAliveHere(m_structure);
    }

    // Lists the own enumerable keys, string keys before symbol keys. Only an object that has to be asked for its keys runs code of the program here.
    NEVER_INLINE void list(JSC::JSGlobalObject* globalObject, Lists& lists, Operand* listedBefore)
    {
        JSC::VM& vm = globalObject->vm();
        if (listSlots(vm, lists, listedBefore))
            return;
#if ENABLE(AOT)
        if (JSC::AOT::PropertyWalk::isCompiledObject(m_object)) {
            if (auto fields = listedFields(m_object)) {
                m_fields = *fields;
                m_size = m_fields.size();
                m_places = Places::Fields;
                m_placesHold = true;
                return;
            }
            if (listValues(vm, lists))
                return;
        }
#endif
        listNames(globalObject, lists, listedBefore);
    }

    size_t size() const { return m_size; }

    WTF::UniquedStringImpl* name(const Lists& lists, size_t index) const
    {
        switch (m_places) {
        case Places::None:
            return m_names->propertyNameVector()[index].impl();
#if ENABLE(AOT)
        case Places::Fields:
            return m_fields[index].name;
        case Places::Values:
#endif
        case Places::Slots:
            break;
        }
        return lists.keys[m_firstKey + index].name;
    }

    // Whether both list the same keys in the same order. They list as many.
    bool hasTheKeysOf(const Lists& lists, const Operand& other) const
    {
        if (m_places == other.m_places) {
            if (m_places == Places::Slots && m_structure == other.m_structure)
                return true;
#if ENABLE(AOT)
            if (m_places == Places::Fields && m_fields.data() == other.m_fields.data())
                return true;
#endif
        }
        for (size_t i = 0; i < m_size; i++) {
            if (name(lists, i) != other.name(lists, i))
                return false;
        }
        return true;
    }

    // The value under the key at `index`. Empty: it has to be read by name.
    JSC::JSValue read(const Lists& lists, size_t index) const
    {
        if (!m_placesHold)
            return {};
        switch (m_places) {
        case Places::Slots:
            return m_object->getDirect(lists.keys[m_firstKey + index].place);
#if ENABLE(AOT)
        case Places::Fields:
            return JSC::AOT::PropertyWalk::readListedField(m_object, m_fields[index]);
        case Places::Values:
            return lists.roots.at(lists.keys[m_firstKey + index].place);
#endif
        case Places::None:
            break;
        }
        return {};
    }

    // The value under a key that the other operand lists at `expectedIndex`. Empty: it has to be read by name, unless `isAbsent` says that this object has no such key.
    JSC::JSValue read(JSC::VM& vm, const Lists& lists, WTF::UniquedStringImpl* name, size_t expectedIndex, bool& isAbsent) const
    {
        if (!m_placesHold)
            return {};
        if (m_places == Places::Slots) {
            unsigned attributes = 0;
            JSC::PropertyOffset offset = m_structure->get(vm, JSC::PropertyName(name), attributes);
            isAbsent = offset == JSC::invalidOffset || (attributes & JSC::PropertyAttribute::DontEnum);
            // A key that a dictionary gained since the listing can be an accessor: its slot holds no value, and the read by name calls the getter.
            if (isAbsent || (attributes & JSC::PropertyAttribute::AccessorOrCustomAccessorOrValue))
                return {};
            return m_object->getDirect(offset);
        }
        size_t found = expectedIndex < m_size && this->name(lists, expectedIndex) == name ? expectedIndex : notFound;
        for (size_t i = 0; found == notFound && i < m_size; i++) {
            if (this->name(lists, i) == name)
                found = i;
        }
        isAbsent = found == notFound;
        return isAbsent ? JSC::JSValue() : read(lists, found);
    }

    // Before anything that can run code of the program, for the operand whose names the walk reads: a name that the listing of an object of compiled code read may be the object's to free.
    void willRunCode(Lists& lists)
    {
#if ENABLE(AOT)
        if (m_places == Places::Values && lists.heldNames.isEmpty()) [[unlikely]]
            holdNames(lists);
#else
        UNUSED_PARAM(lists);
#endif
    }

    // After anything that can run code of the program: whether every value is still where it was listed.
    void didRunCode()
    {
        if (!m_placesHold)
            return;
        switch (m_places) {
        case Places::Slots:
            m_placesHold = m_object->structureID() == m_structure->id();
            return;
#if ENABLE(AOT)
        case Places::Fields:
            m_placesHold = hasListedFields(m_object, m_fields);
            return;
        case Places::Values:
            // Nothing says whether the object still holds a value that was listed.
            m_placesHold = false;
            return;
#endif
        case Places::None:
            return;
        }
    }

private:
    enum class Places : uint8_t {
        // Every value is read by name.
        None,
        // An ordinary object: the offsets that its Structure gives, for as long as it has that Structure.
        Slots,
#if ENABLE(AOT)
        // An object of compiled code whose keys are all fields: its list of fields, for as long as that is the object's list.
        Fields,
        // Any other object of compiled code: the values that the listing read, until code of the program runs.
        Values,
#endif
    };

    bool listSlots(JSC::VM& vm, Lists& lists, const Operand* listedBefore)
    {
        JSC::Structure* structure = m_object->structure();
        if (!listsSlots(structure))
            return false;
        m_structure = structure;
        m_places = Places::Slots;
        m_placesHold = true;
        if (listedBefore && listedBefore->m_structure == structure) {
            m_firstKey = listedBefore->m_firstKey;
            m_size = listedBefore->m_size;
            return true;
        }
        auto& keys = lists.keys;
        m_firstKey = keys.size();
        bool hasSymbolKey = false;
        // No code of the program runs inside this walk, so nothing changes the table under it.
        structure->forEachProperty(vm, [&](const auto& entry) -> bool {
            if (entry.attributes() & JSC::PropertyAttribute::DontEnum)
                return true;
            if (entry.key()->isSymbol()) [[unlikely]] {
                hasSymbolKey |= !JSC::PropertyName(entry.key()).isPrivateName();
                return true;
            }
            keys.append(Key { entry.key(), entry.offset() });
            return true;
        });
        if (hasSymbolKey) [[unlikely]] {
            forEachSlotUnderASymbolKey(vm, structure, [&](WTF::UniquedStringImpl* name, JSC::PropertyOffset offset) {
                keys.append(Key { name, offset });
            });
        }
        m_size = keys.size() - m_firstKey;
        return true;
    }

    void listNames(JSC::JSGlobalObject* globalObject, Lists& lists, Operand* listedBefore)
    {
        if (listedBefore)
            listedBefore->willRunCode(lists);
        JSC::PropertyNameArrayBuilder names(globalObject->vm(), JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
        m_object->methodTable()->getOwnPropertyNames(m_object, globalObject, names, JSC::DontEnumPropertiesMode::Exclude);
        m_size = names.size();
        m_names = names.releaseData();
        if (listedBefore)
            listedBefore->didRunCode();
    }

#if ENABLE(AOT)
    bool listValues(JSC::VM& vm, Lists& lists)
    {
        namespace PropertyWalk = JSC::AOT::PropertyWalk;
        auto& keys = lists.keys;
        auto& values = lists.roots;
        size_t firstKey = keys.size();
        size_t firstValue = values.size();
        WTF::Vector<Key, 2> symbolKeys;
        auto visit = [&](const PropertyWalk::OwnProperty& property) {
            if (property.attributes & JSC::PropertyAttribute::DontEnum)
                return IterationStatus::Continue;
            Key key { property.name, static_cast<int32_t>(values.size()) };
            if (!property.name->isSymbol()) [[likely]]
                keys.append(key);
            else if (!JSC::PropertyName(property.name).isPrivateName())
                symbolKeys.append(key);
            else
                return IterationStatus::Continue;
            values.appendWithCrashOnOverflow(property.value);
            return IterationStatus::Continue;
        };
        if (PropertyWalk::forEachOwnPropertyAsCreated(vm, m_object, visit) != PropertyWalk::Result::Completed) {
            keys.shrink(firstKey);
            while (values.size() > firstValue)
                values.removeLast();
            return false;
        }
        keys.appendVector(symbolKeys);
        m_firstKey = firstKey;
        m_size = keys.size() - firstKey;
        m_places = Places::Values;
        m_placesHold = true;
        return true;
    }

    NEVER_INLINE void holdNames(Lists& lists)
    {
        lists.heldNames.reserveInitialCapacity(m_size);
        for (size_t i = 0; i < m_size; i++)
            lists.heldNames.append(name(lists, i));
    }
#endif

    JSC::JSObject* m_object;
    JSC::Structure* m_structure { nullptr };
    RefPtr<JSC::PropertyNameArray> m_names;
#if ENABLE(AOT)
    std::span<const JSC::AOT::FieldAsProperty> m_fields;
#endif
    uint32_t m_firstKey { 0 };
    uint32_t m_size { 0 };
    Places m_places { Places::None };
    bool m_placesHold { false };
};

// Two objects that are not made alike, or that have to be asked for their keys.
NEVER_INLINE inline bool listedKeysEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, JSC::MarkedArgumentBuffer& roots, const CompareObjects& compareObjects)
{
    JSC::VM& vm = globalObject->vm();
    Lists lists(roots);
    Operand first(o1);
    Operand second(o2);
    first.list(globalObject, lists, nullptr);
    RETURN_IF_EXCEPTION(scope, false);
    second.list(globalObject, lists, &first);
    RETURN_IF_EXCEPTION(scope, false);

    size_t size = first.size();
    if (size != second.size())
        return false;
    bool haveSameKeys = first.hasTheKeysOf(lists, second);

    for (size_t i = 0; i < size; i++) {
        JSC::JSValue left = first.read(lists, i);
        if (!left) [[unlikely]] {
            first.willRunCode(lists);
            left = readFirstByName(globalObject, o1, first.name(lists, i));
            RETURN_IF_EXCEPTION(scope, false);
            if (!left)
                return false;
            first.didRunCode();
            second.didRunCode();
        }

        JSC::JSValue right;
        if (haveSameKeys) [[likely]]
            right = second.read(lists, i);
        else {
            bool isAbsent = false;
            right = second.read(vm, lists, first.name(lists, i), i, isAbsent);
            if (isAbsent)
                return false;
        }
        if (!right) [[unlikely]] {
            first.willRunCode(lists);
            right = readSecondByName(globalObject, o2, first.name(lists, i), haveSameKeys);
            RETURN_IF_EXCEPTION(scope, false);
            if (!right)
                return false;
            first.didRunCode();
            second.didRunCode();
        }

        if (left == right)
            continue;
        if (!left.isObject() || !right.isObject()) {
            bool areSame = JSC::sameValue(globalObject, left, right);
            RETURN_IF_EXCEPTION(scope, false);
            if (!areSame)
                return false;
            continue;
        }
        first.willRunCode(lists);
        bool isEqual = compareObjects(left, right);
        RETURN_IF_EXCEPTION(scope, false);
        if (!isEqual)
            return false;
        first.didRunCode();
        second.didRunCode();
    }
    return true;
}

// Whether the own enumerable properties of two objects are deeply equal. `roots` keeps values for as long as the comparison runs.
template<typename Compare>
ALWAYS_INLINE bool areEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, JSC::MarkedArgumentBuffer& roots, const Compare& compareObjects)
{
    JSC::Structure* structure = o1->structure();
    if (structure->id() == o2->structureID()) {
        if (listsSlots(structure)) [[likely]]
            return slotsEqual(globalObject, scope, structure, o1, o2, compareObjects);
#if ENABLE(AOT)
        if (JSC::AOT::PropertyWalk::isCompiledObject(o1) && JSC::AOT::PropertyWalk::haveSameFieldsInKeyOrder(o1, o2)) {
            if (auto fields = listedFields(o1))
                return fieldsEqual(globalObject, scope, *fields, o1, o2, compareObjects);
        }
#endif
    }
    return listedKeysEqual(globalObject, scope, o1, o2, roots, compareObjects);
}

} // namespace Bun::NodeStrictOwnProperties
