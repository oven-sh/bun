#include "root.h"
#include "Bindgen/SharedBodies.h"
#include "Bindgen/DictionaryMemberReader.h"
#include "GeneratedBindings+Interfaces.h"
#include "GeneratedBindings+Tables.h"
#include <JavaScriptCore/ArrayConstructor.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/text/StringBuilder.h>

namespace Bun::Bindgen {
using namespace JSC;

String sharedName(const char* name)
{
    if (auto distance = static_cast<uint8_t>(*name))
        return ASCIILiteral::fromLiteralUnsafe(name + distance);
    auto& computed = *std::bit_cast<const ComputedName*>(name);
    return computed.compute(computed);
}

ElementName::ElementName(const char* container)
    : ComputedName { .compute = [](const ComputedName& name) { return makeString("element of "_s, sharedName(static_cast<const ElementName&>(name).container)); } }
    , container(container)
{
}

struct DictionaryMemberName : ComputedName {
    explicit DictionaryMemberName(const DictionaryDescription& dictionary)
        : ComputedName { .compute = [](const ComputedName& name) { return static_cast<const DictionaryMemberName&>(name).toString(); } }
        , dictionary(dictionary)
    {
    }

    String toString() const
    {
        ASCIILiteral member = Tables::memberNames[dictionary.firstMemberNameIndex + index];
        return dictionary.qualifiesMemberNames ? makeString(sharedName(dictionary.name), '.', member) : member;
    }

