#include "root.h"
#include "Bindgen/IDLConvert.h"
#include "DOMException.h"
#include "JSDOMExceptionHandling.h"
#include "Bindgen/ExternTraits.h"
#include "Bindgen/SchemaStrings.h"
#include "BunClientData.h"
#include "JSAbortSignal.h"
#include "JSBuffer.h"
#include "JSDOMURL.h"
#include "JSFetchHeaders.h"
#include "ZigGlobalObject.h"
#include "helpers.h"
#include "streams/JSReadableStream.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ImmutablePropertyNames.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/NativeExecutable.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun::Bindgen {
using namespace JSC;

EncodedJSValue createFunction(JSGlobalObject* globalObject, unsigned length, ASCIILiteral name, NativeFunction function)
{
    return JSValue::encode(JSFunction::create(getVM(globalObject), globalObject, length, name, function, ImplementationVisibility::Public));
}

EncodedJSValue createFunctionNamedAsBound(JSGlobalObject* globalObject, unsigned length, ASCIILiteral name, NativeFunction function)
{
    JSFunction* result = JSFunction::create(getVM(globalObject), globalObject, length, name, function, ImplementationVisibility::Public);
    uncheckedDowncast<NativeExecutable>(result->executable())->setIsNamedAsBound();
    return JSValue::encode(result);
}

class BoundFunctionReplacement final : public JSFunction {
public:
    using Base = JSFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags & ~ImplementsDefaultHasInstance;
    static_assert(StructureFlags & ImplementsHasInstance);

    DECLARE_INFO;

    static BoundFunctionReplacement* create(VM& vm, JSGlobalObject* globalObject, Structure* structure, NativeExecutable* executable)
    {
        auto* function = new (NotNull, allocateCell<BoundFunctionReplacement>(vm)) BoundFunctionReplacement(vm, executable, globalObject, structure);
        function->finishCreation(vm);
        return function;
    }

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject)
    {
        Structure* structure = Bun::createClassStructure(vm, globalObject, globalObject->functionPrototype(), TypeInfo(JSFunctionType, StructureFlags), info());
        ImmutablePropertyNames* names = globalObject->hostFunctionStructure()->listedImmutablePropertyNames();
        return names ? Structure::makeListedPropertiesImmutableTransition(vm, structure, *names) : structure;
    }

    static bool customHasInstance(JSObject*, JSGlobalObject* globalObject, JSValue value)
    {
        return defaultHasInstance(globalObject, value, jsUndefined());
    }

private:
    BoundFunctionReplacement(VM& vm, NativeExecutable* executable, JSGlobalObject* globalObject, Structure* structure)
        : Base(vm, executable, globalObject, structure)
    {
    }
};
static_assert(sizeof(BoundFunctionReplacement) == sizeof(JSFunction), "Allocated in JSFunction IsoSubspace");

const ClassInfo BoundFunctionReplacement::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(BoundFunctionReplacement) };

EncodedJSValue createBoundFunctionReplacement(JSGlobalObject* globalObject, unsigned length, ASCIILiteral name, NativeFunction function)
{
    VM& vm = getVM(globalObject);
    auto& cached = uncheckedDowncast<Zig::GlobalObject>(globalObject)->m_bindgenAdditions.m_boundFunctionReplacementStructure;
    if (!cached)
        cached.set(vm, globalObject, BoundFunctionReplacement::createStructure(vm, globalObject));
    NativeExecutable* executable = vm.getHostFunction(function, ImplementationVisibility::Public, NoIntrinsic, callHostFunctionAsConstructor, nullptr, length, name);
    return JSValue::encode(BoundFunctionReplacement::create(vm, globalObject, cached.get(), executable));
}

