// What src/dom/api/core needs of JavaScriptCore.
#include "root.h"
#include "DOMURL.h"
#include "DesktopRealm.h"
#include <wtf/SetForScope.h>

#include "BunClientData.h"
#include "Bindgen/JSInterface.h"
#include "JSDOMURL.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/HeapObserver.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalProxy.h>
#include <JavaScriptCore/JSStringInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ObjectPrototype.h>
#include <JavaScriptCore/Protect.h>

using namespace JSC;

extern "C" StringImpl* Bun__DOM__emptyString()
{
    return StringImpl::empty();
}

extern "C" StringImpl* Bun__DOM__createLatin1(uint32_t length, Latin1Character** characters)
{
    std::span<Latin1Character> span;
    auto string = StringImpl::createUninitialized(length, span);
    *characters = length ? span.data() : reinterpret_cast<Latin1Character*>(1);
    return &string.leakRef();
}

extern "C" StringImpl* Bun__DOM__createUTF16(uint32_t length, char16_t** characters)
{
    std::span<char16_t> span;
    auto string = StringImpl::createUninitialized(length, span);
    *characters = length ? span.data() : reinterpret_cast<char16_t*>(2);
    return &string.leakRef();
}

extern "C" StringImpl* Bun__DOM__substring(StringImpl* of, uint32_t start, uint32_t length)
{
    return &of->substring(start, length).leakRef();
}

extern "C" StringImpl* Bun__DOM__sharedPrefix(StringImpl* of, uint32_t length)
{
    return &StringImpl::createSubstringSharingImpl(*of, 0, length).leakRef();
}

extern "C" EncodedJSValue Bun__DOM__stringToJS(JSGlobalObject* globalObject, StringImpl* string)
{
    return JSValue::encode(jsString(globalObject->vm(), *std::bit_cast<const String*>(&string)));
}

extern "C" EncodedJSValue Bun__DOM__permanentString(JSGlobalObject* globalObject, StringImpl* string)
{
    JSValue cell = JSValue::decode(Bun__DOM__stringToJS(globalObject, string));
    gcProtect(cell);
    return JSValue::encode(cell);
}

namespace {
class Eraser final : public HeapObserver {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(Eraser);

public:
    explicit Eraser(std::span<EncodedJSValue> values)
        : m_values(values)
    {
    }

private:
    void willGarbageCollect() final {}
    void didGarbageCollect(CollectionScope) final { zeroSpan(m_values); }

    std::span<EncodedJSValue> m_values;
};
}

// They are emptied when the collector has found out what is dead, before the thread goes on.
extern "C" void* Bun__DOM__createEraser(JSGlobalObject* globalObject, EncodedJSValue* values, size_t count)
{
    auto* eraser = new Eraser({ values, count });
    globalObject->vm().heap.addObserver(eraser);
    return eraser;
}

// The VM is gone.
extern "C" void Bun__DOM__destroyEraser(void* eraser)
{
    delete static_cast<Eraser*>(eraser);
}

// More than `capacity` if nothing was copied.
extern "C" size_t Bun__DOM__copyRope(EncodedJSValue rope, Latin1Character* room, size_t capacity)
{
    auto* string = asString(JSValue::decode(rope));
    if (!string->is8Bit() || string->length() > capacity)
        return capacity + 1;
    string->resolveToBuffer(std::span { room, string->length() });
    return string->length();
}

extern "C" EncodedJSValue Bun__DOM__resolveRope(JSGlobalObject* globalObject, EncodedJSValue string)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    (void)asString(JSValue::decode(string))->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return string;
}

extern "C" StringImpl* Bun__DOM__atomize(StringImpl* string)
{
    return AtomStringImpl::add(string).leakRef();
}

extern "C" StringImpl* Bun__DOM__atomizeLatin1(const Latin1Character* characters, uint32_t length)
{
    return length ? AtomStringImpl::add(std::span { characters, length }).leakRef() : StringImpl::empty();
}

extern "C" uint32_t Bun__DOM__hashOfLatin1(const Latin1Character* characters, uint32_t length)
{
    static_assert(StringHasher::flagCount == 8);
    return StringHasher::computeHashAndMaskTop8Bits(std::span { characters, length });
}

extern "C" StringImpl* Bun__DOM__hrefOfURLObject(EncodedJSValue value)
{
    auto* url = dynamicDowncast<WebCore::JSDOMURL>(JSValue::decode(value));
    return url ? String { url->wrapped().href().string() }.releaseImpl().leakRef() : nullptr;
}

extern "C" StringImpl* Bun__DOM__parseURL(JSGlobalObject* globalObject, StringImpl* url, StringImpl* base)
{
    auto parsed = WebCore::DOMURL::parse(url, base, &WebCore::clientData(globalObject->vm())->urlBaseCache());
    return parsed ? String(parsed->href().string()).releaseImpl().leakRef() : nullptr;
}