    const DictionaryDescription& dictionary;
    unsigned index { 0 };
};

String describeRange(int64_t min, uint64_t max, const String& received)
{
    auto range = makeString("must be in the range ["_s, min, ", "_s, max, ']');
    return received.isNull() ? range : makeString(range, " (received "_s, received, ')');
}

void forEachInArray(JSGlobalObject& globalObject, JSObject* array, const ScopedLambda<void(JSValue)>& callback)
{
    JSC::forEachInIterable(&globalObject, array, [&](VM&, JSGlobalObject*, JSValue next) { callback(next); });
}

void throwSharedError(JSGlobalObject& globalObject, ThrowScope& scope, const char* name, StringView verb, StringView predicate, std::optional<ErrorCode> code)
{
    auto message = makeString(name ? sharedName(name) : String(), verb, predicate);
    if (code)
        Bun::throwError(&globalObject, scope, *code, message);
    else
        throwTypeError(&globalObject, scope, message);
}

static constexpr unsigned numberIn(Brand brand) { return brand & ((1u << bitsOfInterfaceNumber) - 1); }

static ALWAYS_INLINE JSCell* asInstance(JSValue value, Brand brand)
{
    if (!value.isCell())
        return nullptr;
    JSCell* cell = value.asCell();
    const ClassInfo* info;
    if (cell->type() == JSInterfaceObject<0>::cellType)
        info = static_cast<JSInterfaceObject<0>*>(cell)->interfaceInfo();
    else if (cell->type() == JSInterfaceObject<2>::cellType)
        info = static_cast<JSInterfaceObject<2>*>(cell)->interfaceInfo();
    else
        return nullptr;
    size_t number = std::bit_cast<const InterfaceInfo*>(info) - Generated::InterfaceInfos::all;
    return number - numberIn(brand) < (brand & maskOfBrand) >> bitsOfInterfaceNumber ? cell : nullptr;
}

JSCell* instanceOrNull(JSValue value, Brand brand)
{
    return asInstance(value, brand);
}

String describeInstanceOf(Brand brand)
{
    return describeInstanceOf(Generated::InterfaceInfos::all[numberIn(brand)].info.className);
}

static NEVER_INLINE JSCell* whatStandsBehind(JSGlobalObject* globalObject, JSValue value, Brand brand)
{
    switch (static_cast<Receiver>(brand >> bitsOfBrand & ((1u << bitsOfReceiver) - 1))) {
    case Receiver::Instance:
        return nullptr;
    case Receiver::InstanceOrGlobal:
        return instanceOrNull(receiverOfGlobal(globalObject, value), brand);
    case Receiver::BehindInstance:
        return instanceOrNull(behindInstance(globalObject, value), brand);
    }
    RELEASE_ASSERT_NOT_REACHED();
}

static ALWAYS_INLINE JSCell* asReceiver(JSGlobalObject* globalObject, JSValue value, Brand brand)
{
    constexpr Brand isBehind = static_cast<Brand>(Receiver::BehindInstance) << bitsOfBrand;
    if (auto* cell = asInstance(value, brand); cell && !(brand & isBehind)) [[likely]]
        return cell;
    return whatStandsBehind(globalObject, value, brand);
}

JSCell* receiverOrNull(JSGlobalObject* globalObject, EncodedJSValue thisValue, Brand brand)
{
    return asReceiver(globalObject, JSValue::decode(thisValue), brand);
}

JSCell* receiverOfAccessor(JSGlobalObject* globalObject, EncodedJSValue thisValue, Brand brand)
{
    auto* cell = asReceiver(globalObject, JSValue::decode(thisValue), brand);
    if (!cell) [[unlikely]]
        throwIllegalInvocation(globalObject);
    return cell;
}

JSCell* receiverOfCall(JSGlobalObject* globalObject, CallFrame* callFrame, Brand brand)
{
    auto* cell = asReceiver(globalObject, callFrame->thisValue(), brand);
    if (!cell) [[unlikely]] {
        throwIllegalInvocation(globalObject);
        return nullptr;
    }
    unsigned required = brand >> (bitsOfBrand + bitsOfReceiver);
    if (callFrame->argumentCount() < required) [[unlikely]] {
        throwTooFewArguments(globalObject, callFrame, required);
        return nullptr;
    }
    return cell;
}

EncodedJSValue SYSV_ABI getCachedAttribute(JSGlobalObject* globalObject, JSCell* thisObject, EncodedJSValue(SYSV_ABI* get)(JSGlobalObject*, JSCell*), unsigned offsetOfField)
{
    auto& field = *std::bit_cast<WriteBarrier<Unknown>*>(std::bit_cast<char*>(thisObject) + offsetOfField);
    if (JSValue cached = field.get())
        return JSValue::encode(cached);
    JSValue result = JSValue::decode(get(globalObject, thisObject));
    if (result)
        field.set(getVM(globalObject), thisObject, result);
    return JSValue::encode(result);
}

// Until `callback` returns true. It is told whether this is the last one.
static ALWAYS_INLINE std::optional<AnyEnumeration> findAmongSpellings(uint32_t spellings, auto&& callback)
{
    const char* start = Tables::enumerationSpellings + spellings;
    for (uint32_t index = 0;; ++index) {
        const char* end = start;
        while (*end > 1)
            ++end;
        if (callback(index, byteCast<Latin1Character>(std::span { start, end }), !*end))
            return AnyEnumeration { index };
        if (!*end)
            return std::nullopt;
        start = end + 1;
    }
}

std::optional<AnyEnumeration> findSpelling(const String& string, uint32_t spellings)
{
    StringView view = string;
    return findAmongSpellings(spellings, [&](uint32_t, auto spelling, bool) { return spelling.size() == view.length() && view == StringView(spelling); });
}

std::optional<AnyEnumeration> findSpelling(JSGlobalObject& globalObject, JSValue value, uint32_t spellings)
{
    return findSpelling(value.toWTFString(&globalObject), spellings);
}

String describeSpellings(uint32_t spellings)
{
    StringBuilder result;
    findAmongSpellings(spellings, [&](uint32_t index, auto spelling, bool isLast) {
        if (index)
            result.append(!isLast ? ", "_s : index == 1 ? " or "_s
                                                        : ", or "_s);
        result.append('"', spelling, '"');
        return false;
    });
    return result.toString();
}

template<typename Ctx>
static bool convertMembersWith(JSGlobalObject& lexicalGlobalObject, JSValue value, void* result, const DictionaryDescription& description, bool isZeroed)
{
    auto* members = static_cast<const DictionaryMember<Ctx>*>(description.members);
    using Empty = DictionaryDescription::Empty;
    auto* globalObject = &lexicalGlobalObject;
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* object = value.getObject();
    if (object && description.takesAsEmpty == Empty::PrimitivesAndFunctions && object->isCallable())
        object = nullptr;
    bool isRefused;
    if (!object)
        isRefused = description.takesAsEmpty == Empty::Nothing || (description.takesAsEmpty == Empty::UndefinedAndNull && !value.isUndefinedOrNull());
    else {
        isRefused = !description.allowsArray && isArray(globalObject, value);
        RETURN_IF_EXCEPTION(scope, false);
    }
    if (isRefused) [[unlikely]] {
        Ctx { description.name }.throwNotObject(*globalObject, scope);
        return false;
    }
    auto lookup = description.readsObjectPrototype ? DictionaryMemberReader::ReadsObjectPrototype : DictionaryMemberReader::StopsAtObjectPrototype;
    DictionaryMemberReader reader(vm, globalObject, object, description.firstMemberNameIndex, description.memberCount, lookup);
    DictionaryMemberName name { description };
    Ctx ctx { &name.zero };
    for (; name.index < description.memberCount; ++name.index) {
        auto& member = members[name.index];
        JSValue memberValue = jsUndefined();
        if (object) {
            memberValue = reader.get(name.index);
            if (hasException(scope, !!memberValue)) [[unlikely]]
                return false;
        }
        if (memberValue.isUndefined()) {
            if (member.absent == Absent::Zero && isZeroed)
                continue;
            if (member.absent == Absent::Refused) [[unlikely]] {
                ctx.throwRequired(*globalObject, scope);
                return false;
            }
        }
        void* slot = static_cast<char*>(result) + member.offset;
        if (hasException(scope, member.hasDatum ? member.convertWith(globalObject, memberValue, ctx, slot, member.datum) : member.convert(globalObject, memberValue, ctx, slot))) [[unlikely]]
            return false;
    }
    return true;
}

bool convertMembers(JSGlobalObject& globalObject, JSValue value, void* result, const DictionaryDescription& description, bool isZeroed)
{
    return description.isWeb ? convertMembersWith<SharedWebContext>(globalObject, value, result, description, isZeroed) : convertMembersWith<SharedLiteralContext>(globalObject, value, result, description, isZeroed);
}

bool convertAnyDictionary(JSGlobalObject& globalObject, JSValue value, AnyDictionary& result, const DictionaryDescription& description)
{
    zeroSpan(std::span { result.bytes }.first(description.size));
    return convertMembers(globalObject, value, &result, description, true);
}

}