static NEVER_INLINE Structure* createReturnedDictionaryStructure(VM& vm, Zig::GlobalObject* globalObject, WriteBarrier<Structure>& cached, unsigned firstMemberNameIndex, unsigned count)
{
    const Identifier* memberNames = schemaStrings(vm).memberNames(firstMemberNameIndex, count);
    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), count);
    for (unsigned i = 0; i < count; ++i) {
        PropertyOffset offset;
        structure = Structure::addPropertyTransition(vm, structure, memberNames[i], 0, offset);
        RELEASE_ASSERT(offset == static_cast<PropertyOffset>(i));
    }
    cached.set(vm, globalObject, structure);
    return structure;
}

// The members are named by Tables::memberNames, from `firstMemberNameIndex`. An empty value is a member that is absent.
static EncodedJSValue putMembers(VM& vm, JSObject* object, unsigned firstMemberNameIndex, const JSValue* values, size_t count)
{
    const Identifier* memberNames = schemaStrings(vm).memberNames(firstMemberNameIndex, count);
    for (size_t i = 0; i < count; ++i) {
        if (values[i])
            object->putDirect(vm, memberNames[i], values[i]);
    }
    return JSValue::encode(object);
}

extern "C" EncodedJSValue Bun__Bindgen__createObject(JSGlobalObject* globalObject, unsigned firstMemberNameIndex, unsigned dictionaryIndex, bool hasEveryMember, const JSValue* values, size_t count)
{
    VM& vm = getVM(globalObject);
    if (!hasEveryMember) {
        hasEveryMember = true;
        for (size_t i = 0; i < count; ++i)
            hasEveryMember &= !!values[i];
    }
    hasEveryMember &= count <= JSFinalObject::maxInlineCapacity;
    if (auto* owner = dynamicDowncast<Zig::GlobalObject>(globalObject); owner && hasEveryMember) [[likely]] {
        auto& cached = owner->m_bindgenAdditions.m_returnedDictionaryStructures[dictionaryIndex];
        Structure* structure = cached.get();
        if (!structure) [[unlikely]]
            structure = createReturnedDictionaryStructure(vm, owner, cached, firstMemberNameIndex, count);
        JSObject* object = constructEmptyObject(vm, structure);
        // Nothing was allocated since, so the collector has not looked at the object, and no write needs a barrier.
        static_assert(sizeof(WriteBarrier<Unknown>) == sizeof(JSValue));
        memcpy(static_cast<void*>(object->inlineStorage()), values, count * sizeof(JSValue));
        return JSValue::encode(object);
    }
    JSObject* object = constructEmptyObject(globalObject, globalObject->objectPrototype(), std::min<unsigned>(count, JSFinalObject::maxInlineCapacity));
    return putMembers(vm, object, firstMemberNameIndex, values, count);
}

extern "C" EncodedJSValue Bun__Bindgen__createNullPrototypeObject(JSGlobalObject* globalObject, unsigned firstMemberNameIndex, const JSValue* values, size_t count)
{
    VM& vm = getVM(globalObject);
    JSObject* object = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    return putMembers(vm, object, firstMemberNameIndex, values, count);
}

extern "C" bool Bun__Bindgen__putRecordEntry(JSGlobalObject* globalObject, EncodedJSValue record, const uint8_t* key, size_t keyLength, EncodedJSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto name = Zig::convertUTF8ToString(std::span { key, keyLength });
    if (name.isNull()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return false;
    }
    asObject(JSValue::decode(record))->putDirectMayBeIndex(globalObject, Identifier::fromString(vm, name), JSValue::decode(value));
    RETURN_IF_EXCEPTION(scope, false);
    return true;
}

extern "C" EncodedJSValue Bun__Bindgen__enumerationValueToJS(JSGlobalObject* globalObject, unsigned index)
{
    return JSValue::encode(schemaStrings(getVM(globalObject)).enumerationValue(index));
}

// `exceptionForInspection()` is not an exception check: the host function's own scope does that.
extern "C" bool Bun__Bindgen__exceptionPresenceMatches(JSGlobalObject* globalObject, bool shouldHaveException)
{
    VM& vm = getVM(globalObject);
    auto* exception = vm.exceptionForInspection();
    return shouldHaveException ? !!exception : !exception || vm.isTerminationException(exception);
}