extern "C" StringImpl* Bun__DOM__partOfURL(StringImpl* href, uint8_t part)
{
    using WebCore::URLDecomposition;
    static constexpr String (URLDecomposition::* getters[])() const = {
        &URLDecomposition::protocol, &URLDecomposition::username, &URLDecomposition::password, &URLDecomposition::host, &URLDecomposition::hostname,
        &URLDecomposition::port, &URLDecomposition::pathname, &URLDecomposition::search, &URLDecomposition::hash
    };
    auto url = WebCore::DOMURL::parse(href, {});
    String result = url ? (url.get()->*getters[part])() : String();
    return result.isNull() ? Bun__DOM__emptyString() : result.releaseImpl().leakRef();
}

extern "C" StringImpl* Bun__DOM__urlWithPart(StringImpl* href, uint8_t part, StringImpl* value)
{
    using WebCore::URLDecomposition;
    static constexpr void (URLDecomposition::* setters[])(StringView) = {
        &URLDecomposition::setProtocol, &URLDecomposition::setUsername, &URLDecomposition::setPassword, &URLDecomposition::setHost, &URLDecomposition::setHostname,
        &URLDecomposition::setPort, &URLDecomposition::setPathname, nullptr, &URLDecomposition::setHash
    };
    auto url = WebCore::DOMURL::parse(href, {});
    if (!url)
        return String(href).releaseImpl().leakRef();
    if (setters[part])
        (url.get()->*setters[part])(*value);
    else
        url->setSearch(value);
    return String(url->href().string()).releaseImpl().leakRef();
}

extern "C" EncodedJSValue Bun__DOM__originOfURL(JSGlobalObject* globalObject, StringImpl* href)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto url = WebCore::DOMURL::parse(href, {});
    String origin = url ? url->origin() : emptyString();
    if (origin == "null"_s) {
        JSValue ofRegisteredScheme = Bun::desktopRealmOriginOf(globalObject, href);
        RETURN_IF_EXCEPTION(scope, {});
        if (ofRegisteredScheme)
            return JSValue::encode(ofRegisteredScheme);
    }
    return JSValue::encode(jsString(vm, origin));
}

extern "C" const unsigned* Bun__DOM__barrierThreshold(JSGlobalObject* globalObject)
{
    return globalObject->vm().heap.addressOfBarrierThreshold();
}

extern "C" VM* Bun__DOM__vm(JSGlobalObject* globalObject)
{
    return &globalObject->vm();
}

extern "C" uint32_t Bun__DOM__collections(VM* vm)
{
    return vm->heap.objectSpace().newlyAllocatedVersion();
}

extern "C" void Bun__DOM__writeBarrier(VM* vm, const JSCell* cell)
{
    vm->writeBarrier(cell);
}

static JSArray* createList(JSGlobalObject* globalObject, unsigned capacity)
{
    auto* list = JSArray::tryCreate(globalObject->vm(), globalObject->originalArrayStructureForIndexingType(ArrayWithContiguous), 0, capacity);
    RELEASE_ASSERT(list);
    return list;
}

// A page that defines an indexed accessor on a prototype turns all arrays of its realm into ArrayStorage.
static WriteBarrier<Unknown>* valuesOf(JSObject* list)
{
    if (hasContiguous(list->indexingType())) [[likely]]
        return list->butterfly()->contiguous().data();
    RELEASE_ASSERT(hasAnyArrayStorage(list->indexingType()));
    return list->butterfly()->arrayStorage()->m_vector;
}

extern "C" EncodedJSValue Bun__DOM__listCreate(JSGlobalObject* globalObject, uint32_t capacity)
{
    return JSValue::encode(createList(globalObject, capacity));
}

extern "C" EncodedJSValue Bun__DOM__listFrom(JSGlobalObject* globalObject, uint32_t length, void* context, EncodedJSValue (*at)(void*, uint32_t))
{
    auto& vm = globalObject->vm();
    auto* list = JSArray::tryCreate(vm, globalObject->originalArrayStructureForIndexingType(ArrayWithContiguous), length);
    RELEASE_ASSERT(list);
    for (uint32_t i = 0; i < length; i++) {
        auto value = JSValue::decode(at(context, i));
        valuesOf(list)[i].set(vm, list, value);
    }
    return JSValue::encode(list);
}

extern "C" EncodedJSValue Bun__DOM__listCopyWithout(JSGlobalObject* globalObject, EncodedJSValue list, EncodedJSValue value)
{
    auto* array = uncheckedDowncast<JSArray>(JSValue::decode(list));
    unsigned length = array->length();
    auto* copy = createList(globalObject, length + 1);
    auto *from = valuesOf(array), *to = valuesOf(copy);
    unsigned kept = 0;
    for (unsigned i = 0; i < length; i++) {
        if (JSValue::encode(from[i].get()) != value)
            to[kept++].setWithoutWriteBarrier(from[i].get());
    }
    copy->butterfly()->setPublicLength(kept);
    globalObject->vm().writeBarrier(copy);
    return JSValue::encode(copy);
}

