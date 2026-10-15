#include "root.h"
#include "Bindgen/DictionaryMemberReader.h"
#include "Bindgen/Identifiers.h"
#include "Bindgen/JSStringUTF8View.h"
#include "BunClientData.h"
#include "GeneratedBindings+Tables.h"
#include "ObjectBindings.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/StructureInlines.h>
#include <algorithm>
#include <wtf/SIMDUTF.h>

namespace Bun::Bindgen {
using namespace JSC;

Identifiers::Identifiers(VM& vm)
    : m_vm(vm)
    , m_memberNames(std::make_unique<Identifier[]>(Tables::memberNames.size()))
    , m_enumerationValues(std::make_unique<JSString*[]>(Tables::enumerationValues.size()))
{
}

void Identifiers::initializeMemberNames(unsigned first, unsigned count)
{
    ASSERT(m_vm.currentThreadIsHoldingAPILock());
    for (unsigned i = first; i < first + count; ++i)
        m_memberNames[i] = Identifier::fromString(m_vm, Tables::memberNames[i]);
}

void Identifiers::initializeEnumerationValue(unsigned index)
{
    ASSERT(m_vm.currentThreadIsHoldingAPILock());
    m_enumerationValues[index] = jsString(m_vm, AtomString(Tables::enumerationValues[index]));
}

template<typename Visitor>
void Identifiers::visit(Visitor& visitor)
{
    for (unsigned i = 0; i < Tables::enumerationValues.size(); ++i) {
        if (auto* string = m_enumerationValues[i])
            visitor.appendUnbarriered(string);
    }
}
template void Identifiers::visit(JSC::AbstractSlotVisitor&);
template void Identifiers::visit(JSC::SlotVisitor&);

Identifiers& identifiers(VM& vm)
{
    return static_cast<WebCore::JSVMClientData*>(vm.clientData)->bindgenIdentifiers;
}

static_assert(std::ranges::all_of(Tables::objectStructures, [](const auto& structure) { return structure.memberCount <= JSFinalObject::maxInlineCapacity; }), "a returned dictionary has more members than an object holds inline");

Structure* createObjectStructure(VM& vm, JSGlobalObject* globalObject, unsigned index)
{
    auto [firstMemberNameIndex, memberCount] = Tables::objectStructures[index];
    const Identifier* memberNames = identifiers(vm).identifiersAt(firstMemberNameIndex, memberCount);
    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), memberCount);
    for (unsigned i = 0; i < memberCount; ++i) {
        PropertyOffset offset;
        structure = Structure::addPropertyTransition(vm, structure, memberNames[i], 0, offset);
        RELEASE_ASSERT(offset == static_cast<PropertyOffset>(i));
    }
    return structure;
}

NEVER_INLINE JSValue DictionaryMemberReader::get(unsigned index)
{
    if (ownPropertiesAreTheWholeAnswer()) [[likely]] {
        unsigned attributes = 0;
        PropertyOffset offset = m_object->structure()->get(m_vm, m_memberNames[index], attributes);
        if (offset == invalidOffset)
            return jsUndefined();
        if (!(attributes & (PropertyAttribute::Accessor | PropertyAttribute::CustomAccessorOrValue))) [[likely]]
            return m_object->getDirect(offset);
    }
    return getIfPropertyExistsPrototypePollutionMitigation(m_vm, m_globalObject, m_object, m_memberNames[index]);
}

bool JSStringUTF8View::convert()
{
    StringView view = m_view;
    m_isConverted = true;
    if (view.is8Bit()) {
        auto span = view.span8();
        if (!m_converted.tryGrow(span.size() * 2))
            return false;
        m_converted.shrink(simdutf::convert_latin1_to_utf8(byteCast<char>(span.data()), span.size(), byteCast<char>(m_converted.mutableSpan().data())));
        return true;
    }
    auto span = view.span16();
    if (!m_converted.tryGrow(span.size() * 3))
        return false;
    size_t length = simdutf::convert_utf16le_to_utf8(span.data(), span.size(), byteCast<char>(m_converted.mutableSpan().data()));
    if (length) [[likely]] {
        m_converted.shrink(length);
        return true;
    }
    // simdutf refuses unpaired surrogates; each becomes U+FFFD.
    auto lenient = view.utf8(WTF::ConversionMode::StrictConversionReplacingUnpairedSurrogatesWithFFFD);
    m_converted.shrink(0);
    return m_converted.tryAppend(byteCast<uint8_t>(lenient.span()));
}

}

using namespace JSC;

// An empty value is a member that is absent.
extern "C" EncodedJSValue Bun__Bindgen__createObject(JSGlobalObject* globalObject, unsigned structureIndex, const EncodedJSValue* values, size_t count)
{
    VM& vm = getVM(globalObject);
    ASSERT(count == Bun::Bindgen::Tables::objectStructures[structureIndex].memberCount);
    bool hasEveryMember = true;
    for (size_t i = 0; i < count; ++i)
        hasEveryMember &= !!values[i];
    if (hasEveryMember) [[likely]] {
        JSObject* object = constructEmptyObject(vm, defaultGlobalObject(globalObject)->m_bindgenAdditions.m_objectStructures[structureIndex].getInitializedOnMainThread(globalObject));
        for (size_t i = 0; i < count; ++i)
            object->putDirectOffset(vm, static_cast<PropertyOffset>(i), JSValue::decode(values[i]));
        return JSValue::encode(object);
    }
    const Identifier* memberNames = Bun::Bindgen::identifiers(vm).identifiersAt(Bun::Bindgen::Tables::objectStructures[structureIndex].firstMemberNameIndex, count);
    JSObject* object = constructEmptyObject(globalObject, globalObject->objectPrototype(), count);
    for (size_t i = 0; i < count; ++i) {
        if (values[i])
            object->putDirect(vm, memberNames[i], JSValue::decode(values[i]));
    }
    return JSValue::encode(object);
}

extern "C" EncodedJSValue Bun__Bindgen__enumerationValueToJS(JSGlobalObject* globalObject, unsigned index)
{
    return JSValue::encode(Bun::Bindgen::identifiers(getVM(globalObject)).stringAt(index));
}

extern "C" EncodedJSValue Bun__Bindgen__constructArrayFromValues(JSGlobalObject* globalObject, const JSValue* values, size_t count)
{
    return JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), values, count));
}

extern "C" EncodedJSValue Bun__Bindgen__constructArray(JSGlobalObject* globalObject, MarkedArgumentBuffer* values)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (values->hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), *values)));
}