extern "C" EncodedJSValue Bun__Bindgen__constructArrayFromValues(JSGlobalObject* globalObject, const JSValue* values, size_t count)
{
    return JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), values, count));
}

// What a thunk holds a result to that is declared as an instance of a class without a `.bind.ts` file. The value is not empty.
extern "C" bool Bun__Bindgen__isAbortSignal(EncodedJSValue value)
{
    return !!dynamicDowncast<WebCore::JSAbortSignal>(JSValue::decode(value));
}

extern "C" bool Bun__Bindgen__isArrayBuffer(EncodedJSValue value)
{
    auto* buffer = dynamicDowncast<JSArrayBuffer>(JSValue::decode(value));
    return buffer && !buffer->isShared();
}

extern "C" bool Bun__Bindgen__isBuffer(EncodedJSValue value)
{
    JSValue decoded = JSValue::decode(value);
    return decoded.isCell() && decoded.asCell()->type() == Uint8ArrayType && JSBuffer__isBuffer(decoded.asCell()->structure()->globalObject(), value);
}

extern "C" bool Bun__Bindgen__isHeaders(EncodedJSValue value)
{
    return !!dynamicDowncast<WebCore::JSFetchHeaders>(JSValue::decode(value));
}

extern "C" bool Bun__Bindgen__isReadableStream(EncodedJSValue value)
{
    return !!dynamicDowncast<WebCore::JSReadableStream>(JSValue::decode(value));
}

extern "C" bool Bun__Bindgen__isURL(EncodedJSValue value)
{
    return !!dynamicDowncast<WebCore::JSDOMURL>(JSValue::decode(value));
}

}