extern "C" EncodedJSValue Bun__DOM__listOfCells(JSGlobalObject* globalObject, const uintptr_t* payloads, uint32_t length, uintptr_t offset)
{
    ObjectInitializationScope scope(globalObject->vm());
    auto* list = JSArray::tryCreateUninitializedRestricted(scope, globalObject->originalArrayStructureForIndexingType(ArrayWithContiguous), length);
    RELEASE_ASSERT(list);
    auto* values = list->butterfly()->contiguous().data();
    for (uint32_t i = 0; i < length; i++)
        values[i].setWithoutWriteBarrier(std::bit_cast<JSCell*>(payloads[i] - offset));
    return JSValue::encode(list);
}

// For `List::contiguous`.
static_assert(JSCell::indexingTypeAndMiscOffset() == 4 && IndexingShapeMask == 0x0e && ContiguousShape == 0x08);
static_assert(JSObject::butterflyOffset() == 8 && Butterfly::offsetOfPublicLength() == -8);

extern "C" uint32_t Bun__DOM__listLength(EncodedJSValue list)
{
    return uncheckedDowncast<JSArray>(JSValue::decode(list))->length();
}

extern "C" EncodedJSValue Bun__DOM__listGet(EncodedJSValue list, uint32_t index)
{
    return JSValue::encode(asObject(JSValue::decode(list))->tryGetIndexQuickly(index));
}

extern "C" void Bun__DOM__listSet(JSGlobalObject* globalObject, EncodedJSValue list, uint32_t index, EncodedJSValue value)
{
    auto* array = asObject(JSValue::decode(list));
    RELEASE_ASSERT(index < array->butterfly()->publicLength());
    valuesOf(array)[index].set(globalObject->vm(), array, JSValue::decode(value));
}

extern "C" void Bun__DOM__listPush(JSGlobalObject* globalObject, EncodedJSValue list, EncodedJSValue value)
{
    auto& vm = globalObject->vm();
    auto* array = uncheckedDowncast<JSArray>(JSValue::decode(list));
    unsigned length = array->butterfly()->publicLength();
    if (!hasContiguous(array->indexingType())) [[unlikely]] {
        array->butterfly()->arrayStorage()->m_numValuesInVector = length;
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        array->putDirectIndex(globalObject, length, jsUndefined());
        (void)scope.exception();
        RELEASE_ASSERT(length < array->butterfly()->vectorLength());
        valuesOf(array)[length].set(vm, array, JSValue::decode(value));
        return;
    }
    if (length < array->butterfly()->vectorLength())
        array->butterfly()->setPublicLength(length + 1);
    else
        RELEASE_ASSERT(array->ensureLength(vm, length + 1));
    array->butterfly()->contiguous().at(array, length).set(vm, array, JSValue::decode(value));
}

extern "C" void Bun__DOM__listRemove(JSGlobalObject* globalObject, EncodedJSValue list, uint32_t index, uint32_t count)
{
    auto* array = asObject(JSValue::decode(list));
    auto* butterfly = array->butterfly();
    unsigned length = butterfly->publicLength();
    RELEASE_ASSERT(index <= length && count <= length - index);
    auto* values = valuesOf(array);
    for (unsigned i = index; i + count < length; i++)
        values[i].setWithoutWriteBarrier(values[i + count].get());
    for (unsigned i = length - count; i < length; i++)
        values[i].clear();
    if (!hasContiguous(array->indexingType())) [[unlikely]]
        butterfly->arrayStorage()->m_numValuesInVector -= count;
    butterfly->setPublicLength(length - count);
    globalObject->vm().writeBarrier(array);
}

extern "C" int32_t Bun__DOM__listFind(EncodedJSValue list, EncodedJSValue value, uint32_t step)
{
    auto* array = asObject(JSValue::decode(list));
    unsigned length = std::min(array->butterfly()->publicLength(), array->butterfly()->vectorLength());
    auto* values = length ? valuesOf(array) : nullptr;
    for (unsigned i = 0; i < length; i += step) {
        if (JSValue::encode(values[i].get()) == value)
            return i;
    }
    return -1;
}

extern "C" EncodedJSValue Bun__DOM__listValueOfKey(EncodedJSValue list, EncodedJSValue key)
{
    auto* array = asObject(JSValue::decode(list));
    auto* values = valuesOf(array);
    for (unsigned i = 1, length = array->butterfly()->publicLength(); i < length; i += 2) {
        if (JSValue::encode(values[i - 1].get()) == key)
            return JSValue::encode(values[i].get());
    }
    return {};
}