namespace Bun::Bindgen {

JSC::JSString* toWebStringSlow(JSC::JSGlobalObject& globalObject, JSC::JSValue value, WebString kind, bool nullToEmpty)
{
    auto& vm = JSC::getVM(&globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (nullToEmpty && value.isNull())
        return JSC::jsEmptyString(vm);
    JSC::JSString* string = value.toStringOrNull(&globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (kind == WebString::DOMString || string->is8Bit())
        return string;
    auto characters = string->value(&globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (kind == WebString::USVString) {
        if (!WTF::hasUnpairedSurrogate(characters.data))
            return string;
        return JSC::jsString(vm, WTF::replaceUnpairedSurrogatesWithReplacementCharacter(WTF::String(characters.data)));
    }
    if (!characters->containsOnlyLatin1()) {
        JSC::throwTypeError(&globalObject, scope, "Cannot convert a string with a character above U+00FF to a ByteString"_s);
        return nullptr;
    }
    return JSC::jsString(vm, WTF::String::make8Bit(characters->span16()));
}

JSC::JSValue iteratorMethodOf(JSC::JSGlobalObject& globalObject, JSC::JSValue value)
{
    if (!value.isObject())
        return {};
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(&globalObject));
    JSC::JSValue method = JSC::iteratorMethod(&globalObject, JSC::asObject(value));
    RETURN_IF_EXCEPTION(scope, {});
    return method.isUndefined() ? JSC::JSValue() : method;
}

// JsList::of_cell() in bindgen/interface.rs
static_assert(JSC::JSCellButterfly::offsetOfPublicLength() == 8 && JSC::JSCellButterfly::offsetOfData() == 16);

JSC::JSCellButterfly* createList(JSC::JSGlobalObject& globalObject, JSC::MarkedArgumentBuffer& elements)
{
    auto& vm = JSC::getVM(&globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* list = elements.hasOverflowed() ? nullptr : JSC::JSCellButterfly::tryCreateFromArgList(vm, elements);
    if (!list) [[unlikely]]
        JSC::throwOutOfMemoryError(&globalObject, scope);
    return list;
}

void forEachInIterable(JSC::JSGlobalObject& globalObject, JSC::JSObject* iterable, JSC::JSValue method, const WTF::ScopedLambda<void(JSC::JSValue)>& callback)
{
    JSC::forEachInIterable(globalObject, iterable, method, [&](JSC::VM&, JSC::JSGlobalObject&, JSC::JSValue next) { callback(next); });
}

WTF::String describeInstanceOf(WTF::ASCIILiteral className)
{
    return WTF::makeString("an instance of "_s, className);
}

JSC::JSCellButterfly* listFromIterable(JSC::JSGlobalObject& globalObject, JSC::JSObject* iterable, JSC::JSValue method, ConvertElement convert)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(&globalObject));
    JSC::MarkedArgumentBuffer elements;
    JSC::forEachInIterable(globalObject, iterable, method, [&](JSC::VM&, JSC::JSGlobalObject& globalObject, JSC::JSValue next) {
        if (JSC::JSValue converted = convert(globalObject, next))
            elements.append(converted);
    });
    RETURN_IF_EXCEPTION(scope, (elements.overflowCheckNotNeeded(), nullptr));
    RELEASE_AND_RETURN(scope, createList(globalObject, elements));
}

JSC::JSCellButterfly* listFromRecord(JSC::JSGlobalObject& globalObject, JSC::JSObject* object, ConvertElement convertKey, ConvertElement convertValue)
{
    auto& vm = JSC::getVM(&globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::PropertyNameArrayBuilder names(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, &globalObject, names, JSC::DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSC::MarkedArgumentBuffer elements;
    for (auto& name : names) {
        JSC::PropertySlot slot(object, JSC::PropertySlot::InternalMethodType::GetOwnProperty);
        bool hasProperty = object->methodTable()->getOwnPropertySlot(object, &globalObject, name, slot);
        RETURN_IF_EXCEPTION(scope, (elements.overflowCheckNotNeeded(), nullptr));
        if (!hasProperty || (slot.attributes() & JSC::PropertyAttribute::DontEnum))
            continue;
        elements.append(convertKey(globalObject, JSC::identifierToJSValue(vm, name)));
        RETURN_IF_EXCEPTION(scope, (elements.overflowCheckNotNeeded(), nullptr));
        JSC::JSValue value = object->get(&globalObject, name);
        RETURN_IF_EXCEPTION(scope, (elements.overflowCheckNotNeeded(), nullptr));
        elements.append(convertValue(globalObject, value));
        RETURN_IF_EXCEPTION(scope, (elements.overflowCheckNotNeeded(), nullptr));
    }
    RELEASE_AND_RETURN(scope, createList(globalObject, elements));
}

JSStringAndImpl resolveString(JSC::JSGlobalObject& globalObject, JSC::JSString* string)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(&globalObject));
    auto characters = string->value(&globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return { string, characters.data.impl() };
}

JSStringAndImpl atomizeString(JSC::JSGlobalObject& globalObject, JSC::JSString* string)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(&globalObject));
    auto atom = string->toAtomString(&globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return { string, atom.data };
}

JSStringAndImpl atomLiteral(JSC::JSGlobalObject& globalObject, WTF::ASCIILiteral literal)
{
    auto* string = JSC::jsString(JSC::getVM(&globalObject), WTF::AtomString(literal).string());
    return { string, string->tryGetValueImpl() };
}

}

extern "C" WebCore::DOMException* Bun__Bindgen__newDOMException(WTF::StringImpl* message, const Latin1Character* name, size_t length)
{
    return &WebCore::DOMException::create(WTF::String(message), WTF::String({ name, length })).leakRef();
}

extern "C" void Bun__Bindgen__derefDOMException(WebCore::DOMException* exception)
{
    exception->deref();
}

extern "C" JSC::EncodedJSValue Bun__Bindgen__createDOMException(JSC::JSGlobalObject* globalObject, WebCore::ExceptionCode code, const uint8_t* message, size_t length)
{
    return JSC::JSValue::encode(WebCore::createDOMExceptionObject(globalObject, code, WTF::String::fromUTF8ReplacingInvalidSequences({ message, length })));
}

extern "C" void Bun__Bindgen__freezeArray(JSC::JSGlobalObject* globalObject, JSC::JSObject* array)
{
    JSC::objectConstructorFreeze(globalObject, array);
}