extern "C" JSGlobalObject* Bun__DOM__globalOf(EncodedJSValue cell)
{
    return JSValue::decode(cell).asCell()->structure()->realm();
}

extern "C" Structure* Bun__DOM__structure(JSGlobalObject* globalObject, uint32_t classIndex, EncodedJSValue prototype)
{
    auto* own = Bun::Bindgen::structureForInterface(globalObject, classIndex);
    if (!prototype)
        return own;
    JSValue::decode(prototype).getObject()->didBecomePrototype(globalObject->vm());
    return Structure::create(globalObject->vm(), globalObject, JSValue::decode(prototype), own->typeInfo(), own->classInfoForCells(), own->indexingModeIncludingHistory(), own->inlineCapacity());
}

extern "C" void Bun__DOM__inherit(JSGlobalObject* globalObject, EncodedJSValue object, EncodedJSValue prototype)
{
    asObject(JSValue::decode(object))->setPrototypeDirect(globalObject->vm(), JSValue::decode(prototype));
}

extern "C" EncodedJSValue Bun__DOM__construct(JSGlobalObject* globalObject, EncodedJSValue encoded)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto constructor = JSValue::decode(encoded);
    RELEASE_AND_RETURN(scope, JSValue::encode(construct(globalObject, constructor, getConstructData(constructor), ArgList())));
}

extern "C" EncodedJSValue Bun__DOM__constructWith(JSGlobalObject* globalObject, EncodedJSValue encoded, EncodedJSValue argument)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto constructor = JSValue::decode(encoded);
    RELEASE_AND_RETURN(scope, JSValue::encode(construct(globalObject, constructor, getConstructData(constructor), ArgList(&argument, 1))));
}

namespace Bun {
JSC_DECLARE_HOST_FUNCTION(jsDesktopInspectOther);
JSC_DEFINE_HOST_FUNCTION(jsDesktopInspectOther, (JSGlobalObject*, CallFrame* callFrame))
{
    return JSValue::encode(callFrame->thisValue());
}
}

extern "C" EncodedJSValue Bun__DOM__changePrototype(JSGlobalObject* globalObject, EncodedJSValue object, EncodedJSValue prototype)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    asObject(JSValue::decode(object))->setPrototype(globalObject->vm(), globalObject, JSValue::decode(prototype), true);
    RETURN_IF_EXCEPTION(scope, {});
    return object;
}

extern "C" JSGlobalObject* Bun__DOM__functionRealm(JSGlobalObject* globalObject, EncodedJSValue function)
{
    return getFunctionRealm(globalObject, asObject(JSValue::decode(function)));
}

extern "C" EncodedJSValue Bun__DOM__toStrings(JSGlobalObject* globalObject, EncodedJSValue encoded)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto value = JSValue::decode(encoded);
    if (!value.isObject()) {
        throwTypeError(globalObject, scope, "The value cannot be converted to a sequence."_s);
        return {};
    }
    MarkedArgumentBuffer strings;
    forEachInIterable(globalObject, value, [&](VM& vm, JSGlobalObject* globalObject, JSValue it) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto* string = it.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, );
        strings.append(string);
    });
    RETURN_IF_EXCEPTION(scope, {});
    if (strings.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, globalObject->originalArrayStructureForIndexingType(ArrayWithContiguous), strings)));
}

// `mayHaveObjectsOf` compares them.
extern "C" void Bun__DOM__setAgentOfRealm(JSGlobalObject* globalObject, EncodedJSValue agent)
{
    auto& vm = globalObject->vm();
    globalObject->putDirect(vm, WebCore::builtinNames(vm).documentPrivateName(), JSValue::decode(agent));
}

extern "C" EncodedJSValue Bun__DOM__agentOfRealm(JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    return JSValue::encode(globalObject->getDirect(vm, WebCore::builtinNames(vm).documentPrivateName()));
}

extern "C" EncodedJSValue Bun__DOM__memberOf(JSGlobalObject* globalObject, EncodedJSValue object, const Latin1Character* text, size_t length)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    if (scope.exception())
        return {};
    auto name = Identifier::fromString(vm, std::span { text, length });
    for (JSObject* holder = JSValue::decode(object).getObject(); holder && !holder->inherits<ObjectPrototype>(); holder = holder->getPrototypeDirect().getObject()) {
        PropertySlot slot(JSValue::decode(object), PropertySlot::InternalMethodType::Get);
        bool isThere = holder->methodTable()->getOwnPropertySlot(holder, globalObject, name, slot);
        JSValue found = isThere && !scope.exception() ? slot.getValue(globalObject, name) : JSValue();
        if (scope.exception()) {
            scope.clearExceptionExceptTermination();
            return {};
        }
        if (isThere)
            return JSValue::encode(found);
    }
    return {};
}
